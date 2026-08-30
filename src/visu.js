import { downloadContentFromMessage } from '@whiskeysockets/baileys'

/*
 * Tira as "cascas" que o WhatsApp coloca em volta da mensagem real
 * (mensagem temporária, device sent, etc.) até sobrar o conteúdo de verdade.
 */
export function desembrulhar (message) {
  let atual = message
  for (let i = 0; i < 5 && atual; i++) {
    const proximo =
      atual.ephemeralMessage?.message ||
      atual.deviceSentMessage?.message ||
      atual.documentWithCaptionMessage?.message
    if (!proximo) break
    atual = proximo
  }
  return atual
}

/*
 * Detecta visualização única em todos os formatos que o WhatsApp usa hoje:
 *   - viewOnceMessage            (formato antigo)
 *   - viewOnceMessageV2          (fotos e vídeos atuais)
 *   - viewOnceMessageV2Extension (áudios em visualização única)
 *   - imageMessage/videoMessage/audioMessage com a flag viewOnce = true
 *     (é assim que chega quando não vem embrulhado)
 *
 * O parâmetro `marcadaNaChave` é o `key.isViewOnce` que o Baileys 7 coloca na
 * chave da mensagem — serve de reforço pros casos em que a flag não vem no
 * próprio nó da mídia.
 *
 * Retorna { node, tipo, interno } onde `node` é o imageMessage/videoMessage/
 * audioMessage cru — exatamente o objeto que o downloadContentFromMessage
 * espera, o mesmo que os bots de exemplo passam pro getFileBuffer() na hora
 * de transformar a mídia em figurinha.
 */
export function acharVisuUnica (message, marcadaNaChave = false) {
  const msg = desembrulhar(message)
  if (!msg) return null

  const envelope =
    msg.viewOnceMessage?.message ||
    msg.viewOnceMessageV2?.message ||
    msg.viewOnceMessageV2Extension?.message

  const interno = desembrulhar(envelope) || msg
  const veioEmbrulhado = !!envelope

  const candidatos = [
    ['image', interno.imageMessage],
    ['video', interno.videoMessage],
    ['audio', interno.audioMessage]
  ]

  for (const [tipo, node] of candidatos) {
    if (!node) continue
    // dentro do envelope viewOnce* já é visu única;
    // fora dele, só vale se a flag viewOnce estiver marcada
    if (veioEmbrulhado || node.viewOnce === true || marcadaNaChave) {
      return { node, tipo, interno }
    }
  }
  return null
}

/*
 * Reconhece um comando de texto (ex: "/recover", "/transcrever") enviado em
 * resposta/citação a outra mensagem. Quando você cita uma mensagem, o
 * WhatsApp inclui em contextInfo.quotedMessage uma cópia do conteúdo — pra
 * visualização única ainda não aberta, isso "vaza" a mídia original mesmo
 * quando ela nunca chegou inline pro bot.
 *
 * Retorna { quotedMessage, stanzaId, participant } ou null se o texto não
 * bater com `palavraChave` (ou não houver mensagem citada).
 */
export function acharComandoTexto (message, palavraChave) {
  const msg = desembrulhar(message)
  if (!msg) return null

  const texto = msg.extendedTextMessage
  if (!texto) return null
  if (texto.text?.trim().toLowerCase() !== palavraChave) return null

  const contextInfo = texto.contextInfo || {}
  if (!contextInfo.quotedMessage) return null

  return {
    quotedMessage: contextInfo.quotedMessage,
    stanzaId: contextInfo.stanzaId,
    participant: contextInfo.participant
  }
}

export function acharComandoRecover (message) {
  return acharComandoTexto(message, '/recover')
}

export function acharComandoTranscrever (message) {
  return acharComandoTexto(message, '/transcrever')
}

/*
 * Acha um áudio comum (não precisa ser visualização única) direto na
 * mensagem, desembrulhando envelopes de passagem. Usado pela transcrição
 * automática por conversa e pelo comando /transcrever (sobre a mensagem
 * citada).
 */
export function acharAudioDireto (message) {
  const msg = desembrulhar(message)
  return msg?.audioMessage || null
}

/* Mesma ideia do getFileBuffer() dos bots de exemplo: stream -> Buffer */
export async function baixarBuffer (node, tipo) {
  const stream = await downloadContentFromMessage(node, tipo)
  let buffer = Buffer.from([])
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk])
  }
  return buffer
}

export function extensaoDe (tipo, mimetype = '') {
  if (tipo === 'image') return mimetype.includes('png') ? '.png' : '.jpg'
  if (tipo === 'video') return '.mp4'
  return mimetype.includes('mpeg') ? '.mp3' : '.ogg'
}
