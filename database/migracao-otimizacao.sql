-- migracao-otimizacao.sql - Otimiza um banco "gestfast" já existente (GestFast v2) SEM apagar dados.
-- Pode rodar mais de uma vez: cada índice/coluna só é criado se ainda não existir.
-- Compatível com o GestFast original: só acrescenta índices e uma coluna calculada; nada é removido ou renomeado.
-- Pré-requisito: migracao-etapa2.sql já aplicada. Faça um backup antes (Server > Data Export no Workbench).
-- Banco novo: basta o schema.sql + seed.sql (já vêm otimizados).
USE gestfast;

-- Cria o índice `nome` em `tabela` só se ele ainda não existir.
-- (MySQL não tem CREATE INDEX IF NOT EXISTS; por isso o comando é montado e executado com PREPARE.)
SET @tabela = 'venda', @nome = 'idx_venda_status_data', @ddl = 'CREATE INDEX idx_venda_status_data ON venda(status_venda, data_venda)';
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @tabela AND index_name = @nome) = 0, @ddl, 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @tabela = 'movimentacao_estoque', @nome = 'idx_mov_origem_data', @ddl = 'CREATE INDEX idx_mov_origem_data ON movimentacao_estoque(origem, data_movimentacao)';
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @tabela AND index_name = @nome) = 0, @ddl, 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @tabela = 'movimentacao_estoque', @nome = 'idx_mov_tipo_data', @ddl = 'CREATE INDEX idx_mov_tipo_data ON movimentacao_estoque(tipo_movimentacao, data_movimentacao)';
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @tabela AND index_name = @nome) = 0, @ddl, 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @tabela = 'produto', @nome = 'idx_produto_validade', @ddl = 'CREATE INDEX idx_produto_validade ON produto(status, validade)';
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @tabela AND index_name = @nome) = 0, @ddl, 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @tabela = 'requisicao', @nome = 'idx_requisicao_situacao', @ddl = 'CREATE INDEX idx_requisicao_situacao ON requisicao(situacao)';
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @tabela AND index_name = @nome) = 0, @ddl, 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @tabela = 'sessao', @nome = 'idx_sessao_expira', @ddl = 'CREATE INDEX idx_sessao_expira ON sessao(expira)';
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @tabela AND index_name = @nome) = 0, @ddl, 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @tabela = 'token_reset', @nome = 'idx_token_reset_expira', @ddl = 'CREATE INDEX idx_token_reset_expira ON token_reset(expira)';
SET @s = IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = @tabela AND index_name = @nome) = 0, @ddl, 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Número do pedido calculado pelo banco (REQ-9661 -> 9661), com índice: o próximo código sai do índice.
SET @s = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'requisicao' AND column_name = 'numero_pedido') = 0,
  'ALTER TABLE requisicao ADD COLUMN numero_pedido INT UNSIGNED AS (CAST(SUBSTRING(codigo_pedido, 5) AS UNSIGNED)) VIRTUAL, ADD INDEX idx_requisicao_numero (numero_pedido)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Atualiza as estatísticas para o otimizador escolher os índices novos.
ANALYZE TABLE produto, venda, item_venda, movimentacao_estoque, requisicao, sessao, token_reset;
