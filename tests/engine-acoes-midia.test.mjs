// Ações de mídia portadas para o motor: figurinha (vinda dos bots de
// referência) e recover (o comando que deu origem a este projeto).
//
// A garantia que estes testes protegem: o motor DECIDE sobre mídia sem nunca
// receber mídia. Ele só vê um token opaco — quem troca token por bytes é o
// processo do gateway, e só ele. Por isso metade do arquivo é o motor
// (evaluator) e metade é o gateway (gatewayExecutor com tudo injetado).
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
const CHAT = '5511900000001@s.whatsapp.net'

function publicar (id, nodes, edges, { acceptedMessageKinds = ['text', 'image', 'view_once'] } = {}) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'contact', id: CHAT }], exclude: [] },
    inputPolicy: { acceptedMessageKinds, historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: { nodes, edges }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'contact', CHAT)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function evento (mensagem) {
  n++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${CHAT}:${CHAT}:m${n}`,
    occurredAt: agora, replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredBySelf: false },
    message: mensagem,
    providerRef: { provider: 'zapo', remoteJid: CHAT, id: `m${n}` }
  }
}
const comandosDe = (r, id) => r.results.find((x) => x.automationId === id)?.commands || []

// --- figurinha: o motor repassa o token, nunca a mídia -------------------
publicar('fig', [
  { id: 'g', type: 'trigger.command', config: { command: '/fig', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 's', type: 'action.whatsapp.sticker', config: { notFoundText: 'Manda uma imagem com /fig, ou responda uma.' } }
], [{ from: 'g', to: 's', on: 'matched' }])

const comFoto = avaliarEvento(db, evento({ kind: 'image', text: '/fig', mediaRef: 'token-abc-123' }))
const cmdFig = comandosDe(comFoto, 'fig')[0]
check('figurinha: gera comando whatsapp.sticker', cmdFig?.commandType === 'whatsapp.sticker')
check('figurinha: o payload leva o TOKEN, não a mídia', cmdFig?.payload?.mediaRef === 'token-abc-123')
check('figurinha: nenhum campo do payload carrega bytes ou segredo de mídia',
  !JSON.stringify(cmdFig?.payload || {}).match(/mediaKey|directPath|fileEncSha|Buffer/))

const semFoto = avaliarEvento(db, evento({ kind: 'text', text: '/fig' }))
const cmdSemFoto = comandosDe(semFoto, 'fig')[0]
check('figurinha sem mídia: não gera comando de figurinha', cmdSemFoto?.commandType !== 'whatsapp.sticker')
check('figurinha sem mídia: avisa por texto o que faltou', cmdSemFoto?.payload?.text === 'Manda uma imagem com /fig, ou responda uma.')

// --- recover: decide pelo token da mídia CITADA ---------------------------
publicar('rec', [
  { id: 'g', type: 'trigger.command', config: { command: '/recover', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'saved_messages', caption: 'Recuperado de {{sender.id}}', notFoundText: 'Responda uma visualização única com /recover.' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

const comVisu = avaliarEvento(db, evento({
  kind: 'text', text: '/recover',
  quotedMediaRef: { token: 'token-visu-9', kind: 'view_once', mediaKind: 'image' }
}))
const cmdRec = comandosDe(comVisu, 'rec')[0]
check('recover: gera comando whatsapp.recover', cmdRec?.commandType === 'whatsapp.recover')
check('recover: leva só o token da mídia citada', cmdRec?.payload?.mediaRef === 'token-visu-9')
check('recover: preserva o tipo da mídia para o gateway reenviar certo', cmdRec?.payload?.mediaKind === 'image')
check('recover: a legenda é interpolada no motor', cmdRec?.payload?.caption === `Recuperado de ${CHAT}`)
check('recover: destino "saved_messages" NÃO vira endereço no motor (só o gateway sabe o JID próprio)', cmdRec?.payload?.destinationId === null)

const semVisu = avaliarEvento(db, evento({ kind: 'text', text: '/recover' }))
check('recover sem visu única citada: explica em vez de falhar calado', comandosDe(semVisu, 'rec')[0]?.payload?.text === 'Responda uma visualização única com /recover.')

publicar('rec2', [
  { id: 'g', type: 'trigger.command', config: { command: '/aqui', match: 'exact', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'same_chat' } }
], [{ from: 'g', to: 'r', on: 'matched' }])
const mesmoChat = avaliarEvento(db, evento({ kind: 'text', text: '/aqui', quotedMediaRef: { token: 't2', kind: 'view_once', mediaKind: 'video' } }))
check('recover com destino "same_chat": endereça a própria conversa', comandosDe(mesmoChat, 'rec2')[0]?.payload?.destinationId === CHAT)

// --- lado do gateway: token vira mídia de verdade -------------------------
function clienteFake () {
  const enviados = []
  return {
    enviados,
    getCredentials: () => ({ meJid: '5511900000002:47@s.whatsapp.net' }),
    message: { send: async (jid, conteudo) => { enviados.push({ jid, conteudo }); return { ok: true } } }
  }
}
const engineFake = { execucoes: { confirmar: async () => ({ ok: true }) } }

const depsFig = {
  mediaRefCache: { resolver: (t) => (t === 'ok' ? { node: {}, tipo: 'image', interno: {} } : null) },
  baixarBuffer: async () => Buffer.from('imagem-crua'),
  converterParaFigurinha: async (buf) => Buffer.concat([Buffer.from('WEBP:'), buf]),
  podeVirarFigurinha: (t) => t === 'image' || t === 'video',
  ehAnimada: (t) => t === 'video',
  limiteBytes: 1000,
  resolverJidProprio: () => '5511900000002@s.whatsapp.net'
}

const c1 = clienteFake()
await executarComandos(c1, [{ id: 'c1', commandType: 'whatsapp.sticker', payload: { chatId: CHAT, mediaRef: 'ok' } }], engineFake, depsFig)
check('gateway: figurinha é enviada como type sticker', c1.enviados[0]?.conteudo?.type === 'sticker')
check('gateway: envia o WebP convertido, não o buffer cru', c1.enviados[0]?.conteudo?.media?.toString().startsWith('WEBP:'))

let confirmado = null
const engineQueRegistra = { execucoes: { confirmar: async (_id, r) => { confirmado = r.status } } }
const c2 = clienteFake()
await executarComandos(c2, [{ id: 'c2', commandType: 'whatsapp.sticker', payload: { chatId: CHAT, mediaRef: 'expirou' } }], engineQueRegistra, depsFig)
check('gateway: token expirado não envia nada', c2.enviados.length === 0)
check('gateway: token expirado vira "failed" (erro conhecido), não "outcome_unknown"', confirmado === 'failed')

const c3 = clienteFake()
await executarComandos(c3, [{ id: 'c3', commandType: 'whatsapp.recover', payload: { chatId: CHAT, destination: 'saved_messages', destinationId: null, mediaRef: 'ok', caption: 'oi' } }], engineFake, depsFig)
check('gateway: recover resolve "saved_messages" para o JID próprio, sem o sufixo de dispositivo', c3.enviados[0]?.jid === '5511900000002@s.whatsapp.net')
check('gateway: recover reenvia com o tipo real da mídia', c3.enviados[0]?.conteudo?.type === 'image')
check('gateway: recover leva a legenda', c3.enviados[0]?.conteudo?.caption === 'oi')

const c4 = clienteFake()
await executarComandos(c4, [{ id: 'c4', commandType: 'whatsapp.recover', payload: { chatId: CHAT, destination: 'fixed', destinationId: '5599@s.whatsapp.net', mediaRef: 'ok' } }], engineFake, depsFig)
check('gateway: destino fixo é respeitado', c4.enviados[0]?.jid === '5599@s.whatsapp.net')

const c5 = clienteFake()
await executarComandos(c5, [{ id: 'c5', commandType: 'whatsapp.inventado', payload: {} }], engineFake, depsFig)
check('gateway: comando desconhecido continua recusado', c5.enviados.length === 0)

// --- mensagem rica: caminho não oficial, com queda obrigatória para texto --
publicar('rico', [
  { id: 'g', type: 'trigger.command', config: { command: '/codigo', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.rich', config: { text: 'const x = 1', richKind: 'code', language: 'javascript', fallbackText: 'const x = 1' } }
], [{ from: 'g', to: 'r', on: 'matched' }])
const rRico = avaliarEvento(db, evento({ kind: 'text', text: '/codigo' }))
const cmdRico = comandosDe(rRico, 'rico')[0]
check('rich: gera comando whatsapp.rich', cmdRico?.commandType === 'whatsapp.rich')
check('rich: SEMPRE leva texto de reserva (o caminho oficial pode sumir)', typeof cmdRico?.payload?.fallbackText === 'string' && cmdRico.payload.fallbackText.length > 0)

function clienteRico (falhar) {
  const enviados = []
  return { enviados, message: { send: async (jid, c) => { if (c?.botForwardedMessage && falhar) throw new Error('formato recusado'); enviados.push({ jid, conteudo: c }); return { ok: true } } } }
}
const cr1 = clienteRico(false)
await executarComandos(cr1, [{ id: 'x1', commandType: 'whatsapp.rich', payload: { chatId: CHAT, text: 'const x = 1', richKind: 'code', language: 'javascript', fallbackText: 'const x = 1' } }], engineFake, depsFig)
check('gateway: monta a mensagem no envelope de resposta rica', !!cr1.enviados[0]?.conteudo?.botForwardedMessage?.message?.richResponseMessage)
const ctx = cr1.enviados[0]?.conteudo?.botForwardedMessage?.message?.richResponseMessage?.contextInfo
check('gateway: o envelope declara a origem que destrava a formatação', ctx?.forwardedAiBotMessageInfo?.botJid === '867051314767696@bot')

const cr2 = clienteRico(true)
await executarComandos(cr2, [{ id: 'x2', commandType: 'whatsapp.rich', payload: { chatId: CHAT, text: 'const x = 1', fallbackText: 'const x = 1' } }], engineFake, depsFig)
check('gateway: se o WhatsApp recusar o formato, cai para texto comum', cr2.enviados[0]?.conteudo?.type === 'text')
check('gateway: o texto de reserva preserva o conteúdo', cr2.enviados[0]?.conteudo?.text === 'const x = 1')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODAS AS AÇÕES DE MÍDIA PASSARAM')
process.exit(falhas ? 1 : 0)
