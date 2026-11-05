// "Quem pode usar" no gatilho: dono, administradores do grupo, lista nomeada.
// O que se prova: quem não pode é ignorado, lista vazia não libera ninguém,
// o dono e o próprio número do bot sempre passam, e a linguagem faz a ida e volta.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { definirDono } from '../src/engine/server/owners.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'
import { adicionarNaLista } from '../src/engine/server/listas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
const CHAT = '5511900000000@s.whatsapp.net'
const DONO = '5511911111111@s.whatsapp.net'
const ANA = '5511922222222@s.whatsapp.net'
const BIA = '5511933333333@s.whatsapp.net'

function publicar (id, extra) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'contact', id: CHAT }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: `/${id}`, match: 'exact_or_args', allowFrom: 'any', ...extra } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: 'ok' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'contact', CHAT)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}
let n = 0
const evento = (sender, texto, { admin, proprio = false } = {}) => {
  n++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${CHAT}:${sender}:m${n}`, occurredAt: agora, replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: sender, authoredBySelf: proprio, ...(admin === undefined ? {} : { isAdmin: admin }) },
    message: { kind: 'text', text: texto, mentions: [] },
    providerRef: { provider: 'zapo', remoteJid: CHAT, id: `m${n}` }
  }
}
const casou = (r, id) => r.results.find((x) => x.automationId === id)?.status !== 'no_match' && r.results.some((x) => x.automationId === id)

definirDono(db, DONO, true)
publicar('adm', { requireAdmin: true })
publicar('vip', { requireList: 'vip' })
publicar('livre', {})

check('sem trava: qualquer um usa', casou(avaliarEvento(db, evento(ANA, '/livre')), 'livre'))
check('admins: administrador passa', casou(avaliarEvento(db, evento(ANA, '/adm', { admin: true })), 'adm'))
check('admins: não administrador é ignorado', !casou(avaliarEvento(db, evento(ANA, '/adm', { admin: false })), 'adm'))
check('admins: sem isAdmin no evento, fechado', !casou(avaliarEvento(db, evento(ANA, '/adm')), 'adm'))
check('admins: o dono passa mesmo sem ser administrador', casou(avaliarEvento(db, evento(DONO, '/adm', { admin: false })), 'adm'))
check('admins: o próprio número do bot passa', casou(avaliarEvento(db, evento(CHAT, '/adm', { proprio: true })), 'adm'))
check('lista vazia não libera ninguém', !casou(avaliarEvento(db, evento(ANA, '/vip')), 'vip'))
adicionarNaLista(db, 'vip', ANA)
check('lista: quem foi posto passa', casou(avaliarEvento(db, evento(ANA, '/vip')), 'vip'))
check('lista: quem não foi posto é ignorado', !casou(avaliarEvento(db, evento(BIA, '/vip')), 'vip'))
check('lista: o dono passa sem estar nela', casou(avaliarEvento(db, evento(DONO, '/vip')), 'vip'))
check('lista: administrador NÃO entra por ser administrador', !casou(avaliarEvento(db, evento(BIA, '/vip', { admin: true })), 'vip'))

// Linguagem: o campo "acesso" compila para o gatilho e volta igual.
const base = (linha) => `automação
  nome: x
  tipo: comando
  dispara com: /x
  acessa: texto
  casa: exato
  quem: qualquer um
${linha}

  responde "oi"
`
const cfgDe = (linha) => compilar(base(linha)).flow.nodes[0].config
check('linguagem: acesso admins', cfgDe('  acesso: admins').requireAdmin === true)
check('linguagem: acesso dono', cfgDe('  acesso: dono').requireOwner === true)
check('linguagem: acesso todos não grava nada', cfgDe('  acesso: todos').requireOwner === undefined && cfgDe('  acesso: todos').requireList === undefined)
check('linguagem: lista normaliza o nome', cfgDe('  acesso: lista Autorizados').requireList === 'autorizados')
for (const ruim of ['acesso: lista 9x', 'acesso: qualquer coisa', 'acesso: lista']) {
  let msg = null
  try { compilar(base(`  ${ruim}`)) } catch (e) { msg = e.message }
  check(`linguagem recusa "${ruim}"`, msg !== null && msg.includes('acesso'), msg)
}
for (const linha of ['  acesso: admins', '  acesso: lista vip']) {
  const volta = compilar(descompilar(compilar(base(linha))))
  const a = compilar(base(linha)).flow.nodes[0].config
  const b = volta.flow.nodes[0].config
  check(`ida e volta "${linha.trim()}"`, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(b))
}

// Template: "acesso: {{params.acesso}}" vira as chaves do gatilho na instalação.
const catalogo = carregarCatalogo()
const apelido = catalogo.get('apelido')
const gatilhoDe = (valores) => renderizarTemplate(apelido, valores).flow.nodes.find((no) => no.type === 'trigger.command').config
check('template: padrão "todos" não restringe', gatilhoDe({ poolId: 'p1' }).requireList === undefined && gatilhoDe({ poolId: 'p1' }).access === undefined)
check('template: admins', gatilhoDe({ poolId: 'p1', acesso: 'admins' }).requireAdmin === true)
check('template: dono', gatilhoDe({ poolId: 'p1', acesso: 'dono' }).requireOwner === true)
check('template: lista com maiúscula e espaço', gatilhoDe({ poolId: 'p1', acesso: 'Lista VIP' }).requireList === 'vip')
let recusou = null
try { gatilhoDe({ poolId: 'p1', acesso: 'todo mundo' }) } catch (e) { recusou = e.message }
check('template: valor inválido recusa com a frase do que vale', recusou !== null && recusou.includes('todos, dono, admins'), recusou)
check('template: não sobra "access" no documento', !('access' in gatilhoDe({ poolId: 'p1', acesso: 'admins' })))

process.exit(falhas ? 1 : 0)
