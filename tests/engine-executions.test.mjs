import http from 'http'
import { EventEmitter } from 'events'
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { criarClienteEngine } from '../src/engine/client.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null, query = '') => ({ body, query: new URLSearchParams(query), req: { headers: {} } })

function inserirAutomacao (id, revision) {
  const agora = '2026-09-12T00:00:00.000Z'
  db.prepare(`INSERT INTO automations
    (id, schema_version, enabled, deployment_mode, created_at, updated_at)
    VALUES (?, 1, 1, 'live', ?, ?)`)
    .run(id, agora, agora)
  return Number(db.prepare(`INSERT INTO automation_revisions
    (automation_id, revision, status, doc_json, created_at)
    VALUES (?, ?, 'active', '{}', ?)`)
    .run(id, revision, agora).lastInsertRowid)
}

function inserirRun ({ numero, automationId, revisionId, status, createdAt, messageText, commands = [], detail = null }) {
  const eventId = `evento-${numero}`
  db.prepare(`INSERT INTO inbound_events
    (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at)
    VALUES (?, 'conta-entrada', 'chat-privado', 'direct', 'remetente', 'text', ?, 0, '{}', ?)`)
    .run(eventId, messageText ?? `mensagem ${numero}`, createdAt)
  const runId = Number(db.prepare(`INSERT INTO automation_runs
    (event_id, automation_id, automation_revision_id, deployment_mode, status, detail_json, created_at)
    VALUES (?, ?, ?, 'live', ?, ?, ?)`)
    .run(eventId, automationId, revisionId, status, detail === null ? null : JSON.stringify(detail), createdAt).lastInsertRowid)
  for (const command of commands) {
    db.prepare(`INSERT INTO outbound_commands
      (id, run_id, target_account_id, command_type, payload_json, status, created_at, resolved_at)
      VALUES (?, ?, ?, 'whatsapp.reply', ?, ?, ?, ?)`)
      .run(
        command.id,
        runId,
        command.targetAccountId || 'conta-a',
        JSON.stringify({ chatId: 'chat-privado', text: command.text || `retorno ${numero}` }),
        command.status,
        createdAt,
        command.status === 'pending' ? null : createdAt
      )
  }
  return runId
}

async function capturarErro (method, pathname, body) {
  try {
    await api.resolver(method, pathname, contexto(body))
    return null
  } catch (erro) {
    return erro
  }
}

try {
  const revisaoPing = inserirAutomacao('ping', 4)
  const revisaoAjuda = inserirAutomacao('ajuda', 2)
  const run1 = inserirRun({
    numero: 1,
    automationId: 'ping',
    revisionId: revisaoPing,
    status: 'matched_live',
    createdAt: '2026-09-12T00:00:01.000Z',
    commands: [{ id: 'cmd-1', status: 'pending' }]
  })
  const run2 = inserirRun({
    numero: 2,
    automationId: 'ping',
    revisionId: revisaoPing,
    status: 'matched_live',
    createdAt: '2026-09-12T00:00:02.000Z',
    commands: [{ id: 'cmd-2', status: 'sent' }]
  })
  const run3 = inserirRun({
    numero: 3,
    automationId: 'ajuda',
    revisionId: revisaoAjuda,
    status: 'no_match',
    createdAt: '2026-09-12T00:00:02.000Z'
  })
  const textoLongo = 'x'.repeat(240)
  const run4 = inserirRun({
    numero: 4,
    automationId: 'ping',
    revisionId: revisaoPing,
    status: 'matched_live',
    createdAt: '2026-09-12T00:00:03.000Z',
    messageText: textoLongo,
    detail: { motivo: 'falha simulada' },
    commands: [{ id: 'cmd-4', status: 'failed', targetAccountId: 'conta-b', text: 'retorno de falha' }]
  })
  const run5 = inserirRun({
    numero: 5,
    automationId: 'ajuda',
    revisionId: revisaoAjuda,
    status: 'error',
    createdAt: '2026-09-12T00:00:04.000Z',
    commands: [{ id: 'cmd-5', status: 'outcome_unknown' }]
  })
  const run6 = inserirRun({
    numero: 6,
    automationId: 'ajuda',
    revisionId: revisaoAjuda,
    status: 'matched_shadow',
    createdAt: '2026-09-12T00:00:05.000Z'
  })

  const lista = await api.resolver('GET', '/executions', contexto())
  check('listagem básica retorna todos os runs', lista.items.length === 6)
  check('listagem ordena do mais recente ao mais antigo', lista.items[0]?.id === run6 && lista.items.at(-1)?.id === run1)
  check('listagem expõe o número real da revisão', lista.items.find((item) => item.id === run4)?.automationRevision === 4)
  check('listagem expõe os campos públicos esperados', JSON.stringify(Object.keys(lista.items[0])) === JSON.stringify([
    'id', 'automationId', 'automationRevision', 'deploymentMode', 'runStatus', 'commands', 'createdAt'
  ]))
  check('agregado contabiliza comando pendente', lista.items.find((item) => item.id === run1)?.commands.pending === 1)
  check('agregado contabiliza comando falho', lista.items.find((item) => item.id === run4)?.commands.failed === 1)
  check('listagem não inclui conteúdo do evento', !JSON.stringify(lista).includes(textoLongo))
  check('sem página seguinte, nextCursor é null', lista.nextCursor === null)

  const somentePing = await api.resolver('GET', '/executions', contexto(null, 'automationId=ping'))
  check('filtro automationId retorna somente a automação pedida', somentePing.items.length === 3 && somentePing.items.every((item) => item.automationId === 'ping'))

  const somenteErros = await api.resolver('GET', '/executions', contexto(null, 'runStatus=error'))
  check('filtro runStatus retorna somente o status pedido', somenteErros.items.length === 1 && somenteErros.items[0].id === run5)

  const somenteFalhos = await api.resolver('GET', '/executions', contexto(null, 'commandStatus=failed'))
  check('filtro commandStatus encontra run com comando falho', somenteFalhos.items.length === 1 && somenteFalhos.items[0].id === run4)
  check('filtro commandStatus preserva o agregado completo do run', somenteFalhos.items[0]?.commands.total === 1 && somenteFalhos.items[0]?.commands.failed === 1)

  const contaB = await api.resolver('GET', '/executions', contexto(null, 'targetAccountId=conta-b&commandStatus=failed'))
  check('filtros de conta e status se aplicam ao mesmo comando', contaB.items.length === 1 && contaB.items[0].id === run4)

  const intervalo = await api.resolver('GET', '/executions', contexto(null, 'from=2026-09-12T00%3A00%3A03Z&to=2026-09-12T00%3A00%3A04Z'))
  check('filtros from/to incluem as duas extremidades', JSON.stringify(intervalo.items.map((item) => item.id)) === JSON.stringify([run5, run4]))

  const idsPaginados = []
  let cursor = null
  let paginas = 0
  do {
    const query = new URLSearchParams({ limit: '2' })
    if (cursor) query.set('cursor', cursor)
    const pagina = await api.resolver('GET', '/executions', contexto(null, query.toString()))
    idsPaginados.push(...pagina.items.map((item) => item.id))
    cursor = pagina.nextCursor
    paginas++
  } while (cursor && paginas < 10)
  check('paginação percorre múltiplas páginas até cursor null', paginas === 3 && cursor === null)
  check('paginação não repete nenhum run', new Set(idsPaginados).size === idsPaginados.length)
  check('paginação não pula runs, inclusive com created_at empatado', JSON.stringify(idsPaginados) === JSON.stringify([run6, run5, run4, run3, run2, run1]))

  const detalhe = await api.resolver('GET', `/executions/${run4}`, contexto())
  check('detalhe mantém o resumo do run', detalhe.id === run4 && detalhe.commands.failed === 1 && detalhe.automationRevision === 4)
  check('detalhe expõe o erro estruturado do run', detalhe.detail?.motivo === 'falha simulada')
  check('detalhe expõe somente o tipo do chat e da mensagem', detalhe.event?.chat?.kind === 'direct' && detalhe.event?.message?.kind === 'text')
  check('preview do texto é truncado em no máximo 200 caracteres', detalhe.event?.message?.preview?.length === 200 && detalhe.event.message.preview.endsWith('...'))
  check('detalhe expõe o comando individual e interpreta o payload', detalhe.commands.items[0]?.id === 'cmd-4' && detalhe.commands.items[0]?.payload?.text === 'retorno de falha')
  check('comando individual expõe exatamente os campos pedidos', JSON.stringify(Object.keys(detalhe.commands.items[0])) === JSON.stringify([
    'id', 'commandType', 'payload', 'status', 'createdAt', 'resolvedAt'
  ]))

  const erroRunInexistente = await capturarErro('GET', '/executions/999999')
  check('detalhe inexistente retorna 404', erroRunInexistente?.status === 404)

  const criadoEm = '2026-09-12T00:00:06.000Z'
  const inserirComando = db.prepare(`INSERT INTO outbound_commands
    (id, run_id, target_account_id, command_type, payload_json, status, created_at)
    VALUES (?, ?, 'conta-a', 'whatsapp.reply', '{}', 'pending', ?)`)
  inserirComando.run('cmd-nova-rota', run6, criadoEm)
  inserirComando.run('cmd-rota-antiga', run6, criadoEm)

  const confirmadoNovo = await api.resolver('POST', '/commands/cmd-nova-rota/result', contexto({ status: 'sent' }))
  const confirmadoAntigo = await api.resolver('POST', '/executions/cmd-rota-antiga/result', contexto({ status: 'failed' }))
  check('nova rota confirma o resultado do comando', confirmadoNovo.status === 'sent')
  check('rota antiga continua confirmando o resultado do comando', confirmadoAntigo.status === 'failed')

  const erroStatusNovo = await capturarErro('POST', '/commands/cmd-nova-rota/result', { status: 'invalido' })
  const erroStatusAntigo = await capturarErro('POST', '/executions/cmd-rota-antiga/result', { status: 'invalido' })
  check('as duas rotas preservam a mesma validação de status', erroStatusNovo?.status === 400 && erroStatusNovo?.message === erroStatusAntigo?.message)

  const erroComandoNovo = await capturarErro('POST', '/commands/nao-existe/result', { status: 'sent' })
  const erroComandoAntigo = await capturarErro('POST', '/executions/nao-existe/result', { status: 'sent' })
  check('as duas rotas retornam o mesmo 404 para comando inexistente', erroComandoNovo?.status === 404 && erroComandoNovo?.message === erroComandoAntigo?.message)

  const requisicoes = []
  const requestOriginal = http.request
  http.request = (options, callback) => {
    const req = new EventEmitter()
    req.end = (conteudo) => {
      requisicoes.push({ options, conteudo: conteudo?.toString('utf8') })
      const res = new EventEmitter()
      res.statusCode = 200
      callback(res)
      queueMicrotask(() => {
        res.emit('data', Buffer.from('{}'))
        res.emit('end')
      })
    }
    return req
  }
  try {
    const cliente = criarClienteEngine({ socketPath: '/tmp/socket-nao-utilizado.sock' })
    await cliente.execucoes.listar({ automationId: 'ping teste', runStatus: 'matched_live', commandStatus: 'failed', limit: 2 })
    await cliente.execucoes.obter(42)
    await cliente.execucoes.confirmar('cmd/42', { status: 'sent' })
  } finally {
    http.request = requestOriginal
  }
  check('cliente monta querystring da listagem', requisicoes[0]?.options?.path === '/executions?automationId=ping+teste&runStatus=matched_live&commandStatus=failed&limit=2')
  check('cliente obtém detalhe pelo runId', requisicoes[1]?.options?.method === 'GET' && requisicoes[1]?.options?.path === '/executions/42')
  check('cliente confirmar usa a nova rota de comandos', requisicoes[2]?.options?.method === 'POST' && requisicoes[2]?.options?.path === '/commands/cmd%2F42/result')
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado nos testes de histórico de execuções:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO HISTÓRICO DE EXECUÇÕES PASSARAM')
process.exit(falhas ? 1 : 0)
