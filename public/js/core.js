// core.js - Núcleo do front-end: estado, utilitários, API, modais, navegação, busca e acessibilidade
(function () {
  'use strict';
  const GF = window.GF = {
    state: { user: null, perms: [], settings: {}, categories: [], suppliers: [], products: [] },
    views: {}
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  GF.$ = $; GF.$$ = $$;
  const pad = n => String(n).padStart(2, '0');

  // ---------------------------------------------------------------- formatação
  GF.esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  GF.money = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  GF.num2 = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  GF.qty = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  GF.date = s => {
    if (!s) return '-';
    const [d, h] = String(s).split(' ');
    const p = d.split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}${h ? ' ' + h : ''}` : s;
  };
  // A data de referência é a do servidor (evita divergência de fuso entre o navegador e o estabelecimento)
  GF.today = () => { if (GF.state.hoje) return GF.state.hoje; const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  GF.syncToday = async () => { try { const r = await GF.get('/api/settings', true); GF.state.hoje = r.hoje; GF.state.settings = r.settings; } catch (e) { /* mantém */ } };
  GF.can = perm => GF.state.perms.includes(perm);
  // Situação da validade: dias até vencer (negativo = vencido) e o rótulo exibido.
  GF.validade = v => {
    if (!v) return null;
    const dias = Math.round((Date.parse(v) - Date.parse(GF.today())) / 86400000);
    const lim = Number((GF.state.settings || {}).diasAlertaValidade);
    const alerta = dias <= (Number.isFinite(lim) ? lim : 3);
    const texto = dias < 0 ? `Vencido há ${-dias} dia(s)` : dias === 0 ? 'Vence hoje' : `Vence em ${dias} dia(s)`;
    return { dias, alerta, vencido: dias < 0, texto };
  };
  GF.fractional = un => ['kg', 'lt', 'l'].includes(String(un || '').toLowerCase());
  GF.qtyAttrs = un => (GF.fractional(un) ? { min: '0.001', step: '0.001' } : { min: '1', step: '1' });
  GF.applyQtyAttrs = (input, un) => { const a = GF.qtyAttrs(un); input.min = a.min; input.step = a.step; };
  // Ícone do sprite SVG do index.html (ex.: GF.icon('trash')).
  GF.icon = (nome, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
  // Valor monetário curto para os cartões do painel (R$ 1,2 mil).
  GF.moneyShort = n => (Math.abs(n) >= 10000
    ? Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
    : GF.money(n));

  const EMOJI_CAT = { 1: '🍞', 2: '☕', 3: '🌾', 4: '🍰', 5: '🧀' };
  GF.imgFor = p => {
    if (p && p.imagem) return '/' + p.imagem;
    const e = EMOJI_CAT[p && p.id_categoria] || '📦';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f3f4f6"/><text x="50" y="66" font-size="52" text-anchor="middle">${e}</text></svg>`);
  };

  // ---------------------------------------------------------------- toast, modal, confirmação
  GF.toast = (msg, type = 'info') => {
    const box = $('#toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.innerHTML = `${GF.icon(type === 'success' ? 'ok' : type === 'error' ? 'alert' : 'info', 'icon toast-ico')}<span class="toast-msg"></span><button type="button" class="toast-close" aria-label="Fechar aviso">&times;</button>`;
    $('.toast-msg', t).textContent = msg;
    const sair = () => { if (t.classList.contains('saindo')) return; t.classList.add('saindo'); setTimeout(() => t.remove(), 200); };
    $('.toast-close', t).addEventListener('click', sair);
    box.appendChild(t);
    while (box.children.length > 4) box.firstElementChild.remove(); // no máximo 4 avisos na tela
    setTimeout(sair, type === 'error' ? 6500 : 3800);
  };

  // Mantém o Tab dentro do modal aberto (acessibilidade).
  const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  GF.prenderFoco = (e, box) => {
    if (e.key !== 'Tab') return;
    const els = $$(FOCAVEIS, box).filter(el => el.offsetParent !== null);
    if (!els.length) return;
    const [ini, fim] = [els[0], els[els.length - 1]];
    if (e.shiftKey && document.activeElement === ini) { e.preventDefault(); fim.focus(); }
    else if (!e.shiftKey && document.activeElement === fim) { e.preventDefault(); ini.focus(); }
  };

  GF.openModal = ({ title, html, wide = false, onMount }) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.innerHTML = `<div class="modal-box${wide ? ' modal-wide' : ''}"><div class="modal-header"><h3>${GF.esc(title)}</h3><button class="modal-close" aria-label="Fechar" title="Fechar">&times;</button></div><div class="modal-body-dyn">${html}</div></div>`;
    document.body.appendChild(back);
    const prev = document.activeElement;
    const onKey = e => {
      const abertos = Array.from(document.querySelectorAll('.modal-backdrop:not(.is-hidden)'));
      if (abertos[abertos.length - 1] !== back) return;
      if (e.key === 'Escape') close(); else GF.prenderFoco(e, back);
    };
    const close = () => { document.removeEventListener('keydown', onKey); back.remove(); if (prev && prev.focus) prev.focus(); };
    document.addEventListener('keydown', onKey);
    $('.modal-close', back).addEventListener('click', close);
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    const api = { el: back, close, $: s => $(s, back) };
    if (onMount) onMount(api);
    const first = $('input:not([type=hidden]), select, textarea, button.btn', $('.modal-body-dyn', back));
    if (first) first.focus();
    return api;
  };

  GF.confirm = (msg, { okLabel = 'Confirmar', danger = false, title = 'Confirmação' } = {}) => new Promise(resolve => {
    let decided = false;
    const m = GF.openModal({
      title, html: `<p class="confirm-msg">${GF.esc(msg)}</p><div class="modal-actions"><button class="btn btn-secondary" data-no>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${GF.esc(okLabel)}</button></div>`,
      onMount: api => {
        api.$('[data-yes]').addEventListener('click', () => { decided = true; api.close(); resolve(true); });
        api.$('[data-no]').addEventListener('click', () => { decided = true; api.close(); resolve(false); });
      }
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!decided) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });

  GF.showModalStatic = id => { const m = $(id); m.classList.remove('is-hidden'); const f = $('input:not([type=hidden]), select, textarea', m); if (f) f.focus(); };
  GF.hideModalStatic = id => $(id).classList.add('is-hidden');

  // contador de caracteres com mínimo
  GF.bindCounter = (ta, counter, min, max) => {
    const upd = () => {
      const n = ta.value.trim().length;
      counter.textContent = `${n} / ${max} caracteres (mínimo ${min})`;
      counter.className = 'char-counter ' + (n === 0 ? 'counter-neutral' : n >= min ? 'counter-valid' : 'counter-invalid');
    };
    ta.addEventListener('input', upd); upd();
    return upd;
  };

  GF.marcarErro = (el, ativo = true) => { el.classList.toggle('input-error', ativo); if (ativo) el.focus(); };
  GF.limparErros = root => $$('.input-error', root).forEach(e => e.classList.remove('input-error'));

  // ---------------------------------------------------------------- API
  GF.api = async (url, opts = {}, silent = false) => {
    let res, data;
    try {
      res = await fetch(url, {
        credentials: 'same-origin', ...opts,
        headers: { 'Content-Type': 'application/json' },
        body: opts.body !== undefined && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
      });
      data = await res.json();
    } catch (e) {
      const err = new Error('Erro de conexão com o sistema. Verifique a rede e tente novamente.');
      if (!silent) GF.toast(err.message, 'error');
      throw err;
    }
    if (res.status === 401 && !url.startsWith('/api/auth/login')) {
      if (GF.state.user) { GF.state.user = null; GF.showLogin('Sua sessão expirou. Faça login novamente.'); }
    }
    if (!res.ok || data.success === false) {
      const err = new Error(data.error || 'Erro ao processar a operação.');
      err.status = res.status;
      if (!silent && res.status !== 401) GF.toast(err.message, 'error');
      throw err;
    }
    return data;
  };
  GF.get = (u, s) => GF.api(u, {}, s);
  GF.post = (u, b, s) => GF.api(u, { method: 'POST', body: b || {} }, s);
  GF.put = (u, b, s) => GF.api(u, { method: 'PUT', body: b || {} }, s);
  GF.patch = (u, b, s) => GF.api(u, { method: 'PATCH', body: b || {} }, s);
  GF.del = (u, b, s) => GF.api(u, { method: 'DELETE', body: b || {} }, s);

  GF.download = async (url, fallbackName) => {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) { let m = 'Falha ao gerar o arquivo.'; try { m = (await res.json()).error || m; } catch (e) { /* binário */ } throw new Error(m); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const nome = (/filename="([^"]+)"/.exec(cd) || [])[1] || fallbackName;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return true;
    } catch (e) { GF.toast(e.message, 'error'); return false; }
  };

  // Paginação: desenha "1–50 de 320" + botões em `el`; `ir(offset)` carrega a página pedida.
  GF.POR_PAGINA = 50;
  GF.pager = (el, { total, offset, limite = GF.POR_PAGINA, ir }) => {
    if (!total || total <= limite) { el.innerHTML = total ? `<span>${total} registro(s)</span>` : ''; return; }
    const pag = Math.floor(offset / limite) + 1, pags = Math.ceil(total / limite);
    el.innerHTML = `<span>${(offset + 1).toLocaleString('pt-BR')}–${Math.min(offset + limite, total).toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}</span>
      <span class="pager-btns">
        <button class="btn btn-sm btn-secondary" data-pg="0" ${pag === 1 ? 'disabled' : ''} aria-label="Primeira página">${GF.icon('chevrons-left', 'icon icon-sm')}</button>
        <button class="btn btn-sm btn-secondary" data-pg="${offset - limite}" ${pag === 1 ? 'disabled' : ''} aria-label="Página anterior">${GF.icon('chevron-left', 'icon icon-sm')}</button>
        <span class="pager-page">${pag} / ${pags}</span>
        <button class="btn btn-sm btn-secondary" data-pg="${offset + limite}" ${pag === pags ? 'disabled' : ''} aria-label="Próxima página">${GF.icon('chevron-right', 'icon icon-sm')}</button>
      </span>`;
    el.onclick = e => { const b = e.target.closest('[data-pg]'); if (b && !b.disabled) ir(Number(b.dataset.pg)); };
  };

  GF.delegate = (root, ev, sel, fn) => root.addEventListener(ev, e => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });

  // dados de apoio
  GF.loadCategories = async () => { GF.state.categories = (await GF.get('/api/categories')).categories; return GF.state.categories; };
  GF.loadSuppliers = async () => { GF.state.suppliers = (await GF.get('/api/suppliers')).suppliers; return GF.state.suppliers; };
  GF.loadProducts = async (q = '', status = 'Ativo') => { GF.state.products = (await GF.get(`/api/products?status=${status}&q=${encodeURIComponent(q)}`)).products; return GF.state.products; };
  GF.categoryName = id => (GF.state.categories.find(c => c.id_categoria === Number(id)) || {}).nome_categoria || '-';
  GF.fillCategorySelect = (sel, todas) => {
    sel.innerHTML = (todas ? `<option value="">${GF.esc(todas)}</option>` : '') + GF.state.categories.map(c => `<option value="${c.id_categoria}">${GF.esc(c.nome_categoria)}</option>`).join('');
  };
  GF.profileLabel = p => ({ Administrador: 'Administrador', BackOffice: 'BackOffice', Funcionario: 'Funcionário' }[p] || p);

  // ---------------------------------------------------------------- navegação
  const VIEW_TITLES = {};
  GF.navigate = (id, { replace = false } = {}) => {
    const item = $(`.nav-item[data-view="${id}"]`);
    if (!item) id = 'dashboard';
    const nav = $(`.nav-item[data-view="${id}"]`);
    if (nav && nav.dataset.perm && !GF.can(nav.dataset.perm)) {
      GF.toast('Seu perfil não tem permissão para acessar esta área.', 'error');
      id = 'dashboard';
    }
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));
    $$('.app-view').forEach(v => v.classList.toggle('active', v.id === `view-${id}`));
    GF.state.currentView = id;
    if (location.hash !== `#${id}`) { if (replace) history.replaceState(null, '', `#${id}`); else location.hash = id; }
    closeSidebar();
    $('#main-content').scrollTop = 0;
    if (GF.views[id] && GF.views[id].load) GF.views[id].load();
    if (id !== 'dashboard' && GF.views.dashboard && GF.views.dashboard.stop) GF.views.dashboard.stop();
  };
  GF.applyPermissions = () => {
    $$('[data-perm]').forEach(el => { el.classList.toggle('perm-hidden', !GF.can(el.dataset.perm)); });
  };
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebar-scrim').classList.remove('show'); }

  // ---------------------------------------------------------------- busca global
  // Procura telas do sistema (local) e conteúdo: produtos, requisições, vendas e funcionários (servidor,
  // já filtrado pelo perfil do usuário).
  const OPCOES = [
    { label: 'Início (Dashboard)', icon: 'home', desc: 'Alertas, compras recentes e distribuição do estoque', view: 'dashboard', k: 'inicio dashboard painel home alertas', perm: 'dashboard:ver' },
    { label: 'Verificar Estoque', icon: 'box', desc: 'Conferência física e divergências', view: 'estoque', k: 'estoque conferencia verificar inventario contagem', perm: 'estoque:conferir' },
    { label: 'Requisições de Compra', icon: 'clipboard', desc: 'Pedidos aos fornecedores', view: 'requisicoes', k: 'requisicao requisicoes pedido compra fornecedor', perm: 'requisicoes:ver' },
    { label: 'Cadastro de Produtos', icon: 'tag', desc: 'Incluir, alterar e inativar produtos', view: 'cadastro', k: 'cadastro produto cadastrar novo catalogo', perm: 'produtos:editar' },
    { label: 'Saída de Produtos', icon: 'out', desc: 'Baixas, descartes e perdas', view: 'saidas', k: 'saida saidas baixa descarte perda', perm: 'movimentos:ver' },
    { label: 'Entrada de Produtos', icon: 'in', desc: 'Recebimentos e reposição', view: 'entradas', k: 'entrada entradas recebimento reposicao', perm: 'movimentos:ver' },
    { label: 'Venda (Caixa)', icon: 'cart', desc: 'Registrar vendas no balcão', view: 'vendas', k: 'venda vendas caixa pdv vender carrinho', perm: 'vendas:vender' },
    { label: 'Histórico de Vendas', icon: 'receipt', desc: 'Consultar, editar e cancelar vendas', view: 'historico', k: 'historico vendas cancelar editar consultar', perm: 'vendas:ver' },
    { label: 'Relatórios', icon: 'chart', desc: 'Faturamento e estoque, em PDF ou Excel', view: 'relatorios', k: 'relatorio relatorios faturamento exportar pdf excel', perm: 'relatorios:ver' },
    { label: 'Funcionários', icon: 'users', desc: 'Acessos e perfis', view: 'funcionarios', k: 'funcionario funcionarios usuario acesso perfil login', perm: 'usuarios:gerir' },
    { label: 'Configuração', icon: 'settings', desc: 'Parâmetros, senha e acessibilidade', view: 'configuracoes', k: 'configuracao configuracoes config senha acessibilidade logs', perm: null },
    { label: 'Ajuda', icon: 'help', desc: 'Sobre o sistema e perfis de acesso', view: 'ajuda', k: 'ajuda sobre suporte', perm: null }
  ];
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // destaca o trecho digitado (sem diferenciar acentos nem maiúsculas)
  function hl(texto, q) {
    const t = String(texto === undefined || texto === null ? '' : texto), nq = norm(q);
    if (!nq) return GF.esc(t);
    const nt = norm(t), i = nt.indexOf(nq);
    if (i < 0 || nt.length !== t.length) return GF.esc(t);
    return GF.esc(t.slice(0, i)) + '<mark class="sr-mark">' + GF.esc(t.slice(i, i + nq.length)) + '</mark>' + GF.esc(t.slice(i + nq.length));
  }

  // ações ao escolher um resultado de conteúdo
  const ACOES = {
    produto: p => {
      if (GF.can('produtos:editar')) GF.views.cadastro.abrirProduto(p.id_produto);
      else { GF.views.estoque.filtrar = p.nome_produto; GF.navigate('estoque'); }
    },
    requisicao: r => { GF.views.requisicoes.selecionar = r.id_requisicao; GF.navigate('requisicoes'); },
    venda: v => GF.views.historico.abrir(v),
    usuario: u => { GF.$('#func-busca').value = u.nome; GF.navigate('funcionarios'); }
  };

  function itensRemotos(r) {
    const g = [];
    if (r.produtos.length) g.push({ titulo: 'Produtos', itens: r.produtos.map(p => ({ icon: 'box', tag: 'Produto', t: p.nome_produto, s: `${p.codigo_barras} • ${p.categoria} • ${GF.qty(p.quantidade_estoque)} ${p.unidade} em estoque${p.status === 'Inativo' ? ' • Inativo' : ''}`, run: () => ACOES.produto(p) })) });
    if (r.requisicoes.length) g.push({ titulo: 'Requisições de compra', itens: r.requisicoes.map(x => ({ icon: 'clipboard', tag: 'Requisição', t: `${x.codigo_pedido} • ${x.produto_nome}`, s: `${x.fornecedor} • ${x.situacao}`, run: () => ACOES.requisicao(x) })) });
    if (r.vendas.length) g.push({ titulo: 'Vendas', itens: r.vendas.map(v => ({ icon: 'receipt', tag: 'Venda', t: `${v.codigo_venda} • ${GF.money(v.valor_total)}`, s: `${GF.date(v.data_venda)} • ${v.usuario_nome} • ${v.status_venda}`, run: () => ACOES.venda(v) })) });
    if (r.usuarios.length) g.push({ titulo: 'Funcionários', itens: r.usuarios.map(u => ({ icon: 'user', tag: 'Funcionário', t: u.nome, s: `${u.email} • ${GF.profileLabel(u.perfil)} • ${u.status}`, run: () => ACOES.usuario(u) })) });
    return g;
  }

  function initSearch() {
    const input = $('#global-search'), list = $('#search-results-list'), dd = $('#search-results-dropdown'), clear = $('#search-clear-btn'), hint = $('#search-predictive-hint');
    const rodape = document.createElement('div');
    rodape.className = 'sr-footer';
    rodape.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Esc</kbd> fechar</span>';
    dd.appendChild(rodape);
    const cab = $('.search-dropdown-header', dd);
    let itens = [], ativo = 0, seq = 0, timer = null, remoto = null, buscando = false;

    const fechar = () => { dd.classList.add('is-hidden'); };
    const executar = it => { if (!it) return; fechar(); input.value = ''; clear.classList.add('is-hidden'); hint.textContent = ''; remoto = null; it.run(); };

    function telasPara(q) {
      const t = norm(q);
      return OPCOES.filter(o => (!o.perm || GF.can(o.perm)) && (!t || norm(o.label).includes(t) || norm(o.k).includes(t) || norm(o.desc).includes(t)))
        .map(o => ({ icon: o.icon, tag: 'Tela', t: o.label, s: o.desc, run: () => GF.navigate(o.view) }));
    }

    function render() {
      const q = input.value.trim();
      clear.classList.toggle('is-hidden', !q);
      const grupos = [];
      const telas = telasPara(q);
      if (telas.length) grupos.push({ titulo: q ? 'Ir para' : 'Telas do sistema', itens: q ? telas.slice(0, 4) : telas });
      if (remoto && remoto.q === q) grupos.push(...remoto.grupos);
      itens = grupos.flatMap(g => g.itens);
      if (ativo >= itens.length) ativo = Math.max(0, itens.length - 1);
      const pred = q && telas.length && norm(telas[0].t).startsWith(norm(q)) ? telas[0].t : '';
      hint.textContent = pred ? input.value + pred.slice(input.value.length) : '';
      cab.textContent = q ? `Resultados para “${q}”` : 'Para onde deseja ir?';
      let n = -1, html = '';
      grupos.forEach(g => {
        html += `<div class="sr-group">${GF.esc(g.titulo)}</div>`;
        g.itens.forEach(it => {
          n++;
          html += `<div class="search-option-item${n === ativo ? ' highlighted' : ''}" data-i="${n}" role="option"><span class="option-icon">${GF.icon(it.icon)}</span><span class="option-texts"><span class="option-title">${hl(it.t, q)}</span><span class="option-desc">${hl(it.s, q)}</span></span><span class="option-tag tag-${norm(it.tag)}">${GF.esc(it.tag)}</span></div>`;
        });
      });
      if (q && q.length < 2) html += '<div class="sr-status">Digite ao menos 2 letras para buscar produtos, requisições e vendas.</div>';
      else if (buscando && !(remoto && remoto.q === q)) html += '<div class="sr-status">Buscando produtos, requisições e vendas…</div>';
      else if (!itens.length) html += `<div class="sr-empty"><strong>Nenhum resultado para “${GF.esc(q)}”</strong><span>Tente outro termo, o código de barras ou o número do pedido (ex.: REQ-9661).</span></div>`;
      list.innerHTML = html;
      dd.classList.remove('is-hidden');
      const el = $('.highlighted', list); if (el) el.scrollIntoView({ block: 'nearest' });
    }

    function buscarConteudo() {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { remoto = null; buscando = false; return; }
      buscando = true;
      const meu = ++seq;
      timer = setTimeout(async () => {
        let grupos = [];
        try { grupos = itensRemotos((await GF.get('/api/search?q=' + encodeURIComponent(q), true)).results); } catch (e) { grupos = []; }
        if (meu !== seq) return; // resposta antiga: ignora
        buscando = false;
        remoto = { q, grupos };
        render();
      }, 220);
    }

    input.addEventListener('input', () => { ativo = 0; remoto = null; buscarConteudo(); render(); });
    input.addEventListener('focus', () => { render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (dd.classList.contains('is-hidden')) render(); else { ativo = Math.min(ativo + 1, itens.length - 1); render(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); ativo = Math.max(ativo - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); executar(itens[ativo]); }
      else if (e.key === 'Escape') { fechar(); input.blur(); }
      else if (e.key === 'Tab' && hint.textContent) { e.preventDefault(); const t = telasPara(input.value.trim())[0]; if (t) { input.value = t.t; ativo = 0; buscarConteudo(); render(); } }
    });
    list.addEventListener('mousedown', e => { const el = e.target.closest('.search-option-item'); if (el) { e.preventDefault(); executar(itens[Number(el.dataset.i)]); } });
    list.addEventListener('mousemove', e => { const el = e.target.closest('.search-option-item'); if (el && Number(el.dataset.i) !== ativo) { ativo = Number(el.dataset.i); GF.$$('.search-option-item', list).forEach(x => x.classList.toggle('highlighted', x === el)); } });
    clear.addEventListener('click', () => { input.value = ''; remoto = null; ativo = 0; render(); input.focus(); });
    document.addEventListener('click', e => { if (!e.target.closest('.search-container')) fechar(); });
    // atalho: "/" ou Ctrl+K focam a busca
    document.addEventListener('keydown', e => {
      const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if ((e.key === '/' && !digitando) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); input.focus(); input.select(); }
    });
  }

  // ---------------------------------------------------------------- acessibilidade (RNF 08)
  const ZOOMS = [100, 115, 130, 150];
  function applyA11y() {
    const z = Number(localStorage.getItem('gf_zoom')) || 100;
    document.documentElement.style.zoom = z === 100 ? '' : (z / 100);
    const hc = localStorage.getItem('gf_hc') === '1';
    document.documentElement.classList.toggle('hc', hc);
    $('#btn-contrast').setAttribute('aria-pressed', hc ? 'true' : 'false');
  }
  function stepZoom(dir) {
    const z = Number(localStorage.getItem('gf_zoom')) || 100;
    const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + dir));
    localStorage.setItem('gf_zoom', ZOOMS[i]); applyA11y();
  }
  function toggleContrast() { localStorage.setItem('gf_hc', localStorage.getItem('gf_hc') === '1' ? '0' : '1'); applyA11y(); }
  GF.initA11y = () => {
    try { applyA11y(); } catch (e) { /* storage indisponível */ }
    $('#btn-font-minus').addEventListener('click', () => stepZoom(-1));
    $('#btn-font-plus').addEventListener('click', () => stepZoom(1));
    $('#btn-contrast').addEventListener('click', toggleContrast);
    $('#cfg-font-minus').addEventListener('click', () => stepZoom(-1));
    $('#cfg-font-plus').addEventListener('click', () => stepZoom(1));
    $('#cfg-contrast').addEventListener('click', toggleContrast);
    $('#cfg-a11y-reset').addEventListener('click', () => { localStorage.removeItem('gf_zoom'); localStorage.removeItem('gf_hc'); applyA11y(); });
  };

  // Tema claro/escuro: segue o sistema até a pessoa escolher; a escolha fica salva no navegador.
  const temaAtual = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  function desenharBotaoTema() {
    const escuro = temaAtual() === 'dark';
    $('#btn-theme').innerHTML = GF.icon(escuro ? 'sun' : 'moon');
    $('#btn-theme').title = escuro ? 'Usar tema claro' : 'Usar tema escuro';
  }
  GF.onThemeChange = []; // o painel redesenha os gráficos quando o tema muda
  function alternarTema() {
    const novo = temaAtual() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem('gf_theme', novo); } catch (e) { /* storage indisponível */ }
    desenharBotaoTema();
    GF.onThemeChange.forEach(fn => fn());
  }

  GF.initShell = () => {
    initSearch();
    GF.initA11y();
    desenharBotaoTema();
    $('#btn-theme').addEventListener('click', alternarTema);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { desenharBotaoTema(); GF.onThemeChange.forEach(fn => fn()); });
    // menu lateral recolhido (só ícones) no computador
    try { document.body.classList.toggle('sidebar-min', localStorage.getItem('gf_sidebar_min') === '1'); } catch (e) { /* storage indisponível */ }
    $('#btn-sidebar-collapse').addEventListener('click', () => {
      const min = document.body.classList.toggle('sidebar-min');
      try { localStorage.setItem('gf_sidebar_min', min ? '1' : '0'); } catch (e) { /* storage indisponível */ }
    });
    // modais estáticos do index.html: Esc fecha e o Tab fica preso dentro do modal
    document.addEventListener('keydown', e => {
      const abertos = $$('.modal-backdrop[id]:not(.is-hidden)');
      const m = abertos[abertos.length - 1];
      if (!m || $$('.modal-backdrop:not([id])').length) return; // modal dinâmico por cima cuida de si
      if (e.key === 'Escape') GF.hideModalStatic('#' + m.id); else GF.prenderFoco(e, m);
    });
    $$('.nav-item').forEach(n => n.addEventListener('click', e => { e.preventDefault(); GF.navigate(n.dataset.view); }));
    $('#btn-header-home').addEventListener('click', () => GF.navigate('dashboard'));
    // menu do usuário (senha, texto, contraste e sair)
    const mb = $('#user-menu-btn'), mn = $('#user-menu');
    const alternarMenu = abrir => { mn.classList.toggle('is-hidden', !abrir); mb.setAttribute('aria-expanded', abrir ? 'true' : 'false'); };
    mb.addEventListener('click', e => { e.stopPropagation(); alternarMenu(mn.classList.contains('is-hidden')); });
    document.addEventListener('click', e => { if (!e.target.closest('.user-menu-wrap')) alternarMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') alternarMenu(false); });
    $('#um-senha').addEventListener('click', () => { alternarMenu(false); GF.openChangePassword(); });
    $('#btn-logout').addEventListener('click', () => alternarMenu(false));
    $('#logo-header-home').addEventListener('click', () => GF.navigate('dashboard'));
    $('#btn-menu-toggle').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#sidebar-scrim').classList.toggle('show'); });
    $('#sidebar-scrim').addEventListener('click', closeSidebar);
    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1);
      if (GF.state.user && id && id !== GF.state.currentView && $(`.nav-item[data-view="${id}"]`)) GF.navigate(id, { replace: true });
    });
  };

  // imagens quebradas: troca por ilustração padrão (sem handlers inline por causa da CSP)
  document.addEventListener('error', e => {
    const el = e.target;
    if (el && el.tagName === 'IMG' && !el.dataset.fb) { el.dataset.fb = '1'; el.src = GF.imgFor({}); }
  }, true);
})();
