// src/engine/server/validate.js — validação do documento de automação
// (JSON Schema + estrutural: referências, ciclo e linearidade). Usa um banco :memory:
// só pra popular pool/connection que os testes de referência precisam.
import { abrirBanco } from '../src/engine/server/db.js'
import { validarAutomacao } from '../src/engine/server/validate.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('bots-clima', 'Bots do clima', agora, agora)
db.prepare('INSERT INTO connections (id, kind, config_json, secret_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  .run('api-clima', 'http', '{}', '{}', agora, agora)

function docBase (overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'clima-do-grupo',
    revision: 1,
    enabled: false,
    name: 'Consultar clima',
    scope: { include: [{ kind: 'group', id: '1@g.us' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'bots-clima' },
    flow: {
      nodes: [
        { id: 'trigger', type: 'trigger.command', config: { command: '/clima', match: 'exact_or_args', allowFrom: 'external' } },
        { id: 'request', type: 'action.http', config: { connectionRef: 'api-clima', method: 'GET', path: '/weather', timeoutMs: 5000 } },
        { id: 'reply', type: 'action.whatsapp.reply', config: { text: 'ok' } }
      ],
      edges: [{ from: 'trigger', to: 'request', on: 'matched' }, { from: 'request', to: 'reply', on: 'success' }]
    },
    ...overrides
  }
}

// --- documento válido ---
const r1 = validarAutomacao(db, docBase())
check('documento completo e correto valida sem erro', Array.isArray(r1) && r1.length === 0)

// --- schemaVersion errada ---
const r2 = validarAutomacao(db, docBase({ schemaVersion: 2 }))
check('schemaVersion diferente de 1 é rejeitado', r2.length > 0)

// --- campo obrigatório faltando ---
const semNome = docBase()
delete semNome.name
const r3 = validarAutomacao(db, semNome)
check('campo obrigatório faltando (name) é rejeitado', r3.length > 0)

// --- tipo de nó fora da lista v1 ---
const r4 = validarAutomacao(db, docBase({ flow: { nodes: [{ id: 'a', type: 'action.qualquer_coisa', config: {} }], edges: [] } }))
check('tipo de nó fora da lista v1 é rejeitado', r4.length > 0)

// --- edge apontando pra node.id inexistente ---
const r5 = validarAutomacao(db, docBase({ flow: { ...docBase().flow, edges: [{ from: 'trigger', to: 'nao-existe', on: 'matched' }] } }))
check('edge.to apontando pra node inexistente é rejeitado', r5.length > 0)
check('erro de edge quebrada aponta o node.id certo na mensagem', r5.some((e) => e.message.includes('nao-existe')))

const r5b = validarAutomacao(db, docBase({ flow: { ...docBase().flow, edges: [{ from: 'nao-existe', to: 'reply', on: 'matched' }] } }))
check('edge.from apontando pra node inexistente também é rejeitado', r5b.length > 0)

// --- connectionRef inexistente ---
const r6 = validarAutomacao(db, docBase({
  flow: {
    nodes: [
      docBase().flow.nodes[0],
      { id: 'request', type: 'action.http', config: { connectionRef: 'nao-existe', method: 'GET', path: '/x', timeoutMs: 1000 } }
    ],
    edges: [{ from: 'trigger', to: 'request', on: 'matched' }]
  }
}))
check('connectionRef apontando pra conexão inexistente é rejeitado', r6.length > 0)

// --- poolId inexistente ---
const r7 = validarAutomacao(db, docBase({ responder: { strategy: 'weighted_rendezvous', poolId: 'nao-existe' } }))
check('poolId apontando pra pool inexistente é rejeitado', r7.length > 0)

// --- ciclo no grafo ---
const r8 = validarAutomacao(db, docBase({
  flow: {
    nodes: [
      { id: 'a', type: 'trigger.command', config: { command: '/x', match: 'exact', allowFrom: 'external' } },
      { id: 'b', type: 'action.whatsapp.reply', config: { text: 'oi' } }
    ],
    edges: [{ from: 'a', to: 'b', on: 'matched' }, { from: 'b', to: 'a', on: 'success' }]
  }
}))
check('ciclo simples (a->b->a) é rejeitado', r8.length > 0)

// --- nó isolado sem ciclo continua válido (não é obrigado a formar uma cadeia única) ---
const r9 = validarAutomacao(db, docBase({
  flow: {
    nodes: [
      { id: 'a', type: 'trigger.command', config: { command: '/x', match: 'exact', allowFrom: 'external' } },
      { id: 'b', type: 'action.whatsapp.reply', config: { text: 'oi' } }
    ],
    edges: [{ from: 'a', to: 'b', on: 'matched' }]
  }
}))
check('grafo linear simples sem ciclo valida OK', r9.length === 0)

// --- action.variable.set bem formada passa pelo schema ---
const docVariableSet = docBase({
  flow: {
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: '/set', match: 'exact', allowFrom: 'external' } },
      { id: 'set', type: 'action.variable.set', config: { scope: 'sender', key: 'apelido', value: '{{message.text}}' } }
    ],
    edges: [{ from: 'trigger', to: 'set', on: 'matched' }]
  }
})
const r10 = validarAutomacao(db, docVariableSet)
check('action.variable.set bem formada valida sem erro', r10.length === 0)

// --- scope fora de chat/sender é barrado pelo JSON Schema ---
const docVariableScopeInvalido = structuredClone(docVariableSet)
docVariableScopeInvalido.flow.nodes[1].config.scope = 'grupo'
const r11 = validarAutomacao(db, docVariableScopeInvalido)
check('action.variable.set com scope fora de chat/sender é rejeitada', r11.length > 0)

// --- duas saídas success do mesmo nó violam a capacidade linear da v1 ---
const r12 = validarAutomacao(db, docBase({
  flow: {
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: '/x', match: 'exact', allowFrom: 'external' } },
      { id: 'origem', type: 'action.variable.set', config: { scope: 'chat', key: 'x', value: '1' } },
      { id: 'destino-a', type: 'action.whatsapp.reply', config: { text: 'a' } },
      { id: 'destino-b', type: 'action.whatsapp.reply', config: { text: 'b' } }
    ],
    edges: [
      { from: 'trigger', to: 'origem', on: 'matched' },
      { from: 'origem', to: 'destino-a', on: 'success' },
      { from: 'origem', to: 'destino-b', on: 'success' }
    ]
  }
}))
check('duas arestas success saindo do mesmo nó são rejeitadas', r12.length > 0)
check('erro de ramificação aponta o on da segunda aresta conflitante', r12.some((e) => e.path === '/flow/edges/2/on' && e.message.includes('mais de uma aresta de saída')))

// --- validador nunca lança, mesmo com entrada absurda ---
let lancou = false
try { validarAutomacao(db, null) } catch { lancou = true }
check('documento nulo não lança exceção (retorna inválido)', !lancou)
let lancou2 = false
try { validarAutomacao(db, {}) } catch { lancou2 = true }
check('documento vazio não lança exceção', !lancou2)

db.close()

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE VALIDAÇÃO DE AUTOMAÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
