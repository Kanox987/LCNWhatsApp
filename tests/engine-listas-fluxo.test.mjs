// Listas de ponta a ponta: o dono põe/tira alguém, outro comando confere a lista.
//
// Caso de uso que motivou: um número de empresa rodando o bot, com o contato
// PESSOAL do responsável marcado como dono, para ele configurar tudo mandando
// mensagem de fora, sem estar com o aparelho da empresa.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { definirDono } from '../src/engine/server/owners.js'
import { estaNaLista, membrosDaLista } from '../src/engine/server/listas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

const EMPRESA = '5511900000000@s.whatsapp.net'
const PESSOAL = '5511911111111@s.whatsapp.net'
const ESTRANHO = '5511922222222@s.whatsapp.net'

function publicar (id, requireOwner, nos, arestas) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'contact', id: EMPRESA }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: `/${id}`, match: 'exact_or_args', allowFrom: 'any', ...(requireOwner ? { requireOwner: true } : {}) } },
        ...nos
      ],
      edges: arestas
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'contact', EMPRESA)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function evento (senderId, texto, { proprioNumero = false, menciona = [] } = {}) {
  n++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${EMPRESA}:${senderId}:m${n}`,
    occurredAt: agora, replay: false,
    chat: { id: EMPRESA, kind: 'direct' },
    sender: { id: senderId, authoredBySelf: proprioNumero },
    message: { kind: 'text', text: texto, mentions: menciona },
    providerRef: { provider: 'zapo', remoteJid: EMPRESA, id: `m${n}` }
  }
}
const statusDe = (r, id) => r.results.find((x) => x.automationId === id)?.status
const respostaDe = (r, id) => r.results.find((x) => x.automationId === id)?.commands?.[0]?.payload?.text

const ANA = '5511933333333@s.whatsapp.net'
const BIA = '5511944444444@s.whatsapp.net'

definirDono(db, PESSOAL, true)
const nosLiberar = (tipo) => [{ id: 'l', type: tipo, config: { list: 'Autorizados', who: 'target', notFoundText: 'Marque alguém.', confirmText: 'feito {{target.number}}' } }]
publicar('liberar', true, nosLiberar('action.list.add'), [{ from: 'g', to: 'l', on: 'matched' }])
publicar('desliberar', true, nosLiberar('action.list.remove'), [{ from: 'g', to: 'l', on: 'matched' }])
// Confere a lista: quem está nela recebe "pode", os outros "não".
publicar('entrar', false, [
  { id: 'c', type: 'condition.compare', config: { left: { source: 'event', field: 'sender.lists.autorizados' }, operator: 'eq', right: { source: 'literal', value: true } } },
  { id: 'sim', type: 'action.whatsapp.reply', config: { text: 'pode' } },
  { id: 'nao', type: 'action.whatsapp.reply', config: { text: 'não pode' } }
], [{ from: 'g', to: 'c', on: 'matched' }, { from: 'c', to: 'sim', on: 'true' }, { from: 'c', to: 'nao', on: 'false' }])
// Confere o ALVO (quem foi marcado), não quem escreveu.
publicar('quem', false, [
  { id: 'c', type: 'condition.compare', config: { left: { source: 'event', field: 'target.lists.autorizados' }, operator: 'eq', right: { source: 'literal', value: true } } },
  { id: 'sim', type: 'action.whatsapp.reply', config: { text: 'alvo na lista' } },
  { id: 'nao', type: 'action.whatsapp.reply', config: { text: 'alvo fora' } }
], [{ from: 'g', to: 'c', on: 'matched' }, { from: 'c', to: 'sim', on: 'true' }, { from: 'c', to: 'nao', on: 'false' }])
// Escreve numa chave de lista por variable.set: documento adulterado, direto no banco.
publicar('forja', false, [
  { id: 'v', type: 'action.variable.set', config: { scope: 'sender', key: '__lista__autorizados', value: 'true' } }
], [{ from: 'g', to: 'v', on: 'matched' }])

check('lista começa vazia: ninguém entra', respostaDe(avaliarEvento(db, evento(ANA, '/entrar')), 'entrar') === 'não pode')
check('estranho NÃO consegue se pôr na lista', statusDe(avaliarEvento(db, evento(ESTRANHO, '/liberar', { menciona: [ESTRANHO] })), 'liberar') === 'no_match' && !estaNaLista(db, 'autorizados', ESTRANHO))
const r = avaliarEvento(db, evento(PESSOAL, '/liberar', { menciona: [ANA] }))
check('o dono põe o marcado na lista e o bot confirma', estaNaLista(db, 'autorizados', ANA) && respostaDe(r, 'liberar') === 'feito 5511933333333', respostaDe(r, 'liberar'))
check('o nome com maiúscula caiu na lista normalizada', membrosDaLista(db, 'autorizados').join() === ANA)
check('quem está na lista passa na condição', respostaDe(avaliarEvento(db, evento(ANA, '/entrar')), 'entrar') === 'pode')
check('outra pessoa continua de fora', respostaDe(avaliarEvento(db, evento(BIA, '/entrar')), 'entrar') === 'não pode')
check('a condição também enxerga o alvo marcado', respostaDe(avaliarEvento(db, evento(BIA, '/quem', { menciona: [ANA] })), 'quem') === 'alvo na lista' && respostaDe(avaliarEvento(db, evento(BIA, '/quem', { menciona: [BIA] })), 'quem') === 'alvo fora')
check('sem marcar ninguém: avisa e não grava nada', (() => { const x = avaliarEvento(db, evento(PESSOAL, '/liberar')); return respostaDe(x, 'liberar') === 'Marque alguém.' && membrosDaLista(db, 'autorizados').length === 1 })())
check('estranho não tira ninguém da lista', statusDe(avaliarEvento(db, evento(ESTRANHO, '/desliberar', { menciona: [ANA] })), 'desliberar') === 'no_match' && estaNaLista(db, 'autorizados', ANA))
const t = avaliarEvento(db, evento(PESSOAL, '/desliberar', { menciona: [ANA] }))
check('o dono tira, e a condição passa a negar', !estaNaLista(db, 'autorizados', ANA) && respostaDe(t, 'desliberar') === 'feito 5511933333333' && respostaDe(avaliarEvento(db, evento(ANA, '/entrar')), 'entrar') === 'não pode')
check('lista esvaziada não vira "todos"', membrosDaLista(db, 'autorizados').length === 0 && respostaDe(avaliarEvento(db, evento(BIA, '/entrar')), 'entrar') === 'não pode')
const f = avaliarEvento(db, evento(ESTRANHO, '/forja'))
check('variable.set não escreve na lista (chave reservada)', !estaNaLista(db, 'autorizados', ESTRANHO) && statusDe(f, 'forja') !== 'no_match', statusDe(f, 'forja'))

// --- mostrar a lista ------------------------------------------------------
publicar('mostra', true, [
  { id: 's', type: 'action.list.show', config: { list: 'Autorizados', limit: 2 } }
], [{ from: 'g', to: 's', on: 'matched' }])
check('lista vazia: responde que está vazia, sem número nenhum', respostaDe(avaliarEvento(db, evento(PESSOAL, '/mostra')), 'mostra') === 'A lista autorizados está vazia.')
check('estranho não vê a lista', statusDe(avaliarEvento(db, evento(ESTRANHO, '/mostra')), 'mostra') === 'no_match')
avaliarEvento(db, evento(PESSOAL, '/liberar', { menciona: [ANA] }))
check('uma pessoa: título com total e o número, sem jid', respostaDe(avaliarEvento(db, evento(PESSOAL, '/mostra')), 'mostra') === 'Lista autorizados (1):\n• 5511933333333')
avaliarEvento(db, evento(PESSOAL, '/liberar', { menciona: [BIA] }))
avaliarEvento(db, evento(PESSOAL, '/liberar', { menciona: [ESTRANHO] }))
const mostrada = respostaDe(avaliarEvento(db, evento(PESSOAL, '/mostra')), 'mostra')
check('passou do limite: mostra os primeiros e diz quantos faltam', mostrada.startsWith('Lista autorizados (3):') && mostrada.split('\n').length === 4 && mostrada.endsWith('e mais 1') && !mostrada.includes('@'), mostrada)
for (const quem of [ANA, BIA, ESTRANHO]) avaliarEvento(db, evento(PESSOAL, '/desliberar', { menciona: [quem] }))
check('esvaziada de novo, volta a dizer que está vazia', respostaDe(avaliarEvento(db, evento(PESSOAL, '/mostra')), 'mostra') === 'A lista autorizados está vazia.')

// --- a linguagem: escrever, compilar e voltar ----------------------------
const fonte = `automação
  nome: Só autorizados
  tipo: comando
  dispara com: /entrar
  casa: exato
  quem: qualquer um
  pool: p1

  se evento sender.lists.autorizados == true
    responde "pode"
  senão
    põe na lista
      qual: pendentes
      quem: quem enviou
      confirma: "anotado"
`
const compilado = compilar(fonte)
const tipos = compilado.flow.nodes.map((no) => no.type)
check('a linguagem compila "põe na lista" e a condição sobre sender.lists', tipos.includes('action.list.add') && tipos.includes('condition.compare'), tipos.join())
const mostra = compilar(`automação
  nome: Ver lista
  tipo: comando
  dispara com: /ver
  casa: exato
  quem: qualquer um
  pool: p1

  mostra a lista
    qual: autorizados
    título: "Quem pode ({{lista.total}}):"
    até: 10
`)
const noMostra = mostra.flow.nodes.find((no) => no.type === 'action.list.show')
check('a linguagem compila "mostra a lista" com título e limite', noMostra?.config.list === 'autorizados' && noMostra.config.limit === 10 && noMostra.config.title === 'Quem pode ({{lista.total}}):', JSON.stringify(noMostra))
check('e descompila para a mesma frase', JSON.stringify(compilar(descompilar(mostra)).flow) === JSON.stringify(mostra.flow))
const volta = descompilar(compilado)
check('e o descompilador escreve de volta a mesma frase', volta.includes('põe na lista') && volta.includes('evento sender.lists.autorizados == true') && volta.includes('qual: pendentes'))
check('recompilar o texto devolvido dá o mesmo fluxo', JSON.stringify(compilar(volta).flow) === JSON.stringify(compilado.flow))

console.log(falhas === 0 ? '\nO DONO MONTA A LISTA E O COMANDO CONFERE QUEM ESTÁ NELA' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
