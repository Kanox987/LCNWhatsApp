// Lógica de criar/publicar automação extraída de routes/automations.js
// (Parte C, Módulo 4 do plano) pra ser reaproveitada por MAIS de um
// consumidor: a rota HTTP normal (criação manual, um documento por vez) e
// a instalação de templates do catálogo (server/templates/*), que precisa
// criar e publicar VÁRIAS automações de uma vez a partir de uma árvore de
// dependências. Nenhuma automação criada por template pode pular validação
// ou publish — usa exatamente as mesmas duas funções (`criar`/`publicar`)
// que uma automação criada manualmente pelo wizard usa, ponto já
// registrado no plano ("o resultado passa pelo MESMO validarAutomacao() e
// publish de uma automação manual").
import crypto from 'crypto'
import { ErroHttp } from './transport.js'
import { validarAutomacao } from './validate.js'
import { ACOES_SUPORTADAS, CONDICOES_SUPORTADAS, GATILHOS_SUPORTADOS } from './runtimeCapabilities.js'

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

function calcularEtag (docJson) {
  return crypto.createHash('sha1').update(docJson).digest('hex')
}

function exporRevision (row) {
  if (!row) return null
  return {
    id: row.id,
    automationId: row.automation_id,
    revision: row.revision,
    status: row.status,
    document: jsonOuNull(row.doc_json),
    etag: calcularEtag(row.doc_json),
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

export function criarServicoAutomacoes (db) {
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
    deploymentMode: row.deployment_mode,
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

  const salvarRascunho = db.transaction((id, body, expectedEtag) => {
    const automation = obterAutomation.get(id)
    if (!automation) throw new ErroHttp(404, `Automação não encontrada: ${id}.`)
    const ultima = obterUltimaRevision.get(id)
    if (expectedEtag !== undefined) {
      if (typeof expectedEtag !== 'string' || !expectedEtag) throw new ErroHttp(400, 'If-Match deve conter um ETag válido.')
      const etagAtual = ultima ? calcularEtag(ultima.doc_json) : null
      if (expectedEtag !== etagAtual) {
        throw new ErroHttp(409, 'O rascunho foi alterado por outra edição. Recarregue antes de salvar novamente.')
      }
    }
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

  // publish/unpublish — Etapa 3.5. automations.enabled é a ÚNICA fonte de
  // verdade operacional (o avaliador só olha essa coluna, nunca doc.enabled
  // diretamente) — decisão registrada no plano pra não ter ambiguidade
  // entre o campo do documento e o estado real de execução.
  const publicar = db.transaction((id, revisaoAlvo) => {
    const automation = obterAutomation.get(id)
    if (!automation) throw new ErroHttp(404, `Automação não encontrada: ${id}.`)
    const revision = revisaoAlvo
      ? obterRevision.get(id, revisaoAlvo)
      : obterUltimaRevision.get(id)
    if (!revision) throw new ErroHttp(404, revisaoAlvo ? `Revisão ${revisaoAlvo} não encontrada.` : 'Nenhuma revisão pra publicar.')

    const documento = jsonOuNull(revision.doc_json)
    const erros = validarAutomacao(db, documento)
    if (erros.length) throw new ErroHttp(422, 'Revisão inválida, não pode ser publicada.', erros)

    // Checa TODA família de nó, não só 'action.' — antes disso um
    // 'trigger.*' ou 'condition.*' que o runtime não executa passava no
    // publish e era ignorado em silêncio pelo avaliador, deixando uma
    // automação publicada e aparentemente saudável que nunca reagia.
    const indiceNaoExecutavel = documento.flow.nodes.findIndex((node) => {
      if (typeof node?.type !== 'string') return false
      if (node.type.startsWith('action.')) return !ACOES_SUPORTADAS.includes(node.type)
      if (node.type.startsWith('trigger.')) return !GATILHOS_SUPORTADOS.includes(node.type)
      if (node.type.startsWith('condition.')) return !CONDICOES_SUPORTADAS.includes(node.type)
      return true
    })
    if (indiceNaoExecutavel !== -1) {
      const tipo = documento.flow.nodes[indiceNaoExecutavel].type
      throw new ErroHttp(422, `Nó "${tipo}" ainda não é executável pelo motor.`, [
        { path: `/flow/nodes/${indiceNaoExecutavel}/type`, message: `ação não suportada pelo runtime: ${tipo}` }
      ])
    }

    const agora = new Date().toISOString()
    db.prepare(`UPDATE automation_revisions SET status = 'inactive'
      WHERE automation_id = ? AND status = 'active' AND id != ?`).run(id, revision.id)
    db.prepare(`UPDATE automation_revisions SET status = 'active', validation_errors_json = '[]'
      WHERE id = ?`).run(revision.id)
    db.prepare(`UPDATE automations SET active_revision_id = ?, enabled = ?, updated_at = ?
      WHERE id = ?`).run(revision.id, documento.enabled ? 1 : 0, agora, id)
    return exporAutomation(obterAutomation.get(id))
  })

  const despublicar = db.transaction((id) => {
    const automation = obterAutomation.get(id)
    if (!automation) throw new ErroHttp(404, `Automação não encontrada: ${id}.`)
    if (automation.active_revision_id) {
      db.prepare(`UPDATE automation_revisions SET status = 'inactive' WHERE id = ?`).run(automation.active_revision_id)
    }
    db.prepare(`UPDATE automations SET active_revision_id = NULL, enabled = 0, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id)
    return exporAutomation(obterAutomation.get(id))
  })

  // Cria E publica de uma vez, numa transação só — usado pela instalação de
  // templates (várias automações de um template com dependências precisam
  // nascer já publicadas, atomicamente: nenhuma fica "pela metade" se
  // alguma automação da árvore falhar validação). better-sqlite3 aceita
  // funções .transaction() chamadas de dentro de outra (usa savepoint), por
  // isso o instalador do catálogo consegue envolver N chamadas a esta
  // função numa única `db.transaction(...)` externa sem duplicar lógica.
  const criarEPublicar = (body) => {
    const criada = criar(body)
    return publicar(criada.id)
  }

  return {
    obterAutomation,
    obterUltimaRevision,
    obterRevision,
    exporAutomation,
    exporRevision,
    extrairDocumento,
    normalizarDocumento,
    jsonOuNull,
    criar,
    salvarRascunho,
    publicar,
    despublicar,
    criarEPublicar
  }
}
