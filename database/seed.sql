-- =====================================================================
-- GestFast ERP - Dados de exemplo (Padaria Nova York)
-- Executar DEPOIS do schema.sql. As datas são relativas ao dia em que o script roda.
-- Usuários iniciais (troque as senhas em Funcionários / Configuração):
--   proprietario@padarianovayork.com / admin123      (Administrador)
--   backoffice@padarianovayork.com   / backoffice123 (BackOffice)
--   henry@padarianovayork.com        / func123       (Funcionário)
-- As senhas abaixo estão em hash scrypt, nunca em texto puro.
-- =====================================================================
USE gestfast;

INSERT INTO perfil (id_perfil, nome_perfil) VALUES
  (1, 'Administrador'), (2, 'BackOffice'), (3, 'Funcionario');

INSERT INTO usuario (id_usuario, nome, email, senha, cargo, status, data_criacao, id_perfil) VALUES
  (1, 'Francisco', 'proprietario@padarianovayork.com', 'scrypt$0f4b5b95f0b7c5568b549d82a8747206$413a4bf22a9838de507d7ebedbe512f1e5b9a9e697d284ea5e0a8a41a4e1cd1159a6c7ee4b25869834ed1ad632cbb19b714681c680496f28ca29aaaf508017db', 'Proprietário', 'Ativo', CURDATE(), 1),
  (2, 'Henry Sena', 'henry@padarianovayork.com', 'scrypt$93d59bfa5bcd5e60e57ed0e29a4ad8d1$bafc93166df2c477eff90d654615633fbfd28b23f3256986ac384bd252aa15e54ee90c2fc634491366b7ee03b9adce69f7d3a544472263f39df349ceeeed164c', 'Atendente / Operador de Caixa', 'Ativo', CURDATE(), 3),
  (3, 'Equipe BackOffice', 'backoffice@padarianovayork.com', 'scrypt$4ae990e89a82a73c0674138f2c1f200c$bec050b3287b3a8ee1ce09f8b2c6f21728a1957d9bdf3b895ff32ecd78f9a07f43e53fe85b8ac2997ed9c186d1ec57f8f75ce44eb328b94f93edbbc5320bafda', 'BackOffice / Estoque', 'Ativo', CURDATE(), 2);

INSERT INTO configuracao (id, estabelecimento, desconto_maximo_percent, intervalo_atualizacao_seg, simular_cartao_negado, simular_fornecedor_indisponivel, dias_alerta_validade) VALUES
  (1, 'Padaria Nova York - São Caetano do Sul (SP)', 20, 3, FALSE, FALSE, 3);

INSERT INTO categoria (id_categoria, nome_categoria, descricao) VALUES
  (1, 'Pães', 'Pães artesanais, franceses, baguetes e doces'),
  (2, 'Bebidas & Cafés', 'Cafés, sucos, refrigerantes e laticínios'),
  (3, 'Mercearia & Insumos', 'Farinhas, açúcares, fermentos e ingredientes'),
  (4, 'Confeitaria & Bolos', 'Bolos, doces, tortas e sobremesas'),
  (5, 'Frios & Derivados', 'Queijos, presuntos, manteigas e frios fatiados');

INSERT INTO fornecedor (id_fornecedor, nome) VALUES
  (1, 'Empresa Pão e Açúcar Dist.'),
  (2, 'Moinho Paulista de Trigo'),
  (3, 'Granja Santo André Ltda'),
  (4, 'Laticínios ABC'),
  (5, 'Confeitaria Doce Arte'),
  (6, 'Panificadora Central e Distribuição'),
  (7, 'Café Pilão Distribuição Direta'),
  (8, 'Distribuidora de Embalagens São Caetano');

INSERT INTO produto (id_produto, codigo_barras, nome_produto, descricao, unidade, peso, preco_custo, preco_venda, preco_min, preco_max, quantidade_estoque, estoque_minimo, status, id_categoria, lote, validade, imagem) VALUES
  (1,  '78910001', 'Pão de Queijo', 'Pão de queijo tradicional de Minas 50g assado na hora', 'UN', '50g', 1.20, 3.50, 2.50, 5.00, 10, 30, 'Ativo', 1, '546320', CURDATE() + INTERVAL 3 DAY, ''),
  (2,  '78910002', 'Café Pilão 320g', 'Café torrado e moído tradicional 320g com notas intensas', 'Pacote', '320g', 12.50, 18.90, 15.00, 22.00, 20, 25, 'Ativo', 2, '548417', CURDATE() + INTERVAL 120 DAY, ''),
  (3,  '78910003', 'Bolo de Cenoura', 'Bolo caseiro de cenoura com calda generosa de chocolate', 'Fatia', '120g', 4.50, 12.00, 9.00, 16.00, 4, 12, 'Ativo', 4, '546328', CURDATE() + INTERVAL 2 DAY, ''),
  (4,  '78910004', 'Pão Francês', 'Pão francês artesanal crocante assado de hora em hora', 'KG', '1000g', 5.50, 16.90, 14.00, 19.90, 70, 30, 'Ativo', 1, '545846', CURDATE() + INTERVAL 1 DAY, ''),
  (5,  '78910005', 'Açúcar Cristal 1kg', 'Açúcar cristal refinado 1kg para receitas e café', 'Pacote', '1000g', 3.20, 5.50, 4.00, 7.00, 12, 20, 'Ativo', 3, '546326', CURDATE() + INTERVAL 200 DAY, ''),
  (6,  '78910006', 'Farinha de Trigo Especial 1kg', 'Farinha de trigo tipo 1 para panificação profissional de alto padrão', 'Pacote', '1000g', 4.10, 6.80, 5.00, 8.50, 18, 40, 'Ativo', 3, '547890', CURDATE() + INTERVAL 90 DAY, ''),
  (7,  '78910007', 'Queijo Mussarela Fatiado', 'Queijo mussarela fatiado fresco para lanches e salgados', 'KG', '1000g', 32.00, 48.00, 40.00, 56.00, 6, 15, 'Ativo', 5, '549012', CURDATE() + INTERVAL 7 DAY, ''),
  (8,  '78910008', 'Leite Integral 1L', 'Leite UHT integral pasteurizado 1L', 'UN', '1000ml', 3.80, 6.00, 4.90, 7.50, 80, 30, 'Ativo', 2, '548900', CURDATE() + INTERVAL 20 DAY, ''),
  (9,  '78910009', 'Ovos Brancos Granjeiros (Dúzia)', 'Dúzia de ovos brancos selecionados tipo grande de alta qualidade', 'DZ', '650g', 8.50, 15.00, 12.00, 18.00, 100, 35, 'Ativo', 3, '549111', CURDATE() + INTERVAL 12 DAY, ''),
  (10, '78910010', 'Suco de Uva Integral 500ml', 'Suco de uva tinto 100% natural sem adição de açúcares ou conservantes', 'UN', '500ml', 4.80, 8.00, 6.50, 10.00, 25, 15, 'Ativo', 2, '578412', CURDATE() + INTERVAL 150 DAY, ''),
  (11, '78910011', 'Pão Doce Tradicional', 'Pão doce fofinho com creme de baunilha artesanal e coco ralado', 'UN', '80g', 1.10, 3.20, 2.50, 4.00, 60, 20, 'Ativo', 1, '548999', CURDATE() - INTERVAL 1 DAY, ''),
  (12, '78910012', 'Bala Toffee Mastigável', 'Balas caramelizadas artesanais sortidas tradicionais da bomboniere', 'UN', '10g', 0.10, 0.30, 0.20, 0.50, 200, 50, 'Ativo', 4, '546111', CURDATE() + INTERVAL 180 DAY, '');


-- Etapa 3: produtos feitos na padaria e insumos (números de exemplo, não são as receitas reais da padaria)
UPDATE produto SET tipo = 'Produção' WHERE id_produto IN (1, 3, 4, 11);

INSERT INTO produto (id_produto, codigo_barras, nome_produto, descricao, unidade, peso, preco_custo, preco_venda, preco_min, preco_max, quantidade_estoque, estoque_minimo, status, tipo, unidade_compra, fator_conversao, id_categoria, lote, validade, imagem) VALUES
  (13, '78910013', 'Farinha de Trigo (saco 25 kg)', 'Farinha de trigo para panificação comprada em saco de 25 kg', 'KG', '25kg', 3.40, 3.40, 3.40, 3.40, 120, 50, 'Ativo', 'Insumo', 'Saco', 25, 3, '551200', CURDATE() + INTERVAL 120 DAY, ''),
  (14, '78910014', 'Fermento Biológico Seco', 'Fermento biológico seco instantâneo para pães', 'KG', '500g', 28.00, 28.00, 28.00, 28.00, 5, 2, 'Ativo', 'Insumo', NULL, 1, 3, '551201', CURDATE() + INTERVAL 90 DAY, ''),
  (15, '78910015', 'Sal Refinado', 'Sal refinado iodado para massas', 'KG', '1kg', 2.00, 2.00, 2.00, 2.00, 10, 3, 'Ativo', 'Insumo', NULL, 1, 3, '551202', CURDATE() + INTERVAL 365 DAY, ''),
  (16, '78910016', 'Margarina para Panificação', 'Margarina com sal para massas e folhados', 'KG', '15kg', 12.00, 12.00, 12.00, 12.00, 15, 5, 'Ativo', 'Insumo', 'Balde', 15, 3, '551203', CURDATE() + INTERVAL 60 DAY, ''),
  (17, '78910017', 'Polvilho Azedo', 'Polvilho azedo para pão de queijo', 'KG', '1kg', 9.00, 9.00, 9.00, 9.00, 20, 5, 'Ativo', 'Insumo', NULL, 1, 3, '551204', CURDATE() + INTERVAL 150 DAY, ''),
  (18, '78910018', 'Cenoura', 'Cenoura fresca para bolos', 'KG', '1kg', 4.00, 4.00, 4.00, 4.00, 8, 3, 'Ativo', 'Insumo', NULL, 1, 3, '551205', CURDATE() + INTERVAL 10 DAY, ''),
  (19, '78910019', 'Óleo de Soja', 'Óleo de soja para massas e bolos', 'Lt', '900ml', 8.00, 8.00, 8.00, 8.00, 12, 4, 'Ativo', 'Insumo', NULL, 1, 3, '551206', CURDATE() + INTERVAL 200 DAY, '');

INSERT INTO ficha_tecnica (id_ficha, id_produto, rendimento, nome_rendimento, validade_dias, observacao, atualizada_em, id_usuario) VALUES
  (1, 4, 12, 'fornada', 1, 'Massa batida 12 min; fermentação 3 h.', NOW() - INTERVAL 2 DAY, 1),
  (2, 1, 50, 'fornada', 2, 'Bolinhas de 50 g.', NOW() - INTERVAL 2 DAY, 1),
  (3, 3, 12, 'assadeira', 3, '1 assadeira = 12 fatias.', NOW() - INTERVAL 2 DAY, 1);

INSERT INTO item_ficha_tecnica (id_ficha, id_insumo, quantidade) VALUES
  (1, 13, 10), (1, 14, 0.2), (1, 15, 0.2), (1, 16, 0.3),
  (2, 17, 1), (2, 9, 1), (2, 8, 1), (2, 7, 0.5),
  (3, 13, 0.3), (3, 18, 0.4), (3, 19, 0.2), (3, 5, 1), (3, 9, 1);

-- Custo dos produtos com ficha = custo da receita / rendimento
UPDATE produto SET preco_custo = 3.63 WHERE id_produto = 4;
UPDATE produto SET preco_custo = 0.75 WHERE id_produto = 1;
UPDATE produto SET preco_custo = 1.33 WHERE id_produto = 3;

INSERT INTO producao (id_producao, id_produto, receitas, quantidade, custo_total, data_producao, observacao, status, id_usuario) VALUES
  (1, 4, 1, 12, 43.60, NOW() - INTERVAL 240 MINUTE, 'Primeira fornada da manhã', 'Concluída', 2);

INSERT INTO requisicao (id_requisicao, codigo_pedido, id_fornecedor, id_produto, produto_nome, quantidade_pedida, quantidade_atendida, unidade, valor_unitario, valor_total, situacao, data_pedido, previsao_entrega, endereco_entrega, observacao, justificativa_cancelamento) VALUES
  (1, 'REQ-9661', 1, 2, 'Café Pilão 320g', 50, 15, 'Pacote', 12.50, 625.00, 'Em Aberto', CURDATE() - INTERVAL 6 DAY, CURDATE() + INTERVAL 1 DAY, 'Padaria Nova York - Rua Visconde de Inhaúma, 450', 'Pedido prioritário de café moído para atender o fluxo matinal da padaria.', NULL),
  (2, 'REQ-9662', 3, 9, 'Ovos Brancos Granjeiros (Dúzia)', 100, 0, 'DZ', 8.50, 850.00, 'Em Aberto', CURDATE() - INTERVAL 5 DAY, CURDATE() + INTERVAL 2 DAY, 'Padaria Nova York - Rua Visconde de Inhaúma, 450', 'Reposição semanal de ovos para a produção contínua da confeitaria.', NULL),
  (3, 'REQ-9663', 2, 6, 'Farinha de Trigo Especial 1kg', 50, 0, 'Pacote', 4.10, 205.00, 'Cotado', CURDATE() - INTERVAL 5 DAY, CURDATE() + INTERVAL 3 DAY, 'Padaria Nova York - Rua Visconde de Inhaúma, 450', 'Farinha com teor protéico ideal para a fornada diária de baguetes.', NULL),
  (4, 'REQ-9664', 5, 3, 'Bolo de Cenoura', 30, 0, 'Fatia', 4.50, 135.00, 'Em Aberto', CURDATE() - INTERVAL 4 DAY, CURDATE() + INTERVAL 1 DAY, 'Padaria Nova York - Rua Visconde de Inhaúma, 450', 'Estoque atingiu nível crítico no balcão refrigerado.', NULL),
  (5, 'REQ-9665', 6, 4, 'Pão Francês', 60, 60, 'KG', 5.50, 330.00, 'Finalizado', CURDATE() - INTERVAL 9 DAY, CURDATE() - INTERVAL 8 DAY, 'Padaria Nova York - Rua Visconde de Inhaúma, 450', 'Entregue com pontualidade e conferido integralmente pelo estoquista.', NULL),
  (6, 'REQ-9666', 8, NULL, 'Copos Descartáveis 200ml (Cento)', 20, 0, 'Pacote', 12.00, 240.00, 'Cancelado', CURDATE() - INTERVAL 11 DAY, CURDATE() - INTERVAL 8 DAY, 'Padaria Nova York - Rua Visconde de Inhaúma, 450', 'Pedido de embalagens para o balcão.', 'Cancelamento efetuado após a verificação física constatar saldo remanescente suficiente para mais 3 semanas no depósito.');

INSERT INTO requisicao_historico (id_requisicao, data_registro, situacao, id_usuario)
  SELECT id_requisicao, TIMESTAMP(data_pedido, CURTIME()), 'Em Aberto', 2 FROM requisicao;

INSERT INTO venda (id_venda, codigo_venda, data_venda, valor_subtotal, desconto, desconto_tipo, valor_total, forma_pagamento, status_venda, id_usuario) VALUES
  (1, 'VENDA-1001', NOW() - INTERVAL 180 MINUTE, 90.00,  0, 'valor', 90.00,  'Cartão Débito',  'Concluída', 2),
  (2, 'VENDA-1002', NOW() - INTERVAL 150 MINUTE, 118.40, 0, 'valor', 118.40, 'Dinheiro',       'Concluída', 2),
  (3, 'VENDA-1003', NOW() - INTERVAL 120 MINUTE, 120.00, 0, 'valor', 120.00, 'PIX',            'Concluída', 2),
  (4, 'VENDA-1004', NOW() - INTERVAL 90 MINUTE,  450.00, 0, 'valor', 450.00, 'Cartão Crédito', 'Concluída', 2),
  (5, 'VENDA-1005', NOW() - INTERVAL 60 MINUTE,  109.85, 0, 'valor', 109.85, 'Dinheiro',       'Concluída', 2),
  (6, 'VENDA-1006', NOW() - INTERVAL 30 MINUTE,  96.00,  0, 'valor', 96.00,  'PIX',            'Concluída', 2);

INSERT INTO item_venda (id_venda, id_produto, quantidade, valor_unitario, subtotal) VALUES
  (1, 2, 5, 18.00, 90.00),
  (2, 11, 37, 3.20, 118.40),
  (3, 8, 20, 6.00, 120.00),
  (4, 9, 30, 15.00, 450.00),
  (5, 4, 6.5, 16.90, 109.85),
  (6, 10, 12, 8.00, 96.00);

INSERT INTO movimentacao_estoque (id_movimentacao, tipo_movimentacao, quantidade, data_movimentacao, observacao, origem, motivo_perda, valor_unitario, id_produto, id_usuario) VALUES
  (1, 'Entrada', 60, NOW() - INTERVAL 900 MINUTE, 'Recebimento de lote do fornecedor Panificadora Central', 'manual', NULL, 5.50, 4, 1),
  (2, 'Saída', 15, NOW() - INTERVAL 600 MINUTE, 'Vendas acumuladas do balcão de frios e lanches', 'venda', NULL, 3.50, 1, 2),
  (3, 'Saída', 6, NOW() - INTERVAL 420 MINUTE, 'Venda de Café Pilão para clientes do salão', 'venda', NULL, 18.90, 2, 2),
  (4, 'Saída', 3, NOW() - INTERVAL 300 MINUTE, 'Pães franceses que sobraram do fim do dia', 'perda', 'Sobra do dia', 5.50, 4, 2);

INSERT INTO movimentacao_estoque (tipo_movimentacao, quantidade, data_movimentacao, observacao, origem, valor_unitario, id_produto, id_usuario, id_producao) VALUES
  ('Saída', 10, NOW() - INTERVAL 240 MINUTE, 'Produção #1: Pão Francês', 'producao', 3.40, 13, 2, 1),
  ('Saída', 0.2, NOW() - INTERVAL 240 MINUTE, 'Produção #1: Pão Francês', 'producao', 28.00, 14, 2, 1),
  ('Saída', 0.2, NOW() - INTERVAL 240 MINUTE, 'Produção #1: Pão Francês', 'producao', 2.00, 15, 2, 1),
  ('Saída', 0.3, NOW() - INTERVAL 240 MINUTE, 'Produção #1: Pão Francês', 'producao', 12.00, 16, 2, 1),
  ('Entrada', 12, NOW() - INTERVAL 240 MINUTE, 'Produção #1: Pão Francês', 'producao', 3.63, 4, 2, 1);

INSERT INTO conferencia (id_conferencia, data_conferencia, observacao, ajustou_estoque, id_usuario) VALUES
  (1, NOW() - INTERVAL 3 DAY, 'Conferência de estoque físico e ajuste de saldos.', TRUE, 2);

INSERT INTO item_conferencia (id_conferencia, id_produto, lote, quantidade_sistema, quantidade_fisica, divergencia) VALUES
  (1, 5, '546326', 12, 12, 0),
  (1, 2, '548417', 25, 25, 0),
  (1, 4, '545846', 70, 68, -2);

-- Alertas iniciais: todo produto ativo com estoque igual ou abaixo do mínimo
INSERT INTO alerta_estoque (data_alerta, mensagem, status_alerta, id_produto)
  SELECT NOW(), CONCAT('Atenção: ', nome_produto, ' atingiu o estoque mínimo'), 'Ativo', id_produto
  FROM produto WHERE status = 'Ativo' AND quantidade_estoque <= estoque_minimo;
