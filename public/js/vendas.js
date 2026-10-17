// vendas.js - Caixa/PDV (RF 07) e Histórico de vendas: consultar, editar, cancelar e excluir (RF 08 / 09)
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let produtos = [], cart = [], selItem = null;

  const isAdmin = () => GF.state.user && GF.state.user.perfil === 'Administrador';
  const prod = id => produtos.find(p => p.id_produto === Number(id));
  const noCarrinho = id => cart.filter(i => i.id_produto === id).reduce((a, i) => a + i.qtd, 0);
  const round = (n, d = 2) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;

  // ------------------------------------------------------------ PDV
  function popularProdutos() {
    const sel = $('#pdv-produto-select'), atual = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' + produtos.map(p => `<option value="${p.id_produto}" ${p.quantidade_estoque <= 0 ? 'disabled' : ''}>${esc(p.nome_produto)} - ${GF.money(p.preco_venda)}/${esc(p.unidade)}</option>`).join('');
    if (atual && prod(atual)) sel.value = atual;
    produtoMudou();
  }

  function produtoMudou() {
    const p = prod($('#pdv-produto-select').value);
    const q = $('#pdv-quantidade');
    if (p) { GF.applyQtyAttrs(q, p.unidade); if (!GF.fractional(p.unidade) && !Number.isInteger(Number(q.value))) q.value = 1; }
    else { GF.applyQtyAttrs(q, 'UN'); }
    const disp = p ? round(p.quantidade_estoque - noCarrinho(p.id_produto), 3) : null;
    const b = $('#pdv-estoque-disponivel');
    b.textContent = p ? `${GF.qty(disp)} ${p.unidade}` : '--';
    b.classList.toggle('stock-low', !!p && disp <= p.estoque_minimo);
  }

  function totais() {
    const sub = round(cart.reduce((a, i) => a + i.qtd * i.preco, 0));
    const tipo = $('#pdv-desconto-tipo').value, bruto = Number($('#pdv-desconto').value) || 0;
    const desc = round(tipo === 'percentual' ? sub * bruto / 100 : bruto);
    return { sub, desc, total: round(sub - desc) };
  }

  function validarDesconto(t) {
    const bruto = Number($('#pdv-desconto').value) || 0;
    if (bruto < 0) return 'O desconto não pode ser negativo.';
    if ($('#pdv-desconto-tipo').value === 'percentual' && bruto > 100) return 'O desconto percentual não pode passar de 100%.';
    if (t.desc > t.sub) return 'O desconto não pode ser maior que o subtotal da venda.';
    const max = Number(GF.state.settings.descontoMaximoPercent);
    if (!isAdmin() && t.sub > 0 && (t.desc / t.sub) * 100 > max + 1e-9) return `Desconto acima do limite permitido (${max}% do subtotal).`;
    return null;
  }

  function renderCart() {
    const corpo = $('#pdv-carrinho-corpo');
    corpo.innerHTML = cart.length ? cart.map((i, ix) => `<tr data-ix="${ix}" class="row-select ${selItem === ix ? 'row-selected' : ''}">
      <td>${esc(i.nome)}</td><td>${GF.num2(i.preco)}</td><td>${GF.qty(i.qtd)} ${esc(i.unidade)}</td><td>${GF.num2(i.qtd * i.preco)}</td>
      <td><button class="btn-icon btn-action-cancel" data-rem="${ix}" title="Remover item" aria-label="Remover ${esc(i.nome)}">${GF.icon('trash')}</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">Nenhum item na venda. Selecione um produto e clique em "Inserir no Pedido".</td></tr>';
    const t = totais();
    $('#pdv-linhas-totais').innerHTML = `<span>Subtotal: <strong>${GF.money(t.sub)}</strong></span><span>Desconto: <strong>- ${GF.money(t.desc)}</strong></span>`;
    $('#pdv-total-final').textContent = GF.num2(t.total);
    atualizarTroco(t);
    produtoMudou();
  }

  function atualizarTroco(t = totais()) {
    const dinheiro = $('#pdv-forma-pagamento').value === 'Dinheiro';
    $('#pdv-recebido-row').classList.toggle('is-hidden', !dinheiro);
    const rec = $('#pdv-recebido').value;
    const b = $('#pdv-troco');
    if (!dinheiro || rec === '') { b.textContent = '--'; return; }
    const troco = round(Number(rec) - t.total);
    b.textContent = troco >= 0 ? GF.money(troco) : 'insuficiente';
    b.classList.toggle('stock-low', troco < 0);
  }

  async function adicionar() {
    const p = prod($('#pdv-produto-select').value);
    const qEl = $('#pdv-quantidade');
    if (!p) { GF.toast('Selecione um produto para inserir no pedido.', 'error'); $('#pdv-produto-select').focus(); return; }
    const q = Number(qEl.value);
    if (!(q > 0)) { GF.marcarErro(qEl); GF.toast('Informe uma quantidade maior que zero.', 'error'); return; }
    if (!GF.fractional(p.unidade) && !Number.isInteger(q)) { GF.marcarErro(qEl); GF.toast(`${p.nome_produto} é vendido em ${p.unidade}: informe uma quantidade inteira.`, 'error'); qEl.value = Math.max(1, Math.round(q)); return; }
    const disp = round(p.quantidade_estoque - noCarrinho(p.id_produto), 3);
    if (q > disp) { GF.marcarErro(qEl); GF.toast(`Quantidade indisponível em estoque! Disponível: ${GF.qty(disp)} ${p.unidade}.`, 'error'); return; }
    const val = GF.validade(p.validade);
    if (val && val.vencido && !(await GF.confirm(`"${p.nome_produto}" está VENCIDO (validade ${GF.date(p.validade)}). Deseja adicionar ao pedido mesmo assim?`, { okLabel: 'Adicionar mesmo assim', danger: true, title: 'Produto vencido' }))) return;
    const ex = cart.find(i => i.id_produto === p.id_produto);
    if (ex) ex.qtd = round(ex.qtd + q, 3);
    else cart.push({ id_produto: p.id_produto, nome: p.nome_produto, unidade: p.unidade, preco: p.preco_venda, qtd: round(q, 3) });
    selItem = null;
    qEl.value = 1; qEl.classList.remove('input-error');
    renderCart();
    $('#pdv-busca-codigo').focus();
  }

  function buscarCodigo() {
    const t = $('#pdv-busca-codigo').value.trim().toLowerCase();
    if (!t) return;
    let achados = produtos.filter(p => p.codigo_barras.toLowerCase() === t);
    if (!achados.length) achados = produtos.filter(p => `${p.nome_produto} ${p.codigo_barras}`.toLowerCase().includes(t));
    if (!achados.length) { GF.toast('Produto não cadastrado.', 'error'); GF.marcarErro($('#pdv-busca-codigo')); return; }
    if (achados.length > 1) { GF.toast(`${achados.length} produtos encontrados: refine a busca ou escolha na lista.`, 'info'); }
    $('#pdv-produto-select').value = String(achados[0].id_produto);
    $('#pdv-busca-codigo').value = ''; $('#pdv-busca-codigo').classList.remove('input-error');
    produtoMudou();
    $('#pdv-quantidade').focus(); $('#pdv-quantidade').select();
  }

  async function finalizar() {
    if (!cart.length) { GF.toast('Nenhum item inserido na venda.', 'error'); return; }
    const t = totais();
    const erroDesc = validarDesconto(t);
    if (erroDesc) { GF.marcarErro($('#pdv-desconto')); GF.toast(erroDesc, 'error'); return; }
    const forma = $('#pdv-forma-pagamento').value;
    const rec = $('#pdv-recebido').value;
    if (forma === 'Dinheiro' && rec !== '' && Number(rec) < t.total) { GF.marcarErro($('#pdv-recebido')); GF.toast('O valor recebido é menor que o total da venda.', 'error'); return; }
    const btn = $('#pdv-btn-finalizar-venda'); btn.disabled = true;
    try {
      const r = await GF.post('/api/sales', {
        itens: cart.map(i => ({ id_produto: i.id_produto, quantidade: i.qtd })), forma_pagamento: forma,
        desconto: Number($('#pdv-desconto').value) || 0, desconto_tipo: $('#pdv-desconto-tipo').value, valor_recebido: forma === 'Dinheiro' && rec !== '' ? Number(rec) : undefined
      });
      const v = r.sale;
      GF.toast(`${r.message} • ${v.codigo_venda} • ${GF.money(v.valor_total)}${v.troco ? ` • Troco ${GF.money(v.troco)}` : ''}`, 'success');
      limparVenda(true);
      await carregarProdutos();
    } catch (e) { /* toast exibido (ex.: cartão negado); a venda permanece aberta */ }
    finally { btn.disabled = false; }
  }

  function limparVenda(silencioso) {
    cart = []; selItem = null;
    $('#pdv-desconto').value = 0; $('#pdv-recebido').value = ''; $('#pdv-quantidade').value = 1;
    renderCart();
    if (!silencioso) GF.toast('Venda limpa.', 'info');
  }

  async function carregarProdutos() {
    try { produtos = (await GF.get('/api/products')).products; popularProdutos(); } catch (e) { /* toast */ }
  }

  GF.views.vendas = {
    load: async () => {
      $('#pdv-atendente').textContent = GF.state.user.nome;
      try { GF.state.settings = (await GF.get('/api/settings', true)).settings; } catch (e) { /* mantém */ }
      await carregarProdutos(); renderCart();
      setTimeout(() => $('#pdv-busca-codigo').focus(), 50);
    }
  };

  // ------------------------------------------------------------ Histórico
  let vendas = [];
  const badgeV = s => `<span class="badge-status-pill ${s === 'Concluída' ? 'badge-success' : 'badge-urgent'}">${esc(s)}</span>`;

  // Lista paginada (50 por página); total e faturamento vêm do servidor para o filtro inteiro.
  async function carregarHist(offset = 0) {
    if (typeof offset !== 'number') offset = 0; // chamado direto por eventos
    const q = [`from=${$('#hist-de').value}`, `to=${$('#hist-ate').value}`, `q=${encodeURIComponent($('#hist-busca').value.trim())}`, `status=${encodeURIComponent($('#hist-status').value)}`, `limit=${GF.POR_PAGINA}`, `offset=${offset}`].join('&');
    try {
      const r = await GF.get(`/api/sales?${q}`);
      vendas = r.sales;
      $('#hist-resumo').textContent = `${r.total.toLocaleString('pt-BR')} venda(s) • faturamento ${GF.money(r.faturamento)}`;
      GF.pager($('#hist-pager'), { total: r.total, offset, ir: carregarHist });
      $('#hist-tabela-corpo').innerHTML = vendas.length ? vendas.map(v => `<tr data-id="${v.id_venda}" class="${v.status_venda === 'Cancelada' ? 'row-inactive' : ''}">
        <td><strong>${esc(v.codigo_venda)}</strong></td><td>${GF.date(v.data_venda)}</td><td>${esc(v.usuario_nome)}</td><td>${esc(v.forma_pagamento)}</td>
        <td class="cell-itens">${esc(v.itens.map(i => `${i.nome_produto} x${GF.qty(i.quantidade)}`).join(', '))}</td>
        <td>${GF.money(v.valor_total)}${v.desconto ? `<br><small class="muted">desc. ${GF.money(v.desconto)}</small>` : ''}</td>
        <td>${badgeV(v.status_venda)}${v.data_edicao ? '<br><small class="muted">editada</small>' : ''}</td>
        <td class="col-acoes">
          <button class="btn-icon btn-action-info" data-act="ver" title="Ver detalhes" aria-label="Ver ${esc(v.codigo_venda)}">${GF.icon('eye')}</button>
          ${v.status_venda === 'Concluída' && GF.can('vendas:editar') ? `<button class="btn-icon btn-action-next" data-act="editar" title="Editar quantidades" aria-label="Editar ${esc(v.codigo_venda)}">${GF.icon('edit')}</button>` : ''}
          ${v.status_venda === 'Concluída' && GF.can('vendas:cancelar') ? `<button class="btn-icon btn-action-cancel" data-act="cancelar" title="Cancelar venda" aria-label="Cancelar ${esc(v.codigo_venda)}">${GF.icon('x')}</button>` : ''}
          ${GF.can('vendas:excluir') ? `<button class="btn-icon btn-action-trash" data-act="excluir" title="Excluir registro" aria-label="Excluir ${esc(v.codigo_venda)}">${GF.icon('trash')}</button>` : ''}
        </td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">Nenhuma venda encontrada para os filtros informados.</td></tr>';
    } catch (e) { $('#hist-tabela-corpo').innerHTML = '<tr><td colspan="8" class="empty-cell">Falha ao carregar o histórico de vendas.</td></tr>'; $('#hist-pager').innerHTML = ''; }
  }

  function detalhes(v) {
    GF.openModal({
      title: `${v.codigo_venda} - ${v.status_venda}`, wide: true,
      html: `<p class="muted">${GF.date(v.data_venda)} • Operador: ${esc(v.usuario_nome)} • ${esc(v.forma_pagamento)}${v.nsu ? ` • NSU ${esc(v.nsu)}` : ''}</p>
        <table class="figma-styled-table"><thead><tr><th>Produto</th><th>Valor</th><th>Quant.</th><th>Subtotal</th></tr></thead><tbody>
        ${v.itens.map(i => `<tr><td>${esc(i.nome_produto)}</td><td>${GF.num2(i.valor_unitario)}</td><td>${GF.qty(i.quantidade)} ${esc(i.unidade)}</td><td>${GF.num2(i.subtotal)}</td></tr>`).join('')}</tbody></table>
        <div class="sale-sum"><span>Subtotal: ${GF.money(v.valor_subtotal)}</span><span>Desconto: - ${GF.money(v.desconto)}</span><strong>Total: ${GF.money(v.valor_total)}</strong>
        ${v.troco ? `<span>Recebido ${GF.money(v.valor_recebido)} • Troco ${GF.money(v.troco)}</span>` : ''}</div>
        ${v.status_venda === 'Cancelada' ? `<div class="detalhes-justificativa-box"><span class="detalhes-just-title">Cancelada em ${GF.date(v.data_cancelamento)} por ${esc(v.cancelada_por)} (autorizada por ${esc(v.autorizada_por)})</span><p class="detalhe-texto-justificativa">${esc(v.motivo_cancelamento)}</p></div>` : ''}
        ${v.data_edicao ? `<p class="muted">Editada em ${GF.date(v.data_edicao)} por ${esc(v.editada_por)}.</p>` : ''}
        <div class="modal-actions-single"><button class="btn btn-secondary btn-block" data-ok>Fechar</button></div>`,
      onMount: m => m.$('[data-ok]').addEventListener('click', m.close)
    });
  }

  function editar(v) {
    GF.openModal({
      title: `Editar ${v.codigo_venda}`, wide: true,
      html: `<p class="muted">Altere as quantidades. O estoque e o total serão recalculados. Use 0 para remover um item (a venda precisa manter ao menos um).</p>
        <table class="figma-styled-table"><thead><tr><th>Produto</th><th>Valor</th><th>Quantidade</th></tr></thead><tbody>
        ${v.itens.map(i => { const a = GF.qtyAttrs(i.unidade); return `<tr><td>${esc(i.nome_produto)}</td><td>${GF.num2(i.valor_unitario)}</td><td><input type="number" class="ed-qtd" data-id="${i.id_produto}" min="0" step="${a.step}" value="${i.quantidade}"> ${esc(i.unidade)}</td></tr>`; }).join('')}</tbody></table>
        <div class="modal-actions"><button class="btn btn-secondary" data-cancel>Cancelar</button><button class="btn btn-primary" data-ok>Salvar alterações</button></div>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          const itens = GF.$$('.ed-qtd', m.el).map(i => ({ id_produto: Number(i.dataset.id), quantidade: Number(i.value) })).filter(i => i.quantidade > 0);
          if (!itens.length) { GF.toast('A venda precisa ter ao menos um item. Para anulá-la, use o cancelamento.', 'error'); return; }
          try { const r = await GF.put(`/api/sales/${v.id_venda}`, { itens }); GF.toast(r.message, 'success'); m.close(); carregarHist(); } catch (e) { /* toast */ }
        });
      }
    });
  }

  function pedirAutorizacao({ titulo, aviso, comMotivo, botao, adminSo, executar }) {
    const gerente = GF.state.user && (adminSo ? isAdmin() : ['Administrador', 'BackOffice'].includes(GF.state.user.perfil));
    GF.openModal({
      title: titulo,
      html: `<p class="confirm-msg">${aviso}</p>
        ${comMotivo ? '<div class="form-group"><label for="au-motivo">Motivo * (10 a 5000 caracteres)</label><textarea id="au-motivo" rows="3" maxlength="5000"></textarea></div>' : ''}
        <div class="auth-box"><strong>Autorização ${adminSo ? 'do Administrador' : 'de gerente'}</strong>
          <div class="form-group"><label for="au-email">E-mail do ${adminSo ? 'administrador' : 'gerente (Administrador ou BackOffice)'}</label><input type="email" id="au-email" value="${gerente ? esc(GF.state.user.email) : ''}" autocomplete="off"></div>
          <div class="form-group"><label for="au-senha">Senha</label><input type="password" id="au-senha" autocomplete="off"></div></div>
        <div class="modal-actions"><button class="btn btn-secondary" data-cancel>Voltar</button><button class="btn btn-danger" data-ok>${esc(botao)}</button></div>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          const motivo = comMotivo ? m.$('#au-motivo').value.trim() : '';
          if (comMotivo && motivo.length < 10) { GF.marcarErro(m.$('#au-motivo')); GF.toast('O motivo deve ter entre 10 e 5000 caracteres.', 'error'); return; }
          if (!m.$('#au-email').value.trim() || !m.$('#au-senha').value) { GF.marcarErro(m.$('#au-senha')); GF.toast('Informe o e-mail e a senha do autorizador.', 'error'); return; }
          try { const r = await executar({ motivo, autorizador_email: m.$('#au-email').value.trim(), autorizador_senha: m.$('#au-senha').value }); GF.toast(r.message, 'success'); m.close(); carregarHist(); } catch (e) { m.$('#au-senha').value = ''; }
        });
      }
    });
  }

  GF.views.historico = {
    pendente: null,
    // usado pela busca global: filtra o histórico pela venda escolhida e abre seus detalhes
    abrir: venda => {
      const dia = String(venda.data_venda).slice(0, 10);
      $('#hist-de').value = dia; $('#hist-ate').value = dia; $('#hist-busca').value = venda.codigo_venda; $('#hist-status').value = '';
      GF.views.historico.pendente = venda.id_venda;
      GF.navigate('historico');
    },
    load: async () => {
      if (!GF.views.historico.pendente) await GF.syncToday();
      if (!$('#hist-de').value) { $('#hist-de').value = GF.today(); $('#hist-ate').value = GF.today(); }
      await carregarHist();
      const id = GF.views.historico.pendente;
      if (id) { GF.views.historico.pendente = null; const v = vendas.find(x => x.id_venda === id); if (v) detalhes(v); }
    }
  };

  GF.initVendas = () => {
    $('#pdv-produto-select').addEventListener('change', produtoMudou);
    $('#pdv-btn-adicionar-item').addEventListener('click', adicionar);
    $('#pdv-quantidade').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } });
    $('#pdv-busca-codigo').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscarCodigo(); } });
    $('#pdv-busca-codigo').addEventListener('input', e => e.target.classList.remove('input-error'));
    $('#pdv-btn-abrir-adicionar').addEventListener('click', () => $('#pdv-busca-codigo').focus());
    $('#pdv-btn-abrir-desconto').addEventListener('click', () => { $('#pdv-desconto').focus(); $('#pdv-desconto').select(); });
    $('#pdv-btn-remover-item-modo').addEventListener('click', () => {
      if (!cart.length) { GF.toast('Não há itens para remover.', 'info'); return; }
      const ix = selItem !== null && cart[selItem] ? selItem : cart.length - 1;
      const [it] = cart.splice(ix, 1); selItem = null; renderCart(); GF.toast(`"${it.nome}" removido do pedido.`, 'info');
    });
    $('#pdv-btn-limpar-carrinho').addEventListener('click', async () => { if (!cart.length || await GF.confirm('Descartar todos os itens da venda atual?', { danger: true, okLabel: 'Limpar venda' })) limparVenda(); });
    $('#pdv-btn-finalizar-venda').addEventListener('click', finalizar);
    // Atalhos do caixa: F2 busca produto, F4 finaliza (só com o caixa aberto e nenhum modal na frente).
    document.addEventListener('keydown', e => {
      if (GF.state.currentView !== 'vendas' || GF.$('.modal-backdrop:not(.is-hidden)')) return;
      if (e.key === 'F2') { e.preventDefault(); $('#pdv-busca-codigo').focus(); $('#pdv-busca-codigo').select(); }
      else if (e.key === 'F4') { e.preventDefault(); if (!$('#pdv-btn-finalizar-venda').disabled) finalizar(); }
    });
    ['#pdv-desconto', '#pdv-desconto-tipo', '#pdv-recebido'].forEach(s => $(s).addEventListener('input', () => renderCart()));
    $('#pdv-forma-pagamento').addEventListener('change', () => atualizarTroco());
    $('#pdv-carrinho-corpo').addEventListener('click', e => {
      const rem = e.target.closest('[data-rem]');
      if (rem) { cart.splice(Number(rem.dataset.rem), 1); selItem = null; renderCart(); return; }
      const tr = e.target.closest('tr[data-ix]'); if (tr) { selItem = Number(tr.dataset.ix); renderCart(); }
    });

    // histórico
    let t; const deb = () => { clearTimeout(t); t = setTimeout(carregarHist, 250); };
    ['#hist-de', '#hist-ate', '#hist-status'].forEach(s => $(s).addEventListener('change', carregarHist));
    $('#hist-busca').addEventListener('input', deb);
    $('#hist-limpar').addEventListener('click', () => { $('#hist-de').value = GF.today(); $('#hist-ate').value = GF.today(); $('#hist-busca').value = ''; $('#hist-status').value = ''; carregarHist(); });
    $('#hist-tabela-corpo').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const v = vendas.find(x => x.id_venda === Number(b.closest('tr').dataset.id));
      if (b.dataset.act === 'ver') detalhes(v);
      else if (b.dataset.act === 'editar') editar(v);
      else if (b.dataset.act === 'cancelar') pedirAutorizacao({ titulo: `Cancelar ${v.codigo_venda}`, aviso: `A venda de <strong>${GF.money(v.valor_total)}</strong> será cancelada e os itens retornarão ao estoque.`, comMotivo: true, botao: 'Cancelar venda', executar: b2 => GF.post(`/api/sales/${v.id_venda}/cancel`, b2) });
      else if (b.dataset.act === 'excluir') pedirAutorizacao({ titulo: `Excluir ${v.codigo_venda}`, aviso: `O registro será <strong>removido definitivamente</strong>${v.status_venda === 'Concluída' ? ' e o estoque dos itens será estornado' : ''}. Prefira o cancelamento para manter o histórico financeiro.`, adminSo: true, botao: 'Excluir definitivamente', executar: b2 => GF.del(`/api/sales/${v.id_venda}`, b2) });
    });
  };
})();
