/*
 * O parsing abaixo (desembrulhar/acharVisuUnica/etc.) opera direto sobre
 * `message` no formato Proto.IMessage — o protobuf do WhatsApp em si, não
 * uma abstração da Baileys. O Zapo entrega `event.message` no mesmo formato
 * (confirmado na doc: "message: Proto.IMessage"), então essa detecção
 * sobrevive à troca de lib sem alteração de lógica — só a função de
 * download no fim do arquivo (baixarBuffer) é específica da lib.
 *
 * O Zapo tem um helper nativo (resolveMediaPayload()) que desembrulha
 * ephemeralMessage/viewOnceMessage/viewOnceMessageV2 automaticamente — mas
 * a doc dele NÃO confirma cobertura de viewOnceMessageV2Extension (áudio em
 * visualização única), que é um caso real usado neste projeto. Por isso,
 * deliberadamente NÃO trocamos essa detecção manual pelo helper nativo:
 * ela já é testada (ver tests/detect.test.mjs) e cobre todos os casos
 * conhecidos, inclusive o que a doc do helper deixa em aberto.
 */
import * as bandwidth from './bandwidth.js'
import * as state from './state.js'

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
 * WhatsApp inclui em contextInfo.quotedMessage uma cópia do conteúdo — isso
 * "vaza" a mídia original de uma visualização única mesmo quando ela nunca
 * chegou inline pro bot.
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

/*
 * Reconhece QUALQUER citação/resposta, sem exigir texto específico — ao
 * contrário de acharComandoTexto, que exige bater com uma palavra-chave.
 * Usado pela recuperação implícita do download automático: enquanto uma
 * conversa está com visu única pendente, a PRIMEIRA resposta do dono que
 * citar alguma coisa (texto, mídia, figurinha — não importa o campo) é
 * tratada como um /recover implícito.
 *
 * Varre os campos da mensagem desembrulhada em vez de checar um campo fixo
 * (extendedTextMessage) porque resposta com mídia/figurinha carrega
 * contextInfo no próprio nó da mídia, não em extendedTextMessage.
 *
 * Retorna { quotedMessage, stanzaId, participant } ou null.
 */
export function acharCitacaoGenerica (message) {
  const msg = desembrulhar(message)
  if (!msg) return null

  for (const [chave, node] of Object.entries(msg)) {
    if (chave === 'messageContextInfo') continue
    const contextInfo = node?.contextInfo
    if (contextInfo?.quotedMessage) {
      return {
        quotedMessage: contextInfo.quotedMessage,
        stanzaId: contextInfo.stanzaId,
        participant: contextInfo.participant
      }
    }
  }
  return null
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

// Baixa e decripta a mídia crua (node = imageMessage/videoMessage/audioMessage)
// via client.message.downloadBytes(). A API do Zapo espera um Proto.IMessage
// inteiro (ou o WaIncomingMessageEvent), não o nó isolado — por isso o node é
// reembrulhado em { [tipo+'Message']: node } antes da chamada (confirmado no
// próprio exemplo da doc de requestMediaReupload, que reconstrói o envelope
// da mesma forma pra aplicar o directPath novo). maxBytes é obrigatório na
// API do Zapo — reaproveita o mesmo teto de tamanho que processarAchado já
// calculava antes de chamar isto, só que agora aplicado
// dentro do próprio download em vez de só como checagem prévia de
// node.fileLength.
export async function baixarBuffer (client, node, tipo, maxBytes) {
  const tamanhoInformado = Number(node?.fileLength?.toString?.() ?? node?.fileLength)
  const estimativa = Number.isFinite(tamanhoInformado) && tamanhoInformado > 0
    ? tamanhoInformado
    : maxBytes
  await bandwidth.aguardarDownload(estimativa)
  const bytes = await client.message.downloadBytes({ [`${tipo}Message`]: node }, { maxBytes })
  state.incr('bytesBaixados', bytes.length)
  return Buffer.from(bytes)
}

export function extensaoDe (tipo, mimetype = '') {
  if (tipo === 'image') return mimetype.includes('png') ? '.png' : '.jpg'
  if (tipo === 'video') return '.mp4'
  return mimetype.includes('mpeg') ? '.mp3' : '.ogg'
}
