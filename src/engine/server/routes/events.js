import { ErroHttp, resposta } from '../transport.js'
import { avaliarEvento, registrarResultadoExecucao } from '../evaluator.js'

export function registrarRotasEvents (roteador, db) {
  roteador.post('/events', ({ body }) => {
    if (!body || typeof body !== 'object') throw new ErroHttp(400, 'Informe o evento canônico no corpo.')
    return resposta(201, avaliarEvento(db, body))
  })

  roteador.post('/executions/:id/result', ({ params, body }) => {
    return registrarResultadoExecucao(db, params.id, body || {})
  })
}
