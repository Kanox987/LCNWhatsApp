// Mapeamento de campo REAL do Zapo pro evento canônico (verificado contra
// node_modules/zapo-js/dist/client/types.d.ts, não é suposição). Só isto
// importa zapo-adjacent concepts (formato de event.key/event.message) — o
// resto do motor nunca vê essas estruturas cruas.
import { desembrulhar, acharVisuUnica } from '../visu.js'
import { calcularEventId, classificarMensagem } from './canonicalEvent.js'
import * as mediaRefCache from './mediaRefCache.js'
import * as lidMap from '../lidMap.js'

// participantAlt/remoteJidAlt têm prioridade sobre o LID cru — mesma
// normalização já usada inline em connection.js/capture.js, reaproveitada
// aqui (não reinventada) por consistência.
function resolverSenderId (key) {
  return key.participantAlt || key.remoteJidAlt || key.participant || key.remoteJid
}

function resolverChatKind (key) {
  if (key.isGroup) return 'group'
  if (key.isNewsletter) return 'channel'
  if (key.isBroadcast) return 'unknown'
  return 'direct'
}

// Numa conversa direta, o chat É o contato — precisa da mesma normalização
// LID→PN que resolverSenderId já aplica, senão scope.include configurado
// com o JID de telefone nunca casa quando o Zapo entrega key.remoteJid como
// LID (achado real testando /ping ao vivo: chat.id ficava com o LID cru
// enquanto sender.id já vinha normalizado, então nunca batiam). Grupo/canal
// mantêm key.remoteJid puro — é a identidade estável do próprio grupo, não
// de quem mandou a mensagem.
function resolverChatId (key, kind) {
  if (kind === 'direct') return key.remoteJidAlt || key.remoteJid
  return key.remoteJid
}

function extrairTexto (msg) {
  return msg?.extendedTextMessage?.text ?? (typeof msg?.conversation === 'string' ? msg.conversation : undefined)
}

// mediaRef só existe pra mensagem com mídia de verdade — o node cru
// (imageMessage/videoMessage/audioMessage) carrega mediaKey/directPath, que
// NUNCA pode virar JSON solto. Vira um token opaco (mediaRefCache) que só
// este mesmo processo consegue resolver de volta.
//
// BUG real encontrado nos testes (não suposição): desembrulhar() só abre
// ephemeralMessage/deviceSentMessage/documentWithCaptionMessage — NÃO abre
// viewOnceMessage/viewOnceMessageV2/viewOnceMessageV2Extension. Pra visu
// única, o node de mídia mora dentro desse envelope, então usar `msg`
// (só desembrulhado no sentido "normal") nunca acharia o node — mediaRef
// ficava sempre undefined. acharVisuUnica() (visu.js, já testado) é quem
// sabe abrir ESSE envelope específico e devolve { node, tipo, interno }.
function construirMediaRefInline (msg, tipo) {
  const campo = `${tipo}Message`
  const node = msg?.[campo]
  if (!node) return undefined
  return mediaRefCache.criar({ node, tipo, interno: msg })
}

function construirMediaRef (msgBruta, msg, kind, marcadaComoViewOnce) {
  if (kind === 'view_once') {
    const achado = acharVisuUnica(msgBruta, marcadaComoViewOnce)
    if (!achado) return undefined
    return mediaRefCache.criar({ node: achado.node, tipo: achado.tipo, interno: achado.interno })
  }
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    return construirMediaRefInline(msg, kind)
  }
  return undefined
}

// Varre os campos da mensagem procurando contextInfo.quotedMessage — mesma
// ideia de acharCitacaoGenerica (src/capture.js), mas devolvendo só
// endereçamento (nunca o conteúdo da citação: /recover e visu única
// continuam ação nativa protegida, não precisam vazar isso pro motor).
function construirQuotedRef (msg) {
  if (!msg) return undefined
  for (const [chave, node] of Object.entries(msg)) {
    if (chave === 'messageContextInfo') continue
    const contextInfo = node?.contextInfo
    if (contextInfo?.quotedMessage) {
      return {
        provider: 'zapo',
        remoteJid: undefined,
        id: contextInfo.stanzaId,
        // Mesmo problema do mentionedJid: o autor da citação pode vir como LID.
        participant: lidMap.paraTelefone(contextInfo.participant) || contextInfo.participant
      }
    }
  }
  return undefined
}

// A visualização única dentro da mensagem CITADA — é onde o WhatsApp deixa
// uma cópia decriptável da mídia original, e é o que faz o /recover funcionar.
//
// O motor recebe apenas um TOKEN opaco (mesma proteção do mediaRef da
// mensagem atual): quem consegue trocar o token pela mídia é só o processo
// que o criou, e o segredo (mediaKey, directPath) nunca sai daqui. Assim o
// motor consegue DECIDIR sobre uma visu única citada sem nunca receber o
// conteúdo dela.
function construirQuotedMediaRef (msg) {
  if (!msg) return undefined
  for (const [chave, node] of Object.entries(msg)) {
    if (chave === 'messageContextInfo') continue
    const citada = node?.contextInfo?.quotedMessage
    if (!citada) continue
    const achado = acharVisuUnica(citada, true)
    if (achado) {
      return {
        token: mediaRefCache.criar({ node: achado.node, tipo: achado.tipo, interno: achado.interno }),
        kind: 'view_once',
        mediaKind: achado.tipo
      }
    }
  }
  return undefined
}

// Quem a mensagem menciona (@fulano). É o que torna possível um comando agir
// sobre um TERCEIRO — "/adv @fulano", "/promover @fulano" — em vez de só sobre
// quem escreveu. Sem isso, a família inteira de comandos de moderação dos bots
// de referência não tem como existir no motor.
// Vem em contextInfo.mentionedJid do nó de texto estendido, e é traduzido de
// LID para telefone quando o par já foi visto antes (ver src/lidMap.js): o
// WhatsApp entrega a menção num formato só, às vezes o identificador interno,
// e sem traduzir ela não casaria com o id gravado nas variáveis. Um LID nunca
// visto volta como veio — nunca se inventa um número.
function construirMencoes (msg) {
  if (!msg) return undefined
  for (const [chave, node] of Object.entries(msg)) {
    if (chave === 'messageContextInfo') continue
    const mencionados = node?.contextInfo?.mentionedJid
    if (Array.isArray(mencionados) && mencionados.length) {
      const ids = mencionados
        .filter((jid) => typeof jid === 'string' && jid)
        .map((jid) => lidMap.paraTelefone(jid))
        .filter(Boolean)
      if (ids.length) return ids
    }
  }
  return undefined
}

function construirProviderRef (key) {
  return {
    provider: 'zapo',
    remoteJid: key.remoteJid,
    id: key.id,
    participant: key.participant,
    participantAlt: key.participantAlt,
    remoteJidAlt: key.remoteJidAlt,
    senderDevice: key.senderDevice,
    fromMe: key.fromMe
  }
}

export function construirEventoDeMensagem (event, { accountId, recebidoEmMs }) {
  const key = event.key || {}
  // Toda mensagem que passa ensina um par LID<->telefone. É de graça: os dois
  // formatos já vêm na chave, e é o que faz a menção funcionar depois.
  try { lidMap.aprenderDaChave(key) } catch {}
  const chatKind = resolverChatKind(key)
  const chatId = resolverChatId(key, chatKind)
  const senderId = resolverSenderId(key)
  const msgBruta = event.message
  const msg = desembrulhar(msgBruta) || msgBruta
  const kind = classificarMensagem(msgBruta, { marcadaComoViewOnce: key.isViewOnce === true })

  const mensagem = { kind }
  if (kind === 'text') mensagem.text = extrairTexto(msg)
  const mediaRef = construirMediaRef(msgBruta, msg, kind, key.isViewOnce === true)
  if (mediaRef) mensagem.mediaRef = mediaRef
  const quotedRef = construirQuotedRef(msg)
  if (quotedRef) mensagem.quotedRef = quotedRef
  const mencoes = construirMencoes(msg)
  if (mencoes) mensagem.mentions = mencoes
  const quotedMediaRef = construirQuotedMediaRef(msg)
  if (quotedMediaRef) mensagem.quotedMediaRef = quotedMediaRef

  return {
    provider: 'zapo',
    accountId,
    eventId: calcularEventId({ accountId, chatId, senderId, providerMessageId: key.id }),
    occurredAt: new Date((event.timestampSeconds ?? Date.now() / 1000) * 1000).toISOString(),
    replay: event.offline === true,
    receivedAtMs: recebidoEmMs ?? Date.now(),
    chat: { id: chatId, kind: chatKind },
    sender: { id: senderId, authoredBySelf: key.fromMe === true },
    message: mensagem,
    providerRef: construirProviderRef(key)
  }
}

// message_unavailable NUNCA carrega event.message (confirmado no tipo real,
// WaIncomingUnavailableMessageEvent não tem esse campo) — por isso não tem
// texto nem mediaRef possível, só o fato de que algo chegou e não pôde ser
// processado.
export function construirEventoDeIndisponivel (event, { accountId, recebidoEmMs }) {
  const key = event.key || {}
  const chatKind = resolverChatKind(key)
  const chatId = resolverChatId(key, chatKind)
  const senderId = resolverSenderId(key)

  return {
    provider: 'zapo',
    accountId,
    eventId: calcularEventId({ accountId, chatId, senderId, providerMessageId: key.id }),
    occurredAt: new Date((event.timestampSeconds ?? Date.now() / 1000) * 1000).toISOString(),
    replay: event.offline === true,
    receivedAtMs: recebidoEmMs ?? Date.now(),
    chat: { id: chatId, kind: chatKind },
    sender: { id: senderId, authoredBySelf: key.fromMe === true },
    message: { kind: 'unavailable' },
    providerRef: construirProviderRef(key)
  }
}
