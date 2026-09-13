import fs from 'fs'
import path from 'path'
import Ajv from 'ajv'
import { fileURLToPath } from 'url'

const arquivoSchema = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema', 'automation.v1.schema.json')
const schema = JSON.parse(fs.readFileSync(arquivoSchema, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const validarSchema = ajv.compile(schema)

function caminhoAjv (erro) {
  if (erro.keyword === 'required') return `${erro.instancePath}/${erro.params.missingProperty}` || '/'
  if (erro.keyword === 'additionalProperties') return `${erro.instancePath}/${erro.params.additionalProperty}` || '/'
  return erro.instancePath || '/'
}

function temCiclo (ids, edges) {
  const adjacencias = new Map([...ids].map((id) => [id, []]))
  for (const edge of edges) {
    if (ids.has(edge?.from) && ids.has(edge?.to)) adjacencias.get(edge.from).push(edge.to)
  }

  const visitando = new Set()
  const visitados = new Set()
  const visitar = (id) => {
    if (visitando.has(id)) return true
    if (visitados.has(id)) return false
    visitando.add(id)
    for (const destino of adjacencias.get(id) || []) {
      if (visitar(destino)) return true
    }
    visitando.delete(id)
    visitados.add(id)
    return false
  }
  return [...ids].some(visitar)
}

export function validarAutomacao (db, documento) {
  const erros = []
  if (!validarSchema(documento)) {
    for (const erro of validarSchema.errors || []) {
      erros.push({ path: caminhoAjv(erro), message: erro.message || 'valor inválido' })
    }
  }

  const nodes = Array.isArray(documento?.flow?.nodes) ? documento.flow.nodes : []
  const edges = Array.isArray(documento?.flow?.edges) ? documento.flow.edges : []
  const ids = new Set()
  nodes.forEach((node, indice) => {
    if (typeof node?.id !== 'string' || !node.id) return
    if (ids.has(node.id)) erros.push({ path: `/flow/nodes/${indice}/id`, message: `id de nó duplicado: ${node.id}` })
    ids.add(node.id)
  })

  edges.forEach((edge, indice) => {
    if (typeof edge?.from === 'string' && !ids.has(edge.from)) {
      erros.push({ path: `/flow/edges/${indice}/from`, message: `nó inexistente: ${edge.from}` })
    }
    if (typeof edge?.to === 'string' && !ids.has(edge.to)) {
      erros.push({ path: `/flow/edges/${indice}/to`, message: `nó inexistente: ${edge.to}` })
    }
  })

  const saidasPorEvento = new Set()
  edges.forEach((edge, indice) => {
    if (typeof edge?.from !== 'string' || typeof edge?.on !== 'string') return
    const chave = JSON.stringify([edge.from, edge.on])
    if (saidasPorEvento.has(chave)) {
      erros.push({
        path: `/flow/edges/${indice}/on`,
        message: `o nó ${edge.from} não pode ter mais de uma aresta de saída com on '${edge.on}'`
      })
    } else {
      saidasPorEvento.add(chave)
    }
  })

  if (temCiclo(ids, edges)) erros.push({ path: '/flow/edges', message: 'o fluxo não pode conter ciclo' })

  // maxTriggers:1 era anunciado em runtimeCapabilities mas nunca imposto aqui,
  // e o avaliador usa .find() — com dois gatilhos, o segundo era ignorado em
  // silêncio e a automação parecia publicada e correta.
  const gatilhos = nodes.filter((node) => typeof node?.type === 'string' && node.type.startsWith('trigger.'))
  if (!gatilhos.length) {
    erros.push({ path: '/flow/nodes', message: 'o fluxo precisa de exatamente um gatilho' })
  } else if (gatilhos.length > 1) {
    erros.push({ path: '/flow/nodes', message: `o fluxo só aceita um gatilho, mas tem ${gatilhos.length}` })
  }

  // Cada tipo de nó só pode sair pelas arestas que ele de fato produz. Sem
  // isso dá pra publicar uma condição ligada por 'success' (que nunca
  // dispara) ou uma ação ligada por 'true' — fluxo que morre calado.
  const tipoPorId = new Map(nodes.filter((n) => typeof n?.id === 'string').map((n) => [n.id, n.type]))
  const SAIDAS_ADMITIDAS = {
    trigger: new Set(['matched']),
    condition: new Set(['true', 'false']),
    action: new Set(['success'])
  }
  edges.forEach((edge, indice) => {
    const tipo = tipoPorId.get(edge?.from)
    if (typeof tipo !== 'string') return
    const familia = tipo.split('.')[0]
    const admitidas = SAIDAS_ADMITIDAS[familia]
    if (admitidas && typeof edge?.on === 'string' && !admitidas.has(edge.on)) {
      erros.push({
        path: `/flow/edges/${indice}/on`,
        message: `${tipo} não produz a saída '${edge.on}' (aceita: ${[...admitidas].join(', ')})`
      })
    }
  })

  // Uma condição sem os dois caminhos é meia decisão: o lado faltante encerra
  // o fluxo em silêncio, que é exatamente o que a ramificação veio evitar.
  nodes.forEach((node, indice) => {
    if (node?.type !== 'condition.compare') return
    for (const lado of ['true', 'false']) {
      const temSaida = edges.some((e) => e.from === node.id && e.on === lado)
      if (!temSaida) {
        erros.push({ path: `/flow/nodes/${indice}`, message: `a condição ${node.id} precisa de uma saída '${lado}'` })
      }
    }
  })

  const connectionExiste = db.prepare('SELECT 1 FROM connections WHERE id = ?')
  nodes.forEach((node, indice) => {
    const ref = node?.type === 'action.http' ? node.config?.connectionRef : null
    if (typeof ref === 'string' && ref && !connectionExiste.get(ref)) {
      erros.push({ path: `/flow/nodes/${indice}/config/connectionRef`, message: `conexão inexistente: ${ref}` })
    }
  })

  const poolId = documento?.responder?.poolId
  if (typeof poolId === 'string' && poolId) {
    const poolExiste = db.prepare('SELECT 1 FROM pools WHERE id = ?').get(poolId)
    if (!poolExiste) erros.push({ path: '/responder/poolId', message: `pool inexistente: ${poolId}` })
  }

  return erros
}

export const validarDocumentoAutomacao = validarAutomacao
