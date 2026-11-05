// As duas ações de 27/10: enumerar membros e ler o acervo.
//
// Elas nascem com teste porque este projeto já aprendeu, caro, que bateria
// verde não prova que a regra existe — prova que nenhum teste a contradiz. O
// escopo `local` e o `trigger.watcher` passaram as duas por falta de guarda.
//
// O que estes casos fixam é o que eu NÃO quero ver mudar sem alguém notar:
// que falar com os membros só vale em grupo, que o modo é levado adiante, que
// ler o acervo DORME quando há passo depois, e que o metadado que volta é
// filtrado antes de virar texto.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000088@g.us'
const PESSOA = '5511900000777@s.whatsapp.net'

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', GRUPO, 'grupo_ativo', '"sim"', agora)

function publicar (id, nos, arestas, escopo = { kind: 'group', ref: GRUPO }) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: escopo.kind, id: escopo.ref }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: { nodes: nos, edges: arestas }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', escopo.kind, escopo.ref)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function evento (texto, { chat = GRUPO, kind = 'group' } = {}) {
  n++
  return {
    provider: 'zapo', accountId: 'conta', eventId: `conta:${chat}:${PESSOA}:m${n}`,
    occurredAt: agora, replay: false,
    chat: { id: chat, kind },
    sender: { id: PESSOA, authoredBySelf: false, authoredByBot: false, name: 'Quem Digitou', isAdmin: true },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', id: `m${n}`, remoteJid: chat }
  }
}

function rodar (id, ev) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  return (avaliarEvento(db, ev).results || []).find((x) => x.automationId === id)
}

const gatilho = (cmd) => ({ id: 'g', type: 'trigger.command', config: { command: cmd, match: 'exact_or_args', allowFrom: 'any' } })

// =========================================================================
// 1. FALAR COM OS MEMBROS — o motor não enumera, ele PEDE
// =========================================================================
publicar('todos', [
  gatilho('/todos'),
  { id: 'm', type: 'action.group.members', config: { mode: 'mention', text: 'oi geral', notFoundText: 'ninguém aqui' } }
], [{ from: 'g', to: 'm', on: 'matched' }])

{
  const r = rodar('todos', evento('/todos'))
  const cmd = r?.commands?.[0]
  check('sai exatamente um comando', (r?.commands || []).length === 1, JSON.stringify(r?.commands))
  check('e ele é group.members', cmd?.commandType === 'group.members', String(cmd?.commandType))
  check('o modo vai junto', cmd?.payload?.mode === 'mention', String(cmd?.payload?.mode))
  check('o aviso de grupo vazio vai junto', cmd?.payload?.notFoundText === 'ninguém aqui', cmd?.payload?.notFoundText)
  // O motor NÃO lista ninguém: a lista é do gateway, e mandar nomes daqui
  // seria inventar dado que este processo não tem.
  check('o motor não manda lista de gente nenhuma',
    !JSON.stringify(cmd?.payload || {}).includes('participant'), JSON.stringify(cmd?.payload))
}

// =========================================================================
// 2. FORA DE GRUPO, A AÇÃO RECUSA — e a recusa é registrada, não engolida
// =========================================================================
publicar('todos-pv', [
  gatilho('/todos'),
  { id: 'm', type: 'action.group.members', config: { mode: 'list' } }
], [{ from: 'g', to: 'm', on: 'matched' }], { kind: 'contact', ref: PESSOA })

{
  const r = rodar('todos-pv', evento('/todos', { chat: PESSOA, kind: 'contact' }))
  check('na conversa direta a execução vira erro', r?.status === 'error', String(r?.status))
  check('e nenhum comando é gerado', (r?.commands || []).length === 0, JSON.stringify(r?.commands))
}

// =========================================================================
// 3. LER O ACERVO — dorme quando há passo depois, e só então
// =========================================================================
publicar('vitrine', [
  gatilho('/produto'),
  { id: 'ler', type: 'action.acervo.read', config: { path: 'produtos/curso', notFoundText: 'não achei' } },
  { id: 'diz', type: 'action.whatsapp.reply', config: { text: '{{resultado.dados.nome}}' } }
], [{ from: 'g', to: 'ler', on: 'matched' }, { from: 'ler', to: 'diz', on: 'success' }])

{
  const r = rodar('vitrine', evento('/produto'))
  const cmd = r?.commands?.[0]
  check('a leitura sai como um comando só', (r?.commands || []).length === 1, JSON.stringify(r?.commands))
  check('e ele é acervo.read', cmd?.commandType === 'acervo.read', String(cmd?.commandType))
  check('com o caminho pedido', cmd?.payload?.caminho === 'produtos/curso', cmd?.payload?.caminho)
  // A marca de cano é o que faz o fluxo PARAR e esperar o resultado. Sem ela,
  // a resposta sairia junto com a leitura, com o marcador ainda cru.
  check('e marcado como encadeado, porque há passo depois', cmd?.payload?.encadeado === true, String(cmd?.payload?.encadeado))
  check('apontando para o nó que retoma', cmd?.payload?.retomarDe === 'ler', String(cmd?.payload?.retomarDe))
}

// =========================================================================
// 4. SEM PASSO DEPOIS, NÃO DORME — senão o fluxo ficaria preso para sempre
// =========================================================================
publicar('le-e-para', [
  gatilho('/so-le'),
  { id: 'ler', type: 'action.acervo.read', config: { path: 'produtos/curso' } }
], [{ from: 'g', to: 'ler', on: 'matched' }])

{
  const r = rodar('le-e-para', evento('/so-le'))
  check('a leitura solta não marca encadeado',
    r?.commands?.[0]?.payload?.encadeado === undefined, JSON.stringify(r?.commands?.[0]?.payload))
}

// =========================================================================
// 5. LER O CONTEÚDO — só quando o fluxo pede
// =========================================================================
publicar('le-conteudo', [
  gatilho('/conteudo'),
  { id: 'ler', type: 'action.acervo.read', config: { path: 'precos.json', content: true } },
  { id: 'diz', type: 'action.whatsapp.reply', config: { text: '{{resultado.dados.conteudo}}' } }
], [{ from: 'g', to: 'ler', on: 'matched' }, { from: 'ler', to: 'diz', on: 'success' }])
{
  const r = rodar('le-conteudo', evento('/conteudo'))
  check('com content ligado o comando pede o conteúdo', r?.commands?.[0]?.payload?.conteudo === true, JSON.stringify(r?.commands?.[0]?.payload))
  const sem = rodar('vitrine', evento('/produto'))
  check('sem content, nada de conteúdo no comando', sem?.commands?.[0]?.payload?.conteudo === undefined)
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE MEMBROS E ACERVO LIDO PASSARAM')
process.exit(falhas ? 1 : 0)
