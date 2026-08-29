// Testes do comando /recover (recuperação manual via mensagem citada).
import { acharComandoRecover } from '../src/visu.js'

const img = { url: 'x', mediaKey: 'k', mimetype: 'image/jpeg', caption: 'oi' }
const quotedMsg = { viewOnceMessageV2: { message: { imageMessage: img } } }

const casos = [
  [
    'reconhece /recover com citação',
    {
      extendedTextMessage: {
        text: '/recover',
        contextInfo: { quotedMessage: quotedMsg, stanzaId: 'ABC123', participant: '5511999999999@s.whatsapp.net' }
      }
    },
    { quotedMessage: quotedMsg, stanzaId: 'ABC123', participant: '5511999999999@s.whatsapp.net' }
  ],
  [
    'aceita variação de caixa/espaços',
    { extendedTextMessage: { text: '  /Recover  ', contextInfo: { quotedMessage: quotedMsg, stanzaId: 'X' } } },
    { quotedMessage: quotedMsg, stanzaId: 'X', participant: undefined }
  ],
  [
    'dentro de ephemeral',
    {
      ephemeralMessage: {
        message: {
          extendedTextMessage: { text: '/recover', contextInfo: { quotedMessage: quotedMsg, stanzaId: 'Y' } }
        }
      }
    },
    { quotedMessage: quotedMsg, stanzaId: 'Y', participant: undefined }
  ],
  ['texto diferente', { extendedTextMessage: { text: '/outro', contextInfo: { quotedMessage: quotedMsg } } }, null],
  ['sem contextInfo', { extendedTextMessage: { text: '/recover' } }, null],
  ['sem quotedMessage', { extendedTextMessage: { text: '/recover', contextInfo: {} } }, null],
  ['mensagem normal', { conversation: '/recover' }, null],
  ['mensagem vazia', null, null]
]

let falhas = 0
for (const [nome, msg, esp] of casos) {
  const got = acharComandoRecover(msg)
  const ok = esp === null
    ? got === null
    : got && got.stanzaId === esp.stanzaId && got.participant === esp.participant && got.quotedMessage === esp.quotedMessage
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\n/RECOVER OK')
process.exit(falhas ? 1 : 0)
