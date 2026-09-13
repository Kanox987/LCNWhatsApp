import { ErroHttp } from '../transport.js'
import { ID_GLOBAL, separarIdMembro } from '../attributeScopes.js'

// Os cinco escopos que a tabela aceita desde a migração 008. Antes daqui só
// 'contact' e 'group' passavam, então contador de membro, de categoria e do
// sistema existiam no motor mas eram invisíveis e ineditáveis pelo painel.
const KINDS_SUPORTADOS = new Set(['contact', 'group', 'group_member', 'category', 'global'])

function validarKind (kind) {
  if (!KINDS_SUPORTADOS.has(kind)) {
    throw new ErroHttp(400, `kind inválido: ${kind}. Use um destes: ${[...KINDS_SUPORTADOS].join(', ')}.`)
  }
  return kind
}

// 'global' tem um id só, reservado — aceitar qualquer id ali criaria vários
// "sistemas" paralelos que nenhuma automação alcançaria.
function normalizarId (kind, id) {
  if (kind === 'global') return ID_GLOBAL
  if (typeof id !== 'string' || !id.trim()) throw new ErroHttp(400, 'Informe o id do contato, grupo ou categoria.')
  if (kind === 'group_member' && !separarIdMembro(id)) {
    throw new ErroHttp(400, 'Para membro de grupo, o id é "<grupo>|<pessoa>".')
  }
  return id
}

function serializarValor (body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'value')) {
    throw new ErroHttp(400, 'Campo obrigatório: value.')
  }
  try {
    const valueJson = JSON.stringify(body.value)
    if (valueJson === undefined) throw new Error('não serializável')
    return valueJson
  } catch {
    throw new ErroHttp(400, 'value deve ser um valor JSON serializável.')
  }
}

function exporAtributo (row) {
  return { key: row.key, value: JSON.parse(row.value_json) }
}

export function registrarRotasEntities (roteador, db) {
  const listar = db.prepare(`SELECT key, value_json FROM entity_attributes
    WHERE scope_kind = ? AND scope_id = ? ORDER BY key`)
  const obter = db.prepare(`SELECT key, value_json FROM entity_attributes
    WHERE scope_kind = ? AND scope_id = ? AND key = ?`)

  const definir = db.transaction((kind, id, key, body) => {
    const valueJson = serializarValor(body)
    db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at`)
      .run(kind, id, key, valueJson, new Date().toISOString())
    return exporAtributo(obter.get(kind, id, key))
  })

  const remover = db.transaction((kind, id, key) => {
    const resultado = db.prepare(`DELETE FROM entity_attributes
      WHERE scope_kind = ? AND scope_id = ? AND key = ?`).run(kind, id, key)
    if (!resultado.changes) throw new ErroHttp(404, `Atributo não encontrado: ${key}.`)
    return { removed: true, key }
  })

  roteador.get('/entities/:kind/:id/attributes', ({ params }) => {
    const kind = validarKind(params.kind)
    return listar.all(kind, normalizarId(kind, params.id)).map(exporAtributo)
  })

  roteador.put('/entities/:kind/:id/attributes/:key', ({ params, body }) => {
    const kind = validarKind(params.kind)
    return definir(kind, normalizarId(kind, params.id), params.key, body)
  })

  roteador.delete('/entities/:kind/:id/attributes/:key', ({ params }) => {
    const kind = validarKind(params.kind)
    return remover(kind, normalizarId(kind, params.id), params.key)
  })
}
