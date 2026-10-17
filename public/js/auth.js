// auth.js - Login, logout, recuperação e alteração de senha
(function () {
  'use strict';
  const GF = window.GF, $ = GF.$;

  const showPanel = id => ['#form-login', '#form-forgot', '#form-reset'].forEach(f => $(f).classList.toggle('is-hidden', f !== id));

  GF.showLogin = (msg) => {
    GF.state.user = null; GF.state.perms = [];
    if (GF.views.dashboard && GF.views.dashboard.stop) GF.views.dashboard.stop();
    $('#app-shell').classList.add('is-hidden');
    $('#login-screen').classList.remove('is-hidden');
    showPanel('#form-login');
    const e = $('#login-erro');
    if (msg) { e.textContent = msg; e.classList.remove('is-hidden'); } else e.classList.add('is-hidden');
    $('#login-senha').value = '';
    setTimeout(() => $('#login-email').focus(), 30);
  };

  GF.enterApp = (data) => {
    GF.state.user = data.user;
    GF.state.perms = data.permissoes;
    if (data.settings) GF.state.settings = data.settings;
    if (data.hoje) GF.state.hoje = data.hoje;
    $('#login-screen').classList.add('is-hidden');
    $('#app-shell').classList.remove('is-hidden');
    $('#header-user-name').textContent = data.user.nome;
    $('#header-user-role').textContent = data.user.cargo || GF.profileLabel(data.user.perfil);
    $('#user-avatar').title = `${data.user.nome} (${GF.profileLabel(data.user.perfil)})`;
    $('#user-avatar').textContent = data.user.nome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
    GF.applyPermissions();
  };

  function initAuth() {
    $('#form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#login-email'), senha = $('#login-senha'), erro = $('#login-erro');
      GF.limparErros($('#form-login'));
      if (!email.value.trim() || !senha.value) {
        erro.textContent = 'Preencha o e-mail e a senha para continuar.'; erro.classList.remove('is-hidden');
        GF.marcarErro(!email.value.trim() ? email : senha); return;
      }
      const btn = $('#btn-login'); btn.disabled = true;
      try {
        await GF.post('/api/auth/login', { email: email.value.trim(), senha: senha.value, lembrar: $('#login-lembrar').checked }, true);
        const me = await GF.get('/api/auth/me', true);
        GF.enterApp(me);
        await GF.loadCategories();
        GF.navigate((location.hash.slice(1) && !location.hash.startsWith('#reset')) ? location.hash.slice(1) : 'dashboard', { replace: true });
      } catch (err) {
        erro.textContent = err.message; erro.classList.remove('is-hidden'); senha.value = ''; senha.focus();
      } finally { btn.disabled = false; }
    });
    $('#btn-esqueci').addEventListener('click', () => { showPanel('#form-forgot'); $('#forgot-email').value = $('#login-email').value; $('#forgot-msg').classList.add('is-hidden'); $('#forgot-email').focus(); });
    GF.$$('[data-voltar-login]').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', location.pathname); showPanel('#form-login'); }));
    $('#form-forgot').addEventListener('submit', async e => {
      e.preventDefault();
      const em = $('#forgot-email'), msg = $('#forgot-msg');
      if (!em.value.trim()) { GF.marcarErro(em); return; }
      try { const r = await GF.post('/api/auth/forgot', { email: em.value.trim() }, true); msg.textContent = r.message; msg.classList.remove('is-hidden'); }
      catch (err) { msg.textContent = err.message; msg.classList.remove('is-hidden'); }
    });
    $('#form-reset').addEventListener('submit', async e => {
      e.preventDefault();
      const s1 = $('#reset-senha'), s2 = $('#reset-senha2'), erro = $('#reset-erro');
      const token = location.hash.startsWith('#reset=') ? location.hash.slice(7) : '';
      if (s1.value !== s2.value) { erro.textContent = 'As senhas não conferem.'; erro.classList.remove('is-hidden'); return; }
      try {
        const r = await GF.post('/api/auth/reset', { token, senha: s1.value }, true);
        history.replaceState(null, '', location.pathname);
        GF.showLogin(r.message);
        $('#login-erro').classList.add('login-ok');
      } catch (err) { erro.textContent = err.message; erro.classList.remove('is-hidden'); }
    });
    $('#btn-logout').addEventListener('click', async () => {
      try { await GF.post('/api/auth/logout', {}, true); } catch (e) { /* já expirada */ }
      history.replaceState(null, '', location.pathname);
      GF.showLogin();
    });
    $('#login-email').addEventListener('input', () => $('#login-erro').classList.remove('login-ok'));
  }

  GF.openChangePassword = () => {
    GF.openModal({
      title: 'Alterar minha senha',
      html: `<form id="form-troca-senha" novalidate>
        <div class="form-group"><label for="ts-atual">Senha atual</label><input type="password" id="ts-atual" autocomplete="current-password"></div>
        <div class="form-group"><label for="ts-nova">Nova senha (mínimo 6 caracteres)</label><input type="password" id="ts-nova" autocomplete="new-password"></div>
        <div class="form-group"><label for="ts-conf">Confirmar nova senha</label><input type="password" id="ts-conf" autocomplete="new-password"></div>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Salvar senha</button></div></form>`,
      onMount: m => {
        m.$('[data-cancel]').addEventListener('click', m.close);
        m.$('#form-troca-senha').addEventListener('submit', async e => {
          e.preventDefault();
          if (m.$('#ts-nova').value !== m.$('#ts-conf').value) { GF.toast('A confirmação não confere com a nova senha.', 'error'); return; }
          try { const r = await GF.post('/api/auth/change-password', { senha_atual: m.$('#ts-atual').value, nova_senha: m.$('#ts-nova').value }); GF.toast(r.message, 'success'); m.close(); } catch (err) { /* toast já exibido */ }
        });
      }
    });
  };

  GF.initAuth = initAuth;
})();
