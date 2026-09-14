// Ações de mídia portadas para o motor: figurinha (vinda dos bots de
// referência) e recover (o comando que deu origem a este projeto).
//
// A garantia que estes testes protegem: o motor DECIDE sobre mídia sem nunca
// receber mídia. Ele só vê um token opaco — quem troca token por bytes é o
// processo do gateway, e só ele. Por isso metade do arquivo é o motor
// (evaluator) e metade é o gateway (gatewayExecutor com tudo injetado).
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { construirEventoDeMensagem } from '../src/engine/zapoAdapter.js'
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

// --- figurinha: os DOIS usos reais, montados pelo adaptador ---------------
//
// Estes casos passam pelo `construirEventoDeMensagem` de propósito. O teste
// anterior montava `{ kind: 'image', text: '/fig' }` na mão — combinação que o
// adaptador NUNCA produzia, porque a legenda da foto era descartada. O teste
// ficava verde e o comando ficava mudo no WhatsApp real. Evento de teste que o
// produtor real não consegue gerar não prova nada.
publicar('fig', [
  { id: 'g', type: 'trigger.command', config: { command: '/fig', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 's', type: 'action.whatsapp.sticker', config: { notFoundText: 'Manda uma imagem com /fig, ou responda uma.' } }
], [{ from: 'g', to: 's', on: 'matched' }], { acceptedMessageKinds: ['text', 'image', 'video'] })

let idMsg = 0
const chaveDireta = () => ({
  remoteJid: CHAT, id: `REAL${++idMsg}`, fromMe: false,
  isGroup: false, isBroadcast: false, isNewsletter: false
})
const doAdaptador = (message) => construirEventoDeMensagem(
  { key: chaveDireta(), message }, { accountId: 'acc-1', botId: '5511900000002@s.whatsapp.net' }
)

// USO 1: a foto vem COM o comando escrito na legenda.
const eventoLegenda = doAdaptador({ imageMessage: { url: 'x', mimetype: 'image/jpeg', caption: '/fig' } })
check('adaptador: a legenda da foto vira o texto da mensagem', eventoLegenda.message.text === '/fig', JSON.stringify(eventoLegenda.message.text))
const cmdLegenda = comandosDe(avaliarEvento(db, eventoLegenda), 'fig')[0]
check('figurinha na legenda da foto: gera whatsapp.sticker', cmdLegenda?.commandType === 'whatsapp.sticker', cmdLegenda?.commandType)
check('figurinha na legenda: o payload leva TOKEN, não a mídia', typeof cmdLegenda?.payload?.mediaRef === 'string' && cmdLegenda.payload.mediaRef.length > 0)
check('figurinha na legenda: nenhum segredo de mídia no payload',
  !JSON.stringify(cmdLegenda?.payload || {}).match(/mediaKey|directPath|fileEncSha|Buffer/))

// USO 2: o comando RESPONDE uma foto já enviada.
const eventoCitando = doAdaptador({
  extendedTextMessage: {
    text: '/fig',
    contextInfo: { stanzaId: 'Q1', participant: CHAT, quotedMessage: { imageMessage: { url: 'y', mimetype: 'image/jpeg' } } }
  }
})
check('adaptador: foto comum citada NÃO é rotulada visualização única', eventoCitando.message.quotedMediaRef?.kind === 'media', eventoCitando.message.quotedMediaRef?.kind)
check('adaptador: e o tipo real da mídia citada é preservado', eventoCitando.message.quotedMediaRef?.mediaKind === 'image')
const cmdCitando = comandosDe(avaliarEvento(db, eventoCitando), 'fig')[0]
check('figurinha respondendo uma foto: gera whatsapp.sticker', cmdCitando?.commandType === 'whatsapp.sticker', cmdCitando?.commandType)
check('figurinha respondendo: usa o token da mídia CITADA', cmdCitando?.payload?.mediaRef === eventoCitando.message.quotedMediaRef.token)

// USO 3: o comando sozinho, sem foto nenhuma — aí sim é o aviso.
const cmdSozinho = comandosDe(avaliarEvento(db, doAdaptador({ conversation: '/fig' })), 'fig')[0]
check('figurinha sem mídia nenhuma: não gera comando de figurinha', cmdSozinho?.commandType !== 'whatsapp.sticker')
check('figurinha sem mídia nenhuma: avisa por texto o que faltou', cmdSozinho?.payload?.text === 'Manda uma imagem com /fig, ou responda uma.')

// Legenda sem comando não pode acionar nada — o texto agora existe, então vale
// conferir que ele não casa por acidente.
const cmdLegendaComum = comandosDe(avaliarEvento(db, doAdaptador({ imageMessage: { url: 'z', caption: 'olha que foto linda' } })), 'fig')[0]
check('foto com legenda comum não aciona o comando', cmdLegendaComum === undefined)

// --- o token NÃO é legível como texto -------------------------------------
// Não existe mais lista de campos permitidos no interpolador: o que está no
// contexto é endereçável. Então a fronteira passou a ser o CONTEXTO, e é aqui
// que ela é cobrada — token é capacidade (serve pro gateway buscar bytes), não
// informação, e não pode acabar dentro de uma mensagem.
publicar('vaza', [
  { id: 'g', type: 'trigger.command', config: { command: '/vaza', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'a=[{{message.mediaRef}}] b=[{{message.quotedMediaRef}}] tipo=[{{media.kind}}]' } }
], [{ from: 'g', to: 'r', on: 'matched' }], { acceptedMessageKinds: ['text', 'image', 'video'] })

const tentaVazar = doAdaptador({ imageMessage: { url: 'x', mimetype: 'image/jpeg', caption: '/vaza' } })
const textoVazamento = comandosDe(avaliarEvento(db, tentaVazar), 'vaza')[0]?.payload?.text || ''
check('token da mídia não é legível como texto', textoVazamento.includes('a=[{{message.mediaRef}}]'), textoVazamento)
check('token da mídia citada também não', textoVazamento.includes('b=[{{message.quotedMediaRef}}]'), textoVazamento)
check('mas o TIPO da mídia é legível — é dado, não segredo', textoVazamento.includes('tipo=[image]'), textoVazamento)
check('nenhum token real aparece na mensagem', !textoVazamento.includes(tentaVazar.message.mediaRef))

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

// A citação passou a carregar mídia comum também (é o que faz a figurinha
// funcionar respondendo uma foto). O /recover tem que continuar recusando:
// reenviar uma foto que todo mundo ainda vê não é recuperar nada.
const recFotoComum = avaliarEvento(db, doAdaptador({
  extendedTextMessage: {
    text: '/recover',
    contextInfo: { stanzaId: 'Q2', participant: CHAT, quotedMessage: { imageMessage: { url: 'w', mimetype: 'image/jpeg' } } }
  }
}))
const cmdRecComum = comandosDe(recFotoComum, 'rec')[0]
check('recover respondendo foto COMUM: recusa em vez de recuperar', cmdRecComum?.commandType !== 'whatsapp.recover', cmdRecComum?.commandType)
check('recover respondendo foto comum: explica o que faltou', cmdRecComum?.payload?.text === 'Responda uma visualização única com /recover.')

// E visualização única de verdade continua funcionando pelo adaptador.
const recVisuReal = doAdaptador({
  extendedTextMessage: {
    text: '/recover',
    contextInfo: { stanzaId: 'Q3', participant: CHAT, quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { url: 'v', viewOnce: true } } } } }
  }
})
check('adaptador: visu única citada continua rotulada view_once', recVisuReal.message.quotedMediaRef?.kind === 'view_once', recVisuReal.message.quotedMediaRef?.kind)
check('recover respondendo visu única de verdade: recupera', comandosDe(avaliarEvento(db, recVisuReal), 'rec')[0]?.commandType === 'whatsapp.recover')

publicar('rec2', [
  { id: 'g', type: 'trigger.command', config: { command: '/aqui', match: 'exact', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'same_chat' } }
], [{ from: 'g', to: 'r', on: 'matched' }])
const mesmoChat = avaliarEvento(db, evento({ kind: 'text', text: '/aqui', quotedMediaRef: { token: 't2', kind: 'view_once', mediaKind: 'video' } }))
check('recover com destino "same_chat": endereça a própria conversa', comandosDe(mesmoChat, 'rec2')[0]?.payload?.destinationId === CHAT)

// --- comando na PRÓPRIA mensagem (uso pessoal) ---------------------------
// Mandar a mídia do número onde o bot roda e usar o comando ali mesmo é o caso
// normal de quem só quer o bot para si. Com allowFrom 'external' isso NÃO
// dispara — a regra existe para o bot não reagir a si mesmo. 'any' abre para
// comando digitado, e só para ele: a barreira do gatilho AUTOMÁTICO continua
// não sendo configurável, porque lá reagir à própria mensagem vira laço.
publicar('x9-proprio', [
  { id: 'g', type: 'trigger.command', config: { command: '/x9', match: 'exact_or_args', allowFrom: 'any' } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'same_chat', notFoundText: 'sem visu' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

publicar('x9-externo', [
  { id: 'g', type: 'trigger.command', config: { command: '/x9ext', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'same_chat', notFoundText: 'sem visu' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

const meuProprioEvento = (texto) => {
  const e = doAdaptador({
    extendedTextMessage: {
      text: texto,
      contextInfo: { stanzaId: `EU${Math.random()}`, participant: CHAT, quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { url: 'eu', viewOnce: true } } } } }
    }
  })
  e.sender.authoredBySelf = true
  return e
}

const proprio = comandosDe(avaliarEvento(db, meuProprioEvento('/x9')), 'x9-proprio')[0]
check('comando com allowFrom "any" responde à própria mensagem', proprio?.commandType === 'whatsapp.recover', proprio?.commandType)

const externo = comandosDe(avaliarEvento(db, meuProprioEvento('/x9ext')), 'x9-externo')
check('comando com allowFrom "external" continua ignorando a própria mensagem', externo.length === 0)

// A barreira do gatilho automático NÃO é afetada: continua absoluta.
publicar('auto-proprio', [
  { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', messageKinds: ['view_once'] } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'same_chat' } }
], [{ from: 'g', to: 'r', on: 'matched' }], { acceptedMessageKinds: ['view_once'] })
const autoProprio = doAdaptador({ viewOnceMessageV2: { message: { imageMessage: { url: 'loop', viewOnce: true } } } })
autoProprio.sender.authoredBySelf = true
check('gatilho automático nunca reage à própria mensagem, aconteça o que acontecer', comandosDe(avaliarEvento(db, autoProprio), 'auto-proprio').length === 0)

// --- destino que vem de VARIÁVEL, não do documento ------------------------
// É o encontro entre o comando comum e o de configuração: o de configuração
// grava na tabela, o comum lê de lá. Mesma tabela dos marcadores tipo VIP,
// nenhum mecanismo novo.
publicar('rec-config', [
  { id: 'g', type: 'trigger.command', config: { command: '/rc', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'configured', destinationId: '{{var.global.recover_destino}}', notFoundText: 'sem visu' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

const visuCitada = () => doAdaptador({
  extendedTextMessage: {
    text: '/rc',
    contextInfo: { stanzaId: `QC${Math.random()}`, participant: CHAT, quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { url: 'k', viewOnce: true } } } } }
  }
})

// Antes de configurar: funciona, indo para as mensagens salvas. Quem acabou de
// instalar não pode ficar com um comando morto esperando configuração.
const semConfig = comandosDe(avaliarEvento(db, visuCitada()), 'rec-config')[0]
check('destino configurável sem configuração: ainda recupera', semConfig?.commandType === 'whatsapp.recover', semConfig?.commandType)
check('destino configurável sem configuração: cai para mensagens salvas', semConfig?.payload?.destination === 'saved_messages' && semConfig?.payload?.destinationId === null)

// O comando de configuração grava exatamente isto:
db.prepare('INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)')
  .run('global', '__global__', 'recover_destino', JSON.stringify('5511777777777'), agora)

const comConfig = comandosDe(avaliarEvento(db, visuCitada()), 'rec-config')[0]
check('depois de configurar: o destino vem da variável', comConfig?.payload?.destinationId === '5511777777777@s.whatsapp.net', comConfig?.payload?.destinationId)
check('depois de configurar: o número digitado vira JID sozinho', comConfig?.payload?.destination === 'fixed' || comConfig?.payload?.destination === 'configured')

// --- recuperação AUTOMÁTICA: a mídia é da própria mensagem ----------------
// Sem citação e sem comando. É o que permite o auto-recover existir sem ação
// nova: trigger.message filtrando visualização única.
publicar('rec-auto', [
  { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', messageKinds: ['view_once'] } },
  { id: 'r', type: 'action.whatsapp.recover', config: { destination: 'same_chat' } }
], [{ from: 'g', to: 'r', on: 'matched' }], { acceptedMessageKinds: ['view_once'] })

const visuChegando = doAdaptador({ viewOnceMessageV2: { message: { imageMessage: { url: 'auto', viewOnce: true, caption: 'segredo' } } } })
check('adaptador: visu única própria expõe o tipo real', visuChegando.message.mediaKind === 'image', visuChegando.message.mediaKind)
check('adaptador: e a legenda original da mídia', visuChegando.message.mediaCaption === 'segredo')
const cmdAuto = comandosDe(avaliarEvento(db, visuChegando), 'rec-auto')[0]
check('recuperação automática: recupera sem ninguém digitar nada', cmdAuto?.commandType === 'whatsapp.recover', cmdAuto?.commandType)
check('recuperação automática: usa a mídia da PRÓPRIA mensagem', cmdAuto?.payload?.mediaRef === visuChegando.message.mediaRef)
check('recuperação automática: leva o tipo real, não "view_once"', cmdAuto?.payload?.mediaKind === 'image', cmdAuto?.payload?.mediaKind)

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
// Vídeo EXIGE mimetype: sem ele a biblioteca recusa com "mimetype is required
// for video messages" — e a falha acontece depois de já ter baixado a mídia,
// que é o pior momento. Achado num teste ao vivo: o recover de um vídeo de
// visualização única falhava com a mídia na mão.
const depsVideo = {
  mediaRefCache: { resolver: () => ({ node: { mimetype: 'video/mp4' }, tipo: 'video', interno: {} }) },
  baixarBuffer: async () => Buffer.from('video-cru'),
  limiteBytes: 1000,
  resolverJidProprio: () => '5511900000002@s.whatsapp.net'
}
const cVideo = clienteFake()
await executarComandos(cVideo, [{ id: 'v1', commandType: 'whatsapp.recover', payload: { chatId: CHAT, destination: 'same_chat', destinationId: CHAT, mediaRef: 'ok', mediaKind: 'video' } }], engineFake, depsVideo)
check('gateway: recover de vídeo informa o mimetype', cVideo.enviados[0]?.conteudo?.mimetype === 'video/mp4', JSON.stringify(cVideo.enviados[0]?.conteudo?.mimetype))

const depsSemMime = { ...depsVideo, mediaRefCache: { resolver: () => ({ node: {}, tipo: 'video', interno: {} }) } }
const cSemMime = clienteFake()
await executarComandos(cSemMime, [{ id: 'v2', commandType: 'whatsapp.recover', payload: { chatId: CHAT, destination: 'same_chat', destinationId: CHAT, mediaRef: 'ok', mediaKind: 'video' } }], engineFake, depsSemMime)
check('gateway: vídeo sem mimetype no nó ainda sai com um válido', cSemMime.enviados[0]?.conteudo?.mimetype === 'video/mp4')

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
