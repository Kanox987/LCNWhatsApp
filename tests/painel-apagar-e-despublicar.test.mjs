// APAGAR E DESPUBLICAR AUTOMAÇÃO PELA TELA, E HISTÓRICO DE REVISÕES.
//
// O sintoma que motivou esta ordem de serviço:
// Uma tentativa de apagar um comando (/diagpagina) bateu na recusa legítima:
//
//   "Esta automação já executou 1 vez(es) e o histórico dessas execuções depende dela.
//    Para tirá-la do ar sem perder o histórico, use 'Tirar do ar' ou desligue a automação."
//
// A proteção do banco está certa: automation_runs referencia automations sem
// ON DELETE CASCADE para não destruir auditoria. O problema é que a tela não tinha
// botão de "Despublicar" nem de "Apagar" — quem aluga o sistema e não tem terminal
// ficava com um comando preso para sempre se ele já tivesse executado uma única vez.
//
// As quatro rotas já existiam no motor:
//   DELETE /automations/:id
//   POST /automations/:id/unpublish
//   GET /automations/:id/revisions
//   GET /automations/:id/revisions/:rev
//
// Este arquivo testa a corrente inteira: motor -> BFF -> cliente da API -> tela,
// a lógica pura de confirmação/erro e o comportamento das rotas HTTP reais.
import fs from 'node:fs'
import { abrirBanco } from '../src/engine/server/db.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { registrarRotasAutomations } from '../src/engine/server/routes/automations.js'
import { criarRoteador } from '../src/engine/server/transport.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { iniciarServidorWeb } from '../src/web/server.js'
import { compilar } from '../src/lcn/compilar.js'
import {
  mensagemConfirmacaoApagar,
  analisarErroApagar,
  statusRevisao,
  textoDaRevisao
} from '../src/web/public/logic/automacoes.js'

let falhas = 0
const check = (nome, ok, extra) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`)
}

// Compilar via .lcn garante todos os campos obrigatórios do schema (enabled, etc.)
// exatamente como acontece no fluxo real do sistema.
function montarDocumentoValido (id = 'diagpagina', poolId = 'pool-teste') {
  return compilar(`automação ${id}
  nome: Diagnóstico de Página
  tipo: comando
  dispara com: /${id}
  acessa: texto
  quem: qualquer um
  onde: em qualquer lugar
  pool: ${poolId}
  casa: exato

  responde "ok"
`)
}

const ler = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const motorRotas = ler('../src/engine/server/routes/automations.js')
const bff = ler('../src/web/router.js')
const clienteApi = ler('../src/web/public/api.js')
const telaAutomacoes = ler('../src/web/public/pages/automations.js')

// ============================================================================
// 1. A CORRENTE COMPLETA: MOTOR -> BFF -> CLIENTE API -> TELA
// ============================================================================

// 1.1 As quatro rotas no motor existem
check('motor: DELETE /automations/:id existe', motorRotas.includes("roteador.delete('/automations/:id'"))
check('motor: POST /automations/:id/unpublish existe', motorRotas.includes("roteador.post('/automations/:id/unpublish'"))
check('motor: GET /automations/:id/revisions existe', motorRotas.includes("roteador.get('/automations/:id/revisions'"))
check('motor: GET /automations/:id/revisions/:rev existe', motorRotas.includes("roteador.get('/automations/:id/revisions/:rev'"))

// 1.2 O BFF repassa todas as rotas
check('bff: repassa DELETE /api/v1/automations/:id', bff.includes("roteador.delete('/api/v1/automations/:id'"))
check('bff: repassa POST /api/v1/automations/:id/unpublish', bff.includes("roteador.post('/api/v1/automations/:id/unpublish'"))
check('bff: repassa GET /api/v1/automations/:id/revisions', bff.includes("roteador.get('/api/v1/automations/:id/revisions'"))
check('bff: repassa GET /api/v1/automations/:id/revisions/:rev', bff.includes("roteador.get('/api/v1/automations/:id/revisions/:rev'"))

// 1.3 O cliente do navegador expõe todas
check('api: automations.remove existe e chama DELETE', clienteApi.includes("remove: (id) => request(`/automations/${segment(id)}`, { method: 'DELETE' }"))
check('api: automations.unpublish existe e chama POST', clienteApi.includes("unpublish: (id) => request(`/automations/${segment(id)}/unpublish`, { method: 'POST' }"))
check('api: automations.revisions existe', clienteApi.includes('revisions: (id) => request(`/automations/${segment(id)}/revisions`)'))
check('api: automations.revision existe', clienteApi.includes('revision: (id, rev) => request(`/automations/${segment(id)}/revisions/${segment(rev)}`)'))

// 1.4 A tela de automações alcança os métodos do cliente
check('tela: chama api.automations.remove', telaAutomacoes.includes('api.automations.remove('))
check('tela: chama api.automations.unpublish', telaAutomacoes.includes('api.automations.unpublish('))
check('tela: chama api.automations.revisions', telaAutomacoes.includes('api.automations.revisions('))
check('tela: chama api.automations.revision', telaAutomacoes.includes('api.automations.revision('))

// 1.5 Botões na tela
check('tela: oferece botão "Tirar do ar"', telaAutomacoes.includes("button('Tirar do ar'"))
check('tela: oferece botão "Apagar"', telaAutomacoes.includes("button('Apagar'"))
check('tela: oferece botão "Revisões"', telaAutomacoes.includes("button('Revisões'"))
check('tela: trata erro 409 especificamente', telaAutomacoes.includes('bloqueadoPorHistorico') || telaAutomacoes.includes('409'))

// 1.6 Proteção contra a armadilha histórica: ações e conteúdo separados
// No passado, caixa.replaceChildren apagou os botões junto com a exibição do texto.
check('tela: separa acoes e conteudo no painel de revisões',
  telaAutomacoes.includes("acoes = el('div', { className: 'button-row' })") &&
  telaAutomacoes.includes("conteudo = el('div', { className: 'stack-sm' })"))
check('tela: preenche conteudo sem destruir acoes',
  telaAutomacoes.includes('conteudo.replaceChildren(') && !telaAutomacoes.includes('caixaRevisao.replaceChildren('))

// ============================================================================
// 2. LÓGICA PURA DE APRESENTAÇÃO (src/web/public/logic/automacoes.js)
// ============================================================================

// 2.1 Mensagem de confirmação antes de apagar
{
  const msgSemExec = mensagemConfirmacaoApagar({ nome: 'Diag', id: 'diagpagina' })
  check('confirmação: inclui nome e id', msgSemExec.includes('"Diag" (diagpagina)'))
  check('confirmação: avisa sobre irreversibilidade', msgSemExec.includes('irreversível'))
  check('confirmação: sem execuções conhecidas não inventa contagem', !msgSemExec.includes('execução'))

  const msgZero = mensagemConfirmacaoApagar({ nome: 'Teste', id: 'cmd-teste', totalExecucoes: 0 })
  check('confirmação: explicita quando há zero execuções', msgZero.includes('Nenhuma execução registrada.'))

  const msgUma = mensagemConfirmacaoApagar({ nome: 'Teste', id: 'cmd-teste', totalExecucoes: 1 })
  check('confirmação: singular com 1 execução', msgUma.includes('possui 1 execução registrada.'))

  const msgVarias = mensagemConfirmacaoApagar({ nome: 'Teste', id: 'cmd-teste', totalExecucoes: 12 })
  check('confirmação: plural com 12 execuções', msgVarias.includes('possui 12 execuções registradas.'))

  const msgMuitas = mensagemConfirmacaoApagar({ nome: 'Teste', id: 'cmd-teste', totalExecucoes: '50+' })
  check('confirmação: aceita indicador textual de paginação ("50+")', msgMuitas.includes('possui 50+ execuções registradas.'))
}

// 2.2 Análise do erro ao apagar
{
  const erro409 = {
    status: 409,
    message: 'Esta automação já executou 1 vez(es) e o histórico dessas execuções depende dela. Para tirá-la do ar sem perder o histórico, use "Tirar do ar" ou desligue a automação.'
  }
  const analise409 = analisarErroApagar(erro409)
  check('análise erro: 409 é reconhecido como bloqueio de histórico', analise409.bloqueadoPorHistorico === true)
  check('análise erro: 409 indica que pode tirar do ar', analise409.podeTirarDoAr === true)
  check('análise erro: preserva a mensagem clara do servidor', analise409.mensagem === erro409.message)

  const erro404 = { status: 404, message: 'Automação não encontrada: xyz.' }
  const analise404 = analisarErroApagar(erro404)
  check('análise erro: 404 não é bloqueio por histórico', analise404.bloqueadoPorHistorico === false)
  check('análise erro: 404 não oferece tirar do ar', analise404.podeTirarDoAr === false)
}

// 2.3 Status de revisão
{
  const revAtivaPorId = { id: 10, revision: 2, status: 'inactive' }
  const stAtivaId = statusRevisao(revAtivaPorId, 10)
  check('status revisão: detecta ativa quando bate activeRevisionId', stAtivaId.ehAtiva && stAtivaId.rotulo === 'Ativa agora' && stAtivaId.tom === 'success')

  const revAtivaPorStatus = { id: 5, revision: 1, status: 'active' }
  const stAtivaStatus = statusRevisao(revAtivaPorStatus, null)
  check('status revisão: detecta ativa pelo status "active"', stAtivaStatus.ehAtiva && stAtivaStatus.rotulo === 'Ativa agora')

  const revDraft = { id: 11, revision: 3, status: 'draft' }
  const stDraft = statusRevisao(revDraft, 10)
  check('status revisão: identifica rascunho', !stDraft.ehAtiva && stDraft.rotulo === 'Rascunho' && stDraft.tom === 'info')

  const revInativa = { id: 4, revision: 1, status: 'inactive' }
  const stInativa = statusRevisao(revInativa, 10)
  check('status revisão: identifica inativa', !stInativa.ehAtiva && stInativa.rotulo === 'Inativa' && stInativa.tom === 'neutral')
}

// 2.4 Leitura do texto da revisão
{
  const comTexto = { texto: 'automação ping\n  responde "pong"' }
  check('texto revisão: usa texto descompilado quando presente', textoDaRevisao(comTexto) === comTexto.texto)

  const comDoc = { document: { id: 'ping', name: 'Ping' } }
  check('texto revisão: cai para JSON formatado quando não há texto descompilado',
    textoDaRevisao(comDoc) === JSON.stringify(comDoc.document, null, 2))

  check('texto revisão: aviso seguro quando não há documento',
    textoDaRevisao({}).includes('Sem documento'))
}

// ============================================================================
// 3. TRANSPORTE HTTP (BFF + SERVIDOR WEB)
// ============================================================================
{
  const chamadas = []
  const aplicacaoFake = {
    motor: {
      saude: async () => ({ ok: true }),
      automacoes: {
        remover: async (id) => {
          chamadas.push({ nome: 'remover', id })
          return { removed: true, id }
        },
        despublicar: async (id) => {
          chamadas.push({ nome: 'despublicar', id })
          return { id, activeRevisionId: null, enabled: false }
        },
        listarRevisoes: async (id) => {
          chamadas.push({ nome: 'listarRevisoes', id })
          return [{ id: 1, revision: 1, status: 'active', document: { id } }]
        },
        obterRevisao: async (id, rev) => {
          chamadas.push({ nome: 'obterRevisao', id, rev })
          return {
            id: 1,
            automationId: id,
            revision: Number(rev),
            status: 'active',
            document: montarDocumentoValido(id, 'p1')
          }
        }
      }
    },
    instancias: { listar: () => [] },
    acervo: { listar: () => ({ files: [] }) }
  }

  const { servidor, fechar, port } = await iniciarServidorWeb({ host: '127.0.0.1', port: 0, aplicacao: aplicacaoFake })
  const base = `http://127.0.0.1:${port}`

  try {
    // 3.1 POST /automations/:id/unpublish
    const rUnpublish = await fetch(`${base}/api/v1/automations/diagpagina/unpublish`, { method: 'POST' })
    check('HTTP: POST /unpublish responde 200', rUnpublish.status === 200)
    check('HTTP: POST /unpublish delega com o id correto',
      chamadas.some((c) => c.nome === 'despublicar' && c.id === 'diagpagina'))

    // 3.2 DELETE /automations/:id
    const rDelete = await fetch(`${base}/api/v1/automations/diagpagina`, { method: 'DELETE' })
    check('HTTP: DELETE /automations/:id responde 200', rDelete.status === 200)
    check('HTTP: DELETE /automations/:id delega com o id correto',
      chamadas.some((c) => c.nome === 'remover' && c.id === 'diagpagina'))

    // 3.3 GET /automations/:id/revisions
    const rRevs = await fetch(`${base}/api/v1/automations/diagpagina/revisions`)
    check('HTTP: GET /revisions responde 200', rRevs.status === 200)
    check('HTTP: GET /revisions delega com o id correto',
      chamadas.some((c) => c.nome === 'listarRevisoes' && c.id === 'diagpagina'))

    // 3.4 GET /automations/:id/revisions/:rev
    const rRev = await fetch(`${base}/api/v1/automations/diagpagina/revisions/1`)
    check('HTTP: GET /revisions/:rev responde 200', rRev.status === 200)
    const revCorpo = await rRev.json()
    check('HTTP: GET /revisions/:rev devolve texto descompilado em .lcn',
      typeof revCorpo.texto === 'string' && revCorpo.texto.includes('automação diagpagina'))

    // 3.5 Erro 409 em DELETE repassa status HTTP 409 e mensagem intacta
    aplicacaoFake.motor.automacoes.remover = async () => {
      const err = new Error('Esta automação já executou 1 vez(es) e o histórico dessas execuções depende dela.')
      err.status = 409
      throw err
    }
    const r409 = await fetch(`${base}/api/v1/automations/diagpagina`, { method: 'DELETE' })
    check('HTTP: erro 409 ao apagar é repassado com status 409', r409.status === 409)
    const corpo409 = await r409.json()
    check('HTTP: mensagem explicativa é preservada no corpo',
      corpo409.error.includes('histórico dessas execuções depende dela'))
  } finally {
    await fechar()
  }
}

// ============================================================================
// 4. MOTOR REAL COM BANCO SQLITE (EM MEMÓRIA)
// ============================================================================
{
  const db = abrirBanco(':memory:')
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('pool-teste', 'Pool Teste', agora, agora)

  const servico = criarServicoAutomacoes(db)
  const roteador = criarRoteador()
  registrarRotasAutomations(roteador, db)

  const doc = montarDocumentoValido('diagpagina', 'pool-teste')

  // Cria e publica a automação
  servico.criarEPublicar({ id: 'diagpagina', document: doc })
  const automacaoCriada = db.prepare('SELECT * FROM automations WHERE id = ?').get('diagpagina')
  check('motor db: automação criada com active_revision_id', Boolean(automacaoCriada.active_revision_id))

  // 4.1 Despublicar tira do ar e deixa active_revision_id nulo
  const respostaDespublicar = servico.despublicar('diagpagina')
  check('motor db: despublicar limpa activeRevisionId', respostaDespublicar.activeRevisionId === null)
  check('motor db: despublicar desliga a automação', respostaDespublicar.enabled === false)
  const revDespublicada = db.prepare('SELECT status FROM automation_revisions WHERE automation_id = ?').get('diagpagina')
  check('motor db: revisão vira inactive após despublicar', revDespublicada.status === 'inactive')

  // 4.2 Apagar sem execuções funciona
  const respostaApagarSemExec = await roteador.resolver('DELETE', '/automations/diagpagina', { params: { id: 'diagpagina' } })
  check('motor db: apagar sem execuções remove do banco', respostaApagarSemExec.removed === true)
  check('motor db: automação sumiu da tabela', !db.prepare('SELECT * FROM automations WHERE id = ?').get('diagpagina'))

  // 4.3 Cria novamente e avalia evento real pelo motor (caminho de produção que grava automation_runs)
  servico.criarEPublicar({ id: 'diagpagina', document: doc })
  db.prepare("UPDATE automations SET deployment_mode = 'live' WHERE id = ?").run('diagpagina')
  avaliarEvento(db, {
    provider: 'zapo',
    accountId: 'conta-1',
    eventId: 'evt-1',
    occurredAt: agora,
    replay: false,
    chat: { id: '5511999999999@s.whatsapp.net', kind: 'direct' },
    sender: { id: '5511999999999@s.whatsapp.net', authoredBySelf: false },
    message: { kind: 'text', text: '/diagpagina' },
    providerRef: { provider: 'zapo', id: 'm1' }
  })

  // Tentativa de apagar tem que bater em 409
  let erroMotorAoApagar = null
  try {
    await roteador.resolver('DELETE', '/automations/diagpagina', { params: { id: 'diagpagina' } })
  } catch (e) {
    erroMotorAoApagar = e
  }

  check('motor db: recusa apagar com 409 quando há execução histórica', erroMotorAoApagar?.status === 409)
  check('motor db: mensagem do motor cita 1 vez(es)', erroMotorAoApagar?.message.includes('1 vez(es)'))
  check('motor db: mensagem do motor manda Tirar do ar', erroMotorAoApagar?.message.includes('"Tirar do ar"'))

  // A lógica de tela analisa o erro do motor e oferece tirar do ar
  const analise = analisarErroApagar(erroMotorAoApagar)
  check('integração: tela reconhece bloqueio e oferece Tirar do ar', analise.bloqueadoPorHistorico && analise.podeTirarDoAr)

  // Despublicar funciona e preserva a execução
  const despubComHistorico = await roteador.resolver('POST', '/automations/diagpagina/unpublish', { params: { id: 'diagpagina' } })
  check('motor db: despublicar funciona mesmo com histórico', despubComHistorico.activeRevisionId === null)
  const runsPreservadas = db.prepare("SELECT COUNT(*) AS total FROM automation_runs WHERE automation_id = ? AND status != 'no_match'").get('diagpagina')
  check('motor db: histórico de execuções continua 100% intacto', runsPreservadas.total === 1)

  // Listar e obter revisões funcionam
  const listaRevisoes = await roteador.resolver('GET', '/automations/diagpagina/revisions', { params: { id: 'diagpagina' } })
  check('motor db: listar revisões devolve as revisões gravadas', listaRevisoes.length >= 1)
  const umaRevisao = await roteador.resolver('GET', '/automations/diagpagina/revisions/1', { params: { id: 'diagpagina', rev: '1' } })
  check('motor db: obter revisão específica devolve o documento gravado', umaRevisao.document.id === 'diagpagina')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS PASSARAM')
process.exit(falhas ? 1 : 0)
