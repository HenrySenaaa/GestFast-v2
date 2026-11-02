// auditoria.js - Mapa de auditoria do estoque: o que conferir primeiro e o extrato de cada produto
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let mapa = null;
  const BADGE = { Alta: 'badge-urgent', Média: 'badge-warning', Baixa: 'badge-success' };
  const sinal = n => (n > 0 ? '+' : '') + GF.qty(n);

  function cartoes(r) {
    const card = (rotulo, valor, rodape, tom, ico, filtro) => `<button type="button" class="kpi-card" data-prio="${filtro}">
      <div class="kpi-top"><span>${rotulo}</span><span class="kpi-ico ${tom}">${GF.icon(ico)}</span></div>
      <div class="kpi-value">${valor}</div><div class="kpi-foot">${rodape}</div></button>`;
    $('#aud-cards').innerHTML = [
      card('Prioridade alta', r.alta, 'Conferir hoje', 'bad', 'alert', 'Alta'),
      card('Prioridade média', r.media, 'Conferir nesta semana', 'warn', 'clock', 'Média'),
      card('Em dia', r.baixa, 'Sem sinal de problema', 'ok', 'ok', 'Baixa'),
      card('Nunca conferidos', r.nuncaConferidos, 'Ainda sem contagem física', 'info', 'box', '')
    ].join('');
  }

  function render() {
    if (!mapa) return;
    const t = $('#aud-busca').value.trim().toLowerCase(), pr = $('#aud-prioridade').value;
    const lista = mapa.itens.filter(i => (!pr || i.prioridade === pr) && (!t || `${i.nome_produto} ${i.codigo_barras}`.toLowerCase().includes(t)));
    $('#aud-resumo').textContent = `${lista.length} de ${mapa.itens.length} produto(s) • ajustes dos últimos ${mapa.dias} dias`;
    $('#aud-corpo').innerHTML = lista.length ? lista.map(i => `<tr data-id="${i.id_produto}">
      <td><span class="badge-status-pill ${BADGE[i.prioridade]}">${esc(i.prioridade)}</span></td>
      <td><strong>${esc(i.nome_produto)}</strong><br><small class="muted">${esc(i.codigo_barras)} • ${esc(i.tipo)}</small></td>
      <td>${GF.qty(i.quantidade_estoque)} ${esc(i.unidade)}</td>
      <td>${i.ultima_conferencia ? `${GF.date(i.ultima_conferencia)}<br><small class="muted">há ${i.dias_sem_conferir} dia(s) • ${i.conferencias} conferência(s)</small>` : '<span class="muted">Nunca</span>'}</td>
      <td>${i.divergencia_ultima ? `<strong>${sinal(i.divergencia_ultima)} ${esc(i.unidade)}</strong><br><small class="muted">${GF.money(i.valor_divergencia_ultima)} (custo)</small>` : i.ultima_conferencia ? 'Bateu' : '-'}</td>
      <td>${i.ajustes ? `${i.ajustes}<br><small class="muted">${GF.money(i.valor_ajustes)}</small>` : '0'}</td>
      <td><div class="aud-motivos">${i.motivos.length ? i.motivos.map(m => `<span>${esc(m)}</span>`).join('') : '<span class="muted">Nada a apontar</span>'}</div></td>
      <td class="col-acoes">
        <button class="btn-icon btn-action-info" data-act="extrato" title="Ver extrato do produto" aria-label="Extrato de ${esc(i.nome_produto)}">${GF.icon('history')}</button>
        ${GF.can('estoque:conferir') ? `<button class="btn-icon btn-action-accept" data-act="conferir" title="Conferir agora (abre Verificar Estoque)" aria-label="Conferir ${esc(i.nome_produto)}">${GF.icon('check')}</button>` : ''}
      </td></tr>`).join('') : '<tr><td colspan="8" class="empty-cell">Nenhum produto para os filtros informados.</td></tr>';
  }

  async function carregar() {
    try {
      mapa = (await GF.get(`/api/audit?dias=${$('#aud-dias').value}`)).mapa;
      cartoes(mapa.resumo);
      render();
    } catch (e) { $('#aud-corpo').innerHTML = '<tr><td colspan="8" class="empty-cell">Falha ao carregar o mapa de auditoria.</td></tr>'; }
  }

  // Extrato: cada movimento com saldo antes → depois; ajustes à mão ficam destacados.
  function extrato(item) {
    const de = new Date(Date.parse(GF.today()) - 30 * 86400000).toISOString().slice(0, 10);
    GF.openModal({
      title: `Extrato - ${item.nome_produto}`, wide: true,
      html: `<div class="filter-toolbar">
          <label class="inline-field">De <input type="date" id="ext-de" class="select-field" value="${de}"></label>
          <label class="inline-field">Até <input type="date" id="ext-ate" class="select-field" value="${GF.today()}"></label>
          <span class="toolbar-hint" id="ext-resumo"></span>
        </div>
        <div class="table-responsive ext-tabela"><table class="figma-styled-table">
          <thead><tr><th>Data</th><th>Movimento</th><th>Quant.</th><th>Saldo</th><th>Responsável</th><th>Observação</th></tr></thead>
          <tbody id="ext-corpo"><tr><td colspan="6" class="empty-cell">Carregando…</td></tr></tbody></table></div>
        <h4 class="ext-sub">Últimas conferências</h4>
        <div id="ext-confs"></div>
        <div class="modal-actions-single"><button class="btn btn-secondary btn-block" data-ok>Fechar</button></div>`,
      onMount: m => {
        m.$('[data-ok]').addEventListener('click', m.close);
        const ver = async () => {
          const q = [m.$('#ext-de').value && `from=${m.$('#ext-de').value}`, m.$('#ext-ate').value && `to=${m.$('#ext-ate').value}`].filter(Boolean).join('&');
          let x;
          try { x = (await GF.get(`/api/audit/products/${item.id_produto}?${q}`)).extrato; } catch (e) { return; }
          const un = esc(x.produto.unidade);
          const ajustes = x.movimentos.filter(mv => mv.atencao).length;
          m.$('#ext-resumo').textContent = `${x.movimentos.length} movimento(s)${x.truncado ? ' (mais recentes)' : ''} • saldo ${GF.qty(x.saldoInicial)} → ${GF.qty(x.saldoFinal)} ${x.produto.unidade} • ${ajustes} ajuste(s) à mão`;
          m.$('#ext-corpo').innerHTML = x.movimentos.length ? x.movimentos.map(mv => `<tr class="${mv.atencao ? 'row-atencao' : ''}">
            <td>${GF.date(mv.data_movimentacao)}</td>
            <td>${esc(mv.tipo_movimentacao)} • ${esc(GF.origem(mv.origem, mv.tipo_movimentacao))}${mv.atencao ? ' <span class="badge-status-pill badge-warning">à mão</span>' : ''}</td>
            <td>${mv.tipo_movimentacao === 'Entrada' ? '+' : '-'}${GF.qty(mv.quantidade)} ${un}</td>
            <td>${GF.qty(mv.saldo_antes)} → <strong>${GF.qty(mv.saldo_depois)}</strong></td>
            <td>${esc(mv.usuario_nome)}</td><td>${esc(mv.observacao)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">Nenhum movimento no período.</td></tr>';
          m.$('#ext-confs').innerHTML = x.conferencias.length ? `<table class="figma-styled-table"><thead><tr><th>Data</th><th>Responsável</th><th>Sistema</th><th>Físico</th><th>Divergência</th></tr></thead><tbody>
            ${x.conferencias.map(c => `<tr><td>${GF.date(c.data_conferencia)}</td><td>${esc(c.responsavel)}</td><td>${GF.qty(c.quantidade_sistema)}</td><td>${GF.qty(c.quantidade_fisica)}</td>
              <td>${c.divergencia ? `<strong>${sinal(c.divergencia)} ${un}</strong>${c.ajustou_estoque ? '' : ' <small class="muted">(sem ajuste)</small>'}` : 'Bateu'}</td></tr>`).join('')}</tbody></table>`
            : '<p class="muted">Este produto ainda não foi conferido.</p>';
        };
        ['#ext-de', '#ext-ate'].forEach(s => m.$(s).addEventListener('change', ver));
        ver();
      }
    });
  }

  GF.views.auditoria = { load: carregar };

  GF.initAuditoria = () => {
    $('#aud-dias').addEventListener('change', carregar);
    $('#aud-prioridade').addEventListener('change', render);
    $('#aud-busca').addEventListener('input', render);
    $('#aud-cards').addEventListener('click', e => { const b = e.target.closest('[data-prio]'); if (b) { $('#aud-prioridade').value = b.dataset.prio; render(); } });
    $('#aud-corpo').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b || !mapa) return;
      const item = mapa.itens.find(i => i.id_produto === Number(b.closest('tr').dataset.id));
      if (b.dataset.act === 'extrato') extrato(item);
      else { GF.views.estoque.filtrar = item.nome_produto; GF.navigate('estoque'); }
    });
  };
})();
