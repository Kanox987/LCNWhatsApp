import { ErroHttp, resposta } from '../transport.js'
import { validarAutomacao } from '../validate.js'

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

function exporRevision (row) {
  if (!row) return null
  return {
    id: row.id,
    automationId: row.automation_id,
    revision: row.revision,
    status: row.status,
    document: jsonOuNull(row.doc_json),
    validationErrors: jsonOuNull(row.validation_errors_json),
    createdAt: row.created_at
  }
}

function extrairDocumento (body) {
  const documento = body?.document ?? body
  if (!documento || typeof documento !== 'object' || Array.isArray(documento)) {
    throw new ErroHttp(400, 'Informe um documento de automação JSON.')
  }
  return structuredClone(documento)
}

function normalizarDocumento (documento, id, revision) {
  if (documento.id !== undefined && documento.id !== id) {
    throw new ErroHttp(400, `O id do documento deve ser ${id}.`)
  }
  if (documento.schemaVersion !== 1) throw new ErroHttp(400, 'Somente schemaVersion 1 é aceito nesta etapa.')
  documento.id = id
  documento.revision = revision
  return documento
}

function salvarScopes (db, revisionId, documento) {
  db.prepare('DELETE FROM automation_scopes WHERE automation_revision_id = ?').run(revisionId)
  const inserir = db.prepare(`INSERT INTO automation_scopes
    (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)`)
  for (const direction of ['include', 'exclude']) {
    const refs = Array.isArray(documento?.scope?.[direction]) ? documento.scope[direction] : []
    for (const ref of refs) {
      if (typeof ref?.kind === 'string' && typeof ref?.id === 'string') {
        inserir.run(revisionId, direction, ref.kind, ref.id)
      }
    }
  }
}

export function registrarRotasAutomations (roteador, db) {
  const obterAutomation = db.prepare('SELECT * FROM automations WHERE id = ?')
  const obterUltimaRevision = db.prepare(`SELECT * FROM automation_revisions
    WHERE automation_id = ? ORDER BY revision DESC LIMIT 1`)
  const obterRevision = db.prepare(`SELECT * FROM automation_revisions
    WHERE automation_id = ? AND revision = ?`)
  const inserirRevision = db.prepare(`INSERT INTO automation_revisions
    (automation_id, revision, status, doc_json, validation_errors_json, created_at)
    VALUES (?, ?, 'draft', ?, NULL, ?)`)

  const exporAutomation = (row) => row && ({
    id: row.id,
    schemaVersion: row.schema_version,
    enabled: row.enabled === 1,
    activeRevisionId: row.active_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    draft: exporRevision(obterUltimaRevision.get(row.id))
  })

  const criar = db.transaction((body) => {
    const documentoRecebido = extrairDocumento(body)
    const id = body?.document ? (body.id ?? documentoRecebido.id) : documentoRecebido.id
    if (typeof id !== 'string' || !id.trim()) throw new ErroHttp(400, 'Campo obrigatório: id.')
    const idLimpo = id.trim()
    const documento = normalizarDocumento(documentoRecebido, idLimpo, 1)
    const agora = new Date().toISOString()
    try {
      db.prepare(`INSERT INTO automations
        (id, schema_version, enabled, active_revision_id, created_at, updated_at)
        VALUES (?, 1, 0, NULL, ?, ?)`)
        .run(idLimpo, agora, agora)
    } catch (erro) {
      if (erro.code?.startsWith('SQLITE_CONSTRAINT')) throw new ErroHttp(409, `Automação já cadastrada: ${idLimpo}.`)
      throw erro
    }
    const resultado = inserirRevision.run(idLimpo, 1, JSON.stringify(documento), agora)
    salvarScopes(db, resultado.lastInsertRowid, documento)
    return exporAutomation(obterAutomation.get(idLimpo))
  })

  const salvarRascunho = db.transaction((id, body) => {
    const automation = obterAutomation.get(id)
    if (!automation) throw new ErroHttp(404, `Automação não encontrada: ${id}.`)
    const ultima = obterUltimaRevision.get(id)
    const proximaRevision = ultima?.status === 'draft' ? ultima.revision : (ultima?.revision ?? 0) + 1
    const documento = normalizarDocumento(extrairDocumento(body), id, proximaRevision)
    let revisionId
    if (ultima?.status === 'draft') {
      db.prepare(`UPDATE automation_revisions
        SET doc_json = ?, validation_errors_json = NULL WHERE id = ?`)
        .run(JSON.stringify(documento), ultima.id)
      revisionId = ultima.id
    } else {
      const resultado = inserirRevision.run(id, proximaRevision, JSON.stringify(documento), new Date().toISOString())
      revisionId = resultado.lastInsertRowid
    }
    salvarScopes(db, revisionId, documento)
    db.prepare('UPDATE automations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    return exporRevision(db.prepare('SELECT * FROM automation_revisions WHERE id = ?').get(revisionId))
  })

  roteador.get('/automations', () => db.prepare('SELECT * FROM automations ORDER BY id').all().map(exporAutomation))
  roteador.post('/automations', ({ body }) => resposta(201, criar(body)))
  roteador.get('/automations/:id', ({ params }) => {
    const row = obterAutomation.get(params.id)
    if (!row) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    return exporAutomation(row)
  })
  roteador.delete('/automations/:id', ({ params }) => {
    const resultado = db.prepare('DELETE FROM automations WHERE id = ?').run(params.id)
    if (!resultado.changes) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    return { removed: true, id: params.id }
  })
  roteador.get('/automations/:id/revisions', ({ params }) => {
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    return db.prepare(`SELECT * FROM automation_revisions
      WHERE automation_id = ? ORDER BY revision DESC`).all(params.id).map(exporRevision)
  })
  roteador.get('/automations/:id/revisions/:rev', ({ params }) => {
    const revision = Number(params.rev)
    if (!Number.isInteger(revision) || revision < 1) throw new ErroHttp(400, 'Revisão inválida.')
    const row = obterRevision.get(params.id, revision)
    if (!row) throw new ErroHttp(404, `Revisão ${revision} não encontrada para ${params.id}.`)
    return exporRevision(row)
  })
  roteador.put('/automations/:id/draft', ({ params, body }) => salvarRascunho(params.id, body))
  roteador.post('/automations/:id/validate', ({ params, body }) => {
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    const ultima = obterUltimaRevision.get(params.id)
    const fornecido = body !== null
    const documento = fornecido ? extrairDocumento(body) : jsonOuNull(ultima.doc_json)
    const erros = validarAutomacao(db, documento)
    if (documento?.id !== params.id) erros.push({ path: '/id', message: `o id deve ser ${params.id}` })
    if (!fornecido) {
      db.prepare('UPDATE automation_revisions SET validation_errors_json = ? WHERE id = ?')
        .run(JSON.stringify(erros), ultima.id)
    }
    return { valid: erros.length === 0, errors: erros, revision: ultima.revision }
  })
}
