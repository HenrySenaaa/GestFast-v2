// produtos.js - Cadastro de produtos (RF 01): incluir, alterar, inativar/reativar, imagem
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let lista = [], imagemData = null, editando = null;
  const campos = ['nome', 'codigo', 'preco-custo', 'preco-min', 'estoque-minimo', 'peso', 'unidade', 'preco-venda', 'preco-max', 'categoria', 'estoque-atual', 'lote', 'validade', 'descricao'];
  const f = id => $(`#prod-${id}`);

  function ajustarUnidade() {
    const frac = GF.fractional(f('unidade').value);
    ['estoque-minimo', 'estoque-atual'].forEach(i => { f(i).step = frac ? '0.001' : '1'; });
  }

  function limpar() {
    editando = null; imagemData = null;
    $('#prod-id').value = '';
    campos.forEach(c => { if (f(c).tagName !== 'SELECT') f(c).value = ''; });
    f('unidade').value = 'UN';
    if (GF.state.categories.length) f('categoria').value = String(GF.state.categories[0].id_categoria);
    $('#prod-preview-img').src = GF.imgFor({ id_categoria: Number(f('categoria').value) });
    $('#prod-imagem-file').value = '';
    $('#btn-salvar-produto').innerHTML = `${GF.icon('check', 'icon icon-sm')} Confirmar`;
    GF.limparErros($('#form-cadastro-produto'));
    $('#prod-descricao').dispatchEvent(new Event('input'));
    ajustarUnidade();
    GF.$$('#catalogo-produtos-corpo tr').forEach(tr => tr.classList.remove('row-selected'));
  }

  function preencher(p) {
    editando = p.id_produto; imagemData = null;
    $('#prod-id').value = p.id_produto;
    f('nome').value = p.nome_produto; f('codigo').value = p.codigo_barras; f('preco-custo').value = p.preco_custo;
    f('preco-min').value = p.preco_min; f('preco-max').value = p.preco_max; f('preco-venda').value = p.preco_venda;
    f('estoque-minimo').value = p.estoque_minimo; f('estoque-atual').value = p.quantidade_estoque;
    f('peso').value = p.peso || ''; f('unidade').value = p.unidade; f('categoria').value = String(p.id_categoria);
    f('lote').value = p.lote || ''; f('validade').value = p.validade || ''; f('descricao').value = p.descricao || '';
    $('#prod-preview-img').src = GF.imgFor(p);
    $('#btn-salvar-produto').innerHTML = `${GF.icon('check', 'icon icon-sm')} Confirmar alterações`;
    $('#prod-descricao').dispatchEvent(new Event('input'));
    ajustarUnidade();
    GF.limparErros($('#form-cadastro-produto'));
    render();
    $('#view-cadastro').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validar() {
    GF.limparErros($('#form-cadastro-produto'));
    const erros = [];
    const req = (el, msg) => { erros.push([el, msg]); };
    if (f('nome').value.trim().length < 2) req(f('nome'), 'Informe o nome do produto.');
    const venda = Number(f('preco-venda').value);
    if (!(venda > 0)) req(f('preco-venda'), 'O preço de venda deve ser maior que zero.');
    const min = f('preco-min').value === '' ? venda * 0.8 : Number(f('preco-min').value);
    const max = f('preco-max').value === '' ? venda * 1.3 : Number(f('preco-max').value);
    if (venda > 0 && (min > venda || venda > max)) req(f('preco-venda'), 'O preço de venda deve estar entre o preço mínimo e o máximo.');
    if (f('estoque-minimo').value === '' || Number(f('estoque-minimo').value) < 0) req(f('estoque-minimo'), 'Informe o estoque mínimo (zero ou mais).');
    if (!GF.fractional(f('unidade').value)) {
      if (f('estoque-minimo').value !== '' && !Number.isInteger(Number(f('estoque-minimo').value))) req(f('estoque-minimo'), `Produtos em ${f('unidade').value} só aceitam estoque mínimo inteiro.`);
      if (f('estoque-atual').value !== '' && !Number.isInteger(Number(f('estoque-atual').value))) req(f('estoque-atual'), `Produtos em ${f('unidade').value} só aceitam estoque inteiro.`);
    }
    const d = f('descricao').value.trim().length;
    if (d < 10 || d > 5000) req(f('descricao'), 'A descrição deve ter entre 10 e 5000 caracteres.');
    if (erros.length) { erros.forEach(([el]) => el.classList.add('input-error')); erros[0][0].focus(); GF.toast(erros[0][1], 'error'); return false; }
    return true;
  }

  async function salvar(manterEdicao) {
    if (!validar()) return;
    const body = {
      nome_produto: f('nome').value.trim(), codigo_barras: f('codigo').value.trim(), descricao: f('descricao').value.trim(),
      unidade: f('unidade').value, peso: f('peso').value.trim(), preco_custo: f('preco-custo').value, preco_venda: f('preco-venda').value,
      preco_min: f('preco-min').value, preco_max: f('preco-max').value, estoque_minimo: f('estoque-minimo').value,
      quantidade_estoque: f('estoque-atual').value, id_categoria: Number(f('categoria').value), lote: f('lote').value.trim(), validade: f('validade').value
    };
    if (imagemData) body.imagem_data = imagemData;
    try {
      const r = editando ? await GF.put(`/api/products/${editando}`, body) : await GF.post('/api/products', body);
      GF.toast(r.message, 'success');
      await carregar();
      if (manterEdicao) preencher(r.product); else limpar();
    } catch (e) { /* toast exibido; dados do formulário preservados */ }
  }

  function render() {
    $('#catalogo-produtos-corpo').innerHTML = lista.length ? lista.map(p => `
      <tr data-id="${p.id_produto}" class="row-select ${editando === p.id_produto ? 'row-selected' : ''} ${p.status === 'Inativo' ? 'row-inactive' : ''}">
        <td><code>${esc(p.codigo_barras)}</code></td>
        <td><strong>${esc(p.nome_produto)}</strong><br><small style="color:var(--text-muted);">${esc(p.unidade)} - ${esc(p.peso || '')}${p.status === 'Inativo' ? ' • Inativo' : ''}</small></td>
        <td>R$ ${Number(p.preco_venda).toFixed(2)}</td>
        <td><strong>${GF.qty(p.quantidade_estoque)}</strong></td>
        <td>
          ${p.status === 'Ativo'
            ? `<button class="btn-icon btn-action-next" data-act="editar" title="Alterar produto" aria-label="Alterar ${esc(p.nome_produto)}">${GF.icon('edit')}</button>
               <button class="btn-icon btn-action-trash" data-act="inativar" title="Inativar produto" aria-label="Inativar ${esc(p.nome_produto)}">${GF.icon('trash')}</button>`
            : `<button class="btn btn-sm btn-secondary" data-act="reativar" title="Reativar produto" aria-label="Reativar ${esc(p.nome_produto)}">${GF.icon('undo', 'icon icon-sm')} Reativar</button>`}
        </td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center; padding:16px;">Nenhum produto encontrado.</td></tr>';
  }

  async function carregar() {
    const q = $('#catalogo-busca-input').value.trim(), cat = $('#catalogo-filtro-categoria').value, st = $('#catalogo-filtro-status').value;
    try { lista = (await GF.get(`/api/products?q=${encodeURIComponent(q)}&category=${cat}&status=${st}`)).products; render(); }
    catch (e) { $('#catalogo-produtos-corpo').innerHTML = '<tr><td colspan="5" class="empty-cell">Falha ao carregar o catálogo.</td></tr>'; }
  }

  GF.views.cadastro = {
    pendente: null,
    // usado pela busca global: abre o produto escolhido já em modo de edição
    abrirProduto: id => { GF.views.cadastro.pendente = id; GF.navigate('cadastro'); },
    load: async () => {
      if (!GF.state.categories.length) await GF.loadCategories();
      GF.fillCategorySelect(f('categoria'));
      GF.fillCategorySelect($('#catalogo-filtro-categoria'), 'Todas as categorias');
      if (editando === null) limpar();
      await carregar();
      const id = GF.views.cadastro.pendente;
      if (id) {
        GF.views.cadastro.pendente = null;
        try { preencher((await GF.get(`/api/products/${id}`)).product); } catch (e) { /* toast */ }
      }
    }
  };

  GF.initProdutos = () => {
    GF.bindCounter(f('descricao'), $('#prod-desc-counter'), 10, 5000);
    $('#form-cadastro-produto').addEventListener('submit', e => { e.preventDefault(); salvar(false); });
    $('#btn-save-draft').addEventListener('click', () => salvar(true));
    $('#btn-cancelar-edicao').addEventListener('click', limpar);
    $('#btn-novo-produto-limpar').addEventListener('click', limpar);
    f('unidade').addEventListener('change', ajustarUnidade);
    f('categoria').addEventListener('change', () => { if (!imagemData && !editando) $('#prod-preview-img').src = GF.imgFor({ id_categoria: Number(f('categoria').value) }); });
    $('#btn-upload-img').addEventListener('click', () => $('#prod-imagem-file').click());
    $('#prod-imagem-file').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { GF.toast('Formato inválido. Use PNG, JPG, WEBP ou GIF.', 'error'); e.target.value = ''; return; }
      if (file.size > 2 * 1024 * 1024) { GF.toast('A imagem deve ter no máximo 2 MB.', 'error'); e.target.value = ''; return; }
      const rd = new FileReader();
      rd.onload = () => { imagemData = rd.result; $('#prod-preview-img').src = rd.result; };
      rd.readAsDataURL(file);
    });
    let t; $('#catalogo-busca-input').addEventListener('input', () => { clearTimeout(t); t = setTimeout(carregar, 250); });
    $('#catalogo-filtro-categoria').addEventListener('change', carregar);
    $('#catalogo-filtro-status').addEventListener('change', carregar);
    $('#catalogo-produtos-corpo').addEventListener('click', async e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const p = lista.find(x => x.id_produto === Number(tr.dataset.id));
      const act = (e.target.closest('[data-act]') || {}).dataset;
      if (!act) { if (p.status === 'Ativo') preencher(p); return; }
      if (act.act === 'editar') preencher(p);
      else if (act.act === 'inativar') {
        if (!await GF.confirm(`Inativar "${p.nome_produto}"? Ele deixará de aparecer no catálogo e no caixa, mas o histórico de vendas e movimentações será preservado.`, { okLabel: 'Inativar', danger: true })) return;
        try { const r = await GF.patch(`/api/products/${p.id_produto}/status`, { status: 'Inativo' }); GF.toast(r.message, 'success'); if (editando === p.id_produto) limpar(); carregar(); } catch (er) { /* toast */ }
      } else if (act.act === 'reativar') {
        try { const r = await GF.patch(`/api/products/${p.id_produto}/status`, { status: 'Ativo' }); GF.toast(r.message, 'success'); carregar(); } catch (er) { /* toast */ }
      }
    });
  };
})();
