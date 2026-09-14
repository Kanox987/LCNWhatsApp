// Dados do grupo no evento canônico: nome, tamanho e quem é admin.
//
// O ponto central aqui é o cache. `queryGroupMetadata` é ida ao servidor do
// WhatsApp; sem cache seria uma chamada de rede POR MENSAGEM de grupo. Mas
// cache de permissão que fica velho é pior que consulta cara — por isso metade
// destes casos é sobre invalidação e sobre falhar aberto.
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as lidMap from '../src/lidMap.js'
import * as groupInfo from '../src/engine/groupInfo.js'

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-grupo-'))
lidMap._reiniciarParaTeste(path.join(pastaTeste, 'lid-map.json'))

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000001@g.us'
const ANA = '5511900000001@s.whatsapp.net'
const BRUNO = '5511900000002@s.whatsapp.net'
const BOT = '5511900000009@s.whatsapp.net'

function clienteFake ({ metadata, falhar = false, demorar = 0 } = {}) {
  const chamadas = []
  return {
    chamadas,
    group: {
      queryGroupMetadata: async (jid) => {
        chamadas.push(jid)
        if (demorar) await new Promise((r) => setTimeout(r, demorar))
        if (falhar) throw new Error('sem resposta do servidor')
        return metadata
      }
    }
  }
}

const metadataPadrao = {
  jid: GRUPO,
  subject: 'Turma do Churrasco',
  size: 3,
  announce: false,
  participants: [
    { jid: ANA, isAdmin: true, lid: '111111111111111@lid', phoneNumber: ANA },
    { jid: BRUNO, isAdmin: false, lid: '222222222222222@lid', phoneNumber: BRUNO },
    { jid: BOT, isAdmin: true, phoneNumber: BOT }
  ]
}

const evento = (senderId) => ({
  chat: { id: GRUPO, kind: 'group' },
  sender: { id: senderId, authoredBySelf: false },
  bot: { id: BOT },
  message: { kind: 'text', text: '/teste' }
})

// --- enriquecimento básico -------------------------------------------------
groupInfo.limparTudo()
const c1 = clienteFake({ metadata: metadataPadrao })
const e1 = await groupInfo.enriquecerEvento(c1, evento(ANA))
check('preenche o nome do grupo', e1.chat.name === 'Turma do Churrasco', e1.chat.name)
check('preenche o tamanho do grupo', e1.chat.size === 3)
check('preenche se só admin pode falar', e1.chat.onlyAdmins === false)
check('admin do grupo é reconhecido', e1.sender.isAdmin === true)
check('reconhece que o próprio bot é admin', e1.bot.isAdmin === true)

const e2 = await groupInfo.enriquecerEvento(c1, evento(BRUNO))
check('quem não é admin fica false', e2.sender.isAdmin === false)

// --- o cache existe para não chamar a rede a cada mensagem -----------------
check('a segunda mensagem não consulta de novo', c1.chamadas.length === 1, `${c1.chamadas.length} chamadas`)

// --- e cai na hora quando alguém é rebaixado ------------------------------
// Sem isto, quem perdeu o cargo continuaria mandando no bot por minutos.
const semAna = {
  ...metadataPadrao,
  participants: metadataPadrao.participants.map((p) => (p.jid === ANA ? { ...p, isAdmin: false } : p))
}
const c2 = clienteFake({ metadata: semAna })
const aindaCacheado = await groupInfo.enriquecerEvento(c2, evento(ANA))
check('sem invalidar, o cache antigo responde', aindaCacheado.sender.isAdmin === true)

groupInfo.invalidar(GRUPO)
const depoisDeRebaixar = await groupInfo.enriquecerEvento(c2, evento(ANA))
check('depois de invalidar, o rebaixamento vale na hora', depoisDeRebaixar.sender.isAdmin === false)
check('invalidar com sufixo de dispositivo também funciona', (groupInfo.invalidar(GRUPO.replace('@', ':12@')), true))

// --- falha aberta: ausente nunca vira "false" -----------------------------
// Um `false` inventado seria indistinguível de "não é admin", e transformaria
// falha de rede em decisão de permissão silenciosa.
groupInfo.limparTudo()
const cFalha = clienteFake({ falhar: true })
const eFalha = await groupInfo.enriquecerEvento(cFalha, evento(ANA))
check('sem metadados, isAdmin nem existe (placeholder fica literal)', !('isAdmin' in eFalha.sender))
check('sem metadados, o nome do grupo nem existe', !('name' in eFalha.chat))
check('a falha não derruba o evento', eFalha.chat.id === GRUPO)

const eFalha2 = await groupInfo.enriquecerEvento(cFalha, evento(ANA))
check('falha fica guardada um pouco para não repetir a chamada', cFalha.chamadas.length === 1, `${cFalha.chamadas.length} chamadas`)

// --- conversa direta não consulta nada ------------------------------------
groupInfo.limparTudo()
const cDireto = clienteFake({ metadata: metadataPadrao })
const eDireto = await groupInfo.enriquecerEvento(cDireto, { chat: { id: ANA, kind: 'direct' }, sender: { id: ANA }, bot: { id: BOT } })
check('conversa direta não consulta dados de grupo', cDireto.chamadas.length === 0)
check('conversa direta não ganha isAdmin', !('isAdmin' in eDireto.sender))

// --- duas mensagens ao mesmo tempo rendem UMA consulta --------------------
groupInfo.limparTudo()
const cParalelo = clienteFake({ metadata: metadataPadrao, demorar: 30 })
const [pa, pb, pc] = await Promise.all([
  groupInfo.enriquecerEvento(cParalelo, evento(ANA)),
  groupInfo.enriquecerEvento(cParalelo, evento(BRUNO)),
  groupInfo.enriquecerEvento(cParalelo, evento(ANA))
])
check('rajada de mensagens no mesmo grupo faz uma consulta só', cParalelo.chamadas.length === 1, `${cParalelo.chamadas.length} chamadas`)
check('todas as mensagens da rajada recebem os dados', pa.chat.name === 'Turma do Churrasco' && pb.sender.isAdmin === false && pc.sender.isAdmin === true)

// --- o mapa LID aprende os pares autoritativos ----------------------------
// Os metadados trazem lid e telefone na mesma linha, inclusive de quem ainda
// não falou — é melhor fonte que aprender mensagem por mensagem.
check('aprende o par LID/telefone dos participantes', lidMap.paraTelefone('111111111111111@lid') === ANA)
check('aprende também de quem nunca escreveu no grupo', lidMap.paraTelefone('222222222222222@lid') === BRUNO)

// --- cliente sem a API não quebra nada ------------------------------------
const eSemApi = await groupInfo.enriquecerEvento({}, evento(ANA))
check('cliente sem queryGroupMetadata não quebra', !('isAdmin' in eSemApi.sender))

// --- admin identificado pelo LID, não só pelo telefone --------------------
groupInfo.limparTudo()
const cLid = clienteFake({ metadata: metadataPadrao })
const eLid = await groupInfo.enriquecerEvento(cLid, evento('111111111111111@lid'))
check('admin é reconhecido mesmo quando o evento traz o LID', eLid.sender.isAdmin === true)

lidMap._reiniciarParaTeste()
fs.rmSync(pastaTeste, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE DADOS DE GRUPO PASSARAM')
process.exit(falhas ? 1 : 0)
