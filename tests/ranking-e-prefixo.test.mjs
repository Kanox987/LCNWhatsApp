// Ranking e o operador "começa com" — os dois que saíram do painel de 27/10.
//
// Eu tinha declarado as duas coisas IMPOSSÍVEIS. As três cabeças consultadas
// em separado disseram que não: ordenar pertence a quem tem o banco, e
// comparar prefixo é só um operador a mais. Estavam certas, e este arquivo
// guarda o que cada uma delas corrigiu.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { montarIdMembro } from '../src/engine/server/attributeScopes.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000011@g.us'
const OUTRO_GRUPO = '120363000000000022@g.us'
const A = '5511900000001@s.whatsapp.net'
const B = '5511900000002@s.whatsapp.net'
const C = '5511900000003@s.whatsapp.net'

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
const atributo = db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
atributo.run('group', GRUPO, 'grupo_ativo', '"sim"', agora)

// Pontos no grupo do teste…
atributo.run('group_member', montarIdMembro(GRUPO, A), 'pontos', '7', agora)
atributo.run('group_member', montarIdMembro(GRUPO, B), 'pontos', '42', agora)
atributo.run('group_member', montarIdMembro(GRUPO, C), 'pontos', '"muitos"', agora)
// …e no grupo vizinho, que NÃO pode vazar para o ranking deste.
atributo.run('group_member', montarIdMembro(OUTRO_GRUPO, A), 'pontos', '999', agora)

function publicar (id, nos, arestas) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: { nodes: nos, edges: arestas }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
const evento = (texto, de = A) => ({
  provider: 'zapo', accountId: 'conta', eventId: `conta:${GRUPO}:${de}:r${++n}`,
  occurredAt: agora, replay: false,
  chat: { id: GRUPO, kind: 'group' },
  sender: { id: de, authoredBySelf: false, authoredByBot: false, name: 'Quem', isAdmin: true },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', id: `r${n}`, remoteJid: GRUPO }
})

function rodar (id, ev) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  return (avaliarEvento(db, ev).results || []).find((x) => x.automationId === id)
}

const gatilho = (cmd) => ({ id: 'g', type: 'trigger.command', config: { command: cmd, match: 'exact_or_args', allowFrom: 'any' } })

// =========================================================================
// 1. O RANKING ORDENA, e ordena do maior para o menor
// =========================================================================
publicar('rank', [
  gatilho('/ranking'),
  { id: 'r', type: 'action.variable.rank', config: { scope: 'group_member', key: 'pontos', limit: 10, headerText: 'TOPO', lineFormat: '{{posicao}}:{{numero}}={{valor}}', emptyText: 'ninguém' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

{
  const r = rodar('rank', evento('/ranking'))
  const texto = r?.commands?.[0]?.payload?.text || ''
  check('sai uma resposta só', (r?.commands || []).length === 1, JSON.stringify(r?.commands))
  check('o título vem primeiro', texto.startsWith('TOPO'), texto)
  check('quem tem mais pontos vem antes', texto.indexOf('5511900000002') < texto.indexOf('5511900000001'), texto)
  check('e os valores aparecem', texto.includes('=42') && texto.includes('=7'), texto)
  // Marcar de verdade é o que faz o WhatsApp mostrar o NOME. Sem isso a
  // lista sai com números crus e ninguém reconhece ninguém.
  check('as pessoas do topo são marcadas', (r?.commands?.[0]?.payload?.mentions || []).length === 2, JSON.stringify(r?.commands?.[0]?.payload?.mentions))
}

// =========================================================================
// 2. O GRUPO VIZINHO NÃO VAZA
// =========================================================================
// É a mesma promessa que a advertência faz: 3 avisos no grupo A não somam
// com os do grupo B. Um ranking que vazasse quebraria a promessa inteira.
{
  const texto = rodar('rank', evento('/ranking'))?.commands?.[0]?.payload?.text || ''
  check('pontos de outro grupo não entram', !texto.includes('999'), texto)
}

// =========================================================================
// 3. CONTADOR DE TEXTO FICA DE FORA, não entra como zero
// =========================================================================
{
  const texto = rodar('rank', evento('/ranking'))?.commands?.[0]?.payload?.text || ''
  check('quem tem o contador em texto não aparece', !texto.includes('5511900000003'), texto)
}

// =========================================================================
// 4. RANKING VAZIO AVISA, não fica mudo
// =========================================================================
publicar('rank-vazio', [
  gatilho('/outro'),
  { id: 'r', type: 'action.variable.rank', config: { scope: 'group_member', key: 'nunca_usado', emptyText: 'ninguém pontuou' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

{
  const r = rodar('rank-vazio', evento('/outro'))
  check('contador que ninguém usou responde o aviso',
    r?.commands?.[0]?.payload?.text === 'ninguém pontuou', r?.commands?.[0]?.payload?.text)
}

// =========================================================================
// 5. "COMEÇA COM" é diferente de "contém", e a diferença é o ponto
// =========================================================================
// O porteiro anti-fake conferia o código do país com `contém`, que acha "55"
// em QUALQUER posição: um número estrangeiro com 55 no meio passava como
// brasileiro. Estes dois casos fixam a diferença.
const compara = (operador, esquerda, direita) => ({
  id: 'c', type: 'condition.compare',
  config: { left: { source: 'literal', value: esquerda }, operator: operador, right: { source: 'literal', value: direita } }
})

const publicarCond = (id, cmd, no) => publicar(id, [
  gatilho(cmd), no,
  { id: 'sim', type: 'action.whatsapp.reply', config: { text: 'SIM' } },
  { id: 'nao', type: 'action.whatsapp.reply', config: { text: 'NAO' } }
], [{ from: 'g', to: 'c', on: 'matched' }, { from: 'c', to: 'sim', on: 'true' }, { from: 'c', to: 'nao', on: 'false' }])

publicarCond('pre-ok', '/p1', compara('starts_with', '5511999', '55'))
publicarCond('pre-meio', '/p2', compara('starts_with', '15551234', '55'))
publicarCond('contem-meio', '/p3', compara('contains', '15551234', '55'))
publicarCond('pre-sem-valor', '/p4', compara('starts_with', '', '55'))

const diz = (id, cmd) => rodar(id, evento(cmd))?.commands?.[0]?.payload?.text

check('número brasileiro começa com 55', diz('pre-ok', '/p1') === 'SIM', diz('pre-ok', '/p1'))
check('número com 55 no MEIO não começa com 55', diz('pre-meio', '/p2') === 'NAO', diz('pre-meio', '/p2'))
check('e é exatamente onde "contém" errava', diz('contem-meio', '/p3') === 'SIM', diz('contem-meio', '/p3'))
check('sem valor nenhum, não vira sim', diz('pre-sem-valor', '/p4') === 'NAO', diz('pre-sem-valor', '/p4'))

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE RANKING E PREFIXO PASSARAM')
process.exit(falhas ? 1 : 0)
