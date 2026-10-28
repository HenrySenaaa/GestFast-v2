-- migracao-etapa4.sql - Atualiza um banco "gestfast" já existente para a etapa 4
-- (WhatsApp do fornecedor, pedido em massa, pedidos predefinidos e pagamento misto) SEM apagar os dados.
-- Pré-requisito: migracao-etapa3.sql já aplicada.
-- Rodar uma única vez no MySQL Workbench. Faça um backup antes (Server > Data Export).
-- Banco novo: basta o schema.sql + seed.sql.
USE gestfast;

-- WhatsApp do fornecedor (só dígitos, com DDI 55), usado no botão "Enviar pelo WhatsApp" do pedido.
ALTER TABLE fornecedor ADD COLUMN whatsapp VARCHAR(15) NULL AFTER nome;

-- Pedido em massa: as requisições feitas juntas para o mesmo fornecedor compartilham o código do pedido.
ALTER TABLE requisicao
  ADD COLUMN pedido_grupo VARCHAR(20) NULL AFTER codigo_pedido,
  ADD INDEX idx_requisicao_grupo (pedido_grupo);

-- Pedidos predefinidos (ex.: "Pedido semanal do moinho"): fornecedor + itens com a quantidade de sempre.
CREATE TABLE pedido_modelo (
  id_modelo     INT PRIMARY KEY AUTO_INCREMENT,
  nome          VARCHAR(80) NOT NULL UNIQUE,
  id_fornecedor INT NOT NULL,
  observacao    TEXT,
  atualizado_em DATETIME NOT NULL,
  id_usuario    INT,
  FOREIGN KEY (id_fornecedor) REFERENCES fornecedor(id_fornecedor),
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
) ENGINE=InnoDB;

CREATE TABLE item_pedido_modelo (
  id_modelo  INT NOT NULL,
  id_produto INT NOT NULL,
  quantidade DECIMAL(12,3) NOT NULL,
  PRIMARY KEY (id_modelo, id_produto),
  FOREIGN KEY (id_modelo) REFERENCES pedido_modelo(id_modelo) ON DELETE CASCADE,
  FOREIGN KEY (id_produto) REFERENCES produto(id_produto),
  CHECK (quantidade > 0)
) ENGINE=InnoDB;

-- Pagamento misto: a venda fica como 'Misto' e cada parte (forma + valor) vai para venda_pagamento.
ALTER TABLE venda MODIFY forma_pagamento ENUM('Dinheiro','Cartão Débito','Cartão Crédito','PIX','Misto') NOT NULL;

CREATE TABLE venda_pagamento (
  id_venda_pagamento INT PRIMARY KEY AUTO_INCREMENT,
  id_venda           INT NOT NULL,
  forma_pagamento    ENUM('Dinheiro','Cartão Débito','Cartão Crédito','PIX') NOT NULL,
  valor              DECIMAL(12,2) NOT NULL,
  nsu                VARCHAR(20),
  FOREIGN KEY (id_venda) REFERENCES venda(id_venda) ON DELETE CASCADE,
  CHECK (valor > 0)
) ENGINE=InnoDB;
