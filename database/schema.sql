-- =====================================================================
-- GestFast ERP - Estrutura do banco de dados (MySQL 8)
-- Como usar: abrir no MySQL Workbench e executar o arquivo inteiro (raio ⚡).
-- Depois executar seed.sql para carregar os dados de exemplo.
-- ATENÇÃO: o DROP DATABASE abaixo apaga o banco gestfast se ele já existir.
-- =====================================================================
DROP DATABASE IF EXISTS gestfast;
CREATE DATABASE gestfast DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE gestfast;

-- ---------------------------------------------------------------------
-- Usuários, perfis e acesso
-- ---------------------------------------------------------------------
CREATE TABLE perfil (
  id_perfil   INT PRIMARY KEY AUTO_INCREMENT,
  nome_perfil VARCHAR(30) NOT NULL UNIQUE            -- Administrador, BackOffice, Funcionario
) ENGINE=InnoDB;

CREATE TABLE usuario (
  id_usuario   INT PRIMARY KEY AUTO_INCREMENT,
  nome         VARCHAR(150) NOT NULL,
  email        VARCHAR(150) NOT NULL UNIQUE,          -- login
  senha        VARCHAR(255) NOT NULL,                 -- hash scrypt (nunca texto puro)
  cargo        VARCHAR(100),
  status       ENUM('Ativo','Inativo') NOT NULL DEFAULT 'Ativo',
  data_criacao DATE NOT NULL,
  id_perfil    INT NOT NULL,
  FOREIGN KEY (id_perfil) REFERENCES perfil(id_perfil)
) ENGINE=InnoDB;

-- Sessões de login (guarda só o hash do token do cookie)
CREATE TABLE sessao (
  hash       CHAR(64) PRIMARY KEY,
  id_usuario INT NOT NULL,
  lembrar    BOOLEAN NOT NULL DEFAULT FALSE,
  criado     BIGINT NOT NULL,                         -- milissegundos (Date.now())
  expira     BIGINT NOT NULL,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  INDEX idx_sessao_usuario (id_usuario)
) ENGINE=InnoDB;

-- Links de redefinição de senha (uso único, 30 minutos)
CREATE TABLE token_reset (
  hash       CHAR(64) PRIMARY KEY,
  id_usuario INT NOT NULL,
  expira     BIGINT NOT NULL,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Parâmetros do sistema (linha única, id = 1)
CREATE TABLE configuracao (
  id                              TINYINT PRIMARY KEY DEFAULT 1,
  estabelecimento                 VARCHAR(150) NOT NULL,
  desconto_maximo_percent         DECIMAL(5,2) NOT NULL DEFAULT 20,
  intervalo_atualizacao_seg       INT NOT NULL DEFAULT 3,
  simular_cartao_negado           BOOLEAN NOT NULL DEFAULT FALSE,
  simular_fornecedor_indisponivel BOOLEAN NOT NULL DEFAULT FALSE,
  dias_alerta_validade            INT NOT NULL DEFAULT 3,  -- avisa quando faltam N dias (ou menos) para vencer
  CHECK (id = 1)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
CREATE TABLE categoria (
  id_categoria   INT PRIMARY KEY AUTO_INCREMENT,
  nome_categoria VARCHAR(100) NOT NULL UNIQUE,
  descricao      VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE fornecedor (
  id_fornecedor INT PRIMARY KEY AUTO_INCREMENT,
  nome          VARCHAR(150) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE produto (
  id_produto         INT PRIMARY KEY AUTO_INCREMENT,
  codigo_barras      VARCHAR(100) NOT NULL UNIQUE,
  nome_produto       VARCHAR(200) NOT NULL,
  descricao          TEXT,
  unidade            VARCHAR(20) NOT NULL DEFAULT 'UN', -- KG e Lt aceitam fração; as demais só inteiros
  peso               VARCHAR(30),
  preco_custo        DECIMAL(10,2) NOT NULL DEFAULT 0,
  preco_venda        DECIMAL(10,2) NOT NULL,
  preco_min          DECIMAL(10,2) NOT NULL,
  preco_max          DECIMAL(10,2) NOT NULL,
  quantidade_estoque DECIMAL(12,3) NOT NULL DEFAULT 0,
  estoque_minimo     DECIMAL(12,3) NOT NULL DEFAULT 0,
  lote               VARCHAR(40),
  validade           DATE,
  imagem             VARCHAR(255),
  status             ENUM('Ativo','Inativo') NOT NULL DEFAULT 'Ativo',
  tipo               ENUM('Revenda','Produção','Insumo') NOT NULL DEFAULT 'Revenda', -- Insumo não é vendido no caixa
  unidade_compra     VARCHAR(20),                       -- ex.: 'Saco' (compra) com estoque em KG
  fator_conversao    DECIMAL(12,3) NOT NULL DEFAULT 1,  -- quantas unidades de estoque vêm em 1 unidade de compra
  id_categoria       INT NOT NULL,
  FOREIGN KEY (id_categoria) REFERENCES categoria(id_categoria),
  CHECK (preco_venda > 0),
  CHECK (preco_min <= preco_venda AND preco_venda <= preco_max),
  CHECK (quantidade_estoque >= 0),
  CHECK (fator_conversao > 0)
) ENGINE=InnoDB;

CREATE TABLE alerta_estoque (
  id_alerta     INT PRIMARY KEY AUTO_INCREMENT,
  data_alerta   DATETIME NOT NULL,
  mensagem      VARCHAR(255) NOT NULL,
  status_alerta ENUM('Ativo','Resolvido') NOT NULL DEFAULT 'Ativo',
  id_produto    INT NOT NULL,
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Compras (requisições a fornecedores)
-- ---------------------------------------------------------------------
CREATE TABLE requisicao (
  id_requisicao              INT PRIMARY KEY AUTO_INCREMENT,
  codigo_pedido              VARCHAR(20) NOT NULL UNIQUE,
  id_fornecedor              INT NOT NULL,
  id_produto                 INT NULL,                -- pode ser item ainda não cadastrado
  produto_nome               VARCHAR(200) NOT NULL,
  quantidade_pedida          DECIMAL(12,3) NOT NULL,
  quantidade_atendida        DECIMAL(12,3) NOT NULL DEFAULT 0,
  unidade                    VARCHAR(20) NOT NULL,
  valor_unitario             DECIMAL(10,2) NOT NULL,
  valor_total                DECIMAL(12,2) NOT NULL,
  situacao                   ENUM('Em Aberto','Cotado','AF Gerada','Finalizado','Cancelado') NOT NULL DEFAULT 'Em Aberto',
  data_pedido                DATE NOT NULL,
  previsao_entrega           DATE,
  endereco_entrega           VARCHAR(255),
  observacao                 TEXT,
  justificativa_cancelamento TEXT,
  FOREIGN KEY (id_fornecedor) REFERENCES fornecedor(id_fornecedor),
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto),
  CHECK (quantidade_pedida > 0)
) ENGINE=InnoDB;

CREATE TABLE requisicao_historico (
  id_historico  INT PRIMARY KEY AUTO_INCREMENT,
  id_requisicao INT NOT NULL,
  data_registro DATETIME NOT NULL,
  situacao      VARCHAR(60) NOT NULL,                 -- inclui "Recebimento parcial (4 Pacote)"
  id_usuario    INT,
  FOREIGN KEY (id_requisicao) REFERENCES requisicao(id_requisicao) ON DELETE CASCADE,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Vendas (PDV / balcão)
-- ---------------------------------------------------------------------
CREATE TABLE venda (
  id_venda            INT PRIMARY KEY AUTO_INCREMENT,
  codigo_venda        VARCHAR(20) NOT NULL UNIQUE,
  data_venda          DATETIME NOT NULL,
  valor_subtotal      DECIMAL(12,2) NOT NULL,
  desconto            DECIMAL(12,2) NOT NULL DEFAULT 0,
  desconto_tipo       ENUM('valor','percentual') NOT NULL DEFAULT 'valor',
  desconto_informado  DECIMAL(12,2) NOT NULL DEFAULT 0, -- valor digitado (R$ ou %), usado ao editar a venda
  valor_total         DECIMAL(12,2) NOT NULL,
  forma_pagamento     ENUM('Dinheiro','Cartão Débito','Cartão Crédito','PIX') NOT NULL,
  valor_recebido      DECIMAL(12,2),
  troco               DECIMAL(12,2),
  nsu                 VARCHAR(20),
  status_venda        ENUM('Concluída','Cancelada') NOT NULL DEFAULT 'Concluída',
  motivo_cancelamento TEXT,
  data_cancelamento   DATETIME,
  cancelada_por       INT,
  autorizada_por      INT,
  editada_por         INT,
  data_edicao         DATETIME,
  id_usuario          INT NOT NULL,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario),
  FOREIGN KEY (cancelada_por) REFERENCES usuario(id_usuario),
  FOREIGN KEY (autorizada_por) REFERENCES usuario(id_usuario),
  FOREIGN KEY (editada_por) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE item_venda (
  id_item_venda  INT PRIMARY KEY AUTO_INCREMENT,
  id_venda       INT NOT NULL,
  id_produto     INT NOT NULL,
  quantidade     DECIMAL(12,3) NOT NULL CHECK (quantidade > 0),
  valor_unitario DECIMAL(10,2) NOT NULL,              -- preço praticado no momento da venda
  subtotal       DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (id_venda) REFERENCES venda(id_venda) ON DELETE CASCADE,
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Produção: ficha técnica (receita) e registro de produção com baixa dos insumos
-- ---------------------------------------------------------------------
CREATE TABLE ficha_tecnica (
  id_ficha        INT PRIMARY KEY AUTO_INCREMENT,
  id_produto      INT NOT NULL UNIQUE,              -- produto pronto (tipo Produção)
  rendimento      DECIMAL(12,3) NOT NULL,           -- quanto 1 receita rende, na unidade do produto
  nome_rendimento VARCHAR(40) NOT NULL DEFAULT 'receita', -- ex.: fornada, assadeira
  validade_dias   INT,                              -- validade do produto pronto (NULL = não altera)
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
  quantidade DECIMAL(12,3) NOT NULL,                -- por receita, na unidade do insumo
  PRIMARY KEY (id_ficha, id_insumo),
  FOREIGN KEY (id_ficha) REFERENCES ficha_tecnica(id_ficha) ON DELETE CASCADE,
  FOREIGN KEY (id_insumo) REFERENCES produto(id_produto),
  CHECK (quantidade > 0)
) ENGINE=InnoDB;

CREATE TABLE producao (
  id_producao   INT PRIMARY KEY AUTO_INCREMENT,
  id_produto    INT NOT NULL,
  receitas      DECIMAL(12,3) NOT NULL,             -- quantas receitas (fornadas) foram feitas
  quantidade    DECIMAL(12,3) NOT NULL,             -- quanto entrou do produto pronto
  custo_total   DECIMAL(10,2) NOT NULL DEFAULT 0,   -- custo dos insumos consumidos
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

-- ---------------------------------------------------------------------
-- Movimentações de estoque (histórico de toda entrada e saída)
-- ---------------------------------------------------------------------
CREATE TABLE movimentacao_estoque (
  id_movimentacao   INT PRIMARY KEY AUTO_INCREMENT,
  tipo_movimentacao ENUM('Entrada','Saída') NOT NULL,
  quantidade        DECIMAL(12,3) NOT NULL CHECK (quantidade > 0),
  data_movimentacao DATETIME NOT NULL,
  observacao        TEXT,
  origem            ENUM('manual','venda','requisicao','conferencia','estorno','ajuste','perda','producao') NOT NULL DEFAULT 'manual',
  motivo_perda      ENUM('Vencido','Quebra/Avaria','Sobra do dia','Outro'),  -- só quando origem = 'perda'
  valor_unitario    DECIMAL(10,2) NOT NULL DEFAULT 0,
  id_produto        INT NOT NULL,
  id_usuario        INT,                              -- NULL = movimento do sistema
  id_producao       INT,                              -- produção que gerou o movimento (origem 'producao' e seu estorno)
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto),
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario),
  FOREIGN KEY (id_producao) REFERENCES producao(id_producao)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Conferência de inventário (físico x sistema)
-- ---------------------------------------------------------------------
CREATE TABLE conferencia (
  id_conferencia   INT PRIMARY KEY AUTO_INCREMENT,
  data_conferencia DATETIME NOT NULL,
  observacao       VARCHAR(1000),
  ajustou_estoque  BOOLEAN NOT NULL DEFAULT TRUE,
  id_usuario       INT NOT NULL,                      -- responsável pela contagem
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE item_conferencia (
  id_item_conferencia INT PRIMARY KEY AUTO_INCREMENT,
  id_conferencia      INT NOT NULL,
  id_produto          INT NOT NULL,
  lote                VARCHAR(40),
  quantidade_sistema  DECIMAL(12,3) NOT NULL,
  quantidade_fisica   DECIMAL(12,3) NOT NULL,
  divergencia         DECIMAL(12,3) NOT NULL,
  FOREIGN KEY (id_conferencia) REFERENCES conferencia(id_conferencia) ON DELETE CASCADE,
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Relatórios gerados (auditoria)
-- ---------------------------------------------------------------------
CREATE TABLE relatorio (
  id_relatorio   INT PRIMARY KEY AUTO_INCREMENT,
  tipo_relatorio VARCHAR(60) NOT NULL,
  data_geracao   DATETIME NOT NULL,
  id_usuario     INT NOT NULL,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Índices (cada um atende a uma consulta do db.js; ver README, seção "Banco otimizado")
-- ---------------------------------------------------------------------
CREATE INDEX idx_venda_data ON venda(data_venda);
CREATE INDEX idx_venda_status_data ON venda(status_venda, data_venda);           -- painel (vendas de hoje) e relatório de vendas
CREATE INDEX idx_mov_produto_data ON movimentacao_estoque(id_produto, data_movimentacao);
CREATE INDEX idx_mov_data ON movimentacao_estoque(data_movimentacao);
CREATE INDEX idx_mov_origem_data ON movimentacao_estoque(origem, data_movimentacao);  -- relatório de desperdício (origem = 'perda')
CREATE INDEX idx_mov_tipo_data ON movimentacao_estoque(tipo_movimentacao, data_movimentacao); -- telas de Entradas e Saídas
CREATE INDEX idx_produto_status ON produto(status, id_categoria);
CREATE INDEX idx_produto_validade ON produto(status, validade);                  -- alerta de validade
CREATE INDEX idx_alerta_status ON alerta_estoque(status_alerta, id_produto);
CREATE INDEX idx_requisicao_situacao ON requisicao(situacao);                    -- requisições em aberto (painel)
CREATE INDEX idx_sessao_expira ON sessao(expira);                                -- limpeza das sessões vencidas
CREATE INDEX idx_token_reset_expira ON token_reset(expira);
CREATE INDEX idx_producao_data ON producao(data_producao);                       -- tela de Produção e relatório de consumo
CREATE INDEX idx_produto_tipo ON produto(tipo, status);                          -- listas de insumos / produtos de produção

-- Número do pedido (REQ-9661 -> 9661) calculado pelo banco e indexado: o próximo código sai do índice,
-- sem ler a tabela inteira.
ALTER TABLE requisicao
  ADD COLUMN numero_pedido INT UNSIGNED AS (CAST(SUBSTRING(codigo_pedido, 5) AS UNSIGNED)) VIRTUAL,
  ADD INDEX idx_requisicao_numero (numero_pedido);
