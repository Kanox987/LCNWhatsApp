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
// Os tipos que uma automação consegue casar.
//
// Espelha `inputPolicy.acceptedMessageKinds` do schema — e um teste falha se as
// duas listas divergirem, porque a divergência aqui é invisível: a automação
// salva, valida, publica e nunca dispara.
//
// Existe para o GATEWAY poder descartar o que nunca casaria, e isso não é
// economia de tráfego: é correção. O WhatsApp entrega a mesma mensagem em duas
// etapas — um esboço antes de decifrar (`unknown`), e depois o conteúdo. Os
// dois viram evento com o MESMO eventId, derivado do id da mensagem.
//
// Aí o at-most-once faz exatamente o que promete: vê o id repetido e devolve o
// resultado da primeira avaliação. Como a primeira foi o esboço vazio, o
// comando de verdade é descartado em silêncio. Num teste real, 39% dos eventos
// eram esses esboços, e um "/ping" mandado em grupo simplesmente não respondia.
//
// `unavailable` entra pelo mesmo motivo: chega antes do reenvio da mensagem
// real e ocuparia o id do mesmo jeito.
export const TIPOS_QUE_CASAM = Object.freeze(['text', 'audio', 'image', 'video', 'document', 'view_once', 'sticker'])

export function tipoPodeCasar (kind) {
  return TIPOS_QUE_CASAM.includes(kind)
}

export function classificarMensagem (message, { marcadaComoViewOnce = false } = {}) {
  if (!message) return 'unknown'
  if (acharVisuUnica(message, marcadaComoViewOnce)) return 'view_once'

  const msg = desembrulhar(message)
  if (!msg) return 'unknown'
  if (acharAudioDireto(message)) return 'audio'
  if (msg.imageMessage) return 'image'
  if (msg.videoMessage) return 'video'
  if (msg.documentMessage) return 'document'
  // FIGURINHA É MÍDIA, e não era.
  //
  // Sem esta linha ela caía em 'unknown', e o gateway descartava o evento
  // antes do motor ver qualquer coisa — então uma figurinha era literalmente
  // invisível para o sistema. É o que impedia os três comandos que trabalham
  // em cima de figurinha: virar imagem, virar gif, e trocar pacote e autor.
  if (msg.stickerMessage) return 'sticker'
  if (msg.extendedTextMessage || typeof msg.conversation === 'string') return 'text'
  // BOTÃO APERTADO É TEXTO.
  //
  // Quem toca um botão está dizendo a mesma coisa que quem digita — e o
  // sistema não ouvia: a resposta caía em 'unknown' e o gateway descartava
  // antes do motor ver. Era por isso que a lista do /menu não fazia nada ao
  // ser tocada, e é o que o carrossel de busca precisa para o botão "baixar"
  // virar o comando de baixar.
  //
  // O TEXTO É O ID DO BOTÃO, não o rótulo: o rótulo é para a pessoa ler
  // ("⬇️ Baixar"), o id é o que o bot escreveu quando montou o botão
  // ("/play https://..."). Ver `textoDeResposta` no adaptador.
  if (ehRespostaDeBotao(msg)) return 'text'
  return 'unknown'
}

// Checagem de forma só pra teste/fixture — não é o JSON Schema de verdade
// (isso é o documento de automação, Etapa 2); é só uma rede de segurança
// pra pegar typo/campo faltando nos testes deste módulo.
// As três formas de responder tocando em vez de digitar. São três porque o
// WhatsApp mudou de formato duas vezes e as três continuam chegando: botão
// clássico, linha de lista e botão de fluxo nativo (o do carrossel).
export function ehRespostaDeBotao (msg) {
  return Boolean(
    msg?.buttonsResponseMessage ||
    msg?.listResponseMessage ||
    msg?.interactiveResponseMessage ||
    // A quarta forma: botão de MODELO. É a que alguns clientes mandam no lugar
    // do fluxo nativo, e cair em `unknown` significa o bot ignorar o toque.
    msg?.templateButtonReplyMessage
  )
}

export function validarFormaCanonica (evt) {
  const camposObrigatorios = ['provider', 'accountId', 'eventId', 'occurredAt', 'replay', 'chat', 'sender', 'message', 'providerRef']
  return camposObrigatorios.every((campo) => campo in evt)
}
