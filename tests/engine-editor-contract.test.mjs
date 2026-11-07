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
check('runtime expõe o gatilho por comando, o automático por mensagem, o porteiro de grupo e o agendado', JSON.stringify(meta.runtime.triggers) === JSON.stringify(['trigger.command', 'trigger.message', 'trigger.group', 'trigger.schedule']))
check('runtime expõe as ações executáveis, incluindo cálculo, mídia, menu e moderação', JSON.stringify(meta.runtime.actions) === JSON.stringify(['action.whatsapp.reply', 'action.variable.set', 'action.variable.increment', 'action.list.add', 'action.list.remove', 'action.list.show', 'action.variable.calculate', 'action.variable.rank', 'action.variable.random', 'action.whatsapp.recover', 'action.menu.render', 'action.menu.config', 'action.whatsapp.delete', 'action.whatsapp.react', 'action.whatsapp.pin', 'action.whatsapp.poll', 'action.whatsapp.pollResults', 'action.whatsapp.profilePicture', 'action.group.remove', 'action.group.promote', 'action.group.demote', 'action.group.add', 'action.group.setSubject', 'action.group.setDescription', 'action.group.setAnnounce', 'action.group.inviteCode', 'action.group.members', 'action.whatsapp.rich', 'action.whatsapp.sendFile', 'action.media.download', 'action.connection.call', 'action.acervo.save', 'action.acervo.delete', 'action.acervo.createText', 'action.acervo.rewrite', 'action.acervo.edit', 'action.acervo.read', 'action.whatsapp.metadata', 'action.whatsapp.webview', 'action.whatsapp.buttons', 'action.whatsapp.carousel', 'action.whatsapp.stickerPack']))
check('runtime expõe a condição de comparação', JSON.stringify(meta.runtime.conditions) === JSON.stringify(['condition.compare']))
check('runtime declara um único gatilho e fluxo com ramificação (não mais linear)', meta.runtime.linearOnly === false && meta.runtime.maxTriggers === 1 && meta.runtime.flowModel === 'exclusive_branching_dag')
check('runtime declara as saídas admitidas por família de nó', JSON.stringify(meta.runtime.edgeOutcomes.condition) === JSON.stringify(['true', 'false']))
check('runtime declara todos os escopos de variável, incluindo os de alvo mencionado', meta.runtime.variableScopes.length === 9 && ['chat', 'sender', 'group', 'group_member', 'target', 'target_group_member', 'category', 'global', 'local'].every((e) => meta.runtime.variableScopes.includes(e)))
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

// NÚMERO COM ESPAÇO, medido na produção em 26/10 e quebrado.
// "/adiciona +62 897-7791-132" era partido por espaço: "+62" caía no filtro de
// tamanho e "897-7791-132" virava um número ERRADO — o WhatsApp recusou com
// 404 e estava certo. Gente escreve telefone com espaço, parêntese e traço;
// quem quer vários usa vírgula.
{
  const alvosDe = (texto) => texto.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)
    .map((parte) => /@(s\.whatsapp\.net|lid)$/.test(parte) ? parte : parte.replace(/\D/g, ''))
    .filter((d) => d.includes('@') || d.length >= 8)
  check('número com espaço e traço vira UM número, com o prefixo inteiro',
    alvosDe('+62 897-7791-132').join() === '628977791132', alvosDe('+62 897-7791-132').join())
  check('formato brasileiro com parêntese também', alvosDe('+55 (22) 98119-7896').join() === '5522981197896')
  check('vírgula continua separando vários', alvosDe('628977791132, 5522981197896').length === 2)
}


console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO CONTRATO DO EDITOR PASSARAM')
process.exit(falhas ? 1 : 0)
