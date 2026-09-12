import { ErroHttp, resposta } from '../transport.js'

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

function exigirTexto (body, campo) {
  const valor = body?.[campo]
  if (typeof valor !== 'string' || !valor.trim()) throw new ErroHttp(400, `Campo obrigatório: ${campo}.`)
  return valor.trim()
}

export function registrarRotasPools (roteador, db) {
  const obterRow = db.prepare('SELECT * FROM pools WHERE id = ?')
  const listarMembros = db.prepare('SELECT * FROM pool_members WHERE pool_id = ? ORDER BY instance_id')
  const expor = (row) => row && ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members: listarMembros.all(row.id).map((m) => ({
      instanceId: m.instance_id,
      weight: m.weight,
      enabled: m.enabled === 1,
      overrides: jsonOuNull(m.overrides_json)
    }))
  })

  roteador.get('/pools', () => db.prepare('SELECT * FROM pools ORDER BY id').all().map(expor))
  roteador.post('/pools', ({ body }) => {
    const id = exigirTexto(body, 'id')
    const label = exigirTexto(body, 'label')
    const agora = new Date().toISOString()
    try {
      db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, label, agora, agora)
    } catch (erro) {
      if (erro.code?.startsWith('SQLITE_CONSTRAINT')) throw new ErroHttp(409, `Pool já cadastrado: ${id}.`)
      throw erro
    }
    return resposta(201, expor(obterRow.get(id)))
  })
  roteador.get('/pools/:id', ({ params }) => {
    const row = obterRow.get(params.id)
    if (!row) throw new ErroHttp(404, `Pool não encontrado: ${params.id}.`)
    return expor(row)
  })
  roteador.put('/pools/:id', ({ params, body }) => {
    const row = obterRow.get(params.id)
    if (!row) throw new ErroHttp(404, `Pool não encontrado: ${params.id}.`)
    const label = body?.label ?? row.label
    if (typeof label !== 'string' || !label.trim()) throw new ErroHttp(400, 'Campo inválido: label.')
    db.prepare('UPDATE pools SET label = ?, updated_at = ? WHERE id = ?').run(label.trim(), new Date().toISOString(), params.id)
    return expor(obterRow.get(params.id))
  })
  roteador.delete('/pools/:id', ({ params }) => {
    const resultado = db.prepare('DELETE FROM pools WHERE id = ?').run(params.id)
    if (!resultado.changes) throw new ErroHttp(404, `Pool não encontrado: ${params.id}.`)
    return { removed: true, id: params.id }
  })
  roteador.put('/pools/:id/members/:instanceId', ({ params, body }) => {
    if (!obterRow.get(params.id)) throw new ErroHttp(404, `Pool não encontrado: ${params.id}.`)
    if (!db.prepare('SELECT 1 FROM instances WHERE id = ?').get(params.instanceId)) {
      throw new ErroHttp(404, `Instância não encontrada: ${params.instanceId}.`)
    }
    const weight = body?.weight ?? 1
    if (!Number.isFinite(weight) || weight <= 0) throw new ErroHttp(400, 'weight deve ser um número maior que zero.')
    const enabled = body?.enabled === undefined ? true : body.enabled
    if (typeof enabled !== 'boolean') throw new ErroHttp(400, 'enabled deve ser booleano.')
    db.prepare(`INSERT INTO pool_members (pool_id, instance_id, weight, enabled, overrides_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pool_id, instance_id) DO UPDATE SET
        weight = excluded.weight, enabled = excluded.enabled, overrides_json = excluded.overrides_json`)
      .run(params.id, params.instanceId, weight, enabled ? 1 : 0, JSON.stringify(body?.overrides ?? null))
    db.prepare('UPDATE pools SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), params.id)
    return expor(obterRow.get(params.id))
  })
  roteador.delete('/pools/:id/members/:instanceId', ({ params }) => {
    const resultado = db.prepare('DELETE FROM pool_members WHERE pool_id = ? AND instance_id = ?').run(params.id, params.instanceId)
    if (!resultado.changes) throw new ErroHttp(404, 'Membro do pool não encontrado.')
    db.prepare('UPDATE pools SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), params.id)
    return { removed: true, poolId: params.id, instanceId: params.instanceId }
  })
}
