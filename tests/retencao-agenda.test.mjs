// A varredura de retenção também poda o relógio do motor (`schedule_jobs`), e
// só o que pode sair. O risco é o oposto do da execução: apagar a linha de um
// disparo ÚNICO que já foi feito. `reconciliar` usa a existência dela para
// saber que "daqui 30 minutos" já aconteceu; sem a linha, o mesmo disparo
// semearia de novo e a mensagem sairia outra vez.
import { abrirBanco } from '../src/engine/server/db.js'
import { reconciliar, tick } from '../src/engine/server/agendador.js'
import { contar, varrer } from '../src/engine/server/retencao.js'
import { compilar } from '../src/lcn/compilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000088@g.us'
const T0 = new Date('2026-11-04T15:00:00Z')
const MIN = 60 * 1000
const HORA = 60 * MIN
const mais = (d, ms) => new Date(d.getTime() + ms)

const agendado = (nome, agenda) =>
  ['automação ' + nome, '  tipo: agendado', `  agenda: ${agenda}`, `  onde: grupo ${GRUPO}`, '', '  responde "oi"', ''].join('\n')

function novoBanco () {
  const db = abrirBanco(':memory:')
  const iso = T0.toISOString()
  db.prepare('INSERT INTO instances (id, provider, account_id, label, registered_at, updated_at) VALUES (?,?,?,?,?,?)').run('i1', 'zapo', 'conta-1', 'Número 1', iso, iso)
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?,?,?,?)').run('p1', 'Pool', iso, iso)
  db.prepare('INSERT INTO pool_members (pool_id, instance_id, weight, enabled) VALUES (?,?,?,?)').run('p1', 'i1', 1, 1)
  db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)').run('group', GRUPO, 'grupo_ativo', '"sim"', iso)
  return db
}

function publicar (db, id, fonte) {
  const iso = T0.toISOString()
  const doc = { ...compilar(fonte, { agora: T0 }), id, revision: 1, responder: { strategy: 'weighted_rendezvous', poolId: 'p1' } }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', iso, iso)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), iso)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

const jobs = (db, id) => db.prepare('SELECT status, scheduled_for FROM schedule_jobs WHERE automation_id = ? ORDER BY scheduled_for').all(id)
const comandos = (db) => db.prepare('SELECT COUNT(*) AS n FROM outbound_commands').get().n

// --- série recorrente: o histórico sai, o próximo disparo fica ------------------
{
  const db = novoBanco()
  publicar(db, 'serie', agendado('serie', 'a cada 15 minutos'))
  tick(db, T0)
  for (let m = 15; m <= 6 * 60; m += 15) tick(db, mais(T0, m * MIN))
  const antes = jobs(db, 'serie')
  check('a série acumulou histórico (uma linha por ocorrência)', antes.length > 20, `${antes.length} linhas`)

  const fim = mais(T0, 6 * HORA)
  const previsto = contar(db, { agora: fim.getTime(), horas: 2 }).vencidos.agendamentos
  const feito = varrer(db, { agora: fim.getTime(), horas: 2 })
  check('a contagem prevê o que a varredura apaga', feito.agendamentos === previsto && previsto > 0, `${feito.agendamentos} de ${previsto}`)
  const depois = jobs(db, 'serie')
  check('sobrou só o que está dentro da janela, mais o próximo', depois.length === antes.length - feito.agendamentos)
  check('nada fora da janela sobrou entre as feitas', depois.filter((j) => j.status === 'done' && j.scheduled_for < mais(fim, -2 * HORA).toISOString()).length === 0)
  check('o próximo disparo continua pendente', depois.filter((j) => j.status === 'pending').length === 1)

  // A série segue funcionando depois da poda: não semeia em dobro nem para.
  const r = reconciliar(db, fim)
  check('reconciliar não semeia de novo uma série podada', r.criados === 0)
  const antesDeDisparar = comandos(db)
  const t = tick(db, mais(fim, 16 * MIN))
  check('e a série segue disparando', t.disparados >= 1 && comandos(db) > antesDeDisparar, JSON.stringify(t))
  db.close()
}

// --- disparo ÚNICO: a linha feita nunca sai, senão o disparo se repete -----------
{
  const db = novoBanco()
  publicar(db, 'unico', agendado('unico', 'daqui 30 minutos'))
  tick(db, T0)
  tick(db, mais(T0, 30 * MIN))
  check('o disparo único aconteceu uma vez', comandos(db) === 1 && jobs(db, 'unico')[0].status === 'done')

  const longe = mais(T0, 90 * 24 * HORA)
  check('a contagem não o considera vencido', contar(db, { agora: longe.getTime(), horas: 1 }).vencidos.agendamentos === 0)
  const feito = varrer(db, { agora: longe.getTime(), horas: 1 })
  check('a varredura não apaga a linha do disparo único', feito.agendamentos === 0 && jobs(db, 'unico').length === 1)

  const r = reconciliar(db, longe)
  tick(db, mais(longe, 5 * MIN))
  check('depois da varredura o disparo único não semeia nem repete', r.criados === 0 && comandos(db) === 1 && jobs(db, 'unico').length === 1)
  db.close()
}

// --- o que ainda vai acontecer ou pode ser reaberto fica ------------------------
{
  const db = novoBanco()
  publicar(db, 'futuro', agendado('futuro', 'daqui 30 minutos'))
  publicar(db, 'cancelada', agendado('cancelada', 'a cada 15 minutos'))
  reconciliar(db, T0)
  db.prepare("UPDATE schedule_jobs SET status = 'cancelado' WHERE automation_id = 'cancelada'").run()
  db.prepare("INSERT INTO schedule_jobs (automation_id, revision, chat_id, chat_kind, scheduled_for, anchor, status, created_at, updated_at) VALUES ('cancelada', 1, ?, 'group', ?, ?, 'done', ?, ?)")
    .run(GRUPO, mais(T0, -48 * HORA).toISOString(), T0.toISOString(), T0.toISOString(), T0.toISOString())
  const longe = mais(T0, 30 * 24 * HORA)
  varrer(db, { agora: longe.getTime(), horas: 1 })
  check('pendente e cancelado não são apagados', jobs(db, 'futuro').length === 1 && jobs(db, 'cancelada').some((j) => j.status === 'cancelado'))
  check('janela 0 guarda tudo, inclusive o relógio', varrer(db, { agora: longe.getTime(), horas: 0 }).agendamentos === 0)
  db.close()
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nretenção do relógio: tudo certo')
