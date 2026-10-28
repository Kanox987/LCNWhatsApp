// Atalho de comando: "/play" e "/p" na mesma automação.
//
// Pedido do dono, nas palavras dele: "dar pra criar alias pra um comando tipo,
// play virar p ou fig vira f".
//
// A parte difícil não é casar duas palavras — é que o motor usa o comando
// também para TIRAR o prefixo do texto e saber o que são os argumentos.
// Descontar "/play" de "/p musica" devolveria lixo, e o comando receberia
// argumento errado sem ninguém notar. É isso que estes casos guardam.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { conflitosDeComando } from '../src/engine/server/conflitos.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// =========================================================================
// 1. A LINGUAGEM: uma linha, vírgula entre as palavras, ida e volta fechada
// =========================================================================
const fonte = [
  'automação', '  nome: Tocar', '  tipo: comando',
  '  dispara com: /play, /p, /tocar',
  '  pool: p1', '  acessa: texto', '  casa: exato ou com argumentos', '  quem: qualquer um',
  '', '  responde "{{message.args}}"'
].join('\n')

const doc = compilar(fonte)
const cfg = doc.flow.nodes.find((n) => n.type === 'trigger.command').config
check('a primeira palavra é o nome oficial', cfg.command === '/play', cfg.command)
check('as outras viram atalhos, na ordem', JSON.stringify(cfg.aliases) === JSON.stringify(['/p', '/tocar']), JSON.stringify(cfg.aliases))
check('a ida e volta fecha', JSON.stringify(compilar(descompilar(doc)).flow) === JSON.stringify(doc.flow))

// Sem atalho, o campo NÃO pode aparecer: os 108 templates do catálogo passam
// pela ida e volta, e um campo a mais quebraria todos de uma vez.
const simples = compilar(fonte.replace('  dispara com: /play, /p, /tocar', '  dispara com: /play'))
check('sem atalho, o documento não ganha o campo',
  simples.flow.nodes[0].config.aliases === undefined, JSON.stringify(simples.flow.nodes[0].config))

// Erros de uso que precisam ser recusados na cara, e não aceitos calados.
const recusa = (texto, oQue) => {
  try { compilar(fonte.replace('  dispara com: /play, /p, /tocar', `  dispara com: ${texto}`)); check(oQue, false, 'compilou') } catch { check(oQue, true) }
}
recusa('/play, /p p', 'atalho com espaço é recusado')
recusa('/play, /play', 'a mesma palavra duas vezes é recusada')

// =========================================================================
// 2. O MOTOR: casa pelos dois, e os argumentos saem certos pelos dois
// =========================================================================
const GRUPO = '120363000000000099@g.us'
const PESSOA = '5511900000555@s.whatsapp.net'
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', GRUPO, 'grupo_ativo', '"sim"', agora)

function publicar (id, trigger) {
  const documento = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: trigger },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: '[{{message.args}}]' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(documento), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
const evento = (texto) => ({
  provider: 'zapo', accountId: 'conta', eventId: `conta:${GRUPO}:${PESSOA}:a${++n}`,
  occurredAt: agora, replay: false,
  chat: { id: GRUPO, kind: 'group' },
  sender: { id: PESSOA, authoredBySelf: false, authoredByBot: false, name: 'Quem', isAdmin: true },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', id: `a${n}`, remoteJid: GRUPO }
})

publicar('tocar', { command: '/play', aliases: ['/p'], match: 'exact_or_args', allowFrom: 'any' })

const resposta = (texto) => {
  const r = (avaliarEvento(db, evento(texto)).results || []).find((x) => x.automationId === 'tocar')
  return { status: r?.status, texto: r?.commands?.[0]?.payload?.text }
}

check('o comando oficial casa', resposta('/play musica legal').status === 'matched_live')
check('o atalho casa também', resposta('/p musica legal').status === 'matched_live')

// O CASO QUE O ATALHO INTRODUZ: o prefixo descontado é o que a pessoa
// DIGITOU. Com o nome oficial, "/p musica" perderia dois caracteres a mais.
check('pelo oficial, os argumentos saem inteiros', resposta('/play musica legal').texto === '[musica legal]', resposta('/play musica legal').texto)
check('pelo atalho, os argumentos saem inteiros também', resposta('/p musica legal').texto === '[musica legal]', resposta('/p musica legal').texto)
check('palavra parecida não casa', resposta('/playlist musica').status !== 'matched_live', String(resposta('/playlist musica').status))

// =========================================================================
// 3. A TELA DE CONFLITOS ENXERGA O ATALHO
// =========================================================================
// Era o buraco mais fácil de deixar: um atalho curto é MAIS provável de
// colidir que o comando principal, e uma tela cega para ele avisaria menos
// justamente onde o risco é maior.
publicar('perfil', { command: '/p', match: 'exact', allowFrom: 'any' })
{
  const achados = conflitosDeComando(db)
  const disputa = achados.find((c) => c.comando === '/p')
  check('duas automações disputando /p aparecem como conflito', !!disputa, JSON.stringify(achados))
  check('e as duas são nomeadas', (disputa?.automacoes || []).length === 2, JSON.stringify(disputa?.automacoes))
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ATALHO DE COMANDO PASSARAM')
process.exit(falhas ? 1 : 0)
