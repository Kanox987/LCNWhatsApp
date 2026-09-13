// Tradução LID <-> telefone. O problema real que isto resolve: uma menção
// (@fulano) chega num formato só, às vezes o identificador interno do
// WhatsApp, e sem traduzir "/adv @fulano" não casava com o contato salvo.
//
// A solução não custa rede: toda mensagem recebida já traz os dois formatos da
// mesma pessoa na chave, então basta memorizar o que passa pela porta.
import fs from 'fs'
import os from 'os'
import path from 'path'

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-lid-'))
const arquivoTeste = path.join(pastaTeste, 'lid-map.json')

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const lidMap = await import('../src/lidMap.js')
// Nunca tocar no data/ real do checkout.
lidMap._reiniciarParaTeste(arquivoTeste)
const { construirEventoDeMensagem } = await import('../src/engine/zapoAdapter.js')

const LID = '123456789012345@lid'
const TELEFONE = '5511999999999@s.whatsapp.net'
const OUTRO_LID = '999888777666555@lid'
const OUTRO_TELEFONE = '5511911111111@s.whatsapp.net'

// --- aprendizado do par ----------------------------------------------------
check('LID desconhecido volta como veio (nunca inventa número)', lidMap.paraTelefone(LID) === LID)
check('telefone passa direto', lidMap.paraTelefone(TELEFONE) === TELEFONE)

check('aprende o par na ordem lid, telefone', lidMap.registrarPar(LID, TELEFONE) === true)
check('depois de aprender, o LID vira telefone', lidMap.paraTelefone(LID) === TELEFONE)
check('aprender o mesmo par de novo não é mudança', lidMap.registrarPar(LID, TELEFONE) === false)
check('aprende também na ordem invertida', lidMap.registrarPar(OUTRO_TELEFONE, OUTRO_LID) === true)
check('tradução funciona no par invertido', lidMap.paraTelefone(OUTRO_LID) === OUTRO_TELEFONE)

check('dois telefones não formam par', lidMap.registrarPar(TELEFONE, OUTRO_TELEFONE) === false)
check('dois LIDs não formam par', lidMap.registrarPar(LID, OUTRO_LID) === false)
check('valor vazio não quebra', lidMap.registrarPar(null, TELEFONE) === false && lidMap.paraTelefone(null) === null)

// Sufixo de dispositivo: a mesma pessoa em outro aparelho é a mesma pessoa.
check('ignora o sufixo de dispositivo ao traduzir', lidMap.paraTelefone('123456789012345:12@lid') === TELEFONE)

// --- aprende sozinho da chave de uma mensagem real -------------------------
lidMap._reiniciarParaTeste(arquivoTeste)
const CHAVE_GRUPO = {
  remoteJid: '120000000000000001@g.us',
  isGroup: true,
  id: 'msg-1',
  participant: LID,
  participantAlt: TELEFONE
}
lidMap.aprenderDaChave(CHAVE_GRUPO)
check('aprende o par a partir da chave de uma mensagem de grupo', lidMap.paraTelefone(LID) === TELEFONE)

// Num grupo, remoteJid é o GRUPO — associá-lo a alguém seria errado.
lidMap.aprenderDaChave({ remoteJid: '120000000000000002@g.us', isGroup: true, remoteJidAlt: OUTRO_TELEFONE })
check('num grupo, o JID do grupo nunca vira par de uma pessoa', lidMap.paraTelefone('120000000000000002@g.us') === '120000000000000002@g.us')

lidMap.aprenderDaChave({ remoteJid: OUTRO_LID, remoteJidAlt: OUTRO_TELEFONE, isGroup: false })
check('em conversa direta, o par do próprio chat é aprendido', lidMap.paraTelefone(OUTRO_LID) === OUTRO_TELEFONE)

// --- o ganho real: a menção passa a casar --------------------------------
const evento = construirEventoDeMensagem({
  key: { remoteJid: '120000000000000001@g.us', isGroup: true, id: 'msg-2', participant: LID, participantAlt: TELEFONE },
  message: {
    extendedTextMessage: {
      text: '/adv @fulano',
      contextInfo: { mentionedJid: [OUTRO_LID] }
    }
  }
}, { accountId: 'acc-1', recebidoEmMs: Date.now() })

check('a menção chega ao motor já como telefone, não como LID', evento.message.mentions?.[0] === OUTRO_TELEFONE, evento.message.mentions?.[0])
check('quem enviou também vem como telefone', evento.sender.id === TELEFONE)

// Menção de alguém que o bot nunca viu falar: volta como veio, sem inventar.
const eventoDesconhecido = construirEventoDeMensagem({
  key: { remoteJid: '120000000000000001@g.us', isGroup: true, id: 'msg-3', participant: LID, participantAlt: TELEFONE },
  message: { extendedTextMessage: { text: '/adv @novo', contextInfo: { mentionedJid: ['555444333222111@lid'] } } }
}, { accountId: 'acc-1', recebidoEmMs: Date.now() })
check('menção de quem nunca falou volta como veio (sem inventar telefone)', eventoDesconhecido.message.mentions?.[0] === '555444333222111@lid')

// --- persistência ----------------------------------------------------------
lidMap.gravarAgora()
const existe = fs.existsSync(arquivoTeste)
check('o mapa é gravado em disco', existe)
if (existe) {
  const salvo = JSON.parse(fs.readFileSync(arquivoTeste, 'utf8'))
  check('o arquivo guarda os pares aprendidos', salvo.lidParaTelefone?.[LID] === TELEFONE)
  const modo = fs.statSync(arquivoTeste).mode & 0o777
  check('o arquivo não fica legível por outros usuários da máquina', modo === 0o600, modo.toString(8))
}

lidMap._reiniciarParaTeste(arquivoTeste)
check('depois de reiniciar, o mapa volta do disco', lidMap.paraTelefone(LID) === TELEFONE)

fs.rmSync(pastaTeste, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE TRADUÇÃO LID PASSARAM')
process.exit(falhas ? 1 : 0)
