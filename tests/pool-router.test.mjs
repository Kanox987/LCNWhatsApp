// Testes para roteamento ponderado por pool (weighted_rendezvous).
// Banco :memory: — nunca o banco real do motor.
import { abrirBanco } from '../src/engine/server/db.js'
import { selecionarInstanciaDoPool } from '../src/engine/server/poolRouter.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()

// Seed: pools e instâncias
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p-test', 'Pool teste', agora, agora)
db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('i-1', 'zapo', 'acc-pool-1', 'Inst 1', agora, agora)
db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('i-2', 'zapo', 'acc-pool-2', 'Inst 2', agora, agora)
db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('i-3', 'zapo', 'acc-pool-3', 'Inst 3', agora, agora)

// --- Teste 1: membro único retorna determinístico ---
db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?, ?, ?, ?)').run('p-single', 'i-1', 1.0, 1)
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p-single', 'Single', agora, agora)
// Re-seed i-1 into p-single (already inserted above but for different pool)
db.prepare('DELETE FROM pool_members WHERE pool_id = ?').run('p-single')
db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?, ?, ?, ?)').run('p-single', 'i-1', 5.0, 1)
const r1 = selecionarInstanciaDoPool(db, 'p-single')
check('membro único: retorna account_id correto', r1 === 'acc-pool-1')
const r1b = selecionarInstanciaDoPool(db, 'p-single')
check('membro único: determinístico em chamadas repetidas', r1b === 'acc-pool-1')

// --- Teste 2: distribuição ponderada 25%/75% ---
db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?, ?, ?, ?)').run('p-test', 'i-1', 1.0, 1)
db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?, ?, ?, ?)').run('p-test', 'i-2', 3.0, 1)
const contagem = { 'acc-pool-1': 0, 'acc-pool-2': 0 }
const N = 4000
for (let i = 0; i < N; i++) {
  const escolhido = selecionarInstanciaDoPool(db, 'p-test')
  if (escolhido) contagem[escolhido]++
}
const pct1 = contagem['acc-pool-1'] / N
const pct2 = contagem['acc-pool-2'] / N
check(`distribuição ~25%/75%: acc-pool-1=${(pct1*100).toFixed(1)}% (esperado ~25%)`, Math.abs(pct1 - 0.25) < 0.05)
check(`distribuição ~25%/75%: acc-pool-2=${(pct2*100).toFixed(1)}% (esperado ~75%)`, Math.abs(pct2 - 0.75) < 0.05)

// --- Teste 3: todos desabilitados retorna null ---
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p-disabled', 'Disabled', agora, agora)
db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?, ?, ?, ?)').run('p-disabled', 'i-1', 1.0, 0)
db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?, ?, ?, ?)').run('p-disabled', 'i-2', 1.0, 0)
const r3 = selecionarInstanciaDoPool(db, 'p-disabled')
check('todos desabilitados: retorna null', r3 === null)

// --- Teste 4: pool vazio retorna null ---
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p-empty', 'Empty', agora, agora)
const r4 = selecionarInstanciaDoPool(db, 'p-empty')
check('pool vazio: retorna null', r4 === null)

// --- Teste 5: poolId inexistente retorna null ---
const r5 = selecionarInstanciaDoPool(db, 'p-nao-existe')
check('poolId inexistente: retorna null', r5 === null)

// --- Teste 6: integração com avaliador ---
// Criar automação live com weighted_rendezvous apontando para p-test
const doc = {
  schemaVersion: 1, id: 'auto-pool', revision: 1, name: 'auto-pool', enabled: true,
  scope: { include: [{ kind: 'contact', id: '5511888@s.whatsapp.net' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p-test' },
  flow: {
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: '/pool', match: 'exact', allowFrom: 'external' } },
      { id: 'reply', type: 'action.whatsapp.reply', config: { text: 'routed' } }
    ],
    edges: [{ from: 'trigger', to: 'reply', on: 'matched' }]
  }
}
db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
  .run('auto-pool', 'live', agora, agora)
const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
  .run('auto-pool', 'active', JSON.stringify(doc), agora)
db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
  .run(rev.lastInsertRowid, 'include', 'contact', '5511888@s.whatsapp.net')
db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, 'auto-pool')

const evento = {
  provider: 'zapo', accountId: 'acc-original', eventId: 'acc-original:5511888@s.whatsapp.net:5511888@s.whatsapp.net:POOL1',
  occurredAt: agora, replay: false,
  chat: { id: '5511888@s.whatsapp.net', kind: 'direct' },
  sender: { id: '5511888@s.whatsapp.net', authoredBySelf: false },
  message: { kind: 'text', text: '/pool' },
  providerRef: { provider: 'zapo', remoteJid: '5511888@s.whatsapp.net', id: 'POOL1' }
}

const resultado = avaliarEvento(db, evento)
const run = resultado.results.find((r) => r.automationId === 'auto-pool')
check('integração: automação casou como matched_live', run?.status === 'matched_live')
check('integração: gerou exatamente 1 comando', run?.commands.length === 1)
const targetId = run?.commands[0]?.targetAccountId
const membrosPool = ['acc-pool-1', 'acc-pool-2']
check('integração: target_account_id é membro do pool (não acc-original)', membrosPool.includes(targetId))
check('integração: target_account_id NÃO é o accountId do evento', targetId !== 'acc-original')

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) falhou/falharam.`)
process.exit(falhas === 0 ? 0 : 1)