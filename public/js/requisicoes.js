// requisicoes.js - Requisições de compra aos fornecedores (RF 05)
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let reqs = [], produtos = [], filtro = 'TODOS', selecionada = null;
  const ABERTAS = ['Em Aberto', 'Cotado', 'AF Gerada'];

  const addDias = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  function showcase(r) {
    const vazio = !r;
    const p = r && produtos.find(x => x.id_produto === r.id_produto);
    $('#showcase-img').src = GF.imgFor(p || {});
    $('#showcase-fornecedor').textContent = vazio ? 'Nenhuma requisição selecionada' : r.fornecedor;
    $('#showcase-produto-nome').textContent = vazio ? '-' : r.produto_nome;
    $('#showcase-codigo').textContent = vazio ? '-' : r.codigo_pedido.replace('REQ-', '');
    $('#showcase-qtd-ped').textContent = vazio ? '-' : 'X' + GF.qty(r.quantidade_pedida);
    $('#showcase-qtd-atend').textContent = vazio ? '-' : 'X' + GF.qty(r.quantidade_atendida);
    $('#showcase-unidade').textContent = vazio ? '-' : r.unidade;
    const s = $('#showcase-situacao'); s.outerHTML = vazio ? '<span class="badge-status-pill badge-info" id="showcase-situacao">-</span>' : GF.badgeSit(r.situacao).replace('<span', '<span id="showcase-situacao"');
    $('#showcase-descricao').textContent = vazio ? 'Selecione uma requisição na tabela para ver os detalhes.' : r.observacao || 'Sem observações.';
    $('#showcase-endereco').textContent = vazio ? '-' : r.endereco_entrega;
    $('#showcase-data-entrega').textContent = vazio ? '-' : GF.date(r.previsao_entrega);
    $('#showcase-valor-unit').textContent = vazio ? '-' : GF.money(r.valor_unitario);
    $('#showcase-valor-total').textContent = vazio ? '-' : GF.money(r.valor_total);
  }

  function render() {
    const lista = reqs.filter(r => filtro === 'TODOS' || (filtro === 'Em Aberto' ? ABERTAS.includes(r.situacao) : r.situacao === filtro));
    GF.$$('.filter-req-btn').forEach(b => b.classList.toggle('active', b.dataset.status === filtro));
    $('#requisicoes-tabela-corpo').innerHTML = lista.length ? lista.map(r => {
      const aberta = ABERTAS.includes(r.situacao);
      const avancar = GF.can('requisicoes:avancar') && aberta && r.situacao !== 'AF Gerada';
      const badge = r.situacao === 'Cancelado'
        ? `<button class="badge-status-btn badge-cancelado" data-act="detalhes" title="Clique para ver o motivo do cancelamento">Cancelado ${GF.icon('info', 'icon icon-sm')}</button>`
        : `<span class="badge-status-pill badge-${r.situacao === 'Finalizado' ? 'info' : 'warning'} badge-click" data-act="detalhes" title="Clique para ver o histórico">${esc(r.situacao)}</span>`;
      return `<tr class="row-select ${selecionada === r.id_requisicao ? 'row-selected' : ''}" data-id="${r.id_requisicao}">
        <td><strong>${esc(r.codigo_pedido)}</strong></td><td>${esc(r.fornecedor)}</td><td>${esc(r.produto_nome)}</td>
        <td>x${GF.qty(r.quantidade_pedida)}${r.quantidade_atendida ? `<br><small style="color:#6b7280;">recebido ${GF.qty(r.quantidade_atendida)}</small>` : ''}</td>
        <td>${esc(r.unidade)}</td>
        <td><strong>R$ ${Number(r.valor_total).toFixed(2)}</strong></td>
        <td><small>${esc(r.data_pedido)}</small></td><td><small>${esc(r.previsao_entrega)}</small></td>
        <td>${badge}</td>
        <td>${aberta ? `
          ${GF.can('requisicoes:receber') ? `<button class="btn-icon btn-action-accept" data-act="receber" title="Confirmar e Receber Mercadoria (Entrada no Estoque)" aria-label="Receber ${esc(r.codigo_pedido)}">${GF.icon('check')}</button>` : ''}
          ${avancar ? `<button class="btn-icon btn-action-next" data-act="avancar" title="${r.situacao === 'Em Aberto' ? 'Marcar como cotado' : 'Gerar AF'}" aria-label="Avançar ${esc(r.codigo_pedido)}">${GF.icon('arrow-right')}</button>` : ''}
          ${GF.can('requisicoes:cancelar') ? `<button class="btn-icon btn-action-cancel" data-act="cancelar" title="Cancelar Requisição" aria-label="Cancelar ${esc(r.codigo_pedido)}">${GF.icon('x')}</button>` : ''}` : '<span style="font-size:0.75rem; color:#6b7280;">Concluído</span>'}
        </td></tr>`;
    }).join('') : '<tr><td colspan="10" style="text-align:center; padding:16px;">Nenhuma requisição encontrada.</td></tr>';
    showcase(reqs.find(r => r.id_requisicao === selecionada) || null);
  }

  async function carregar() {
    try {
      const [a, b] = await Promise.all([GF.get('/api/requisitions'), GF.get('/api/products')]);
      reqs = a.requisicoes; produtos = b.products;
      if (GF.views.requisicoes.selecionar) { selecionada = GF.views.requisicoes.selecionar; GF.views.requisicoes.selecionar = null; }
      if (!reqs.some(r => r.id_requisicao === selecionada)) { const f = reqs.find(r => ABERTAS.includes(r.situacao)) || reqs[0]; selecionada = f ? f.id_requisicao : null; }
      render();
    } catch (e) { $('#requisicoes-tabela-corpo').innerHTML = '<tr><td colspan="10" style="text-align:center; padding:16px;">Não foi possível carregar as requisições.</td></tr>'; }
  }

  // ---- Nova requisição
  async function abrirNova(idProduto) {
    try {
      const [ps, fs] = await Promise.all([GF.get('/api/products'), GF.loadSuppliers()]);
      produtos = ps.products;
    } catch (e) { return; }
    $('#modal-req-produto').innerHTML = produtos.map(p => `<option value="${p.id_produto}">${esc(p.nome_produto)} (${esc(p.unidade)})</option>`).join('');
    $('#modal-req-fornecedor').innerHTML = GF.state.suppliers.map(f => `<option>${esc(f)}</option>`).join('');
    if (idProduto) $('#modal-req-produto').value = String(idProduto);
    const sync = () => {
      const p = produtos.find(x => x.id_produto === Number($('#modal-req-produto').value));
      if (!p) return;
      $('#modal-req-unidade').value = p.unidade;
      GF.applyQtyAttrs($('#modal-req-quantidade'), p.unidade);
      $('#modal-req-valor-unit').value = p.preco_custo;
      if (idProduto === p.id_produto && !$('#modal-req-quantidade').dataset.touched) $('#modal-req-quantidade').value = Math.max(1, Math.ceil(p.estoque_minimo * 2 - p.quantidade_estoque));
    };
    $('#modal-req-produto').onchange = () => { delete $('#modal-req-quantidade').dataset.touched; sync(); };
    $('#modal-req-quantidade').oninput = e => { e.target.dataset.touched = '1'; };
    sync();
    $('#modal-req-entrega').min = GF.today();
    $('#modal-req-entrega').value = addDias(4);
    $('#modal-req-obs').value = '';
    $('#modal-req-obs').dispatchEvent(new Event('input'));
    GF.limparErros($('#form-requisicao-modal'));
    GF.showModalStatic('#modal-requisicao');
  }

  async function enviarNova(e) {
    e.preventDefault();
    const f = $('#form-requisicao-modal'); GF.limparErros(f);
    const q = $('#modal-req-quantidade'), obs = $('#modal-req-obs').value.trim();
    if (!(Number(q.value) > 0)) { GF.marcarErro(q); GF.toast('Informe uma quantidade maior que zero.', 'error'); return; }
    if (obs && obs.length < 10) { GF.marcarErro($('#modal-req-obs')); GF.toast('A observação deve ter no mínimo 10 caracteres (ou deixe em branco).', 'error'); return; }
    const entrega = $('#modal-req-entrega').value;
    if (entrega && entrega < GF.today()) { GF.marcarErro($('#modal-req-entrega')); GF.toast('A previsão de entrega não pode estar no passado.', 'error'); return; }
    const btn = $('#btn-enviar-requisicao'); btn.disabled = true;
    try {
      const r = await GF.post('/api/requisitions', {
        id_produto: Number($('#modal-req-produto').value), quantidade_pedida: Number(q.value), fornecedor: $('#modal-req-fornecedor').value,
        valor_unitario: $('#modal-req-valor-unit').value, previsao_entrega: entrega, observacao: obs
      });
      GF.toast(r.message, 'success');
      GF.hideModalStatic('#modal-requisicao');
      selecionada = r.requisicao.id_requisicao;
      if (GF.state.currentView === 'requisicoes') carregar(); else if (GF.state.currentView === 'dashboard') GF.views.dashboard.load();
    } catch (err) { /* toast exibido */ } finally { btn.disabled = false; }
  }

  // ---- Ações da tabela
  function receber(r) {
    const resto = Math.round((r.quantidade_pedida - r.quantidade_atendida) * 1000) / 1000;
    const a = GF.qtyAttrs(r.unidade);
    GF.openModal({
      title: `Receber mercadoria - ${r.codigo_pedido}`,
      html: `<p class="confirm-msg"><strong>${esc(r.produto_nome)}</strong> • ${esc(r.fornecedor)}<br>Pedido: ${GF.qty(r.quantidade_pedida)} ${esc(r.unidade)} • Já recebido: ${GF.qty(r.quantidade_atendida)} • Pendente: <strong>${GF.qty(resto)}</strong></p>
        <div class="form-group"><label for="rec-qtd">Quantidade recebida agora (${esc(r.unidade)})</label><input type="number" id="rec-qtd" min="${a.min}" max="${resto}" step="${a.step}" value="${resto}"></div>
        <p class="muted">${r.id_produto ? 'O estoque será atualizado automaticamente (entrada).' : 'Produto fora do catálogo: nenhum estoque será alterado.'} Se receber menos que o pendente, o pedido continua aberto.</p>
        <div class="modal-actions"><button class="btn btn-secondary" data-cancel>Cancelar</button><button class="btn btn-primary" data-ok>Confirmar recebimento</button></div>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          const v = Number(m.$('#rec-qtd').value);
          if (!(v > 0) || v > resto) { GF.marcarErro(m.$('#rec-qtd')); GF.toast(`Informe uma quantidade entre 0 e ${GF.qty(resto)}.`, 'error'); return; }
          try { const res = await GF.patch(`/api/requisitions/${r.id_requisicao}/status`, { situacao: 'Finalizado', quantidade_recebida: v }); GF.toast(res.message, 'success'); m.close(); carregar(); } catch (e) { /* toast */ }
        });
      }
    });
  }

  async function avancar(r) {
    const alvo = r.situacao === 'Em Aberto' ? 'Cotado' : 'AF Gerada';
    if (!await GF.confirm(`Atualizar a requisição ${r.codigo_pedido} para "${alvo}"?`, { okLabel: 'Atualizar' })) return;
    try { const res = await GF.patch(`/api/requisitions/${r.id_requisicao}/status`, { situacao: alvo }); GF.toast(res.message, 'success'); carregar(); } catch (e) { /* toast */ }
  }

  function cancelar(r) {
    $('#cancel-req-id').value = r.id_requisicao;
    $('#cancel-target-info').innerHTML = `<strong>${esc(r.codigo_pedido)}</strong> • ${esc(r.produto_nome)} • ${esc(r.fornecedor)}<br><small>${GF.qty(r.quantidade_pedida)} ${esc(r.unidade)} • ${GF.money(r.valor_total)}</small>`;
    $('#cancel-justificativa').value = '';
    $('#cancel-justificativa').dispatchEvent(new Event('input'));
    GF.showModalStatic('#modal-cancelar-requisicao');
  }

  async function enviarCancelamento(e) {
    e.preventDefault();
    const ta = $('#cancel-justificativa');
    if (ta.value.trim().length < 10) { GF.marcarErro(ta); GF.toast('A justificativa deve ter entre 10 e 5000 caracteres.', 'error'); return; }
    const btn = $('#btn-confirmar-cancelamento-envio'); btn.disabled = true;
    try {
      const r = await GF.patch(`/api/requisitions/${$('#cancel-req-id').value}/status`, { situacao: 'Cancelado', justificativa: ta.value.trim() });
      GF.toast(r.message, 'success');
      GF.hideModalStatic('#modal-cancelar-requisicao');
      carregar();
    } catch (err) { /* toast exibido; a requisição permanece intacta */ } finally { btn.disabled = false; }
  }

  function detalhes(r) {
    if (r.situacao === 'Cancelado') {
      $('#detalhe-pedido-cod').textContent = r.codigo_pedido;
      $('#detalhe-fornecedor').textContent = r.fornecedor;
      $('#detalhe-produto').textContent = r.produto_nome;
      $('#detalhe-texto-justificativa').textContent = r.justificativa_cancelamento || 'Sem justificativa registrada.';
      $('#detalhe-chars-count').textContent = `${(r.justificativa_cancelamento || '').length} caracteres`;
      GF.showModalStatic('#modal-detalhes-cancelamento');
      return;
    }
    GF.openModal({
      title: `Histórico - ${r.codigo_pedido}`,
      html: `<p class="confirm-msg">${esc(r.produto_nome)} • ${esc(r.fornecedor)}</p>
        <ol class="timeline">${r.historico.map(h => `<li><strong>${esc(h.situacao)}</strong><br><small>${GF.date(h.data)} • ${esc(h.usuario)}</small></li>`).join('')}</ol>
        <div class="modal-actions-single"><button class="btn btn-secondary btn-block" data-ok>Fechar</button></div>`,
      onMount: m => m.$('[data-ok]').addEventListener('click', m.close)
    });
  }

  GF.views.requisicoes = { load: carregar, abrirNova, selecionar: null };

  GF.initRequisicoes = () => {
    $('#btn-abrir-modal-req').addEventListener('click', () => abrirNova());
    ['#btn-fechar-modal-req'].forEach(s => $(s).addEventListener('click', () => GF.hideModalStatic('#modal-requisicao')));
    $('#form-requisicao-modal').addEventListener('submit', enviarNova);
    GF.bindCounter($('#modal-req-obs'), $('#req-obs-counter'), 10, 5000);
    GF.bindCounter($('#cancel-justificativa'), $('#cancel-char-counter'), 10, 5000);
    $('#form-cancelar-requisicao').addEventListener('submit', enviarCancelamento);
    ['#btn-fechar-modal-cancelar', '#btn-abortar-cancelamento'].forEach(s => $(s).addEventListener('click', () => GF.hideModalStatic('#modal-cancelar-requisicao')));
    ['#btn-fechar-detalhes-cancelamento', '#btn-fechar-detalhes-cancelamento-btn'].forEach(s => $(s).addEventListener('click', () => GF.hideModalStatic('#modal-detalhes-cancelamento')));
    GF.$$('.filter-req-btn').forEach(b => b.addEventListener('click', () => { filtro = b.dataset.status; render(); }));
    const tb = $('#requisicoes-tabela-corpo');
    tb.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const r = reqs.find(x => x.id_requisicao === Number(tr.dataset.id));
      const btn = e.target.closest('[data-act]');
      if (!btn) { selecionada = r.id_requisicao; render(); return; }
      selecionada = r.id_requisicao;
      ({ receber, avancar, cancelar, detalhes })[btn.dataset.act](r);
    });
  };
})();
