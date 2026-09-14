// Mapeamento de campo REAL do Zapo pro evento canônico (verificado contra
// node_modules/zapo-js/dist/client/types.d.ts, não é suposição). Só isto
// importa zapo-adjacent concepts (formato de event.key/event.message) — o
// resto do motor nunca vê essas estruturas cruas.
import { desembrulhar, acharVisuUnica } from '../visu.js'
import { calcularEventId, classificarMensagem } from './canonicalEvent.js'
import * as mediaRefCache from './mediaRefCache.js'
import * as lidMap from '../lidMap.js'
import { nomeDe, registrarContato } from '../directory.js'

// participantAlt/remoteJidAlt têm prioridade sobre o LID cru — mesma
// normalização já usada inline em connection.js, reaproveitada
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

// O texto que a pessoa escreveu — inclusive quando ela escreveu na LEGENDA de
// uma foto, vídeo ou documento.
//
// Isto não é detalhe: mandar a foto com "/fig" embaixo é a forma mais natural
// de usar um comando de mídia, e era o caso em que o bot ficava mudo. A legenda
// nunca chegava ao evento canônico, então `textoCasaComando` recebia
// `undefined` e recusava antes de qualquer outra checagem — sem erro, sem
// registro, sem nada que ajudasse a entender. O código legado
// antigo já lia `node.caption`; só o motor não lia.
function extrairTexto (msg) {
  if (!msg) return undefined
  if (typeof msg.extendedTextMessage?.text === 'string') return msg.extendedTextMessage.text
  if (typeof msg.conversation === 'string') return msg.conversation
  // Áudio não tem legenda; os outros três têm.
  for (const campo of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const legenda = msg[campo]?.caption
    if (typeof legenda === 'string' && legenda) return legenda
  }
  return undefined
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

// O nó de mídia da mensagem, para ler dele o que NÃO é segredo: o tipo real e a
// legenda original. Fica separado do token de propósito — o token continua
// opaco, e `mediaKey`/`directPath` continuam só na memória do gateway.
//
// O tipo importa porque `message.kind` de uma visualização única é literalmente
// 'view_once': não diz se é foto, vídeo ou áudio, e uma legenda de mídia
// recuperada precisa dizer. A legenda importa porque é o que a pessoa escreveu
// junto com a mídia, e some com ela.
function dadosDaMidia (msgBruta, msg, kind, marcadaComoViewOnce) {
  if (kind === 'view_once') {
    const achado = acharVisuUnica(msgBruta, marcadaComoViewOnce)
    return achado ? { mediaKind: achado.tipo, caption: achado.node?.caption } : null
  }
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    const node = msg?.[`${kind}Message`]
    return node ? { mediaKind: kind, caption: node.caption } : null
  }
  return null
}

// Varre os campos da mensagem procurando contextInfo.quotedMessage — mesma
// ideia de acharCitacaoGenerica, mas devolvendo só
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
    // Duas perguntas diferentes, feitas em ordem:
    //   1. a mídia citada é visualização única DE VERDADE? (sem forçar a flag)
    //   2. se não é, ainda assim existe mídia ali?
    // Antes só existia a segunda, com o resultado rotulado `view_once` sempre —
    // então uma foto comum citada viajava mentindo o tipo. O rótulo agora diz a
    // verdade, e quem exige visu única é quem CONSOME (o /recover), não o nome
    // do campo.
    const visu = acharVisuUnica(citada, false)
    const achado = visu || acharVisuUnica(citada, true)
    if (achado) {
      return {
        token: mediaRefCache.criar({ node: achado.node, tipo: achado.tipo, interno: achado.interno }),
        kind: visu ? 'view_once' : 'media',
        mediaKind: achado.tipo,
        ...(typeof achado.node?.caption === 'string' && achado.node.caption ? { caption: achado.node.caption } : {})
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

// O nome de exibição vem do atributo `notify` da stanza: é texto escolhido por
// quem enviou, então chega livre. Corta caractere de controle (que bagunçaria a
// mensagem de saída) e limita o tamanho. Nada aqui vira caminho, comando nem
// decisão de permissão — só entra em saudação.
//
// A limpeza compara codepoint em vez de usar classe de caractere. O padrão
// equivalente escrito com os bytes crus (como em mediaLibrary.js) grava um NUL
// dentro do arquivo-fonte: o arquivo passa a contar como binário para o git e
// basta uma ferramenta normalizar aquilo para o saneador virar outra coisa em
// silêncio. Aconteceu escrevendo justamente esta função.
function semControle (texto) {
  let saida = ''
  for (const caractere of texto) {
    const codigo = caractere.codePointAt(0)
    if (codigo > 31 && codigo !== 127) saida += caractere
  }
  return saida
}

function nomeExibido (event) {
  const bruto = event?.pushName
  if (typeof bruto !== 'string') return null
  const limpo = semControle(bruto).trim()
  return limpo ? limpo.slice(0, 60) : null
}

// O nome de quem enviou, resolvido de forma CONFIÁVEL.
//
// O WhatsApp não manda `pushName` em toda mensagem — mas o nome de exibição
// quase não muda, então lembrar o último que passou resolve o resto. É o que
// tira {{sender.name}} da categoria "às vezes funciona": depois da primeira
// mensagem de alguém, o nome vale sempre, inclusive em grupo.
//
// A mensagem atual sempre ganha do lembrado: se a pessoa trocou de nome, é
// este o momento em que se descobre.
function resolverNome (event, senderId) {
  const agora = nomeExibido(event)
  if (agora) {
    // Guardar aqui (e não só no caminho de conversa direta, como antes) é o
    // que faz o nome de quem fala em GRUPO ser lembrado.
    try { registrarContato(senderId, agora) } catch {}
    return agora
  }
  try { return nomeDe(senderId) } catch { return null }
}

export function construirEventoDeMensagem (event, { accountId, recebidoEmMs, botId }) {
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
  const nomeDeQuemEnviou = resolverNome(event, senderId)

  const mensagem = { kind }
  // Sem amarrar a `kind === 'text'`: uma foto com legenda É uma mensagem com
  // texto, e é assim que se usa comando de mídia. O campo só não aparece quando
  // não há texto nenhum — nunca vira string vazia, que casaria com `prefix`.
  const texto = extrairTexto(msg)
  if (typeof texto === 'string' && texto) mensagem.text = texto
  const mediaRef = construirMediaRef(msgBruta, msg, kind, key.isViewOnce === true)
  if (mediaRef) {
    mensagem.mediaRef = mediaRef
    const dados = dadosDaMidia(msgBruta, msg, kind, key.isViewOnce === true)
    if (dados?.mediaKind) mensagem.mediaKind = dados.mediaKind
    if (typeof dados?.caption === 'string' && dados.caption) mensagem.mediaCaption = dados.caption
  }
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
    // `pushName` é o nome que a própria pessoa escolheu exibir. NEM SEMPRE
    // chega, por isso entra só quando existe: sem o campo, {{sender.name}}
    // fica literal no texto em vez de mandar saudação com um buraco no meio.
    sender: nomeDeQuemEnviou
      ? { id: senderId, authoredBySelf: key.fromMe === true, name: nomeDeQuemEnviou }
      : { id: senderId, authoredBySelf: key.fromMe === true },
    // `bot` é o número da PRÓPRIA conta, que só este lado conhece — accountId
    // é o id da instância (um UUID), não serve para se apresentar a ninguém.
    // Ausente quando a sessão ainda não expôs as credenciais: {{bot.id}} fica
    // literal, em vez de mandar um UUID no lugar de um telefone.
    ...(botId ? { bot: { id: botId } } : {}),
    message: mensagem,
    providerRef: construirProviderRef(key)
  }
}

// message_unavailable NUNCA carrega event.message (confirmado no tipo real,
// WaIncomingUnavailableMessageEvent não tem esse campo) — por isso não tem
// texto nem mediaRef possível, só o fato de que algo chegou e não pôde ser
// processado.
export function construirEventoDeIndisponivel (event, { accountId, recebidoEmMs, botId }) {
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
    ...(botId ? { bot: { id: botId } } : {}),
    message: { kind: 'unavailable' },
    providerRef: construirProviderRef(key)
  }
}
