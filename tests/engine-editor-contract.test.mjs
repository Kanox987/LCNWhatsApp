// Contrato do editor: metadados do runtime e bloqueio semântico no publish.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { validarAutomacao } from '../src/engine/server/validate.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null, query = '') => ({ body, query: new URLSearchParams(query), req: { headers: {} } })

const meta = await api.resolver('GET', '/meta/automation-editor', contexto(null, 'schemaVersion=1'))
check('meta informa schemaVersion 1', meta.schemaVersion === 1)
check('meta entrega o JSON Schema completo', meta.documentSchema?.definitions?.actionHttp?.properties?.type?.const === 'action.http')
check('meta entrega o schema de action.variable.set', meta.documentSchema?.definitions?.actionVariableSet?.properties?.type?.const === 'action.variable.set')
check('runtime expõe o gatilho por comando e o automático por mensagem', JSON.stringify(meta.runtime.triggers) === JSON.stringify(['trigger.command', 'trigger.message']))
check('runtime expõe as ações executáveis, incluindo mídia, menu e moderação', JSON.stringify(meta.runtime.actions) === JSON.stringify(['action.whatsapp.reply', 'action.variable.set', 'action.variable.increment', 'action.whatsapp.sticker', 'action.whatsapp.recover', 'action.menu.render', 'action.menu.config', 'action.whatsapp.delete', 'action.group.remove', 'action.whatsapp.rich', 'action.whatsapp.sendFile']))
check('runtime expõe a condição de comparação', JSON.stringify(meta.runtime.conditions) === JSON.stringify(['condition.compare']))
check('runtime declara um único gatilho e fluxo com ramificação (não mais linear)', meta.runtime.linearOnly === false && meta.runtime.maxTriggers === 1 && meta.runtime.flowModel === 'exclusive_branching_dag')
check('runtime declara as saídas admitidas por família de nó', JSON.stringify(meta.runtime.edgeOutcomes.condition) === JSON.stringify(['true', 'false']))
check('runtime declara todos os escopos de variável, incluindo os de alvo mencionado', meta.runtime.variableScopes.length === 8 && ['chat', 'sender', 'group', 'group_member', 'target', 'target_group_member', 'category', 'global'].every((e) => meta.runtime.variableScopes.includes(e)))
check('runtime declara apenas o placeholder realmente suportado', JSON.stringify(meta.runtime.supportedPlaceholders) === JSON.stringify(['{{latencyMs}}']))

let erroVersao
try { await api.resolver('GET', '/meta/automation-editor', contexto(null, 'schemaVersion=2')) } catch (erro) { erroVersao = erro }
check('meta rejeita schemaVersion desconhecida', erroVersao?.status === 400)

const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('pool-editor', 'Pool editor', agora, agora)
db.prepare('INSERT INTO connections (id, kind, config_json, secret_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
  .run('api-editor', 'http', '{}', '{}', agora, agora)

const documentoHttp = {
  schemaVersion: 1,
  id: 'http-inerte',
  revision: 1,
  enabled: true,
  name: 'HTTP ainda inerte',
  scope: { include: [{ kind: 'group', id: '123@g.us' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'pool-editor' },
  flow: {
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: '/http', match: 'exact', allowFrom: 'external' } },
      { id: 'request', type: 'action.http', config: { connectionRef: 'api-editor', method: 'GET', path: '/status', timeoutMs: 1000 } }
    ],
    edges: [{ from: 'trigger', to: 'request', on: 'matched' }]
  }
}

check('action.http ainda passa na validação de schema/estrutura', validarAutomacao(db, documentoHttp).length === 0)
await api.resolver('POST', '/automations', contexto(documentoHttp))

let erroPublish
try { await api.resolver('POST', '/automations/http-inerte/publish', contexto(null)) } catch (erro) { erroPublish = erro }
check('publish de action.http é rejeitado com 422', erroPublish?.status === 422)
check('publish explica qual nó não é executável', erroPublish?.message === 'Nó "action.http" ainda não é executável pelo motor.')
check('publish informa o caminho do nó incompatível', erroPublish?.detalhes?.[0]?.path === '/flow/nodes/1/type')

const estadoAposFalha = db.prepare('SELECT enabled, active_revision_id FROM automations WHERE id = ?').get('http-inerte')
check('falha semântica não publica nem habilita a automação', estadoAposFalha.enabled === 0 && estadoAposFalha.active_revision_id === null)

const documentoVariableSet = {
  ...documentoHttp,
  id: 'variable-set-executavel',
  name: 'Definir variável',
  flow: {
    nodes: [
      { id: 'trigger', type: 'trigger.command', config: { command: '/set', match: 'exact', allowFrom: 'external' } },
      { id: 'set', type: 'action.variable.set', config: { scope: 'chat', key: 'teste', value: '{{message.text}}' } }
    ],
    edges: [{ from: 'trigger', to: 'set', on: 'matched' }]
  }
}
await api.resolver('POST', '/automations', contexto(documentoVariableSet))
const variableSetPublicada = await api.resolver('POST', '/automations/variable-set-executavel/publish', contexto(null))
check('publish aceita action.variable.set como executável', variableSetPublicada.activeRevisionId !== null)
check('publish habilita automação com action.variable.set', variableSetPublicada.enabled === true)

db.close()

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO CONTRATO DO EDITOR PASSARAM')
process.exit(falhas ? 1 : 0)
