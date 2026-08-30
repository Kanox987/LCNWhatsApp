// Testes de acharCitacaoGenerica: reconhece QUALQUER citação/resposta, sem
// exigir texto específico (ao contrário de acharComandoRecover/acharComandoTexto).
import { acharCitacaoGenerica } from '../src/visu.js'

const img = { url: 'x', mediaKey: 'k', mimetype: 'image/jpeg', caption: 'oi' }
const quotedMsg = { viewOnceMessageV2: { message: { imageMessage: img } } }

const casos = [
  [
    'texto qualquer citando algo (não precisa ser /recover)',
    {
      extendedTextMessage: {
        text: 'oi, isso é o que eu acho?',
        contextInfo: { quotedMessage: quotedMsg, stanzaId: 'ABC123', participant: '5511999999999@s.whatsapp.net' }
      }
    },
    { quotedMessage: quotedMsg, stanzaId: 'ABC123', participant: '5511999999999@s.whatsapp.net' }
  ],
  [
    'mídia (figurinha) citando algo — contextInfo no próprio nó, não em extendedTextMessage',
    {
      stickerMessage: {
        url: 'y',
        contextInfo: { quotedMessage: quotedMsg, stanzaId: 'STK1' }
      }
    },
    { quotedMessage: quotedMsg, stanzaId: 'STK1', participant: undefined }
  ],
  [
    'dentro de ephemeral',
    {
      ephemeralMessage: {
        message: {
          extendedTextMessage: { text: 'kk', contextInfo: { quotedMessage: quotedMsg, stanzaId: 'Y' } }
        }
      }
    },
    { quotedMessage: quotedMsg, stanzaId: 'Y', participant: undefined }
  ],
  ['sem contextInfo', { extendedTextMessage: { text: 'oi' } }, null],
  ['sem quotedMessage', { extendedTextMessage: { text: 'oi', contextInfo: {} } }, null],
  ['mensagem normal, sem citação', { conversation: 'oi' } , null],
  ['mensagem vazia', null, null]
]

let falhas = 0
for (const [nome, msg, esp] of casos) {
  const got = acharCitacaoGenerica(msg)
  const ok = esp === null
    ? got === null
    : got && got.stanzaId === esp.stanzaId && got.participant === esp.participant && got.quotedMessage === esp.quotedMessage
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nCITAÇÃO GENÉRICA OK')
process.exit(falhas ? 1 : 0)
