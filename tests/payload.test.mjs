// Garante que o payload de saída NUNCA contém viewOnce (fix do bug).
import { montarConteudo } from '../src/capture.js'

let falhas = 0
function check(nome, cond){ if(!cond)falhas++; console.log(`${cond?'✅':'❌'} ${nome}`) }

const buf = Buffer.from('abc')
for (const tipo of ['image', 'video', 'audio']) {
  const c = montarConteudo(tipo, buf, 'legenda', { mimetype: 'image/jpeg', viewOnce: true, mediaKey: 'k' })
  const chaves = Object.keys(c)
  check(`${tipo}: sem chave viewOnce`, !('viewOnce' in c))
  check(`${tipo}: sem mediaKey vazando`, !('mediaKey' in c))
  check(`${tipo}: JSON não menciona viewOnce`, !JSON.stringify({ ...c, [tipo]: 'buf', image: 'buf', video: 'buf', audio: 'buf' }).includes('viewOnce'))
  check(`${tipo}: tem o buffer certo`, c[tipo] === buf)
}
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nPAYLOAD OK (mídia normal, sem viewOnce)')
process.exit(falhas ? 1 : 0)
