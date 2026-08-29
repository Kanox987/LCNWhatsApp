// Testes de detecção de visu única (11 casos).
import { acharVisuUnica } from '../src/visu.js'

const img = { url: 'x', mediaKey: 'k', mimetype: 'image/jpeg', viewOnce: true, caption: 'oi' }
const vid = { url: 'x', mediaKey: 'k', mimetype: 'video/mp4', viewOnce: true, seconds: 5 }
const aud = { url: 'x', mediaKey: 'k', mimetype: 'audio/ogg; codecs=opus', viewOnce: true, ptt: true }

const casos = [
  ['viewOnceMessageV2 imagem', { viewOnceMessageV2: { message: { imageMessage: img } } }, 'image'],
  ['viewOnceMessageV2 video', { viewOnceMessageV2: { message: { videoMessage: vid } } }, 'video'],
  ['viewOnceMessage antigo', { viewOnceMessage: { message: { imageMessage: img } } }, 'image'],
  ['V2Extension audio', { viewOnceMessageV2Extension: { message: { audioMessage: aud } } }, 'audio'],
  ['flag solta imagem', { imageMessage: img }, 'image'],
  ['dentro de ephemeral', { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: img } } } } }, 'image'],
  ['deviceSent+viewOnce', { deviceSentMessage: { message: { viewOnceMessageV2: { message: { videoMessage: vid } } } } }, 'video'],
  ['imagem normal', { imageMessage: { ...img, viewOnce: false } }, null],
  ['texto', { conversation: 'ola' }, null],
  ['sticker', { stickerMessage: { url: 'x' } }, null],
  ['imagem sem prop', { imageMessage: { url: 'x', mimetype: 'image/jpeg' } }, null]
]

let falhas = 0
for (const [nome, msg, esp] of casos) {
  const r = acharVisuUnica(msg)
  const got = r?.tipo ?? null
  const ok = got === esp
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome.padEnd(24)} exp=${esp} got=${got}`)
}
// key.isViewOnce reforço
const r2 = acharVisuUnica({ imageMessage: { url: 'x', mimetype: 'image/jpeg' } }, true)
const ok2 = r2?.tipo === 'image'
if (!ok2) falhas++
console.log(`${ok2 ? '✅' : '❌'} key.isViewOnce reforça      exp=image got=${r2?.tipo ?? null}`)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nDETECÇÃO OK')
process.exit(falhas ? 1 : 0)
