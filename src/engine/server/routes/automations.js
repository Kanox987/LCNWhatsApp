import { ErroHttp, resposta } from '../transport.js'
import { validarAutomacao } from '../validate.js'
import { criarServicoAutomacoes } from '../automationsService.js'

export function registrarRotasAutomations (roteador, db) {
  const servico = criarServicoAutomacoes(db)
  const {
    obterAutomation, obterUltimaRevision, obterRevision,
    exporAutomation, exporRevision, extrairDocumento, jsonOuNull,
    criar, salvarRascunho, publicar, despublicar
  } = servico

  // Automações nativas (ex: /menu, ver nativeAutomations.js) ficam fora
  // da listagem normal — são conteúdo do próprio motor, não algo que o
  // usuário criou ou deveria editar pelo wizard genérico.
  roteador.get('/automations', () => db.prepare('SELECT * FROM automations WHERE native = 0 ORDER BY id').all().map(exporAutomation))
  roteador.post('/automations', ({ body }) => resposta(201, criar(body)))
  roteador.get('/automations/:id', ({ params }) => {
    const row = obterAutomation.get(params.id)
    if (!row) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    return exporAutomation(row)
  })
  roteador.delete('/automations/:id', ({ params }) => {
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)

    // automation_runs referencia automations sem ON DELETE CASCADE (migração
    // 002), então uma automação que já executou não pode simplesmente sumir —
    // o banco recusa. Antes isso vazava como 500 "erro interno"; agora explica
    // o que houve e qual é a saída. Apagar o histórico junto seria destruir
    // auditoria, então continua sendo decisão de quem opera, não do sistema.
    const execucoes = db.prepare('SELECT COUNT(*) AS total FROM automation_runs WHERE automation_id = ?').get(params.id)
    if (execucoes.total > 0) {
      throw new ErroHttp(409,
        `Esta automação já executou ${execucoes.total} vez(es) e o histórico dessas execuções depende dela. ` +
        'Para tirá-la do ar sem perder o histórico, use "Despublicar" ou desligue a automação.')
    }

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
  // O roteador já entrega o IncomingMessage ao handler, então a concorrência
  // otimista usa If-Match real sem ampliar a abstração minimalista do transporte.
  roteador.put('/automations/:id/draft', ({ params, body, req }) => {
    return salvarRascunho(params.id, body, req?.headers?.['if-match'])
  })

  roteador.post('/automations/:id/publish', ({ params, body }) => publicar(params.id, body?.revision))
  roteador.post('/automations/:id/unpublish', ({ params }) => despublicar(params.id))

  roteador.put('/automations/:id/enabled', ({ params, body }) => {
    if (typeof body?.enabled !== 'boolean') throw new ErroHttp(400, 'enabled deve ser true ou false.')
    const automation = obterAutomation.get(params.id)
    if (!automation) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    if (body.enabled && automation.active_revision_id === null) {
      throw new ErroHttp(409, 'Não há revisão publicada pra habilitar esta automação.')
    }
    db.prepare('UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(body.enabled ? 1 : 0, new Date().toISOString(), params.id)
    return exporAutomation(obterAutomation.get(params.id))
  })

  // Alterna sombra/ao vivo sem precisar de nova revisão — é o "promove pra
  // live no mesmo teste" que o plano descreve pro fluxo do /ping.
  roteador.put('/automations/:id/deployment-mode', ({ params, body }) => {
    if (!['shadow', 'live'].includes(body?.mode)) throw new ErroHttp(400, "mode deve ser 'shadow' ou 'live'.")
    if (!obterAutomation.get(params.id)) throw new ErroHttp(404, `Automação não encontrada: ${params.id}.`)
    db.prepare('UPDATE automations SET deployment_mode = ?, updated_at = ? WHERE id = ?')
      .run(body.mode, new Date().toISOString(), params.id)
    return exporAutomation(obterAutomation.get(params.id))
  })
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
