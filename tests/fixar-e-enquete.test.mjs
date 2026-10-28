// Fixar mensagem e abrir enquete — as duas últimas ações do bot antigo.
//
// Elas entram com teste porque eu já errei sobre elas no plano: escrevi que
// "só dependiam de autorização" depois de ver WaSendPinMessage e
// WaSendPollMessage na biblioteca. A biblioteca saber ENVIAR não é a
// linguagem saber PEDIR — foram as nove camadas de sempre, cada uma.
//
// O que estes casos guardam é o que some sem ninguém ver: a duração do fixo
// (sem ela o aparelho descarta o fixo em silêncio), a recusa de fixar sem
// citação, e a divisão das opções da enquete.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000055@g.us'
const PESSOA = '5511900000888@s.whatsapp.net'
const OUTRA = '5511900000999@s.whatsapp.net'

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', GRUPO, 'grupo_ativo', '"sim"', agora)

function publicar (id, nos, arestas) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: { nodes: nos, edges: arestas }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function evento (texto, { citadoDe = null } = {}) {
  n++
  const ev = {
    provider: 'zapo', accountId: 'conta', eventId: `conta:${GRUPO}:${PESSOA}:f${n}`,
    occurredAt: agora, replay: false,
    chat: { id: GRUPO, kind: 'group' },
    sender: { id: PESSOA, authoredBySelf: false, authoredByBot: false, name: 'Quem', isAdmin: true },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', id: `f${n}`, remoteJid: GRUPO }
  }
  if (citadoDe) ev.message.quotedRef = { provider: 'zapo', id: 'q1', participant: citadoDe }
  return ev
}

function rodar (id, ev) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  return (avaliarEvento(db, ev).results || []).find((x) => x.automationId === id)
}

const gatilho = (cmd) => ({ id: 'g', type: 'trigger.command', config: { command: cmd, match: 'exact_or_args', allowFrom: 'any' } })

// =========================================================================
// 1. FIXAR — sai com duração, SEMPRE
// =========================================================================
// Sem `durationSecs` o aparelho que recebe descarta o fixo e ninguém fica
// sabendo: nada falha, nada aparece no histórico, e a mensagem não fica
// fixada. É a pegadinha documentada na própria biblioteca.
publicar('fixa', [
  gatilho('/fixar'),
  { id: 'p', type: 'action.whatsapp.pin', config: { action: 'pin', durationSecs: 604800, notFoundText: 'responda alguma coisa' } }
], [{ from: 'g', to: 'p', on: 'matched' }])

{
  const r = rodar('fixa', evento('/fixar', { citadoDe: OUTRA }))
  const cmd = r?.commands?.[0]
  check('respondendo alguém, sai whatsapp.pin', cmd?.commandType === 'whatsapp.pin', String(cmd?.commandType))
  check('com a ação de fixar', cmd?.payload?.acao === 'pin', String(cmd?.payload?.acao))
  check('e a duração vai junto', cmd?.payload?.duracaoSegundos === 604800, String(cmd?.payload?.duracaoSegundos))
  check('apontando para a mensagem respondida', !!cmd?.payload?.alvo, JSON.stringify(cmd?.payload?.alvo))
}

// =========================================================================
// 2. FIXAR SEM CITAÇÃO — avisa, não fica mudo
// =========================================================================
{
  const r = rodar('fixa', evento('/fixar'))
  const cmd = r?.commands?.[0]
  check('sem responder nada, não tenta fixar', cmd?.commandType !== 'whatsapp.pin', String(cmd?.commandType))
  check('e responde o aviso em vez de calar', cmd?.payload?.text === 'responda alguma coisa', cmd?.payload?.text)
}

// =========================================================================
// 3. O PADRÃO DA DURAÇÃO existe, e é o do próprio WhatsApp
// =========================================================================
publicar('fixa-sem-duracao', [
  gatilho('/fixar2'),
  { id: 'p', type: 'action.whatsapp.pin', config: { action: 'pin' } }
], [{ from: 'g', to: 'p', on: 'matched' }])

{
  const r = rodar('fixa-sem-duracao', evento('/fixar2', { citadoDe: OUTRA }))
  check('sem duração escrita, o motor põe 24 horas',
    r?.commands?.[0]?.payload?.duracaoSegundos === 86400, String(r?.commands?.[0]?.payload?.duracaoSegundos))
}

// =========================================================================
// 4. ENQUETE — as opções são divididas num lugar só, o motor
// =========================================================================
publicar('voto', [
  gatilho('/enquete'),
  { id: 'q', type: 'action.whatsapp.poll', config: { question: 'Que dia?', options: 'Segunda; Terça ; Quarta', selectableCount: 1 } }
], [{ from: 'g', to: 'q', on: 'matched' }])

{
  const r = rodar('voto', evento('/enquete'))
  const cmd = r?.commands?.[0]
  check('sai whatsapp.poll', cmd?.commandType === 'whatsapp.poll', String(cmd?.commandType))
  check('a pergunta vai inteira', cmd?.payload?.pergunta === 'Que dia?', cmd?.payload?.pergunta)
  check('as opções viram lista, sem espaço sobrando',
    JSON.stringify(cmd?.payload?.opcoes) === JSON.stringify(['Segunda', 'Terça', 'Quarta']), JSON.stringify(cmd?.payload?.opcoes))
}

// =========================================================================
// 5. ENQUETE DE UMA OPÇÃO SÓ NÃO É PERGUNTA — e isso tem que doer
// =========================================================================
publicar('voto-torto', [
  gatilho('/enquete2'),
  { id: 'q', type: 'action.whatsapp.poll', config: { question: 'E aí?', options: 'Só isso' } }
], [{ from: 'g', to: 'q', on: 'matched' }])

{
  const r = rodar('voto-torto', evento('/enquete2'))
  check('uma opção só vira erro registrado', r?.status === 'error', String(r?.status))
  check('e nada é enviado', (r?.commands || []).length === 0, JSON.stringify(r?.commands))
}

// =========================================================================
// 6. NÃO DÁ PARA MARCAR MAIS OPÇÕES DO QUE EXISTEM
// =========================================================================
// O WhatsApp aceita o envio e a enquete sai quebrada no aparelho — falha que
// não volta como erro, só como gente reclamando.
publicar('voto-demais', [
  gatilho('/enquete3'),
  { id: 'q', type: 'action.whatsapp.poll', config: { question: 'Quais?', options: 'A; B', selectableCount: 9 } }
], [{ from: 'g', to: 'q', on: 'matched' }])

{
  const r = rodar('voto-demais', evento('/enquete3'))
  check('o quanto dá para marcar é limitado ao número de opções',
    r?.commands?.[0]?.payload?.quantasMarcar === 2, String(r?.commands?.[0]?.payload?.quantasMarcar))
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE FIXAR E ENQUETE PASSARAM')
process.exit(falhas ? 1 : 0)
