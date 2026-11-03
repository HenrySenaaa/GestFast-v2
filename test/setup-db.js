// test/setup-db.js - Recria o schema de TESTE a partir de database/schema-pg.sql + database/seed-pg.sql.
// Só aceita nomes terminados em "_test", para nunca apagar o schema de verdade (gestfast).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { criarConexao } = require('../database/conexao');

async function recriarBancoDeTeste(nome) {
  if (!/_test$/.test(nome)) throw new Error(`Banco de teste precisa terminar em "_test" (recebido: ${nome}).`);
  const ler = f => fs.readFileSync(path.join(__dirname, '..', 'database', f), 'utf8').replace(/\bgestfast\b/g, nome);
  const conn = await criarConexao();
  try {
    await conn.query(ler('schema-pg.sql'));
    await conn.query(ler('seed-pg.sql'));
  } finally {
    await conn.end();
  }
}

module.exports = { recriarBancoDeTeste };
