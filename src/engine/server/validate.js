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

  if (temCiclo(ids, edges)) erros.push({ path: '/flow/edges', message: 'o fluxo não pode conter ciclo' })

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
