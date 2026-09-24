// Uma mensagem, uma resposta: comando explícito consome a mensagem.
//
// Isto não é hipótese — foi medido no banco de produção. No grupo, alguém
// mandou:
//
//     /dow https://www.instagram.com/p/DdXwkwWxEsq/...
//
// e DUAS automações casaram com o MESMO evento: `baixar-midia` (o comando
// /dow) e `auto-download` (a regra automática de link de mídia). As duas
// emitiram media.download da mesma URL. O bot baixou duas vezes e respondeu
// duas vezes.
//
// O at-most-once não pega isso: ele é por (evento, revisão), e são revisões
// diferentes. O que faltava era alguém ter dito quem tem precedência.
//
// A regra: quem digita um comando ENDEREÇOU o bot; `trigger.message` existe
// para a mensagem que ninguém endereçou a ele. E fica configurável, porque
// auditoria — uma regra que registra tudo que passa — é caso legítimo.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)

const base = (nome) => ({
  schemaVersion: 1,
  enabled: true,
  name: nome,
  scope: { include: [{ kind: 'everywhere' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p' }
})

// O comando /dow
const docComando = { ...base('Baixar'), flow: { nodes: [
  { id: 'g', type: 'trigger.command', config: { command: '/dow', match: 'prefix', allowFrom: 'any' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'baixando pelo comando' } }
], edges: [{ from: 'g', to: 'r', on: 'matched' }] } }

// A regra automática que reage a qualquer mensagem com link
const docAutomatico = { ...base('Auto'), flow: { nodes: [
  { id: 'g', type: 'trigger.message', config: { allowFrom: 'any', containsLink: true } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'baixando sozinho' } }
], edges: [{ from: 'g', to: 'r', on: 'matched' }] } }

// A mesma regra, mas de auditoria: quer ver tudo, comando inclusive
const docAuditoria = { ...base('Auditoria'), flow: { nodes: [
  { id: 'g', type: 'trigger.message', config: { allowFrom: 'any', containsLink: true, alsoOnCommands: true } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'anotado' } }
], edges: [{ from: 'g', to: 'r', on: 'matched' }] } }

for (const [id, doc] of [['dow', docComando], ['auto', docAutomatico], ['auditoria', docAuditoria]]) {
  servico.criarEPublicar({ id, document: doc })
  db.prepare('UPDATE automations SET deployment_mode = ? WHERE id = ?').run('live', id)
}

let n = 0
const evento = (texto) => ({
  provider: 'zapo',
  accountId: 'conta',
  eventId: `conta:g:s:m${++n}`,
  occurredAt: agora,
  replay: false,
  chat: { id: '120363101256922846@g.us', kind: 'group' },
  sender: { id: '5524999056299@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', id: `m${n}` }
})

// O grupo precisa estar autorizado, senão nada é avaliado ali.
db.prepare('INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', '120363101256922846@g.us', 'grupo_ativo', '"sim"', agora)

const LINK = 'https://www.instagram.com/p/DdXwkwWxEsq/'
const de = (r, id) => (r.results || []).find((x) => x.automationId === id)
const casou = (r, id) => de(r, id)?.status === 'matched_live'

// --- o caso exato que duplicou em produção --------------------------------
{
  const r = avaliarEvento(db, evento(`/dow ${LINK}`))
  check('o comando /dow casa', casou(r, 'dow'), JSON.stringify(de(r, 'dow')))
  check('e a regra automática CEDE — nada de baixar duas vezes', !casou(r, 'auto'),
    JSON.stringify(de(r, 'auto')))

  // Contar só as DUAS que disputam o download: a de auditoria responde de
  // propósito, porque pediu para ver tudo, e incluí-la aqui mediria outra coisa.
  const baixadas = (r.results || [])
    .filter((x) => x.automationId === 'dow' || x.automationId === 'auto')
    .flatMap((x) => x.commands || [])
  check('uma mensagem, UM download — era isto que duplicava', baixadas.length === 1,
    `${baixadas.length}: ${baixadas.map((c) => c.payload.text).join(' + ')}`)
}

// --- mas link solto continua sendo baixado sozinho ------------------------
{
  const r = avaliarEvento(db, evento(`olha isso ${LINK}`))
  check('link sem comando continua acionando a regra automática', casou(r, 'auto'))
  check('e o comando não casa com mensagem que não é comando', !casou(r, 'dow'))
}

// --- quem PEDE para ver tudo continua vendo -------------------------------
{
  const r = avaliarEvento(db, evento(`/dow ${LINK}`))
  check('a regra de auditoria (alsoOnCommands) casa mesmo com o comando',
    casou(r, 'auditoria'), JSON.stringify(de(r, 'auditoria')))
  check('e a regra comum continua cedendo, na mesma avaliação', !casou(r, 'auto'))
}

// --- comando que não casa não consome nada --------------------------------
{
  const r = avaliarEvento(db, evento(`/naoexiste ${LINK}`))
  check('comando inexistente não consome: a regra automática ainda vale', casou(r, 'auto'),
    JSON.stringify(de(r, 'auto')))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE PRECEDÊNCIA DE COMANDO PASSARAM')
process.exit(falhas ? 1 : 0)
