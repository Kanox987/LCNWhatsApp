// Parte pura do modelo de evento canônico: nada de I/O, nada de zapo-js
// aqui — só transformação de dados, fácil de testar sem client nenhum. O
// mapeamento de campo específico do Zapo mora em zapoAdapter.js.
import { desembrulhar, acharVisuUnica, acharAudioDireto } from '../visu.js'

// Id determinístico POR GATEWAY: mesma mensagem, mesmo id, sempre — é o que
// dá idempotência pro motor (Etapa 3+) sem precisar de estado extra aqui.
// NÃO resolve (de propósito, fica em aberto até a Etapa 5) a dúvida de
// "o event.key.id da MESMA mensagem de grupo chega igual em contas
// diferentes?" — isso só é testável com duas contas reais pareadas.
export function calcularEventId ({ accountId, chatId, senderId, providerMessageId }) {
  return `${accountId}:${chatId}:${senderId}:${providerMessageId}`
}

// Reaproveita os helpers JÁ TESTADOS de visu.js em vez de reimplementar
// detecção de formato de protobuf — visu única e áudio têm casos de borda
// (viewOnceMessageV2Extension, envelopes ephemeralMessage/deviceSentMessage)
// que já foram acertados e testados ali; duplicar essa lógica aqui seria
// convidar regressão.
export function classificarMensagem (message, { marcadaComoViewOnce = false } = {}) {
  if (!message) return 'unknown'
  if (acharVisuUnica(message, marcadaComoViewOnce)) return 'view_once'

  const msg = desembrulhar(message)
  if (!msg) return 'unknown'
  if (acharAudioDireto(message)) return 'audio'
  if (msg.imageMessage) return 'image'
  if (msg.videoMessage) return 'video'
  if (msg.documentMessage) return 'document'
  if (msg.extendedTextMessage || typeof msg.conversation === 'string') return 'text'
  return 'unknown'
}

// Checagem de forma só pra teste/fixture — não é o JSON Schema de verdade
// (isso é o documento de automação, Etapa 2); é só uma rede de segurança
// pra pegar typo/campo faltando nos testes deste módulo.
export function validarFormaCanonica (evt) {
  const camposObrigatorios = ['provider', 'accountId', 'eventId', 'occurredAt', 'replay', 'chat', 'sender', 'message', 'providerRef']
  return camposObrigatorios.every((campo) => campo in evt)
}
