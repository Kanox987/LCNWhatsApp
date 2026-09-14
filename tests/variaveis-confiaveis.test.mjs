// As variáveis precisam VALER, não "às vezes valer".
//
// Este arquivo existe por uma correção do dono: a tela mostrava "Nem sempre
// funciona" em {{bot.id}}, {{sender.name}}, {{sender.isAdmin}}, {{chat.name}} e
// {{bot.isAdmin}}. Uma variável que às vezes resolve é uma variável que ninguém
// pode usar num comando — quem monta não tem como saber se o texto vai sair
// certo ou com um placeholder cru no meio.
//
// Cada caso aqui é uma GARANTIA, não um detalhe de implementação. Se um deles
// falhar, a variável voltou a ser "às vezes".
import fs from 'fs'
import os from 'os'
import path from 'path'

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-vars-'))

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const lidMap = await import('../src/lidMap.js')
lidMap._reiniciarParaTeste(path.join(pastaTeste, 'lid-map.json'))
const diretorio = await import('../src/directory.js')
diretorio._usarPastaParaTeste(pastaTeste)
const groupInfo = await import('../src/engine/groupInfo.js')
const { construirEventoDeMensagem } = await import('../src/engine/zapoAdapter.js')

const GRUPO = '120363000000000077@g.us'
const ANA = '5511900000001@s.whatsapp.net'
const BRUNO = '5511900000002@s.whatsapp.net'
const BOT = '5511900000009@s.whatsapp.net'

const metadata = {
  jid: GRUPO,
  subject: 'Turma do Churrasco',
  size: 3,
  announce: false,
  participants: [
    { jid: ANA, isAdmin: true, lid: '111111111111111@lid', phoneNumber: ANA },
    { jid: BRUNO, isAdmin: false, phoneNumber: BRUNO },
    { jid: BOT, isAdmin: true, phoneNumber: BOT }
  ]
}

function cliente ({ falharConsulta = false, falharLista = false } = {}) {
  const chamadas = { metadata: 0, lista: 0 }
  return {
    chamadas,
    group: {
      queryGroupMetadata: async () => {
        chamadas.metadata++
        if (falharConsulta) throw new Error('sem resposta')
        return metadata
      },
      queryAllGroups: async () => {
        chamadas.lista++
        if (falharLista) throw new Error('sem resposta')
        return [metadata]
      }
    }
  }
}

const eventoDeGrupo = (pushName) => ({
  key: {
    remoteJid: GRUPO, participant: ANA, id: 'M' + Math.random().toString(36).slice(2, 8),
    fromMe: false, isGroup: true, isBroadcast: false, isNewsletter: false
  },
  message: { conversation: '/teste' },
  ...(pushName === undefined ? {} : { pushName })
})

// === GARANTIA 1: mensagem de grupo chega completa ==========================
groupInfo.limparTudo()
const c1 = cliente()
const e1 = await groupInfo.enriquecerEvento(c1, construirEventoDeMensagem(eventoDeGrupo('Ana'), { accountId: 'acc-1', botId: BOT }))
check('numa mensagem de grupo, sender.isAdmin está presente', typeof e1.sender.isAdmin === 'boolean', String(e1.sender.isAdmin))
check('numa mensagem de grupo, bot.isAdmin está presente', typeof e1.bot.isAdmin === 'boolean', String(e1.bot.isAdmin))
check('numa mensagem de grupo, chat.name está presente', typeof e1.chat.name === 'string', e1.chat.name)
check('numa mensagem de grupo, chat.size está presente', typeof e1.chat.size === 'number', String(e1.chat.size))
check('bot.id está presente sempre que há sessão', e1.bot.id === BOT)

// === GARANTIA 2: aquecer na conexão deixa a PRIMEIRA mensagem completa =====
// Sem isto, a primeira mensagem de cada grupo depois de ligar o bot pagaria a
// consulta — e se ela falhasse, sairia sem os dados.
groupInfo.limparTudo()
const c2 = cliente()
await groupInfo.aquecer(c2)
check('aquecer usa uma chamada só para todos os grupos', c2.chamadas.lista === 1 && c2.chamadas.metadata === 0)
const e2 = await groupInfo.enriquecerEvento(c2, construirEventoDeMensagem(eventoDeGrupo('Ana'), { accountId: 'acc-1', botId: BOT }))
check('a primeira mensagem já vem completa, sem consulta extra', c2.chamadas.metadata === 0 && e2.sender.isAdmin === true)

// === GARANTIA 3: renovação que falha NÃO apaga o que se sabia ==============
// Era o pior defeito do desenho anterior: uma queda passageira guardava "nada"
// por 30 segundos, e toda mensagem no meio saía sem isAdmin e sem nome de
// grupo. É o que obrigava a tela a dizer "nem sempre funciona".
//
// Atenção à distinção, que não é detalhe: o último valor conhecido vale quando
// o TTL vence e a RENOVAÇÃO falha — a informação continua sendo a última vista
// no servidor. Ele NÃO vale depois de `invalidar()`, que só é chamado quando o
// dado mudou de verdade (promoveu, rebaixou, entrou, saiu): ali reaproveitar
// seria servir permissão que já se sabe estar errada.
groupInfo.limparTudo()
const bom = cliente()
await groupInfo.enriquecerEvento(bom, construirEventoDeMensagem(eventoDeGrupo('Ana'), { accountId: 'acc-1', botId: BOT }))

const ruim = cliente({ falharConsulta: true })
const daquiSeisMinutos = Date.now() + 6 * 60 * 1000
const aposFalha = await groupInfo.obter(ruim, GRUPO, { agoraMs: daquiSeisMinutos })
check('TTL vencido + renovação falhando mantém o último valor conhecido', aposFalha?.admins?.has(ANA) === true)
check('e mantém o nome do grupo', aposFalha?.name === 'Turma do Churrasco')
check('a renovação foi mesmo tentada', ruim.chamadas.metadata === 1)

const e3 = await groupInfo.enriquecerEvento(ruim, construirEventoDeMensagem(eventoDeGrupo('Ana'), { accountId: 'acc-1', botId: BOT }))
check('a mensagem seguinte continua completa apesar da falha', e3.sender.isAdmin === true && e3.chat.name === 'Turma do Churrasco')

// Rebaixamento continua valendo na hora — o último valor bom é para falha de
// rede, nunca para substituir a invalidação por evento.
const rebaixada = {
  ...metadata,
  participants: metadata.participants.map((p) => (p.jid === ANA ? { ...p, isAdmin: false } : p))
}
groupInfo.invalidar(GRUPO)
const cRebaixa = { group: { queryGroupMetadata: async () => rebaixada, queryAllGroups: async () => [rebaixada] } }
const e4 = await groupInfo.enriquecerEvento(cRebaixa, construirEventoDeMensagem(eventoDeGrupo('Ana'), { accountId: 'acc-1', botId: BOT }))
check('rebaixamento continua valendo na mensagem seguinte', e4.sender.isAdmin === false)

// E depois de invalidar, uma consulta que falha NÃO ressuscita o valor antigo:
// sabe-se que mudou, então servir o anterior seria pior que não servir nada.
groupInfo.invalidar(GRUPO)
const aposInvalidar = await groupInfo.obter(cliente({ falharConsulta: true }), GRUPO)
check('depois de invalidar, falha não ressuscita permissão velha', aposInvalidar === null)

// === GARANTIA 4: nome de quem enviou sobrevive à mensagem sem pushName =====
// O WhatsApp não manda o nome em toda mensagem. Como ele não muda a cada
// segundo, basta lembrar o que já passou.
diretorio.registrarContato(ANA, 'Ana Maria')
const semNome = construirEventoDeMensagem(eventoDeGrupo(undefined), { accountId: 'acc-1', botId: BOT })
check('mensagem sem pushName ainda resolve o nome de quem já falou antes', semNome.sender.name === 'Ana Maria', semNome.sender.name)

const comNome = construirEventoDeMensagem(eventoDeGrupo('Ana Nova'), { accountId: 'acc-1', botId: BOT })
check('quando o nome vem na mensagem, ele ganha do lembrado', comNome.sender.name === 'Ana Nova')

const desconhecido = construirEventoDeMensagem({
  key: { remoteJid: GRUPO, participant: '5511999999999@s.whatsapp.net', id: 'NOVO', fromMe: false, isGroup: true, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' }
}, { accountId: 'acc-1', botId: BOT })
check('de quem nunca falou e não mandou nome, o campo fica ausente (não vazio)', !('name' in desconhecido.sender))

// === GARANTIA 5: conversa direta não promete o que não tem =================
// "Só existe em grupo" não é falha: é a definição. O que não pode é a variável
// existir na tela sem dizer isso na própria descrição.
const direta = await groupInfo.enriquecerEvento(cliente(), construirEventoDeMensagem({
  key: { remoteJid: ANA, id: 'D1', fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false },
  message: { conversation: 'oi' }
}, { accountId: 'acc-1', botId: BOT }))
check('conversa direta não ganha isAdmin', !('isAdmin' in direta.sender))
check('conversa direta continua tendo bot.id', direta.bot.id === BOT)

// === GARANTIA 6: a tela não pode mais dizer "nem sempre funciona" ==========
const { criarApi } = await import('../src/engine/server/api.js')
const { abrirBanco } = await import('../src/engine/server/db.js')
const api = criarApi(abrirBanco(':memory:'))
const meta = await api.resolver('GET', '/meta/variables', { body: null, query: new URLSearchParams(), req: { headers: {} } })

const comCompat = meta.builtIn.filter((v) => v.warning?.level === 'compatibility')
check('nenhuma variável embutida é documentada como "nem sempre funciona"', comCompat.length === 0, comCompat.map((v) => v.example).join(', '))

const deGrupo = meta.builtIn.filter((v) => ['{{sender.isAdmin}}', '{{chat.name}}', '{{chat.size}}', '{{bot.isAdmin}}', '{{chat.onlyAdmins}}'].includes(v.example))
check('as cinco variáveis de grupo continuam documentadas', deGrupo.length === 5)
check('cada uma diz na própria descrição que é de grupo', deGrupo.every((v) => /grupo/i.test(v.description)), deGrupo.filter((v) => !/grupo/i.test(v.description)).map((v) => v.example).join(', '))

lidMap._reiniciarParaTeste()
diretorio._usarPastaParaTeste()
fs.rmSync(pastaTeste, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODAS AS GARANTIAS DE VARIÁVEL PASSARAM')
process.exit(falhas ? 1 : 0)
