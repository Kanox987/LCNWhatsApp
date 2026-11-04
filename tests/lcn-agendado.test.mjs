// O gatilho `agendado` da linguagem, de ponta a ponta no avaliador.
//
// A bateria renderiza template, mas não EXECUTA — e é assim que um ramo morto
// já passou verde aqui. Então este arquivo compila o texto `.lcn` de verdade,
// publica a revisão no banco e dispara o evento do relógio pelo avaliador.
//
// Quem dispara (o agendador do motor) é outra peça; aqui se prova o que ela
// pode contar que o avaliador garante: o relógio acorda UMA automação, nunca
// as outras, e ninguém de fora forja um disparo.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000088@g.us'
const OUTRO_GRUPO = '120363000000000099@g.us'
const AGORA = new Date('2026-11-04T15:00:00Z')

const agendado = (nome, agenda, onde, corpo = 'responde "bom dia"') =>
  ['automação ' + nome, '  tipo: agendado', `  agenda: ${agenda}`, `  onde: grupo ${onde}`, '', `  ${corpo}`, ''].join('\n')

// --- compila e volta -----------------------------------------------------------
{
  const fontes = {
    relativo: agendado('lembrete', 'daqui 30 minutos', GRUPO),
    absoluto: agendado('lancamento', '23/08/2030 às 14:30', GRUPO),
    diario: agendado('bomdia', 'todo dia às 08:00', GRUPO),
    semanal: agendado('reuniao', 'toda segunda e quarta às 09:00', GRUPO),
    mensal: agendado('fechamento', 'todo dia 15 às 10:00', GRUPO),
    intervalo: agendado('pulso', 'a cada 30 minutos', GRUPO)
  }
  for (const [nome, fonte] of Object.entries(fontes)) {
    const doc = compilar(fonte, { agora: AGORA })
    const gatilho = doc.flow.nodes[0]
    check(`${nome}: compila para trigger.schedule`, gatilho.type === 'trigger.schedule' && gatilho.config.schedule?.tipo)
    check(`${nome}: só aceita o tipo "schedule"`, doc.inputPolicy.acceptedMessageKinds.join() === 'schedule')
    const volta = compilar(descompilar(doc), { agora: AGORA })
    check(`${nome}: ida e volta fecha`, JSON.stringify(volta) === JSON.stringify(doc))
  }
}

// --- recusas, com a razão ------------------------------------------------------
{
  const recusa = (nome, fonte, trecho) => {
    try { compilar(fonte, { agora: AGORA }); check(nome, false, 'compilou') } catch (e) {
      check(nome, new RegExp(trecho, 'i').test(e.message), e.message)
    }
  }
  recusa('sem "agenda:" é recusado',
    ['automação x', '  tipo: agendado', `  onde: grupo ${GRUPO}`, '', '  responde "oi"', ''].join('\n'), 'agenda')
  recusa('sem destino é recusado',
    ['automação x', '  tipo: agendado', '  agenda: todo dia às 08:00', '', '  responde "oi"', ''].join('\n'), 'onde|destino|grupo')
  recusa('data que já passou é recusada', agendado('x', '23/08/2020 às 14:30', GRUPO), 'passaram|passad')
  recusa('intervalo abaixo do mínimo é recusado', agendado('x', 'a cada 10 segundos', GRUPO), 'interval|mínimo|minimo')
  recusa('corpo que depende de mensagem é recusado', agendado('x', 'todo dia às 08:00', GRUPO, 'responde "oi {{sender.name}}"'), 'mensagem|sender|agendad')
  recusa('"menos" não vale para agendado',
    ['automação x', '  tipo: agendado', '  agenda: todo dia às 08:00', `  onde: grupo ${GRUPO}`, '  menos: 5 segundos', '', '  responde "oi"', ''].join('\n'), 'menos')
}

// --- a ordem das linhas do cabeçalho não muda o documento ----------------------
{
  const a = compilar(['automação x', '  tipo: agendado', '  agenda: todo dia às 08:00', `  onde: grupo ${GRUPO}`, '', '  responde "oi"', ''].join('\n'), { agora: AGORA })
  const b = compilar(['automação x', `  onde: grupo ${GRUPO}`, '  agenda: todo dia às 08:00', '  tipo: agendado', '', '  responde "oi"', ''].join('\n'), { agora: AGORA })
  check('as duas ordens de cabeçalho dão o mesmo documento', JSON.stringify(a) === JSON.stringify(b))
}

// --- texto antigo continua abrindo depois que a data passou --------------------
{
  const doc = compilar(agendado('x', '23/08/2030 às 14:30', GRUPO), { agora: AGORA })
  const texto = descompilar(doc)
  const DEPOIS = new Date('2031-01-01T00:00:00Z')
  let recusou = false
  try { compilar(texto, { agora: DEPOIS }) } catch { recusou = true }
  check('compilar um texto cuja data passou é recusado por padrão', recusou)
  let abriu = null
  try { abriu = compilar(texto, { agora: DEPOIS, permitirPassado: true }) } catch {}
  check('com permitirPassado o mesmo texto abre (editor, ida e volta)', abriu && JSON.stringify(abriu) === JSON.stringify(doc))
}

// --- no avaliador --------------------------------------------------------------
const db = abrirBanco(':memory:')
const iso = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', iso, iso)
const atributo = db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
atributo.run('group', GRUPO, 'grupo_ativo', '"sim"', iso)

function publicar (id, fonte, grupo = GRUPO) {
  const doc = { ...compilar(fonte, { agora: AGORA }), id, revision: 1, responder: { strategy: 'weighted_rendezvous', poolId: 'p1' } }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', iso, iso)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), iso)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', grupo)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

publicar('lembrete-a', agendado('lembrete-a', 'todo dia às 08:00', GRUPO, 'responde "A"'))
publicar('lembrete-b', agendado('lembrete-b', 'todo dia às 09:00', GRUPO, 'responde "B"'))
// Um comando comum no MESMO grupo: o relógio não pode acordá-lo.
db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run('oi', 'live', iso, iso)
{
  const doc = { ...compilar(['automação oi', '  tipo: comando', '  dispara com: /oi', '  acessa: texto', '  casa: exato', '  quem: qualquer um', `  onde: grupo ${GRUPO}`, '', '  responde "oi"', ''].join('\n'), { agora: AGORA }), id: 'oi', revision: 1, responder: { strategy: 'weighted_rendezvous', poolId: 'p1' } }
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run('oi', 'active', JSON.stringify(doc), iso)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, 'oi')
}

let n = 0
const disparo = (automationId, chatId = GRUPO) => ({
  eventId: `schedule-${automationId}-${++n}`,
  accountId: 'conta-1',
  chat: { id: chatId, kind: 'group' },
  sender: { id: '__schedule__' },
  schedule: { id: `job-${n}`, automationId, firedAt: AGORA.toISOString(), scheduledFor: AGORA.toISOString() }
})
const textos = (r) => r.results.flatMap((x) => x.commands.map((c) => c.payload?.text))

{
  const r = avaliarEvento(db, disparo('lembrete-a'), { interno: true })
  check('o relógio acorda a automação dona', r.results.length === 1 && r.results[0].automationId === 'lembrete-a' && r.results[0].status === 'matched_live', JSON.stringify(r.results.map((x) => x.status)))
  check('e ela responde no destino', textos(r).join() === 'A', textos(r).join())
  const rb = avaliarEvento(db, disparo('lembrete-b'), { interno: true })
  check('mutação: o disparo de B acorda só B (nunca A)', rb.results.length === 1 && rb.results[0].automationId === 'lembrete-b' && textos(rb).join() === 'B')
}

{
  const e = disparo('lembrete-a')
  const um = avaliarEvento(db, e, { interno: true })
  const dois = avaliarEvento(db, e, { interno: true })
  const total = db.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE event_id = ?").get(e.eventId).n
  check('o mesmo disparo duas vezes não duplica execução nem comando', total === 1 && textos(um).join() === textos(dois).join(), `runs=${total}`)
}

{
  const msg = avaliarEvento(db, {
    eventId: 'm-1', accountId: 'conta-1', chat: { id: GRUPO, kind: 'group' },
    sender: { id: '5511900000001@s.whatsapp.net', authoredBySelf: false },
    message: { kind: 'text', text: '/oi' }
  })
  const ids = msg.results.map((x) => x.automationId)
  check('mensagem comum não acorda agendado', !ids.includes('lembrete-a') && !ids.includes('lembrete-b') && ids.includes('oi'), ids.join())
  const fora = disparo('oi')
  const r = avaliarEvento(db, fora, { interno: true })
  check('o relógio não acorda comando comum, nem pelo id dele', r.results.length === 0)
}

{
  for (const [nome, evento] of [
    ['evento com chave schedule', disparo('lembrete-a')],
    ['mensagem com kind "schedule"', { eventId: 'x-1', accountId: 'conta-1', chat: { id: GRUPO, kind: 'group' }, sender: { id: '5511900000001@s.whatsapp.net' }, message: { kind: 'schedule', text: '' } }]
  ]) {
    let status = null
    try { avaliarEvento(db, evento) } catch (e) { status = e.status ?? e.statusCode ?? e.code ?? 'lançou' }
    check(`de fora, ${nome} é recusado`, status !== null, String(status))
  }
}

{
  publicar('em-grupo-nao-autorizado', agendado('em-grupo-nao-autorizado', 'todo dia às 08:00', OUTRO_GRUPO), OUTRO_GRUPO)
  const r = avaliarEvento(db, disparo('em-grupo-nao-autorizado', OUTRO_GRUPO), { interno: true })
  check('grupo sem autorização do dono não recebe agendado (mesmo portão dos comandos)', r.results.length === 0)
}

{
  atributo.run('group', GRUPO, 'atendimento_humano', JSON.stringify(new Date().toISOString()), iso)
  const r = avaliarEvento(db, disparo('lembrete-a'), { interno: true })
  check('conversa em atendimento humano também cala o agendado', r.results.length === 0)
}

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ntudo certo')
