// Testes do comando /transcrever e do reconhecedor de áudio direto.
import { acharAudioDireto, acharComandoTranscrever } from '../src/visu.js'

const aud = { url: 'x', mediaKey: 'k', mimetype: 'audio/ogg; codecs=opus', ptt: true }
const quotedAudio = { audioMessage: aud }
const quotedImagem = { imageMessage: { url: 'x' } }

const casosComando = [
  [
    'reconhece /transcrever com áudio citado',
    { extendedTextMessage: { text: '/transcrever', contextInfo: { quotedMessage: quotedAudio, stanzaId: 'A1' } } },
    { quotedMessage: quotedAudio, stanzaId: 'A1' }
  ],
  [
    'aceita variação de caixa/espaços',
    { extendedTextMessage: { text: '  /Transcrever  ', contextInfo: { quotedMessage: quotedAudio, stanzaId: 'A2' } } },
    { quotedMessage: quotedAudio, stanzaId: 'A2' }
  ],
  ['não confunde com /recover', { extendedTextMessage: { text: '/recover', contextInfo: { quotedMessage: quotedAudio } } }, null],
  ['sem quotedMessage', { extendedTextMessage: { text: '/transcrever', contextInfo: {} } }, null],
  ['mensagem normal', { conversation: '/transcrever' }, null]
]

let falhas = 0
for (const [nome, msg, esp] of casosComando) {
  const got = acharComandoTranscrever(msg)
  const ok = esp === null ? got === null : got && got.stanzaId === esp.stanzaId && got.quotedMessage === esp.quotedMessage
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
}

const casosAudio = [
  ['acha áudio direto', quotedAudio, aud],
  ['ignora imagem', quotedImagem, null],
  ['dentro de ephemeral', { ephemeralMessage: { message: quotedAudio } }, aud],
  ['mensagem vazia', null, null]
]

for (const [nome, msg, esp] of casosAudio) {
  const got = acharAudioDireto(msg)
  const ok = got === esp
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\n/TRANSCREVER OK')
process.exit(falhas ? 1 : 0)
