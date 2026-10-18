// relatorios.js - Relatórios de vendas, estoque, desperdício e consumo da produção com filtros e exportação PDF/Excel (RF 12, 13, 14)
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let tipo = 'vendas', categoria = '', ultimo = null;
  const ROTA = { vendas: 'sales', estoque: 'stock', perdas: 'losses', consumo: 'consumption' };

  function periodoTexto() {
    const de = $('#rel-de').value, ate = $('#rel-ate').value;
    if (de && ate && de === ate) return de === GF.today() ? 'do Dia' : `de ${GF.date(de)}`;
    if (de || ate) return `de ${de ? GF.date(de) : 'início'} a ${ate ? GF.date(ate) : 'hoje'}`;
    return 'de Todo o Período';
  }
  const query = fmt => {
    const q = [];
    ['de:from', 'ate:to'].forEach(p => { const [id, k] = p.split(':'); if ($(`#rel-${id}`).value) q.push(`${k}=${$(`#rel-${id}`).value}`); });
    if (categoria) q.push(`categoria=${categoria}`);
    if (fmt) q.push(`format=${fmt}`);
    return q.join('&');
  };

  function renderCategorias() {
    const itens = [{ id: '', nome: 'Geral' }, ...GF.state.categories.map(c => ({ id: String(c.id_categoria), nome: c.nome_categoria }))];
    $('#rel-categorias').innerHTML = itens.map(i => `<div class="rel-cat-item ${categoria === i.id ? 'active' : ''}" data-cat="${i.id}" tabindex="0" role="button">${esc(i.nome)}</div>`).join('');
  }

  function renderVendas(r) {
    $('#rel-titulo').textContent = `Vendidos ${periodoTexto()}${categoria ? ' • ' + GF.categoryName(categoria) : ''}`;
    $('#rel-thead').innerHTML = '<tr><th>Produto</th><th>Valor</th><th>Quant.</th><th>Total</th></tr>';
    $('#relatorio-vendas-tabela').innerHTML = r.itensVendidos.length ? r.itensVendidos.map(i => `<tr><td><strong>${esc(i.nome_produto)}</strong></td><td>R$ ${GF.num2(i.valor_unitario)}</td><td>x${GF.qty(i.quantidade)}${GF.fractional(i.unidade) ? ' ' + esc(i.unidade) : ''}</td><td><strong>${GF.num2(i.total)}</strong></td></tr>`).join('')
      : '<tr><td colspan="4" style="text-align:center; padding:16px;">Nenhum dado encontrado para o período ou categoria informada.</td></tr>';
    const pg = r.porPagamento.map(p => `${p.forma} ${GF.money(p.total)}`).join(' • ');
    $('#rel-kpis').textContent = r.quantidadeTransacoes ? `${r.quantidadeTransacoes} venda(s) • ticket médio ${GF.money(r.ticketMedio)} • descontos ${GF.money(r.totalDescontos)}` : '';
    $('#rel-kpis').title = pg;
    $('#rel-pagamentos').innerHTML = '';
    $('#rel-total-faturamento').textContent = GF.num2(r.totalGeral);
    $('#rel-footer').classList.remove('is-hidden');
  }

  function renderEstoque(r) {
    $('#rel-titulo').textContent = `Estoque • movimentações ${periodoTexto()}${categoria ? ' • ' + GF.categoryName(categoria) : ''}`;
    $('#rel-thead').innerHTML = '<tr><th>Produto</th><th>Categoria</th><th>Entradas</th><th>Saídas</th><th>Saldo atual</th><th>Mín.</th><th>Situação</th></tr>';
    $('#relatorio-vendas-tabela').innerHTML = r.linhas.length ? r.linhas.map(l => `<tr class="${l.situacao === 'Crítico' ? 'row-critical' : ''}"><td>${esc(l.nome_produto)}</td><td>${esc(l.categoria)}</td><td class="text-ok-strong">${l.entradas ? `+${GF.qty(l.entradas)}` : '0'}</td><td class="text-danger-strong">${l.saidas ? `-${GF.qty(l.saidas)}` : '0'}</td><td><strong>${GF.qty(l.saldo_atual)} ${esc(l.unidade)}</strong></td><td>${GF.qty(l.estoque_minimo)}</td><td><span class="badge-status-pill ${l.situacao === 'Crítico' ? 'badge-urgent' : 'badge-success'}">${l.situacao}</span></td></tr>`).join('')
      : '<tr><td colspan="7" class="empty-cell">Nenhum dado encontrado para o período ou categoria informada.</td></tr>';
    $('#rel-kpis').textContent = `${r.totalProdutos} produto(s) • ${r.totalCriticos} em nível crítico • valor em estoque (custo) ${GF.money(r.valorTotalEstoque)}`;
    $('#rel-pagamentos').innerHTML = '';
    $('#rel-total-faturamento').textContent = GF.num2(r.valorTotalEstoque);
    $('#rel-footer').classList.remove('is-hidden');
  }

  function renderPerdas(r) {
    $('#rel-titulo').textContent = `Perdas e sobras ${periodoTexto()}${categoria ? ' • ' + GF.categoryName(categoria) : ''}`;
    $('#rel-thead').innerHTML = '<tr><th>Produto</th><th>Categoria</th><th>Registros</th><th>Quant. perdida</th><th>Valor (custo)</th></tr>';
    $('#relatorio-vendas-tabela').innerHTML = r.porProduto.length ? r.porProduto.map(p => `<tr><td><strong>${esc(p.nome_produto)}</strong></td><td>${esc(p.categoria)}</td><td>${p.registros}</td><td class="text-danger-strong">${GF.qty(p.quantidade)} ${esc(p.unidade)}</td><td><strong>${GF.num2(p.valor_total)}</strong></td></tr>`).join('')
      : '<tr><td colspan="5" class="empty-cell">Nenhuma perda registrada no período ou categoria informada.</td></tr>';
    $('#rel-kpis').textContent = r.totalRegistros ? `${r.totalRegistros} registro(s) • ${r.porMotivo.map(m => `${m.motivo} ${GF.money(m.valor_total)}`).join(' • ')}` : '';
    $('#rel-kpis').title = '';
    $('#rel-pagamentos').innerHTML = '';
    $('#rel-total-faturamento').textContent = GF.num2(r.valorTotal);
    $('#rel-footer').classList.remove('is-hidden');
  }

  // Consumo da produção: produtos feitos (custo real) e insumos gastos no período.
  function renderConsumo(r) {
    $('#rel-titulo').textContent = `Consumo da produção ${periodoTexto()}${categoria ? ' • ' + GF.categoryName(categoria) : ''}`;
    $('#rel-thead').innerHTML = '<tr><th>Produto / insumo</th><th>Produções</th><th>Quantidade</th><th>Custo unit.</th><th>Custo total</th></tr>';
    const linhasProd = r.porProduto.map(p => `<tr><td><strong>${esc(p.nome_produto)}</strong></td><td>${p.producoes}</td><td class="text-ok-strong">+${GF.qty(p.quantidade)} ${esc(p.unidade)}</td><td>${GF.num2(p.custo_unitario)}</td><td><strong>${GF.num2(p.custo_total)}</strong></td></tr>`).join('');
    const linhasIns = r.porInsumo.map(i => `<tr><td>${esc(i.nome_produto)}</td><td></td><td class="text-danger-strong">-${GF.qty(i.quantidade)} ${esc(i.unidade)}</td><td></td><td>${GF.num2(i.custo_total)}</td></tr>`).join('');
    $('#relatorio-vendas-tabela').innerHTML = r.porProduto.length
      ? `<tr class="rel-subhead"><td colspan="5">Produzido</td></tr>${linhasProd}<tr class="rel-subhead"><td colspan="5">Insumos consumidos</td></tr>${linhasIns}`
      : '<tr><td colspan="5" class="empty-cell">Nenhuma produção registrada no período ou categoria informada.</td></tr>';
    $('#rel-kpis').textContent = r.totalProducoes ? `${r.totalProducoes} produção(ões) • custo dos insumos ${GF.money(r.custoTotal)}` : '';
    $('#rel-kpis').title = '';
    $('#rel-pagamentos').innerHTML = '';
    $('#rel-total-faturamento').textContent = GF.num2(r.custoTotal);
    $('#rel-footer').classList.remove('is-hidden');
  }

  function validarPeriodo() {
    const de = $('#rel-de').value, ate = $('#rel-ate').value;
    if (de && ate && de > ate) { GF.marcarErro($('#rel-de')); GF.toast('A data inicial não pode ser posterior à data final.', 'error'); return false; }
    return true;
  }

  async function gerar() {
    if (!validarPeriodo()) return;
    $('#btn-gerar-relatorio').disabled = true;
    try {
      const r = (await GF.get(`/api/reports/${ROTA[tipo]}?${query()}`)).report;
      ultimo = r;
      ({ vendas: renderVendas, estoque: renderEstoque, perdas: renderPerdas, consumo: renderConsumo })[tipo](r);
    } catch (e) { ultimo = null; } finally { $('#btn-gerar-relatorio').disabled = false; }
  }

  async function exportar(fmt) {
    if (!validarPeriodo()) return;
    const vazio = ultimo && !({ vendas: ultimo.itensVendidos, estoque: ultimo.linhas, perdas: ultimo.porProduto, consumo: ultimo.porProduto })[tipo].length;
    if (!ultimo || vazio) { GF.toast('Não há dados para exportar. Gere um relatório com resultados primeiro.', 'error'); return; }
    const ok = await GF.download(`/api/reports/${ROTA[tipo]}?${query(fmt)}`, `gestfast-${tipo}.${fmt}`);
    if (ok) GF.toast(`Relatório exportado em ${fmt === 'pdf' ? 'PDF' : 'Excel'} com sucesso!`, 'success');
  }

  GF.views.relatorios = {
    load: async () => {
      await GF.syncToday();
      if (!GF.state.categories.length) await GF.loadCategories();
      if (!$('#rel-de').value) { $('#rel-de').value = GF.today(); $('#rel-ate').value = GF.today(); }
      renderCategorias();
      await gerar();
    }
  };

  GF.initRelatorios = () => {
    GF.$$('.rel-tab').forEach(b => b.addEventListener('click', () => {
      tipo = b.dataset.rel; GF.$$('.rel-tab').forEach(x => x.classList.toggle('active', x === b));
      if (tipo !== 'vendas' && !$('#rel-de').dataset.setByUser) { $('#rel-de').value = ''; $('#rel-ate').value = ''; }
      if (tipo === 'vendas' && !$('#rel-de').value) { $('#rel-de').value = GF.today(); $('#rel-ate').value = GF.today(); }
      gerar();
    }));
    ['#rel-de', '#rel-ate'].forEach(s => $(s).addEventListener('change', () => { $('#rel-de').dataset.setByUser = '1'; gerar(); }));
    $('#btn-gerar-relatorio').addEventListener('click', gerar);
    $('#btn-exportar-pdf').addEventListener('click', () => exportar('pdf'));
    $('#btn-exportar-excel').addEventListener('click', () => exportar('xlsx'));
    const sel = (e, el) => { categoria = el.dataset.cat; renderCategorias(); gerar(); };
    GF.delegate($('#rel-categorias'), 'click', '.rel-cat-item', sel);
    GF.delegate($('#rel-categorias'), 'keydown', '.rel-cat-item', (e, el) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel(e, el); } });
  };
})();
