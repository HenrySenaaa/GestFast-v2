// producao.js - Ficha técnica (receita, custo e margem) e registro de produção com baixa dos insumos (etapa 3)
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let fichas = [], producoes = [];

  // Margem sobre o preço de venda: faixas de referência para destacar produto com custo alto.
  const corMargem = m => (m === null || m === undefined ? 'badge-neutral' : m >= 50 ? 'badge-success' : m >= 30 ? 'badge-warning' : 'badge-urgent');
  const pct = m => `${String(m).replace('.', ',')}%`;

  // ---------------------------------------------------------------- fichas técnicas
  async function carregarFichas() {
    try { fichas = (await GF.get('/api/recipes')).fichas; } catch (e) { $('#fichas-corpo').innerHTML = '<tr><td colspan="7" class="empty-cell">Falha ao carregar as fichas técnicas.</td></tr>'; return; }
    const sem = fichas.filter(f => !f.id_ficha).length;
    $('#fichas-resumo').textContent = `${fichas.length} produto(s) de produção própria${sem ? ` • ${sem} sem ficha técnica` : ''}`;
    const editar = GF.can('fichas:editar'), produzir = GF.can('producao:registrar');
    $('#fichas-corpo').innerHTML = fichas.length ? fichas.map(f => `<tr data-id="${f.id_produto}">
      <td><strong>${esc(f.nome_produto)}</strong>${f.id_ficha ? `<br><small class="muted">${f.itens.length} insumo(s)</small>` : ''}</td>
      <td>${f.id_ficha ? `1 ${esc(f.nome_rendimento)} = ${GF.qty(f.rendimento)} ${esc(f.unidade)}` : '<span class="badge-status-pill badge-warning">Sem ficha</span>'}</td>
      <td>${f.id_ficha ? `${GF.money(f.custo_unitario)} / ${esc(f.unidade)}` : '—'}</td>
      <td>${GF.money(f.preco_venda)}</td>
      <td>${f.id_ficha ? `<span class="badge-status-pill ${corMargem(f.margem_percent)}">${pct(f.margem_percent)}</span>` : '—'}</td>
      <td>${f.atualizada_em ? `${GF.date(f.atualizada_em)}<br><small class="muted">${esc(f.atualizada_por || '')}</small>` : '—'}</td>
      <td class="nowrap">
        ${editar ? `<button class="btn btn-sm btn-secondary" data-act="editar">${GF.icon(f.id_ficha ? 'edit' : 'plus', 'icon icon-sm')} ${f.id_ficha ? 'Editar' : 'Criar ficha'}</button>` : ''}
        ${f.id_ficha && !editar ? `<button class="btn btn-sm btn-secondary" data-act="ver">Ver receita</button>` : ''}
        ${f.id_ficha && produzir ? `<button class="btn btn-sm btn-primary" data-act="produzir">${GF.icon('flame', 'icon icon-sm')} Produzir</button>` : ''}
      </td></tr>`).join('')
      : '<tr><td colspan="7" class="empty-cell">Nenhum produto do tipo "Produção própria". Mude o tipo do produto no Cadastro de Produtos.</td></tr>';
  }

  function linhaInsumo(insumos, it = {}) {
    return `<div class="ficha-linha"><select class="ficha-ins" aria-label="Insumo">${insumos.map(p => `<option value="${p.id_produto}" data-un="${esc(p.unidade)}" data-custo="${p.preco_custo}"${p.id_produto === it.id_insumo ? ' selected' : ''}>${esc(p.nome_produto)}${p.tipo === 'Insumo' ? '' : ` (${esc(p.tipo)})`}</option>`).join('')}</select>
      <input type="number" class="ficha-qtd" min="0.001" step="0.001" value="${it.quantidade || ''}" placeholder="0" aria-label="Quantidade por receita">
      <span class="ficha-un"></span><span class="ficha-custo"></span>
      <button type="button" class="btn-icon btn-action-cancel ficha-rem" title="Remover insumo" aria-label="Remover insumo">${GF.icon('x')}</button></div>`;
  }

  async function abrirFicha(idProduto, somenteLeitura) {
    const base = fichas.find(f => f.id_produto === idProduto);
    let insumos;
    try { insumos = (await GF.get('/api/products')).products.filter(p => p.id_produto !== idProduto); } catch (e) { return; }
    insumos.sort((a, b) => (a.tipo === 'Insumo') === (b.tipo === 'Insumo') ? a.nome_produto.localeCompare(b.nome_produto) : a.tipo === 'Insumo' ? -1 : 1);
    const f = base.id_ficha ? base : { itens: [], rendimento: '', nome_rendimento: 'fornada', validade_dias: '', observacao: '' };
    GF.openModal({
      title: `Ficha técnica • ${base.nome_produto}`,
      wide: true,
      html: `<div class="ficha-topo">
          <div class="form-group"><label for="ficha-rend">1 receita rende *</label><div class="input-sufixo"><input type="number" id="ficha-rend" min="0.001" step="${GF.fractional(base.unidade) ? '0.001' : '1'}" value="${f.rendimento}"><span>${esc(base.unidade)}</span></div></div>
          <div class="form-group"><label for="ficha-nome-rend">Nome da receita</label><input type="text" id="ficha-nome-rend" maxlength="40" value="${esc(f.nome_rendimento)}" placeholder="fornada, assadeira..."></div>
          <div class="form-group"><label for="ficha-validade">Validade do pronto</label><div class="input-sufixo"><input type="number" id="ficha-validade" min="0" max="365" step="1" value="${f.validade_dias === null ? '' : f.validade_dias}" placeholder="—"><span>dia(s)</span></div></div>
        </div>
        <div class="ficha-lines-head"><span>Insumo *</span><span>Qtd. por receita *</span><span>Unid</span><span>Custo</span><span></span></div>
        <div id="ficha-linhas"></div>
        <button type="button" class="btn btn-sm btn-secondary" id="ficha-add">+ Adicionar insumo</button>
        <div class="form-group mov-obs"><label for="ficha-obs">Modo de preparo / observação</label><textarea id="ficha-obs" rows="2" maxlength="2000" placeholder="Ex.: bater 12 min; fermentar 3 h.">${esc(f.observacao)}</textarea></div>
        <div class="ficha-resumo" id="ficha-resumo"></div>
        <div class="modal-actions">
          ${base.id_ficha && !somenteLeitura ? '<button type="button" class="btn btn-danger-outline" data-del>Excluir ficha</button><span class="flex-1"></span>' : ''}
          <button type="button" class="btn btn-secondary" data-cancel>${somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
          ${somenteLeitura ? '' : '<button type="button" class="btn btn-primary" data-ok>Salvar ficha</button>'}
        </div>`,
      onMount: m => {
        const box = m.$('#ficha-linhas');
        const add = it => {
          box.insertAdjacentHTML('beforeend', linhaInsumo(insumos, it));
          atualizar();
        };
        // Custo de cada linha, da receita e por unidade, e margem frente ao preço de venda (recalculados ao digitar).
        function atualizar() {
          let total = 0;
          GF.$$('.ficha-linha', box).forEach(div => {
            const opt = $('.ficha-ins', div).selectedOptions[0];
            const q = Number($('.ficha-qtd', div).value) || 0, c = q * Number(opt.dataset.custo);
            total += c;
            $('.ficha-un', div).textContent = opt.dataset.un;
            $('.ficha-custo', div).textContent = GF.money(c);
            $('.ficha-qtd', div).step = GF.fractional(opt.dataset.un) ? '0.001' : '1';
          });
          GF.$$('.ficha-rem', box).forEach(b => { b.style.visibility = box.children.length > 1 ? 'visible' : 'hidden'; });
          const rend = Number(m.$('#ficha-rend').value);
          const unit = rend > 0 ? total / rend : 0;
          const margem = rend > 0 && base.preco_venda > 0 ? Math.round(((base.preco_venda - unit) / base.preco_venda) * 1000) / 10 : null;
          m.$('#ficha-resumo').innerHTML = `<div><span>Custo da receita</span><strong>${GF.money(total)}</strong></div>
            <div><span>Custo por ${esc(base.unidade)}</span><strong>${rend > 0 ? GF.money(unit) : '—'}</strong></div>
            <div><span>Preço de venda</span><strong>${GF.money(base.preco_venda)}</strong></div>
            <div><span>Margem</span><strong>${margem === null ? '—' : `<span class="badge-status-pill ${corMargem(margem)}">${pct(margem)}</span>`}</strong></div>`;
        }
        (f.itens.length ? f.itens : [{}]).forEach(add);
        ['input', 'change'].forEach(ev => m.el.addEventListener(ev, atualizar));
        box.addEventListener('click', e => {
          const b = e.target.closest('.ficha-rem');
          if (b && box.children.length > 1) { b.closest('.ficha-linha').remove(); atualizar(); }
        });
        m.$('#ficha-add').addEventListener('click', () => add({}));
        m.$('[data-cancel]').addEventListener('click', m.close);
        if (somenteLeitura) { GF.$$('input, select, textarea, #ficha-add, .ficha-rem', m.el).forEach(el => { el.disabled = true; }); return; }
        const del = m.$('[data-del]');
        if (del) {
          del.addEventListener('click', async () => {
            if (!await GF.confirm(`Excluir a ficha técnica de "${base.nome_produto}"? O histórico de produções é mantido, mas não será possível produzir até cadastrar outra.`, { okLabel: 'Excluir', danger: true })) return;
            try { const r = await GF.del(`/api/recipes/${idProduto}`); GF.toast(r.message, 'success'); m.close(); carregarFichas(); } catch (e) { /* toast */ }
          });
        }
        m.$('[data-ok]').addEventListener('click', async () => {
          GF.limparErros(m.el);
          const rend = m.$('#ficha-rend');
          if (!(Number(rend.value) > 0)) { GF.marcarErro(rend); GF.toast('Informe quanto 1 receita rende.', 'error'); return; }
          const itens = [];
          for (const div of GF.$$('.ficha-linha', box)) {
            const q = $('.ficha-qtd', div);
            if (!(Number(q.value) > 0)) { GF.marcarErro(q); GF.toast('Informe a quantidade de cada insumo (maior que zero).', 'error'); return; }
            itens.push({ id_insumo: Number($('.ficha-ins', div).value), quantidade: Number(q.value) });
          }
          const btn = m.$('[data-ok]'); btn.disabled = true;
          try {
            const r = await GF.put(`/api/recipes/${idProduto}`, {
              rendimento: Number(rend.value), nome_rendimento: m.$('#ficha-nome-rend').value.trim(), validade_dias: m.$('#ficha-validade').value,
              observacao: m.$('#ficha-obs').value.trim(), itens
            });
            GF.toast(r.message, 'success');
            m.close();
            carregarFichas();
          } catch (e) { /* toast exibido; nada foi gravado */ } finally { btn.disabled = false; }
        });
      }
    });
  }

  // ---------------------------------------------------------------- produção
  async function carregarProducoes(offset = 0) {
    const q = [$('#prod-de').value && `from=${$('#prod-de').value}`, $('#prod-ate').value && `to=${$('#prod-ate').value}`, `limit=${GF.POR_PAGINA}`, `offset=${offset}`].filter(Boolean).join('&');
    try {
      const r = await GF.get(`/api/production?${q}`);
      producoes = r.producoes;
      $('#producao-resumo').textContent = `${r.total.toLocaleString('pt-BR')} produção(ões) • custo dos insumos ${GF.money(r.custoTotal)}`;
      GF.pager($('#producao-pager'), { total: r.total, offset, ir: carregarProducoes });
    } catch (e) { $('#producao-corpo').innerHTML = '<tr><td colspan="9" class="empty-cell">Falha ao carregar as produções.</td></tr>'; $('#producao-pager').innerHTML = ''; return; }
    const estornar = GF.can('producao:estornar');
    $('#producao-corpo').innerHTML = producoes.length ? producoes.map(p => `<tr data-id="${p.id_producao}" class="${p.status === 'Estornada' ? 'row-inactive' : ''}">
      <td>${GF.date(p.data_producao)}</td><td><strong>${esc(p.nome_produto)}</strong></td><td>${GF.qty(p.receitas)}</td>
      <td class="text-ok-strong">+${GF.qty(p.quantidade)} ${esc(p.unidade)}</td><td>${GF.num2(p.custo_total)}</td><td>${GF.num2(p.custo_unitario)}</td>
      <td>${esc(p.usuario_nome)}</td>
      <td><span class="badge-status-pill ${p.status === 'Estornada' ? 'badge-cancelado' : 'badge-success'}">${p.status}</span></td>
      <td class="nowrap"><button class="btn-icon btn-action-next" data-act="ver" title="Ver insumos consumidos" aria-label="Ver produção ${p.id_producao}">${GF.icon('info')}</button>
        ${estornar && p.status === 'Concluída' ? `<button class="btn-icon btn-action-cancel" data-act="estornar" title="Estornar produção" aria-label="Estornar produção ${p.id_producao}">${GF.icon('undo')}</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="9" class="empty-cell">Nenhuma produção registrada no período.</td></tr>';
  }

  async function abrirProducao(idPreset) {
    let lista;
    try { lista = (await GF.get('/api/recipes')).fichas.filter(f => f.id_ficha); } catch (e) { return; }
    if (!lista.length) { GF.toast('Nenhum produto tem ficha técnica. Cadastre a receita em Ficha Técnica antes de produzir.', 'error'); return; }
    GF.openModal({
      title: 'Registrar produção',
      wide: true,
      html: `<div class="ficha-topo">
          <div class="form-group flex-2"><label for="pr-produto">Produto *</label><select id="pr-produto">${lista.map(f => `<option value="${f.id_produto}"${f.id_produto === idPreset ? ' selected' : ''}>${esc(f.nome_produto)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="pr-receitas" id="pr-receitas-label">Quantas receitas? *</label><input type="number" id="pr-receitas" min="0.001" step="0.5" value="1"></div>
          <div class="form-group"><label>Vai render</label><p class="pr-rende" id="pr-rende">—</p></div>
        </div>
        <h4 class="pr-sub">Insumos que serão baixados do estoque</h4>
        <div class="table-responsive small-table"><table class="figma-styled-table"><thead><tr><th>Insumo</th><th>Vai usar</th><th>Em estoque</th><th>Custo</th><th></th></tr></thead><tbody id="pr-consumo"></tbody></table></div>
        <div class="form-group mov-obs"><label for="pr-obs">Observação</label><input type="text" id="pr-obs" maxlength="1000" placeholder="Ex.: fornada das 6h"></div>
        <p class="muted" id="pr-custo"></p>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Cancelar</button><button type="button" class="btn btn-primary" data-ok disabled>Confirmar produção</button></div>`,
      onMount: m => {
        let seq = 0, pode = false;
        async function previa() {
          const id = Number(m.$('#pr-produto').value), rec = Number(m.$('#pr-receitas').value);
          const f = lista.find(x => x.id_produto === id);
          m.$('#pr-receitas-label').textContent = `Quantas ${f.nome_rendimento}s? *`;
          pode = false; m.$('[data-ok]').disabled = true;
          if (!(rec > 0)) { m.$('#pr-rende').textContent = '—'; m.$('#pr-consumo').innerHTML = ''; return; }
          const minha = ++seq;
          let pv;
          try { pv = (await GF.get(`/api/production/preview?id_produto=${id}&receitas=${rec}`, true)).preview; } catch (e) {
            if (minha === seq) { m.$('#pr-rende').textContent = '—'; m.$('#pr-consumo').innerHTML = `<tr><td colspan="5" class="empty-cell">${esc(e.message)}</td></tr>`; m.$('#pr-custo').textContent = ''; }
            return;
          }
          if (minha !== seq) return; // resposta de uma digitação anterior
          m.$('#pr-rende').textContent = `${GF.qty(pv.quantidade)} ${pv.unidade}`;
          m.$('#pr-consumo').innerHTML = pv.consumo.map(i => `<tr class="${i.falta ? 'row-critical' : ''}"><td>${esc(i.nome_produto)}</td><td><strong>${GF.qty(i.quantidade)} ${esc(i.unidade)}</strong></td>
            <td>${GF.qty(i.saldo)} ${esc(i.unidade)}</td><td>${GF.num2(i.custo)}</td>
            <td>${i.falta ? `<span class="badge-status-pill badge-urgent">Faltam ${GF.qty(i.falta)}</span>` : '<span class="badge-status-pill badge-success">OK</span>'}</td></tr>`).join('');
          m.$('#pr-custo').textContent = `Custo dos insumos: ${GF.money(pv.custo_total)} • ${GF.money(pv.custo_unitario)} por ${pv.unidade}${pv.podeProduzir ? '' : ' • falta insumo: registre a entrada antes de produzir'}`;
          pode = pv.podeProduzir; m.$('[data-ok]').disabled = !pode;
        }
        let t;
        m.$('#pr-produto').addEventListener('change', previa);
        m.$('#pr-receitas').addEventListener('input', () => { clearTimeout(t); t = setTimeout(previa, 250); });
        previa();
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          if (!pode) return;
          const btn = m.$('[data-ok]'); btn.disabled = true;
          try {
            const r = await GF.post('/api/production', { id_produto: Number(m.$('#pr-produto').value), receitas: Number(m.$('#pr-receitas').value), observacao: m.$('#pr-obs').value.trim() });
            GF.toast(r.message, 'success');
            m.close();
            if (GF.state.currentView === 'producao') carregarProducoes(); else GF.navigate('producao');
          } catch (e) { btn.disabled = false; previa(); }
        });
      }
    });
  }

  async function verProducao(id) {
    let p;
    try { p = (await GF.get(`/api/production/${id}`)).producao; } catch (e) { return; }
    GF.openModal({
      title: `Produção #${p.id_producao} • ${p.nome_produto}`,
      html: `<p class="muted">${GF.date(p.data_producao)} • ${esc(p.usuario_nome)} • ${GF.qty(p.receitas)} receita(s) = <strong>${GF.qty(p.quantidade)} ${esc(p.unidade)}</strong>${p.observacao ? ` • ${esc(p.observacao)}` : ''}</p>
        ${p.status === 'Estornada' ? `<p class="login-erro">Estornada em ${GF.date(p.data_estorno)} por ${esc(p.estornada_por)}: ${esc(p.motivo_estorno)}</p>` : ''}
        <table class="figma-styled-table"><thead><tr><th>Insumo</th><th>Consumido</th><th>Custo</th></tr></thead>
        <tbody>${p.consumo.map(i => `<tr><td>${esc(i.nome_produto)}</td><td>${GF.qty(i.quantidade)} ${esc(i.unidade)}</td><td>${GF.num2(i.custo)}</td></tr>`).join('')}
        <tr><td><strong>Total</strong></td><td></td><td><strong>${GF.num2(p.custo_total)}</strong></td></tr></tbody></table>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Fechar</button></div>`,
      onMount: m => m.$('[data-cancel]').addEventListener('click', m.close)
    });
  }

  function estornarProducao(p) {
    GF.openModal({
      title: `Estornar produção #${p.id_producao}`,
      html: `<p class="confirm-msg">Os insumos voltam para o estoque e ${GF.qty(p.quantidade)} ${esc(p.unidade)} de "${esc(p.nome_produto)}" saem dele. Use só para lançamento errado.</p>
        <div class="form-group"><label for="est-motivo">Motivo *</label><input type="text" id="est-motivo" maxlength="500" placeholder="Ex.: fornada lançada em dobro"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Cancelar</button><button type="button" class="btn btn-danger" data-ok>Estornar</button></div>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          const motivo = m.$('#est-motivo');
          if (motivo.value.trim().length < 5) { GF.marcarErro(motivo); GF.toast('Informe o motivo do estorno (mínimo 5 caracteres).', 'error'); return; }
          try { const r = await GF.post(`/api/production/${p.id_producao}/cancel`, { motivo: motivo.value.trim() }); GF.toast(r.message, 'success'); m.close(); carregarProducoes(); } catch (e) { /* toast */ }
        });
      }
    });
  }

  GF.views.fichas = { load: carregarFichas };
  GF.views.producao = {
    load: async () => {
      await GF.syncToday();
      if (!$('#prod-de').value && !$('#prod-de').dataset.limpo) { $('#prod-de').value = GF.today(); $('#prod-ate').value = GF.today(); }
      carregarProducoes();
    }
  };
  GF.abrirProducao = abrirProducao;

  GF.initProducao = () => {
    $('#fichas-corpo').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = Number(b.closest('tr').dataset.id);
      if (b.dataset.act === 'editar') abrirFicha(id, false);
      else if (b.dataset.act === 'ver') abrirFicha(id, true);
      else if (b.dataset.act === 'produzir') abrirProducao(id);
    });
    $('#btn-registrar-producao').addEventListener('click', () => abrirProducao());
    $('#producao-corpo').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const p = producoes.find(x => x.id_producao === Number(b.closest('tr').dataset.id));
      if (b.dataset.act === 'ver') verProducao(p.id_producao); else estornarProducao(p);
    });
    ['#prod-de', '#prod-ate'].forEach(s => $(s).addEventListener('change', () => carregarProducoes()));
    $('#prod-limpar').addEventListener('click', () => { $('#prod-de').value = ''; $('#prod-ate').value = ''; $('#prod-de').dataset.limpo = '1'; carregarProducoes(); });
  };
})();
