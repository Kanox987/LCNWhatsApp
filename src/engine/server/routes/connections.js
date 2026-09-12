import { ErroHttp, resposta } from '../transport.js'

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

function expor (row) {
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind,
    config: jsonOuNull(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function exigirTexto (body, campo) {
  const valor = body?.[campo]
  if (typeof valor !== 'string' || !valor.trim()) throw new ErroHttp(400, `Campo obrigatório: ${campo}.`)
  return valor.trim()
}

export function registrarRotasConnections (roteador, db) {
  const obter = db.prepare('SELECT * FROM connections WHERE id = ?')
  roteador.get('/connections', () => db.prepare('SELECT * FROM connections ORDER BY id').all().map(expor))
  roteador.post('/connections', ({ body }) => {
    const id = exigirTexto(body, 'id')
    const kind = exigirTexto(body, 'kind')
    const agora = new Date().toISOString()
    try {
      db.prepare(`INSERT INTO connections (id, kind, config_json, secret_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, kind, JSON.stringify(body.config ?? null), JSON.stringify(body.secret ?? null), agora, agora)
    } catch (erro) {
      if (erro.code?.startsWith('SQLITE_CONSTRAINT')) throw new ErroHttp(409, `Conexão já cadastrada: ${id}.`)
      throw erro
    }
    return resposta(201, expor(obter.get(id)))
  })
  roteador.get('/connections/:id', ({ params }) => {
    const row = obter.get(params.id)
    if (!row) throw new ErroHttp(404, `Conexão não encontrada: ${params.id}.`)
    return expor(row)
  })
  roteador.put('/connections/:id', ({ params, body }) => {
    const row = obter.get(params.id)
    if (!row) throw new ErroHttp(404, `Conexão não encontrada: ${params.id}.`)
    const kind = body?.kind ?? row.kind
    if (typeof kind !== 'string' || !kind.trim()) throw new ErroHttp(400, 'Campo inválido: kind.')
    const configJson = Object.hasOwn(body || {}, 'config') ? JSON.stringify(body.config) : row.config_json
    const secretJson = Object.hasOwn(body || {}, 'secret') ? JSON.stringify(body.secret) : row.secret_json
    db.prepare('UPDATE connections SET kind = ?, config_json = ?, secret_json = ?, updated_at = ? WHERE id = ?')
      .run(kind.trim(), configJson, secretJson, new Date().toISOString(), params.id)
    return expor(obter.get(params.id))
  })
  roteador.delete('/connections/:id', ({ params }) => {
    const resultado = db.prepare('DELETE FROM connections WHERE id = ?').run(params.id)
    if (!resultado.changes) throw new ErroHttp(404, `Conexão não encontrada: ${params.id}.`)
    return { removed: true, id: params.id }
  })
}
