// Estado editável do painel: pausa sem unpublish e concorrência por If-Match.
import http from 'http'
import { EventEmitter } from 'events'
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { criarClienteEngine } from '../src/engine/client.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const resolver = (method, pathname, body = null, headers = {}) => {
  return api.resolver(method, pathname, { body, query: new URLSearchParams(), req: { headers } })
}

function documento (id, { enabled = true, name = 'Ping' } = {}) {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    enabled,
    name,
    scope: { include: [{ kind: 'contact', id: '5511999@s.whatsapp.net' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'pool-editor' },
    flow: {
      nodes: [
        { id: 'trigger', type: 'trigger.command', config: { command: '/ping', match: 'exact', allowFrom: 'external' } },
        { id: 'reply', type: 'action.whatsapp.reply', config: { text: 'pong' } }
      ],
      edges: [{ from: 'trigger', to: 'reply', on: 'matched' }]
    }
  }
}

try {
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('pool-editor', 'Pool editor', agora, agora)

  const meta = await resolver('GET', '/meta/automation-editor')
  check('rota obtém o contrato do editor sem query explícita', meta.schemaVersion === 1 && meta.runtime.actions[0] === 'action.whatsapp.reply')

  await resolver('POST', '/automations', documento('nunca-publicada'))
  let erroSemPublicacao
  try { await resolver('PUT', '/automations/nunca-publicada/enabled', { enabled: true }) } catch (erro) { erroSemPublicacao = erro }
  check('habilitar sem revisão publicada retorna 409', erroSemPublicacao?.status === 409)
  check('conflito ao habilitar explica a ausência de revisão publicada', erroSemPublicacao?.message.includes('Não há revisão publicada'))

  await resolver('POST', '/automations', documento('pausavel'))
  const publicada = await resolver('POST', '/automations/pausavel/publish')
  const revisaoAtiva = publicada.activeRevisionId
  const pausada = await resolver('PUT', '/automations/pausavel/enabled', { enabled: false })
  check('desabilitar preserva active_revision_id', pausada.enabled === false && pausada.activeRevisionId === revisaoAtiva)
  const retomada = await resolver('PUT', '/automations/pausavel/enabled', { enabled: true })
  check('habilitar preserva active_revision_id', retomada.enabled === true && retomada.activeRevisionId === revisaoAtiva)

  const criada = await resolver('POST', '/automations', documento('duas-abas', { name: 'Original' }))
  const etagOriginal = criada.body.draft.etag
  check('GET/criação expõe ETag SHA-1 do draft', typeof etagOriginal === 'string' && /^[a-f0-9]{40}$/.test(etagOriginal))

  const documentoA = documento('duas-abas', { name: 'Salvo pela aba A' })
  const salvoA = await resolver('PUT', '/automations/duas-abas/draft', documentoA, { 'if-match': etagOriginal })
  check('aba A salva usando o ETag atual', salvoA.document.name === 'Salvo pela aba A' && salvoA.etag !== etagOriginal)

  const documentoB = documento('duas-abas', { name: 'Sobrescrito pela aba B' })
  let erroAbaB
  try { await resolver('PUT', '/automations/duas-abas/draft', documentoB, { 'if-match': etagOriginal }) } catch (erro) { erroAbaB = erro }
  check('aba B com ETag desatualizado recebe 409', erroAbaB?.status === 409)
  check('conflito de ETag traz mensagem clara', erroAbaB?.message.includes('alterado por outra edição'))

  const estadoFinal = await resolver('GET', '/automations/duas-abas')
  check('conflito não sobrescreve o conteúdo da aba A', estadoFinal.draft.document.name === 'Salvo pela aba A')
  check('conflito preserva o ETag produzido pela aba A', estadoFinal.draft.etag === salvoA.etag)

  // O ambiente de teste pode bloquear listen() local. Simulamos apenas a
  // borda HTTP aqui para provar o contrato dos métodos do cliente.
  const requisicoes = []
  const requestOriginal = http.request
  http.request = (options, callback) => {
    const req = new EventEmitter()
    req.end = (conteudo) => {
      requisicoes.push({ options, conteudo: conteudo?.toString('utf8') })
      const res = new EventEmitter()
      res.statusCode = 200
      callback(res)
      queueMicrotask(() => {
        res.emit('data', Buffer.from('{}'))
        res.emit('end')
      })
    }
    return req
  }
  try {
    const cliente = criarClienteEngine({ socketPath: '/tmp/nao-utilizado.sock' })
    await cliente.automacoes.obterMeta()
    await cliente.automacoes.salvarRascunho('duas abas', documentoA, etagOriginal)
    await cliente.automacoes.definirHabilitada('duas abas', false)
  } finally {
    http.request = requestOriginal
  }

  check('cliente obterMeta usa a rota versionada do contrato', requisicoes[0]?.options?.path === '/meta/automation-editor?schemaVersion=1')
  check('cliente salvarRascunho envia expectedEtag em If-Match', requisicoes[1]?.options?.headers?.['if-match'] === etagOriginal)
  check('cliente definirHabilitada envia booleano no corpo correto', requisicoes[2]?.options?.path === '/automations/duas%20abas/enabled' && JSON.parse(requisicoes[2]?.conteudo).enabled === false)
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado no teste de estado do editor:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ESTADO DO EDITOR PASSARAM')
process.exit(falhas ? 1 : 0)
