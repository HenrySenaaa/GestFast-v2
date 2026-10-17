// theme.js - Aplica o tema salvo (claro/escuro) antes de a página aparecer, para não "piscar".
// Sem escolha salva, o CSS segue o tema do sistema operacional.
(function () {
  'use strict';
  try {
    const t = localStorage.getItem('gf_theme');
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  } catch (e) { /* storage indisponível: segue o sistema */ }
})();
