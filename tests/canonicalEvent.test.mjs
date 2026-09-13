// Etapa 1 do motor de automação (Parte B do plano): modelo de evento
// canônico (src/engine/canonicalEvent.js) + adaptador Zapo real
// (src/engine/zapoAdapter.js). Fixtures construídas direto a partir das
// formas reais confirmadas em node_modules/zapo-js/dist/client/types.d.ts.
import { classificarMensagem, calcularEventId, validarFormaCanonica } from '../src/engine/canonicalEvent.js'
import { construirEventoDeMensagem, construirEventoDeIndisponivel } from '../src/engine/zapoAdapter.js'
import { resolver } from '../src/engine/mediaRefCache.js'

let falhas = 0
const check = (nome, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
  if (!ok) console.log(`   exp=${JSON.stringify(exp)} got=${JSON.stringify(got)}`)
}
const checkBool = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

// --- classificarMensagem ---
check('texto simples (conversation)', classificarMensagem({ conversation: 'oi' }), 'text')
check('texto estendido (extendedTextMessage)', classificarMensagem({ extendedTextMessage: { text: 'oi' } }), 'text')
check('imagem inline (não view-once)', classificarMensagem({ imageMessage: { url: 'x', viewOnce: false } }), 'image')
check('áudio inline', classificarMensagem({ audioMessage: { url: 'x' } }), 'audio')
check('visu única (viewOnceMessageV2)', classificarMensagem({ viewOnceMessageV2: { message: { imageMessage: { url: 'x', viewOnce: true } } } }), 'view_once')
check('mensagem vazia/nula', classificarMensagem(null), 'unknown')
check('sticker (tipo sem categoria própria ainda)', classificarMensagem({ stickerMessage: { url: 'x' } }), 'unknown')

// --- calcularEventId: determinístico, por gateway ---
const args = { accountId: 'acc-1', chatId: '123@g.us', senderId: '456@s.whatsapp.net', providerMessageId: 'ABC' }
check('eventId é determinístico (mesma entrada, mesmo id)', calcularEventId(args), calcularEventId({ ...args }))
checkBool('eventId muda se o providerMessageId mudar', calcularEventId(args) !== calcularEventId({ ...args, providerMessageId: 'OUTRO' }))

// --- construirEventoDeMensagem: DM texto ---
const eventoTexto = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'MSG1', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi, tudo bem?' },
  timestampSeconds: 1893456000,
  pushName: 'Fulano'
}, { accountId: 'acc-1', recebidoEmMs: 1893456000123 })
checkBool('DM texto: forma canônica válida', validarFormaCanonica(eventoTexto))
check('DM texto: chat.kind = direct', eventoTexto.chat.kind, 'direct')
check('DM texto: message.kind = text', eventoTexto.message.kind, 'text')
check('DM texto: texto extraído certo', eventoTexto.message.text, 'oi, tudo bem?')
check('DM texto: sender.id cai pro remoteJid (sem alt)', eventoTexto.sender.id, '5511999@s.whatsapp.net')
check('DM texto: sender.authoredBySelf = false', eventoTexto.sender.authoredBySelf, false)
checkBool('DM texto: sem mediaRef (não é mídia)', eventoTexto.message.mediaRef === undefined)
check('DM texto: receivedAtMs repassa o valor do gateway (t0 pra latência)', eventoTexto.receivedAtMs, 1893456000123)

const eventoSemRecebidoEmMs = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'MSG1B', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' }
}, { accountId: 'acc-1' })
checkBool('DM texto: sem recebidoEmMs explícito, cai pra Date.now() (número válido)', typeof eventoSemRecebidoEmMs.receivedAtMs === 'number')

// --- comando em grupo, sender via participantAlt (LID vs PN) ---
const eventoGrupo = construirEventoDeMensagem({
  key: {
    remoteJid: '120363000000000000@g.us', id: 'MSG2', fromMe: false,
    isGroup: true, isBroadcast: false, isNewsletter: false,
    participant: '999999999@lid', participantAlt: '5511988888888@s.whatsapp.net'
  },
  message: { extendedTextMessage: { text: '/clima' } }
}, { accountId: 'acc-1' })
check('grupo: chat.kind = group', eventoGrupo.chat.kind, 'group')
check('grupo: sender.id usa participantAlt (PN), não o LID cru', eventoGrupo.sender.id, '5511988888888@s.whatsapp.net')
check('grupo: chat.id continua o JID do grupo (sem alt aplicável)', eventoGrupo.chat.id, '120363000000000000@g.us')

// --- DM onde o Zapo entrega remoteJid como LID (achado real testando /ping
// ao vivo: scope.include configurado com o JID de telefone nunca casava
// porque chat.id ficava com o LID cru enquanto sender.id já vinha
// normalizado por remoteJidAlt) ---
const eventoDmComLid = construirEventoDeMensagem({
  key: {
    remoteJid: '224867676901549@lid', remoteJidAlt: '5522981197896@s.whatsapp.net',
    id: 'MSG4', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false
  },
  message: { conversation: '/ping' }
}, { accountId: 'acc-1' })
check('DM com LID: chat.id usa remoteJidAlt (PN), não o LID cru', eventoDmComLid.chat.id, '5522981197896@s.whatsapp.net')
check('DM com LID: sender.id bate com chat.id (é a mesma pessoa)', eventoDmComLid.sender.id, eventoDmComLid.chat.id)

// --- imagem view-once: mediaRef precisa ser um token opaco, nunca o node cru ---
const nodeImagem = { url: 'x', mediaKey: 'segredo-de-verdade', directPath: '/v/abc', mimetype: 'image/jpeg' }
const eventoViewOnce = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'MSG3', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false, isViewOnce: true },
  message: { viewOnceMessageV2: { message: { imageMessage: nodeImagem } } }
}, { accountId: 'acc-1' })
check('view-once: message.kind = view_once', eventoViewOnce.message.kind, 'view_once')
checkBool('view-once: mediaRef existe', !!eventoViewOnce.message.mediaRef)
checkBool('view-once: mediaRef é STRING (token), não objeto', typeof eventoViewOnce.message.mediaRef === 'string')
checkBool('view-once: mediaRef não expõe mediaKey em texto', !JSON.stringify(eventoViewOnce.message.mediaRef).includes('segredo-de-verdade'))
const resolvido = resolver(eventoViewOnce.message.mediaRef)
checkBool('view-once: token resolve de volta pro node real (mesmo processo)', resolvido?.node?.mediaKey === 'segredo-de-verdade')

// --- áudio dentro de viewOnceMessageV2Extension ---
const eventoAudioViewOnce = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'MSG4', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { viewOnceMessageV2Extension: { message: { audioMessage: { url: 'x', mediaKey: 'outro-segredo' } } } }
}, { accountId: 'acc-1' })
check('áudio em visu única: message.kind = view_once', eventoAudioViewOnce.message.kind, 'view_once')
checkBool('áudio em visu única: mediaRef também é token opaco', typeof eventoAudioViewOnce.message.mediaRef === 'string')

// --- message_unavailable: nunca tem message, nunca tem mediaRef/text ---
const eventoIndisponivel = construirEventoDeIndisponivel({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'MSG5', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  kind: 'view_once',
  resendRequested: false
}, { accountId: 'acc-1' })
checkBool('unavailable: forma canônica válida', validarFormaCanonica(eventoIndisponivel))
check('unavailable: message.kind = unavailable', eventoIndisponivel.message.kind, 'unavailable')
checkBool('unavailable: sem mediaRef', eventoIndisponivel.message.mediaRef === undefined)
checkBool('unavailable: sem text', eventoIndisponivel.message.text === undefined)

// --- replay (offline catch-up) ---
const eventoReplay = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'MSG6', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'mensagem antiga' },
  offline: true
}, { accountId: 'acc-1' })
check('offline:true vira replay:true', eventoReplay.replay, true)

// --- citação (quotedRef) sem vazar o conteúdo citado ---
const eventoComCitacao = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'MSG7', fromMe: true, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: {
    extendedTextMessage: {
      text: '/recover',
      contextInfo: { stanzaId: 'CITADA1', participant: '5511977@s.whatsapp.net', quotedMessage: { imageMessage: { mediaKey: 'segredo-citado' } } }
    }
  }
}, { accountId: 'acc-1' })
checkBool('citação: quotedRef existe', !!eventoComCitacao.message.quotedRef)
check('citação: quotedRef.id é o stanzaId citado', eventoComCitacao.message.quotedRef.id, 'CITADA1')
checkBool('citação: quotedRef NÃO carrega o conteúdo citado (só endereçamento)', !JSON.stringify(eventoComCitacao.message.quotedRef).includes('segredo-citado'))

// --- resiliência: nunca lança em evento malformado/mínimo ---
let lancouEmEventoMinimo = false
try {
  construirEventoDeMensagem({ key: {} }, { accountId: 'acc-1' })
} catch { lancouEmEventoMinimo = true }
checkBool('evento com key vazio não lança exceção', !lancouEmEventoMinimo)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE EVENTO CANÔNICO PASSARAM')
process.exit(falhas ? 1 : 0)
