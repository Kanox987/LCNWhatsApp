import { ErroHttp, resposta } from '../transport.js'

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

function expor (row) {
  if (!row) return null
  return {
    id: row.id,
    provider: row.provider,
    accountId: row.account_id,
    label: row.label,
    capabilities: jsonOuNull(row.capabilities_json),
    registeredAt: row.registered_at,
    updatedAt: row.updated_at
  }
}

function exigirTexto (body, campo) {
  const valor = body?.[campo]
  if (typeof valor !== 'string' || !valor.trim()) throw new ErroHttp(400, `Campo obrigatório: ${campo}.`)
  return valor.trim()
}

export function registrarRotasInstances (roteador, db) {
  const obter = db.prepare('SELECT * FROM instances WHERE id = ?')
  const inserir = db.prepare(`INSERT INTO instances
    (id, provider, account_id, label, capabilities_json, registered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const atualizar = db.prepare(`UPDATE instances SET
    provider = ?, account_id = ?, label = ?, capabilities_json = ?, updated_at = ? WHERE id = ?`)

  roteador.get('/instances', () => db.prepare('SELECT * FROM instances ORDER BY id').all().map(expor))
  roteador.post('/instances', ({ body }) => {
    const id = exigirTexto(body, 'id')
    const provider = exigirTexto(body, 'provider')
    const accountId = exigirTexto(body, 'accountId')
    const label = exigirTexto(body, 'label')
    const agora = new Date().toISOString()
    try {
      inserir.run(id, provider, accountId, label, JSON.stringify(body.capabilities ?? null), agora, agora)
    } catch (erro) {
      if (erro.code?.startsWith('SQLITE_CONSTRAINT')) throw new ErroHttp(409, `Instância ou accountId já cadastrado: ${id}.`)
      throw erro
    }
    return resposta(201, expor(obter.get(id)))
  })
  roteador.get('/instances/:id', ({ params }) => {
    const row = obter.get(params.id)
    if (!row) throw new ErroHttp(404, `Instância não encontrada: ${params.id}.`)
    return expor(row)
  })
  roteador.put('/instances/:id', ({ params, body }) => {
    const atual = obter.get(params.id)
    if (!atual) throw new ErroHttp(404, `Instância não encontrada: ${params.id}.`)
    const provider = body?.provider ?? atual.provider
    const accountId = body?.accountId ?? atual.account_id
    const label = body?.label ?? atual.label
    for (const [campo, valor] of Object.entries({ provider, accountId, label })) {
      if (typeof valor !== 'string' || !valor.trim()) throw new ErroHttp(400, `Campo inválido: ${campo}.`)
    }
    const capabilities = Object.hasOwn(body || {}, 'capabilities')
      ? JSON.stringify(body.capabilities)
      : atual.capabilities_json
    try {
      atualizar.run(provider.trim(), accountId.trim(), label.trim(), capabilities, new Date().toISOString(), params.id)
    } catch (erro) {
      if (erro.code?.startsWith('SQLITE_CONSTRAINT')) throw new ErroHttp(409, `accountId já cadastrado: ${accountId}.`)
      throw erro
    }
    return expor(obter.get(params.id))
  })
  roteador.delete('/instances/:id', ({ params }) => {
    const resultado = db.prepare('DELETE FROM instances WHERE id = ?').run(params.id)
    if (!resultado.changes) throw new ErroHttp(404, `Instância não encontrada: ${params.id}.`)
    return { removed: true, id: params.id }
  })
}
