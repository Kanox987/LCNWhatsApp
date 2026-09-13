// Gatilho sem comando (trigger.message) + ações destrutivas.
//
// O caso completo que o usuário descreveu: "ao detectar link, apaga e dá
// bronca; na 3a vez, remove do grupo" — com o número de broncas configurável.
// É o desenho do anti-link dos bots de referência, mas com a política nas
// mãos de quem instala em vez de fixa no código.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento, contemLink } from '../src/engine/server/evaluator.js'
import { definirDono } from '../src/engine/server/owners.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

const GRUPO = '120000000000000009@g.us'
const PESSOA = '5511900000123@s.whatsapp.net'
const DONO = '5511900000999@s.whatsapp.net'

// --- detector de link: os falsos-positivos clássicos ----------------------
check('detecta link com http', contemLink('olha isso https://exemplo.com/x'))
check('detecta link com www', contemLink('acessa www.exemplo.com'))
check('detecta domínio sem esquema', contemLink('entra no exemplo.com.br agora'))
check('reticências NÃO são link', contemLink('sei lá... acho que não') === false)
check('número decimal NÃO é link', contemLink('custou 3.50 reais') === false)
check('frase comum NÃO é link', contemLink('bom dia pessoal, tudo certo?') === false)
check('texto vazio não quebra o detector', contemLink('') === false && contemLink(null) === false)

function publicar (id, doc) {
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

// Anti-link com política de 3 broncas antes de remover.
publicar('antilink', {
  schemaVersion: 1, id: 'antilink', revision: 1, name: 'Anti-link', enabled: true,
  scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', messageKinds: ['text'], containsLink: true } },
      { id: 'apaga', type: 'action.whatsapp.delete', config: {} },
      { id: 'conta', type: 'action.variable.increment', config: { scope: 'group_member', key: 'links', by: 1 } },
      { id: 'checa', type: 'condition.compare', config: { left: { source: 'variable', scope: 'group_member', key: 'links' }, operator: 'gte', right: { source: 'literal', value: 3 } } },
      { id: 'remove', type: 'action.group.remove', config: { who: 'sender' } },
      { id: 'avisa', type: 'action.whatsapp.reply', config: { text: 'Link não é permitido aqui. Aviso {{var.member.links}} de 3.' } }
    ],
    edges: [
      { from: 'g', to: 'apaga', on: 'matched' },
      { from: 'apaga', to: 'conta', on: 'success' },
      { from: 'conta', to: 'checa', on: 'success' },
      { from: 'checa', to: 'remove', on: 'true' },
      { from: 'checa', to: 'avisa', on: 'false' }
    ]
  }
})

let n = 0
function evento (texto, { senderId = PESSOA, chatId = GRUPO, kind = 'text', proprio = false } = {}) {
  n++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${chatId}:${senderId}:m${n}`,
    occurredAt: agora, replay: false,
    chat: { id: chatId, kind: chatId.endsWith('@g.us') ? 'group' : 'direct' },
    sender: { id: senderId, authoredBySelf: proprio },
    message: { kind, text: texto },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: `m${n}`, participant: senderId, fromMe: proprio }
  }
}
const res = (r) => r.results.find((x) => x.automationId === 'antilink')
const tipos = (r) => (res(r)?.commands || []).map((c) => c.commandType)

// --- o gatilho dispara sem comando nenhum ---------------------------------
const semLink = avaliarEvento(db, evento('bom dia pessoal'))
check('mensagem comum não aciona o anti-link', res(semLink)?.status === 'no_match')

const primeiro = avaliarEvento(db, evento('olha https://spam.com'))
check('mensagem com link aciona SEM precisar de comando', res(primeiro)?.status === 'matched_live')
check('1ª vez: apaga a mensagem e avisa', tipos(primeiro).join(',') === 'whatsapp.delete,whatsapp.reply', tipos(primeiro).join(','))
check('1ª vez: NÃO remove ninguém', !tipos(primeiro).includes('group.remove'))
check('o aviso mostra o contador', res(primeiro).commands[1].payload.text === 'Link não é permitido aqui. Aviso 1 de 3.')

avaliarEvento(db, evento('de novo www.spam.com'))
const terceiro = avaliarEvento(db, evento('e mais um spam.com.br'))
check('3ª vez: apaga E remove do grupo', tipos(terceiro).join(',') === 'whatsapp.delete,group.remove', tipos(terceiro).join(','))
check('a remoção mira quem mandou o link', res(terceiro).commands[1].payload.participantId === PESSOA)

// --- barreiras não configuráveis ------------------------------------------
const propria = avaliarEvento(db, evento('link do bot https://exemplo.com', { proprio: true }))
check('o bot NUNCA reage à própria mensagem (barreira não desligável)', res(propria)?.status === 'no_match')

// --- a trava do dono ------------------------------------------------------
definirDono(db, DONO, true)
avaliarEvento(db, evento('https://a.com', { senderId: DONO }))
avaliarEvento(db, evento('https://b.com', { senderId: DONO }))
const donoTerceiro = avaliarEvento(db, evento('https://c.com', { senderId: DONO }))
check('o dono também tem a mensagem apagada (a regra vale para todos)', tipos(donoTerceiro).includes('whatsapp.delete'))
check('mas o dono NUNCA é removido do grupo', !tipos(donoTerceiro).includes('group.remove'), tipos(donoTerceiro).join(','))

// --- filtro por tipo de mídia (anti-imagem, anti-áudio) -------------------
publicar('antifoto', {
  schemaVersion: 1, id: 'antifoto', revision: 1, name: 'Anti-imagem', enabled: true,
  scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['image', 'video'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', messageKinds: ['image'] } },
      { id: 'apaga', type: 'action.whatsapp.delete', config: {} }
    ],
    edges: [{ from: 'g', to: 'apaga', on: 'matched' }]
  }
})
const comFoto = avaliarEvento(db, evento(undefined, { kind: 'image' }))
check('anti-imagem dispara em foto', comFoto.results.find((x) => x.automationId === 'antifoto')?.status === 'matched_live')
const comVideo = avaliarEvento(db, evento(undefined, { kind: 'video' }))
check('anti-imagem NÃO dispara em vídeo (filtro por tipo funciona)', comVideo.results.find((x) => x.automationId === 'antifoto')?.status === 'no_match')

// --- filtro por palavra ---------------------------------------------------
publicar('palavrao', {
  schemaVersion: 1, id: 'palavrao', revision: 1, name: 'Filtro de palavra', enabled: true,
  scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', keywords: ['promoção', 'ganhe agora'] } },
      { id: 'apaga', type: 'action.whatsapp.delete', config: {} }
    ],
    edges: [{ from: 'g', to: 'apaga', on: 'matched' }]
  }
})
const comPalavra = avaliarEvento(db, evento('olha essa PROMOÇÃO imperdível'))
check('filtro de palavra pega sem diferenciar maiúscula', comPalavra.results.find((x) => x.automationId === 'palavrao')?.status === 'matched_live')
const semPalavra = avaliarEvento(db, evento('conversa normal aqui'))
check('filtro de palavra não pega mensagem comum', semPalavra.results.find((x) => x.automationId === 'palavrao')?.status === 'no_match')

// --- lado do gateway -------------------------------------------------------
function clienteFake (falhaRemocao) {
  const enviados = []
  const removidos = []
  return {
    enviados,
    removidos,
    message: { send: async (jid, c) => { enviados.push({ jid, conteudo: c }); return { ok: true } } },
    group: {
      removeParticipants: async (jid, ids) => {
        removidos.push({ jid, ids })
        return falhaRemocao ? [{ jid: ids[0], status: '403' }] : [{ jid: ids[0], status: '200' }]
      }
    }
  }
}
let confirmado = null
const engineFake = { execucoes: { confirmar: async (_id, r) => { confirmado = r.status } } }

const c1 = clienteFake(false)
await executarComandos(c1, [{ id: 'd1', commandType: 'whatsapp.delete', payload: { chatId: GRUPO, messageRef: { remoteJid: GRUPO, id: 'msg1', participant: PESSOA, fromMe: false } } }], engineFake)
check('gateway: apagar usa type revoke', c1.enviados[0]?.conteudo?.type === 'revoke')
check('gateway: o revoke aponta para a mensagem certa', c1.enviados[0]?.conteudo?.target?.id === 'msg1')
check('gateway: o revoke leva o participante (necessário em grupo)', c1.enviados[0]?.conteudo?.target?.participant === PESSOA)

const c2 = clienteFake(false)
await executarComandos(c2, [{ id: 'r1', commandType: 'group.remove', payload: { chatId: GRUPO, participantId: PESSOA } }], engineFake)
check('gateway: remoção chama removeParticipants', c2.removidos[0]?.ids?.[0] === PESSOA)
check('gateway: remoção bem-sucedida confirma como sent', confirmado === 'sent')

const c3 = clienteFake(true)
await executarComandos(c3, [{ id: 'r2', commandType: 'group.remove', payload: { chatId: GRUPO, participantId: PESSOA } }], engineFake)
check('gateway: recusa do WhatsApp (bot não é admin) vira failed, não sucesso silencioso', confirmado === 'failed')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE MODERAÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
