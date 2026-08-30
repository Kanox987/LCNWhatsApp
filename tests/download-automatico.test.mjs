// Testa o helper puro estaDownloadAutomatico: contato marcado por número,
// grupo marcado por JID, e conversa não marcada.
import { estaDownloadAutomatico } from '../src/capture.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const cfg = {
  captura: {
    downloadAutomatico: {
      conversas: ['5511999999999', '120363043973693733@g.us'],
      autoDelete: false
    }
  }
}

check('contato marcado (número puro) é reconhecido', estaDownloadAutomatico(cfg, '5511999999999') === true)
check('contato marcado (JID completo) é reconhecido', estaDownloadAutomatico(cfg, '5511999999999@s.whatsapp.net') === true)
check('grupo marcado (JID cru) é reconhecido', estaDownloadAutomatico(cfg, '120363043973693733@g.us') === true)
check('contato não marcado retorna false', estaDownloadAutomatico(cfg, '5511888888888') === false)
check('grupo não marcado retorna false', estaDownloadAutomatico(cfg, '999999999999999@g.us') === false)
check('config sem downloadAutomatico não quebra (retorna false)', estaDownloadAutomatico({ captura: {} }, '5511999999999') === false)
check('config totalmente vazia não quebra (retorna false)', estaDownloadAutomatico({}, '5511999999999') === false)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nDOWNLOAD AUTOMÁTICO OK')
process.exit(falhas ? 1 : 0)
