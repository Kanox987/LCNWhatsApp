// Uma revisão malformada não pode calar o bot inteiro.
//
// O achado: `documento.inputPolicy.historyPolicy` era lido direto, dentro do
// laço de candidatos e dentro da transação. Uma revisão sem `inputPolicy`
// lançava TypeError, abortava a transação, e NENHUMA automação daquele evento
// era avaliada — uma regra quebrada derrubava todas as outras, com 500 na cara
// de quem chamou.
//
// Isso não era hipótese: `jsonOuNull` devolve o que estiver no banco, e nem
// toda revisão passou por `validarAutomacao` (migração antiga, inserção nativa,
// registro adulterado).
//
// O que estes casos guardam é o efeito COLATERAL, não a automação torta: o
// /ping tem que continuar respondendo com a vizinha quebrada do lado.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)

const doc = (id, comando) => ({
  schemaVersion: 1,
  enabled: true,
  name: id,
  scope: { include: [{ kind: 'everywhere' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: comando, match: 'exact', allowFrom: 'any' } },
      { id: 'r', type: 'action.whatsapp.reply', config: { text: 'pong' } }
    ],
    edges: [{ from: 'g', to: 'r', on: 'matched' }]
  }
})

for (const [id, cmd] of [['ping', '/ping'], ['torta', '/torta'], ['semconfig', '/semconfig']]) {
  servico.criarEPublicar({ id, document: doc(id, cmd) })
  db.prepare('UPDATE automations SET deployment_mode = ? WHERE id = ?').run('live', id)
}

// Adultera as revisões DEPOIS de publicadas — é assim que elas chegam ao banco
// sem passar pela validação.
const estragar = (id, mudanca) => {
  const rev = db.prepare('SELECT active_revision_id FROM automations WHERE id = ?').get(id).active_revision_id
  const d = JSON.parse(db.prepare('SELECT doc_json FROM automation_revisions WHERE id = ?').get(rev).doc_json)
  mudanca(d)
  db.prepare('UPDATE automation_revisions SET doc_json = ? WHERE id = ?').run(JSON.stringify(d), rev)
}
estragar('torta', (d) => { delete d.inputPolicy })
estragar('semconfig', (d) => { delete d.flow.nodes[0].config })

let n = 0
const evento = (texto) => ({
  provider: 'zapo',
  accountId: 'conta',
  eventId: `conta:c:s:m${++n}`,
  occurredAt: agora,
  replay: false,
  chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
  sender: { id: '5511@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', id: `m${n}` }
})

try {
  const r = avaliarEvento(db, evento('/ping'))
  const de = (id) => (r.results || []).find((x) => x.automationId === id)

  // O caso inteiro: a vizinha quebrada não pode levar o /ping junto.
  check('o /ping responde mesmo com duas revisões tortas do lado',
    de('ping')?.status === 'matched_live', JSON.stringify(de('ping')))
  check('e ele realmente gerou o comando de resposta', de('ping')?.commands?.length === 1)

  check('a revisão sem inputPolicy vira error só nela', de('torta')?.status === 'error', JSON.stringify(de('torta')))
  check('a revisão com gatilho sem config vira error só nela', de('semconfig')?.status === 'error', JSON.stringify(de('semconfig')))

  // O motivo tem que chegar em quem for olhar a aba Execuções.
  const detalhe = db.prepare("SELECT detail_json FROM automation_runs WHERE automation_id = 'torta'").get()?.detail_json
  check('e o motivo fica registrado, não é erro mudo', typeof detalhe === 'string' && detalhe.includes('inputPolicy'), detalhe)
} catch (erro) {
  falhas++
  console.error('❌ a avaliação inteira estourou — que é exatamente o defeito:', erro.message)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE REVISÃO TORTA PASSARAM')
process.exit(falhas ? 1 : 0)
