// Destinos abrangentes: "todos os contatos no privado", "todos os grupos",
// "qualquer conversa" e "as conversas marcadas com X".
//
// Por que isto existe: lista de destinos vazia NUNCA significa "todos" — o erro
// é assimétrico, e um bot que responde em toda conversa pessoal por engano é
// muito pior que um bot que não responde. Mas quem QUER "todos" precisava de um
// jeito de dizer isso, e até aqui não tinha. A diferença entre esquecer e
// escolher é o ponto: sem uma opção explícita, a única saída era listar conversa
// por conversa.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)

const ANA = '5511900000001@s.whatsapp.net'
const BRUNO = '5511900000002@s.whatsapp.net'
const G1 = '120363000000000001@g.us'
const G2 = '120363000000000002@g.us'

function publicar (id, destinos) {
  const doc = {
    schemaVersion: 1,
    id,
    revision: 1,
    name: id,
    enabled: true,
    scope: { include: destinos.include, exclude: destinos.exclude || [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/oi', match: 'exact', allowFrom: 'external' } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: 'olá' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  const inserir = db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
  for (const dir of ['include', 'exclude']) {
    for (const ref of doc.scope[dir]) inserir.run(rev.lastInsertRowid, dir, ref.kind, typeof ref.id === 'string' ? ref.id : '')
  }
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function casa (automacaoId, chatId, kind) {
  const r = avaliarEvento(db, {
    provider: 'zapo',
    accountId: 'acc-1',
    eventId: `acc-1:${chatId}:x:${++n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: chatId, kind },
    sender: { id: kind === 'group' ? ANA : chatId, authoredBySelf: false },
    message: { kind: 'text', text: '/oi' },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: `M${n}` }
  })
  return r.results.find((x) => x.automationId === automacaoId)?.status === 'matched_live'
}

// --- a garantia que não pode cair: vazio é ninguém ------------------------
publicar('sem-destino', { include: [] })
check('sem destino nenhum, não casa com contato', !casa('sem-destino', ANA, 'direct'))
check('sem destino nenhum, não casa com grupo', !casa('sem-destino', G1, 'group'))

// --- todos os contatos no privado ----------------------------------------
publicar('todo-pv', { include: [{ kind: 'all_contacts' }] })
check('"todos os contatos" casa com qualquer conversa direta', casa('todo-pv', ANA, 'direct') && casa('todo-pv', BRUNO, 'direct'))
check('"todos os contatos" NÃO casa com grupo', !casa('todo-pv', G1, 'group'))
// Canal não é contato: responder num canal não é caso de uso, é acidente.
check('"todos os contatos" NÃO casa com canal', !casa('todo-pv', '12345@newsletter', 'channel'))

// --- todos os grupos -------------------------------------------------------
publicar('todo-grupo', { include: [{ kind: 'all_groups' }] })
check('"todos os grupos" casa com qualquer grupo', casa('todo-grupo', G1, 'group') && casa('todo-grupo', G2, 'group'))
check('"todos os grupos" NÃO casa com conversa direta', !casa('todo-grupo', ANA, 'direct'))

// --- qualquer conversa -----------------------------------------------------
publicar('qualquer', { include: [{ kind: 'everywhere' }] })
check('"qualquer conversa" casa com contato e com grupo', casa('qualquer', ANA, 'direct') && casa('qualquer', G1, 'group'))
check('"qualquer conversa" ainda deixa canal de fora', !casa('qualquer', '12345@newsletter', 'channel'))

// --- exclusão vence inclusão ----------------------------------------------
// É o motivo principal de os destinos amplos existirem: "em todos os grupos,
// menos neste".
publicar('grupos-menos-um', { include: [{ kind: 'all_groups' }], exclude: [{ kind: 'group', id: G2 }] })
check('"todos os grupos menos um" casa com os outros', casa('grupos-menos-um', G1, 'group'))
check('"todos os grupos menos um" NÃO casa com o excluído', !casa('grupos-menos-um', G2, 'group'))

publicar('tudo-menos-ana', { include: [{ kind: 'everywhere' }], exclude: [{ kind: 'contact', id: ANA }] })
check('exclusão de um contato vale mesmo com destino "qualquer conversa"', !casa('tudo-menos-ana', ANA, 'direct') && casa('tudo-menos-ana', BRUNO, 'direct'))

// --- conversas marcadas ----------------------------------------------------
// O marcador é a mesma variável da conversa que {{var.chat.<chave>}} lê: marcar
// alguém como vip na aba Dados é o que o coloca aqui dentro.
publicar('so-vip', { include: [{ kind: 'tagged', id: 'vip' }] })
check('sem ninguém marcado, não casa com ninguém', !casa('so-vip', ANA, 'direct'))

const marcar = (kind, id, chave, valorJson) => db.prepare(
  'INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)'
).run(kind, id, chave, valorJson, agora)

marcar('contact', ANA, 'vip', 'true')
check('quem está marcado passa a casar', casa('so-vip', ANA, 'direct'))
check('quem não está marcado continua de fora', !casa('so-vip', BRUNO, 'direct'))

// Grupo também pode ser marcado — "grupos vip" é um caso real.
marcar('group', G1, 'vip', '"sim"')
check('grupo marcado também casa', casa('so-vip', G1, 'group'))
check('grupo não marcado fica de fora', !casa('so-vip', G2, 'group'))

// Desmarcar tem que TIRAR do destino. Se `false` continuasse marcando, quem
// desmarcou alguém não teria como perceber que não funcionou.
db.prepare('UPDATE entity_attributes SET value_json = ? WHERE scope_kind = ? AND scope_id = ? AND key = ?')
  .run('false', 'contact', ANA, 'vip')
check('marcador em false NÃO marca (desmarcar funciona)', !casa('so-vip', ANA, 'direct'))

db.prepare('UPDATE entity_attributes SET value_json = ? WHERE scope_kind = ? AND scope_id = ? AND key = ?')
  .run('""', 'contact', ANA, 'vip')
check('marcador vazio NÃO marca', !casa('so-vip', ANA, 'direct'))

db.prepare('UPDATE entity_attributes SET value_json = ? WHERE scope_kind = ? AND scope_id = ? AND key = ?')
  .run('0', 'contact', ANA, 'vip')
check('marcador zero NÃO marca', !casa('so-vip', ANA, 'direct'))

db.prepare('UPDATE entity_attributes SET value_json = ? WHERE scope_kind = ? AND scope_id = ? AND key = ?')
  .run('3', 'contact', ANA, 'vip')
check('número diferente de zero marca', casa('so-vip', ANA, 'direct'))

// --- combinações -----------------------------------------------------------
publicar('vip-mais-grupos', { include: [{ kind: 'tagged', id: 'vip' }, { kind: 'all_groups' }] })
check('vários destinos somam', casa('vip-mais-grupos', ANA, 'direct') && casa('vip-mais-grupos', G2, 'group'))
check('quem não cai em nenhum continua fora', !casa('vip-mais-grupos', BRUNO, 'direct'))

// --- destino desconhecido não vira "todos" --------------------------------
// Um documento adulterado, ou uma revisão gravada por uma versão futura, não
// pode abrir a automação para o mundo por não ser reconhecida.
publicar('inventado', { include: [{ kind: 'kind_que_nao_existe', id: 'x' }] })
check('destino desconhecido não casa com nada', !casa('inventado', ANA, 'direct') && !casa('inventado', G1, 'group'))

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE DESTINO PASSARAM')
process.exit(falhas ? 1 : 0)
