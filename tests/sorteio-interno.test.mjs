// Sortear dentro do bot, sem chamar serviço nenhum.
//
// A primitiva de aleatório foi RECUSADA quando custava nove camadas e a
// alternativa era "declare uma conexão HTTP que devolve número". A decisão
// mudou por um argumento que saiu de outra discussão — sobre agendamento, e
// valendo igual aqui: isolamento controla por onde o bot FALA PARA FORA, não
// impede o sistema de fazer conta sozinho.
//
// O custo da outra saída estava medido, pelo próprio revisor que a propôs:
// 0,001 ms de CPU viram 50 a 300 ms de rede, com ponto único de falha num
// /dado, e quem aluga o sistema teria que montar infraestrutura para jogar uma
// moeda. Cinco comandos saíram do bloqueio sem nenhum serviço novo.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000044@g.us'
const PESSOA = '5511900000123@s.whatsapp.net'

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', GRUPO, 'grupo_ativo', '"sim"', agora)

function publicar (id, sorteio, texto) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: `/${id}`, match: 'exact_or_args', allowFrom: 'any' } },
        { id: 's', type: 'action.variable.random', config: sorteio },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: texto } }
      ],
      edges: [{ from: 'g', to: 's', on: 'matched' }, { from: 's', to: 'r', on: 'success' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
const evento = (texto) => ({
  provider: 'zapo', accountId: 'conta', eventId: `conta:${GRUPO}:${PESSOA}:s${++n}`,
  occurredAt: agora, replay: false,
  chat: { id: GRUPO, kind: 'group' },
  sender: { id: PESSOA, authoredBySelf: false, authoredByBot: false, name: 'Quem', isAdmin: true },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', id: `s${n}`, remoteJid: GRUPO }
})

function rodar (id) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  const r = (avaliarEvento(db, evento(`/${id}`)).results || []).find((x) => x.automationId === id)
  return r?.commands?.[0]?.payload?.text
}

// =========================================================================
// 1. AS DUAS PONTAS DA FAIXA PODEM SAIR
// =========================================================================
// Um dado de seis lados que nunca tira 6 é um dado quebrado, e é o erro de
// borda mais fácil de cometer com Math.random().
publicar('dado', { scope: 'local', key: 'r', minimo: 1, maximo: 6 }, '[{{local.r}}]')
{
  const vistos = new Set()
  for (let i = 0; i < 600; i++) vistos.add(rodar('dado'))
  const numeros = [...vistos].map((t) => Number(String(t).replace(/[^0-9]/g, '')))
  check('nunca sai abaixo do mínimo', Math.min(...numeros) >= 1, String(Math.min(...numeros)))
  check('nunca sai acima do máximo', Math.max(...numeros) <= 6, String(Math.max(...numeros)))
  check('o mínimo PODE sair', numeros.includes(1))
  check('o máximo PODE sair', numeros.includes(6))
  check('e todas as faces saem', new Set(numeros).size === 6, [...new Set(numeros)].sort().join(','))
}

// =========================================================================
// 2. FAIXA DE UM VALOR SÓ É VÁLIDA
// =========================================================================
publicar('fixo', { scope: 'local', key: 'r', minimo: 7, maximo: 7 }, '[{{local.r}}]')
check('de 7 até 7 sempre dá 7', rodar('fixo') === '[7]', rodar('fixo'))

// =========================================================================
// 3. FAIXA INVERTIDA É ERRO, não resultado estranho
// =========================================================================
// Silenciar isso faria o comando responder NaN ou um número fora da faixa, e
// a causa não apareceria em lugar nenhum.
publicar('torto', { scope: 'local', key: 'r', minimo: 10, maximo: 2 }, '[{{local.r}}]')
{
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run('torto')
  const r = (avaliarEvento(db, evento('/torto')).results || []).find((x) => x.automationId === 'torto')
  check('faixa invertida vira erro registrado', r?.status === 'error', String(r?.status))
  check('e nada é enviado', (r?.commands || []).length === 0, JSON.stringify(r?.commands))
}

// =========================================================================
// 4. SORTEAR DE UMA LISTA — o que a linguagem não sabe fazer sozinha
// =========================================================================
publicar('roleta', { scope: 'local', key: 'r', entre: 'pizza, pastel , sushi' }, '[{{local.r}}]')
{
  const vistos = new Set()
  for (let i = 0; i < 300; i++) vistos.add(rodar('roleta'))
  check('só saem itens da lista', [...vistos].every((t) => ['[pizza]', '[pastel]', '[sushi]'].includes(t)), [...vistos].join(' '))
  check('os três saem', vistos.size === 3, [...vistos].join(' '))
  check('e o espaço em volta do item é aparado', !vistos.has('[ pastel ]'))
}

// =========================================================================
// 5. LISTA VAZIA É ERRO
// =========================================================================
publicar('vazia', { scope: 'local', key: 'r', entre: ' , , ' }, '[{{local.r}}]')
{
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run('vazia')
  const r = (avaliarEvento(db, evento('/vazia')).results || []).find((x) => x.automationId === 'vazia')
  check('lista sem item nenhum vira erro', r?.status === 'error', String(r?.status))
}

// =========================================================================
// 6. O SORTEIO GRAVA DE VERDADE QUANDO O ESCOPO NÃO É LOCAL
// =========================================================================
publicar('guarda', { scope: 'sender', key: 'sorte', minimo: 1, maximo: 3 }, '[{{var.sender.sorte}}]')
{
  const saida = rodar('guarda')
  const linha = db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind='contact' AND scope_id=? AND key='sorte'").get(PESSOA)
  check('escopo de pessoa grava o valor no banco', !!linha, JSON.stringify(linha))
  check('e a resposta mostra o mesmo valor gravado', saida === `[${JSON.parse(linha.value_json)}]`, `${saida} vs ${linha?.value_json}`)
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE SORTEIO INTERNO PASSARAM')
process.exit(falhas ? 1 : 0)
