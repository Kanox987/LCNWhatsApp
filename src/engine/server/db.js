import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { ARQ_DB } from '../paths.js'

const PASTA_MIGRACOES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

function listarMigracoes (pasta) {
  return fs.readdirSync(pasta)
    .filter((nome) => /^\d+_.+\.sql$/.test(nome))
    .sort()
    .map((nome) => ({
      nome,
      version: Number(nome.match(/^(\d+)/)[1]),
      sql: fs.readFileSync(path.join(pasta, nome), 'utf8')
    }))
}

export function rodarMigrations (db, pastaMigracoes = PASTA_MIGRACOES) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)

  const aplicada = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?')
  const registrar = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
  const aplicar = db.transaction(({ version, sql }) => {
    if (aplicada.get(version)) return
    db.exec(sql)
    registrar.run(version, new Date().toISOString())
  })

  for (const migration of listarMigracoes(pastaMigracoes)) aplicar(migration)
}

export function abrirBanco (arquivo = ARQ_DB, { pastaMigracoes = PASTA_MIGRACOES } = {}) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 })
  try { fs.chmodSync(path.dirname(arquivo), 0o700) } catch {}

  const db = new Database(arquivo)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    rodarMigrations(db, pastaMigracoes)
    if (arquivo !== ':memory:') {
      try { fs.chmodSync(arquivo, 0o600) } catch {}
    }
    return db
  } catch (erro) {
    db.close()
    throw erro
  }
}
