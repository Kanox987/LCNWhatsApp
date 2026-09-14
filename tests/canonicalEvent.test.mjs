// Etapa 1 do motor de automação (Parte B do plano): modelo de evento
// canônico (src/engine/canonicalEvent.js) + adaptador Zapo real
// (src/engine/zapoAdapter.js). Fixtures construídas direto a partir das
// formas reais confirmadas em node_modules/zapo-js/dist/client/types.d.ts.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { classificarMensagem, calcularEventId, validarFormaCanonica } from '../src/engine/canonicalEvent.js'
import * as diretorio from '../src/directory.js'
import { construirEventoDeMensagem, construirEventoDeIndisponivel } from '../src/engine/zapoAdapter.js'
import { resolver } from '../src/engine/mediaRefCache.js'

// O adaptador agora LEMBRA o nome de quem já falou (é o que faz
// {{sender.name}} valer sempre). Isso significa que ele escreve no diretório —
// então o teste precisa de pasta própria, nunca o data/ do checkout.
const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-evento-'))
diretorio._usarPastaParaTeste(pastaTeste)

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

// --- nome de exibição (pushName) -----------------------------------------
// O nome que a pessoa escolheu aparecer. Já vinha na fixture e no evento real
// do Zapo; o adaptador simplesmente descartava, então {{sender.name}} não
// tinha de onde sair.
check('DM texto: sender.name vem do pushName', eventoTexto.sender.name, 'Fulano')

// --- número da própria conta ---------------------------------------------
// accountId é o id da INSTÂNCIA (um UUID); o número só o gateway conhece, e
// por isso chega como opção em vez de ser deduzido do evento.
const comBot = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'BOT1', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' }
}, { accountId: 'acc-1', botId: '5511777@s.whatsapp.net' })
check('bot.id traz o número da própria conta', comBot.bot.id, '5511777@s.whatsapp.net')
checkBool('sem botId o campo bot nem existe (placeholder fica literal)', !('bot' in eventoTexto))

// Número nunca visto: de quem já falou, o nome é lembrado de propósito (ver
// GARANTIA 4 em variaveis-confiaveis.test.mjs).
const semNome = construirEventoDeMensagem({
  key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'SEMNOME', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' }
}, { accountId: 'acc-1' })
// Ausente é ausente: sem a chave, {{sender.name}} fica literal no texto e a
// pessoa percebe. Com string vazia, a saudação sairia com um buraco no meio.
checkBool('sem pushName: o campo name nem existe (placeholder fica literal)', !('name' in semNome.sender))

const nomeSujo = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'SUJO', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' },
  pushName: '  Ana\u0000\u001bMaria\u007f  '
}, { accountId: 'acc-1' })
check('nome com caractere de controle é limpo antes de entrar', nomeSujo.sender.name, 'AnaMaria')

const nomeGigante = construirEventoDeMensagem({
  key: { remoteJid: '5511999@s.whatsapp.net', id: 'GIGANTE', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' },
  pushName: 'A'.repeat(400)
}, { accountId: 'acc-1' })
checkBool('nome absurdamente longo é cortado', nomeGigante.sender.name.length === 60)

const nomeSoEspaco = construirEventoDeMensagem({
  key: { remoteJid: '5511000000002@s.whatsapp.net', id: 'BRANCO', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' },
  pushName: '   '
}, { accountId: 'acc-1' })
checkBool('nome só com espaço conta como ausente', !('name' in nomeSoEspaco.sender))

// E o outro lado da moeda: quem JÁ falou uma vez continua tendo nome mesmo
// quando o WhatsApp não manda na mensagem seguinte. Número próprio de
// propósito — os casos acima reusam 5511999 e vão sobrescrevendo o nome dele.
const PRIMEIRA = '5511000000003@s.whatsapp.net'
construirEventoDeMensagem({
  key: { remoteJid: PRIMEIRA, id: 'ANTES', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' },
  pushName: 'Carla'
}, { accountId: 'acc-1' })
const jaFalou = construirEventoDeMensagem({
  key: { remoteJid: PRIMEIRA, id: 'DEPOIS', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'de novo' }
}, { accountId: 'acc-1' })
check('nome de quem já falou é lembrado na mensagem sem pushName', jaFalou.sender.name, 'Carla')

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

diretorio._usarPastaParaTeste()
fs.rmSync(pastaTeste, { recursive: true, force: true })

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE EVENTO CANÔNICO PASSARAM')
process.exit(falhas ? 1 : 0)
