// Etapa 3.5 do plano: avaliador de eventos canônicos contra automações
// publicadas. Banco :memory: — nunca o banco real do motor.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento, registrarResultadoExecucao } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p-ping', 'Pool ping', agora, agora)

function criarAutomacaoComFluxo ({ id, scopeId, scopeKind = 'contact', nodes, edges, acceptedKinds = ['text'] }) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: scopeKind, id: scopeId }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: acceptedKinds, historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p-ping' },
    flow: { nodes, edges }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 0, ?, ?, ?)')
    .run(id, 'shadow', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', scopeKind, scopeId)
  db.prepare('UPDATE automations SET active_revision_id = ?, enabled = 1 WHERE id = ?').run(rev.lastInsertRowid, id)
  return { id, revisionId: rev.lastInsertRowid }
}

function criarAutomacaoPing ({ id = 'ping', scopeId = '5511999@s.whatsapp.net', match = 'exact', acceptedKinds = ['text'], allowFrom = 'external', text = 'pong' } = {}) {
  return criarAutomacaoComFluxo({
    id,
    scopeId,
    acceptedKinds,
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: '/ping', match, allowFrom } },
      { id: 'reply', type: 'action.whatsapp.reply', config: { text } }
    ],
    edges: [{ from: 'trigger', to: 'reply', on: 'matched' }]
  })
}

function definirModo (id, modo) {
  db.prepare('UPDATE automations SET deployment_mode = ? WHERE id = ?').run(modo, id)
}

function eventoBase (overrides = {}) {
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:5511999@s.whatsapp.net:5511999@s.whatsapp.net:${overrides.msgId || 'M1'}`,
    occurredAt: new Date().toISOString(), replay: false,
    chat: { id: '5511999@s.whatsapp.net', kind: 'direct' },
    sender: { id: '5511999@s.whatsapp.net', authoredBySelf: false },
    message: { kind: 'text', text: '/ping' },
    providerRef: { provider: 'zapo', remoteJid: '5511999@s.whatsapp.net', id: overrides.msgId || 'M1' },
    ...overrides
  }
}

// --- modo sombra: casa mas não gera comando ---
criarAutomacaoPing({ id: 'ping-shadow' })
const rSombra = avaliarEvento(db, eventoBase({ msgId: 'S1' }))
check('modo sombra: status matched_shadow', rSombra.results.find((r) => r.automationId === 'ping-shadow')?.status === 'matched_shadow')
check('modo sombra: nenhum comando gerado', rSombra.results.find((r) => r.automationId === 'ping-shadow')?.commands.length === 0)

// --- modo live: casa e gera comando de verdade ---
criarAutomacaoPing({ id: 'ping-live' })
definirModo('ping-live', 'live')
const rLive = avaliarEvento(db, eventoBase({ msgId: 'L1' }))
const resultLive = rLive.results.find((r) => r.automationId === 'ping-live')
check('modo live: status matched_live', resultLive?.status === 'matched_live')
check('modo live: gera exatamente 1 comando', resultLive?.commands.length === 1)
check('modo live: comando é whatsapp.reply com o texto certo', resultLive?.commands[0]?.payload?.text === 'pong')
check('modo live: comando mira a conta que recebeu o evento', resultLive?.commands[0]?.targetAccountId === 'acc-1')

// --- placeholder de latência: motor repassa receivedAtMs, mas nunca resolve
// o número sozinho (só o gateway sabe quando a resposta sai de verdade).
// Escopo PRÓPRIO (diferente do default) pra não colidir com os eventos de
// '5511999@s.whatsapp.net' usados pelo teste de idempotência logo abaixo.
const scopeLatencia = '5511777@s.whatsapp.net'
criarAutomacaoPing({ id: 'ping-latencia', scopeId: scopeLatencia, text: 'pong ({{latencyMs}}ms)' })
definirModo('ping-latencia', 'live')
const rLatencia = avaliarEvento(db, eventoBase({
  msgId: 'LAT1', receivedAtMs: Date.now() - 42,
  chat: { id: scopeLatencia, kind: 'direct' }, sender: { id: scopeLatencia, authoredBySelf: false }
}))
const resultLatencia = rLatencia.results.find((r) => r.automationId === 'ping-latencia')
check('latência: texto mantém o placeholder intacto (motor não resolve)', resultLatencia?.commands[0]?.payload?.text === 'pong ({{latencyMs}}ms)')
check('latência: payload leva receivedAtMs pro gateway resolver', typeof resultLatencia?.commands[0]?.payload?.receivedAtMs === 'number')

criarAutomacaoPing({ id: 'ping-sem-placeholder', scopeId: scopeLatencia, text: 'pong' })
definirModo('ping-sem-placeholder', 'live')
const rSemPlaceholder = avaliarEvento(db, eventoBase({
  msgId: 'NOLAT1', receivedAtMs: Date.now(),
  chat: { id: scopeLatencia, kind: 'direct' }, sender: { id: scopeLatencia, authoredBySelf: false }
}))
const resultSemPlaceholder = rSemPlaceholder.results.find((r) => r.automationId === 'ping-sem-placeholder')
check('sem placeholder: payload não carrega receivedAtMs à toa', resultSemPlaceholder?.commands[0]?.payload?.receivedAtMs === undefined)

// --- variáveis da conversa: substitui quando há atributo e preserva
// literalmente quando a chave não foi cadastrada. ---
const scopeVar = '5511666@s.whatsapp.net'
criarAutomacaoPing({ id: 'ping-var', scopeId: scopeVar, text: 'VIP={{var.chat.vip}}' })
definirModo('ping-var', 'live')
db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
  VALUES ('contact', ?, 'vip', 'true', ?)`).run(scopeVar, agora)
const rVar = avaliarEvento(db, eventoBase({
  msgId: 'VAR1', chat: { id: scopeVar, kind: 'direct' }, sender: { id: scopeVar, authoredBySelf: false }
}))
const resultVar = rVar.results.find((r) => r.automationId === 'ping-var')
check('variável da conversa é interpolada no comando', resultVar?.commands[0]?.payload?.text === 'VIP=true')

const scopeSemVar = '5511555@s.whatsapp.net'
criarAutomacaoPing({ id: 'ping-var-ausente', scopeId: scopeSemVar, text: 'VIP={{var.chat.vip}}' })
definirModo('ping-var-ausente', 'live')
const rVarAusente = avaliarEvento(db, eventoBase({
  msgId: 'VAR2', chat: { id: scopeSemVar, kind: 'direct' }, sender: { id: scopeSemVar, authoredBySelf: false }
}))
const resultVarAusente = rVarAusente.results.find((r) => r.automationId === 'ping-var-ausente')
check('variável ausente mantém o placeholder literal', resultVarAusente?.commands[0]?.payload?.text === 'VIP={{var.chat.vip}}')

// --- duas ações: a gravação atualiza o mesmo contexto usado pela resposta ---
const scopeSetReply = '5511444@s.whatsapp.net'
criarAutomacaoComFluxo({
  id: 'set-reply',
  scopeId: scopeSetReply,
  nodes: [
    { id: 'trigger', type: 'trigger.command', config: { command: '/ping', match: 'exact', allowFrom: 'external' } },
    { id: 'set', type: 'action.variable.set', config: { scope: 'chat', key: 'ultimo_texto', value: '{{message.text}}' } },
    { id: 'reply', type: 'action.whatsapp.reply', config: { text: 'Recebi {{var.chat.ultimo_texto}}' } }
  ],
  edges: [
    { from: 'trigger', to: 'set', on: 'matched' },
    { from: 'set', to: 'reply', on: 'success' }
  ]
})
definirModo('set-reply', 'live')
const rSetReply = avaliarEvento(db, eventoBase({
  msgId: 'SET1', chat: { id: scopeSetReply, kind: 'direct' }, sender: { id: scopeSetReply, authoredBySelf: false }
}))
const resultSetReply = rSetReply.results.find((r) => r.automationId === 'set-reply')
const atributoSetReply = db.prepare(`SELECT value_json FROM entity_attributes
  WHERE scope_kind = 'contact' AND scope_id = ? AND key = 'ultimo_texto'`).get(scopeSetReply)
check('sequência set -> reply grava o valor interpolado', atributoSetReply?.value_json === JSON.stringify('/ping'))
check('resposta seguinte enxerga a variável gravada no mesmo evento', resultSetReply?.commands[0]?.payload?.text === 'Recebi /ping')
check('set não gera comando de saída; só reply aparece', resultSetReply?.commands.length === 1 && resultSetReply.commands[0].commandType === 'whatsapp.reply')

// --- sender em grupo: persiste na pessoa, nunca no identificador do grupo ---
const grupoSender = '120363000000001@g.us'
const pessoaSender = '5511333@s.whatsapp.net'
criarAutomacaoComFluxo({
  id: 'set-sender-grupo',
  scopeId: grupoSender,
  scopeKind: 'group',
  nodes: [
    { id: 'trigger', type: 'trigger.command', config: { command: '/ping', match: 'exact', allowFrom: 'external' } },
    { id: 'set-sender', type: 'action.variable.set', config: { scope: 'sender', key: 'origem', value: '{{sender.id}}' } }
  ],
  edges: [{ from: 'trigger', to: 'set-sender', on: 'matched' }]
})
definirModo('set-sender-grupo', 'live')
const rSetSender = avaliarEvento(db, eventoBase({
  msgId: 'SET2',
  chat: { id: grupoSender, kind: 'group' },
  sender: { id: pessoaSender, authoredBySelf: false }
}))
const resultSetSender = rSetSender.results.find((r) => r.automationId === 'set-sender-grupo')
const atributoPessoa = db.prepare(`SELECT value_json FROM entity_attributes
  WHERE scope_kind = 'contact' AND scope_id = ? AND key = 'origem'`).get(pessoaSender)
const atributoGrupo = db.prepare(`SELECT value_json FROM entity_attributes
  WHERE scope_kind = 'group' AND scope_id = ? AND key = 'origem'`).get(grupoSender)
check('scope sender em grupo grava como contact sob sender.id', atributoPessoa?.value_json === JSON.stringify(pessoaSender))
check('scope sender em grupo não grava sob chat.id', atributoGrupo === undefined)
check('cadeia termina normalmente quando o último nó não tem success', resultSetSender?.status === 'matched_live' && resultSetSender.commands.length === 0)
check('automação composta apenas com set não persiste outbound_commands', db.prepare(`SELECT COUNT(*) AS n FROM outbound_commands
  WHERE run_id IN (SELECT id FROM automation_runs WHERE automation_id = 'set-sender-grupo')`).get().n === 0)

// --- três ações: percorre dois hops success e para no último nó ---
const scopeTresAcoes = '5511222@s.whatsapp.net'
criarAutomacaoComFluxo({
  id: 'tres-acoes',
  scopeId: scopeTresAcoes,
  nodes: [
    { id: 'trigger', type: 'trigger.command', config: { command: '/ping', match: 'exact', allowFrom: 'external' } },
    { id: 'set-um', type: 'action.variable.set', config: { scope: 'chat', key: 'primeiro', value: 'alfa' } },
    { id: 'set-dois', type: 'action.variable.set', config: { scope: 'chat', key: 'segundo', value: '{{var.chat.primeiro}}-beta' } },
    { id: 'reply', type: 'action.whatsapp.reply', config: { text: '{{var.chat.segundo}}' } }
  ],
  edges: [
    { from: 'trigger', to: 'set-um', on: 'matched' },
    { from: 'set-um', to: 'set-dois', on: 'success' },
    { from: 'set-dois', to: 'reply', on: 'success' }
  ]
})
definirModo('tres-acoes', 'live')
const rTresAcoes = avaliarEvento(db, eventoBase({
  msgId: 'SET3', chat: { id: scopeTresAcoes, kind: 'direct' }, sender: { id: scopeTresAcoes, authoredBySelf: false }
}))
const resultTresAcoes = rTresAcoes.results.find((r) => r.automationId === 'tres-acoes')
const segundoValor = db.prepare(`SELECT value_json FROM entity_attributes
  WHERE scope_kind = 'contact' AND scope_id = ? AND key = 'segundo'`).get(scopeTresAcoes)
check('cadeia de três ações executa o segundo set', segundoValor?.value_json === JSON.stringify('alfa-beta'))
check('cadeia de três ações alcança a resposta final', resultTresAcoes?.commands.length === 1 && resultTresAcoes.commands[0].payload.text === 'alfa-beta')
check('último nó sem aresta success encerra a cadeia sem erro', resultTresAcoes?.status === 'matched_live')

// --- idempotência: reenviar o MESMO eventId nunca reavalia nem duplica comando ---
const rRepetido = avaliarEvento(db, eventoBase({ msgId: 'L1' }))
const resultRepetido = rRepetido.results.find((r) => r.automationId === 'ping-live')
check('reenviar o mesmo evento devolve o MESMO comando (não duplica)', resultRepetido?.commands[0]?.id === resultLive.commands[0].id)
const totalComandos = db.prepare(`SELECT COUNT(*) AS n FROM outbound_commands WHERE run_id IN
  (SELECT id FROM automation_runs WHERE event_id = ?)`).get(eventoBase({ msgId: 'L1' }).eventId).n
check('nenhum comando duplicado no banco pro mesmo evento', totalComandos === 1)

// --- escopo: scope.include vazio nunca significa "todos" ---
db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
  .run('ping-sem-escopo', 'live', agora, agora)
const docSemEscopo = {
  schemaVersion: 1, id: 'ping-sem-escopo', revision: 1, name: 'x', enabled: true,
  scope: { include: [], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p-ping' },
  flow: {
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: '/ping', match: 'exact', allowFrom: 'external' } },
      { id: 'reply', type: 'action.whatsapp.reply', config: { text: 'pong' } }
    ],
    edges: [{ from: 'trigger', to: 'reply', on: 'matched' }]
  }
}
const revSemEscopo = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
  .run('ping-sem-escopo', 'active', JSON.stringify(docSemEscopo), agora)
db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(revSemEscopo.lastInsertRowid, 'ping-sem-escopo')
const rSemEscopo = avaliarEvento(db, eventoBase({ msgId: 'NE1' }))
check('scope.include vazio NUNCA casa com nada (falha fechado)', rSemEscopo.results.find((r) => r.automationId === 'ping-sem-escopo')?.status === 'no_match')

// --- fora do escopo declarado ---
criarAutomacaoPing({ id: 'ping-escopo-x', scopeId: '5511888@s.whatsapp.net' })
definirModo('ping-escopo-x', 'live')
const rForaEscopo = avaliarEvento(db, eventoBase({ msgId: 'FE1' }))
check('remetente fora do scope.include não casa', rForaEscopo.results.find((r) => r.automationId === 'ping-escopo-x')?.status === 'no_match')

// --- comando não bate (texto diferente) ---
criarAutomacaoPing({ id: 'ping-cmd' })
definirModo('ping-cmd', 'live')
const rComandoErrado = avaliarEvento(db, eventoBase({ msgId: 'CE1', message: { kind: 'text', text: 'oi tudo bem' } }))
check('texto que não bate com o comando não casa', rComandoErrado.results.find((r) => r.automationId === 'ping-cmd')?.status === 'no_match')

// --- allowFrom: external — mensagem do próprio dono não deve acionar ---
criarAutomacaoPing({ id: 'ping-fromme' })
definirModo('ping-fromme', 'live')
const rFromMe = avaliarEvento(db, eventoBase({ msgId: 'FM1', sender: { id: '5511999@s.whatsapp.net', authoredBySelf: true } }))
check('allowFrom=external ignora mensagem do próprio dono (fromMe)', rFromMe.results.find((r) => r.automationId === 'ping-fromme')?.status === 'no_match')

// --- historyPolicy live_only: mensagem de replay (histórico) não deve acionar ---
criarAutomacaoPing({ id: 'ping-replay' })
definirModo('ping-replay', 'live')
const rReplay = avaliarEvento(db, eventoBase({ msgId: 'RP1', replay: true }))
check('historyPolicy live_only ignora mensagem de replay/histórico', rReplay.results.find((r) => r.automationId === 'ping-replay')?.status === 'no_match')

// --- automação desabilitada não é avaliada (nem aparece no resultado) ---
criarAutomacaoPing({ id: 'ping-desabilitada' })
db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run('ping-desabilitada')
const rDesabilitada = avaliarEvento(db, eventoBase({ msgId: 'DS1' }))
check('automação com enabled=0 nem aparece no resultado', rDesabilitada.results.find((r) => r.automationId === 'ping-desabilitada') === undefined)

// --- registrarResultadoExecucao ---
const idComando = resultLive.commands[0].id
const confirmado = registrarResultadoExecucao(db, idComando, { status: 'sent' })
check('confirmar execução atualiza o status pra "sent"', confirmado.status === 'sent')
let lancouStatusInvalido = false
try { registrarResultadoExecucao(db, idComando, { status: 'chute-invalido' }) } catch { lancouStatusInvalido = true }
check('status inválido em confirmação de execução lança erro', lancouStatusInvalido)
let lancouComandoInexistente = false
try { registrarResultadoExecucao(db, 'nao-existe', { status: 'sent' }) } catch { lancouComandoInexistente = true }
check('confirmar comando inexistente lança erro (404)', lancouComandoInexistente)

db.close()

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO AVALIADOR PASSARAM')
process.exit(falhas ? 1 : 0)
