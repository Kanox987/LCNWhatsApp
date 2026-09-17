import { ErroHttp } from '../transport.js'
import { registrarResultadoExecucao } from '../evaluator.js'

const LIMITE_PADRAO = 50
const LIMITE_MAXIMO = 200
const TAMANHO_PREVIEW = 200
const STATUS_RUN = new Set(['matched_shadow', 'matched_live', 'no_match', 'error'])
const STATUS_COMANDO = new Set(['pending', 'sent', 'failed', 'outcome_unknown'])

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

function normalizarData (valor, campo) {
  if (typeof valor !== 'string' || !valor.trim()) throw new ErroHttp(400, `${campo} deve ser uma data válida.`)
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) throw new ErroHttp(400, `${campo} deve ser uma data válida.`)
  return data.toISOString()
}

function lerTexto (query, campo) {
  const valor = query.get(campo)
  if (valor === null) return null
  if (!valor.trim()) throw new ErroHttp(400, `${campo} não pode ser vazio.`)
  return valor.trim()
}

function lerLimite (query) {
  const valor = query.get('limit')
  if (valor === null) return LIMITE_PADRAO
  if (!/^\d+$/.test(valor)) throw new ErroHttp(400, 'limit deve ser um inteiro positivo.')
  const limite = Number(valor)
  if (!Number.isSafeInteger(limite) || limite < 1) throw new ErroHttp(400, 'limit deve ser um inteiro positivo.')
  return Math.min(limite, LIMITE_MAXIMO)
}

function codificarCursor (row) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString('base64url')
}

function decodificarCursor (valor) {
  if (valor === null) return null
  try {
    const cursor = JSON.parse(Buffer.from(valor, 'base64url').toString('utf8'))
    if (!Number.isSafeInteger(cursor?.id) || cursor.id < 1 || typeof cursor.createdAt !== 'string') throw new Error('cursor')
    return { createdAt: normalizarData(cursor.createdAt, 'cursor'), id: cursor.id }
  } catch {
    throw new ErroHttp(400, 'cursor inválido.')
  }
}

function exporContagemComandos (row) {
  return {
    total: Number(row.commands_total),
    pending: Number(row.commands_pending),
    sent: Number(row.commands_sent),
    failed: Number(row.commands_failed),
    outcomeUnknown: Number(row.commands_outcome_unknown)
  }
}

function exporRun (row) {
  return {
    id: row.id,
    automationId: row.automation_id,
    automationRevision: row.automation_revision,
    deploymentMode: row.deployment_mode,
    runStatus: row.run_status,
    commands: exporContagemComandos(row),
    createdAt: row.created_at
  }
}

function exporComando (row) {
  return {
    id: row.id,
    commandType: row.command_type,
    payload: jsonOuNull(row.payload_json),
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  }
}

function criarPreview (texto) {
  if (texto == null) return null
  if (texto.length <= TAMANHO_PREVIEW) return texto
  return `${texto.slice(0, TAMANHO_PREVIEW - 3)}...`
}

function lerRunId (valor) {
  if (!/^\d+$/.test(valor)) throw new ErroHttp(400, 'runId deve ser um inteiro positivo.')
  const runId = Number(valor)
  if (!Number.isSafeInteger(runId) || runId < 1) throw new ErroHttp(400, 'runId deve ser um inteiro positivo.')
  return runId
}

export function registrarRotasExecutions (roteador, db) {
  roteador.get('/executions', ({ query = new URLSearchParams() }) => {
    const automationId = lerTexto(query, 'automationId')
    const runStatus = lerTexto(query, 'runStatus')
    const commandStatus = lerTexto(query, 'commandStatus')
    const targetAccountId = lerTexto(query, 'targetAccountId')
    const from = query.get('from') === null ? null : normalizarData(query.get('from'), 'from')
    const to = query.get('to') === null ? null : normalizarData(query.get('to'), 'to')
    const cursor = decodificarCursor(query.get('cursor'))
    const limite = lerLimite(query)

    if (runStatus && !STATUS_RUN.has(runStatus)) throw new ErroHttp(400, `runStatus inválido: ${runStatus}.`)
    if (commandStatus && !STATUS_COMANDO.has(commandStatus)) throw new ErroHttp(400, `commandStatus inválido: ${commandStatus}.`)
    if (from && to && from > to) throw new ErroHttp(400, 'from não pode ser posterior a to.')

    const clausulas = []
    const parametros = { quantidade: limite + 1 }
    if (automationId) {
      clausulas.push('ar.automation_id = @automationId')
      parametros.automationId = automationId
    }
    if (runStatus) {
      clausulas.push('ar.status = @runStatus')
      parametros.runStatus = runStatus
    }
    if (from) {
      clausulas.push('ar.created_at >= @from')
      parametros.from = from
    }
    if (to) {
      clausulas.push('ar.created_at <= @to')
      parametros.to = to
    }
    if (cursor) {
      clausulas.push('(ar.created_at < @cursorCreatedAt OR (ar.created_at = @cursorCreatedAt AND ar.id < @cursorId))')
      parametros.cursorCreatedAt = cursor.createdAt
      parametros.cursorId = cursor.id
    }
    if (commandStatus || targetAccountId) {
      const filtrosComando = ['filtro.run_id = ar.id']
      if (commandStatus) {
        filtrosComando.push('filtro.status = @commandStatus')
        parametros.commandStatus = commandStatus
      }
      if (targetAccountId) {
        filtrosComando.push('filtro.target_account_id = @targetAccountId')
        parametros.targetAccountId = targetAccountId
      }
      clausulas.push(`EXISTS (SELECT 1 FROM outbound_commands filtro WHERE ${filtrosComando.join(' AND ')})`)
    }

    const where = clausulas.length ? clausulas.join(' AND ') : '1 = 1'
    const rows = db.prepare(`
      SELECT ar.id, ar.automation_id, rev.revision AS automation_revision,
        ar.deployment_mode, ar.status AS run_status, ar.created_at,
        COUNT(cmd.id) AS commands_total,
        SUM(CASE WHEN cmd.status = 'pending' THEN 1 ELSE 0 END) AS commands_pending,
        SUM(CASE WHEN cmd.status = 'sent' THEN 1 ELSE 0 END) AS commands_sent,
        SUM(CASE WHEN cmd.status = 'failed' THEN 1 ELSE 0 END) AS commands_failed,
        SUM(CASE WHEN cmd.status = 'outcome_unknown' THEN 1 ELSE 0 END) AS commands_outcome_unknown
      FROM automation_runs ar
      JOIN automation_revisions rev ON rev.id = ar.automation_revision_id
      LEFT JOIN outbound_commands cmd ON cmd.run_id = ar.id
      WHERE ${where}
      GROUP BY ar.id, ar.automation_id, rev.revision, ar.deployment_mode, ar.status, ar.created_at
      ORDER BY ar.created_at DESC, ar.id DESC
      LIMIT @quantidade
    `).all(parametros)

    const temProxima = rows.length > limite
    const pagina = temProxima ? rows.slice(0, limite) : rows
    return {
      items: pagina.map(exporRun),
      nextCursor: temProxima ? codificarCursor(pagina[pagina.length - 1]) : null
    }
  })

  const obterRun = db.prepare(`
    SELECT ar.id, ar.automation_id, rev.revision AS automation_revision,
      ar.deployment_mode, ar.status AS run_status, ar.detail_json, ar.created_at,
      evento.chat_kind, evento.message_kind, evento.message_text,
      COUNT(cmd.id) AS commands_total,
      SUM(CASE WHEN cmd.status = 'pending' THEN 1 ELSE 0 END) AS commands_pending,
      SUM(CASE WHEN cmd.status = 'sent' THEN 1 ELSE 0 END) AS commands_sent,
      SUM(CASE WHEN cmd.status = 'failed' THEN 1 ELSE 0 END) AS commands_failed,
      SUM(CASE WHEN cmd.status = 'outcome_unknown' THEN 1 ELSE 0 END) AS commands_outcome_unknown
    FROM automation_runs ar
    JOIN automation_revisions rev ON rev.id = ar.automation_revision_id
    JOIN inbound_events evento ON evento.id = ar.event_id
    LEFT JOIN outbound_commands cmd ON cmd.run_id = ar.id
    WHERE ar.id = ?
    GROUP BY ar.id, ar.automation_id, rev.revision, ar.deployment_mode, ar.status,
      ar.detail_json, ar.created_at, evento.chat_kind, evento.message_kind, evento.message_text
  `)
  const obterComandos = db.prepare(`
    SELECT id, command_type, payload_json, status, created_at, resolved_at
    FROM outbound_commands
    WHERE run_id = ?
    ORDER BY created_at, id
  `)
  const obterDetalhe = db.transaction((runId) => {
    const row = obterRun.get(runId)
    if (!row) throw new ErroHttp(404, `Execução não encontrada: ${runId}.`)
    const run = exporRun(row)
    return {
      ...run,
      commands: {
        ...run.commands,
        items: obterComandos.all(runId).map(exporComando)
      },
      detail: jsonOuNull(row.detail_json),
      event: {
        chat: { kind: row.chat_kind },
        message: { kind: row.message_kind, preview: criarPreview(row.message_text) }
      }
    }
  })

  roteador.get('/executions/:runId', ({ params }) => obterDetalhe(lerRunId(params.runId)))

  roteador.post('/commands/:commandId/result', ({ params, body }) => {
    return registrarResultadoExecucao(db, params.commandId, body || {})
  })

  // Comandos desta conta que ficaram sem resposta.
  //
  // Quem executa comando de uma conta é UM processo só: o gateway dela. Então,
  // quando esse gateway acaba de subir, nada dele está em andamento — o que
  // sobrou `pending` foi interrompido no meio (reinício, queda, deploy).
  //
  // Ficavam presos para sempre, invisíveis. O pior caso é o download: ele
  // manda "⏳ Baixando…" ANTES de baixar, então a pessoa fica esperando uma
  // mídia que nunca vem, sem nada dizendo que falhou.
  roteador.get('/commands/pending', ({ query }) => {
    const accountId = query.get('accountId')
    if (!accountId) throw new ErroHttp(400, 'Falta accountId.')
    const limite = Math.min(50, Math.max(1, Number(query.get('limit')) || 20))
    const linhas = db.prepare(`SELECT id, run_id, target_account_id, command_type, payload_json, status, created_at
      FROM outbound_commands
      WHERE status = 'pending' AND target_account_id = ?
      ORDER BY rowid DESC LIMIT ?`).all(accountId, limite)
    return linhas.map((row) => ({
      id: row.id,
      runId: row.run_id,
      targetAccountId: row.target_account_id,
      commandType: row.command_type,
      payload: jsonOuNull(row.payload_json),
      status: row.status,
      // Sem isto o corte por idade nunca se aplica, e uma queda de ontem
      // ressuscitaria a conversa com um aviso que não ajuda mais ninguém.
      createdAt: row.created_at
    }))
  })
}
