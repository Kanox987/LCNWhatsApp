// O relógio do motor (src/engine/server/agendador.js), com relógio injetado.
//
// `lcn-agendado.test.mjs` prova o que o AVALIADOR garante quando o relógio o
// acorda. Aqui se prova o relógio: semeia o primeiro disparo, dispara no
// instante certo, não dispara duas vezes, não dispara em rajada depois de ficar
// parado, esquece o que foi desligado/editado e recupera o que ficou no meio.
// Nada espera tempo passar: `tick(db, agora)` recebe o instante.
import { abrirBanco } from '../src/engine/server/db.js'
import { tick, reconciliar, reivindicar, contaDoDisparo, eventIdDoDisparo, TOLERANCIA_PADRAO_MS } from '../src/engine/server/agendador.js'
import { compilar } from '../src/lcn/compilar.js'
import { validarAutomacao } from '../src/engine/server/validate.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000088@g.us'
const OUTRO = '120363000000000099@g.us'
const T0 = new Date('2026-11-04T15:00:00Z')
const mais = (d, ms) => new Date(d.getTime() + ms)
const MIN = 60 * 1000

const agendado = (nome, agenda, onde, corpo = 'responde "oi"') =>
  ['automação ' + nome, '  tipo: agendado', `  agenda: ${agenda}`, `  onde: grupo ${onde}`, '', `  ${corpo}`, ''].join('\n')

function novoBanco () {
  const db = abrirBanco(':memory:')
  const iso = T0.toISOString()
  db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?,?,?,?,?,?)').run('i1', 'zapo', 'conta-1', 'Número 1', iso, iso)
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?,?,?,?)').run('p1', 'Pool', iso, iso)
  db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?,?,?,?)').run('p1', 'i1', 1, 1)
  db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)').run('group', GRUPO, 'grupo_ativo', '"sim"', iso)
  db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)').run('group', OUTRO, 'grupo_ativo', '"sim"', iso)
  return db
}

function publicar (db, id, fonte, { grupo = GRUPO, revision = 1, ligada = true, agora = T0 } = {}) {
  const iso = agora.toISOString()
  const doc = { ...compilar(fonte, { agora }), id, revision, responder: { strategy: 'weighted_rendezvous', poolId: 'p1' } }
  if (!db.prepare('SELECT 1 FROM automations WHERE id = ?').get(id)) {
    db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)').run(id, ligada ? 1 : 0, 'live', iso, iso)
  }
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, ?, ?, ?, ?)').run(id, revision, 'active', JSON.stringify(doc), iso)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', grupo)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

const jobs = (db, id) => db.prepare('SELECT * FROM schedule_jobs WHERE automation_id = ? ORDER BY id').all(id)
const comandos = (db) => db.prepare('SELECT COUNT(*) AS n FROM outbound_commands').get().n

// --- semeadura: o primeiro disparo de cada forma -------------------------------
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 30 minutos', GRUPO))
  publicar(db, 'abs', agendado('abs', '23/08/2030 às 14:30', GRUPO))
  publicar(db, 'dia', agendado('dia', 'todo dia às 08:00', GRUPO))
  publicar(db, 'int', agendado('int', 'a cada 15 minutos', GRUPO))
  const r = reconciliar(db, T0)
  check('semeia um disparo por automação agendada', r.criados === 4, JSON.stringify(r))
  check('"daqui 30 minutos" conta de quando entrou no ar', jobs(db, 'rel')[0].scheduled_for === mais(T0, 30 * MIN).toISOString(), jobs(db, 'rel')[0].scheduled_for)
  check('data absoluta respeita o fuso (14:30 em São Paulo = 17:30Z)', jobs(db, 'abs')[0].scheduled_for === '2030-08-23T17:30:00.000Z', jobs(db, 'abs')[0].scheduled_for)
  check('diário cai na próxima 08:00 de São Paulo (11:00Z)', jobs(db, 'dia')[0].scheduled_for === '2026-11-05T11:00:00.000Z', jobs(db, 'dia')[0].scheduled_for)
  const de = reconciliar(db, mais(T0, MIN))
  check('reconciliar duas vezes não semeia de novo', de.criados === 0 && jobs(db, 'rel').length === 1)
}

// --- disparo no instante certo, uma vez só -------------------------------------
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 30 minutos', GRUPO, 'responde "lembrete"'))
  tick(db, T0)
  const cedo = tick(db, mais(T0, 29 * MIN))
  check('antes da hora não dispara', cedo.disparados === 0 && comandos(db) === 0)
  const hora = tick(db, mais(T0, 30 * MIN))
  check('na hora dispara e enfileira o comando', hora.disparados === 1 && comandos(db) === 1, JSON.stringify(hora))
  const cmd = db.prepare('SELECT target_account_id, payload_json FROM outbound_commands').get()
  check('o comando sai pela conta do pool, para o destino do onde:', cmd.target_account_id === 'conta-1' && cmd.payload_json.includes(GRUPO) && cmd.payload_json.includes('lembrete'), cmd.payload_json)
  tick(db, mais(T0, 31 * MIN)); tick(db, mais(T0, 60 * MIN))
  check('disparo único não repete nem semeia próximo', comandos(db) === 1 && jobs(db, 'rel').length === 1 && jobs(db, 'rel')[0].status === 'done')
  // Reinício: reconciliar de novo não ressuscita o que já foi feito.
  tick(db, mais(T0, 120 * MIN))
  check('depois de feito, reconciliar não recria o disparo único', jobs(db, 'rel').length === 1 && comandos(db) === 1)
}

// --- recorrente: encadeia a próxima, sem rajada depois de parado ----------------
{
  const db = novoBanco()
  publicar(db, 'int', agendado('int', 'a cada 15 minutos', GRUPO))
  tick(db, T0)
  tick(db, mais(T0, 15 * MIN))
  tick(db, mais(T0, 30 * MIN))
  check('a cada 15 minutos dispara em 15 e 30', comandos(db) === 2, `comandos=${comandos(db)}`)
  const proximo = jobs(db, 'int').find((j) => j.status === 'pending')
  check('e deixa exatamente um próximo pendente', jobs(db, 'int').filter((j) => j.status === 'pending').length === 1 && proximo.scheduled_for === mais(T0, 45 * MIN).toISOString(), proximo?.scheduled_for)
  // O motor fica parado 3 horas: nada de 12 disparos de uma vez.
  const antes = comandos(db)
  const volta = tick(db, mais(T0, 30 * MIN + 3 * 60 * MIN))
  check('parado por 3h: o vencido vira perdido, sem rajada', volta.perdidos === 1 && volta.disparados === 0 && comandos(db) === antes, JSON.stringify(volta))
  const perdido = jobs(db, 'int').find((j) => j.status === 'perdido')
  check('o perdido guarda o motivo', /tolerância/.test(perdido?.detail ?? ''), perdido?.detail)
  const seguinte = jobs(db, 'int').find((j) => j.status === 'pending')
  check('a série continua: próximo pendente está no futuro e na grade da âncora', seguinte && Date.parse(seguinte.scheduled_for) > mais(T0, 210 * MIN).getTime() && (Date.parse(seguinte.scheduled_for) - T0.getTime()) % (15 * MIN) === 0, seguinte?.scheduled_for)
}

// --- atraso pequeno ainda dispara ----------------------------------------------
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 10 minutos', GRUPO))
  tick(db, T0)
  const r = tick(db, mais(T0, 10 * MIN + TOLERANCIA_PADRAO_MS - 1000))
  check('atraso dentro da tolerância ainda dispara', r.disparados === 1 && r.perdidos === 0)
}

// --- desligar, despublicar e editar --------------------------------------------
{
  const db = novoBanco()
  publicar(db, 'a', agendado('a', 'daqui 30 minutos', GRUPO))
  tick(db, T0)
  db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run('a')
  const r = tick(db, mais(T0, 31 * MIN))
  check('desligada antes da hora: não dispara e o job vira cancelado', r.disparados === 0 && comandos(db) === 0 && jobs(db, 'a')[0].status === 'cancelado', jobs(db, 'a')[0].status)
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run('a')
  const T2 = mais(T0, 40 * MIN)
  tick(db, T2)
  check('religar semeia de novo: "daqui 30 minutos" recomeça a contar', comandos(db) === 0 && jobs(db, 'a').filter((j) => j.status === 'pending')[0]?.scheduled_for === mais(T2, 30 * MIN).toISOString())
}
{
  // O erro que isto guarda: um diário desligado uma vez nunca mais disparar.
  const db = novoBanco()
  publicar(db, 'dia', agendado('dia', 'todo dia às 08:00', GRUPO))
  tick(db, T0)
  db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run('dia')
  tick(db, mais(T0, MIN))
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run('dia')
  tick(db, mais(T0, 2 * MIN))
  const manha = new Date('2026-11-05T11:00:00Z')
  const r = tick(db, manha)
  check('diário desligado e religado volta a disparar na próxima 08:00', r.disparados === 1 && comandos(db) === 1, JSON.stringify(r))
}
{
  // O mesmo erro, depois de a série já ter disparado: sobra uma linha `done` e
  // ela não pode contar como "semeado" para uma série recorrente.
  const db = novoBanco()
  publicar(db, 'dia', agendado('dia', 'todo dia às 08:00', GRUPO))
  tick(db, T0)
  const r1 = tick(db, new Date('2026-11-05T11:00:00Z'))
  db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run('dia')
  tick(db, new Date('2026-11-05T11:01:00Z'))
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run('dia')
  tick(db, new Date('2026-11-05T11:02:00Z'))
  const r2 = tick(db, new Date('2026-11-06T11:00:00Z'))
  check('diário que já disparou, desligado e religado, volta a disparar no dia seguinte', r1.disparados === 1 && r2.disparados === 1 && comandos(db) === 2, JSON.stringify([r1, r2]))
}
{
  // Data absoluta: desligar e religar antes da data reabre a MESMA ocorrência.
  const db = novoBanco()
  publicar(db, 'abs', agendado('abs', '23/08/2030 às 14:30', GRUPO))
  tick(db, T0)
  db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run('abs')
  tick(db, mais(T0, MIN))
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run('abs')
  tick(db, mais(T0, 2 * MIN))
  const js = jobs(db, 'abs')
  check('data absoluta religada antes da data reabre a ocorrência (sem linha duplicada)', js.length === 1 && js[0].status === 'pending', js.map((j) => j.status).join())
  const r = tick(db, new Date('2030-08-23T17:30:00Z'))
  check('e dispara na data', r.disparados === 1 && comandos(db) === 1)
}
{
  const db = novoBanco()
  publicar(db, 'a', agendado('a', 'daqui 30 minutos', GRUPO, 'responde "v1"'))
  tick(db, T0)
  // Edição = revisão nova. "daqui 30 minutos" volta a contar de zero.
  const T1 = mais(T0, 10 * MIN)
  publicar(db, 'a', agendado('a', 'daqui 30 minutos', GRUPO, 'responde "v2"'), { revision: 2, agora: T1 })
  tick(db, T1)
  const js = jobs(db, 'a')
  check('editar cancela o job da revisão antiga e semeia o da nova', js.length === 2 && js[0].status === 'cancelado' && js[1].status === 'pending' && js[1].revision === 2, js.map((j) => `${j.revision}:${j.status}`).join())
  check('a revisão nova conta 30 min a partir da edição', js[1].scheduled_for === mais(T1, 30 * MIN).toISOString())
  tick(db, mais(T0, 31 * MIN))
  check('o horário antigo não dispara nada', comandos(db) === 0)
  tick(db, mais(T1, 30 * MIN))
  const texto = db.prepare('SELECT payload_json FROM outbound_commands').get()
  check('na hora nova dispara a versão nova', comandos(db) === 1 && texto.payload_json.includes('v2'))
}

// --- dois relógios na mesma linha: um só dispara --------------------------------
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 5 minutos', GRUPO))
  tick(db, T0)
  const quando = mais(T0, 5 * MIN)
  const a = tick(db, quando); const b = tick(db, quando)
  check('o mesmo instante processado duas vezes dispara uma vez', a.disparados + b.disparados === 1 && comandos(db) === 1, `${a.disparados}+${b.disparados}`)
  // A reivindicação é um UPDATE condicional: quem chega com a linha já tomada não leva nada.
  // Dois workers leram a mesma linha pendente; o segundo chega com a leitura velha.
  const db2 = novoBanco()
  publicar(db2, 'int', agendado('int', 'a cada 15 minutos', GRUPO))
  tick(db2, T0)
  const velha = jobs(db2, 'int')[0]
  const instante = mais(T0, 15 * MIN)
  const primeiro = reivindicar(db2, velha, instante)
  const segundo = reivindicar(db2, velha, instante)
  check('quem reivindica primeiro leva; o segundo, com a leitura velha, não leva', primeiro === true && segundo === false)
  check('e a próxima ocorrência é semeada uma vez só', jobs(db2, 'int').filter((j) => j.status === 'pending').length === 1)
}

// --- processo morreu no meio ----------------------------------------------------
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 5 minutos', GRUPO))
  tick(db, T0)
  const quando = mais(T0, 5 * MIN)
  // Simula: reivindicou e morreu antes de entregar ao avaliador.
  db.prepare("UPDATE schedule_jobs SET status = 'claimed', updated_at = ?").run(quando.toISOString())
  tick(db, mais(quando, MIN))
  check('reivindicado há pouco não é tocado (outro worker pode estar nele)', jobs(db, 'rel')[0].status === 'claimed' && comandos(db) === 0)
  const r = tick(db, mais(quando, 3 * MIN))
  check('órfão que nunca rodou volta para a fila e dispara', r.recuperados === 1 && comandos(db) === 1 && jobs(db, 'rel')[0].status === 'done', JSON.stringify(r))
}
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 5 minutos', GRUPO))
  tick(db, T0)
  const quando = mais(T0, 5 * MIN)
  tick(db, quando)
  // Simula: avaliador rodou, mas a marcação final se perdeu.
  db.prepare("UPDATE schedule_jobs SET status = 'claimed', updated_at = ?").run(quando.toISOString())
  // Passou da tolerância: se voltasse para a fila seria dado como perdido, e ele rodou.
  tick(db, mais(quando, 10 * MIN))
  check('órfão que já rodou é dado como feito (não "perdido"), sem duplicar o comando', jobs(db, 'rel')[0].status === 'done' && comandos(db) === 1)
}

// --- conta, portões e falha ------------------------------------------------------
{
  const db = novoBanco()
  const iso = T0.toISOString()
  db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?,?,?,?,?,?)').run('i2', 'zapo', 'conta-2', 'Número 2', iso, iso)
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?,?,?,?)').run('p2', 'Só o 2', iso, iso)
  db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?,?,?,?)').run('p2', 'i2', 1, 1)
  check('pool escolhe o membro dele', contaDoDisparo(db, { responder: { poolId: 'p2' } }) === 'conta-2')
  check('sem pool e com DUAS instâncias não adivinha', contaDoDisparo(db, {}) === null)
}
{
  const db = novoBanco()
  check('sem pool e com UMA instância usa a única', contaDoDisparo(db, {}) === 'conta-1')
}
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 5 minutos', GRUPO))
  db.prepare('DELETE FROM pool_members').run()
  tick(db, T0)
  const r = tick(db, mais(T0, 5 * MIN))
  const j = jobs(db, 'rel')[0]
  check('pool sem membro: vira ignorado com o motivo, não manda por conta errada', r.ignorados === 1 && j.status === 'ignorado' && /conta/.test(j.detail) && comandos(db) === 0, j.detail)
}
{
  const db = novoBanco()
  publicar(db, 'rel', agendado('rel', 'daqui 5 minutos', GRUPO))
  db.prepare("DELETE FROM entity_attributes WHERE scope_id = ?").run(GRUPO)
  tick(db, T0)
  const r = tick(db, mais(T0, 5 * MIN))
  check('grupo não autorizado: o portão fecha e o job fica ignorado', r.ignorados === 1 && jobs(db, 'rel')[0].status === 'ignorado' && comandos(db) === 0, jobs(db, 'rel')[0].detail)
}
{
  const db = novoBanco()
  publicar(db, 'int', agendado('int', 'a cada 15 minutos', GRUPO))
  tick(db, T0)
  const r = tick(db, mais(T0, 15 * MIN), { avaliar: () => { throw new Error('falha de teste') } })
  check('avaliador que lança: job vira erro, motor segue e a série continua', r.erros === 1 && jobs(db, 'int').some((j) => j.status === 'erro' && /falha de teste/.test(j.detail)) && jobs(db, 'int').some((j) => j.status === 'pending'))
}
{
  // O run da automação decide o estado do job: erro de fluxo não pode virar `done`.
  for (const [status, esperado] of [['error', 'erro'], ['desligado', 'ignorado'], ['no_match', 'ignorado'], ['matched_live', 'done'], ['matched_shadow', 'done']]) {
    const db = novoBanco()
    publicar(db, 'x', agendado('x', 'daqui 5 minutos', GRUPO))
    tick(db, T0)
    tick(db, mais(T0, 5 * MIN), { avaliar: (_db, ev) => ({ eventId: ev.eventId, results: [{ automationId: 'x', status, commands: [] }] }) })
    check(`run com status ${status} marca o job como ${esperado}`, jobs(db, 'x')[0].status === esperado, jobs(db, 'x')[0].status)
  }
}
{
  // JSON enviado direto à API não passa pelo compilador: o fuso precisa ser conferido no motor.
  const bom = compilar(agendado('v', 'daqui 5 minutos', GRUPO), { agora: T0 })
  const no = (d) => d.flow.nodes.find((n) => n.type === 'trigger.schedule')
  const comFuso = (fuso) => { const d = structuredClone(bom); no(d).config.timezone = fuso; return d }
  const errosDoFuso = (d) => validarAutomacao(null, d).filter((e) => /timezone/.test(e.path))
  check('fuso IANA válido passa na validação do motor', errosDoFuso(bom).length === 0)
  check('fuso inexistente é recusado na publicação', errosDoFuso(comFuso('Marte/Olympus')).length === 1)
}

// --- o eventId é determinístico --------------------------------------------------
{
  const j = { automation_id: 'a', revision: 2, chat_id: GRUPO, scheduled_for: '2026-11-04T15:30:00.000Z' }
  check('eventId depende só de (automação, revisão, chat, instante)', eventIdDoDisparo(j) === eventIdDoDisparo({ ...j }) && eventIdDoDisparo(j) !== eventIdDoDisparo({ ...j, revision: 3 }))
}

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ntudo certo')
