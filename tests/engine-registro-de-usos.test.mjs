// Registro de usos: limite de uso escrito na própria linguagem.
//
// O caso que motivou: "no máximo 3 /dow em 10 minutos por pessoa". O fluxo
// conta os usos da regra, um `se` comum decide, e só então anota o de agora.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import {
  anotarUso, contarUsos, gravarRetencaoDeUsos, lerJanela, lerRetencaoDeUsos, limparUsos, normalizarRegra, varrerUsos
} from '../src/engine/server/registroDeUsos.js'
import { iniciarVarredura } from '../src/engine/server/retencao.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

const GRUPO = '120363000000000000@g.us'
const OUTRO_GRUPO = '120363000000000001@g.us'
const ANA = '5511933333333@s.whatsapp.net'
const BIA = '5511944444444@s.whatsapp.net'
// Grupo só roda automação depois de ativado (grupo_ativo), como no uso real.
for (const g of [GRUPO, OUTRO_GRUPO]) {
  db.prepare('INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
    .run('group', g, 'grupo_ativo', '"sim"', agora)
}

// --- o módulo -------------------------------------------------------------

check('janela lê minutos, horas, dias e a forma curta',
  lerJanela('10 minutos') === 600 && lerJanela('1 hora') === 3600 && lerJanela('7 dias') === 604800 &&
  lerJanela('30s') === 30 && lerJanela('2 h') === 7200 && lerJanela('1 semana') === 604800)
check('janela sem número, zero ou unidade estranha não vale',
  lerJanela('minutos') === null && lerJanela('0 minutos') === null && lerJanela('3 anos') === null && lerJanela('') === null)
check('regra é normalizada como nome de lista',
  normalizarRegra(' Downloads ') === 'downloads' && normalizarRegra('Vídeo curto') === 'video_curto' && normalizarRegra('1x') === null)

const T0 = Date.parse('2026-11-10T12:00:00Z')
const min = 60 * 1000
anotarUso(db, { regra: 'teste', pessoa: ANA, chat: GRUPO, agora: T0 - 20 * min })
anotarUso(db, { regra: 'teste', pessoa: ANA, chat: GRUPO, agora: T0 - 5 * min })
anotarUso(db, { regra: 'teste', pessoa: ANA, chat: OUTRO_GRUPO, agora: T0 - 2 * min })
anotarUso(db, { regra: 'teste', pessoa: BIA, chat: GRUPO, agora: T0 - 1 * min })
anotarUso(db, { regra: 'outra', pessoa: ANA, chat: GRUPO, agora: T0 - 1 * min })
const conta = (o) => contarUsos(db, { regra: 'teste', segundos: 600, agora: T0, ...o }).total
check('conta só dentro da janela, por pessoa', conta({ pessoa: ANA }) === 2, String(conta({ pessoa: ANA })))
check('janela maior pega o uso mais velho', contarUsos(db, { regra: 'teste', segundos: 3600, pessoa: ANA, agora: T0 }).total === 3)
check('"nesta conversa" separa os grupos', conta({ pessoa: ANA, chat: GRUPO }) === 1)
check('"todos" soma as pessoas', conta({}) === 3)
check('regras não se misturam', contarUsos(db, { regra: 'outra', segundos: 600, agora: T0 }).total === 1)
check('regra inválida é recusada', contarUsos(db, { regra: '9x', segundos: 60 }).ok === false && anotarUso(db, { regra: '', pessoa: ANA }).ok === false)
check('uso sem pessoa não é anotado', anotarUso(db, { regra: 'teste', pessoa: '' }).ok === false)

check('limpar de uma pessoa não toca nas outras',
  limparUsos(db, { regra: 'outra', pessoa: BIA }).apagados === 0 &&
  limparUsos(db, { regra: 'teste', pessoa: BIA }).apagados === 1 && conta({}) === 2)

check('retenção dos usos: padrão de 7 dias', lerRetencaoDeUsos(db).horas === 168 && lerRetencaoDeUsos(db).padrao === true)
gravarRetencaoDeUsos(db, { horas: 1 })
const varrido = varrerUsos(db, { agora: T0 + 61 * min - 20 * min })
check('a varredura apaga o que passou da janela dos usos', varrido.usos === 1 && contarUsos(db, { regra: 'teste', segundos: 86400, pessoa: ANA, agora: T0 }).total === 2, JSON.stringify(varrido))
gravarRetencaoDeUsos(db, { horas: 0 })
check('retenção 0 guarda para sempre', varrerUsos(db, { agora: T0 + 1e12 }).usos === 0)
let recusou = false
try { gravarRetencaoDeUsos(db, { horas: -1 }) } catch { recusou = true }
check('retenção negativa é recusada', recusou)
gravarRetencaoDeUsos(db, { horas: 168 })
const relogio = iniciarVarredura(db, { intervaloMs: 1e9 })
relogio.parar()
check('a varredura do motor também passa pelos usos', relogio.primeira && 'usos' in relogio.primeira)
limparUsos(db, { regra: 'teste' })
limparUsos(db, { regra: 'outra' })

// --- pela linguagem --------------------------------------------------------

const LCN = `automação
  nome: Limite
  tipo: comando
  dispara com: /dow
  onde: todos os grupos
  pool: p1
  acessa: texto
  casa: exato ou com argumentos
  quem: só externos

  conta usos
    regra: downloads
    janela: 10 minutos
    em: qtd
  se evento local.qtd >= 2
    responde "Calma: {{local.qtd}} em 10 minutos."
  senão
    anota uso
      regra: downloads
    responde "baixando"
`

let doc
try {
  doc = compilar(LCN)
} catch (erro) {
  check('o limite compila', false, erro.message)
}
if (doc) {
  check('o limite compila', true)
  const tipos = doc.flow.nodes.map((n) => n.type)
  check('o documento tem contar, condição e anotar',
    tipos.includes('action.usage.count') && tipos.includes('condition.compare') && tipos.includes('action.usage.record'), tipos.join(','))
  const erros = validarAutomacao({ ...doc, id: 'limite', revision: 1 })
  check('o documento passa no schema', erros.length === 0, JSON.stringify(erros).slice(0, 300))
  const volta = compilar(descompilar(doc))
  check('ida e volta preserva os nós', JSON.stringify(volta.flow) === JSON.stringify(doc.flow))

  // Publica como os outros testes de fluxo.
  doc.id = 'limite'
  doc.revision = 1
  doc.responder = { strategy: 'weighted_rendezvous', poolId: 'p1' }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run('limite', 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run('limite', 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'all_groups', '')
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, 'limite')

  let n = 0
  const evento = (quem, texto = '/dow') => {
    n++
    return {
      provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${GRUPO}:${quem}:u${n}`,
      occurredAt: new Date().toISOString(), replay: false,
      chat: { id: GRUPO, kind: 'group' },
      sender: { id: quem },
      message: { kind: 'text', text: texto, mentions: [] },
      providerRef: { provider: 'zapo', remoteJid: GRUPO, id: `u${n}` }
    }
  }
  const resposta = (r) => r.results.find((x) => x.automationId === 'limite')?.commands?.map((c) => c.payload?.text).join(' | ')

  const r1 = resposta(avaliarEvento(db, evento(ANA)))
  const r2 = resposta(avaliarEvento(db, evento(ANA)))
  const r3 = resposta(avaliarEvento(db, evento(ANA)))
  check('os dois primeiros passam', r1 === 'baixando' && r2 === 'baixando', `${r1} / ${r2}`)
  check('o terceiro bate no limite e mostra a conta', r3 === 'Calma: 2 em 10 minutos.', r3)
  check('bloqueado não anota', contarUsos(db, { regra: 'downloads', segundos: 600, pessoa: ANA }).total === 2)
  check('outra pessoa tem o próprio limite', resposta(avaliarEvento(db, evento(BIA))) === 'baixando')
}

// O modelo do catálogo, renderizado com os padrões: uma presença por dia.
{
  const modelo = carregarCatalogo().get('presenca')
  const docModelo = renderizarTemplate(modelo, { poolId: 'p1' })
  docModelo.id = 'presenca'
  docModelo.revision = 1
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run('presenca', 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run('presenca', 'active', JSON.stringify(docModelo), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'all_groups', '')
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, 'presenca')
  const ev = (k) => ({
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${GRUPO}:${ANA}:p${k}`,
    occurredAt: new Date().toISOString(), replay: false,
    chat: { id: GRUPO, kind: 'group' }, sender: { id: ANA, name: 'Ana' },
    message: { kind: 'text', text: '/presenca', mentions: [] },
    providerRef: { provider: 'zapo', remoteJid: GRUPO, id: `p${k}` }
  })
  const texto = (r) => r.results.find((x) => x.automationId === 'presenca')?.commands?.[0]?.payload?.text
  const p1 = texto(avaliarEvento(db, ev(1)))
  const p2 = texto(avaliarEvento(db, ev(2)))
  check('o modelo presenca marca a primeira', p1 === 'Presença marcada, Ana.', p1)
  check('o modelo presenca recusa a segunda no mesmo dia', p2?.startsWith('Você já marcou presença (1)'), p2)
}

// limpa usos, pela linguagem
const LIMPA = `automação
  nome: Zerar
  tipo: comando
  dispara com: /zerar
  onde: todos os grupos
  pool: p1
  acessa: texto
  casa: exato ou com argumentos
  quem: só externos

  limpa usos
    regra: downloads
    quem: quem foi marcado
    sem alvo: "Marque alguém."
    confirma: "Zerado: {{usos.apagados}}."
`
const docLimpa = compilar(LIMPA)
check('limpa usos faz ida e volta', JSON.stringify(compilar(descompilar(docLimpa)).flow) === JSON.stringify(docLimpa.flow))
const cfg = docLimpa.flow.nodes.find((x) => x.type === 'action.usage.clear')?.config
check('limpa usos traduz as palavras', cfg?.who === 'target' && cfg?.notFoundText === 'Marque alguém.', JSON.stringify(cfg))
const contaTodos = compilar(`automação
  nome: X
  tipo: comando
  dispara com: /x
  onde: todos os grupos
  pool: p1
  acessa: texto
  casa: exato ou com argumentos
  quem: só externos

  conta usos
    regra: downloads
    janela: 1 hora
    em: total
    de quem: todos
    onde: nesta conversa
`).flow.nodes.find((x) => x.type === 'action.usage.count')?.config
check('conta usos traduz "todos" e "nesta conversa"', contaTodos?.who === 'everyone' && contaTodos?.where === 'chat', JSON.stringify(contaTodos))

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nregistro de usos: tudo certo')
