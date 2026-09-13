// Donos do bot — comandos restritos e a variável {{sender.isOwner}}.
//
// Caso de uso que motivou: um número de empresa rodando o bot, com o contato
// PESSOAL do responsável marcado como dono, para ele configurar tudo mandando
// mensagem de fora, sem estar com o aparelho da empresa.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { definirDono, ehDono, existeAlgumDono, podeUsarComandoRestrito, semDonoCadastrado } from '../src/engine/server/owners.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

const EMPRESA = '5511900000000@s.whatsapp.net'
const PESSOAL = '5511911111111@s.whatsapp.net'
const ESTRANHO = '5511922222222@s.whatsapp.net'

function publicar (id, requireOwner, texto = 'ok') {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'contact', id: EMPRESA }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: `/${id}`, match: 'exact', allowFrom: 'external', ...(requireOwner ? { requireOwner: true } : {}) } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: texto } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'contact', EMPRESA)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function evento (senderId, texto, { proprioNumero = false } = {}) {
  n++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${EMPRESA}:${senderId}:m${n}`,
    occurredAt: agora, replay: false,
    chat: { id: EMPRESA, kind: 'direct' },
    sender: { id: senderId, authoredBySelf: proprioNumero },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: EMPRESA, id: `m${n}` }
  }
}
const statusDe = (r, id) => r.results.find((x) => x.automationId === id)?.status
const respostaDe = (r, id) => r.results.find((x) => x.automationId === id)?.commands?.[0]?.payload?.text

// --- instalação nova: sem dono nenhum, restrito ainda responde ------------
publicar('restrito', true)
check('instalação nova não tem dono', existeAlgumDono(db) === false)
check('instalação nova é reconhecida como "sem dono cadastrado"', semDonoCadastrado(db) === true)
// A regra que importa: sem dono cadastrado o comando restrito NÃO fica aberto
// a qualquer um — só o próprio número do bot alcança, que é quem legitimamente
// cadastra o primeiro dono.
check('sem dono: um estranho NÃO usa comando restrito', statusDe(avaliarEvento(db, evento(ESTRANHO, '/restrito')), 'restrito') === 'no_match')
check('sem dono: o PRÓPRIO número usa o comando restrito (é assim que se cadastra o 1º dono)', statusDe(avaliarEvento(db, evento(EMPRESA, '/restrito', { proprioNumero: true })), 'restrito') === 'matched_live')

// --- depois do primeiro dono, a lista passa a valer -----------------------
definirDono(db, PESSOAL, true)
check('contato pessoal virou dono', ehDono(db, PESSOAL) === true)
check('deixou de estar sem dono cadastrado', semDonoCadastrado(db) === false)
check('o dono usa o comando restrito', statusDe(avaliarEvento(db, evento(PESSOAL, '/restrito')), 'restrito') === 'matched_live')
check('um estranho NÃO usa mais o comando restrito', statusDe(avaliarEvento(db, evento(ESTRANHO, '/restrito')), 'restrito') === 'no_match')
check('estranho sem permissão não gera comando nenhum', respostaDe(avaliarEvento(db, evento(ESTRANHO, '/restrito')), 'restrito') === undefined)

// --- comando aberto continua aberto para todos ----------------------------
publicar('aberto', false)
check('comando sem requireOwner responde a qualquer um', statusDe(avaliarEvento(db, evento(ESTRANHO, '/aberto')), 'aberto') === 'matched_live')

// --- remover todos os donos NÃO reabre a instalação -----------------------
definirDono(db, PESSOAL, false)
check('dono removido deixa de ser dono', ehDono(db, PESSOAL) === false)
check('remover todos os donos não reabre o acesso a estranhos', semDonoCadastrado(db) === false)
check('sem nenhum dono, estranho continua sem acesso', podeUsarComandoRestrito(db, ESTRANHO) === false)
check('o próprio número nunca perde o acesso administrativo', podeUsarComandoRestrito(db, EMPRESA, { souEuMesmo: true }) === true)

// --- {{sender.isOwner}} como variável e como condição ---------------------
definirDono(db, PESSOAL, true)
publicar('quemsou', false, 'dono={{sender.isOwner}}')
check('{{sender.isOwner}} vira true para o dono', respostaDe(avaliarEvento(db, evento(PESSOAL, '/quemsou')), 'quemsou') === 'dono=true')
check('{{sender.isOwner}} vira false para os outros', respostaDe(avaliarEvento(db, evento(ESTRANHO, '/quemsou')), 'quemsou') === 'dono=false')

const docCondicional = {
  schemaVersion: 1, id: 'ramifica', revision: 1, name: 'ramifica', enabled: true,
  scope: { include: [{ kind: 'contact', id: EMPRESA }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: '/ramifica', match: 'exact', allowFrom: 'external' } },
      { id: 'c', type: 'condition.compare', config: { left: { source: 'event', field: 'sender.isOwner' }, operator: 'eq', right: { source: 'literal', value: true } } },
      { id: 'sim', type: 'action.whatsapp.reply', config: { text: 'painel do dono' } },
      { id: 'nao', type: 'action.whatsapp.reply', config: { text: 'menu comum' } }
    ],
    edges: [
      { from: 'g', to: 'c', on: 'matched' },
      { from: 'c', to: 'sim', on: 'true' },
      { from: 'c', to: 'nao', on: 'false' }
    ]
  }
}
db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run('ramifica', 'live', agora, agora)
const revR = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run('ramifica', 'active', JSON.stringify(docCondicional), agora)
db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(revR.lastInsertRowid, 'include', 'contact', EMPRESA)
db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(revR.lastInsertRowid, 'ramifica')

check('condição por dono: o dono vê o painel dele', respostaDe(avaliarEvento(db, evento(PESSOAL, '/ramifica')), 'ramifica') === 'painel do dono')
check('condição por dono: os outros veem o menu comum', respostaDe(avaliarEvento(db, evento(ESTRANHO, '/ramifica')), 'ramifica') === 'menu comum')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE DONO PASSARAM')
process.exit(falhas ? 1 : 0)
