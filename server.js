// server.js - Servidor HTTP e API RESTful do GestFast ERP (Node http + MySQL)
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { HttpError, erro } = require('./lib/errors');
const { can, listFor } = require('./lib/permissions');
const logger = require('./lib/logger');
const { buildXlsx, buildPdf } = require('./lib/export');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = process.env.GESTFAST_UPLOAD_DIR || path.join(__dirname, 'data', 'uploads');
const COOKIE = 'gf_session';
const MAX_BODY = 4 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8', '.css': 'text/css; charset=UTF-8', '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
};

// ------------------------------------------------------------------ utilidades HTTP
function sendJson(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...extra });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Requisição muito grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8');
        resolve(s ? JSON.parse(s) : {});
      } catch (e) { reject(new HttpError(400, 'Corpo da requisição inválido (JSON esperado).')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

const cookieHeader = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ''}`;
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// Limitação de tentativas de login (por e-mail+IP)
const tentativas = new Map();
function checarBloqueio(chave) {
  const t = tentativas.get(chave);
  if (t && t.ate > Date.now()) throw new HttpError(429, `Muitas tentativas. Aguarde ${Math.ceil((t.ate - Date.now()) / 1000)}s para tentar novamente.`);
}
function registrarFalha(chave) {
  const t = tentativas.get(chave) || { n: 0, ate: 0 };
  t.n++;
  if (t.n >= 5) { t.ate = Date.now() + 60000; t.n = 0; }
  tentativas.set(chave, t);
}

// ------------------------------------------------------------------ roteador
const routes = [];
function route(method, pattern, opts, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, opts, handler });
}
const ok = (data = {}, status = 200) => ({ status, body: { success: true, ...data } });
const hojeISO = () => db.util.dataISO();

function exigir(ctx, perm) {
  if (!can(ctx.user.perfil, perm)) throw new HttpError(403, 'Usuário sem permissão para esta operação.');
}

// ---------------- autenticação
route('POST', '/api/auth/login', { public: true }, async ctx => {
  const { email, senha, lembrar } = ctx.body;
  const chave = `${String(email || '').toLowerCase()}|${ctx.req.socket.remoteAddress}`;
  checarBloqueio(chave);
  let u;
  try { u = await db.authenticate(email, senha); } catch (e) {
    if (e.status === 401) registrarFalha(chave);
    logger.log('AVISO', 'login_falhou', { email: String(email || '').slice(0, 100), motivo: e.message });
    throw e;
  }
  tentativas.delete(chave);
  const s = await db.createSession(u.id_usuario, lembrar);
  logger.log('INFO', 'login', {}, u.email);
  return { ...ok({ message: 'Login realizado com sucesso', user: db.publicUser(u), permissoes: listFor(u.nome_perfil) }), headers: { 'Set-Cookie': cookieHeader(s.token, s.maxAgeSeg) } };
});

route('POST', '/api/auth/logout', { public: true }, async ctx => {
  const token = parseCookies(ctx.req)[COOKIE];
  if (ctx.user) logger.log('INFO', 'logout', {}, ctx.user.email);
  await db.deleteSession(token);
  return { ...ok({ message: 'Sessão encerrada.' }), headers: { 'Set-Cookie': clearCookie } };
});

route('GET', '/api/auth/me', { public: true }, async ctx => {
  if (!ctx.user) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  return ok({ user: ctx.user, permissoes: listFor(ctx.user.perfil), settings: await db.getSettings(), hoje: hojeISO() });
});

route('POST', '/api/auth/forgot', { public: true }, async ctx => {
  const r = await db.createResetToken(ctx.body.email);
  if (r) {
    // Sem servidor SMTP configurado, o link é registrado no console/log (simulação de envio de e-mail).
    const link = `http://localhost:${PORT}/#reset=${r.token}`;
    logger.log('INFO', 'redefinicao_senha_solicitada', { link }, r.user.email);
    if (process.env.GESTFAST_QUIET !== '1') console.log(`[GestFast] Link de redefinição para ${r.user.email}: ${link}`);
  }
  return ok({ message: 'Se o e-mail estiver cadastrado, enviaremos um link de redefinição.' });
});

route('POST', '/api/auth/reset', { public: true }, async ctx => {
  const u = await db.resetPassword(ctx.body.token, ctx.body.senha);
  logger.log('INFO', 'senha_redefinida', {}, u.email);
  return ok({ message: 'Senha redefinida com sucesso. Faça login com a nova senha.' });
});

route('POST', '/api/auth/change-password', {}, async ctx => {
  await db.changePassword(ctx.user.id_usuario, ctx.body.senha_atual, ctx.body.nova_senha);
  return ok({ message: 'Senha alterada com sucesso!' });
});

// ---------------- busca global
route('GET', '/api/search', {}, async ctx => ok({ results: await db.buscaGlobal(ctx.query.q, perm => can(ctx.user.perfil, perm)) }));

// ---------------- dashboard e dados de apoio
route('GET', '/api/dashboard', { perm: 'dashboard:ver' }, async ctx => {
  const t0 = Date.now();
  const data = await db.getDashboardData(ctx.user);
  return ok({ data, latencyMs: Date.now() - t0 });
});
route('GET', '/api/alerts', { perm: 'dashboard:ver' }, async () => ok({ alerts: await db.getAlertasCriticos() }));
route('GET', '/api/categories', {}, async () => ok({ categories: await db.listCategorias() }));
route('GET', '/api/suppliers', {}, async () => ok({ suppliers: await db.listFornecedores() }));
route('GET', '/api/profiles', { perm: 'usuarios:gerir' }, async () => ok({ profiles: await db.listPerfis() }));
route('GET', '/api/settings', {}, async ctx => ok({ settings: await db.getSettings(), hoje: hojeISO() }));
route('PUT', '/api/settings', { perm: 'config:gerir' }, async ctx => ok({ settings: await db.updateSettings(ctx.body), message: 'Configurações salvas com sucesso!' }));
route('GET', '/api/logs', { perm: 'logs:ver' }, async ctx => ok({ logs: logger.recent(Math.min(Number(ctx.query.limit) || 200, 1000)) }));

// ---------------- funcionários
route('GET', '/api/users', { perm: 'usuarios:gerir' }, async ctx => ok({ users: await db.listUsers({ q: ctx.query.q, id_perfil: ctx.query.id_perfil, status: ctx.query.status }) }));
route('POST', '/api/users', { perm: 'usuarios:gerir' }, async ctx => {
  const u = await db.createUser(ctx.body);
  return ok({ user: u, message: 'Funcionário cadastrado com sucesso!' }, 201);
});
route('PUT', '/api/users/:id', { perm: 'usuarios:gerir' }, async ctx => ok({ user: await db.updateUser(ctx.params.id, ctx.body, ctx.user), message: 'Funcionário atualizado com sucesso!' }));
route('PATCH', '/api/users/:id/status', { perm: 'usuarios:gerir' }, async ctx => {
  const u = await db.setUserStatus(ctx.params.id, ctx.body.status, ctx.user);
  return ok({ user: u, message: u.status === 'Ativo' ? 'Acesso do funcionário reativado!' : 'Acesso do funcionário desativado com sucesso!' });
});

// ---------------- produtos
function salvarImagem(dataUrl, idRef) {
  const m = /^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw erro('Imagem inválida. Envie um arquivo PNG, JPG, WEBP ou GIF.');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw erro('A imagem deve ter no máximo 2 MB.');
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const nome = `prod-${idRef}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, nome), buf);
  return `uploads/${nome}`;
}

route('GET', '/api/products', { perm: 'produtos:ver' }, async ctx => ok({ products: await db.getProducts(ctx.query.q, ctx.query.category, ctx.query.status || 'Ativo') }));
route('GET', '/api/products/:id', { perm: 'produtos:ver' }, async ctx => {
  const p = await db.getProductById(ctx.params.id);
  if (!p) throw new HttpError(404, 'Produto não encontrado');
  return ok({ product: p });
});
route('POST', '/api/products', { perm: 'produtos:editar' }, async ctx => {
  const { imagem_data, ...dados } = ctx.body;
  if (imagem_data) dados.imagem = salvarImagem(imagem_data, 'novo');
  return ok({ product: await db.saveProduct(dados), message: 'Produto cadastrado com sucesso!' }, 201);
});
route('PUT', '/api/products/:id', { perm: 'produtos:editar' }, async ctx => {
  const { imagem_data, ...dados } = ctx.body;
  dados.id_produto = ctx.params.id;
  if (imagem_data) dados.imagem = salvarImagem(imagem_data, ctx.params.id);
  return ok({ product: await db.saveProduct(dados), message: 'Produto atualizado com sucesso!' });
});
route('DELETE', '/api/products/:id', { perm: 'produtos:editar' }, async ctx => {
  await db.setProductStatus(ctx.params.id, 'Inativo');
  return ok({ message: 'Produto inativado do catálogo com sucesso!' });
});
route('PATCH', '/api/products/:id/status', { perm: 'produtos:editar' }, async ctx => {
  const p = await db.setProductStatus(ctx.params.id, ctx.body.status);
  return ok({ product: p, message: p.status === 'Ativo' ? 'Produto reativado no catálogo!' : 'Produto inativado do catálogo com sucesso!' });
});

// ---------------- requisições
// Listagens aceitam ?limit=&offset= (paginação, GestFast v2). Sem limit a resposta é a mesma de antes (tudo).
const pagina = ctx => (ctx.query.limit ? { limite: ctx.query.limit, offset: ctx.query.offset } : {});
const comTotal = async (ctx, chave, lista, contar) => ok({ [chave]: lista, ...(ctx.query.limit ? await contar() : {}) });

route('GET', '/api/requisitions', { perm: 'requisicoes:ver' }, async ctx =>
  comTotal(ctx, 'requisicoes', await db.listRequisicoes(pagina(ctx)), () => db.contarRequisicoes()));
route('GET', '/api/requisitions/:id', { perm: 'requisicoes:ver' }, async ctx => {
  const r = await db.getRequisicao(ctx.params.id);
  if (!r) throw new HttpError(404, 'Requisição não encontrada');
  return ok({ requisicao: r });
});
route('POST', '/api/requisitions', { perm: 'requisicoes:criar' }, async ctx => ok({ requisicao: await db.createRequisicao(ctx.body, ctx.user), message: 'Pedido realizado com sucesso' }, 201));
route('PATCH', '/api/requisitions/:id/status', {}, async ctx => {
  const sit = ctx.body.situacao;
  exigir(ctx, sit === 'Cancelado' ? 'requisicoes:cancelar' : sit === 'Finalizado' ? 'requisicoes:receber' : 'requisicoes:avancar');
  const r = await db.updateRequisicaoStatus(ctx.params.id, ctx.body, ctx.user);
  const msg = sit === 'Cancelado' ? 'Solicitação de cancelamento encaminhada com sucesso'
    : sit === 'Finalizado' ? (r.parcial ? 'Recebimento parcial registrado e estoque atualizado!' : 'Mercadoria recebida e estoque atualizado!')
      : `Requisição atualizada para "${r.situacao}"!`;
  return ok({ requisicao: r, message: msg });
});

// ---------------- movimentações
route('GET', '/api/movements', { perm: 'movimentos:ver' }, async ctx => {
  const f = { tipo: ctx.query.tipo, from: ctx.query.from, to: ctx.query.to };
  return comTotal(ctx, 'movements', await db.getMovimentacoes({ ...f, ...pagina(ctx) }), () => db.contarMovimentacoes(f));
});
route('POST', '/api/movements', { perm: 'movimentos:registrar' }, async ctx => {
  const movs = await db.registrarMovimentacoes(ctx.body, ctx.user);
  const tipo = ctx.body.tipo_movimentacao;
  return ok({ movements: movs, movement: movs[0], message: movs.length > 1 ? `${tipo} em lote registrada (${movs.length} itens)!` : `${tipo} registrada com sucesso!` }, 201);
});

// ---------------- validade e perdas/sobras
route('GET', '/api/expiring', { perm: 'produtos:ver' }, async () => ok(await db.getValidades()));
route('POST', '/api/losses', { perm: 'movimentos:registrar' }, async ctx => {
  const movs = await db.registrarPerdas(ctx.body, ctx.user);
  logger.log('INFO', 'perda_registrada', { motivo: ctx.body.motivo_perda, itens: movs.length }, ctx.user.email);
  return ok({ movements: movs, message: movs.length > 1 ? `Perda registrada (${movs.length} itens) e estoque atualizado!` : 'Perda registrada e estoque atualizado!' }, 201);
});

// ---------------- vendas
route('GET', '/api/sales', { perm: 'vendas:ver' }, async ctx => {
  const f = { from: ctx.query.from, to: ctx.query.to, q: ctx.query.q, status: ctx.query.status };
  return comTotal(ctx, 'sales', await db.getVendas({ ...f, ...pagina(ctx) }), () => db.contarVendas(f));
});
route('GET', '/api/sales/:id', { perm: 'vendas:ver' }, async ctx => {
  const v = await db.getVenda(ctx.params.id);
  if (!v) throw new HttpError(404, 'Venda não encontrada');
  return ok({ sale: v });
});
route('POST', '/api/sales', { perm: 'vendas:vender' }, async ctx => ok({ sale: await db.realizarVenda(ctx.body, ctx.user), message: 'Venda realizada com sucesso' }, 201));
route('PUT', '/api/sales/:id', { perm: 'vendas:editar' }, async ctx => ok({ sale: await db.editarVenda(ctx.params.id, ctx.body, ctx.user), message: 'Venda atualizada com sucesso' }));
route('POST', '/api/sales/:id/cancel', { perm: 'vendas:cancelar' }, async ctx => {
  const aut = await db.authorizeManager(ctx.body.autorizador_email, ctx.body.autorizador_senha);
  const v = await db.cancelarVenda(ctx.params.id, ctx.body, ctx.user, aut);
  logger.log('INFO', 'venda_cancelada', { venda: v.codigo_venda, autorizadaPor: aut.email }, ctx.user.email);
  return ok({ sale: v, message: 'Venda cancelada e estoque estornado!' });
});
route('DELETE', '/api/sales/:id', { perm: 'vendas:excluir' }, async ctx => {
  await db.authorizeManager(ctx.body.autorizador_email, ctx.body.autorizador_senha, ['Administrador']);
  const v = await db.excluirVenda(ctx.params.id, ctx.user);
  return ok({ message: 'Venda excluída com sucesso' , sale: v });
});

// ---------------- conferência
route('GET', '/api/inventory', { perm: 'estoque:conferir' }, async () => ok({ conferencias: await db.listConferencias(), itensParaConferencia: await db.listProdutosAtivos() }));
route('POST', '/api/inventory', { perm: 'estoque:conferir' }, async ctx => ok({ conferencia: await db.salvarConferencia(ctx.body, ctx.user), message: 'Conferência de estoque salva com sucesso!' }, 201));

// ---------------- relatórios (+ exportação PDF/XLSX)
const brl = n => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;
const num = n => String(Number(n)).replace('.', ',');
const dataBR = s => (s ? s.split('-').reverse().join('/') : '');
function descPeriodo(f, categorias) {
  const cat = f.categoria ? (categorias.find(c => c.id_categoria === f.categoria) || {}).nome_categoria : 'Todas as categorias';
  const per = f.from || f.to ? `${f.from ? dataBR(f.from) : 'início'} a ${f.to ? dataBR(f.to) : 'hoje'}` : 'Todo o período';
  return `Período: ${per}  |  Categoria: ${cat}`;
}

async function entregarRelatorio(ctx, tipo, dados, montar) {
  const formato = (ctx.query.format || 'json').toLowerCase();
  await db.registrarRelatorio(`${tipo} (${formato})`, ctx.user.id_usuario);
  if (formato === 'json') return ok({ report: dados });
  const m = montar(dados, await db.listCategorias());
  const stamp = `${hojeISO()}`;
  if (formato === 'xlsx') {
    return { raw: true, status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="gestfast-${tipo}-${stamp}.xlsx"` }, body: buildXlsx(m.sheets) };
  }
  if (formato === 'pdf') {
    return { raw: true, status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="gestfast-${tipo}-${stamp}.pdf"` }, body: buildPdf({ title: m.titulo, subtitle: m.subtitulo, sections: m.sections, footer: `GestFast - ${(await db.getSettings()).estabelecimento} - gerado em ${db.util.dataHora()} por ${ctx.user.nome}`, landscape: m.landscape }) };
  }
  throw new HttpError(400, 'Formato inválido. Use json, pdf ou xlsx.');
}

route('GET', '/api/reports/sales', { perm: 'relatorios:ver' }, async ctx => {
  const r = await db.getRelatorioVendas({ from: ctx.query.from, to: ctx.query.to, categoria: ctx.query.categoria });
  return entregarRelatorio(ctx, 'vendas', r, (d, cats) => {
    const resumo = [
      `${descPeriodo(d.filtros, cats)}`,
      `Transações: ${d.quantidadeTransacoes}  |  Bruto: ${brl(d.totalBruto)}  |  Descontos: ${brl(d.totalDescontos)}  |  Faturamento: ${brl(d.totalGeral)}  |  Ticket médio: ${brl(d.ticketMedio)}`
    ];
    const colItens = [{ label: 'Produto', width: 36 }, { label: 'Categoria', width: 24 }, { label: 'Unid', width: 8 }, { label: 'Valor médio', width: 14, fmt: 'money' }, { label: 'Quant.', width: 10, fmt: 'dec' }, { label: 'Total bruto', width: 14, fmt: 'money' }];
    const linhasItens = d.itensVendidos.map(i => [i.nome_produto, i.categoria, i.unidade, i.valor_unitario, i.quantidade, i.total]);
    const colTrans = [{ label: 'Venda', width: 14 }, { label: 'Data', width: 17 }, { label: 'Operador', width: 18 }, { label: 'Pagamento', width: 16 }, { label: 'Itens', width: 50 }, { label: 'Bruto', width: 12, fmt: 'money' }, { label: 'Desconto', width: 12, fmt: 'money' }, { label: 'Total', width: 12, fmt: 'money' }];
    const linhasTrans = d.transacoes.map(t => [t.codigo_venda, t.data_venda, t.usuario_nome, t.forma_pagamento, t.itens_resumo, t.bruto, t.desconto, t.valor_total]);
    const totalRow = Object.assign(['TOTAL', '', '', '', '', d.totalBruto, d.totalDescontos, d.totalGeral], { __bold: true });
    return {
      titulo: 'Relatório de Faturamento e Vendas', subtitulo: resumo, landscape: true,
      sheets: [
        { name: 'Vendidos por produto', title: 'Relatório de Faturamento e Vendas', subtitle: resumo[0], columns: colItens, rows: linhasItens },
        { name: 'Transações', title: 'Transações do período', subtitle: resumo[1], columns: colTrans, rows: [...linhasTrans, totalRow] }
      ],
      sections: [
        { heading: 'Produtos vendidos', columns: [{ label: 'Produto', w: 4 }, { label: 'Categoria', w: 3 }, { label: 'Unid', w: 1 }, { label: 'Valor médio', w: 2, align: 'right' }, { label: 'Quant.', w: 1.5, align: 'right' }, { label: 'Total bruto', w: 2, align: 'right' }],
          rows: d.itensVendidos.map(i => [i.nome_produto, i.categoria, i.unidade, brl(i.valor_unitario), num(i.quantidade), brl(i.total)]) },
        { heading: 'Transações', columns: [{ label: 'Venda', w: 2 }, { label: 'Data', w: 2.4 }, { label: 'Operador', w: 2.4 }, { label: 'Pagamento', w: 2.2 }, { label: 'Itens', w: 6 }, { label: 'Total', w: 2, align: 'right' }],
          rows: [...d.transacoes.map(t => [t.codigo_venda, t.data_venda, t.usuario_nome, t.forma_pagamento, t.itens_resumo, brl(t.valor_total)]), Object.assign(['TOTAL', '', '', '', '', brl(d.totalGeral)], { __bold: true })] }
      ]
    };
  });
});

route('GET', '/api/reports/stock', { perm: 'relatorios:ver' }, async ctx => {
  const r = await db.getRelatorioEstoque({ from: ctx.query.from, to: ctx.query.to, categoria: ctx.query.categoria });
  return entregarRelatorio(ctx, 'estoque', r, (d, cats) => {
    const sub = [descPeriodo(d.filtros, cats), `Produtos: ${d.totalProdutos}  |  Em nível crítico: ${d.totalCriticos}  |  Valor em estoque (custo): ${brl(d.valorTotalEstoque)}`];
    return {
      titulo: 'Relatório de Estoque (entradas, saídas e saldo)', subtitulo: sub, landscape: true,
      sheets: [{
        name: 'Estoque', title: 'Relatório de Estoque', subtitle: sub[0],
        columns: [{ label: 'Código', width: 12 }, { label: 'Produto', width: 36 }, { label: 'Categoria', width: 24 }, { label: 'Unid', width: 8 }, { label: 'Entradas', width: 11, fmt: 'dec' }, { label: 'Saídas', width: 11, fmt: 'dec' }, { label: 'Saldo atual', width: 12, fmt: 'dec' }, { label: 'Estoque mín.', width: 12, fmt: 'dec' }, { label: 'Valor em estoque', width: 16, fmt: 'money' }, { label: 'Situação', width: 11 }],
        rows: d.linhas.map(l => [l.codigo_barras, l.nome_produto, l.categoria, l.unidade, l.entradas, l.saidas, l.saldo_atual, l.estoque_minimo, l.valor_em_estoque, l.situacao])
      }],
      sections: [{
        columns: [{ label: 'Código', w: 1.6 }, { label: 'Produto', w: 4.5 }, { label: 'Categoria', w: 3 }, { label: 'Unid', w: 1 }, { label: 'Entradas', w: 1.4, align: 'right' }, { label: 'Saídas', w: 1.4, align: 'right' }, { label: 'Saldo', w: 1.4, align: 'right' }, { label: 'Mín.', w: 1.2, align: 'right' }, { label: 'Situação', w: 1.6 }],
        rows: d.linhas.map(l => [l.codigo_barras, l.nome_produto, l.categoria, l.unidade, num(l.entradas), num(l.saidas), num(l.saldo_atual), num(l.estoque_minimo), l.situacao])
      }]
    };
  });
});

route('GET', '/api/reports/losses', { perm: 'relatorios:ver' }, async ctx => {
  const r = await db.getRelatorioPerdas({ from: ctx.query.from, to: ctx.query.to, categoria: ctx.query.categoria });
  return entregarRelatorio(ctx, 'perdas', r, (d, cats) => {
    const motivos = d.porMotivo.map(m => `${m.motivo}: ${brl(m.valor_total)}`).join('  |  ');
    const sub = [descPeriodo(d.filtros, cats), `Registros: ${d.totalRegistros}  |  Valor perdido (custo): ${brl(d.valorTotal)}${motivos ? `  |  ${motivos}` : ''}`];
    const totalRow = Object.assign(['TOTAL', '', '', '', d.valorTotal], { __bold: true });
    return {
      titulo: 'Relatório de Desperdício (perdas e sobras)', subtitulo: sub, landscape: true,
      sheets: [
        { name: 'Por produto', title: 'Relatório de Desperdício', subtitle: sub[0],
          columns: [{ label: 'Produto', width: 36 }, { label: 'Categoria', width: 24 }, { label: 'Unid', width: 8 }, { label: 'Quant. perdida', width: 14, fmt: 'dec' }, { label: 'Valor (custo)', width: 14, fmt: 'money' }],
          rows: [...d.porProduto.map(p => [p.nome_produto, p.categoria, p.unidade, p.quantidade, p.valor_total]), totalRow] },
        { name: 'Registros', title: 'Registros de perda', subtitle: sub[1],
          columns: [{ label: 'Data', width: 17 }, { label: 'Produto', width: 36 }, { label: 'Motivo', width: 16 }, { label: 'Quant.', width: 10, fmt: 'dec' }, { label: 'Unid', width: 8 }, { label: 'Valor (custo)', width: 14, fmt: 'money' }, { label: 'Responsável', width: 18 }, { label: 'Observação', width: 40 }],
          rows: d.registros.map(r => [r.data_movimentacao, r.produto_nome, r.motivo_perda, r.quantidade, r.unidade, r.valor_total, r.usuario_nome, r.observacao]) }
      ],
      sections: [
        { heading: 'Perdas por produto', columns: [{ label: 'Produto', w: 4.5 }, { label: 'Categoria', w: 3 }, { label: 'Unid', w: 1 }, { label: 'Quant.', w: 1.5, align: 'right' }, { label: 'Valor (custo)', w: 2, align: 'right' }],
          rows: [...d.porProduto.map(p => [p.nome_produto, p.categoria, p.unidade, num(p.quantidade), brl(p.valor_total)]), Object.assign(['TOTAL', '', '', '', brl(d.valorTotal)], { __bold: true })] },
        { heading: 'Registros', columns: [{ label: 'Data', w: 2.4 }, { label: 'Produto', w: 4 }, { label: 'Motivo', w: 2.2 }, { label: 'Quant.', w: 1.4, align: 'right' }, { label: 'Valor', w: 1.8, align: 'right' }, { label: 'Responsável', w: 2.4 }],
          rows: d.registros.map(r => [r.data_movimentacao, r.produto_nome, r.motivo_perda, `${num(r.quantidade)} ${r.unidade}`, brl(r.valor_total), r.usuario_nome]) }
      ]
    };
  });
});

// ------------------------------------------------------------------ servidor
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);
  const method = req.method;

  if (pathname.startsWith('/api/')) {
    try {
      const rota = routes.find(r => r.method === method && r.re.test(pathname));
      if (!rota) {
        if (routes.some(r => r.re.test(pathname))) throw new HttpError(405, 'Método não permitido.');
        throw new HttpError(404, 'Rota não encontrada.');
      }
      const m = rota.re.exec(pathname);
      const params = {};
      rota.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      const token = parseCookies(req)[COOKIE];
      const dbUser = await db.getSessionUser(token);
      const user = dbUser ? db.publicUser(dbUser) : null;
      if (!rota.opts.public && !user) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
      const ctx = { req, res, params, query: Object.fromEntries(u.searchParams), user, body: {} };
      if (user && rota.opts.perm) exigir(ctx, rota.opts.perm);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) ctx.body = await parseBody(req);
      const out = await rota.handler(ctx);
      if (user && method !== 'GET' && !pathname.startsWith('/api/auth/')) {
        logger.log('INFO', 'operacao', { metodo: method, rota: pathname }, user.email);
      }
      if (out && out.raw) {
        res.writeHead(out.status, { ...SEC_HEADERS, ...out.headers });
        return res.end(out.body);
      }
      return sendJson(res, out.status || 200, out.body, out.headers);
    } catch (err) {
      const status = err.status || 400;
      if (status >= 500) logger.log('ERRO', 'falha_interna', { rota: pathname, erro: err.stack || String(err) });
      else if (status === 401 || status === 403) logger.log('AVISO', 'acesso_negado', { rota: pathname, status, motivo: err.message });
      return sendJson(res, status, { success: false, error: err.message || 'Erro no processamento da requisição' });
    }
  }

  // Arquivos enviados (imagens de produtos)
  if (pathname.startsWith('/uploads/')) {
    const f = path.join(UPLOAD_DIR, path.basename(pathname));
    return fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404, SEC_HEADERS); return res.end('Não encontrado'); }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', ...SEC_HEADERS });
      res.end(buf);
    });
  }

  // Frontend estático (SPA)
  const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Acesso Negado'); }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (path.extname(pathname)) { res.writeHead(404, SEC_HEADERS); return res.end('Não encontrado'); }
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404); return res.end('Não encontrado'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8', ...SEC_HEADERS });
        res.end(idx);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
    res.end(content);
  });
});

if (require.main === module) {
  db.testarConexao().then(() => db.verificarEsquema().catch(err => {
    console.error(`[GestFast ERP] ${err.message}`);
    process.exit(1);
  })).then(() => {
    server.listen(PORT, () => {
      console.log(`[GestFast ERP] Servidor rodando em http://localhost:${PORT}`);
      console.log(`[GestFast ERP] Banco MySQL: ${process.env.DB_NAME || 'gestfast'} em ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`);
    });
  }).catch(err => {
    console.error('[GestFast ERP] Não foi possível conectar ao MySQL:', err.code || err.message);
    console.error('Confira se o MySQL está rodando e se o arquivo .env existe com a senha certa (modelo em .env.example).');
    process.exit(1);
  });
}

module.exports = server;
