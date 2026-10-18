// movimentos.js - Entradas e saídas de estoque, individuais ou em lote (RF 04)
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let produtos = [];

  // Lista paginada (50 por página); o resumo soma o filtro inteiro, calculado pelo servidor.
  function tabela(tipo, corpo, resumo, de, ate, pager) {
    const carregar = async (offset = 0) => {
      const q = [`tipo=${tipo}`, $(de).value && `from=${$(de).value}`, $(ate).value && `to=${$(ate).value}`, `limit=${GF.POR_PAGINA}`, `offset=${offset}`].filter(Boolean).join('&');
      try {
        const r = await GF.get(`/api/movements?${q}`);
        const movs = r.movements;
        $(resumo).textContent = `${r.total.toLocaleString('pt-BR')} registro(s) • total ${GF.money(r.valorTotal)}`;
        GF.pager($(pager), { total: r.total, offset, ir: carregar });
        $(corpo).innerHTML = movs.length ? movs.map(m => `<tr>
          <td>${GF.date(m.data_movimentacao)}</td><td>${esc(m.produto_nome)}</td><td>${esc(m.codigo_barras)}</td>
          <td>${GF.qty(m.quantidade)} ${esc(m.unidade)}</td><td>${GF.num2(m.valor_unitario)}</td><td>${GF.num2(m.valor_total)}</td>
          <td>${esc(m.usuario_nome)}</td><td>${m.origem === 'perda' ? `<span class="badge-status-pill badge-warning">Perda: ${esc(m.motivo_perda)}</span> ` : ''}${esc(m.observacao)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">Nenhuma movimentação encontrada.</td></tr>';
      } catch (e) { $(corpo).innerHTML = '<tr><td colspan="8" class="empty-cell">Falha ao carregar as movimentações.</td></tr>'; $(pager).innerHTML = ''; }
    };
    return () => carregar(0);
  }
  const carregarSaidas = tabela('Saída', '#saidas-tabela-corpo', '#saidas-resumo', '#saidas-de', '#saidas-ate', '#saidas-pager');
  const carregarEntradas = tabela('Entrada', '#entradas-tabela-corpo', '#entradas-resumo', '#entradas-de', '#entradas-ate', '#entradas-pager');

  // ---- modal com linhas (lote)
  function linhaHtml(sel) {
    return `<div class="mov-linha"><select class="mov-prod" aria-label="Produto">${produtos.map(p => `<option value="${p.id_produto}" data-un="${esc(p.unidade)}" data-est="${p.quantidade_estoque}" data-uc="${esc(p.unidade_compra || '')}" data-fator="${p.fator_conversao || 1}"${p.id_produto === sel ? ' selected' : ''}>${esc(p.nome_produto)} (${GF.qty(p.quantidade_estoque)} ${esc(p.unidade)})</option>`).join('')}</select>
      <input type="number" class="mov-qtd" min="1" step="1" value="1" aria-label="Quantidade"><button type="button" class="btn-icon btn-action-cancel mov-rem" title="Remover linha" aria-label="Remover linha">${GF.icon('x')}</button>
      <label class="mov-uc is-hidden"><input type="checkbox" class="mov-uc-check"> <span></span></label></div>`;
  }
  // Na entrada, produto com unidade de compra (ex.: Saco de 25 KG) pode ser informado em sacos.
  function ajustaLinha(div) {
    const opt = $('.mov-prod', div).selectedOptions[0];
    const uc = $('.mov-uc', div), emCompra = $('.mov-uc-check', div);
    const mostrar = $('#modal-mov-tipo').value === 'Entrada' && !!opt.dataset.uc;
    uc.classList.toggle('is-hidden', !mostrar);
    if (!mostrar) emCompra.checked = false;
    $('span', uc).textContent = `Informar em ${opt.dataset.uc} (1 ${opt.dataset.uc} = ${GF.qty(opt.dataset.fator)} ${opt.dataset.un})`;
    if (emCompra.checked) { const q = $('.mov-qtd', div); q.min = '0.001'; q.step = '0.001'; } else GF.applyQtyAttrs($('.mov-qtd', div), opt.dataset.un);
  }
  function addLinha(box = $('#mov-linhas'), sel) {
    box.insertAdjacentHTML('beforeend', linhaHtml(sel));
    ajustaLinha(box.lastElementChild);
    GF.$$('.mov-rem', box).forEach(b => { b.style.visibility = box.children.length > 1 ? 'visible' : 'hidden'; });
  }

  // Trocar produto ajusta a quantidade (inteira/fração); ✕ remove a linha (sempre fica ao menos uma).
  function bindLinhas(box) {
    box.addEventListener('change', e => { if (e.target.matches('.mov-prod, .mov-uc-check')) ajustaLinha(e.target.closest('.mov-linha')); });
    box.addEventListener('click', e => {
      const b = e.target.closest('.mov-rem'); if (!b) return;
      if (box.children.length > 1) { b.closest('.mov-linha').remove(); GF.$$('.mov-rem', box).forEach(x => { x.style.visibility = box.children.length > 1 ? 'visible' : 'hidden'; }); }
    });
  }

  function lerLinhas(box) {
    const itens = [];
    for (const div of GF.$$('.mov-linha', box)) {
      const q = $('.mov-qtd', div), v = Number(q.value);
      if (!(v > 0)) { GF.marcarErro(q); GF.toast('Informe quantidades maiores que zero.', 'error'); return null; }
      itens.push({ id_produto: Number($('.mov-prod', div).value), quantidade: v, ...($('.mov-uc-check', div).checked ? { em_unidade_compra: true } : {}) });
    }
    return itens;
  }

  // Perda/sobra (vencido, quebra, sobra do dia...): baixa no estoque valorizada pelo custo.
  // `preset` permite abrir já com um produto (ex.: "dar baixa como vencido" no painel).
  GF.abrirPerda = async (preset = {}) => {
    try { produtos = (await GF.get('/api/products')).products.filter(p => p.quantidade_estoque > 0); } catch (e) { return; }
    if (!produtos.length) { GF.toast('Não há produtos com estoque para registrar perda.', 'error'); return; }
    const motivos = ['Vencido', 'Quebra/Avaria', 'Sobra do dia', 'Outro'];
    GF.openModal({
      title: 'Registrar Perda / Sobra',
      wide: true,
      html: `<div class="form-group"><label for="perda-motivo">Motivo *</label><select id="perda-motivo">${motivos.map(m => `<option${m === preset.motivo ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="mov-lines-head"><span>Produto *</span><span>Quantidade *</span><span></span></div>
        <div id="perda-linhas"></div>
        <button type="button" class="btn btn-sm btn-secondary" id="perda-add">+ Adicionar outro item</button>
        <div class="form-group mov-obs"><label for="perda-obs">Observação (obrigatória quando o motivo é "Outro"; mínimo 10 caracteres)</label>
          <textarea id="perda-obs" rows="2" maxlength="5000" placeholder="Ex: Bandeja caiu no transporte para o balcão."></textarea></div>
        <p class="muted" id="perda-valor"></p>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Cancelar</button><button type="button" class="btn btn-danger" data-ok>Registrar perda</button></div>`,
      onMount: m => {
        const box = m.$('#perda-linhas');
        bindLinhas(box);
        addLinha(box, preset.id_produto);
        if (preset.quantidade) $('.mov-qtd', box).value = preset.quantidade;
        const valor = () => {
          const total = GF.$$('.mov-linha', box).reduce((a, div) => {
            const p = produtos.find(x => x.id_produto === Number($('.mov-prod', div).value));
            return a + (p ? Number(p.preco_custo) * (Number($('.mov-qtd', div).value) || 0) : 0);
          }, 0);
          m.$('#perda-valor').textContent = `Valor perdido (preço de custo): ${GF.money(total)}`;
        };
        valor();
        ['input', 'change', 'click'].forEach(ev => box.addEventListener(ev, () => setTimeout(valor)));
        m.$('#perda-add').addEventListener('click', () => { addLinha(box); valor(); });
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          GF.limparErros(m.el);
          const itens = lerLinhas(box); if (!itens) return;
          const motivo = m.$('#perda-motivo').value, obs = m.$('#perda-obs').value.trim();
          if ((motivo === 'Outro' || obs) && obs.length < 10) { GF.marcarErro(m.$('#perda-obs')); GF.toast('A observação deve ter pelo menos 10 caracteres.', 'error'); return; }
          const btn = m.$('[data-ok]'); btn.disabled = true;
          try {
            const r = await GF.post('/api/losses', { motivo_perda: motivo, itens, observacao: obs });
            GF.toast(r.message, 'success');
            m.close();
            if (preset.aoSalvar) preset.aoSalvar(); else if (GF.state.currentView === 'saidas') carregarSaidas();
          } catch (err) { /* toast exibido; nada foi gravado */ } finally { btn.disabled = false; }
        });
      }
    });
  };

  async function abrir(tipo) {
    try { produtos = (await GF.get('/api/products')).products; } catch (e) { return; }
    if (!produtos.length) { GF.toast('Não há produtos ativos cadastrados.', 'error'); return; }
    $('#modal-mov-tipo').value = tipo;
    $('#modal-mov-titulo').textContent = tipo === 'Entrada' ? 'Registrar Entrada de Estoque' : 'Registrar Saída de Estoque';
    $('#btn-registrar-mov').className = `btn ${tipo === 'Entrada' ? 'btn-primary' : 'btn-danger'}`;
    $('#mov-linhas').innerHTML = '';
    addLinha();
    $('#modal-mov-obs').value = '';
    $('#modal-mov-obs').dispatchEvent(new Event('input'));
    GF.limparErros($('#form-movimentacao-modal'));
    GF.showModalStatic('#modal-movimentacao');
  }

  async function enviar(e) {
    e.preventDefault();
    GF.limparErros($('#form-movimentacao-modal'));
    const itens = lerLinhas($('#mov-linhas'));
    if (!itens) return;
    const obs = $('#modal-mov-obs').value.trim();
    if (obs.length < 10) { GF.marcarErro($('#modal-mov-obs')); GF.toast('O motivo deve ter entre 10 e 5000 caracteres.', 'error'); return; }
    const btn = $('#btn-registrar-mov'); btn.disabled = true;
    try {
      const r = await GF.post('/api/movements', { tipo_movimentacao: $('#modal-mov-tipo').value, itens, observacao: obs });
      GF.toast(r.message, 'success');
      GF.hideModalStatic('#modal-movimentacao');
      if (GF.state.currentView === 'saidas') carregarSaidas(); else carregarEntradas();
    } catch (err) { /* toast exibido; nada foi gravado */ } finally { btn.disabled = false; }
  }

  GF.views.saidas = { load: carregarSaidas };
  GF.views.entradas = { load: carregarEntradas };

  GF.initMovimentos = () => {
    $('#btn-registrar-saida-modal').addEventListener('click', () => abrir('Saída'));
    $('#btn-registrar-entrada-modal').addEventListener('click', () => abrir('Entrada'));
    ['#btn-fechar-modal-mov', '#btn-cancelar-modal-mov'].forEach(s => $(s).addEventListener('click', () => GF.hideModalStatic('#modal-movimentacao')));
    $('#btn-mov-add-linha').addEventListener('click', () => addLinha());
    $('#btn-registrar-perda').addEventListener('click', () => GF.abrirPerda());
    $('#form-movimentacao-modal').addEventListener('submit', enviar);
    GF.bindCounter($('#modal-mov-obs'), $('#mov-obs-counter'), 10, 5000);
    bindLinhas($('#mov-linhas'));
    [['#saidas-de', '#saidas-ate', carregarSaidas, '#saidas-limpar'], ['#entradas-de', '#entradas-ate', carregarEntradas, '#entradas-limpar']].forEach(([a, b, fn, l]) => {
      $(a).addEventListener('change', fn); $(b).addEventListener('change', fn);
      $(l).addEventListener('click', () => { $(a).value = ''; $(b).value = ''; fn(); });
    });
  };
})();
