// O documento de uma revisão publicada é lido UMA vez, não a cada evento.
//
// Antes, `avaliarEvento` fazia `JSON.parse(doc_json)` duas vezes por automação
// ligada para cada mensagem recebida (ordenação + laço). Aqui conta-se o
// `JSON.parse` de verdade, com o avaliador real e um banco real em memória.
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { reconciliar } from '../src/engine/server/agendador.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }

const AUTOMACOES = 30
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)

const documento = (id, comando, texto = 'pong') => ({
  schemaVersion: 1, id, revision: 1, name: id, enabled: true,
  scope: { include: [{ kind: 'contact', id: '5511999@s.whatsapp.net' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
  flow: {
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: comando, match: 'exact', allowFrom: 'external' } },
      { id: 'reply', type: 'action.whatsapp.reply', config: { text: texto } }
    ],
    edges: [{ from: 'trigger', to: 'reply', on: 'matched' }]
  }
})

function publicar (id, comando, texto) {
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 0, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(documento(id, comando, texto)), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'contact', '5511999@s.whatsapp.net')
  db.prepare('UPDATE automations SET active_revision_id = ?, enabled = 1 WHERE id = ?').run(rev.lastInsertRowid, id)
  return rev.lastInsertRowid
}

const evento = (n, texto) => ({
  provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:c:c:M${n}`, occurredAt: agora, replay: false,
  chat: { id: '5511999@s.whatsapp.net', kind: 'direct' },
  sender: { id: '5511999@s.whatsapp.net', authoredBySelf: false },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', remoteJid: '5511999@s.whatsapp.net', id: `M${n}` }
})

let revisaoAlvo
for (let i = 0; i < AUTOMACOES; i++) {
  const id = publicar(`a${i}`, `/c${i}`)
  if (i === 7) revisaoAlvo = id
}

const parseOriginal = JSON.parse
let parses = 0
JSON.parse = function (...args) { parses++; return parseOriginal.apply(this, args) }
const medir = (fn) => { parses = 0; fn(); return parses }

// aquecimento: cada revisão é lida uma vez
const primeiro = medir(() => avaliarEvento(db, evento(1, '/nada')))
check(`o primeiro evento lê cada revisão uma vez (${primeiro} parses para ${AUTOMACOES} automações)`, primeiro >= AUTOMACOES && primeiro < AUTOMACOES * 2)

// regime: 50 eventos sem nenhum parse de documento
let eventos = 0
const aquecido = medir(() => { for (let n = 2; n < 52; n++) { avaliarEvento(db, evento(n, '/nada')); eventos++ } })
check(`50 eventos seguintes não reparseiam documento nenhum (${aquecido} parses)`, aquecido < eventos)

// o comando continua casando e respondendo pelo documento em cache
const casou = avaliarEvento(db, evento(60, '/c7'))
const resposta = casou.results.find((r) => r.automationId === 'a7')
check('o comando casa pelo documento em cache e gera a resposta', resposta?.status === 'matched_live' && resposta.commands[0]?.payload?.text === 'pong')

// documento alterado no banco, mesmo id de revisão: é relido, não servido velho
db.prepare('UPDATE automation_revisions SET doc_json = ? WHERE id = ?').run(JSON.stringify(documento('a7', '/c7', 'mudou')), revisaoAlvo)
const novo = avaliarEvento(db, evento(61, '/c7'))
check('texto alterado na revisão é relido (o cache não serve documento velho)', novo.results.find((r) => r.automationId === 'a7')?.commands[0]?.payload?.text === 'mudou')

// despublicar tira a automação do jogo e o cache não a ressuscita
db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run('a7')
const fora = avaliarEvento(db, evento(62, '/c7'))
check('automação desligada não responde mais', !fora.results.some((r) => r.automationId === 'a7'))

// o relógio não parseia automação que não é agendada (bate a cada 15 s)
const doRelogio = medir(() => reconciliar(db))
check(`reconciliar não parseia nenhuma das ${AUTOMACOES - 1} automações comuns (${doRelogio} parses)`, doRelogio === 0)

JSON.parse = parseOriginal
console.log(`\n${checagens} CHECAGENS PASSARAM`)
process.exit(0)
