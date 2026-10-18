// main.js - Inicialização do GestFast
(function () {
  'use strict';
  const GF = window.GF;
  document.addEventListener('DOMContentLoaded', async () => {
    GF.initShell();
    GF.initAuth();
    GF.initDashboard(); GF.initEstoque(); GF.initRequisicoes(); GF.initProdutos(); GF.initMovimentos(); GF.initVendas(); GF.initProducao(); GF.initRelatorios(); GF.initAdmin();

    // Link de redefinição de senha (#reset=token)
    if (location.hash.startsWith('#reset=')) {
      GF.showLogin();
      GF.$('#form-login').classList.add('is-hidden');
      GF.$('#form-reset').classList.remove('is-hidden');
      return;
    }
    try {
      const me = await GF.get('/api/auth/me', true);
      GF.enterApp(me);
      await GF.loadCategories();
      const id = location.hash.slice(1);
      GF.navigate(id || 'dashboard', { replace: true });
    } catch (e) {
      GF.showLogin();
    }
  });
})();
