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

// Bug real de produção: com addressingMode "lid" (comum hoje em dia), o
// remoteJid cru é o LID, não o número salvo em downloadAutomatico.conversas —
// passar o LID direto pra estaDownloadAutomatico nunca bate (log de produção
// mostrou "Download automático" nunca disparando nem uma vez, pra contato
// corretamente marcado). O fix em src/capture.js passa a resolver o número de
// telefone (participantAlt/remoteJidAlt) antes de checar; aqui replicamos essa
// mesma resolução com o shape real visto em produção pra travar o
// comportamento esperado.
const keyLid = { remoteJid: '207082099871978@lid', remoteJidAlt: '5522981126942@s.whatsapp.net', participant: '', addressingMode: 'lid' }
const jidRealLid = keyLid.participantAlt || keyLid.remoteJidAlt || keyLid.participant || keyLid.remoteJid
check('LID cru (remoteJid) NÃO bate com número salvo — por isso o fix não pode usar `from` puro', estaDownloadAutomatico(cfg, keyLid.remoteJid) === false)
check('resolvendo pro número real (remoteJidAlt) antes, o contato marcado é reconhecido', estaDownloadAutomatico({ captura: { downloadAutomatico: { conversas: ['5522981126942'] } } }, jidRealLid) === true)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nDOWNLOAD AUTOMÁTICO OK')
process.exit(falhas ? 1 : 0)
