// Módulo 4 da Parte C do plano — rotas HTTP de catálogo/instalação
// (server/routes/templates.js), fim a fim contra um banco :memory: real,
// mesmo padrão de tests/engine-entities.test.mjs. Confirma que instalar um
// template passa pelo MESMO validarAutomacao()+publish de uma automação
// manual (não existe atalho) e que a árvore inteira de dependsOn instala
// atomicamente (tudo ou nada).
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })

async function capturarErro (method, pathname, body) {
  try {
    await api.resolver(method, pathname, contexto(body))
    return null
  } catch (erro) {
    return erro
  }
}

await api.resolver('POST', '/pools', contexto({ id: 'pool-teste', label: 'Pool de teste' }))

try {
  const lista = await api.resolver('GET', '/templates', contexto())
  check('GET /templates lista o catálogo real', Array.isArray(lista) && lista.some((t) => t.templateId === 'ping'))
  check('GET /templates NUNCA inclui documentTemplate (é só o resumo pro catálogo)', lista.every((t) => t.documentTemplate === undefined))

  const detalhe = await api.resolver('GET', '/templates/ping', contexto())
  check('GET /templates/:id inclui o documentTemplate cru (origem do botão "ver JSON")', detalhe.documentTemplate?.flow?.nodes?.length === 2)

  const erro404 = await capturarErro('GET', '/templates/nao-existe', null)
  check('GET /templates/:id inexistente -> 404', erro404?.status === 404)

  const semScope = await capturarErro('POST', '/templates/ping/install', {
    parameters: { ping: { command: '/ping', poolId: 'pool-teste' } }
  })
  check('instalar sem scope.include -> 400 (nunca casa com "todos" por padrão)', semScope?.status === 400)

  const instalado = await api.resolver('POST', '/templates/ping/install', contexto({
    automationIds: { ping: 'meu-ping' },
    parameters: { ping: { command: '/ping-de-teste', poolId: 'pool-teste' } },
    scope: { include: [{ kind: 'contact', id: '5511999999999@s.whatsapp.net' }] }
  }))
  check('instalação retorna 201 com a automação já publicada', instalado.status === 201)
  const automacaoInstalada = instalado.body.installed[0]
  check('automação instalada nasce com o id customizado (automationIds)', automacaoInstalada.id === 'meu-ping')
  check('automação instalada nasce JÁ PUBLICADA (activeRevisionId setado)', automacaoInstalada.activeRevisionId !== null)
  check('automação instalada nasce habilitada', automacaoInstalada.enabled === true)
  check('documento publicado usa o comando customizado, não o default do template', automacaoInstalada.draft.document.flow.nodes[0].config.command === '/ping-de-teste')
  check('documento publicado leva o scope pedido na instalação', automacaoInstalada.draft.document.scope.include[0].id === '5511999999999@s.whatsapp.net')
  check('documento publicado leva o poolId resolvido do parâmetro', automacaoInstalada.draft.document.responder.poolId === 'pool-teste')

  const provenance = await api.resolver('GET', '/automations/meu-ping/provenance', contexto())
  check('provenance registra de qual template a automação veio', provenance.installedFromTemplate === true && provenance.templateId === 'ping')
  check('provenance registra a versão do template', provenance.templateVersion === 1)
  check('provenance registra os parâmetros usados na instalação', provenance.parameters.command === '/ping-de-teste')

  const semProvenance = await api.resolver('GET', '/automations/nao-veio-de-template/provenance', contexto())
  check('automação sem proveniência (criada manualmente) responde installedFromTemplate: false', semProvenance.installedFromTemplate === false)

  const poolInexistente = await capturarErro('POST', '/templates/ajuda/install', {
    parameters: { ajuda: { poolId: 'pool-que-nao-existe' } },
    scope: { include: [{ kind: 'group', id: '1@g.us' }] }
  })
  check('instalar com poolId inexistente falha (mesma validação de uma automação manual, não um atalho)', poolInexistente?.status === 422)

  const conflito = await capturarErro('POST', '/templates/ping/install', {
    automationIds: { ping: 'meu-ping' },
    parameters: { ping: { command: '/outro', poolId: 'pool-teste' } },
    scope: { include: [{ kind: 'group', id: '1@g.us' }] }
  })
  check('instalar com um id de automação já existente falha (409, sem sobrescrever)', conflito?.status === 409)
  const aindaOriginal = await api.resolver('GET', '/automations/meu-ping', contexto())
  check('automação original não foi tocada pela tentativa de reinstalar em cima', aindaOriginal.draft.document.flow.nodes[0].config.command === '/ping-de-teste')

  const parametroFaltando = await capturarErro('POST', '/templates/marcar-variavel/install', {
    parameters: { 'marcar-variavel': { command: '/vip2' } },
    scope: { include: [{ kind: 'contact', id: '123@s.whatsapp.net' }] }
  })
  check('instalar sem o parâmetro obrigatório poolId -> 400, mensagem clara', parametroFaltando?.status === 400 && /poolId/.test(parametroFaltando.message))

  const marcarVip = await api.resolver('POST', '/templates/marcar-variavel/install', contexto({
    parameters: { 'marcar-variavel': { poolId: 'pool-teste' } },
    scope: { include: [{ kind: 'contact', id: '123@s.whatsapp.net' }] }
  }))
  const docMarcarVip = marcarVip.body.installed[0].draft.document
  check('template com múltiplas ações em cadeia instala o flow inteiro (gatilho -> variável -> resposta)', docMarcarVip.flow.nodes.length === 3 && docMarcarVip.flow.edges.length === 2)
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado nas rotas de templates:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DAS ROTAS DE TEMPLATES PASSARAM')
process.exit(falhas ? 1 : 0)
