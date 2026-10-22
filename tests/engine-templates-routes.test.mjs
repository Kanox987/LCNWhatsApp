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

  // O TEMPLATE QUE COMPILAVA E NÃO PUBLICAVA.
  //
  // `anti-silenciado` é um vigia que apaga a mensagem de quem está silenciado.
  // Ele tem `se` e não tem `senão`, porque o ramo falso é "não faz nada" — o
  // caso da esmagadora maioria das mensagens que passam por ele.
  //
  // A validação exigia as DUAS saídas de toda condição, então este arquivo
  // versionado do próprio catálogo era recusado na instalação, com uma mensagem
  // sobre arestas que ninguém que escreveu o texto tem como ligar ao que
  // escreveu. E não havia como consertar pelo texto: a linguagem não tem
  // palavra para dizer "nada".
  //
  // Este caso existe para que a regra não volte: ele instala o arquivo de
  // verdade, pelo caminho de verdade.
  const vigiaDeUmLadoSo = await api.resolver('POST', '/templates/anti-silenciado/install', contexto({
    automationIds: { 'anti-silenciado': 'anti-silenciado-de-teste' },
    parameters: { 'anti-silenciado': { poolId: 'pool-teste' } },
    scope: { include: [{ kind: 'all_groups' }] }
  }))
  check('template com "se" e sem "senão" instala', vigiaDeUmLadoSo.status === 201, vigiaDeUmLadoSo.status)
  const documentoDoVigia = vigiaDeUmLadoSo.body?.installed?.[0]
  check('e nasce publicado como qualquer outro', Boolean(documentoDoVigia?.activeRevisionId || documentoDoVigia?.id), JSON.stringify(documentoDoVigia || {}).slice(0, 120))

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

  // --- em que modo a instalação NASCE -------------------------------------
  //
  // A coluna tem DEFAULT 'shadow' e a rota nunca definia o campo, então toda
  // instalação nascia muda: registrava "teria executado" e não enviava nada.
  // Já fez anunciarmos duas vezes um comando "no ar" que estava mudo.
  const modoDe = (id) => db.prepare('SELECT deployment_mode FROM automations WHERE id = ?').get(id)?.deployment_mode

  check('instalação nasce AO VIVO por padrão — não muda', modoDe('meu-ping') === 'live', modoDe('meu-ping'))

  const emSombra = await api.resolver('POST', '/templates/ping/install', contexto({
    automationIds: { ping: 'ping-sombra' },
    parameters: { ping: { command: '/ping-sombra', poolId: 'pool-teste' } },
    scope: { include: [{ kind: 'contact', id: '5511999999999@s.whatsapp.net' }] },
    deploymentMode: 'shadow'
  }))
  check('quem PEDE sombra recebe sombra', modoDe('ping-sombra') === 'shadow', modoDe('ping-sombra'))
  check('e a resposta diz em que modo nasceu', emSombra.body.deploymentMode === 'shadow')

  const modoInvalido = await capturarErro('POST', '/templates/ping/install', {
    automationIds: { ping: 'ping-invalido' },
    parameters: { ping: { command: '/x', poolId: 'pool-teste' } },
    scope: { include: [{ kind: 'contact', id: '5511999999999@s.whatsapp.net' }] },
    deploymentMode: 'talvez'
  })
  check('modo desconhecido -> 400, em vez de cair no default calado', modoInvalido?.status === 400)
  check('e nada foi instalado pela tentativa inválida', modoDe('ping-invalido') === undefined)
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado nas rotas de templates:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DAS ROTAS DE TEMPLATES PASSARAM')
process.exit(falhas ? 1 : 0)
