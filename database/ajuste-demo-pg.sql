-- =====================================================================
-- GestFast ERP - Ajuste da demonstração na nuvem (só na branch demo-nuvem)
-- Executar DEPOIS do schema-pg.sql e do seed-pg.sql.
-- Troca os dados que identificam a padaria real por dados fictícios.
-- Não altera senha: troque as senhas em Funcionários logo na primeira subida.
-- =====================================================================
SET search_path TO gestfast;

UPDATE configuracao SET estabelecimento = 'Padaria Pão Dourado' WHERE id = 1;

UPDATE usuario SET nome = 'Usuário Demo', email = 'demo@paodourado.demo', cargo = 'Gerente (demonstração)' WHERE id_usuario = 1;
UPDATE usuario SET nome = 'Caio Mendes', email = 'caio@paodourado.demo', cargo = 'Operador de Caixa' WHERE id_usuario = 2;
UPDATE usuario SET nome = 'Marta Ribeiro', email = 'marta@paodourado.demo', cargo = 'Estoque / Compras' WHERE id_usuario = 3;

UPDATE fornecedor SET nome = 'Distribuidora de Café Bom Grão' WHERE id_fornecedor = 7;
UPDATE fornecedor SET nome = 'Embalagens Rápidas' WHERE id_fornecedor = 8;

UPDATE requisicao SET endereco_entrega = 'Padrão - Padaria Pão Dourado';

-- Etiqueta de exemplo no caixa: 2000010005000 (500 g de Pão Francês)
UPDATE produto SET codigo_balanca = 1 WHERE nome_produto = 'Pão Francês' AND unidade = 'KG';
