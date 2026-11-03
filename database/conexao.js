// conexao.js - Pool de conexões com o PostgreSQL (Supabase na demonstração), configurado pelo ambiente.
// Mantém a interface que o db.js já usa: query(sql, params) com "?" e resposta no formato [linhas].
require('dotenv').config();
const { Pool, Client, types } = require('pg');

// DECIMAL e contagens vêm como número; datas vêm como texto ('2026-09-12 10:15:00'), igual ao frontend espera.
const COMO_TEXTO = s => s;
types.setTypeParser(types.builtins.NUMERIC, Number);
types.setTypeParser(types.builtins.INT8, Number);
types.setTypeParser(types.builtins.DATE, COMO_TEXTO);
types.setTypeParser(types.builtins.TIMESTAMP, COMO_TEXTO);

const ESQUEMA = process.env.DB_NAME || 'gestfast'; // o "banco" do GestFast é um schema dentro do PostgreSQL

function configuracao() {
  if (process.env.DATABASE_URL) {
    // O sslmode da URL do Supabase passaria a exigir a cadeia de certificados: a conexão é cifrada aqui, sem validar a autoridade.
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.delete('sslmode');
    return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'postgres'
  };
}

// Troca "?" por $1, $2... fora de aspas. Lista vira $1, $2 e, depois de VALUES, grupos ($1, $2), ($3, $4).
function traduzir(sql, params = []) {
  const valores = [];
  const marca = v => { valores.push(v === undefined ? null : v); return `$${valores.length}`; };
  let saida = '', aspas = false, i = 0;
  let texto = sql.replace(/((?:\w+\.)?\w+) LIKE \?/g, 'sem_acento($1) LIKE sem_acento(?)'); // o MySQL ignorava maiúsculas e acentos
  // "INSERT INTO t SET ?" e "UPDATE t SET ?" recebem um objeto { coluna: valor }.
  const objeto = params.find(p => p && typeof p === 'object' && !Array.isArray(p));
  if (objeto) {
    const colunas = Object.keys(objeto);
    const lista = params.flatMap(p => (p === objeto ? colunas.map(c => objeto[c]) : [p]));
    texto = texto.replace(/INSERT INTO (\w+) SET \?/, (_, t) => `INSERT INTO ${t} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`)
      .replace(/SET \?/, `SET ${colunas.map(c => `${c} = ?`).join(', ')}`);
    params = lista;
  }
  for (const ch of texto) {
    if (ch === "'") aspas = !aspas;
    if (ch !== '?' || aspas) { saida += ch; continue; }
    const p = params[i++];
    if (!Array.isArray(p)) saida += marca(p);
    else if (Array.isArray(p[0])) saida += p.map(l => `(${l.map(marca).join(', ')})`).join(', ');
    else saida += p.length ? p.map(marca).join(', ') : 'NULL';
  }
  return { texto: saida, valores };
}

// Mesmo formato do mysql2: SELECT devolve [linhas]; escrita devolve [{ insertId, affectedRows }].
async function executar(alvo, sql, params) {
  const { texto, valores } = params && params.length ? traduzir(sql, params) : { texto: sql, valores: [] };
  const insercao = /^\s*INSERT\b/i.test(texto) && !/;\s*\S/.test(texto) && !/\bRETURNING\b/i.test(texto);
  const r = await alvo.query(insercao ? `${texto.replace(/;\s*$/, '')} RETURNING *` : texto, valores);
  if (Array.isArray(r)) return [r, []]; // vários comandos num texto só (scripts .sql)
  if (r.command === 'SELECT') return [r.rows, r.fields];
  const primeira = r.rows && r.rows[0] && r.fields[0] ? r.rows[0][r.fields[0].name] : undefined;
  return [{ insertId: primeira, affectedRows: r.rowCount }, []];
}

const AO_CONECTAR = `SET search_path TO "${ESQUEMA}", public; SET TIME ZONE 'America/Sao_Paulo'`;

const interno = new Pool({ ...configuracao(), max: Number(process.env.DB_POOL) || 5, idleTimeoutMillis: 60000, keepAlive: true });
interno.on('connect', cliente => { cliente.query(AO_CONECTAR).catch(err => console.error('[GestFast ERP] search_path:', err.message)); });
// Conexão ociosa derrubada pelo servidor: sem isso, o erro encerraria o processo.
interno.on('error', err => console.error('[GestFast ERP] Conexão com o banco caiu:', err.message));

const pool = {
  query: (sql, params) => executar(interno, sql, params),
  end: () => interno.end(),
  async getConnection() {
    const cliente = await interno.connect();
    return {
      query: (sql, params) => executar(cliente, sql, params),
      ping: () => cliente.query('SELECT 1'),
      beginTransaction: () => cliente.query('BEGIN'),
      commit: () => cliente.query('COMMIT'),
      rollback: () => cliente.query('ROLLBACK'),
      release: () => cliente.release()
    };
  }
};

// Conexão avulsa (scripts e testes), fora do pool.
async function criarConexao() {
  const cliente = new Client(configuracao());
  await cliente.connect();
  await cliente.query(AO_CONECTAR);
  return { query: (sql, params) => executar(cliente, sql, params), end: () => cliente.end() };
}

async function testarConexao() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

// Executa fn(conn) dentro de uma transação; erro = rollback.
async function transacao(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, testarConexao, transacao, criarConexao };
