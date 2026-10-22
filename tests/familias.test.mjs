// FAMÍLIAS DE COMANDO, E O QUE ESTÁ LIGADO EM CADA CONVERSA.
//
// O pedido do dono: "devem existir comandos de fig e manipulação de imagem,
// comandos de compra e venda, comandos de download e etc; o menu config
// deveria escolher quais comandos ou famílias de comandos são ativos em cada
// grupo ou de forma global pra grupos de pessoas no pv, e assim mudar o menu
// de acordo".
//
// Existiam três metades que não se falavam: `categoria`, que era do template e
// MORRIA na instalação; `scope`, que é por comando e só se edita reescrevendo
// o texto; e `grupo_ativo`, que é TUDO OU NADA — ele diz se o bot existe no
// grupo, não o que ele faz lá.
//
// Dois cuidados que estes casos guardam, e que são onde isto quebra:
//
//   1. A conferência vem DEPOIS do comando casar. Antes, no privado, toda
//      mensagem passaria por todo comando desligado e cada um responderia
//      "estou desligado".
//   2. A marca guardada é a do DESLIGADO. Guardar o ligado faria todo comando
//      novo nascer inerte em toda conversa até alguém ligar, uma por uma.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { avisoDeDesligado, desligadoNaConversa, familiaDoDocumento } from '../src/engine/server/familias.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

const GRUPO = '120000000000000001@g.us'
const PRIVADO = '5511900000001@s.whatsapp.net'
const PESSOA = '5511900000002@s.whatsapp.net'

db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', GRUPO, 'grupo_ativo', '"sim"', agora)

const marcar = (kind, id, chave, valor) => db
  .prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run(kind, id, chave, JSON.stringify(valor), agora)

function publicar (id, { comando, familia, escopo }) {
  const doc = {
    schemaVersion: 1,
    id,
    revision: 1,
    name: id,
    enabled: true,
    display: { menuLabel: comando, menuDescription: 'faz algo', ...(familia ? { family: familia } : {}) },
    scope: { include: [escopo], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: comando, match: 'exact', allowFrom: 'external' } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: `respondi ${comando}` } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', escopo.kind, escopo.id || '')
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
  return doc
}

const docBaixar = publicar('baixar', { comando: '/baixar', familia: 'download', escopo: { kind: 'everywhere' } })
publicar('figurinha', { comando: '/fig', familia: 'figurinha', escopo: { kind: 'everywhere' } })
publicar('solto', { comando: '/solto', familia: null, escopo: { kind: 'everywhere' } })

let n = 0
const evento = (chatId, texto) => {
  n++
  return {
    provider: 'zapo',
    accountId: 'acc-1',
    eventId: `acc-1:${chatId}:${PESSOA}:m${n}`,
    occurredAt: new Date().toISOString(),
    replay: false,
    chat: { id: chatId, kind: chatId.endsWith('@g.us') ? 'group' : 'direct' },
    sender: { id: PESSOA, authoredBySelf: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: `m${n}` }
  }
}
const resultadoDe = (r, id) => r.results.find((x) => x.automationId === id)

// --- a família do documento ----------------------------------------------
check('lê a família do documento', familiaDoDocumento(docBaixar) === 'download')
check('comando sem família devolve null', familiaDoDocumento({ display: {} }) === null)
check('família só com espaço é como se não houvesse', familiaDoDocumento({ display: { family: '   ' } }) === null)

// --- ligado por padrão ----------------------------------------------------
//
// É a consequência de guardar o DESLIGADO: o comando novo já vale onde o
// escopo dele diz que vale, sem ninguém precisar ligar nada.
const antes = avaliarEvento(db, evento(GRUPO, '/baixar'))
check('sem marca nenhuma, o comando responde', resultadoDe(antes, 'baixar')?.status === 'matched_live', resultadoDe(antes, 'baixar')?.status)

// --- desligar a família numa conversa ------------------------------------
marcar('group', GRUPO, 'familias_desligadas', ['download'])

const depois = avaliarEvento(db, evento(GRUPO, '/baixar'))
const rBaixar = resultadoDe(depois, 'baixar')
check('a família desligada não executa', rBaixar?.status === 'desligado', rBaixar?.status)
// EM GRUPO, SILÊNCIO. Um comando desligado que responde é barulho que qualquer
// pessoa do grupo pode provocar de propósito.
check('e em grupo não responde nada', !rBaixar?.commands?.length, JSON.stringify(rBaixar?.commands || []))

// A outra família continua inteira: desligar uma não desliga o bot.
const rFig = resultadoDe(avaliarEvento(db, evento(GRUPO, '/fig')), 'figurinha')
check('outra família continua respondendo', rFig?.status === 'matched_live', rFig?.status)

// --- no privado, explica --------------------------------------------------
//
// Ali a pessoa está falando com o bot. Silêncio se lê como defeito: ela repete
// o comando, acha que não chegou, e desiste sem saber que ele existe.
marcar('contact', PRIVADO, 'familias_desligadas', ['download'])
const noPrivado = resultadoDe(avaliarEvento(db, evento(PRIVADO, '/baixar')), 'baixar')
check('no privado também não executa', noPrivado?.status === 'desligado', noPrivado?.status)
check('mas responde dizendo por quê', /desligad/i.test(noPrivado?.commands?.[0]?.payload?.text || ''), noPrivado?.commands?.[0]?.payload?.text)
check('e nomeia a família', /download/.test(noPrivado?.commands?.[0]?.payload?.text || ''))

// --- A CONFERÊNCIA VEM DEPOIS DO CASAMENTO -------------------------------
//
// Este é o caso que impede o desastre: uma mensagem qualquer no privado não
// pode fazer todo comando desligado responder "estou desligado".
const conversaQualquer = avaliarEvento(db, evento(PRIVADO, 'bom dia, tudo bem?'))
const respostas = conversaQualquer.results.flatMap((r) => r.commands || [])
check('mensagem comum não acorda comando desligado', respostas.length === 0, JSON.stringify(respostas))
check('e nenhum resultado vira "desligado"', !conversaQualquer.results.some((r) => r.status === 'desligado'))

// --- desligar um comando só ----------------------------------------------
marcar('group', GRUPO, 'comandos_desligados', ['figurinha'])
const soEsse = resultadoDe(avaliarEvento(db, evento(GRUPO, '/fig')), 'figurinha')
check('dá para desligar um comando só', soEsse?.status === 'desligado', soEsse?.status)

// Comando sem família nenhuma continua controlável um a um — esconder isso
// faria parecer que só quem tem família dá para desligar.
marcar('group', GRUPO, 'comandos_desligados', ['figurinha', 'solto'])
const semFamilia = resultadoDe(avaliarEvento(db, evento(GRUPO, '/solto')), 'solto')
check('comando sem família também desliga', semFamilia?.status === 'desligado', semFamilia?.status)

// --- o módulo puro --------------------------------------------------------
const chatDeGrupo = { id: GRUPO, kind: 'group' }
check('maiúscula não atrapalha', desligadoNaConversa(db, chatDeGrupo, { documento: { display: { family: 'DOWNLOAD' } } }).desligado)
check('e diz por qual família caiu', desligadoNaConversa(db, chatDeGrupo, { documento: docBaixar }).porFamilia === 'download')

// Quem escreveu a marca à mão pela aba Dados provavelmente escreveu texto, não
// lista. Recusar o texto faria a marca existir e não valer — o pior dos dois.
marcar('contact', PESSOA, 'familias_desligadas', 'download, figurinha')
const comoTexto = { id: PESSOA, kind: 'direct' }
check('aceita a lista escrita como texto', desligadoNaConversa(db, comoTexto, { documento: docBaixar }).desligado)

// --- o aviso, por tipo de conversa ---------------------------------------
check('em grupo não há aviso', avisoDeDesligado({ kind: 'group' }, { porFamilia: 'download' }) === null)
check('no privado há', typeof avisoDeDesligado({ kind: 'direct' }, { porFamilia: 'download' }) === 'string')
check('sem família, o aviso fala do comando', /comando/i.test(avisoDeDesligado({ kind: 'direct' }, {})))

// --- O MENU MUDA DE ACORDO ------------------------------------------------
//
// É a outra metade do pedido. Anunciar um comando que não responde ali seria o
// menu mentindo sobre o que o bot faz naquele lugar.
publicar('menu-teste', { comando: '/menu-teste', familia: null, escopo: { kind: 'everywhere' } })
db.prepare("UPDATE automation_revisions SET doc_json = json_set(doc_json, '$.flow.nodes[1].type', 'action.menu.render') WHERE automation_id = 'menu-teste'")
  .run()
const menuNoGrupo = avaliarEvento(db, evento(GRUPO, '/menu-teste'))
const textoDoMenu = resultadoDe(menuNoGrupo, 'menu-teste')?.commands?.[0]?.payload
const itens = JSON.stringify(textoDoMenu || {})
check('o menu não lista a família desligada', !itens.includes('/baixar'), itens.slice(0, 160))
check('nem o comando desligado um a um', !itens.includes('/fig'), itens.slice(0, 160))

// --- a categoria do template vira a família na instalação ----------------
const renderizado = renderizarTemplate({
  category: 'modulos-especializados',
  parameters: [],
  documentTemplate: { schemaVersion: 1, flow: { nodes: [] } }
}, {})
check('a categoria do template vira família', renderizado.display?.family === 'modulos-especializados', JSON.stringify(renderizado.display))

// Família declarada no próprio template ganha da categoria: a categoria é o
// valor inicial, não uma imposição.
const comFamiliaPropria = renderizarTemplate({
  category: 'utilitarios',
  parameters: [],
  documentTemplate: { schemaVersion: 1, display: { family: 'compra e venda' }, flow: { nodes: [] } }
}, {})
check('família declarada ganha da categoria', comFamiliaPropria.display?.family === 'compra e venda')

console.log(falhas === 0 ? '\nfamílias e ativação por conversa: tudo certo' : `\nfamílias: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
