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
        <td><strong>${esc(r.codigo_pedido)}</strong>${r.pedido_grupo ? `<br><small class="muted" title="Feita junto no pedido em massa">${esc(r.pedido_grupo)}</small>` : ''}</td><td>${esc(r.fornecedor)}</td><td>${esc(r.produto_nome)}</td>
        <td>x${GF.qty(r.quantidade_pedida)}${r.quantidade_atendida ? `<br><small style="color:var(--text-muted);">recebido ${GF.qty(r.quantidade_atendida)}</small>` : ''}</td>
        <td>${esc(r.unidade)}</td>
        <td><strong>R$ ${Number(r.valor_total).toFixed(2)}</strong></td>
        <td><small>${esc(r.data_pedido)}</small></td><td><small>${esc(r.previsao_entrega)}</small></td>
        <td>${badge}</td>
        <td>${aberta ? `
          ${GF.can('requisicoes:receber') ? `<button class="btn-icon btn-action-accept" data-act="receber" title="Confirmar e Receber Mercadoria (Entrada no Estoque)" aria-label="Receber ${esc(r.codigo_pedido)}">${GF.icon('check')}</button>` : ''}
          ${avancar ? `<button class="btn-icon btn-action-next" data-act="avancar" title="${r.situacao === 'Em Aberto' ? 'Marcar como cotado' : 'Gerar AF'}" aria-label="Avançar ${esc(r.codigo_pedido)}">${GF.icon('arrow-right')}</button>` : ''}
          <button class="btn-icon btn-action-whats" data-act="whatsapp" title="${r.pedido_grupo ? `Enviar o pedido ${esc(r.pedido_grupo)} pelo WhatsApp` : 'Enviar pelo WhatsApp'}" aria-label="Enviar ${esc(r.pedido_grupo || r.codigo_pedido)} pelo WhatsApp">${GF.icon('send')}</button>
          ${GF.can('requisicoes:cancelar') ? `<button class="btn-icon btn-action-cancel" data-act="cancelar" title="Cancelar Requisição" aria-label="Cancelar ${esc(r.codigo_pedido)}">${GF.icon('x')}</button>` : ''}` : '<span style="font-size:0.75rem; color:var(--text-muted);">Concluído</span>'}
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

  // ---- WhatsApp: abre a conversa com o fornecedor e a mensagem do pedido pronta (link wa.me, sem API paga)
  function mensagemPedido(lista) {
    const r0 = lista[0];
    const loja = (GF.state.settings || {}).estabelecimento || 'nossa padaria';
    const linhas = [
      `Olá, ${r0.fornecedor}! Aqui é da ${loja}.`,
      `Gostaríamos de fazer o pedido ${r0.pedido_grupo || r0.codigo_pedido}:`, '',
      ...lista.map(r => `• ${GF.qty(r.quantidade_pedida - r.quantidade_atendida)} ${r.unidade} - ${r.produto_nome}`), '',
      `Entrega prevista: ${GF.date(r0.previsao_entrega)}`
    ];
    if (r0.endereco_entrega && !r0.endereco_entrega.startsWith('Padrão')) linhas.push(`Endereço de entrega: ${r0.endereco_entrega}`);
    if (r0.observacao) linhas.push(`Obs.: ${r0.observacao}`);
    linhas.push('', 'Pode confirmar, por favor? Obrigado!');
    return linhas.join('\n');
  }
  function enviarWhatsapp(lista) {
    const numero = lista[0].fornecedor_whatsapp;
    if (!numero) GF.toast('Fornecedor sem WhatsApp cadastrado: escolha o contato no WhatsApp (ou cadastre o número em Fornecedores).', 'info');
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensagemPedido(lista))}`, '_blank', 'noopener');
  }
  // Na tabela: manda o pedido inteiro (todos os itens em aberto do mesmo pedido em massa) ou só a requisição.
  function whatsapp(r) {
    const lista = r.pedido_grupo ? reqs.filter(x => x.pedido_grupo === r.pedido_grupo && ABERTAS.includes(x.situacao)) : [r];
    enviarWhatsapp(lista.length ? lista : [r]);
  }

  // ---- Fornecedores: nome e WhatsApp
  async function abrirFornecedores() {
    let lista;
    try { lista = (await GF.get('/api/suppliers?detalhe=1')).suppliers; } catch (e) { return; }
    const linha = f => `<div class="forn-linha" data-id="${f ? f.id_fornecedor : ''}">
      <input type="text" class="forn-nome" maxlength="150" value="${f ? esc(f.nome) : ''}" placeholder="Nome do fornecedor" aria-label="Nome do fornecedor">
      <input type="tel" class="forn-whats" maxlength="20" value="${f && f.whatsapp ? esc(f.whatsapp.replace(/^55/, '')) : ''}" placeholder="WhatsApp com DDD (ex.: 11 91234-5678)" aria-label="WhatsApp do fornecedor">
      <button type="button" class="btn btn-sm ${f ? 'btn-secondary' : 'btn-primary'}" data-salvar>${f ? 'Salvar' : 'Cadastrar'}</button></div>`;
    GF.openModal({
      title: 'Fornecedores', wide: true,
      html: `<p class="muted">O WhatsApp é usado no botão "Enviar pelo WhatsApp" das requisições. Informe DDD + número.</p>
        <div class="forn-lista">${linha(null)}${lista.map(linha).join('')}</div>
        <div class="modal-actions-single"><button class="btn btn-secondary btn-block" data-ok>Fechar</button></div>`,
      onMount: m => {
        m.$('[data-ok]').addEventListener('click', m.close);
        m.el.addEventListener('click', async e => {
          const b = e.target.closest('[data-salvar]'); if (!b) return;
          const div = b.closest('.forn-linha'), id = div.dataset.id;
          const corpo = { nome: $('.forn-nome', div).value.trim(), whatsapp: $('.forn-whats', div).value.trim() };
          if (corpo.nome.length < 2) { GF.marcarErro($('.forn-nome', div)); GF.toast('Informe o nome do fornecedor.', 'error'); return; }
          b.disabled = true;
          try {
            const r = id ? await GF.put(`/api/suppliers/${id}`, corpo) : await GF.post('/api/suppliers', corpo);
            GF.toast(r.message, 'success');
            if (!id) { m.close(); abrirFornecedores(); } else { $('.forn-whats', div).value = r.supplier.whatsapp.replace(/^55/, ''); }
            carregar();
          } catch (err) { /* toast exibido */ } finally { b.disabled = false; }
        });
      }
    });
  }

  // ---- Pedido em massa: vários itens para o mesmo fornecedor, com pedidos predefinidos e "puxar abaixo do mínimo"
  async function abrirPedidoMassa() {
    let modelos;
    try {
      const [ps, ms] = await Promise.all([GF.get('/api/products'), GF.get('/api/order-templates'), GF.loadSuppliers()]);
      produtos = ps.products; modelos = ms.modelos;
    } catch (e) { return; }
    let modeloAtual = null;
    const opcoes = sel => produtos.map(p => `<option value="${p.id_produto}"${p.id_produto === sel ? ' selected' : ''}>${esc(p.nome_produto)} (${GF.qty(p.quantidade_estoque)} ${esc(p.unidade)})</option>`).join('');
    GF.openModal({
      title: 'Pedido em massa', wide: true,
      html: `<div class="form-row">
          <div class="form-group"><label for="pm-fornecedor">Fornecedor *</label><select id="pm-fornecedor">${GF.state.suppliers.map(f => `<option>${esc(f)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="pm-modelo">Pedido predefinido</label>
            <div class="pm-modelo-row"><select id="pm-modelo"><option value="">— nenhum —</option>${modelos.map(m => `<option value="${m.id_modelo}">${esc(m.nome)} (${esc(m.fornecedor)})</option>`).join('')}</select>
            <button type="button" class="btn-icon btn-action-trash" id="pm-modelo-excluir" title="Excluir este pedido predefinido" aria-label="Excluir pedido predefinido" disabled>${GF.icon('trash')}</button></div></div>
        </div>
        <div class="pm-head"><span>Produto *</span><span>Quantidade *</span><span>Valor unit. R$</span><span>Subtotal</span><span></span></div>
        <div id="pm-linhas"></div>
        <div class="pm-botoes">
          <button type="button" class="btn btn-sm btn-secondary" id="pm-add">+ Adicionar item</button>
          <button type="button" class="btn btn-sm btn-secondary" id="pm-minimo">${GF.icon('alert', 'icon icon-sm')} Puxar itens abaixo do mínimo</button>
          <button type="button" class="btn btn-sm btn-secondary" id="pm-salvar-modelo">${GF.icon('save', 'icon icon-sm')} Salvar como predefinido</button>
          <strong class="pm-total" id="pm-total"></strong>
        </div>
        <div class="form-row">
          <div class="form-group"><label for="pm-entrega">Previsão de entrega</label><input type="date" id="pm-entrega" min="${GF.today()}" value="${addDias(4)}"></div>
          <div class="form-group pm-obs"><label for="pm-obs">Observação (opcional; mínimo 10 caracteres)</label><textarea id="pm-obs" rows="2" maxlength="5000" placeholder="Ex: Entregar antes das 6h pela porta dos fundos."></textarea></div>
        </div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Cancelar</button><button type="button" class="btn btn-primary" data-ok>Fazer pedido</button></div>`,
      onMount: m => {
        const box = m.$('#pm-linhas');
        const prodDe = div => produtos.find(p => p.id_produto === Number($('.pm-prod', div).value));
        const total = () => {
          let t = 0;
          GF.$$('.pm-linha', box).forEach(div => {
            const sub = (Number($('.pm-qtd', div).value) || 0) * (Number($('.pm-valor', div).value) || 0);
            $('.pm-sub', div).textContent = GF.money(sub); t += sub;
          });
          m.$('#pm-total').textContent = `Total: ${GF.money(t)}`;
        };
        const add = (idp, qtd) => {
          box.insertAdjacentHTML('beforeend', `<div class="pm-linha"><select class="pm-prod" aria-label="Produto">${opcoes(idp)}</select>
            <input type="number" class="pm-qtd" aria-label="Quantidade" value="${qtd || 1}"><input type="number" class="pm-valor" min="0" step="0.01" aria-label="Valor unitário">
            <span class="pm-sub"></span><button type="button" class="btn-icon btn-action-cancel pm-rem" title="Remover item" aria-label="Remover item">${GF.icon('x')}</button></div>`);
          const div = box.lastElementChild, p = prodDe(div);
          GF.applyQtyAttrs($('.pm-qtd', div), p.unidade); $('.pm-valor', div).value = p.preco_custo;
          total();
        };
        const limpar = () => { box.innerHTML = ''; };
        box.addEventListener('change', e => {
          if (!e.target.matches('.pm-prod')) return;
          const div = e.target.closest('.pm-linha'), p = prodDe(div);
          GF.applyQtyAttrs($('.pm-qtd', div), p.unidade); $('.pm-valor', div).value = p.preco_custo; total();
        });
        box.addEventListener('input', total);
        box.addEventListener('click', e => { const b = e.target.closest('.pm-rem'); if (b) { b.closest('.pm-linha').remove(); total(); } });
        m.$('#pm-add').addEventListener('click', () => add());
        m.$('#pm-minimo').addEventListener('click', () => {
          const jaNaLista = new Set(GF.$$('.pm-prod', box).map(s => Number(s.value)));
          const pedidos = new Set(reqs.filter(r => ABERTAS.includes(r.situacao) && r.id_produto).map(r => r.id_produto));
          const faltando = produtos.filter(p => p.quantidade_estoque <= p.estoque_minimo && !jaNaLista.has(p.id_produto) && !pedidos.has(p.id_produto));
          if (!faltando.length) { GF.toast('Nenhum item novo abaixo do mínimo (os que já têm requisição em aberto ficam de fora).', 'info'); return; }
          // linha vazia que sobrou do início é substituída
          if (GF.$$('.pm-linha', box).length === 1 && !modeloAtual && Number($('.pm-qtd', box).value) === 1) limpar();
          faltando.forEach(p => add(p.id_produto, Math.max(1, Math.ceil(p.estoque_minimo * 2 - p.quantidade_estoque))));
          GF.toast(`${faltando.length} item(ns) abaixo do mínimo incluído(s). Confira as quantidades.`, 'success');
        });
        m.$('#pm-modelo').addEventListener('change', () => {
          modeloAtual = modelos.find(x => x.id_modelo === Number(m.$('#pm-modelo').value)) || null;
          m.$('#pm-modelo-excluir').disabled = !modeloAtual;
          if (!modeloAtual) return;
          m.$('#pm-fornecedor').value = modeloAtual.fornecedor;
          if (modeloAtual.observacao) m.$('#pm-obs').value = modeloAtual.observacao;
          limpar();
          modeloAtual.itens.filter(i => i.status === 'Ativo').forEach(i => add(i.id_produto, i.quantidade));
          if (!box.children.length) add();
        });
        m.$('#pm-modelo-excluir').addEventListener('click', async () => {
          if (!modeloAtual || !await GF.confirm(`Excluir o pedido predefinido "${modeloAtual.nome}"? Os pedidos já feitos não mudam.`, { danger: true, okLabel: 'Excluir' })) return;
          try {
            const r = await GF.del(`/api/order-templates/${modeloAtual.id_modelo}`); GF.toast(r.message, 'success');
            modelos = modelos.filter(x => x !== modeloAtual);
            m.$(`#pm-modelo option[value="${modeloAtual.id_modelo}"]`).remove();
            modeloAtual = null; m.$('#pm-modelo').value = ''; m.$('#pm-modelo-excluir').disabled = true;
          } catch (e) { /* toast */ }
        });
        const lerItens = () => {
          const itens = [];
          for (const div of GF.$$('.pm-linha', box)) {
            const q = $('.pm-qtd', div);
            if (!(Number(q.value) > 0)) { GF.marcarErro(q); GF.toast('Informe quantidades maiores que zero.', 'error'); return null; }
            itens.push({ id_produto: Number($('.pm-prod', div).value), quantidade_pedida: Number(q.value), valor_unitario: $('.pm-valor', div).value });
          }
          if (!itens.length) { GF.toast('Inclua ao menos um item no pedido.', 'error'); return null; }
          if (new Set(itens.map(i => i.id_produto)).size < itens.length) { GF.toast('Há produto repetido: junte as quantidades numa linha só.', 'error'); return null; }
          return itens;
        };
        m.$('#pm-salvar-modelo').addEventListener('click', () => {
          const itens = lerItens(); if (!itens) return;
          GF.openModal({
            title: 'Salvar como pedido predefinido',
            html: `<div class="form-group"><label for="pmm-nome">Nome *</label><input type="text" id="pmm-nome" maxlength="80" value="${modeloAtual ? esc(modeloAtual.nome) : ''}" placeholder="Ex: Pedido semanal do moinho"></div>
              <p class="muted">Guarda o fornecedor e os ${itens.length} item(ns) com estas quantidades.${modeloAtual ? ' Com o mesmo nome, o pedido predefinido carregado é atualizado.' : ''}</p>
              <div class="modal-actions"><button class="btn btn-secondary" data-cancel>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button></div>`,
            onMount: s => {
              s.$('[data-cancel]').addEventListener('click', s.close);
              s.$('[data-ok]').addEventListener('click', async () => {
                const nome = s.$('#pmm-nome').value.trim();
                if (nome.length < 3) { GF.marcarErro(s.$('#pmm-nome')); GF.toast('O nome deve ter pelo menos 3 caracteres.', 'error'); return; }
                const corpo = { nome, fornecedor: m.$('#pm-fornecedor').value, observacao: m.$('#pm-obs').value.trim(), itens: itens.map(i => ({ id_produto: i.id_produto, quantidade: i.quantidade_pedida })) };
                try {
                  const atualizar = modeloAtual && modeloAtual.nome === nome;
                  const r = atualizar ? await GF.put(`/api/order-templates/${modeloAtual.id_modelo}`, corpo) : await GF.post('/api/order-templates', corpo);
                  GF.toast(r.message, 'success'); s.close();
                  modelos = [...modelos.filter(x => x.id_modelo !== r.modelo.id_modelo), r.modelo];
                  if (!atualizar) m.$('#pm-modelo').insertAdjacentHTML('beforeend', `<option value="${r.modelo.id_modelo}">${esc(r.modelo.nome)} (${esc(r.modelo.fornecedor)})</option>`);
                  modeloAtual = r.modelo; m.$('#pm-modelo').value = String(r.modelo.id_modelo); m.$('#pm-modelo-excluir').disabled = false;
                } catch (e) { /* toast */ }
              });
            }
          });
        });
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          GF.limparErros(m.el);
          const itens = lerItens(); if (!itens) return;
          const obs = m.$('#pm-obs').value.trim(), entrega = m.$('#pm-entrega').value;
          if (obs && obs.length < 10) { GF.marcarErro(m.$('#pm-obs')); GF.toast('A observação deve ter no mínimo 10 caracteres (ou deixe em branco).', 'error'); return; }
          if (entrega && entrega < GF.today()) { GF.marcarErro(m.$('#pm-entrega')); GF.toast('A previsão de entrega não pode estar no passado.', 'error'); return; }
          const btn = m.$('[data-ok]'); btn.disabled = true;
          try {
            const r = await GF.post('/api/requisitions/batch', { fornecedor: m.$('#pm-fornecedor').value, itens, previsao_entrega: entrega, observacao: obs });
            m.close();
            GF.toast(r.message, 'success');
            selecionada = r.pedido.requisicoes[0].id_requisicao;
            if (GF.state.currentView === 'requisicoes') carregar();
            pedidoFeito(r.pedido);
          } catch (err) { /* toast exibido; nada foi gravado */ } finally { btn.disabled = false; }
        });
        add();
      }
    });
  }

  // Depois do pedido: o botão do WhatsApp precisa de um clique (o navegador bloqueia abrir aba sozinho).
  function pedidoFeito(p) {
    GF.openModal({
      title: `Pedido ${p.pedido_grupo} realizado`,
      html: `<p class="confirm-msg">${p.requisicoes.length} item(ns) para <strong>${esc(p.requisicoes[0].fornecedor)}</strong> • total ${GF.money(p.valor_total)}</p>
        <ul class="pm-resumo">${p.requisicoes.map(r => `<li>${GF.qty(r.quantidade_pedida)} ${esc(r.unidade)} - ${esc(r.produto_nome)} <small class="muted">(${esc(r.codigo_pedido)})</small></li>`).join('')}</ul>
        <div class="modal-actions"><button class="btn btn-secondary" data-cancel>Fechar</button><button class="btn btn-primary" data-ok>${GF.icon('send', 'icon icon-sm')} Enviar pelo WhatsApp</button></div>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', () => { enviarWhatsapp(p.requisicoes); m.close(); });
      }
    });
  }

  GF.views.requisicoes = { load: carregar, abrirNova, selecionar: null };

  GF.initRequisicoes = () => {
    $('#btn-abrir-modal-req').addEventListener('click', () => abrirNova());
    $('#btn-pedido-massa').addEventListener('click', abrirPedidoMassa);
    $('#btn-fornecedores').addEventListener('click', abrirFornecedores);
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
      ({ receber, avancar, cancelar, detalhes, whatsapp })[btn.dataset.act](r);
    });
  };
})();
