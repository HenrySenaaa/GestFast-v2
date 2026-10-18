// db.js - Camada de dados do GestFast ERP.
// Persistência no MySQL (database/schema.sql) via pool de database/conexao.js.
// Toda operação que altera estoque roda numa transação: se algo falhar, nada é gravado.
'use strict';
const { pool, transacao, testarConexao } = require('./database/conexao');
const { erro } = require('./lib/errors');
const auth = require('./lib/auth');
const gateways = require('./lib/gateways');

// ------------------------------------------------------------------ utilitários
const pad = n => String(n).padStart(2, '0');
const dataISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dataHora = (d = new Date()) => `${dataISO(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const deslocar = (dias = 0, minutos = 0) => new Date(Date.now() + dias * 86400000 + minutos * 60000);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const txt = v => (v === undefined || v === null ? '' : String(v).trim());
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

// DATETIME do MySQL vem como 'AAAA-MM-DD HH:MM:SS'; a interface usa 'AAAA-MM-DD HH:MM'.
const hm = s => (s ? String(s).slice(0, 16) : s);
const bool = v => !!Number(v);
const idNum = v => (Number.isInteger(Number(v)) ? Number(v) : 0);
// Texto para LIKE: escapa os curingas digitados pelo usuário.
const like = t => `%${String(t).replace(/[\\%_]/g, '\\$&')}%`;
// Trecho LIMIT/OFFSET de uma listagem paginada (vazio = sem paginação). Os números são validados aqui.
const paginar = (limite, offset) => {
  const l = Math.trunc(Number(limite));
  if (!(l > 0)) return '';
  const o = Math.max(0, Math.trunc(Number(offset)) || 0);
  return ` LIMIT ${Math.min(l, 500)} OFFSET ${o}`;
};
// Monta a listagem `sql` (que começa com "... FROM tabela alias JOIN ...") filtrada e ordenada.
// Com paginação, a página é cortada ANTES dos JOINs ("deferred join"): sem isso o MySQL junta a tabela
// inteira com usuario/produto e só depois aplica o LIMIT (medido: ~1 s para 50 linhas em 200 mil).
const listagem = (sql, tabela, filtro, ordem, pag) => (pag
  ? sql.replace(`FROM ${tabela}`, `FROM (SELECT * FROM ${tabela}${filtro} ORDER BY ${ordem}${pag}) ${tabela.split(' ')[1]}`) + ` ORDER BY ${ordem}`
  : `${sql}${filtro} ORDER BY ${ordem}`);

// Unidades que aceitam fração (peso/volume). As demais só aceitam quantidades inteiras.
const aceitaFracao = un => ['kg', 'lt', 'l'].includes(String(un || '').toLowerCase());

function validarQuantidade(prod, valor, rotulo = 'A quantidade') {
  const q = Number(valor);
  if (!Number.isFinite(q) || q <= 0) throw erro(`${rotulo} deve ser maior que zero.`);
  if (!aceitaFracao(prod.unidade) && !Number.isInteger(q)) {
    throw erro(`"${prod.nome_produto}" é controlado em ${prod.unidade} e só aceita quantidades inteiras.`);
  }
  return r3(q);
}

function validarTexto(valor, rotulo, { obrigatorio = false, min = 10, max = 5000 } = {}) {
  const t = txt(valor);
  if (!t) {
    if (obrigatorio) throw erro(`${rotulo} é obrigatório(a) e deve ter entre ${min} e ${max} caracteres.`);
    return '';
  }
  if (t.length < min || t.length > max) throw erro(`${rotulo} deve ter entre ${min} e ${max} caracteres.`);
  return t;
}

const FORMAS_PAGAMENTO = ['Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX'];
const SITUACOES_ABERTAS = ['Em Aberto', 'Cotado', 'AF Gerada'];
const MOTIVOS_PERDA = ['Vencido', 'Quebra/Avaria', 'Sobra do dia', 'Outro'];
const TIPOS_PRODUTO = ['Revenda', 'Produção', 'Insumo']; // Insumo não é vendido no caixa

// ------------------------------------------------------------------ consultas e conversões de linhas
const SQL_USUARIO = 'SELECT u.*, p.nome_perfil FROM usuario u JOIN perfil p ON p.id_perfil = u.id_perfil';

const mapProduto = p => p && {
  ...p, descricao: p.descricao || '', peso: p.peso || '', lote: p.lote || '', validade: p.validade || '', imagem: p.imagem || ''
};

const SQL_MOV = `SELECT m.*, p.nome_produto AS produto_nome, p.codigo_barras, p.unidade, u.nome AS usuario_nome
  FROM movimentacao_estoque m JOIN produto p ON p.id_produto = m.id_produto LEFT JOIN usuario u ON u.id_usuario = m.id_usuario`;

const mapMov = m => ({
  id_movimentacao: m.id_movimentacao, tipo_movimentacao: m.tipo_movimentacao, quantidade: m.quantidade,
  data_movimentacao: hm(m.data_movimentacao), observacao: m.observacao || '', id_produto: m.id_produto,
  produto_nome: m.produto_nome, codigo_barras: m.codigo_barras, unidade: m.unidade, valor_unitario: m.valor_unitario,
  valor_total: r2(m.quantidade * m.valor_unitario), id_usuario: m.id_usuario, usuario_nome: m.usuario_nome || 'Sistema',
  origem: m.origem, motivo_perda: m.motivo_perda || null
});

const SQL_VENDA = `SELECT v.*, u.nome AS usuario_nome, uc.nome AS cancelada_por_nome, ua.nome AS autorizada_por_nome,
    ue.nome AS editada_por_nome
  FROM venda v JOIN usuario u ON u.id_usuario = v.id_usuario
  LEFT JOIN usuario uc ON uc.id_usuario = v.cancelada_por
  LEFT JOIN usuario ua ON ua.id_usuario = v.autorizada_por
  LEFT JOIN usuario ue ON ue.id_usuario = v.editada_por`;

function mapVenda(v, itens) {
  const o = {
    id_venda: v.id_venda, codigo_venda: v.codigo_venda, data_venda: hm(v.data_venda), valor_subtotal: v.valor_subtotal,
    desconto: v.desconto, desconto_tipo: v.desconto_tipo, desconto_informado: v.desconto_informado, valor_total: v.valor_total,
    forma_pagamento: v.forma_pagamento, valor_recebido: v.valor_recebido, troco: v.troco, nsu: v.nsu,
    status_venda: v.status_venda, id_usuario: v.id_usuario, usuario_nome: v.usuario_nome, itens
  };
  if (v.status_venda === 'Cancelada') {
    Object.assign(o, {
      motivo_cancelamento: v.motivo_cancelamento, cancelada_por: v.cancelada_por_nome,
      autorizada_por: v.autorizada_por_nome, data_cancelamento: hm(v.data_cancelamento)
    });
  }
  if (v.editada_por) Object.assign(o, { editada_por: v.editada_por_nome, data_edicao: hm(v.data_edicao) });
  return o;
}

const SQL_PRODUCAO = `SELECT pr.*, p.nome_produto, p.unidade, u.nome AS usuario_nome, ue.nome AS estornada_por_nome
  FROM producao pr JOIN produto p ON p.id_produto = pr.id_produto JOIN usuario u ON u.id_usuario = pr.id_usuario
  LEFT JOIN usuario ue ON ue.id_usuario = pr.estornada_por`;

const mapProducao = r => ({
  id_producao: r.id_producao, id_produto: r.id_produto, nome_produto: r.nome_produto, unidade: r.unidade, receitas: r.receitas,
  quantidade: r.quantidade, custo_total: r.custo_total, custo_unitario: r2(r.custo_total / r.quantidade), data_producao: hm(r.data_producao),
  observacao: r.observacao || '', status: r.status, usuario_nome: r.usuario_nome,
  ...(r.status === 'Estornada' ? { estornada_por: r.estornada_por_nome, data_estorno: hm(r.data_estorno), motivo_estorno: r.motivo_estorno } : {})
});

const SQL_REQ = `SELECT r.*, f.nome AS fornecedor FROM requisicao r JOIN fornecedor f ON f.id_fornecedor = r.id_fornecedor`;

class Database {
  constructor() {
    this.pool = pool;
    this.testarConexao = testarConexao;
  }

  // Consulta direta (usada nos testes e em leituras simples).
  async query(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  end() { return pool.end(); }

  // O GestFast v2 precisa da migracao-otimizacao.sql (coluna numero_pedido e índices).
  async verificarEsquema() {
    const [rows] = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'requisicao' AND column_name = 'numero_pedido'");
    if (!rows.length) throw erro('O banco ainda não tem as otimizações do GestFast v2. Rode database/migracao-otimizacao.sql no MySQL Workbench.', 500);
    const [fichas] = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'ficha_tecnica'");
    if (!fichas.length) throw erro('O banco ainda não tem as tabelas de produção (etapa 3). Rode database/migracao-etapa3.sql no MySQL Workbench.', 500);
  }

  // Transação: roda fn(conn); no fim atualiza os alertas de estoque; erro = rollback de tudo.
  tx(fn) {
    return transacao(async c => {
      const r = await fn(c);
      await this.sincronizarAlertas(c);
      return r;
    });
  }

  // ---------------------------------------------------------------- dados de apoio
  async listCategorias(c = pool) {
    const [rows] = await c.query('SELECT * FROM categoria ORDER BY id_categoria');
    return rows;
  }

  async listFornecedores(c = pool) {
    const [rows] = await c.query('SELECT nome FROM fornecedor ORDER BY id_fornecedor');
    return rows.map(r => r.nome);
  }

  async listPerfis(c = pool) {
    const [rows] = await c.query('SELECT * FROM perfil ORDER BY id_perfil');
    return rows;
  }

  // ---------------------------------------------------------------- configurações
  async getSettings(c = pool) {
    const [[r]] = await c.query('SELECT * FROM configuracao WHERE id = 1');
    if (!r) throw erro('Configuração do sistema não encontrada. Rode o database/seed.sql.', 500);
    return {
      estabelecimento: r.estabelecimento,
      descontoMaximoPercent: Number(r.desconto_maximo_percent),
      intervaloAtualizacaoSeg: Number(r.intervalo_atualizacao_seg),
      simularCartaoNegado: bool(r.simular_cartao_negado),
      simularFornecedorIndisponivel: bool(r.simular_fornecedor_indisponivel),
      diasAlertaValidade: Number(r.dias_alerta_validade)
    };
  }

  updateSettings(d) {
    return this.tx(async c => {
      const s = await this.getSettings(c);
      if (d.estabelecimento !== undefined) {
        const e = txt(d.estabelecimento);
        if (e.length < 3 || e.length > 150) throw erro('O nome do estabelecimento deve ter entre 3 e 150 caracteres.');
        s.estabelecimento = e;
      }
      if (d.descontoMaximoPercent !== undefined) {
        const n = Number(d.descontoMaximoPercent);
        if (!Number.isFinite(n) || n < 0 || n > 100) throw erro('O desconto máximo deve estar entre 0% e 100%.');
        s.descontoMaximoPercent = n;
      }
      if (d.intervaloAtualizacaoSeg !== undefined) {
        const n = Number(d.intervaloAtualizacaoSeg);
        if (!Number.isFinite(n) || n < 2 || n > 60) throw erro('O intervalo de atualização deve estar entre 2 e 60 segundos.');
        s.intervaloAtualizacaoSeg = n;
      }
      if (d.diasAlertaValidade !== undefined) {
        const n = Number(d.diasAlertaValidade);
        if (!Number.isInteger(n) || n < 0 || n > 60) throw erro('O aviso de validade deve ser de 0 a 60 dias de antecedência.');
        s.diasAlertaValidade = n;
      }
      ['simularCartaoNegado', 'simularFornecedorIndisponivel'].forEach(k => { if (d[k] !== undefined) s[k] = !!d[k]; });
      await c.query(
        `UPDATE configuracao SET estabelecimento = ?, desconto_maximo_percent = ?, intervalo_atualizacao_seg = ?,
           simular_cartao_negado = ?, simular_fornecedor_indisponivel = ?, dias_alerta_validade = ? WHERE id = 1`,
        [s.estabelecimento, s.descontoMaximoPercent, s.intervaloAtualizacaoSeg, s.simularCartaoNegado, s.simularFornecedorIndisponivel, s.diasAlertaValidade]
      );
      return s;
    });
  }

  // ---------------------------------------------------------------- usuários, sessões e login
  publicUser(u) {
    if (!u) return null;
    const { senha, nome_perfil, ...resto } = u;
    return { ...resto, cargo: resto.cargo || '', perfil: nome_perfil || '' };
  }

  async getUserById(id, c = pool) {
    const [rows] = await c.query(`${SQL_USUARIO} WHERE u.id_usuario = ?`, [idNum(id)]);
    return rows[0];
  }

  async getUserByEmail(email, c = pool) {
    const [rows] = await c.query(`${SQL_USUARIO} WHERE u.email = ?`, [txt(email).toLowerCase()]);
    return rows[0];
  }

  async authenticate(email, senha) {
    if (!txt(email) || !senha) throw erro('Informe o e-mail e a senha.');
    const u = await this.getUserByEmail(email);
    if (!u || !auth.verifyPassword(senha, u.senha)) throw erro('E-mail ou senha incorretos', 401);
    if (u.status !== 'Ativo') throw erro('Sua conta está inativa. Entre em contato com o administrador', 403);
    return u;
  }

  // Autorização de gerente (cancelamento de vendas): exige credenciais de Administrador ou BackOffice.
  async authorizeManager(email, senha, aceitos = ['Administrador', 'BackOffice']) {
    const u = await this.getUserByEmail(email);
    if (!u || u.status !== 'Ativo' || !auth.verifyPassword(senha || '', u.senha) || !aceitos.includes(u.nome_perfil)) {
      throw erro('Autorização negada: informe e-mail e senha de um perfil gerente válido.', 403);
    }
    return u;
  }

  async createSession(idUsuario, lembrar) {
    const token = auth.newToken();
    const agora = Date.now();
    await pool.query('DELETE FROM sessao WHERE expira <= ?', [agora]);
    await pool.query('INSERT INTO sessao (hash, id_usuario, lembrar, criado, expira) VALUES (?, ?, ?, ?, ?)',
      [auth.hashToken(token), idUsuario, !!lembrar, agora, agora + (lembrar ? 30 * 86400000 : 8 * 3600000)]);
    return { token, maxAgeSeg: lembrar ? 30 * 86400 : null };
  }

  async getSessionUser(token) {
    if (!token) return null;
    const [rows] = await pool.query(
      `${SQL_USUARIO} JOIN sessao s ON s.id_usuario = u.id_usuario WHERE s.hash = ? AND s.expira > ? AND u.status = 'Ativo'`,
      [auth.hashToken(token), Date.now()]
    );
    if (!rows[0]) return null;
    const { hash, lembrar, criado, expira, ...u } = rows[0];
    return u;
  }

  async deleteSession(token) {
    if (!token) return;
    await pool.query('DELETE FROM sessao WHERE hash = ?', [auth.hashToken(token)]);
  }

  changePassword(id, atual, nova) {
    return this.tx(async c => {
      const u = await this.getUserById(id, c);
      if (!u || !auth.verifyPassword(atual || '', u.senha)) throw erro('A senha atual está incorreta.');
      this.validarSenha(nova);
      await c.query('UPDATE usuario SET senha = ? WHERE id_usuario = ?', [auth.hashPassword(nova), u.id_usuario]);
      return true;
    });
  }

  validarSenha(s) {
    if (!s || String(s).length < 6 || String(s).length > 100) throw erro('A senha deve ter entre 6 e 100 caracteres.');
  }

  async createResetToken(email) {
    const u = await this.getUserByEmail(email);
    if (!u || u.status !== 'Ativo') return null;
    const token = auth.newToken();
    await pool.query('DELETE FROM token_reset WHERE expira <= ? OR id_usuario = ?', [Date.now(), u.id_usuario]);
    await pool.query('INSERT INTO token_reset (hash, id_usuario, expira) VALUES (?, ?, ?)',
      [auth.hashToken(token), u.id_usuario, Date.now() + 30 * 60000]);
    return { token, user: u };
  }

  resetPassword(token, nova) {
    return this.tx(async c => {
      const h = auth.hashToken(token || '');
      const [[t]] = await c.query('SELECT * FROM token_reset WHERE hash = ? AND expira > ? FOR UPDATE', [h, Date.now()]);
      if (!t) throw erro('O link de redefinição é inválido ou expirou.');
      this.validarSenha(nova);
      await c.query('UPDATE usuario SET senha = ? WHERE id_usuario = ?', [auth.hashPassword(nova), t.id_usuario]);
      await c.query('DELETE FROM token_reset WHERE hash = ?', [h]);
      await c.query('DELETE FROM sessao WHERE id_usuario = ?', [t.id_usuario]);
      return this.getUserById(t.id_usuario, c);
    });
  }

  async listUsers({ q, id_perfil, status } = {}) {
    const where = [], params = [];
    if (id_perfil) { where.push('u.id_perfil = ?'); params.push(idNum(id_perfil)); }
    if (status) { where.push('u.status = ?'); params.push(status); }
    if (txt(q)) {
      where.push('(u.nome LIKE ? OR u.email LIKE ? OR u.cargo LIKE ?)');
      params.push(like(txt(q)), like(txt(q)), like(txt(q)));
    }
    const [rows] = await pool.query(`${SQL_USUARIO}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY u.id_usuario`, params);
    return rows.map(u => this.publicUser(u));
  }

  async adminsAtivos(excluindoId, c = pool) {
    const [[r]] = await c.query(
      `SELECT COUNT(*) AS n FROM usuario u JOIN perfil p ON p.id_perfil = u.id_perfil
       WHERE u.status = 'Ativo' AND p.nome_perfil = 'Administrador' AND u.id_usuario <> ?`, [idNum(excluindoId)]);
    return Number(r.n);
  }

  async perfilExiste(id, c) {
    const [rows] = await c.query('SELECT 1 FROM perfil WHERE id_perfil = ?', [idNum(id)]);
    return rows.length > 0;
  }

  createUser(d) {
    return this.tx(async c => {
      const nome = txt(d.nome), email = txt(d.email).toLowerCase();
      if (nome.length < 2 || nome.length > 150) throw erro('Informe o nome do funcionário (2 a 150 caracteres).');
      if (!EMAIL_RE.test(email)) throw erro('Informe um login (e-mail) válido.');
      this.validarSenha(d.senha);
      if (!(await this.perfilExiste(d.id_perfil, c))) throw erro('Selecione um perfil de acesso válido.');
      if (await this.getUserByEmail(email, c)) throw erro('O login informado já está em uso. Informe outro identificador.');
      const [r] = await c.query(
        `INSERT INTO usuario (nome, email, senha, cargo, status, data_criacao, id_perfil) VALUES (?, ?, ?, ?, 'Ativo', ?, ?)`,
        [nome, email, auth.hashPassword(d.senha), txt(d.cargo).slice(0, 100), dataISO(), Number(d.id_perfil)]
      );
      return this.publicUser(await this.getUserById(r.insertId, c));
    });
  }

  updateUser(id, d, ator) {
    return this.tx(async c => {
      const u = await this.getUserById(id, c);
      if (!u) throw erro('Funcionário não encontrado.', 404);
      if (d.nome !== undefined) {
        const nome = txt(d.nome);
        if (nome.length < 2 || nome.length > 150) throw erro('Informe o nome do funcionário (2 a 150 caracteres).');
        u.nome = nome;
      }
      if (d.email !== undefined) {
        const email = txt(d.email).toLowerCase();
        if (!EMAIL_RE.test(email)) throw erro('Informe um login (e-mail) válido.');
        const outro = await this.getUserByEmail(email, c);
        if (outro && outro.id_usuario !== u.id_usuario) throw erro('O login informado já está em uso. Informe outro identificador.');
        u.email = email;
      }
      if (d.cargo !== undefined) u.cargo = txt(d.cargo).slice(0, 100);
      if (d.id_perfil !== undefined && Number(d.id_perfil) !== u.id_perfil) {
        if (!(await this.perfilExiste(d.id_perfil, c))) throw erro('Selecione um perfil de acesso válido.');
        if (u.nome_perfil === 'Administrador' && u.status === 'Ativo' && !(await this.adminsAtivos(u.id_usuario, c))) {
          throw erro('Não é possível remover o perfil do único Administrador ativo.');
        }
        u.id_perfil = Number(d.id_perfil);
      }
      if (d.senha) {
        this.validarSenha(d.senha);
        u.senha = auth.hashPassword(d.senha);
        if (!ator || ator.id_usuario !== u.id_usuario) await c.query('DELETE FROM sessao WHERE id_usuario = ?', [u.id_usuario]);
      }
      await c.query('UPDATE usuario SET nome = ?, email = ?, cargo = ?, id_perfil = ?, senha = ? WHERE id_usuario = ?',
        [u.nome, u.email, u.cargo, u.id_perfil, u.senha, u.id_usuario]);
      return this.publicUser(await this.getUserById(u.id_usuario, c));
    });
  }

  setUserStatus(id, status, ator) {
    return this.tx(async c => {
      const u = await this.getUserById(id, c);
      if (!u) throw erro('Funcionário não encontrado.', 404);
      if (!['Ativo', 'Inativo'].includes(status)) throw erro('Situação inválida.');
      if (status === 'Inativo') {
        if (ator && ator.id_usuario === u.id_usuario) throw erro('Você não pode desativar o seu próprio acesso.');
        if (u.nome_perfil === 'Administrador' && !(await this.adminsAtivos(u.id_usuario, c))) {
          throw erro('Não é possível desativar o único Administrador ativo.');
        }
        await c.query('DELETE FROM sessao WHERE id_usuario = ?', [u.id_usuario]);
      }
      await c.query('UPDATE usuario SET status = ? WHERE id_usuario = ?', [status, u.id_usuario]);
      return this.publicUser({ ...u, status });
    });
  }

  // ---------------------------------------------------------------- produtos
  async getProducts(query, categoriaId, status = 'Ativo', tipo) {
    const where = [], params = [];
    if (TIPOS_PRODUTO.includes(tipo)) { where.push('tipo = ?'); params.push(tipo); }
    if (status === 'Inativo') where.push("status = 'Inativo'");
    else if (status !== 'todos') where.push("status <> 'Inativo'");
    if (categoriaId) { where.push('id_categoria = ?'); params.push(idNum(categoriaId)); }
    if (txt(query)) {
      where.push('(nome_produto LIKE ? OR codigo_barras LIKE ? OR descricao LIKE ?)');
      params.push(like(txt(query)), like(txt(query)), like(txt(query)));
    }
    const [rows] = await pool.query(`SELECT * FROM produto${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id_produto`, params);
    return rows.map(mapProduto);
  }

  // lock = true trava a linha até o fim da transação (evita duas vendas baixarem o mesmo saldo).
  async getProductById(id, c = pool, lock = false) {
    const [rows] = await c.query(`SELECT * FROM produto WHERE id_produto = ?${lock ? ' FOR UPDATE' : ''}`, [idNum(id)]);
    return mapProduto(rows[0]);
  }

  async validarProduto(data, existente, c) {
    const nome = txt(data.nome_produto);
    if (nome.length < 2 || nome.length > 200) throw erro('Informe o nome do produto (2 a 200 caracteres).');
    const tipo = txt(data.tipo) || (existente ? existente.tipo : 'Revenda');
    if (!TIPOS_PRODUTO.includes(tipo)) throw erro(`Tipo de produto inválido. Use: ${TIPOS_PRODUTO.join(', ')}.`);
    const unidadeCompra = txt(data.unidade_compra).slice(0, 20);
    const fator = unidadeCompra ? Number(data.fator_conversao) : 1;
    if (!Number.isFinite(fator) || fator <= 0) throw erro('Informe quantas unidades de estoque vêm em 1 unidade de compra (maior que zero).');
    // Insumo não tem preço de venda: o caixa não o vende, e os preços ficam iguais ao custo para atender aos CHECKs da tabela.
    if (tipo === 'Insumo') {
      const custoInsumo = Number(data.preco_custo);
      if (!Number.isFinite(custoInsumo) || custoInsumo < 0) throw erro('O preço de custo não pode ser negativo.');
      const p = r2(Math.max(custoInsumo, 0.01));
      data = { ...data, preco_venda: p, preco_min: p, preco_max: p };
    }
    const venda = Number(data.preco_venda);
    if (!Number.isFinite(venda) || venda <= 0) throw erro('O preço de venda deve ser maior que zero.');
    const vazio = v => v === '' || v === undefined || v === null;
    const custo = vazio(data.preco_custo) ? 0 : Number(data.preco_custo);
    if (!Number.isFinite(custo) || custo < 0) throw erro('O preço de custo não pode ser negativo.');
    const min = vazio(data.preco_min) ? r2(venda * 0.8) : Number(data.preco_min);
    const max = vazio(data.preco_max) ? r2(venda * 1.3) : Number(data.preco_max);
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max <= 0) throw erro('Os preços mínimo e máximo são inválidos.');
    if (min > venda || venda > max) throw erro('O preço de venda deve estar entre o preço mínimo e o preço máximo.');
    const emin = vazio(data.estoque_minimo) ? 10 : Number(data.estoque_minimo);
    if (!Number.isFinite(emin) || emin < 0) throw erro('O estoque mínimo deve ser um número maior ou igual a zero.');
    const qtd = vazio(data.quantidade_estoque) ? (existente ? existente.quantidade_estoque : 0) : Number(data.quantidade_estoque);
    if (!Number.isFinite(qtd) || qtd < 0) throw erro('O estoque atual não pode ser negativo.');
    const unidade = txt(data.unidade) || (existente ? existente.unidade : 'UN');
    if (!aceitaFracao(unidade) && !Number.isInteger(qtd)) throw erro(`Produtos em ${unidade} só aceitam estoque inteiro.`);
    if (!aceitaFracao(unidade) && !Number.isInteger(emin)) throw erro(`Produtos em ${unidade} só aceitam estoque mínimo inteiro.`);
    const cat = idNum(data.id_categoria);
    const [cats] = await c.query('SELECT 1 FROM categoria WHERE id_categoria = ?', [cat]);
    if (!cats.length) throw erro('Selecione uma categoria válida.');
    const descricao = validarTexto(data.descricao, 'A descrição do produto', { min: 10, max: 5000 });
    const validade = txt(data.validade);
    if (validade && !DATA_RE.test(validade)) throw erro('A data de validade é inválida.');
    return { nome, venda: r2(venda), custo: r2(custo), min: r2(min), max: r2(max), emin: r3(emin), qtd: r3(qtd), unidade, cat, descricao, validade,
      tipo, unidadeCompra: unidadeCompra || null, fator: r3(fator) };
  }

  async codigoEmUso(cod, excetoId, c) {
    const [rows] = await c.query('SELECT 1 FROM produto WHERE codigo_barras = ? AND id_produto <> ?', [cod, idNum(excetoId)]);
    return rows.length > 0;
  }

  saveProduct(data) {
    return this.tx(async c => {
      const existente = data.id_produto ? await this.getProductById(data.id_produto, c, true) : null;
      if (data.id_produto && !existente) throw erro('Produto não encontrado.', 404);
      const v = await this.validarProduto(data, existente, c);
      if (existente && existente.tipo === 'Produção' && v.tipo !== 'Produção' && await this.getFicha(existente.id_produto, c)) {
        throw erro(`"${existente.nome_produto}" tem ficha técnica. Exclua a ficha antes de mudar o tipo do produto.`);
      }
      let cod = txt(data.codigo_barras);
      if (cod && await this.codigoEmUso(cod, existente ? existente.id_produto : 0, c)) {
        throw erro(`O código "${cod}" já está cadastrado em outro produto.`);
      }
      const campos = {
        nome_produto: v.nome, descricao: v.descricao, unidade: v.unidade, peso: txt(data.peso),
        preco_custo: v.custo, preco_venda: v.venda, preco_min: v.min, preco_max: v.max, quantidade_estoque: v.qtd,
        estoque_minimo: v.emin, id_categoria: v.cat, lote: txt(data.lote), validade: v.validade || null,
        tipo: v.tipo, unidade_compra: v.unidadeCompra, fator_conversao: v.fator
      };
      if (data.imagem !== undefined) campos.imagem = txt(data.imagem);
      if (existente) {
        if (cod) campos.codigo_barras = cod;
        if (!campos.lote) campos.lote = existente.lote || '-';
        await c.query('UPDATE produto SET ? WHERE id_produto = ?', [campos, existente.id_produto]);
        return this.getProductById(existente.id_produto, c);
      }
      if (!campos.lote) campos.lote = `L-${Math.floor(100000 + Math.random() * 900000)}`;
      // Sem código informado: grava um provisório e depois gera 789100 + id (como na versão anterior).
      const [r] = await c.query('INSERT INTO produto SET ?', [{ ...campos, codigo_barras: cod || `TMP-${auth.newToken().slice(0, 16)}`, status: 'Ativo', imagem: campos.imagem || '' }]);
      if (!cod) {
        cod = `789100${String(r.insertId).padStart(2, '0')}`;
        while (await this.codigoEmUso(cod, r.insertId, c)) cod += '1';
        await c.query('UPDATE produto SET codigo_barras = ? WHERE id_produto = ?', [cod, r.insertId]);
      }
      return this.getProductById(r.insertId, c);
    });
  }

  setProductStatus(id, status) {
    return this.tx(async c => {
      const p = await this.getProductById(id, c, true);
      if (!p) throw erro('Produto não encontrado.', 404);
      if (!['Ativo', 'Inativo'].includes(status)) throw erro('Situação inválida.');
      if (p.status === status) throw erro(status === 'Inativo' ? 'Este produto já está inativo.' : 'Este produto já está ativo.');
      await c.query('UPDATE produto SET status = ? WHERE id_produto = ?', [status, p.id_produto]);
      return { ...p, status };
    });
  }

  // ---------------------------------------------------------------- alertas de estoque (RF 11)
  // Abre alerta para produto ativo no mínimo ou abaixo; resolve os que voltaram ao normal.
  async sincronizarAlertas(c = pool) {
    await c.query(
      `INSERT INTO alerta_estoque (data_alerta, mensagem, status_alerta, id_produto)
       SELECT ?, CONCAT('Atenção: ', p.nome_produto, ' atingiu o estoque mínimo'), 'Ativo', p.id_produto
       FROM produto p
       WHERE p.status = 'Ativo' AND p.quantidade_estoque <= p.estoque_minimo
         AND NOT EXISTS (SELECT 1 FROM alerta_estoque a WHERE a.id_produto = p.id_produto AND a.status_alerta = 'Ativo')`,
      [dataHora()]
    );
    await c.query(
      `UPDATE alerta_estoque a JOIN produto p ON p.id_produto = a.id_produto
       SET a.status_alerta = 'Resolvido'
       WHERE a.status_alerta = 'Ativo' AND NOT (p.status = 'Ativo' AND p.quantidade_estoque <= p.estoque_minimo)`
    );
  }

  async getAlertasCriticos() {
    const [rows] = await pool.query(
      `SELECT a.id_alerta, a.data_alerta, a.mensagem, p.id_produto, p.nome_produto, p.unidade, p.quantidade_estoque,
              p.estoque_minimo, p.lote, p.id_categoria AS categoria_id
       FROM alerta_estoque a JOIN produto p ON p.id_produto = a.id_produto
       WHERE a.status_alerta = 'Ativo' ORDER BY a.id_alerta`
    );
    return rows.map(a => ({ ...a, lote: a.lote || '', data_alerta: hm(a.data_alerta) }));
  }

  // ---------------------------------------------------------------- alerta de validade
  // Produtos ativos, com saldo, vencidos ou que vencem em até N dias (N vem das configurações).
  async getValidades(c = pool) {
    const { diasAlertaValidade: dias } = await this.getSettings(c);
    const hoje = dataISO();
    const [rows] = await c.query(
      `SELECT p.id_produto, p.nome_produto, p.codigo_barras, p.unidade, p.lote, p.validade, p.quantidade_estoque, p.preco_custo,
              c.nome_categoria AS categoria, DATEDIFF(p.validade, ?) AS dias_restantes
       FROM produto p JOIN categoria c ON c.id_categoria = p.id_categoria
       WHERE p.status = 'Ativo' AND p.validade IS NOT NULL AND p.quantidade_estoque > 0 AND p.validade <= ?
       ORDER BY p.validade, p.nome_produto`, [hoje, dataISO(deslocar(dias))]);
    const itens = rows.map(p => {
      const d = Number(p.dias_restantes);
      return {
        ...p, lote: p.lote || '', dias_restantes: d, valor_em_risco: r2(p.quantidade_estoque * p.preco_custo),
        situacao: d < 0 ? 'Vencido' : d === 0 ? 'Vence hoje' : 'Vencendo'
      };
    });
    return { dias, hoje, vencidos: itens.filter(i => i.dias_restantes < 0).length, itens };
  }

  // ---------------------------------------------------------------- dashboard (RF 10)
  // As consultas são independentes e rodam em paralelo (cada uma pega uma conexão do pool).
  // Somas e contagens são feitas pelo MySQL; datas filtradas por intervalo para usar os índices.
  async getDashboardData(usuario) {
    const hoje = dataISO();
    const amanha = dataISO(deslocar(1));
    const semanaInicio = dataISO(deslocar(-6));
    const [[[est]], [porCategoria], alertas, validades, [[vh]], [[ra]], [semana], ultimasCompras] = await Promise.all([
      pool.query("SELECT COUNT(*) AS n, COALESCE(SUM(quantidade_estoque), 0) AS total FROM produto WHERE status = 'Ativo'"),
      pool.query(
        `SELECT c.nome_categoria AS categoria, SUM(p.quantidade_estoque) AS total
         FROM produto p JOIN categoria c ON c.id_categoria = p.id_categoria
         WHERE p.status = 'Ativo' GROUP BY c.id_categoria, c.nome_categoria HAVING total > 0 ORDER BY c.id_categoria`),
      this.getAlertasCriticos(),
      this.getValidades(),
      pool.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(valor_total), 0) AS total FROM venda
         WHERE status_venda = 'Concluída' AND data_venda >= ? AND data_venda < ?`, [hoje, amanha]),
      pool.query('SELECT COUNT(*) AS n FROM requisicao WHERE situacao IN (?)', [SITUACOES_ABERTAS]),
      pool.query(
        `SELECT DATE_FORMAT(data_venda, '%Y-%m-%d') AS dia, COUNT(*) AS vendas, SUM(valor_total) AS total FROM venda
         WHERE status_venda = 'Concluída' AND data_venda >= ? AND data_venda < ? GROUP BY dia ORDER BY dia`, [semanaInicio, amanha]),
      this.listRequisicoes({ limite: 6 })
    ]);
    const totalEmEstoque = Number(est.total);
    const faturamentoHoje = Number(vh.total), vendasHoje = Number(vh.n);
    // Últimos 7 dias, inclusive os dias sem venda (gráfico do painel).
    const porDia = new Map(semana.map(d => [d.dia, d]));
    const vendasSemana = Array.from({ length: 7 }, (_, i) => {
      const dia = dataISO(deslocar(i - 6));
      const d = porDia.get(dia);
      return { dia, vendas: d ? Number(d.vendas) : 0, total: d ? r2(d.total) : 0 };
    });
    return {
      usuarioAtivo: usuario && usuario.perfil !== undefined ? usuario : this.publicUser(usuario),
      metricas: {
        totalProdutos: Number(est.n),
        alertasCriticosCount: alertas.length,
        totalItensEstoque: r3(totalEmEstoque),
        requisicoesAbertasCount: Number(ra.n),
        totalVendasHoje: r2(faturamentoHoje).toFixed(2),
        vendasHojeCount: vendasHoje,
        ticketMedioHoje: vendasHoje ? r2(faturamentoHoje / vendasHoje).toFixed(2) : '0.00',
        produtosVencendoCount: validades.itens.length,
        produtosVencidosCount: validades.vencidos
      },
      alertas,
      validades,
      ultimasCompras,
      vendasSemana,
      distribuicaoEstoque: porCategoria.map(i => ({
        categoria: i.categoria, quantidade: r3(i.total),
        porcentagem: totalEmEstoque > 0 ? ((Number(i.total) / totalEmEstoque) * 100).toFixed(1) : '0'
      }))
    };
  }

  // ---------------------------------------------------------------- requisições de compra (RF 05)
  async montarRequisicoes(rows, c = pool) {
    if (!rows.length) return [];
    const [hist] = await c.query(
      `SELECT h.id_requisicao, h.data_registro, h.situacao, u.nome AS usuario
       FROM requisicao_historico h LEFT JOIN usuario u ON u.id_usuario = h.id_usuario
       WHERE h.id_requisicao IN (?) ORDER BY h.id_historico`, [rows.map(r => r.id_requisicao)]);
    const porReq = new Map(rows.map(r => [r.id_requisicao, []]));
    hist.forEach(h => porReq.get(h.id_requisicao).push({ data: hm(h.data_registro), situacao: h.situacao, usuario: h.usuario || '-' }));
    return rows.map(r => {
      const { id_fornecedor, numero_pedido, ...resto } = r;
      return { ...resto, observacao: r.observacao || '', historico: porReq.get(r.id_requisicao) };
    });
  }

  // Sem `limite` devolve tudo (como antes); com `limite`/`offset` devolve só a página pedida.
  async listRequisicoes({ limite, offset } = {}) {
    const [rows] = await pool.query(`${SQL_REQ} ORDER BY r.id_requisicao DESC${paginar(limite, offset)}`);
    return this.montarRequisicoes(rows);
  }

  async contarRequisicoes() {
    const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM requisicao');
    return { total: Number(r.n) };
  }

  async getRequisicao(id, c = pool, lock = false) {
    const [rows] = await c.query(`${SQL_REQ} WHERE r.id_requisicao = ?${lock ? ' FOR UPDATE' : ''}`, [idNum(id)]);
    return (await this.montarRequisicoes(rows, c))[0];
  }

  async registrarHistorico(c, idReq, situacao, ator) {
    await c.query('INSERT INTO requisicao_historico (id_requisicao, data_registro, situacao, id_usuario) VALUES (?, ?, ?, ?)',
      [idReq, dataHora(), situacao, ator ? ator.id_usuario : null]);
  }

  createRequisicao(data, ator) {
    return this.tx(async c => {
      const [forn] = await c.query('SELECT id_fornecedor FROM fornecedor WHERE nome = ?', [txt(data.fornecedor)]);
      if (!data.fornecedor || !forn.length) throw erro('Selecione um fornecedor da lista.');
      const prod = data.id_produto ? await this.getProductById(data.id_produto, c) : null;
      if (data.id_produto && !prod) throw erro('Produto não encontrado.', 404);
      const nomeProd = prod ? prod.nome_produto : txt(data.produto_nome);
      if (!nomeProd) throw erro('O nome do produto é obrigatório.');
      const qtd = Number(data.quantidade_pedida);
      if (!Number.isFinite(qtd) || qtd <= 0) throw erro('A quantidade pedida deve ser maior que zero.');
      const un = prod ? prod.unidade : (txt(data.unidade) || 'UN');
      if (!aceitaFracao(un) && !Number.isInteger(qtd)) throw erro(`A unidade ${un} só aceita quantidades inteiras.`);
      const vu = data.valor_unitario === '' || data.valor_unitario === undefined ? (prod ? prod.preco_custo : 0) : Number(data.valor_unitario);
      if (!Number.isFinite(vu) || vu < 0) throw erro('O preço unitário é inválido.');
      const prev = txt(data.previsao_entrega) || dataISO(deslocar(4));
      if (!DATA_RE.test(prev) || prev < dataISO()) throw erro('A previsão de entrega deve ser uma data a partir de hoje.');
      const obs = validarTexto(data.observacao, 'A observação da requisição', { min: 10, max: 5000 });
      gateways.comunicarFornecedor('PEDIDO', data, await this.getSettings(c));
      // Código = maior número existente + 1 (não depende do id, que pode pular).
      // numero_pedido é calculado e indexado pelo banco: o MAX sai do índice e trava só o fim dele.
      const [[mx]] = await c.query('SELECT COALESCE(MAX(numero_pedido), 9660) AS n FROM requisicao FOR UPDATE');
      const [r] = await c.query(
        `INSERT INTO requisicao (codigo_pedido, id_fornecedor, id_produto, produto_nome, quantidade_pedida, quantidade_atendida, unidade,
           valor_unitario, valor_total, situacao, data_pedido, previsao_entrega, endereco_entrega, observacao)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'Em Aberto', ?, ?, ?, ?)`,
        [`REQ-${Number(mx.n) + 1}`, forn[0].id_fornecedor, prod ? prod.id_produto : null, nomeProd, r3(qtd), un, r2(vu), r2(qtd * vu),
          dataISO(), prev, txt(data.endereco_entrega) || 'Padrão - Padaria Nova York', obs]
      );
      await this.registrarHistorico(c, r.insertId, 'Em Aberto', ator);
      return this.getRequisicao(r.insertId, c);
    });
  }

  updateRequisicaoStatus(id, body, ator) {
    return this.tx(async c => {
      const req = await this.getRequisicao(id, c, true);
      if (!req) throw erro('Requisição não encontrada.', 404);
      const nova = body.situacao;
      if (!['Cotado', 'AF Gerada', 'Cancelado', 'Finalizado'].includes(nova)) throw erro('Situação inválida.');
      if (!SITUACOES_ABERTAS.includes(req.situacao)) throw erro(`A requisição já está "${req.situacao}" e não pode mais ser alterada.`);
      const idr = req.id_requisicao;
      let parcial = false;

      if (nova === 'Cotado') {
        if (req.situacao !== 'Em Aberto') throw erro('Somente requisições em aberto podem ser cotadas.');
        await c.query("UPDATE requisicao SET situacao = 'Cotado' WHERE id_requisicao = ?", [idr]);
        await this.registrarHistorico(c, idr, 'Cotado', ator);
      } else if (nova === 'AF Gerada') {
        if (req.situacao === 'AF Gerada') throw erro('A Autorização de Fornecimento já foi gerada.');
        await c.query("UPDATE requisicao SET situacao = 'AF Gerada' WHERE id_requisicao = ?", [idr]);
        await this.registrarHistorico(c, idr, 'AF Gerada', ator);
      } else if (nova === 'Cancelado') {
        const just = validarTexto(body.justificativa, 'O motivo do cancelamento', { obrigatorio: true });
        gateways.comunicarFornecedor('CANCELAMENTO', req, await this.getSettings(c));
        await c.query("UPDATE requisicao SET situacao = 'Cancelado', justificativa_cancelamento = ? WHERE id_requisicao = ?", [just, idr]);
        await this.registrarHistorico(c, idr, 'Cancelado', ator);
      } else {
        const restante = r3(req.quantidade_pedida - req.quantidade_atendida);
        const recebida = body.quantidade_recebida === undefined || body.quantidade_recebida === '' ? restante : Number(body.quantidade_recebida);
        if (!Number.isFinite(recebida) || recebida <= 0) throw erro('Informe a quantidade recebida (maior que zero).');
        if (recebida > restante) throw erro(`A quantidade recebida (${recebida}) excede o saldo pendente do pedido (${restante}).`);
        if (!aceitaFracao(req.unidade) && !Number.isInteger(recebida)) throw erro(`A unidade ${req.unidade} só aceita quantidades inteiras.`);
        const prod = req.id_produto ? await this.getProductById(req.id_produto, c, true) : null;
        if (prod) {
          await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [r3(prod.quantidade_estoque + recebida), prod.id_produto]);
          await this.addMovimentacao(c, {
            tipo_movimentacao: 'Entrada', quantidade: recebida, origem: 'requisicao',
            observacao: `Entrada automática por recebimento da requisição ${req.codigo_pedido} (${req.fornecedor})`,
            valor_unitario: req.valor_unitario
          }, prod, ator);
        }
        const atendida = r3(req.quantidade_atendida + recebida);
        const fim = atendida >= req.quantidade_pedida;
        await c.query('UPDATE requisicao SET quantidade_atendida = ?, situacao = ? WHERE id_requisicao = ?',
          [atendida, fim ? 'Finalizado' : req.situacao, idr]);
        await this.registrarHistorico(c, idr, fim ? 'Finalizado' : `Recebimento parcial (${recebida} ${req.unidade})`, ator);
        parcial = !fim;
      }
      return { ...(await this.getRequisicao(idr, c)), parcial };
    });
  }

  // ---------------------------------------------------------------- movimentações de estoque (RF 04)
  // Grava a movimentação; quem chama já atualizou o saldo do produto na mesma transação.
  async addMovimentacao(c, data, prod, ator) {
    const vu = data.valor_unitario !== undefined ? Number(data.valor_unitario) : (data.tipo_movimentacao === 'Saída' ? prod.preco_venda : prod.preco_custo);
    const quando = dataHora();
    const [r] = await c.query(
      `INSERT INTO movimentacao_estoque (tipo_movimentacao, quantidade, data_movimentacao, observacao, origem, motivo_perda, valor_unitario, id_produto, id_usuario, id_producao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.tipo_movimentacao, r3(data.quantidade), quando, data.observacao || '', data.origem || 'manual', data.motivo_perda || null, r2(vu), prod.id_produto, ator ? ator.id_usuario : null, data.id_producao || null]
    );
    return mapMov({
      id_movimentacao: r.insertId, tipo_movimentacao: data.tipo_movimentacao, quantidade: r3(data.quantidade), data_movimentacao: quando,
      observacao: data.observacao, id_produto: prod.id_produto, produto_nome: prod.nome_produto, codigo_barras: prod.codigo_barras,
      unidade: prod.unidade, valor_unitario: r2(vu), id_usuario: ator ? ator.id_usuario : null, usuario_nome: ator ? ator.nome : null,
      origem: data.origem || 'manual', motivo_perda: data.motivo_perda
    });
  }

  // Registra uma ou várias movimentações de uma só vez (individual ou em lote).
  registrarMovimentacoes(body, ator) {
    return this.tx(async c => {
      const tipo = body.tipo_movimentacao;
      if (!['Entrada', 'Saída'].includes(tipo)) throw erro('Tipo de movimentação inválido.');
      const obs = validarTexto(body.observacao, 'O motivo da movimentação', { obrigatorio: true });
      return this.movimentarItens(c, tipo, body, () => ({ observacao: obs }), ator);
    });
  }

  // Perda/sobra: saída de estoque com motivo, valorizada pelo preço de custo (o que a padaria perdeu).
  registrarPerdas(body, ator) {
    return this.tx(async c => {
      const motivo = body.motivo_perda;
      if (!MOTIVOS_PERDA.includes(motivo)) throw erro(`Informe o motivo da perda: ${MOTIVOS_PERDA.join(', ')}.`);
      const obs = validarTexto(body.observacao, 'A observação', { obrigatorio: motivo === 'Outro' });
      return this.movimentarItens(c, 'Saída', body,
        prod => ({ observacao: obs, origem: 'perda', motivo_perda: motivo, valor_unitario: prod.preco_custo }), ator);
    });
  }

  // Valida os itens (somando produtos repetidos), atualiza o saldo e grava uma movimentação por produto.
  // `extra(prod)` devolve os campos próprios da movimentação (observação, origem, motivo, valor).
  async movimentarItens(c, tipo, body, extra, ator) {
    const itens = Array.isArray(body.itens) ? body.itens : [{ id_produto: body.id_produto, quantidade: body.quantidade }];
    if (!itens.length) throw erro('Informe ao menos um item.');
    const acumulado = new Map();
    for (const it of itens) {
      const prod = await this.getProductById(it.id_produto, c, true);
      if (!prod) throw erro('Produto não cadastrado.', 404);
      // Entrada informada na unidade de compra (ex.: 3 sacos de 25 kg = 75 KG no estoque).
      let informado = it.quantidade;
      if (it.em_unidade_compra && tipo === 'Entrada') {
        if (!prod.unidade_compra) throw erro(`"${prod.nome_produto}" não tem unidade de compra cadastrada.`);
        const n = Number(it.quantidade);
        if (!Number.isFinite(n) || n <= 0) throw erro('A quantidade deve ser maior que zero.');
        informado = r3(n * prod.fator_conversao);
      }
      const q = validarQuantidade(prod, informado);
      const a = acumulado.get(prod.id_produto) || { prod, qtd: 0 };
      a.qtd = r3(a.qtd + q);
      acumulado.set(prod.id_produto, a);
    }
    const movs = [];
    for (const { prod, qtd } of acumulado.values()) {
      if (tipo === 'Saída' && prod.quantidade_estoque < qtd) {
        throw erro(`Estoque insuficiente de "${prod.nome_produto}"! Saldo disponível: ${prod.quantidade_estoque} ${prod.unidade}.`);
      }
      const saldo = r3(tipo === 'Saída' ? prod.quantidade_estoque - qtd : prod.quantidade_estoque + qtd);
      await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [saldo, prod.id_produto]);
      movs.push(await this.addMovimentacao(c, { tipo_movimentacao: tipo, quantidade: qtd, ...extra(prod) }, prod, ator));
    }
    return movs;
  }

  filtroMovimentacoes({ tipo, from, to }) {
    const where = [], params = [];
    if (tipo) { where.push('m.tipo_movimentacao = ?'); params.push(tipo); }
    if (from) { where.push('m.data_movimentacao >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('m.data_movimentacao <= ?'); params.push(`${to} 23:59:59`); }
    return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
  }

  // Sem `limite` devolve tudo (como antes); com `limite`/`offset` devolve só a página pedida.
  async getMovimentacoes({ tipo, from, to, limite, offset } = {}) {
    const f = this.filtroMovimentacoes({ tipo, from, to });
    const [rows] = await pool.query(listagem(SQL_MOV, 'movimentacao_estoque m', f.sql, 'm.id_movimentacao DESC', paginar(limite, offset)), f.params);
    return rows.map(mapMov);
  }

  // Total de registros e valor somado de TODO o filtro (não só da página), para o resumo da tela.
  async contarMovimentacoes(filtros = {}) {
    const f = this.filtroMovimentacoes(filtros);
    // Sem período, somar o histórico inteiro lendo a tabela em sequência é ~3x mais rápido que pelo índice
    // de tipo (que buscaria linha a linha). Com período, o índice vence. Medido no teste de carga.
    const dica = filtros.from || filtros.to ? '' : ' IGNORE INDEX (idx_mov_tipo_data)';
    const [[r]] = await pool.query(`SELECT COUNT(*) AS n, COALESCE(SUM(m.quantidade * m.valor_unitario), 0) AS valor FROM movimentacao_estoque m${dica}${f.sql}`, f.params);
    return { total: Number(r.n), valorTotal: r2(r.valor) };
  }

  // ---------------------------------------------------------------- vendas (RF 07, 08, 09)
  resolverDesconto(subtotal, d, ator, cfg) {
    const tipo = d.desconto_tipo === 'percentual' ? 'percentual' : 'valor';
    const bruto = d.desconto === '' || d.desconto === undefined || d.desconto === null ? 0 : Number(d.desconto);
    if (!Number.isFinite(bruto) || bruto < 0) throw erro('O desconto informado é inválido.');
    if (tipo === 'percentual' && bruto > 100) throw erro('O desconto percentual não pode passar de 100%.');
    const valor = tipo === 'percentual' ? r2(subtotal * bruto / 100) : r2(bruto);
    if (valor > subtotal) throw erro('O desconto não pode ser maior que o subtotal da venda.');
    const max = cfg.descontoMaximoPercent;
    const admin = ator && ator.perfil === 'Administrador';
    if (!admin && subtotal > 0 && (valor / subtotal) * 100 > max + 1e-9) {
      throw erro(`Desconto acima do limite permitido (${max}% do subtotal).`);
    }
    return { tipo, valor };
  }

  async itensDasVendas(ids, c = pool) {
    if (!ids.length) return new Map();
    const [rows] = await c.query(
      `SELECT i.id_item_venda, i.id_venda, i.id_produto, p.nome_produto, p.unidade, i.quantidade, i.valor_unitario, i.subtotal
       FROM item_venda i JOIN produto p ON p.id_produto = i.id_produto WHERE i.id_venda IN (?) ORDER BY i.id_item_venda`, [ids]);
    const mapa = new Map(ids.map(id => [id, []]));
    rows.forEach(({ id_venda, ...i }) => mapa.get(id_venda).push(i));
    return mapa;
  }

  async getVenda(id, c = pool, lock = false) {
    const [rows] = await c.query(`${SQL_VENDA} WHERE v.id_venda = ?${lock ? ' FOR UPDATE' : ''}`, [idNum(id)]);
    if (!rows[0]) return undefined;
    const itens = await this.itensDasVendas([rows[0].id_venda], c);
    return mapVenda(rows[0], itens.get(rows[0].id_venda));
  }

  // O filtro usa só colunas de `venda`: vendedor e produto viram subconsultas não correlacionadas
  // (calculadas uma vez), e o MySQL percorre a chave primária em ordem decrescente parando no LIMIT.
  filtroVendas({ from, to, q, status }) {
    const where = [], params = [];
    if (from) { where.push('v.data_venda >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('v.data_venda <= ?'); params.push(`${to} 23:59:59`); }
    if (status) { where.push('v.status_venda = ?'); params.push(status); }
    if (txt(q)) {
      const t = like(txt(q));
      where.push(`(v.codigo_venda LIKE ? OR v.forma_pagamento LIKE ?
        OR v.id_usuario IN (SELECT id_usuario FROM usuario WHERE nome LIKE ?)
        OR v.id_venda IN (SELECT i.id_venda FROM item_venda i JOIN produto p ON p.id_produto = i.id_produto WHERE p.nome_produto LIKE ?))`);
      params.push(t, t, t, t);
    }
    return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
  }

  // Sem `limite` devolve tudo (como antes); com `limite`/`offset` devolve só a página pedida.
  async getVendas({ from, to, q, status, limite, offset } = {}) {
    const f = this.filtroVendas({ from, to, q, status });
    const [rows] = await pool.query(listagem(SQL_VENDA, 'venda v', f.sql, 'v.id_venda DESC', paginar(limite, offset)), f.params);
    const itens = await this.itensDasVendas(rows.map(v => v.id_venda));
    return rows.map(v => mapVenda(v, itens.get(v.id_venda)));
  }

  // Total de vendas e faturamento (só as concluídas) de TODO o filtro, para o resumo da tela.
  async contarVendas(filtros = {}) {
    const f = this.filtroVendas(filtros);
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(IF(v.status_venda = 'Concluída', v.valor_total, 0)), 0) AS fat FROM venda v${f.sql}`, f.params);
    return { total: Number(r.n), faturamento: r2(r.fat) };
  }

  async gravarItensVenda(c, idVenda, itens) {
    if (!itens.length) return;
    await c.query('INSERT INTO item_venda (id_venda, id_produto, quantidade, valor_unitario, subtotal) VALUES ?',
      [itens.map(i => [idVenda, i.id_produto, i.quantidade, i.valor_unitario, i.subtotal])]);
  }

  realizarVenda(data, ator) {
    return this.tx(async c => {
      const itens = Array.isArray(data.itens) ? data.itens : [];
      if (!itens.length) throw erro('Nenhum item inserido na venda.');
      const forma = data.forma_pagamento || 'Dinheiro';
      if (!FORMAS_PAGAMENTO.includes(forma)) throw erro('Forma de pagamento inválida.');
      const cfg = await this.getSettings(c);

      const produtos = new Map();
      const linhas = new Map();
      for (const it of itens) {
        const prod = produtos.get(idNum(it.id_produto)) || await this.getProductById(it.id_produto, c, true);
        if (!prod) throw erro('Produto não cadastrado.', 404);
        produtos.set(prod.id_produto, prod);
        if (prod.status !== 'Ativo') throw erro(`"${prod.nome_produto}" está inativo e não pode ser vendido.`);
        if (prod.tipo === 'Insumo') throw erro(`"${prod.nome_produto}" é insumo de produção e não é vendido no caixa.`);
        const q = validarQuantidade(prod, it.quantidade);
        const preco = it.valor_unitario === undefined || it.valor_unitario === '' ? prod.preco_venda : Number(it.valor_unitario);
        if (!Number.isFinite(preco) || preco <= 0) throw erro('Preço unitário inválido.');
        if (preco < prod.preco_min || preco > prod.preco_max) {
          throw erro(`O preço de "${prod.nome_produto}" deve ficar entre R$ ${prod.preco_min.toFixed(2)} e R$ ${prod.preco_max.toFixed(2)}.`);
        }
        const chave = `${prod.id_produto}|${preco}`;
        const l = linhas.get(chave) || { prod, preco: r2(preco), qtd: 0 };
        l.qtd = r3(l.qtd + q);
        linhas.set(chave, l);
      }
      const totalPorProduto = new Map();
      for (const l of linhas.values()) totalPorProduto.set(l.prod.id_produto, r3((totalPorProduto.get(l.prod.id_produto) || 0) + l.qtd));
      for (const [idp, q] of totalPorProduto) {
        const p = produtos.get(idp);
        if (p.quantidade_estoque < q) throw erro(`Quantidade indisponível em estoque para "${p.nome_produto}"! Solicitado: ${q}, em estoque: ${p.quantidade_estoque} ${p.unidade}.`);
      }

      const itensProc = [];
      let subtotal = 0;
      for (const l of linhas.values()) {
        const sub = r2(l.qtd * l.preco);
        subtotal = r2(subtotal + sub);
        itensProc.push({ id_produto: l.prod.id_produto, nome_produto: l.prod.nome_produto, unidade: l.prod.unidade, quantidade: l.qtd, valor_unitario: l.preco, subtotal: sub });
      }
      const desc = this.resolverDesconto(subtotal, data, ator, cfg);
      const total = r2(subtotal - desc.valor);

      let recebido = null, troco = null;
      if (forma === 'Dinheiro' && data.valor_recebido !== undefined && data.valor_recebido !== '' && data.valor_recebido !== null) {
        recebido = Number(data.valor_recebido);
        if (!Number.isFinite(recebido) || recebido < total) throw erro('O valor recebido é menor que o total da venda.');
        troco = r2(recebido - total);
      }
      const aut = gateways.autorizarPagamento(forma, total, cfg);

      // Código provisório; depois vira VENDA-(1000 + id), como na versão anterior.
      const [r] = await c.query(
        `INSERT INTO venda (codigo_venda, data_venda, valor_subtotal, desconto, desconto_tipo, desconto_informado, valor_total,
           forma_pagamento, valor_recebido, troco, nsu, status_venda, id_usuario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Concluída', ?)`,
        [`TMP-${auth.newToken().slice(0, 12)}`, dataHora(), subtotal, desc.valor, desc.tipo, Number(data.desconto) || 0, total, forma,
          recebido, troco, forma.startsWith('Cartão') ? aut.nsu : null, ator.id_usuario]
      );
      const codigo = `VENDA-${1000 + r.insertId}`;
      await c.query('UPDATE venda SET codigo_venda = ? WHERE id_venda = ?', [codigo, r.insertId]);
      await this.gravarItensVenda(c, r.insertId, itensProc);

      for (const [idp, q] of totalPorProduto) {
        const p = produtos.get(idp);
        await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [r3(p.quantidade_estoque - q), idp]);
      }
      for (const it of itensProc) {
        await this.addMovimentacao(c, { tipo_movimentacao: 'Saída', quantidade: it.quantidade, origem: 'venda', observacao: `Baixa automática da ${codigo}`, valor_unitario: it.valor_unitario }, produtos.get(it.id_produto), ator);
      }
      return this.getVenda(r.insertId, c);
    });
  }

  async estornarItensVenda(c, venda, ator, motivo) {
    for (const item of venda.itens) {
      const p = await this.getProductById(item.id_produto, c, true);
      if (!p) continue;
      await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [r3(p.quantidade_estoque + item.quantidade), p.id_produto]);
      await this.addMovimentacao(c, { tipo_movimentacao: 'Entrada', quantidade: item.quantidade, origem: 'estorno', observacao: `${motivo} (${venda.codigo_venda})`, valor_unitario: item.valor_unitario }, p, ator);
    }
  }

  cancelarVenda(id, body, ator, autorizador) {
    return this.tx(async c => {
      const venda = await this.getVenda(id, c, true);
      if (!venda) throw erro('Venda não encontrada.', 404);
      if (venda.status_venda === 'Cancelada') throw erro('Esta venda já está cancelada.');
      const motivo = validarTexto(body.motivo, 'O motivo do cancelamento', { obrigatorio: true });
      await this.estornarItensVenda(c, venda, ator, 'Estorno de estoque por cancelamento');
      await c.query(
        `UPDATE venda SET status_venda = 'Cancelada', motivo_cancelamento = ?, cancelada_por = ?, autorizada_por = ?, data_cancelamento = ?
         WHERE id_venda = ?`,
        [motivo, ator.id_usuario, autorizador ? autorizador.id_usuario : ator.id_usuario, dataHora(), venda.id_venda]
      );
      return this.getVenda(venda.id_venda, c);
    });
  }

  editarVenda(id, body, ator) {
    return this.tx(async c => {
      const venda = await this.getVenda(id, c, true);
      if (!venda) throw erro('Venda não encontrada.', 404);
      if (venda.status_venda !== 'Concluída') throw erro('Somente vendas concluídas podem ser editadas.');
      const novos = Array.isArray(body.itens) ? body.itens : [];
      const produtos = new Map();
      const quantidades = new Map();
      for (const it of novos) {
        const prod = produtos.get(idNum(it.id_produto)) || await this.getProductById(it.id_produto, c, true);
        if (!prod) throw erro('Produto não cadastrado.', 404);
        produtos.set(prod.id_produto, prod);
        quantidades.set(prod.id_produto, r3((quantidades.get(prod.id_produto) || 0) + validarQuantidade(prod, it.quantidade)));
      }
      if (!quantidades.size) throw erro('A venda precisa ter ao menos um item. Para anulá-la, use o cancelamento.');
      const antigas = new Map();
      venda.itens.forEach(i => antigas.set(i.id_produto, r3((antigas.get(i.id_produto) || 0) + i.quantidade)));
      const ids = new Set([...antigas.keys(), ...quantidades.keys()]);
      for (const idp of ids) {
        if (!produtos.has(idp)) produtos.set(idp, await this.getProductById(idp, c, true));
        const diff = r3((quantidades.get(idp) || 0) - (antigas.get(idp) || 0));
        const p = produtos.get(idp);
        if (diff > 0 && p.quantidade_estoque < diff) throw erro(`Quantidade indisponível em estoque para "${p.nome_produto}"! Disponível para acréscimo: ${p.quantidade_estoque} ${p.unidade}.`);
      }
      const itensNovos = [];
      for (const [idp, q] of quantidades) {
        const p = produtos.get(idp);
        const anterior = venda.itens.find(i => i.id_produto === idp);
        const preco = anterior ? anterior.valor_unitario : p.preco_venda;
        itensNovos.push({ id_produto: idp, nome_produto: p.nome_produto, unidade: p.unidade, quantidade: q, valor_unitario: preco, subtotal: r2(q * preco) });
      }
      for (const idp of ids) {
        const diff = r3((quantidades.get(idp) || 0) - (antigas.get(idp) || 0));
        if (diff === 0) continue;
        const p = produtos.get(idp);
        await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [r3(p.quantidade_estoque - diff), idp]);
        await this.addMovimentacao(c, {
          tipo_movimentacao: diff > 0 ? 'Saída' : 'Entrada', quantidade: Math.abs(diff), origem: 'ajuste',
          observacao: `Ajuste por edição da ${venda.codigo_venda}`,
          valor_unitario: (itensNovos.find(i => i.id_produto === idp) || venda.itens.find(i => i.id_produto === idp)).valor_unitario
        }, p, ator);
      }
      const subtotal = r2(itensNovos.reduce((a, i) => a + i.subtotal, 0));
      const desc = this.resolverDesconto(subtotal, { desconto_tipo: venda.desconto_tipo, desconto: venda.desconto_tipo === 'percentual' ? venda.desconto_informado : Math.min(venda.desconto, subtotal) }, ator, await this.getSettings(c));
      await c.query('DELETE FROM item_venda WHERE id_venda = ?', [venda.id_venda]);
      await this.gravarItensVenda(c, venda.id_venda, itensNovos);
      await c.query('UPDATE venda SET valor_subtotal = ?, desconto = ?, valor_total = ?, editada_por = ?, data_edicao = ? WHERE id_venda = ?',
        [subtotal, desc.valor, r2(subtotal - desc.valor), ator.id_usuario, dataHora(), venda.id_venda]);
      return this.getVenda(venda.id_venda, c);
    });
  }

  excluirVenda(id, ator) {
    return this.tx(async c => {
      const venda = await this.getVenda(id, c, true);
      if (!venda) throw erro('Venda não encontrada.', 404);
      if (venda.status_venda === 'Concluída') await this.estornarItensVenda(c, venda, ator, 'Estorno de estoque por exclusão');
      await c.query('DELETE FROM venda WHERE id_venda = ?', [venda.id_venda]);
      return venda;
    });
  }

  // ---------------------------------------------------------------- conferência de inventário (RF 06)
  async listConferencias() {
    const [confs] = await pool.query(
      `SELECT c.*, u.nome AS responsavel FROM conferencia c JOIN usuario u ON u.id_usuario = c.id_usuario ORDER BY c.id_conferencia DESC`);
    if (!confs.length) return [];
    const [itens] = await pool.query(
      `SELECT i.id_conferencia, i.id_produto, p.nome_produto, p.unidade, i.lote, i.quantidade_sistema, i.quantidade_fisica, i.divergencia
       FROM item_conferencia i JOIN produto p ON p.id_produto = i.id_produto
       WHERE i.id_conferencia IN (?) ORDER BY i.id_item_conferencia`, [confs.map(c => c.id_conferencia)]);
    return confs.map(c => ({
      id_conferencia: c.id_conferencia, data_conferencia: hm(c.data_conferencia), responsavel: c.responsavel, id_usuario: c.id_usuario,
      observacao: c.observacao || '', ajustou_estoque: bool(c.ajustou_estoque),
      itens: itens.filter(i => i.id_conferencia === c.id_conferencia).map(({ id_conferencia, ...i }) => ({ ...i, lote: i.lote || '' }))
    }));
  }

  salvarConferencia(body, ator) {
    return this.tx(async c => {
      const itens = Array.isArray(body.itens) ? body.itens : [];
      if (!itens.length) throw erro('Nenhum item foi conferido.');
      const obs = validarTexto(body.observacao, 'A observação da conferência', { min: 10, max: 1000 });
      const ajustar = body.ajustar !== false;
      const quando = dataHora();
      const [r] = await c.query('INSERT INTO conferencia (data_conferencia, observacao, ajustou_estoque, id_usuario) VALUES (?, ?, ?, ?)',
        [quando, obs, ajustar, ator.id_usuario]);
      const id = r.insertId;
      const vistos = new Set();
      const proc = [];
      for (const item of itens) {
        const prod = await this.getProductById(item.id_produto, c, true);
        if (!prod) throw erro('Produto não cadastrado.', 404);
        if (vistos.has(prod.id_produto)) throw erro(`O produto "${prod.nome_produto}" foi informado mais de uma vez.`);
        vistos.add(prod.id_produto);
        const fisica = Number(item.quantidade_fisica);
        if (!Number.isFinite(fisica) || fisica < 0) throw erro(`Contagem inválida para "${prod.nome_produto}".`);
        if (!aceitaFracao(prod.unidade) && !Number.isInteger(fisica)) throw erro(`"${prod.nome_produto}" é contado em ${prod.unidade} e só aceita números inteiros.`);
        const sistema = prod.quantidade_estoque;
        const div = r3(fisica - sistema);
        if (ajustar && div !== 0) {
          await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [r3(fisica), prod.id_produto]);
          await this.addMovimentacao(c, {
            tipo_movimentacao: div > 0 ? 'Entrada' : 'Saída', quantidade: Math.abs(div), origem: 'conferencia',
            observacao: `Ajuste da conferência #${id} (sistema ${sistema} → físico ${r3(fisica)})`
          }, prod, ator);
        }
        await c.query(
          'INSERT INTO item_conferencia (id_conferencia, id_produto, lote, quantidade_sistema, quantidade_fisica, divergencia) VALUES (?, ?, ?, ?, ?, ?)',
          [id, prod.id_produto, prod.lote, sistema, r3(fisica), div]);
        proc.push({ id_produto: prod.id_produto, nome_produto: prod.nome_produto, unidade: prod.unidade, lote: prod.lote, quantidade_sistema: sistema, quantidade_fisica: r3(fisica), divergencia: div });
      }
      return {
        id_conferencia: id, data_conferencia: quando, responsavel: ator.nome, id_usuario: ator.id_usuario,
        observacao: obs, ajustou_estoque: ajustar, itens: proc
      };
    });
  }

  async listProdutosAtivos() {
    return this.getProducts(null, null, 'Ativo');
  }

  // ---------------------------------------------------------------- relatórios (RF 12, 13, 14)
  validarPeriodo({ from, to }) {
    if (from && !DATA_RE.test(from)) throw erro('A data inicial é inválida.');
    if (to && !DATA_RE.test(to)) throw erro('A data final é inválida.');
    if (from && to && from > to) throw erro('A data inicial não pode ser posterior à data final.');
  }

  async getRelatorioVendas({ from, to, categoria } = {}) {
    this.validarPeriodo({ from, to });
    const cat = categoria ? Number(categoria) : null;
    const where = ["v.status_venda = 'Concluída'"], params = [];
    if (from) { where.push('v.data_venda >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('v.data_venda <= ?'); params.push(`${to} 23:59:59`); }
    const filtro = where.join(' AND ');
    // Três leituras enxutas em paralelo (cabeçalhos, itens só com números e catálogo); o resto é somado
    // aqui com Map. Medido no teste de carga: é mais rápido que agrupar com GROUP_CONCAT no MySQL.
    const [[vendas], [itens], [prods]] = await Promise.all([
      pool.query(
        `SELECT v.id_venda, v.codigo_venda, v.data_venda, v.forma_pagamento, v.valor_subtotal, v.valor_total, u.nome AS usuario_nome
         FROM venda v JOIN usuario u ON u.id_usuario = v.id_usuario WHERE ${filtro} ORDER BY v.id_venda DESC`, params),
      pool.query(
        `SELECT i.id_item_venda, i.id_venda, i.id_produto, i.quantidade, i.subtotal
         FROM venda v JOIN item_venda i ON i.id_venda = v.id_venda WHERE ${filtro}`, params),
      pool.query('SELECT p.id_produto, p.nome_produto, p.unidade, p.id_categoria, c.nome_categoria FROM produto p JOIN categoria c ON c.id_categoria = p.id_categoria')
    ]);
    const catDe = new Map(prods.map(p => [p.id_produto, p]));
    const itensDe = new Map();
    for (const i of itens) {
      const p = catDe.get(i.id_produto);
      if (cat && (!p || p.id_categoria !== cat)) continue;
      const l = itensDe.get(i.id_venda);
      if (l) l.push(i); else itensDe.set(i.id_venda, [i]);
    }
    const mapa = new Map();
    const pagamentos = new Map();
    const transacoes = [];
    let bruto = 0, liquido = 0, descontos = 0;
    for (const v of vendas) {
      const doVenda = itensDe.get(v.id_venda);
      if (!doVenda) continue;
      doVenda.sort((a, b) => a.id_item_venda - b.id_item_venda);
      // Desconto rateado na mesma proporção do total da venda.
      const razao = v.valor_subtotal > 0 ? v.valor_total / v.valor_subtotal : 1;
      let sub = 0;
      const resumo = [];
      for (const i of doVenda) {
        const p = catDe.get(i.id_produto);
        sub += i.subtotal;
        resumo.push(`${p.nome_produto} x${i.quantidade}`);
        const m = mapa.get(i.id_produto) || { id_produto: i.id_produto, nome_produto: p.nome_produto, categoria: p.nome_categoria, unidade: p.unidade, quantidade: 0, total: 0 };
        m.quantidade = r3(m.quantidade + i.quantidade);
        m.total = r2(m.total + i.subtotal);
        mapa.set(i.id_produto, m);
      }
      const liq = r2(sub * razao);
      bruto = r2(bruto + sub); liquido = r2(liquido + liq); descontos = r2(descontos + (sub - liq));
      const pg = pagamentos.get(v.forma_pagamento) || { forma: v.forma_pagamento, total: 0, quantidade: 0 };
      pg.total = r2(pg.total + liq); pg.quantidade++;
      pagamentos.set(v.forma_pagamento, pg);
      transacoes.push({ id_venda: v.id_venda, codigo_venda: v.codigo_venda, data_venda: hm(v.data_venda), usuario_nome: v.usuario_nome, forma_pagamento: v.forma_pagamento, itens_resumo: resumo.join(', '), bruto: r2(sub), desconto: r2(sub - liq), valor_total: liq });
    }
    const itensVendidos = [...mapa.values()].map(i => ({ ...i, valor_unitario: i.quantidade ? r2(i.total / i.quantidade) : 0 })).sort((a, b) => b.total - a.total);
    return {
      filtros: { from: from || null, to: to || null, categoria: cat },
      totalBruto: bruto, totalDescontos: descontos, totalGeral: liquido,
      quantidadeTransacoes: transacoes.length, ticketMedio: transacoes.length ? r2(liquido / transacoes.length) : 0,
      porPagamento: [...pagamentos.values()], itensVendidos, transacoes
    };
  }

  async getRelatorioEstoque({ from, to, categoria } = {}) {
    this.validarPeriodo({ from, to });
    const cat = categoria ? Number(categoria) : null;
    const where = [], params = [];
    if (from) { where.push('data_movimentacao >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('data_movimentacao <= ?'); params.push(`${to} 23:59:59`); }
    if (cat) params.push(cat);
    // Entradas e saídas somadas pelo MySQL numa única passada e ligadas ao produto por LEFT JOIN.
    // IGNORE INDEX: esse índice não cobre a consulta; com ele o MySQL faz uma busca por linha (medido 2x mais lento).
    const [prods] = await pool.query(
      `SELECT p.*, c.nome_categoria, COALESCE(m.entradas, 0) AS entradas, COALESCE(m.saidas, 0) AS saidas
       FROM produto p JOIN categoria c ON c.id_categoria = p.id_categoria
       LEFT JOIN (
         SELECT id_produto, SUM(IF(tipo_movimentacao = 'Entrada', quantidade, 0)) AS entradas,
                SUM(IF(tipo_movimentacao = 'Saída', quantidade, 0)) AS saidas
         FROM movimentacao_estoque IGNORE INDEX (idx_mov_produto_data) ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY id_produto
       ) m ON m.id_produto = p.id_produto
       WHERE p.status = 'Ativo'${cat ? ' AND p.id_categoria = ?' : ''} ORDER BY p.id_produto`, params);
    const linhas = prods.map(p => ({
      id_produto: p.id_produto, codigo_barras: p.codigo_barras, nome_produto: p.nome_produto, unidade: p.unidade,
      categoria: p.nome_categoria, entradas: r3(p.entradas), saidas: r3(p.saidas),
      saldo_atual: p.quantidade_estoque, estoque_minimo: p.estoque_minimo,
      valor_em_estoque: r2(p.quantidade_estoque * p.preco_custo),
      situacao: p.quantidade_estoque <= p.estoque_minimo ? 'Crítico' : 'Regular'
    }));
    return {
      filtros: { from: from || null, to: to || null, categoria: cat },
      totalProdutos: linhas.length, totalCriticos: linhas.filter(l => l.situacao === 'Crítico').length,
      valorTotalEstoque: r2(linhas.reduce((a, l) => a + l.valor_em_estoque, 0)), linhas
    };
  }

  // Relatório de desperdício: perdas/sobras por produto e por motivo, valorizadas pelo custo.
  async getRelatorioPerdas({ from, to, categoria } = {}) {
    this.validarPeriodo({ from, to });
    const cat = categoria ? Number(categoria) : null;
    const where = ["m.origem = 'perda'"], params = [];
    if (from) { where.push('m.data_movimentacao >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('m.data_movimentacao <= ?'); params.push(`${to} 23:59:59`); }
    if (cat) { where.push('p.id_categoria = ?'); params.push(cat); }
    const [rows] = await pool.query(
      `SELECT m.*, p.nome_produto AS produto_nome, p.codigo_barras, p.unidade, u.nome AS usuario_nome, c.nome_categoria AS categoria
       FROM movimentacao_estoque m JOIN produto p ON p.id_produto = m.id_produto
       JOIN categoria c ON c.id_categoria = p.id_categoria LEFT JOIN usuario u ON u.id_usuario = m.id_usuario
       WHERE ${where.join(' AND ')} ORDER BY m.data_movimentacao DESC, m.id_movimentacao DESC`, params);
    const registros = rows.map(m => ({ ...mapMov(m), categoria: m.categoria }));
    const produtos = new Map();
    registros.forEach(r => {
      const p = produtos.get(r.id_produto) || { id_produto: r.id_produto, nome_produto: r.produto_nome, categoria: r.categoria, unidade: r.unidade, quantidade: 0, valor_total: 0, registros: 0 };
      p.quantidade = r3(p.quantidade + r.quantidade); p.valor_total = r2(p.valor_total + r.valor_total); p.registros++;
      produtos.set(r.id_produto, p);
    });
    const porMotivo = MOTIVOS_PERDA.map(motivo => {
      const doMotivo = registros.filter(r => r.motivo_perda === motivo);
      return { motivo, registros: doMotivo.length, valor_total: r2(doMotivo.reduce((a, r) => a + r.valor_total, 0)) };
    }).filter(m => m.registros);
    return {
      filtros: { from: from || null, to: to || null, categoria: cat },
      totalRegistros: registros.length, valorTotal: r2(registros.reduce((a, r) => a + r.valor_total, 0)),
      porProduto: [...produtos.values()].sort((a, b) => b.valor_total - a.valor_total), porMotivo, registros
    };
  }

  // ---------------------------------------------------------------- fichas técnicas (etapa 3)
  // Receita de um produto do tipo Produção: insumos por receita e quanto ela rende.
  // custo_unitario = Σ(quantidade × custo do insumo) / rendimento; margem sobre o preço de venda.
  calcularFicha(prod, ficha, itens) {
    const custoReceita = r2(itens.reduce((a, i) => a + i.quantidade * i.preco_custo, 0));
    const custoUnitario = r2(custoReceita / ficha.rendimento);
    const margem = prod.preco_venda > 0 ? Math.round(((prod.preco_venda - custoUnitario) / prod.preco_venda) * 1000) / 10 : null;
    return { custo_receita: custoReceita, custo_unitario: custoUnitario, margem_percent: margem };
  }

  async itensDasFichas(ids, c = pool) {
    const mapa = new Map(ids.map(id => [id, []]));
    if (!ids.length) return mapa;
    const [rows] = await c.query(
      `SELECT i.id_ficha, i.id_insumo, i.quantidade, p.nome_produto, p.unidade, p.preco_custo, p.quantidade_estoque, p.status, p.tipo
       FROM item_ficha_tecnica i JOIN produto p ON p.id_produto = i.id_insumo
       WHERE i.id_ficha IN (?) ORDER BY p.nome_produto`, [ids]);
    rows.forEach(r => mapa.get(r.id_ficha).push({
      id_insumo: r.id_insumo, nome_produto: r.nome_produto, unidade: r.unidade, quantidade: r.quantidade, preco_custo: r.preco_custo,
      custo: r2(r.quantidade * r.preco_custo), quantidade_estoque: r.quantidade_estoque, status: r.status, tipo: r.tipo
    }));
    return mapa;
  }

  montarFicha(prod, f, itens) {
    return {
      id_ficha: f.id_ficha, id_produto: prod.id_produto, nome_produto: prod.nome_produto, unidade: prod.unidade,
      preco_venda: prod.preco_venda, rendimento: f.rendimento, nome_rendimento: f.nome_rendimento, validade_dias: f.validade_dias,
      observacao: f.observacao || '', atualizada_em: hm(f.atualizada_em), atualizada_por: f.usuario_nome || null,
      itens, ...this.calcularFicha(prod, f, itens)
    };
  }

  async getFicha(idProduto, c = pool) {
    const prod = await this.getProductById(idProduto, c);
    if (!prod) return null;
    const [rows] = await c.query(
      'SELECT f.*, u.nome AS usuario_nome FROM ficha_tecnica f LEFT JOIN usuario u ON u.id_usuario = f.id_usuario WHERE f.id_produto = ?', [prod.id_produto]);
    if (!rows[0]) return null;
    const itens = await this.itensDasFichas([rows[0].id_ficha], c);
    return this.montarFicha(prod, rows[0], itens.get(rows[0].id_ficha));
  }

  // Todos os produtos ativos do tipo Produção, com ou sem ficha (sem ficha = ainda não dá para produzir).
  async listFichas() {
    const [rows] = await pool.query(
      `SELECT p.*, f.id_ficha, f.rendimento, f.nome_rendimento, f.validade_dias, f.observacao AS ficha_obs, f.atualizada_em, u.nome AS usuario_nome
       FROM produto p LEFT JOIN ficha_tecnica f ON f.id_produto = p.id_produto LEFT JOIN usuario u ON u.id_usuario = f.id_usuario
       WHERE p.tipo = 'Produção' AND p.status = 'Ativo' ORDER BY p.nome_produto`);
    const itens = await this.itensDasFichas(rows.filter(r => r.id_ficha).map(r => r.id_ficha));
    return rows.map(r => {
      const prod = mapProduto(r);
      if (!r.id_ficha) {
        return { id_ficha: null, id_produto: prod.id_produto, nome_produto: prod.nome_produto, unidade: prod.unidade, preco_venda: prod.preco_venda, preco_custo: prod.preco_custo, itens: [] };
      }
      return this.montarFicha(prod, { ...r, observacao: r.ficha_obs }, itens.get(r.id_ficha));
    });
  }

  saveFicha(idProduto, body, ator) {
    return this.tx(async c => {
      const prod = await this.getProductById(idProduto, c, true);
      if (!prod) throw erro('Produto não encontrado.', 404);
      if (prod.tipo !== 'Produção') throw erro(`Só produtos do tipo Produção têm ficha técnica. Altere o tipo de "${prod.nome_produto}" no Cadastro de Produtos.`);
      const rendimento = validarQuantidade(prod, body.rendimento, 'O rendimento');
      const nomeRend = txt(body.nome_rendimento).slice(0, 40) || 'receita';
      let validadeDias = null;
      if (body.validade_dias !== undefined && body.validade_dias !== null && body.validade_dias !== '') {
        validadeDias = Number(body.validade_dias);
        if (!Number.isInteger(validadeDias) || validadeDias < 0 || validadeDias > 365) throw erro('A validade do produto pronto deve ser um número inteiro de dias, de 0 a 365.');
      }
      const obs = txt(body.observacao).slice(0, 2000);
      const itens = Array.isArray(body.itens) ? body.itens : [];
      if (!itens.length) throw erro('Informe ao menos um insumo na ficha técnica.');
      const vistos = new Set();
      const linhas = [];
      for (const it of itens) {
        const ins = await this.getProductById(it.id_insumo, c);
        if (!ins) throw erro('Insumo não cadastrado.', 404);
        if (ins.id_produto === prod.id_produto) throw erro('O produto não pode ser insumo da própria receita.');
        if (ins.status !== 'Ativo') throw erro(`"${ins.nome_produto}" está inativo e não pode entrar na receita.`);
        if (vistos.has(ins.id_produto)) throw erro(`"${ins.nome_produto}" aparece mais de uma vez na receita.`);
        vistos.add(ins.id_produto);
        const q = Number(it.quantidade);
        if (!Number.isFinite(q) || q <= 0) throw erro(`Informe a quantidade de "${ins.nome_produto}" (maior que zero).`);
        linhas.push([ins.id_produto, r3(q)]);
      }
      await c.query(
        `INSERT INTO ficha_tecnica (id_produto, rendimento, nome_rendimento, validade_dias, observacao, atualizada_em, id_usuario)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rendimento = VALUES(rendimento), nome_rendimento = VALUES(nome_rendimento), validade_dias = VALUES(validade_dias),
           observacao = VALUES(observacao), atualizada_em = VALUES(atualizada_em), id_usuario = VALUES(id_usuario)`,
        [prod.id_produto, rendimento, nomeRend, validadeDias, obs, dataHora(), ator ? ator.id_usuario : null]);
      const [[f]] = await c.query('SELECT id_ficha FROM ficha_tecnica WHERE id_produto = ?', [prod.id_produto]);
      await c.query('DELETE FROM item_ficha_tecnica WHERE id_ficha = ?', [f.id_ficha]);
      await c.query('INSERT INTO item_ficha_tecnica (id_ficha, id_insumo, quantidade) VALUES ?', [linhas.map(l => [f.id_ficha, ...l])]);
      const ficha = await this.getFicha(prod.id_produto, c);
      // O custo do produto passa a ser o da receita (as perdas da etapa 2 são valorizadas por ele).
      await c.query('UPDATE produto SET preco_custo = ? WHERE id_produto = ?', [ficha.custo_unitario, prod.id_produto]);
      return ficha;
    });
  }

  deleteFicha(idProduto) {
    return this.tx(async c => {
      const [r] = await c.query('DELETE FROM ficha_tecnica WHERE id_produto = ?', [idNum(idProduto)]);
      if (!r.affectedRows) throw erro('Este produto não tem ficha técnica.', 404);
      return { id_produto: idNum(idProduto) };
    });
  }

  // ---------------------------------------------------------------- produção (etapa 3)
  // Calcula o que uma produção consome. Informar `receitas` (fornadas) ou `quantidade` (do produto pronto).
  // Insumo controlado em unidade inteira (UN, DZ, Pacote) é arredondado para cima: 2,5 ovos viram 3.
  // lock = true trava produto e insumos até o fim da transação (usado ao registrar).
  async planejarProducao(body, c = pool, lock = false) {
    const prod = await this.getProductById(body.id_produto, c, lock);
    if (!prod) throw erro('Produto não encontrado.', 404);
    if (prod.tipo !== 'Produção') throw erro(`"${prod.nome_produto}" não é um produto de produção própria.`);
    if (prod.status !== 'Ativo') throw erro(`"${prod.nome_produto}" está inativo.`);
    const ficha = await this.getFicha(prod.id_produto, c);
    if (!ficha) throw erro(`"${prod.nome_produto}" ainda não tem ficha técnica. Cadastre a receita antes de produzir.`);
    const vazio = v => v === undefined || v === null || v === '';
    let quantidade;
    if (!vazio(body.receitas)) {
      const n = Number(body.receitas);
      if (!Number.isFinite(n) || n <= 0) throw erro(`Informe quantas vezes a receita (${ficha.nome_rendimento}) foi feita (maior que zero).`);
      quantidade = r3(n * ficha.rendimento);
    } else {
      quantidade = Number(body.quantidade);
    }
    quantidade = validarQuantidade(prod, quantidade, 'A quantidade produzida');
    const fator = quantidade / ficha.rendimento;
    const consumo = [];
    for (const it of ficha.itens) {
      const ins = await this.getProductById(it.id_insumo, c, lock);
      let q = it.quantidade * fator;
      q = aceitaFracao(ins.unidade) ? Math.max(r3(q), 0.001) : Math.ceil(r3(q));
      consumo.push({
        id_insumo: ins.id_produto, nome_produto: ins.nome_produto, unidade: ins.unidade, quantidade: q, preco_custo: ins.preco_custo,
        custo: r2(q * ins.preco_custo), saldo: ins.quantidade_estoque, falta: q > ins.quantidade_estoque ? r3(q - ins.quantidade_estoque) : 0, ins
      });
    }
    const custoTotal = r2(consumo.reduce((a, i) => a + i.custo, 0));
    return {
      prod, ficha, receitas: r3(fator), quantidade, custo_total: custoTotal, custo_unitario: r2(custoTotal / quantidade),
      consumo, faltas: consumo.filter(i => i.falta > 0)
    };
  }

  async previewProducao(query) {
    const p = await this.planejarProducao(query);
    return {
      id_produto: p.prod.id_produto, nome_produto: p.prod.nome_produto, unidade: p.prod.unidade, nome_rendimento: p.ficha.nome_rendimento,
      rendimento: p.ficha.rendimento, receitas: p.receitas, quantidade: p.quantidade, custo_total: p.custo_total, custo_unitario: p.custo_unitario,
      consumo: p.consumo.map(({ ins, ...i }) => i), podeProduzir: !p.faltas.length
    };
  }

  registrarProducao(body, ator) {
    return this.tx(async c => {
      const p = await this.planejarProducao(body, c, true);
      if (p.faltas.length) {
        const lista = p.faltas.map(i => `${i.nome_produto} (faltam ${i.falta} ${i.unidade})`).join('; ');
        throw erro(`Insumos insuficientes para produzir ${p.quantidade} ${p.prod.unidade} de "${p.prod.nome_produto}": ${lista}.`);
      }
      const obs = txt(body.observacao).slice(0, 1000);
      const [r] = await c.query(
        `INSERT INTO producao (id_produto, receitas, quantidade, custo_total, data_producao, observacao, status, id_usuario)
         VALUES (?, ?, ?, ?, ?, ?, 'Concluída', ?)`,
        [p.prod.id_produto, p.receitas, p.quantidade, p.custo_total, dataHora(), obs, ator.id_usuario]);
      const id = r.insertId;
      const desc = `Produção #${id}: ${p.prod.nome_produto}`;
      for (const i of p.consumo) {
        await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [r3(i.ins.quantidade_estoque - i.quantidade), i.id_insumo]);
        await this.addMovimentacao(c, { tipo_movimentacao: 'Saída', quantidade: i.quantidade, origem: 'producao', observacao: desc, valor_unitario: i.preco_custo, id_producao: id }, i.ins, ator);
      }
      const campos = { quantidade_estoque: r3(p.prod.quantidade_estoque + p.quantidade), preco_custo: p.custo_unitario };
      // Validade do produto pronto conta a partir de hoje; o lote identifica a produção (alerta de validade da etapa 2).
      if (p.ficha.validade_dias !== null) Object.assign(campos, { validade: dataISO(deslocar(p.ficha.validade_dias)), lote: `P${id}` });
      await c.query('UPDATE produto SET ? WHERE id_produto = ?', [campos, p.prod.id_produto]);
      await this.addMovimentacao(c, { tipo_movimentacao: 'Entrada', quantidade: p.quantidade, origem: 'producao', observacao: desc, valor_unitario: p.custo_unitario, id_producao: id }, p.prod, ator);
      return this.getProducao(id, c);
    });
  }

  // Desfaz uma produção lançada errado: devolve os insumos e tira o produto pronto do estoque.
  estornarProducao(id, body, ator) {
    return this.tx(async c => {
      const [rows] = await c.query('SELECT * FROM producao WHERE id_producao = ? FOR UPDATE', [idNum(id)]);
      const pr = rows[0];
      if (!pr) throw erro('Produção não encontrada.', 404);
      if (pr.status === 'Estornada') throw erro('Esta produção já foi estornada.');
      const motivo = validarTexto(body.motivo, 'O motivo do estorno', { obrigatorio: true, min: 5, max: 500 });
      const [movs] = await c.query("SELECT * FROM movimentacao_estoque WHERE id_producao = ? AND origem = 'producao' ORDER BY id_movimentacao", [pr.id_producao]);
      const desc = `Estorno da produção #${pr.id_producao}: ${motivo}`;
      for (const m of movs) {
        const prod = await this.getProductById(m.id_produto, c, true);
        const sai = m.tipo_movimentacao === 'Entrada';
        if (sai && prod.quantidade_estoque < m.quantidade) {
          throw erro(`Não dá para estornar: parte de "${prod.nome_produto}" já foi vendida ou baixada (saldo ${prod.quantidade_estoque} ${prod.unidade}, a produção deu entrada em ${m.quantidade}).`);
        }
        await c.query('UPDATE produto SET quantidade_estoque = ? WHERE id_produto = ?', [r3(sai ? prod.quantidade_estoque - m.quantidade : prod.quantidade_estoque + m.quantidade), prod.id_produto]);
        await this.addMovimentacao(c, { tipo_movimentacao: sai ? 'Saída' : 'Entrada', quantidade: m.quantidade, origem: 'estorno', observacao: desc, valor_unitario: m.valor_unitario, id_producao: pr.id_producao }, prod, ator);
      }
      await c.query("UPDATE producao SET status = 'Estornada', estornada_por = ?, data_estorno = ?, motivo_estorno = ? WHERE id_producao = ?",
        [ator.id_usuario, dataHora(), motivo, pr.id_producao]);
      return this.getProducao(pr.id_producao, c);
    });
  }

  filtroProducoes({ from, to, status }) {
    this.validarPeriodo({ from, to });
    const where = [], params = [];
    if (from) { where.push('pr.data_producao >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('pr.data_producao <= ?'); params.push(`${to} 23:59:59`); }
    if (['Concluída', 'Estornada'].includes(status)) { where.push('pr.status = ?'); params.push(status); }
    return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
  }

  async getProducoes({ from, to, status, limite, offset } = {}) {
    const f = this.filtroProducoes({ from, to, status });
    const [rows] = await pool.query(listagem(SQL_PRODUCAO, 'producao pr', f.sql, 'pr.id_producao DESC', paginar(limite, offset)), f.params);
    return rows.map(mapProducao);
  }

  async contarProducoes(filtros = {}) {
    const f = this.filtroProducoes(filtros);
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN pr.status = 'Concluída' THEN pr.custo_total END), 0) AS custo FROM producao pr${f.sql}`, f.params);
    return { total: Number(r.n), custoTotal: r2(r.custo) };
  }

  async getProducao(id, c = pool) {
    const [rows] = await c.query(`${SQL_PRODUCAO} WHERE pr.id_producao = ?`, [idNum(id)]);
    if (!rows[0]) return undefined;
    const [movs] = await c.query(
      `SELECT m.id_produto, m.quantidade, m.valor_unitario, p.nome_produto, p.unidade FROM movimentacao_estoque m
       JOIN produto p ON p.id_produto = m.id_produto
       WHERE m.id_producao = ? AND m.origem = 'producao' AND m.tipo_movimentacao = 'Saída' ORDER BY p.nome_produto`, [rows[0].id_producao]);
    return {
      ...mapProducao(rows[0]),
      consumo: movs.map(m => ({ id_insumo: m.id_produto, nome_produto: m.nome_produto, unidade: m.unidade, quantidade: m.quantidade, custo: r2(m.quantidade * m.valor_unitario) }))
    };
  }

  // Relatório de consumo: o que a produção gastou de cada insumo e quanto custou cada produto feito.
  // Só produções concluídas (as estornadas foram desfeitas). A categoria filtra o produto produzido.
  async getRelatorioConsumo({ from, to, categoria } = {}) {
    const f = this.filtroProducoes({ from, to, status: 'Concluída' });
    const cat = categoria ? Number(categoria) : null;
    const where = f.sql + (cat ? `${f.sql ? ' AND' : ' WHERE'} p.id_categoria = ?` : '');
    const params = cat ? [...f.params, cat] : f.params;
    const [prods] = await pool.query(
      `SELECT pr.id_produto, p.nome_produto, p.unidade, c.nome_categoria AS categoria, COUNT(*) AS producoes,
              SUM(pr.receitas) AS receitas, SUM(pr.quantidade) AS quantidade, SUM(pr.custo_total) AS custo_total
       FROM producao pr JOIN produto p ON p.id_produto = pr.id_produto JOIN categoria c ON c.id_categoria = p.id_categoria
       ${where} GROUP BY pr.id_produto, p.nome_produto, p.unidade, c.nome_categoria ORDER BY custo_total DESC`, params);
    const [insumos] = await pool.query(
      `SELECT m.id_produto AS id_insumo, i.nome_produto, i.unidade, SUM(m.quantidade) AS quantidade, SUM(m.quantidade * m.valor_unitario) AS custo_total
       FROM producao pr JOIN produto p ON p.id_produto = pr.id_produto
       JOIN movimentacao_estoque m ON m.id_producao = pr.id_producao AND m.origem = 'producao' AND m.tipo_movimentacao = 'Saída'
       JOIN produto i ON i.id_produto = m.id_produto
       ${where} GROUP BY m.id_produto, i.nome_produto, i.unidade ORDER BY custo_total DESC`, params);
    const porProduto = prods.map(r => ({
      id_produto: r.id_produto, nome_produto: r.nome_produto, unidade: r.unidade, categoria: r.categoria, producoes: Number(r.producoes),
      receitas: r3(r.receitas), quantidade: r3(r.quantidade), custo_total: r2(r.custo_total), custo_unitario: r2(r.custo_total / r.quantidade)
    }));
    return {
      filtros: { from: from || null, to: to || null, categoria: cat },
      totalProducoes: porProduto.reduce((a, p) => a + p.producoes, 0), custoTotal: r2(porProduto.reduce((a, p) => a + p.custo_total, 0)),
      porProduto,
      porInsumo: insumos.map(r => ({ id_insumo: r.id_insumo, nome_produto: r.nome_produto, unidade: r.unidade, quantidade: r3(r.quantidade), custo_total: r2(r.custo_total) }))
    };
  }

  // ---------------------------------------------------------------- busca global (barra de pesquisa)
  // `permitido(perm)` informa o que o perfil do usuário pode ver; nada além disso é retornado.
  // A collation do banco (utf8mb4_0900_ai_ci) já ignora acentos e maiúsculas: "pao" acha "Pão".
  async buscaGlobal(q, permitido) {
    const termo = txt(q);
    const out = { produtos: [], requisicoes: [], vendas: [], usuarios: [] };
    if (termo.length < 2) return out;
    const t = like(termo);
    const lim = 5;
    if (permitido('produtos:ver')) {
      const [rows] = await pool.query(
        `SELECT p.id_produto, p.nome_produto, p.codigo_barras, p.unidade, p.quantidade_estoque, p.status, c.nome_categoria AS categoria
         FROM produto p JOIN categoria c ON c.id_categoria = p.id_categoria
         WHERE p.nome_produto LIKE ? OR p.codigo_barras LIKE ? OR p.lote LIKE ? OR p.descricao LIKE ?
         ORDER BY p.id_produto LIMIT ?`, [t, t, t, t, lim]);
      out.produtos = rows;
    }
    if (permitido('requisicoes:ver')) {
      const [rows] = await pool.query(
        `SELECT r.id_requisicao, r.codigo_pedido, r.produto_nome, f.nome AS fornecedor, r.situacao
         FROM requisicao r JOIN fornecedor f ON f.id_fornecedor = r.id_fornecedor
         WHERE r.codigo_pedido LIKE ? OR f.nome LIKE ? OR r.produto_nome LIKE ? OR r.situacao LIKE ?
         ORDER BY r.id_requisicao DESC LIMIT ?`, [t, t, t, t, lim]);
      out.requisicoes = rows;
    }
    if (permitido('vendas:ver')) {
      out.vendas = (await this.getVendas({ q: termo, limite: lim })).map(v => ({
        id_venda: v.id_venda, codigo_venda: v.codigo_venda, data_venda: v.data_venda, valor_total: v.valor_total,
        usuario_nome: v.usuario_nome, status_venda: v.status_venda
      }));
    }
    if (permitido('usuarios:gerir')) {
      const [rows] = await pool.query(
        `SELECT u.id_usuario, u.nome, u.email, p.nome_perfil AS perfil, u.status
         FROM usuario u JOIN perfil p ON p.id_perfil = u.id_perfil
         WHERE u.nome LIKE ? OR u.email LIKE ? OR u.cargo LIKE ? ORDER BY u.id_usuario LIMIT ?`, [t, t, t, lim]);
      out.usuarios = rows;
    }
    return out;
  }

  async registrarRelatorio(tipo, idUsuario) {
    await pool.query('INSERT INTO relatorio (tipo_relatorio, data_geracao, id_usuario) VALUES (?, ?, ?)', [tipo.slice(0, 60), dataHora(), idUsuario]);
  }
}

module.exports = new Database();
module.exports.Database = Database;
module.exports.util = { dataISO, dataHora, r2, r3, FORMAS_PAGAMENTO, MOTIVOS_PERDA, TIPOS_PRODUTO };
