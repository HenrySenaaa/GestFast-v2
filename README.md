# GestFast ERP v2

Sistema de gestão de estoque e vendas para panificadoras (projeto USCS - ADS). Back-end em Node.js (módulo `http`) com banco **MySQL 8**, e front-end em HTML/CSS/JS puro.

## Como executar

1. **Criar o banco** no MySQL Workbench: abrir e executar `database/schema.sql` e depois `database/seed.sql`
   (atenção: o `schema.sql` apaga e recria o banco `gestfast`). Para recomeçar do zero, rode os dois de novo.
   **Banco que já existe** (usado pelo GestFast original): em vez disso, faça um backup e rode só
   `database/migracao-otimizacao.sql`. Ele não apaga dados, pode rodar mais de uma vez, e o GestFast original
   continua funcionando no mesmo banco. Depois rode `database/migracao-etapa3.sql` (produção: tipo de produto,
   ficha técnica e registro de produção). Sem essas migrações, a v2 avisa no terminal e não sobe.
2. **Configurar a conexão**: copiar `.env.example` para `.env` e colocar a senha do seu MySQL.
   O `.env` não vai para o Git.
3. **Instalar e rodar** (Node 18 ou superior):

```bash
npm install
npm start               # http://localhost:3000
npm test                # 26 testes automatizados da API (cenários do Apêndice F + v2 + etapa 3)
node test/carga.js      # teste de carga do banco (cria gestfast_carga_test)
```

Os testes usam um banco separado, `gestfast_test`, que é apagado e recriado a cada execução (o banco
`gestfast` não é tocado). Eles usam o mesmo usuário/senha do `.env`.

Variáveis opcionais: `PORT`, `TZ` (padrão `America/Sao_Paulo`), `GESTFAST_UPLOAD_DIR` (imagens, padrão `data/uploads`)
e `GESTFAST_LOG_DIR`.

## Usuários iniciais (altere as senhas em Funcionários / Configuração)

| Perfil | Login | Senha inicial |
|---|---|---|
| Administrador | proprietario@padarianovayork.com | admin123 |
| BackOffice | backoffice@padarianovayork.com | backoffice123 |
| Funcionário | henry@padarianovayork.com | func123 |

## O que o sistema faz

| Área | Recursos |
|---|---|
| Login | senha com hash scrypt, "manter conectado", conta inativa bloqueada, bloqueio temporário após 5 falhas, recuperação de senha por link (o link é escrito no console/log, pois não há SMTP) |
| Perfis | Administrador, BackOffice e Funcionário, validados no servidor e refletidos no menu |
| Painel | alertas de estoque mínimo (clique no item para criar a requisição), compras recentes, gráfico, atualização automática |
| Busca | a barra do topo acha telas e também produtos, requisições, vendas e funcionários (conforme o perfil); atalhos `/` e `Ctrl+K` |
| Produtos | incluir, alterar, inativar/reativar, filtro por categoria/situação, upload de imagem, validações de preço, código único |
| Estoque | conferência física com divergência, ajuste automático e histórico; alerta de validade |
| Requisições | criar, cotar, gerar AF, receber (total ou parcial, com entrada automática no estoque), cancelar com justificativa, histórico |
| Entradas / Saídas | individual ou **em lote**, com filtro por período |
| Caixa (PDV) | busca por código de barras, desconto em R$ ou %, limite de desconto configurável, troco, baixa automática de estoque |
| Histórico de vendas | consultar, editar quantidades, cancelar (exige senha de gerente, estorna estoque) e excluir (só Administrador) |
| Relatórios | faturamento/vendas, estoque (entradas, saídas, saldo), desperdício e **consumo da produção** (insumos gastos e custo do que foi produzido) com filtro de período e categoria; exportação real em **PDF** e **Excel (.xlsx)** |
| Ficha técnica | receita de cada produto de produção própria (insumos, rendimento, validade do pronto); custo por unidade e margem calculados; o custo do produto passa a ser o da receita |
| Produção | registrar fornadas: entra o produto pronto e saem os insumos numa transação; prévia do consumo e da falta antes de confirmar; estorno com motivo (Administrador/BackOffice) |
| Tipo de produto | Revenda, Produção própria ou Insumo (insumo não aparece no caixa); unidade de compra com conversão (ex.: 1 Saco = 25 KG) para dar entrada em sacos |
| Funcionários | cadastrar, alterar, trocar perfil, ativar/desativar, filtros |
| Configuração | parâmetros, troca de senha, acessibilidade (texto A-/A+, alto contraste), logs de atividade |

## Regras importantes

- Produtos em **UN, Pacote, DZ e Fatia só aceitam quantidades inteiras**; apenas **KG e Lt** aceitam frações (validado no navegador e no servidor).
- Toda operação que altera estoque é uma transação: se algo falhar, nada é gravado.
- Falhas externas (operadora de cartão negando, fornecedor fora do ar) podem ser simuladas em Configuração para demonstração.

- Na produção, insumo controlado em unidade inteira (UN, DZ, Pacote) é **arredondado para cima** (meia dúzia de ovos vira 1 DZ).
  Para receitas com poucos ovos, cadastre os ovos em UN.
- A baixa é de um nível só: um insumo que também tem ficha técnica é baixado do estoque dele, não da receita dele.

## Estrutura

```
server.js            API REST, autenticação, rotas e arquivos estáticos
db.js                regras de negócio, validações e consultas ao MySQL (transações)
lib/                 auth (scrypt), permissões, logger, exportação PDF/XLSX, gateways simulados
public/              interface (index.html, style.css, js/ por módulo)
database/            schema.sql (tabelas), seed.sql (dados de exemplo), conexao.js (pool + transação)
test/                api.test.js (testes) e setup-db.js (recria o banco gestfast_test)
```
test/carga.js        teste de carga: 50 mil vendas, 200 mil movimentações; mede as consultas pesadas
```

## O que mudou na v2

### Banco de dados otimizado
Índices novos, cada um ligado a uma consulta do `db.js`: `venda(status_venda, data_venda)`,
`movimentacao_estoque(origem, data)` e `(tipo, data)`, `produto(status, validade)`, `requisicao(situacao)`,
`sessao(expira)` e `token_reset(expira)`. Também há a coluna calculada `requisicao.numero_pedido` com índice,
para o próximo código de pedido sair do índice.
Consultas reescritas:
- **Painel:** somas no MySQL, filtro de data que usa índice e consultas em paralelo.
- **Busca e histórico:** filtro só sobre `venda`, com subconsultas não correlacionadas.
- **Listas paginadas:** *deferred join*, ou seja, a página é cortada antes dos JOINs.
- **Relatórios:** de vendas, em três leituras enxutas em paralelo; de estoque, numa única agregação.
- **Requisições:** histórico agrupado com `Map`.

Listagens aceitam `?limit=&offset=` e devolvem também `total` (e `faturamento`/`valorTotal`).
Sem `limit`, a resposta é igual à da v1.

**Medido** com `node test/carga.js` (MySQL 8.4 local, 500 produtos, 50 mil vendas, ~146 mil itens,
200 mil movimentações, 5 mil requisições; mediana de 7 execuções). Os tempos variam ~10–20% entre rodadas.

| Consulta | v1 | v2 |
|---|---:|---:|
| Painel | 42 ms | 6 ms |
| Busca global | 1.433 ms | 9 ms |
| Histórico de vendas (tela) | 1.438 ms (tudo) | 29 ms (página de 50 + total) |
| Movimentações (tela) | 1.802 ms (tudo) | 111 ms (página de 50 + total) |
| Requisições (lista completa) | 1.100 ms | 111 ms |
| Relatório de vendas (tudo / 30 dias) | 1.595 / 183 ms | 836 / 60 ms |
| Relatório de desperdício | 523 ms | 450 ms |
| Relatório de estoque | 283 ms | 258 ms |

### Front end novo
- **Visual:** tema claro e escuro (segue o sistema; botão da lua para trocar) e alto contraste mantido.
  Ícones SVG no lugar dos emojis. Menu lateral agrupado, com ícones e recolhível.
- **Painel:** saudação, 5 indicadores clicáveis, gráfico de vendas dos últimos 7 dias e rosca de estoque por categoria.
- **Listas:** paginação (50 por página) em Histórico, Entradas e Saídas; filtros de data visíveis.
- **Caixa:** atalhos `F2` (buscar) e `F4` (finalizar), campo de código de barras em destaque.
- **Avisos e modais:** avisos com botão de fechar; nos modais, o `Tab` fica preso dentro e `Esc` fecha.
- **Celular:** layout para 390 px de largura, sem rolagem lateral.
- **Limpeza:** removido o `public/app.js`, código antigo que nenhuma página carregava.
