// src/engine/server/db.js — abertura do SQLite do motor + migrations.
// Usa ':memory:' (suportado por abrirBanco), nunca o banco real do motor.
import { abrirBanco } from '../src/engine/server/db.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')

const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
for (const esperada of ['instances', 'pools', 'pool_members', 'connections', 'automations', 'automation_revisions', 'automation_scopes', 'schema_migrations']) {
  check(`tabela "${esperada}" existe após migrations`, tabelas.includes(esperada))
}

check('journal_mode é WAL (ou "memory" no caso de :memory:, ambos aceitáveis)', ['wal', 'memory'].includes(db.pragma('journal_mode', { simple: true })))

// Rodar de novo (idempotência) não deve duplicar nem lançar.
let relancouSemErro = true
try { const { rodarMigrations } = await import('../src/engine/server/db.js'); rodarMigrations(db) } catch { relancouSemErro = false }
check('rodar migrations de novo no mesmo banco não lança (idempotente)', relancouSemErro)
const versoes = db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
check('cada migration só é registrada uma vez em schema_migrations', new Set(versoes).size === versoes.length)
check('migration de consultas do painel foi aplicada', versoes.includes(3))

const indices = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name))
for (const esperado of [
  'idx_automation_runs_created',
  'idx_automation_runs_automation_created',
  'idx_automation_runs_status_created',
  'idx_outbound_commands_target_status_created'
]) {
  check(`índice "${esperado}" existe após migrations`, indices.has(esperado))
}

// UNIQUE(automation_id, revision) — checa a constraint real, não só o nome da coluna.
const agora = new Date().toISOString()
db.prepare('INSERT INTO automations (id, schema_version, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('auto-1', 1, 0, agora, agora)
db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, ?, ?, ?, ?)').run('auto-1', 1, 'draft', '{}', agora)
let lancouDuplicata = false
try {
  db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, ?, ?, ?, ?)').run('auto-1', 1, 'draft', '{}', agora)
} catch { lancouDuplicata = true }
check('UNIQUE(automation_id, revision) é respeitado de verdade', lancouDuplicata)

// account_id UNIQUE em instances.
db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('wa-000001', 'zapo', 'acc-1', 'Suporte', agora, agora)
let lancouAccountIdDuplicado = false
try {
  db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('wa-000002', 'zapo', 'acc-1', 'Outro', agora, agora)
} catch { lancouAccountIdDuplicado = true }
check('account_id UNIQUE em instances é respeitado', lancouAccountIdDuplicado)

db.close()

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO BANCO DO MOTOR PASSARAM')
process.exit(falhas ? 1 : 0)
