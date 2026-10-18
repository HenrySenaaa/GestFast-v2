// lib/permissions.js - Perfis de acesso (RF 02 / RF 03)
const A = 'Administrador', B = 'BackOffice', F = 'Funcionario';
const TODOS = [A, B, F];

const PERMISSOES = {
  'dashboard:ver': TODOS,
  'produtos:ver': TODOS,
  'produtos:editar': [A, B],
  'estoque:conferir': TODOS,
  'movimentos:ver': TODOS,
  'movimentos:registrar': TODOS,
  'requisicoes:ver': TODOS,
  'requisicoes:criar': TODOS,
  'requisicoes:cancelar': TODOS,
  'requisicoes:receber': TODOS,
  'requisicoes:avancar': [A, B],
  'vendas:vender': [A, F],
  'vendas:ver': TODOS,
  'vendas:editar': [A, F],
  'vendas:cancelar': [A, F],
  'vendas:excluir': [A],
  'producao:ver': TODOS,
  'producao:registrar': TODOS,   // o padeiro (Funcionário) registra a fornada
  'producao:estornar': [A, B],
  'fichas:editar': [A, B],
  'relatorios:ver': [A, B],
  'usuarios:gerir': [A],
  'config:gerir': [A],
  'logs:ver': [A]
};

const can = (perfil, perm) => (PERMISSOES[perm] || []).includes(perfil);
const listFor = perfil => Object.keys(PERMISSOES).filter(p => can(perfil, p));

module.exports = { PERMISSOES, can, listFor, PERFIS: { A, B, F } };
