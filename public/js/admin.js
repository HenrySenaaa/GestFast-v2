// admin.js - Funcionários (RF 02/03), configurações e logs
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$, esc = GF.esc;
  let usuarios = [], perfis = [];

  // ------------------------------------------------------------ funcionários
  async function carregarFunc() {
    const q = [`q=${encodeURIComponent($('#func-busca').value.trim())}`, `id_perfil=${$('#func-perfil').value}`, `status=${$('#func-status').value}`].join('&');
    try {
      usuarios = (await GF.get(`/api/users?${q}`)).users;
      $('#func-resumo').textContent = `${usuarios.length} funcionário(s)`;
      $('#func-tabela-corpo').innerHTML = usuarios.length ? usuarios.map(u => `<tr data-id="${u.id_usuario}" class="${u.status === 'Inativo' ? 'row-inactive' : ''}">
        <td><strong>${esc(u.nome)}</strong>${u.id_usuario === GF.state.user.id_usuario ? ' <small class="muted">(você)</small>' : ''}</td><td>${esc(u.email)}</td><td>${esc(u.cargo || '-')}</td>
        <td>${esc(GF.profileLabel(u.perfil))}</td>
        <td><span class="badge-status-pill ${u.status === 'Ativo' ? 'badge-success' : 'badge-urgent'}">${esc(u.status)}</span></td>
        <td class="col-acoes"><button class="btn-icon btn-action-info" data-act="editar" title="Alterar dados e perfil" aria-label="Alterar ${esc(u.nome)}">${GF.icon('edit')}</button>
        ${u.status === 'Ativo' ? `<button class="btn-icon btn-action-cancel" data-act="desativar" title="Desativar acesso" aria-label="Desativar ${esc(u.nome)}">${GF.icon('power')}</button>` : `<button class="btn-icon btn-action-accept" data-act="ativar" title="Reativar acesso" aria-label="Reativar ${esc(u.nome)}">${GF.icon('undo')}</button>`}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty-cell">Nenhum funcionário encontrado.</td></tr>';
    } catch (e) { $('#func-tabela-corpo').innerHTML = '<tr><td colspan="6" class="empty-cell">Falha ao carregar os funcionários.</td></tr>'; }
  }

  function formFunc(u) {
    const novo = !u;
    GF.openModal({
      title: novo ? 'Cadastrar funcionário' : `Alterar ${u.nome}`,
      html: `<form id="form-func" novalidate>
        <div class="form-group"><label for="fu-nome">Nome completo *</label><input type="text" id="fu-nome" maxlength="150" value="${esc(u ? u.nome : '')}"></div>
        <div class="form-group"><label for="fu-email">Login (e-mail) *</label><input type="email" id="fu-email" maxlength="150" value="${esc(u ? u.email : '')}" autocomplete="off"></div>
        <div class="form-group"><label for="fu-cargo">Cargo</label><input type="text" id="fu-cargo" maxlength="100" value="${esc(u ? u.cargo : '')}"></div>
        <div class="form-group"><label for="fu-perfil">Perfil de acesso *</label><select id="fu-perfil">${perfis.map(p => `<option value="${p.id_perfil}" ${u && u.id_perfil === p.id_perfil ? 'selected' : ''}>${esc(GF.profileLabel(p.nome_perfil))}</option>`).join('')}</select></div>
        <div class="form-group"><label for="fu-senha">${novo ? 'Senha inicial * (mínimo 6 caracteres)' : 'Nova senha (deixe em branco para manter)'}</label><input type="password" id="fu-senha" autocomplete="new-password"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Cancelar</button><button type="submit" class="btn btn-primary">${novo ? 'Cadastrar' : 'Salvar alterações'}</button></div></form>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('#form-func').addEventListener('submit', async e => {
          e.preventDefault();
          GF.limparErros(m.el);
          const nome = m.$('#fu-nome'), email = m.$('#fu-email'), senha = m.$('#fu-senha');
          if (nome.value.trim().length < 2) { GF.marcarErro(nome); GF.toast('Informe o nome do funcionário.', 'error'); return; }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { GF.marcarErro(email); GF.toast('Informe um login (e-mail) válido.', 'error'); return; }
          if ((novo || senha.value) && senha.value.length < 6) { GF.marcarErro(senha); GF.toast('A senha deve ter no mínimo 6 caracteres.', 'error'); return; }
          const body = { nome: nome.value.trim(), email: email.value.trim(), cargo: m.$('#fu-cargo').value.trim(), id_perfil: Number(m.$('#fu-perfil').value) };
          if (senha.value) body.senha = senha.value;
          try {
            const r = novo ? await GF.post('/api/users', body) : await GF.put(`/api/users/${u.id_usuario}`, body);
            GF.toast(r.message, 'success'); m.close(); carregarFunc();
          } catch (err) { if (/login/i.test(err.message)) GF.marcarErro(email); }
        });
      }
    });
  }

  GF.views.funcionarios = {
    load: async () => {
      try { perfis = (await GF.get('/api/profiles')).profiles; } catch (e) { return; }
      const sel = $('#func-perfil'), atual = sel.value;
      sel.innerHTML = '<option value="">Todos os perfis</option>' + perfis.map(p => `<option value="${p.id_perfil}">${esc(GF.profileLabel(p.nome_perfil))}</option>`).join('');
      sel.value = atual;
      await carregarFunc();
    }
  };

  // ------------------------------------------------------------ configurações
  async function carregarLogs() {
    if (!GF.can('logs:ver')) return;
    try {
      const logs = (await GF.get('/api/logs?limit=150')).logs;
      $('#logs-tabela-corpo').innerHTML = logs.length ? logs.map(l => {
        const { ts, nivel, evento, usuario, ...resto } = l;
        const d = new Date(ts);
        return `<tr><td>${isNaN(d) ? '' : d.toLocaleString('pt-BR')}</td><td><span class="badge-status-pill ${nivel === 'ERRO' ? 'badge-urgent' : nivel === 'AVISO' ? 'badge-warning' : 'badge-info'}">${esc(nivel)}</span></td><td>${esc(evento)}</td><td>${esc(usuario || '-')}</td><td class="cell-itens">${esc(Object.keys(resto).length ? JSON.stringify(resto) : '')}</td></tr>`;
      }).join('') : '<tr><td colspan="5" class="empty-cell">Sem registros.</td></tr>';
    } catch (e) { /* toast */ }
  }

  async function carregarConfig() {
    const u = GF.state.user, admin = GF.can('config:gerir');
    $('#cfg-minha-conta').innerHTML = `<strong>${esc(u.nome)}</strong> • ${esc(u.email)} • Perfil: ${esc(GF.profileLabel(u.perfil))}`;
    $('#cfg-logs-card').classList.toggle('is-hidden', !GF.can('logs:ver'));
    try { GF.state.settings = (await GF.get('/api/settings', true)).settings; } catch (e) { /* mantém */ }
    const s = GF.state.settings;
    $('#form-config').classList.toggle('is-hidden', !admin);
    const ro = $('#cfg-readonly'); ro.classList.toggle('is-hidden', admin);
    ro.innerHTML = `<p><strong>Estabelecimento:</strong> ${esc(s.estabelecimento)}</p><p><strong>Desconto máximo no caixa:</strong> ${esc(s.descontoMaximoPercent)}% do subtotal</p><p><strong>Aviso de validade:</strong> ${esc(s.diasAlertaValidade)} dia(s) antes de vencer</p><p class="muted">Somente o Administrador pode alterar os parâmetros.</p>`;
    if (admin) {
      $('#cfg-estabelecimento').value = s.estabelecimento; $('#cfg-desconto').value = s.descontoMaximoPercent; $('#cfg-intervalo').value = s.intervaloAtualizacaoSeg; $('#cfg-validade').value = s.diasAlertaValidade;
      $('#cfg-sim-cartao').checked = !!s.simularCartaoNegado; $('#cfg-sim-fornecedor').checked = !!s.simularFornecedorIndisponivel;
    }
    carregarLogs();
  }
  GF.views.configuracoes = { load: carregarConfig };

  GF.initAdmin = () => {
    $('#btn-novo-funcionario').addEventListener('click', () => formFunc(null));
    let t; const deb = () => { clearTimeout(t); t = setTimeout(carregarFunc, 250); };
    $('#func-busca').addEventListener('input', deb);
    $('#func-perfil').addEventListener('change', carregarFunc);
    $('#func-status').addEventListener('change', carregarFunc);
    $('#func-tabela-corpo').addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const u = usuarios.find(x => x.id_usuario === Number(b.closest('tr').dataset.id));
      if (b.dataset.act === 'editar') formFunc(u);
      else if (b.dataset.act === 'desativar') {
        if (!await GF.confirm(`Desativar o acesso de ${u.nome}? Ele será desconectado e não poderá entrar no sistema, mas o histórico é preservado.`, { okLabel: 'Desativar', danger: true })) return;
        try { const r = await GF.patch(`/api/users/${u.id_usuario}/status`, { status: 'Inativo' }); GF.toast(r.message, 'success'); carregarFunc(); } catch (er) { /* toast */ }
      } else if (b.dataset.act === 'ativar') {
        try { const r = await GF.patch(`/api/users/${u.id_usuario}/status`, { status: 'Ativo' }); GF.toast(r.message, 'success'); carregarFunc(); } catch (er) { /* toast */ }
      }
    });
    $('#form-config').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const r = await GF.put('/api/settings', {
          estabelecimento: $('#cfg-estabelecimento').value, descontoMaximoPercent: Number($('#cfg-desconto').value), intervaloAtualizacaoSeg: Number($('#cfg-intervalo').value), diasAlertaValidade: Number($('#cfg-validade').value),
          simularCartaoNegado: $('#cfg-sim-cartao').checked, simularFornecedorIndisponivel: $('#cfg-sim-fornecedor').checked
        });
        GF.state.settings = r.settings; GF.toast(r.message, 'success'); carregarLogs();
      } catch (er) { /* toast */ }
    });
    $('#btn-alterar-senha').addEventListener('click', GF.openChangePassword);
    $('#btn-atualizar-logs').addEventListener('click', carregarLogs);
  };
})();
