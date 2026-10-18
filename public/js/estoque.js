// estoque.js - Verificar Estoque / Conferência física de inventário (RF 06)
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let produtos = [];

  function filtrados() {
    const t = $('#estoque-filtro-termo').value.trim().toLowerCase();
    const cat = $('#estoque-filtro-categoria').value;
    const crit = $('#estoque-apenas-criticos').checked;
    const val = $('#estoque-apenas-validade').checked;
    return produtos.filter(p => (!cat || String(p.id_categoria) === cat) && (!crit || p.quantidade_estoque <= p.estoque_minimo) &&
      (!val || (GF.validade(p.validade) || {}).alerta) &&
      (!t || `${p.nome_produto} ${p.codigo_barras} ${p.lote} ${p.descricao}`.toLowerCase().includes(t)));
  }

  function render() {
    const lista = filtrados();
    $('#estoque-resumo').textContent = `${lista.length} de ${produtos.length} produto(s)`;
    $('#estoque-tabela-corpo').innerHTML = lista.length ? lista.map(p => {
      const alerta = p.quantidade_estoque <= p.estoque_minimo;
      const v = GF.validade(p.validade);
      return `<tr data-id="${p.id_produto}" title="Mínimo ${GF.qty(p.estoque_minimo)} ${esc(p.unidade)}${v ? ` • ${v.texto}` : ''}">
        <td><strong>${esc(p.nome_produto)}</strong></td>
        <td>${esc(p.unidade)}</td>
        <td><strong style="color:${alerta ? 'var(--danger)' : 'var(--text)'};">${GF.qty(p.quantidade_estoque)}</strong></td>
        <td>${esc(p.lote || '-')}</td>
        <td>${!v ? '-' : v.alerta ? `<span class="badge-status-pill ${v.vencido ? 'badge-urgent' : 'badge-warning'}" title="${v.texto}">${GF.date(p.validade)}</span>` : GF.date(p.validade)}</td>
        <td><input type="number" class="figma-input input-contagem" min="0" step="${GF.qtyAttrs(p.unidade).step}" value="${p.quantidade_estoque}" data-sistema="${p.quantidade_estoque}" aria-label="Contagem física de ${esc(p.nome_produto)}"></td>
        <td><span class="col-div">0</span></td></tr>`;
    }).join('') : '<tr><td colspan="7" style="text-align:center; padding:16px;">Nenhum produto encontrado.</td></tr>';
  }

  async function carregar() {
    try {
      await GF.syncToday();
      const r = await GF.get('/api/inventory');
      produtos = r.itensParaConferencia;
      render();
    } catch (e) { $('#estoque-tabela-corpo').innerHTML = '<tr><td colspan="7" style="text-align:center; padding:16px;">Não foi possível carregar o estoque.</td></tr>'; }
  }

  function salvar() {
    const linhas = GF.$$('#estoque-tabela-corpo tr[data-id]');
    if (!linhas.length) { GF.toast('Nenhum item para conferir.', 'error'); return; }
    const itens = [];
    for (const tr of linhas) {
      const inp = $('.input-contagem', tr);
      const v = inp.value.trim();
      if (v === '' || Number(v) < 0 || !Number.isFinite(Number(v))) { GF.marcarErro(inp); GF.toast('Informe uma contagem física válida (zero ou mais).', 'error'); return; }
      itens.push({ id_produto: Number(tr.dataset.id), quantidade_fisica: Number(v) });
    }
    const alterados = linhas.filter(tr => Number($('.input-contagem', tr).value) !== Number($('.input-contagem', tr).dataset.sistema)).length;
    GF.openModal({
      title: 'Salvar conferência de estoque',
      html: `<p class="confirm-msg">${itens.length} produto(s) conferido(s), <strong>${alterados} com divergência</strong>.</p>
        <div class="form-group"><label for="conf-obs">Observação * (10 a 1000 caracteres)</label><textarea id="conf-obs" rows="3" maxlength="1000" placeholder="Ex: Conferência quinzenal do balcão e do depósito."></textarea>
        <div class="counter-wrapper"><span id="conf-counter" class="char-counter counter-neutral"></span></div></div>
        <label class="checkbox-label"><input type="checkbox" id="conf-ajustar" checked> Ajustar o estoque do sistema para a contagem física</label>
        <div class="modal-actions"><button class="btn btn-secondary" data-cancel>Cancelar</button><button class="btn btn-primary" data-ok>Salvar conferência</button></div>`,
      onMount: m => {
        GF.bindCounter(m.$('#conf-obs'), m.$('#conf-counter'), 10, 1000);
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('[data-ok]').addEventListener('click', async () => {
          const obs = m.$('#conf-obs').value.trim();
          if (obs.length < 10) { GF.marcarErro(m.$('#conf-obs')); GF.toast('A observação deve ter pelo menos 10 caracteres.', 'error'); return; }
          try {
            await GF.post('/api/inventory', { itens, observacao: obs, ajustar: m.$('#conf-ajustar').checked });
            GF.toast('Conferência de estoque salva com sucesso!', 'success');
            m.close(); carregar();
          } catch (e) { /* toast exibido */ }
        });
      }
    });
  }

  async function historico() {
    try {
      const r = await GF.get('/api/inventory');
      const html = r.conferencias.length ? r.conferencias.map(c => `
        <details class="conf-item"><summary><strong>#${c.id_conferencia}</strong> • ${GF.date(c.data_conferencia)} • ${esc(c.responsavel)} • ${c.itens.filter(i => i.divergencia !== 0).length} divergência(s)</summary>
          <p class="muted">${esc(c.observacao)} ${c.ajustou_estoque === false ? '(sem ajuste de estoque)' : ''}</p>
          <table class="figma-styled-table"><thead><tr><th>Produto</th><th>Sistema</th><th>Físico</th><th>Divergência</th></tr></thead><tbody>
          ${c.itens.map(i => `<tr><td>${esc(i.nome_produto)}</td><td>${GF.qty(i.quantidade_sistema)} ${esc(i.unidade)}</td><td>${GF.qty(i.quantidade_fisica)}</td><td class="${i.divergencia < 0 ? 'text-danger-strong' : i.divergencia > 0 ? 'text-ok-strong' : ''}">${i.divergencia > 0 ? '+' : ''}${GF.qty(i.divergencia)}</td></tr>`).join('')}
          </tbody></table></details>`).join('') : '<div class="empty-state">Nenhuma conferência registrada.</div>';
      GF.openModal({ title: 'Histórico de conferências', html, wide: true });
    } catch (e) { /* toast */ }
  }

  GF.views.estoque = {
    filtrar: null,
    load: async () => {
      if (!GF.state.categories.length) await GF.loadCategories();
      GF.fillCategorySelect($('#estoque-filtro-categoria'), 'Todas as Categorias');
      if (GF.views.estoque.filtrar) { $('#estoque-filtro-termo').value = GF.views.estoque.filtrar; GF.views.estoque.filtrar = null; }
      await carregar();
    }
  };

  GF.initEstoque = () => {
    ['input', 'change'].forEach(ev => { $('#estoque-filtro-termo').addEventListener(ev, render); });
    $('#estoque-filtro-categoria').addEventListener('change', render);
    $('#estoque-apenas-criticos').addEventListener('change', render);
    $('#estoque-apenas-validade').addEventListener('change', render);
    $('#estoque-tabela-corpo').addEventListener('input', e => {
      const inp = e.target.closest('.input-contagem'); if (!inp) return;
      inp.classList.remove('input-error');
      const div = Number(inp.value) - Number(inp.dataset.sistema);
      const cel = inp.closest('tr').querySelector('.col-div');
      const d = Math.round(div * 1000) / 1000;
      cel.textContent = (d > 0 ? '+' : '') + GF.qty(d);
      cel.className = `col-div${d < 0 ? ' div-neg' : d > 0 ? ' div-pos' : ''}`;
    });
    $('#btn-salvar-conferencia').addEventListener('click', salvar);
    $('#btn-historico-conferencias').addEventListener('click', historico);
  };
})();
