// Módulo 4 da Etapa 4.5 — tabela de rotas do BFF local. TODA a lógica de
// negócio mora em `src/agent/application.js` (instâncias/diretório) ou no
// motor via `aplicacao.motor` (automações/pools/conexões/execuções,
// Módulos 1/2) — este arquivo só faz o mapeamento HTTP → chamada de método,
// de propósito explícito rota por rota (nunca um proxy cru de path pro
// motor) pra manter controlado o que o navegador pode alcançar.
import { criarRoteador, resposta } from '../engine/server/transport.js'
import { respostaBinaria } from './binario.js'

function queryObjeto (query) {
  return Object.fromEntries(query.entries())
}

export function criarRoteadorWeb (aplicacao) {
  const roteador = criarRoteador()
  const automacoes = () => aplicacao.motor.automacoes
  const pools = () => aplicacao.motor.pools
  const conexoes = () => aplicacao.motor.conexoes
  const execucoes = () => aplicacao.motor.execucoes
  const entidades = () => aplicacao.motor.entidades
  const meta = () => aplicacao.motor.meta
  const templates = () => aplicacao.motor.templates

  // Saúde do BFF em si + do motor por trás — nunca lança 500 só porque o
  // motor está fora do ar (mesmo espírito de "motor não está rodando" que
  // o client.js já trata em vez de travar/quebrar).
  roteador.get('/api/v1/health', async () => {
    try {
      await aplicacao.motor.saude()
      return { web: 'ok', engine: 'ok' }
    } catch (erro) {
      return resposta(200, { web: 'ok', engine: 'down', reason: erro.message })
    }
  })

  // --- instâncias: ciclo de vida real e otimização (agente/data plane) ---
  roteador.get('/api/v1/instances', () => aplicacao.instancias.listar())

  // Acervo de arquivos. `/content` é a única rota do painel que devolve bytes
  // em vez de JSON — os cabeçalhos que protegem isso estão em binario.js.
  roteador.get('/api/v1/media', () => aplicacao.acervo.listar())
  roteador.post('/api/v1/media', ({ body }) => aplicacao.acervo.enviar(body))
  roteador.get('/api/v1/media/:id/content', ({ params }) => respostaBinaria(aplicacao.acervo.conteudo(params.id)))
  roteador.put('/api/v1/media/:id', ({ params, body }) => aplicacao.acervo.descrever(params.id, body?.description))
  roteador.delete('/api/v1/media/:id', ({ params }) => aplicacao.acervo.remover(params.id))
  roteador.get('/api/v1/instances/:id', ({ params }) => aplicacao.instancias.obter(params.id))
  roteador.post('/api/v1/instances/:id/start', ({ params }) => aplicacao.instancias.iniciar(params.id))
  roteador.post('/api/v1/instances/:id/stop', ({ params }) => aplicacao.instancias.parar(params.id))
  roteador.post('/api/v1/instances/:id/restart', ({ params }) => aplicacao.instancias.reiniciar(params.id))
  roteador.get('/api/v1/instances/:id/pairing', ({ params }) => aplicacao.instancias.pareamento(params.id))
  roteador.get('/api/v1/instances/:id/optimization', ({ params }) => aplicacao.instancias.obterOtimizacao(params.id))
  roteador.put('/api/v1/instances/:id/optimization', ({ params, body }) => aplicacao.instancias.definirOtimizacao(params.id, body))
  roteador.get('/api/v1/instances/:id/usage', ({ params }) => aplicacao.instancias.obterUso(params.id))
  roteador.get('/api/v1/instances/:id/logs', ({ params, query }) => aplicacao.instancias.obterLogs(params.id, Number(query.get('lines'))))
  roteador.get('/api/v1/instances/:id/directory', ({ params, query }) => aplicacao.diretorio.listar(params.id, queryObjeto(query)))

  // --- automações (Módulo 1) ---
  roteador.get('/api/v1/meta/automation-editor', () => automacoes().obterMeta())
  roteador.get('/api/v1/automations', () => automacoes().listar())
  roteador.post('/api/v1/automations', ({ body }) => automacoes().criar(body))
  roteador.get('/api/v1/automations/:id', ({ params }) => automacoes().obter(params.id))
  roteador.delete('/api/v1/automations/:id', ({ params }) => automacoes().remover(params.id))
  roteador.get('/api/v1/automations/:id/revisions', ({ params }) => automacoes().listarRevisoes(params.id))
  roteador.get('/api/v1/automations/:id/revisions/:rev', ({ params }) => automacoes().obterRevisao(params.id, params.rev))
  roteador.put('/api/v1/automations/:id/draft', ({ params, body, req }) => automacoes().salvarRascunho(params.id, body, req?.headers?.['if-match']))
  roteador.post('/api/v1/automations/:id/validate', ({ params, body }) => automacoes().validar(params.id, body))
  roteador.post('/api/v1/automations/:id/publish', ({ params, body }) => automacoes().publicar(params.id, body?.revision))
  roteador.post('/api/v1/automations/:id/unpublish', ({ params }) => automacoes().despublicar(params.id))
  roteador.put('/api/v1/automations/:id/enabled', ({ params, body }) => automacoes().definirHabilitada(params.id, body?.enabled))
  roteador.put('/api/v1/automations/:id/deployment-mode', ({ params, body }) => automacoes().definirModo(params.id, body?.mode))
  roteador.get('/api/v1/automations/:id/provenance', ({ params }) => automacoes().obterProvenance(params.id))

  // --- pools (coordenação multi-bot) ---
  roteador.get('/api/v1/pools', () => pools().listar())
  roteador.post('/api/v1/pools', ({ body }) => pools().criar(body))
  roteador.get('/api/v1/pools/:id', ({ params }) => pools().obter(params.id))
  roteador.put('/api/v1/pools/:id', ({ params, body }) => pools().atualizar(params.id, body))
  roteador.delete('/api/v1/pools/:id', ({ params }) => pools().remover(params.id))
  roteador.put('/api/v1/pools/:id/members/:instanceId', ({ params, body }) => pools().salvarMembro(params.id, params.instanceId, body))
  roteador.delete('/api/v1/pools/:id/members/:instanceId', ({ params }) => pools().removerMembro(params.id, params.instanceId))

  // --- conexões (segredos de integração — nunca devolvidos em claro pelo motor) ---
  roteador.get('/api/v1/connections', () => conexoes().listar())
  roteador.post('/api/v1/connections', ({ body }) => conexoes().criar(body))
  roteador.get('/api/v1/connections/:id', ({ params }) => conexoes().obter(params.id))
  roteador.put('/api/v1/connections/:id', ({ params, body }) => conexoes().atualizar(params.id, body))
  roteador.delete('/api/v1/connections/:id', ({ params }) => conexoes().remover(params.id))

  // --- execuções (Módulo 2, histórico/erros pro painel) ---
  roteador.get('/api/v1/executions', ({ query }) => execucoes().listar(queryObjeto(query)))
  roteador.get('/api/v1/executions/:runId', ({ params }) => execucoes().obter(params.runId))

  // --- variáveis (Parte C, Módulo 1) ---
  roteador.get('/api/v1/meta/variables', () => meta().obterVariaveis())
  roteador.get('/api/v1/entities/:kind/:id/attributes', ({ params }) => entidades().listar(params.kind, params.id))
  roteador.put('/api/v1/entities/:kind/:id/attributes/:key', ({ params, body }) => entidades().definir(params.kind, params.id, params.key, body?.value))
  roteador.delete('/api/v1/entities/:kind/:id/attributes/:key', ({ params }) => entidades().remover(params.kind, params.id, params.key))

  // --- catálogo de comandos/templates (Parte C, Módulo 4) ---
  roteador.get('/api/v1/templates', () => templates().listar())
  roteador.get('/api/v1/templates/:id', ({ params }) => templates().obter(params.id))
  roteador.post('/api/v1/templates/:id/install', ({ params, body }) => templates().instalar(params.id, body))

  return roteador
}
