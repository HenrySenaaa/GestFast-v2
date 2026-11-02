// lib/balanca.js - Etiqueta de balança: EAN-13 que começa com "2".
// Formato: 2 + código do produto + valor (peso em gramas ou preço em centavos) + dígito verificador.
// Quantos dígitos são do código depende da balança (configurável); o valor fica com o restante.
'use strict';

function digitoVerificador(doze) {
  const soma = [...doze].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10;
}

// null: não é etiqueta de balança. dvOk false: a leitura veio com erro.
function lerEtiqueta(codigo, digitosCodigo = 5) {
  const s = String(codigo || '').trim();
  if (!/^2\d{12}$/.test(s)) return null;
  return {
    dvOk: digitoVerificador(s.slice(0, 12)) === Number(s[12]),
    codigo: Number(s.slice(1, 1 + digitosCodigo)),
    valor: Number(s.slice(1 + digitosCodigo, 12))
  };
}

module.exports = { lerEtiqueta, digitoVerificador };
