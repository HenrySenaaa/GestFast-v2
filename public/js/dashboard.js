// dashboard.js - Painel inicial: indicadores, vendas da semana, alertas de estoque e validade, compras (RF 10 / RF 11)
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let timer = null, carregando = false, ultimo = null;

  GF.badgeSit = s => `<span class="badge-status-pill ${({ 'Em Aberto': 'badge-warning', 'Cotado': 'badge-info', 'AF Gerada': 'badge-info', 'Finalizado': 'badge-success', 'Cancelado': 'badge-urgent' })[s] || 'badge-info'}">${esc(s)}</span>`;

  // Cores dos gráficos vêm do CSS (mudam no tema escuro e no alto contraste).
  const cor = i => getComputedStyle(document.documentElement).getPropertyValue(`--chart-${(i % 6) + 1}`).trim();
  const okRow = txt => `<div class="figma-data-row dash-ok-row">${GF.icon('ok', 'icon icon-sm')}<span>${esc(txt)}</span></div>`;

  function saudacao() {
    const h = new Date().getHours();
    const nome = ((GF.state.user && GF.state.user.nome) || '').split(' ')[0];
    $('#dash-saudacao').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? `, ${nome}` : ''}`;
    const dia = new Date(`${GF.today()}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#dash-data-hoje').textContent = `${dia.charAt(0).toUpperCase()}${dia.slice(1)} • ${(GF.state.settings && GF.state.settings.estabelecimento) || 'GestFast'}`;
  }

  function kpis(m) {
    const card = ({ ico, tom = '', rotulo, valor, rodape, ir, perm }) => {
      const clic = ir && (!perm || GF.can(perm));
      return `<${clic ? `button type="button" data-ir="${ir}"` : 'div'} class="kpi-card">
        <div class="kpi-top"><span>${rotulo}</span><span class="kpi-ico ${tom}">${GF.icon(ico)}</span></div>
        <div class="kpi-value">${valor}</div><div class="kpi-foot">${rodape}</div></${clic ? 'button' : 'div'}>`;
    };
    $('#dash-kpis').innerHTML = [
      card({ ico: 'coins', rotulo: 'Faturamento hoje', valor: GF.moneyShort(Number(m.totalVendasHoje)), rodape: `${m.vendasHojeCount} venda(s) • ticket ${GF.money(Number(m.ticketMedioHoje))}`, ir: 'historico', perm: 'vendas:ver' }),
      card({ ico: 'box', tom: 'info', rotulo: 'Produtos ativos', valor: m.totalProdutos, rodape: `${GF.qty(m.totalItensEstoque)} itens em estoque`, ir: 'estoque', perm: 'estoque:conferir' }),
      card({ ico: 'alert', tom: m.alertasCriticosCount ? 'bad' : 'ok', rotulo: 'Estoque mínimo', valor: m.alertasCriticosCount, rodape: m.alertasCriticosCount ? 'produto(s) para repor' : 'tudo em dia', ir: 'estoque', perm: 'estoque:conferir' }),
      card({ ico: 'clock', tom: m.produtosVencidosCount ? 'bad' : m.produtosVencendoCount ? 'warn' : 'ok', rotulo: 'Validade', valor: m.produtosVencendoCount, rodape: m.produtosVencendoCount ? `${m.produtosVencidosCount} vencido(s)` : 'nada vencendo', ir: 'estoque', perm: 'estoque:conferir' }),
      card({ ico: 'clipboard', tom: 'warn', rotulo: 'Requisições abertas', valor: m.requisicoesAbertasCount, rodape: 'aguardando fornecedor', ir: 'requisicoes', perm: 'requisicoes:ver' })
    ].join('');
  }

  // Barras dos últimos 7 dias (hoje em destaque).
  function semana(dias) {
    const max = Math.max(...dias.map(d => d.total), 0);
    const hoje = GF.today();
    $('#dash-semana-chart').innerHTML = dias.map(d => {
      const h = max > 0 ? Math.max(2, Math.round((d.total / max) * 100)) : 2;
      const nome = new Date(`${d.dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      return `<div class="bar-col${d.dia === hoje ? ' hoje' : ''}" title="${GF.date(d.dia)}: ${GF.money(d.total)} em ${d.vendas} venda(s)">
        <span class="bar-val">${d.total ? GF.moneyShort(d.total).replace('R$', '').trim() : ''}</span>
        <div class="bar" style="height:${h}%"></div><span class="bar-label">${d.dia === hoje ? 'hoje' : esc(nome)}</span></div>`;
    }).join('');
    const total = dias.reduce((a, d) => a + d.total, 0), n = dias.reduce((a, d) => a + d.vendas, 0);
    $('#dash-semana-resumo').textContent = `${GF.money(total)} em ${n} venda(s) • média ${GF.money(total / 7)}/dia`;
  }

  // Rosca SVG (circunferência 100 => dasharray em porcentagem).
  function rosca(dist) {
    const total = dist.reduce((a, c) => a + Number(c.quantidade), 0);
    let acc = 0;
    const fatias = dist.map((c, i) => {
      const p = total ? (Number(c.quantidade) / total) * 100 : 0;
      const el = `<circle r="15.915" cx="18" cy="18" fill="none" stroke="${cor(i)}" stroke-width="4.2" stroke-dasharray="${Math.max(0, p - 0.6)} ${100 - Math.max(0, p - 0.6)}" stroke-dashoffset="${-acc}"><title>${esc(c.categoria)}: ${GF.qty(c.quantidade)} (${esc(c.porcentagem)}%)</title></circle>`;
      acc += p;
      return el;
    }).join('');
    $('#dash-donut').innerHTML = `<svg viewBox="0 0 36 36"><circle r="15.915" cx="18" cy="18" fill="none" stroke="var(--surface-3)" stroke-width="4.2"/>${fatias}</svg>
      <div class="donut-center"><div><strong>${GF.qty(total)}</strong><span>itens</span></div></div>`;
    $('#dash-chart-legend').innerHTML = dist.length ? dist.map((x, i) => `
      <div class="figma-legend-item"><div><span class="legend-square" style="background:${cor(i)}"></span><span>${esc(x.categoria)}</span></div><strong>${esc(x.porcentagem)}%</strong></div>`).join('')
      : '<p class="muted">Sem estoque cadastrado.</p>';
  }

  function render(d) {
    ultimo = d;
    saudacao();
    kpis(d.metricas);
    semana(d.vendasSemana || []);
    rosca(d.distribuicaoEstoque);

    const pedir = GF.can('requisicoes:criar');
    $('#dash-alertas-figma-list').innerHTML = d.alertas.length ? d.alertas.map(a => `
      <div class="figma-data-row${pedir ? ' row-click' : ''}" data-pedir="${a.id_produto}"${pedir ? ' tabindex="0" role="button"' : ''} title="${esc(a.mensagem)} (mínimo ${GF.qty(a.estoque_minimo)} ${esc(a.unidade)})${pedir ? ' - clique para criar uma requisição' : ''}">
        <span>${esc(a.nome_produto)}</span>
        <span class="val-highlight">${GF.qty(a.quantidade_estoque)} / ${GF.qty(a.estoque_minimo)} ${esc(a.unidade)}</span>
      </div>`).join('') : okRow('Todos os itens com estoque regular');

    const val = d.validades;
    $('#dash-validade-resumo').textContent = val.itens.length ? `${val.vencidos} vencido(s) • ${val.itens.length - val.vencidos} em até ${val.dias} dia(s)` : '';
    const perda = GF.can('movimentos:registrar');
    $('#dash-validade-list').innerHTML = val.itens.length ? val.itens.map(i => `
      <div class="figma-data-row${perda ? ' row-click' : ''}" data-perda="${i.id_produto}" data-qtd="${i.quantidade_estoque}"${perda ? ' tabindex="0" role="button"' : ''} title="Lote ${esc(i.lote || '-')} • validade ${GF.date(i.validade)} • ${GF.qty(i.quantidade_estoque)} ${esc(i.unidade)} (${GF.money(i.valor_em_risco)} no custo)${perda ? ' - clique para dar baixa como perda' : ''}">
        <span>${esc(i.nome_produto)}</span>
        <span class="val-highlight ${i.dias_restantes < 0 ? 'val-vencido' : 'val-vencendo'}">${i.dias_restantes < 0 ? `Vencido (${GF.date(i.validade)})` : i.dias_restantes === 0 ? 'Vence hoje' : `${i.dias_restantes} dia(s)`}</span>
      </div>`).join('') : okRow('Nenhum produto vencido ou perto de vencer');

    $('#dash-compras-figma-list').innerHTML = d.ultimasCompras.length ? d.ultimasCompras.map(c => `
      <div class="figma-data-row row-click" data-req="${c.id_requisicao}" tabindex="0" role="button" title="${esc(c.codigo_pedido)} • ${esc(c.fornecedor)} • ${esc(c.situacao)}">
        <span>${esc(c.produto_nome)} <small>x${GF.qty(c.quantidade_pedida)}</small></span>
        ${GF.badgeSit(c.situacao)}
      </div>`).join('') : '<div class="empty-state">Nenhuma compra recente</div>';
  }

  async function atualizar(manual) {
    if (carregando) return;
    carregando = true;
    try {
      const r = await GF.get('/api/dashboard', true);
      render(r.data);
      $('#dash-error').classList.add('is-hidden');
      $('#dash-last-sync-time').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} • banco ${r.latencyMs || 0} ms`;
      $('#dash-interval-text').textContent = `Atualização periódica a cada ${Math.max(2, Number(GF.state.settings.intervaloAtualizacaoSeg) || 3)}s`;
      if (manual) GF.toast('Painel sincronizado.', 'info');
    } catch (e) {
      if (e.status !== 401) $('#dash-error').classList.remove('is-hidden');
    } finally { carregando = false; }
  }

  function start() {
    stop();
    const s = Math.max(2, Number(GF.state.settings.intervaloAtualizacaoSeg) || 3);
    timer = setInterval(() => { if (!document.hidden) atualizar(false); }, s * 1000);
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  GF.views.dashboard = {
    stop,
    load: async () => {
      try { const r = await GF.get('/api/settings', true); GF.state.settings = r.settings; GF.state.hoje = r.hoje; } catch (e) { /* mantém */ }
      await atualizar(false);
      start();
    }
  };

  GF.initDashboard = () => {
    $('#btn-dash-force-sync').addEventListener('click', () => atualizar(true));
    $('#btn-dash-nova-requisicao').addEventListener('click', () => GF.views.requisicoes.abrirNova());
    $('#dash-btn-ir-estoque').addEventListener('click', () => GF.navigate('estoque'));
    $('#dash-btn-ir-pdv').addEventListener('click', () => GF.navigate('vendas'));
    $('#dash-btn-ir-requisicao').addEventListener('click', () => GF.navigate('requisicoes'));
    GF.delegate($('#dash-kpis'), 'click', '[data-ir]', (e, b) => GF.navigate(b.dataset.ir));
    const pedir = (e, b) => { if (GF.can('requisicoes:criar')) GF.views.requisicoes.abrirNova(Number(b.dataset.pedir)); };
    const perda = (e, row) => {
      if (!GF.can('movimentos:registrar')) return;
      GF.abrirPerda({ id_produto: Number(row.dataset.perda), quantidade: Number(row.dataset.qtd), motivo: 'Vencido', aoSalvar: () => atualizar(false) });
    };
    const abrirReq = (e, row) => { GF.views.requisicoes.selecionar = Number(row.dataset.req); GF.navigate('requisicoes'); };
    const enter = fn => (e, el) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e, el); } };
    GF.delegate($('#dash-alertas-figma-list'), 'click', '[data-pedir]', pedir);
    GF.delegate($('#dash-alertas-figma-list'), 'keydown', '[data-pedir]', enter(pedir));
    GF.delegate($('#dash-validade-list'), 'click', '[data-perda]', perda);
    GF.delegate($('#dash-validade-list'), 'keydown', '[data-perda]', enter(perda));
    GF.delegate($('#dash-compras-figma-list'), 'click', '[data-req]', abrirReq);
    GF.delegate($('#dash-compras-figma-list'), 'keydown', '[data-req]', enter(abrirReq));
    GF.onThemeChange.push(() => { if (ultimo) rosca(ultimo.distribuicaoEstoque); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && GF.state.currentView === 'dashboard' && GF.state.user) atualizar(false); });
  };
})();
