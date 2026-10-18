-- migracao-etapa3.sql - Atualiza um banco "gestfast" já existente para a etapa 3
-- (tipo de produto, conversão de unidade, ficha técnica e registro de produção) SEM apagar os dados.
-- Pré-requisito: migracao-etapa2.sql e migracao-otimizacao.sql já aplicadas.
-- Rodar uma única vez no MySQL Workbench. Faça um backup antes (Server > Data Export).
-- Banco novo: basta o schema.sql + seed.sql.
USE gestfast;

ALTER TABLE produto
  ADD COLUMN tipo ENUM('Revenda','Produção','Insumo') NOT NULL DEFAULT 'Revenda' AFTER status,
  ADD COLUMN unidade_compra VARCHAR(20) AFTER tipo,
  ADD COLUMN fator_conversao DECIMAL(12,3) NOT NULL DEFAULT 1 AFTER unidade_compra,
  ADD CONSTRAINT chk_produto_fator CHECK (fator_conversao > 0);

CREATE TABLE ficha_tecnica (
  id_ficha        INT PRIMARY KEY AUTO_INCREMENT,
  id_produto      INT NOT NULL UNIQUE,
  rendimento      DECIMAL(12,3) NOT NULL,
  nome_rendimento VARCHAR(40) NOT NULL DEFAULT 'receita',
  validade_dias   INT,
  observacao      TEXT,
  atualizada_em   DATETIME NOT NULL,
  id_usuario      INT,
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto),
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario),
  CHECK (rendimento > 0),
  CHECK (validade_dias IS NULL OR validade_dias >= 0)
) ENGINE=InnoDB;

CREATE TABLE item_ficha_tecnica (
  id_ficha   INT NOT NULL,
  id_insumo  INT NOT NULL,
  quantidade DECIMAL(12,3) NOT NULL,
  PRIMARY KEY (id_ficha, id_insumo),
  FOREIGN KEY (id_ficha) REFERENCES ficha_tecnica(id_ficha) ON DELETE CASCADE,
  FOREIGN KEY (id_insumo) REFERENCES produto(id_produto),
  CHECK (quantidade > 0)
) ENGINE=InnoDB;

CREATE TABLE producao (
  id_producao   INT PRIMARY KEY AUTO_INCREMENT,
  id_produto    INT NOT NULL,
  receitas      DECIMAL(12,3) NOT NULL,
  quantidade    DECIMAL(12,3) NOT NULL,
  custo_total   DECIMAL(10,2) NOT NULL DEFAULT 0,
  data_producao DATETIME NOT NULL,
  observacao    TEXT,
  status        ENUM('Concluída','Estornada') NOT NULL DEFAULT 'Concluída',
  id_usuario    INT NOT NULL,
  estornada_por INT,
  data_estorno  DATETIME,
  motivo_estorno VARCHAR(500),
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto),
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario),
  FOREIGN KEY (estornada_por) REFERENCES usuario(id_usuario),
  CHECK (receitas > 0 AND quantidade > 0)
) ENGINE=InnoDB;

ALTER TABLE movimentacao_estoque
  MODIFY COLUMN origem ENUM('manual','venda','requisicao','conferencia','estorno','ajuste','perda','producao') NOT NULL DEFAULT 'manual',
  ADD COLUMN id_producao INT AFTER id_usuario,
  ADD FOREIGN KEY (id_producao) REFERENCES producao(id_producao);

CREATE INDEX idx_producao_data ON producao(data_producao);
CREATE INDEX idx_produto_tipo ON produto(tipo, status);
