// test/carga.js - Teste de carga do banco: gera um volume realista e mede o tempo das telas pesadas.
// Uso: node test/carga.js [--sem-gerar] [--saida arquivo.json]
// Roda num banco separado (gestfast_carga_test), recriado a partir de schema.sql + seed.sql.
// Volume gerado: 500 produtos, 50 mil vendas (~150 mil itens), 200 mil movimentações, 5 mil requisições.
'use strict';
process.env.DB_NAME = process.env.DB_CARGA_NAME || 'gestfast_carga_test';
process.env.GESTFAST_QUIET = '1';
const fs = require('fs');
const { recriarBancoDeTeste } = require('./setup-db');
const db = require('../db');

const args = process.argv.slice(2);
const gerar = !args.includes('--sem-gerar');
const saida = args.includes('--saida') ? args[args.indexOf('--saida') + 1] : null;
const REPETICOES = 7;

async function gerarDados() {
  await recriarBancoDeTeste(process.env.DB_NAME);
  const q = sql => db.query(sql);
  await q('SET SESSION cte_max_recursion_depth = 1000000');
  // Números 1..N reaproveitados por todas as cargas.
  await q('CREATE TEMPORARY TABLE nums (n INT PRIMARY KEY)');
  await q('INSERT INTO nums WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 200000) SELECT n FROM s');

  await q(`INSERT INTO produto (codigo_barras, nome_produto, descricao, unidade, preco_custo, preco_venda, preco_min, preco_max,
             quantidade_estoque, estoque_minimo, lote, validade, status, id_categoria)
           SELECT CONCAT('CARGA', n), CONCAT('Produto de carga ', n), 'Produto gerado para o teste de carga do banco',
             IF(n % 5 = 0, 'KG', 'UN'), 2 + n % 20, 5 + n % 30, 4 + n % 30, 6 + n % 30,
             10 + n % 300, 20, CONCAT('L-', n), CURDATE() + INTERVAL (n % 90) - 10 DAY,
             IF(n % 25 = 0, 'Inativo', 'Ativo'), 1 + n % 5
           FROM nums WHERE n <= 500`);
  await q(`INSERT INTO venda (codigo_venda, data_venda, valor_subtotal, desconto, valor_total, forma_pagamento, status_venda, id_usuario)
           SELECT CONCAT('CARGA-', n), NOW() - INTERVAL (n * 631) SECOND, 30, IF(n % 7 = 0, 3, 0), IF(n % 7 = 0, 27, 30),
             ELT(1 + n % 4, 'Dinheiro', 'Cartão Débito', 'Cartão Crédito', 'PIX'), IF(n % 40 = 0, 'Cancelada', 'Concluída'), 1 + n % 3
           FROM nums WHERE n <= 50000`);
  await q(`INSERT INTO item_venda (id_venda, id_produto, quantidade, valor_unitario, subtotal)
           SELECT v.id_venda, 1 + (v.id_venda * 7 + k.n * 13) % 500, 1, 10, 10
           FROM venda v JOIN nums k ON k.n <= 3 WHERE v.codigo_venda LIKE 'CARGA-%'`);
  await q(`INSERT INTO movimentacao_estoque (tipo_movimentacao, quantidade, data_movimentacao, observacao, origem, motivo_perda, valor_unitario, id_produto, id_usuario)
           SELECT IF(n % 3 = 0, 'Entrada', 'Saída'), 1 + n % 5, NOW() - INTERVAL (n * 157) SECOND, 'Movimento de carga',
             ELT(1 + n % 6, 'manual', 'venda', 'requisicao', 'venda', 'perda', 'venda'),
             IF(n % 6 = 4, ELT(1 + n % 4, 'Vencido', 'Quebra/Avaria', 'Sobra do dia', 'Outro'), NULL),
             3, 1 + n % 500, 1 + n % 3
           FROM nums`);
  await q(`INSERT INTO requisicao (codigo_pedido, id_fornecedor, id_produto, produto_nome, quantidade_pedida, quantidade_atendida, unidade,
             valor_unitario, valor_total, situacao, data_pedido, previsao_entrega, endereco_entrega)
           SELECT CONCAT('REQ-', 20000 + n), 1 + n % 8, 1 + n % 500, CONCAT('Produto de carga ', 1 + n % 500), 10, IF(n % 5 = 3, 10, 0), 'UN',
             2, 20, ELT(1 + n % 5, 'Em Aberto', 'Cotado', 'AF Gerada', 'Finalizado', 'Cancelado'),
             CURDATE() - INTERVAL (n % 365) DAY, CURDATE(), 'Padrão'
           FROM nums WHERE n <= 5000`);
  await q(`INSERT INTO requisicao_historico (id_requisicao, data_registro, situacao, id_usuario)
           SELECT r.id_requisicao, NOW() - INTERVAL k.n HOUR, 'Em Aberto', 1 FROM requisicao r JOIN nums k ON k.n <= 3`);
  await q('ANALYZE TABLE produto, venda, item_venda, movimentacao_estoque, requisicao, requisicao_historico');
}

async function medir(nome, fn) {
  await fn(); // aquece o cache
  const tempos = [];
  for (let i = 0; i < REPETICOES; i++) {
    const t = process.hrtime.bigint();
    await fn();
    tempos.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  tempos.sort((a, b) => a - b);
  return { nome, mediana_ms: Math.round(tempos[Math.floor(REPETICOES / 2)] * 10) / 10 };
}

(async () => {
  try {
    if (gerar) {
      const t = Date.now();
      await gerarDados();
      console.log(`Dados gerados em ${((Date.now() - t) / 1000).toFixed(1)} s`);
    }
    const admin = db.publicUser(await db.getUserById(1));
    const hoje = db.util.dataISO();
    const mes = db.util.dataISO(new Date(Date.now() - 30 * 86400000));
    const casos = [
      ['Painel (dashboard)', () => db.getDashboardData(admin)],
      ['Relatório de vendas (tudo)', () => db.getRelatorioVendas({})],
      ['Relatório de vendas (30 dias)', () => db.getRelatorioVendas({ from: mes, to: hoje })],
      ['Relatório de estoque', () => db.getRelatorioEstoque({})],
      ['Relatório de desperdício', () => db.getRelatorioPerdas({})],
      ['Alerta de validade', () => db.getValidades()],
      ['Histórico de vendas (lista)', () => db.getVendas({})],
      ['Requisições (lista)', () => db.listRequisicoes()],
      ['Movimentações (lista)', () => db.getMovimentacoes({})],
      ['Busca global "carga 12"', () => db.buscaGlobal('carga 12', () => true)],
      // Telas da v2: primeira página (50 linhas) + total para a paginação.
      ['Histórico de vendas (pág. 50)', () => Promise.all([db.getVendas({ limite: 50 }), db.contarVendas()])],
      ['Movimentações (pág. 50)', () => Promise.all([db.getMovimentacoes({ tipo: 'Saída', limite: 50 }), db.contarMovimentacoes({ tipo: 'Saída' })])],
      ['Requisições (pág. 50)', () => Promise.all([db.listRequisicoes({ limite: 50 }), db.contarRequisicoes()])],
      ['Entrada manual (transação)',() => db.registrarMovimentacoes({ tipo_movimentacao: 'Entrada', id_produto: 10, quantidade: 1, observacao: 'Entrada do teste de carga' }, admin)]
    ];
    const resultados = [];
    for (const [nome, fn] of casos) {
      const r = await medir(nome, fn);
      resultados.push(r);
      console.log(`${r.nome.padEnd(34)} ${String(r.mediana_ms).padStart(9)} ms`);
    }
    if (saida) fs.writeFileSync(saida, JSON.stringify(resultados, null, 2));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
