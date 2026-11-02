// caixa.js - Abertura, sangria, reforço e fechamento do caixa (único da loja), com contagem cega
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  const TIPOS = { sangria: 'Sangria', reforco: 'Reforço', estorno: 'Estorno de venda' };
  let atual = null, caixas = [];

  const card = (rotulo, valor, rodape, tom, ico) => `<div class="kpi-card">
    <div class="kpi-top"><span>${rotulo}</span><span class="kpi-ico ${tom}">${GF.icon(ico)}</span></div>
    <div class="kpi-value">${valor}</div><div class="kpi-foot">${rodape}</div></div>`;
  const textoDif = d => (!d ? 'Sem diferença' : d > 0 ? `Sobrou ${GF.money(d)}` : `Faltou ${GF.money(-d)}`);
  const badgeDif = d => `<span class="badge-status-pill ${d ? 'badge-urgent' : 'badge-success'}">${textoDif(d)}</span>`;

  const tabelaMov = (movs, vazio) => `<table class="figma-styled-table"><thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Motivo</th><th>Responsável</th></tr></thead><tbody>
    ${movs.length ? movs.map(m => `<tr><td>${GF.date(m.data_movimento)}</td><td>${esc(TIPOS[m.tipo])}</td><td>${GF.money(m.valor)}</td><td>${esc(m.motivo)}</td><td>${esc(m.usuario_nome)}</td></tr>`).join('') : `<tr><td colspan="5" class="empty-cell">${vazio}</td></tr>`}</tbody></table>`;

  const blocoResumo = r => `<div class="sale-sum">
    <span>${r.vendas} venda(s)</span><span>Dinheiro: ${GF.money(r.porForma.Dinheiro)}</span><span>PIX: ${GF.money(r.porForma.PIX)}</span>
    <span>Débito: ${GF.money(r.porForma['Cartão Débito'])}</span><span>Crédito: ${GF.money(r.porForma['Cartão Crédito'])}</span>
    <span>Reforços: ${GF.money(r.reforcos)} • Sangrias: ${GF.money(r.sangrias)} • Estornos: ${GF.money(r.estornos)}</span></div>`;

  function render() {
    const operar = GF.can('caixa:operar');
    $('#caixa-estado').textContent = atual ? `Caixa aberto em ${GF.date(atual.data_abertura)} por ${atual.aberto_por}` : 'Caixa fechado';
    $('#caixa-estado').className = `badge-status-pill ${atual ? 'badge-success' : 'badge-urgent'}`;
    $('#caixa-btn-abrir').classList.toggle('is-hidden', !operar || !!atual);
    ['#caixa-btn-sangria', '#caixa-btn-reforco', '#caixa-btn-fechar'].forEach(s => $(s).classList.toggle('is-hidden', !operar || !atual));
    $('#caixa-kpis').innerHTML = !atual ? '' : [
      card('Troco inicial', GF.money(atual.troco_inicial), 'Na abertura', 'info', 'coins'),
      ...(atual.resumo ? [
        card('Esperado na gaveta', GF.money(atual.esperado), 'Troco + dinheiro + reforços - sangrias - estornos', 'ok', 'coins'),
        card('Vendas no caixa', atual.resumo.vendas.toLocaleString('pt-BR'), `Dinheiro ${GF.money(atual.resumo.porForma.Dinheiro)}`, 'info', 'receipt'),
        card('PIX e cartões', GF.money(atual.resumo.porForma.PIX + atual.resumo.porForma['Cartão Débito'] + atual.resumo.porForma['Cartão Crédito']), 'Não passam pela gaveta', 'info', 'ticket')
      ] : [])
    ].join('');
    $('#caixa-movimentos').classList.toggle('is-hidden', !atual);
    if (atual) $('#caixa-mov-tabela').innerHTML = tabelaMov(atual.movimentos, 'Nenhuma sangria ou reforço neste caixa.');
  }

  async function carregarAtual() {
    try { atual = (await GF.get('/api/caixa/atual')).caixa; render(); } catch (e) { /* toast */ }
  }

  async function carregarHist(offset = 0) {
    if (typeof offset !== 'number') offset = 0; // chamado direto por eventos
    if (!GF.can('caixa:conferir')) return;
    try {
      const r = await GF.get(`/api/caixa?from=${$('#caixa-de').value}&to=${$('#caixa-ate').value}&limit=${GF.POR_PAGINA}&offset=${offset}`);
      caixas = r.caixas;
      GF.pager($('#caixa-pager'), { total: r.total, offset, ir: carregarHist });
      $('#caixa-hist-corpo').innerHTML = caixas.length ? caixas.map(c => `<tr data-id="${c.id_caixa}">
        <td>${GF.date(c.data_abertura)}<br><small class="muted">${esc(c.aberto_por)}</small></td>
        <td>${c.status === 'Fechado' ? `${GF.date(c.data_fechamento)}<br><small class="muted">${esc(c.fechado_por)}</small>` : '<span class="badge-status-pill badge-success">Aberto</span>'}</td>
        <td>${GF.money(c.esperado)}</td><td>${c.status === 'Fechado' ? GF.money(c.valor_contado) : '-'}</td>
        <td>${c.status === 'Fechado' ? badgeDif(c.diferenca) : '-'}</td>
        <td class="col-acoes"><button class="btn-icon btn-action-info" data-act="ver" title="Ver detalhes" aria-label="Ver caixa de ${GF.date(c.data_abertura)}">${GF.icon('eye')}</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="empty-cell">Nenhum caixa no período.</td></tr>';
    } catch (e) { $('#caixa-hist-corpo').innerHTML = '<tr><td colspan="6" class="empty-cell">Falha ao carregar o histórico de caixas.</td></tr>'; $('#caixa-pager').innerHTML = ''; }
  }

  const recarregar = () => { carregarAtual(); carregarHist(); };

  // Modal com valor (e motivo, se pedir): valida, envia e recarrega a tela.
  function pedirValor({ titulo, aviso = '', rotulo, comMotivo, botao, enviar }) {
    GF.openModal({
      title: titulo,
      html: `${aviso}<div class="form-group"><label for="cx-valor">${rotulo}</label><input type="number" id="cx-valor" min="0" step="0.01" inputmode="decimal"></div>
        ${comMotivo ? '<div class="form-group"><label for="cx-motivo">Motivo *</label><input type="text" id="cx-motivo" maxlength="255"></div>' : ''}
        <div class="modal-actions"><button class="btn btn-secondary" data-cancel>Voltar</button><button class="btn btn-primary" data-ok>${esc(botao)}</button></div>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          if (m.$('#cx-valor').value === '') { GF.marcarErro(m.$('#cx-valor')); GF.toast('Informe o valor.', 'error'); return; }
          try {
            await enviar(Number(m.$('#cx-valor').value), comMotivo ? m.$('#cx-motivo').value.trim() : '');
            m.close(); recarregar(); if (GF.views.vendas.atualizarCaixa) GF.views.vendas.atualizarCaixa();
          } catch (e) { /* toast */ }
        });
      }
    });
  }

  const abrir = () => pedirValor({
    titulo: 'Abrir caixa', rotulo: 'Troco inicial na gaveta (R$) *', botao: 'Abrir caixa',
    enviar: async v => { const r = await GF.post('/api/caixa/abrir', { troco_inicial: v }); GF.toast(r.message, 'success'); }
  });

  const movimento = tipo => pedirValor({
    titulo: tipo === 'sangria' ? 'Sangria (retirar da gaveta)' : 'Reforço (colocar na gaveta)', rotulo: 'Valor (R$) *', comMotivo: true, botao: 'Registrar',
    enviar: async (valor, motivo) => { const r = await GF.post('/api/caixa/movimento', { tipo, valor, motivo }); GF.toast(r.message, 'success'); }
  });

  async function fechar() {
    let espera = 0;
    try { espera = (await GF.get('/api/sales/espera')).esperas.length; } catch (e) { /* segue sem o aviso */ }
    pedirValor({
      titulo: 'Fechar caixa', botao: 'Fechar caixa', rotulo: 'Dinheiro contado na gaveta (R$) *',
      aviso: `<p class="muted">Conte a gaveta e digite o valor. Depois de fechar não dá para alterar.</p>${espera ? `<p class="confirm-msg">${espera} venda(s) em espera continuam guardadas para o próximo caixa.</p>` : ''}`,
      enviar: async v => { const r = await GF.post('/api/caixa/fechar', { valor_contado: v }); resultado(r.caixa); }
    });
  }

  // Só aqui o operador vê o esperado; se houver diferença, pede a justificativa.
  function resultado(c) {
    GF.openModal({
      title: 'Caixa fechado',
      html: `<div class="sale-sum"><span>Esperado: ${GF.money(c.esperado)}</span><span>Contado: ${GF.money(c.valor_contado)}</span><strong>${textoDif(c.diferenca)}</strong></div>
        ${c.diferenca ? '<div class="form-group"><label for="cx-obs">Justificativa da diferença</label><textarea id="cx-obs" rows="3" maxlength="1000"></textarea></div>' : ''}
        <div class="modal-actions-single"><button class="btn btn-primary btn-block" data-ok>${c.diferenca ? 'Salvar e concluir' : 'Concluir'}</button></div>`,
      onMount: m => m.$('[data-ok]').addEventListener('click', async () => {
        const obs = c.diferenca ? m.$('#cx-obs').value.trim() : '';
        if (c.diferenca && !obs) { GF.marcarErro(m.$('#cx-obs')); GF.toast('Explique a diferença do caixa.', 'error'); return; }
        try { if (obs) await GF.post(`/api/caixa/${c.id_caixa}/observacao`, { observacao: obs }); m.close(); } catch (e) { /* toast */ }
      })
    });
  }

  function detalhes(c) {
    GF.openModal({
      title: `Caixa de ${GF.date(c.data_abertura)}`, wide: true,
      html: `<p class="muted">Aberto por ${esc(c.aberto_por)} com troco de ${GF.money(c.troco_inicial)}${c.status === 'Fechado' ? ` • Fechado em ${GF.date(c.data_fechamento)} por ${esc(c.fechado_por)}` : ''}</p>
        ${blocoResumo(c.resumo)}
        ${c.status === 'Fechado' ? `<div class="sale-sum"><span>Esperado: ${GF.money(c.esperado)}</span><span>Contado: ${GF.money(c.valor_contado)}</span><strong>${textoDif(c.diferenca)}</strong></div>` : ''}
        ${c.observacao ? `<div class="detalhes-justificativa-box"><span class="detalhes-just-title">Justificativa</span><p class="detalhe-texto-justificativa">${esc(c.observacao)}</p></div>` : ''}
        <div class="table-responsive">${tabelaMov(c.movimentos, 'Nenhum movimento neste caixa.')}</div>
        <div class="modal-actions-single"><button class="btn btn-secondary btn-block" data-ok>Fechar</button></div>`,
      onMount: m => m.$('[data-ok]').addEventListener('click', m.close)
    });
  }

  GF.views.caixa = {
    load: async () => {
      await GF.syncToday();
      if (!$('#caixa-de').value) { $('#caixa-de').value = GF.today(); $('#caixa-ate').value = GF.today(); }
      recarregar();
    },
    abrir
  };

  GF.initCaixa = () => {
    $('#caixa-btn-abrir').addEventListener('click', abrir);
    $('#caixa-btn-sangria').addEventListener('click', () => movimento('sangria'));
    $('#caixa-btn-reforco').addEventListener('click', () => movimento('reforco'));
    $('#caixa-btn-fechar').addEventListener('click', fechar);
    ['#caixa-de', '#caixa-ate'].forEach(s => $(s).addEventListener('change', () => carregarHist()));
    $('#caixa-hist-corpo').addEventListener('click', e => {
      const b = e.target.closest('[data-act="ver"]'); if (!b) return;
      detalhes(caixas.find(c => c.id_caixa === Number(b.closest('tr').dataset.id)));
    });
  };
})();
