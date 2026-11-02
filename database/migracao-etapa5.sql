-- migracao-etapa5.sql - Atualiza um banco "gestfast" já existente para a etapa 5
-- (Fase B: abertura e fechamento de caixa, etiqueta da balança e venda em espera) SEM apagar os dados.
-- Pré-requisito: migracao-etapa3.sql e migracao-etapa4.sql já aplicadas.
-- Rodar uma única vez no MySQL Workbench. Faça um backup antes (Server > Data Export).
-- Banco novo: basta o schema.sql + seed.sql.
USE gestfast;

-- Parâmetros: exigir caixa aberto para vender e formato da etiqueta da balança.
ALTER TABLE configuracao
  ADD COLUMN exigir_caixa_aberto    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN balanca_modo           ENUM('peso','preco') NOT NULL DEFAULT 'peso',
  ADD COLUMN balanca_digitos_codigo TINYINT NOT NULL DEFAULT 5;

-- Código do produto na balança (o que vem impresso na etiqueta EAN-13 que começa com "2").
ALTER TABLE produto ADD COLUMN codigo_balanca INT NULL AFTER codigo_barras, ADD UNIQUE KEY uq_produto_balanca (codigo_balanca);

-- Caixa único da loja: "aberto" só vale 1 enquanto está aberto, e o UNIQUE impede um segundo caixa aberto.
CREATE TABLE caixa (
  id_caixa         INT PRIMARY KEY AUTO_INCREMENT,
  status           ENUM('Aberto','Fechado') NOT NULL DEFAULT 'Aberto',
  aberto           TINYINT GENERATED ALWAYS AS (IF(status = 'Aberto', 1, NULL)) STORED,
  data_abertura    DATETIME NOT NULL,
  id_usuario_abertura INT NOT NULL,
  troco_inicial    DECIMAL(12,2) NOT NULL,
  data_fechamento  DATETIME,
  id_usuario_fechamento INT,
  valor_esperado   DECIMAL(12,2),                   -- congelado no fechamento
  valor_contado    DECIMAL(12,2),
  diferenca        DECIMAL(12,2),                   -- contado - esperado
  observacao       TEXT,
  resumo           JSON,                            -- totais por forma congelados no fechamento
  UNIQUE KEY uq_caixa_aberto (aberto),
  INDEX idx_caixa_abertura (data_abertura),
  FOREIGN KEY (id_usuario_abertura) REFERENCES usuario(id_usuario),
  FOREIGN KEY (id_usuario_fechamento) REFERENCES usuario(id_usuario),
  CHECK (troco_inicial >= 0)
) ENGINE=InnoDB;

CREATE TABLE caixa_movimento (
  id_movimento INT PRIMARY KEY AUTO_INCREMENT,
  id_caixa     INT NOT NULL,
  tipo         ENUM('sangria','reforco','estorno') NOT NULL,
  valor        DECIMAL(12,2) NOT NULL,
  motivo       VARCHAR(255) NOT NULL,
  data_movimento DATETIME NOT NULL,
  id_usuario   INT NOT NULL,
  id_venda     INT NULL,                            -- só no estorno de venda de um caixa já fechado
  FOREIGN KEY (id_caixa) REFERENCES caixa(id_caixa),
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario),
  FOREIGN KEY (id_venda) REFERENCES venda(id_venda) ON DELETE SET NULL,
  CHECK (valor > 0)
) ENGINE=InnoDB;

-- NULL nas vendas anteriores à etapa 5 e nas feitas com a exigência de caixa desligada.
ALTER TABLE venda
  ADD COLUMN id_caixa INT NULL AFTER id_usuario,
  ADD INDEX idx_venda_caixa (id_caixa),
  ADD CONSTRAINT fk_venda_caixa FOREIGN KEY (id_caixa) REFERENCES caixa(id_caixa);

-- Venda em espera: segura o carrinho para atender o próximo cliente. Não reserva estoque.
CREATE TABLE venda_espera (
  id_espera     INT PRIMARY KEY AUTO_INCREMENT,
  rotulo        VARCHAR(60),
  itens         JSON NOT NULL,
  desconto      DECIMAL(12,2) NOT NULL DEFAULT 0,
  desconto_tipo ENUM('valor','percentual') NOT NULL DEFAULT 'valor',
  criada_em     DATETIME NOT NULL,
  id_usuario    INT NOT NULL,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;
