// Gerência de grupo: /ban, /mute, /unmute — e os dois defeitos que o dono
// relatou ao vivo no /x9 e no /recover.
//
// OS DOIS DEFEITOS, nas palavras dele: "em grupos pegam o id do grupo como se
// fosse número wa.me de alguém, e no pv ele marca o próprio user". São causas
// DIFERENTES que produzem a mesma impressão de "está nomeando a pessoa errada":
//
//  1. O adaptador caía no remoteJid quando a chave de grupo não trazia
//     participant — e em grupo o remoteJid é o GRUPO. Um endereço de conversa
//     virava o telefone de uma pessoa.
//  2. A legenda falava de {{sender.*}}, que num COMANDO é quem digitou, não
//     quem mandou a mídia recuperada. No pv isso é sempre a própria pessoa.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import * as diretorio from '../src/directory.js'
import { construirEventoDeMensagem } from '../src/engine/zapoAdapter.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// O adaptador escreve no diretório de contatos: pasta própria, nunca o data/
// do checkout.
const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-grupo-'))
diretorio._usarPastaParaTeste(pastaTeste)

const GRUPO = '120363000000000009@g.us'
const PESSOA = '5511900000123@s.whatsapp.net'
const OUTRA = '5511900000456@s.whatsapp.net'

// =========================================================================
// 1. O remetente de uma mensagem de grupo NUNCA é o grupo
// =========================================================================
function eventoZapo (key, message = { conversation: 'oi' }) {
  return construirEventoDeMensagem({ key, message, timestampSeconds: 1700000000 },
    { accountId: 'conta', recebidoEmMs: 1, botId: '5511900000777@s.whatsapp.net' })
}

{
  const ev = eventoZapo({ remoteJid: GRUPO, id: 'm1', fromMe: false, isGroup: true, participant: PESSOA })
  check('em grupo, quem escreveu é o participant', ev.sender.id === PESSOA, ev.sender.id)
  check('e a conversa continua sendo o grupo', ev.chat.id === GRUPO && ev.chat.kind === 'group')
}
{
  // O caso do defeito: chave de grupo SEM participant.
  const ev = eventoZapo({ remoteJid: GRUPO, id: 'm2', fromMe: true, isGroup: true })
  check('sem participant, o grupo NÃO vira a pessoa', ev.sender.id !== GRUPO, ev.sender.id)
  check('fica sem autor conhecido, que é o honesto', ev.sender.id === undefined, String(ev.sender.id))
}
{
  // Conversa direta não muda: ali o remoteJid É a pessoa.
  const ev = eventoZapo({ remoteJid: PESSOA, id: 'm3', fromMe: false, isGroup: false })
  check('em conversa direta o remoteJid continua sendo a pessoa', ev.sender.id === PESSOA, ev.sender.id)
}
{
  const ev = eventoZapo({ remoteJid: GRUPO, id: 'm4', fromMe: false, isGroup: true, participant: '999@lid', participantAlt: PESSOA })
  check('o formato de telefone ganha do LID cru', ev.sender.id === PESSOA, ev.sender.id)
}

// =========================================================================
// 2. A legenda do /x9 nomeia quem MANDOU a mídia, não quem digitou
// =========================================================================
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', GRUPO, 'grupo_ativo', '"sim"', agora)

function publicar (id, doc, escopo = { kind: 'group', ref: GRUPO }) {
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', escopo.kind, escopo.ref)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function evento ({ texto, chat = GRUPO, kind = 'group', de = PESSOA, citadoDe = null, visuCitada = false } = {}) {
  n++
  const ev = {
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:${chat}:${de}:g${n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: chat, kind },
    sender: { id: de, authoredBySelf: false, authoredByBot: false, name: 'Quem Digitou' },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', id: `g${n}`, remoteJid: chat }
  }
  if (citadoDe) ev.message.quotedRef = { id: 'q1', participant: citadoDe }
  if (visuCitada) ev.message.quotedMediaRef = { token: 'TOKEN-OPACO', kind: 'view_once', mediaKind: 'image' }
  return ev
}

function rodar (id, ev) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  return (avaliarEvento(db, ev).results || []).find((x) => x.automationId === id)
}

const LEGENDA = '👁 De: wa.me/{{quoted.number}}'

publicar('x9', {
  schemaVersion: 1, id: 'x9', revision: 1, name: 'X9', enabled: true,
  scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: '/x9', match: 'exact_or_args', allowFrom: 'any' } },
      { id: 'rec', type: 'action.whatsapp.recover', config: { destination: 'same_chat', caption: LEGENDA, notFoundText: 'sem mídia' } }
    ],
    edges: [{ from: 'g', to: 'rec', on: 'matched' }]
  }
})

{
  // PESSOA digita /x9 respondendo a visu única que OUTRA mandou.
  const r = rodar('x9', evento({ texto: '/x9', de: PESSOA, citadoDe: OUTRA, visuCitada: true }))
  const legenda = r.commands[0]?.payload?.caption || ''
  check('a legenda nomeia quem MANDOU a mídia', legenda.includes('5511900000456'), legenda)
  check('e não quem digitou o comando', !legenda.includes('5511900000123'), legenda)
  // O id do grupo na legenda é o sintoma relatado — ele não pode aparecer de
  // jeito nenhum, nem por sender nem por chat.
  check('o id do grupo não aparece como se fosse telefone', !legenda.includes('120363'), legenda)
}

// =========================================================================
// 3. /ban sem marcar ninguém RESPONDE, em vez de ficar mudo
// =========================================================================
function docBan (id, notFoundText) {
  return {
    schemaVersion: 1, id, revision: 1, name: 'Ban', enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/ban', match: 'exact_or_args', allowFrom: 'any' } },
        { id: 'rm', type: 'action.group.remove', config: { who: 'target', neverRemoveOwner: true, ...(notFoundText ? { notFoundText } : {}) } }
      ],
      edges: [{ from: 'g', to: 'rm', on: 'matched' }]
    }
  }
}

publicar('ban-avisa', docBan('ban-avisa', 'Marque alguém com @ — sem isso não sei quem remover.'))
publicar('ban-mudo', docBan('ban-mudo', null))

{
  const r = rodar('ban-avisa', evento({ texto: '/ban' }))
  check('sem alvo, responde o aviso em vez de remover',
    r.commands.length === 1 && r.commands[0].commandType === 'whatsapp.reply',
    JSON.stringify(r.commands.map((c) => c.commandType)))
  check('e o aviso é o texto declarado', r.commands[0].payload.text.startsWith('Marque alguém'))
}
{
  // Sem o texto declarado, o comportamento de antes continua: erro registrado
  // e nada enviado. É pior, e é por isso que o template traz o aviso pronto.
  const r = rodar('ban-mudo', evento({ texto: '/ban' }))
  check('sem o texto declarado, continua sendo erro registrado', r.status === 'error', r.status)
  check('e o WhatsApp não recebe nada', r.commands.length === 0, JSON.stringify(r.commands))
}
{
  const r = rodar('ban-avisa', evento({ texto: '/ban', citadoDe: OUTRA }))
  check('respondendo alguém, remove essa pessoa',
    r.commands[0]?.commandType === 'group.remove' && r.commands[0]?.payload.participantId === OUTRA,
    JSON.stringify(r.commands[0]?.payload))
}

// =========================================================================
// 4. A família do /mute: a chave tem que bater nos TRÊS arquivos
// =========================================================================
//
// Este é o caso que mais importa aqui. /mute grava em `target_group_member`,
// a regra lê em `group_member`, e /unmute limpa — três arquivos, UMA chave. Se
// um deles divergir, o comando confirma "silenciado" e nada é apagado: falha
// sem erro nenhum, que é a classe de defeito mais cara desta base.
{
  const catalogo = carregarCatalogo()
  const acharNo = (id, tipo) => {
    const t = catalogo.get(id)
    return t?.documentTemplate?.flow?.nodes?.find((no) => no.type === tipo)
  }
  const mute = acharNo('silenciar', 'action.variable.set')
  const unmute = acharNo('dessilenciar', 'action.variable.set')
  const regra = acharNo('anti-silenciado', 'condition.compare')

  check('os três templates existem no catálogo', !!mute && !!unmute && !!regra)
  check('/mute grava no membro MARCADO, não em quem digitou', mute?.config.scope === 'target_group_member', mute?.config.scope)
  check('/unmute mexe no mesmo escopo', unmute?.config.scope === 'target_group_member', unmute?.config.scope)
  check('a regra lê no membro de quem está FALANDO', regra?.config.left.scope === 'group_member', regra?.config.left.scope)
  check('a chave é a MESMA nos três', mute?.config.key === regra?.config.left.key && unmute?.config.key === regra?.config.left.key,
    `${mute?.config.key} / ${unmute?.config.key} / ${regra?.config.left.key}`)
  check('o valor que a regra procura é o que o /mute grava', mute?.config.value === regra?.config.right.value,
    `grava "${mute?.config.value}", procura "${regra?.config.right.value}"`)
  check('o /unmute limpa a marca, não grava outra palavra', unmute?.config.value === '', JSON.stringify(unmute?.config.value))
  check('a regra apaga a mensagem', !!acharNo('anti-silenciado', 'action.whatsapp.delete'))
}

// --- e o par funcionando de ponta a ponta --------------------------------
publicar('mute', {
  schemaVersion: 1, id: 'mute', revision: 1, name: 'Mute', enabled: true,
  scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: '/mute', match: 'exact_or_args', allowFrom: 'any' } },
      { id: 'marca', type: 'action.variable.set', config: { scope: 'target_group_member', key: 'silenciado', value: 'sim' } }
    ],
    edges: [{ from: 'g', to: 'marca', on: 'matched' }]
  }
})
publicar('anti-silenciado', {
  schemaVersion: 1, id: 'anti-silenciado', revision: 1, name: 'Anti-silenciado', enabled: true,
  scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', messageKinds: ['text'] } },
      { id: 'checa', type: 'condition.compare', config: { left: { source: 'variable', scope: 'group_member', key: 'silenciado' }, operator: 'eq', right: { source: 'literal', value: 'sim' } } },
      { id: 'apaga', type: 'action.whatsapp.delete', config: {} }
    ],
    edges: [{ from: 'g', to: 'checa', on: 'matched' }, { from: 'checa', to: 'apaga', on: 'true' }]
  }
})

{
  const antes = rodar('anti-silenciado', evento({ texto: 'falando antes', de: OUTRA }))
  check('antes do /mute, a mensagem passa', (antes?.commands || []).length === 0, JSON.stringify(antes?.commands))

  rodar('mute', evento({ texto: '/mute', de: PESSOA, citadoDe: OUTRA }))

  const depois = rodar('anti-silenciado', evento({ texto: 'falando depois', de: OUTRA }))
  check('depois do /mute, a mensagem dela é apagada',
    depois?.commands[0]?.commandType === 'whatsapp.delete', JSON.stringify(depois?.commands))

  const terceiro = rodar('anti-silenciado', evento({ texto: 'eu não fui silenciado', de: PESSOA }))
  check('e a marca é por pessoa: quem silenciou continua falando',
    (terceiro?.commands || []).length === 0, JSON.stringify(terceiro?.commands))
}

db.close()
fs.rmSync(pastaTeste, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE GERÊNCIA DE GRUPO PASSARAM')
process.exit(falhas ? 1 : 0)
