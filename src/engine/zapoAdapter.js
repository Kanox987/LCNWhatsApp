// Mapeamento de campo REAL do Zapo pro evento canônico (verificado contra
// node_modules/zapo-js/dist/client/types.d.ts, não é suposição). Só isto
// importa zapo-adjacent concepts (formato de event.key/event.message) — o
// resto do motor nunca vê essas estruturas cruas.
import { desembrulhar, acharVisuUnica } from '../visu.js'
import { calcularEventId, classificarMensagem } from './canonicalEvent.js'
import * as mediaRefCache from './mediaRefCache.js'

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
      return { provider: 'zapo', remoteJid: undefined, id: contextInfo.stanzaId, participant: contextInfo.participant }
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

export function construirEventoDeMensagem (event, { accountId }) {
  const key = event.key || {}
  const chatId = key.remoteJid
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

  return {
    provider: 'zapo',
    accountId,
    eventId: calcularEventId({ accountId, chatId, senderId, providerMessageId: key.id }),
    occurredAt: new Date((event.timestampSeconds ?? Date.now() / 1000) * 1000).toISOString(),
    replay: event.offline === true,
    chat: { id: chatId, kind: resolverChatKind(key) },
    sender: { id: senderId, authoredBySelf: key.fromMe === true },
    message: mensagem,
    providerRef: construirProviderRef(key)
  }
}

// message_unavailable NUNCA carrega event.message (confirmado no tipo real,
// WaIncomingUnavailableMessageEvent não tem esse campo) — por isso não tem
// texto nem mediaRef possível, só o fato de que algo chegou e não pôde ser
// processado.
export function construirEventoDeIndisponivel (event, { accountId }) {
  const key = event.key || {}
  const chatId = key.remoteJid
  const senderId = resolverSenderId(key)

  return {
    provider: 'zapo',
    accountId,
    eventId: calcularEventId({ accountId, chatId, senderId, providerMessageId: key.id }),
    occurredAt: new Date((event.timestampSeconds ?? Date.now() / 1000) * 1000).toISOString(),
    replay: event.offline === true,
    chat: { id: chatId, kind: resolverChatKind(key) },
    sender: { id: senderId, authoredBySelf: key.fromMe === true },
    message: { kind: 'unavailable' },
    providerRef: construirProviderRef(key)
  }
}
