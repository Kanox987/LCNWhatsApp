import { ErroHttp, resposta } from '../transport.js'

// O gateway RELATA; o motor GRAVA.
//
// Estas duas rotas existem para manter a fronteira de pé. O gateway é quem vê
// a enquete nascer e os votos chegarem — é ele que está no socket. Mas quem
// tem banco é o motor, e a alternativa em cima da mesa era dar um SQLite
// próprio ao gateway: dois bancos para manter, migrar e sincronizar, com a
// camada de protocolo virando aplicação.
//
// Então o gateway conta o que viu, e não escreve nada.
export function registrarRotasEnquetes (roteador, enquetes) {
  // Nasceu uma enquete na conversa — do bot ou de qualquer pessoa.
  //
  // É o ÚNICO momento em que os nomes das opções passam em claro: o voto que
  // chega depois traz o SHA-256 de um deles. Sem este relato, o voto é um
  // código que não vira resposta para ninguém.
  roteador.post('/enquetes', ({ body }) => {
    const pollId = typeof body?.pollId === 'string' ? body.pollId.trim() : ''
    if (!pollId) throw new ErroHttp(400, 'Campo obrigatório: pollId.')
    const opcoes = Array.isArray(body?.opcoes) ? body.opcoes : []
    if (opcoes.length < 2) throw new ErroHttp(400, 'Uma enquete precisa de pelo menos duas opções.')
    const gravadas = enquetes.anotarEnquete({ pollId, chatId: body?.chatId, opcoes })
    return resposta(201, { pollId, opcoes: gravadas })
  })

  // Alguém votou. O corpo traz o estado COMPLETO da escolha daquela pessoa,
  // porque é assim que o WhatsApp manda — não é um incremento.
  roteador.post('/enquetes/:id/votos', ({ params, body }) => {
    const eleitor = typeof body?.eleitor === 'string' ? body.eleitor.trim() : ''
    if (!eleitor) throw new ErroHttp(400, 'Campo obrigatório: eleitor.')
    const hashes = Array.isArray(body?.hashes) ? body.hashes : []
    const anotado = enquetes.anotarVoto({ pollId: params.id, eleitor, hashes })
    // Enquete que o motor não viu nascer não tem mapa de opções. Recusar aqui
    // é melhor que guardar hash que nunca vira resposta — e o gateway não tem
    // o que fazer com o erro de qualquer forma, então 200 com `anotado: false`
    // diz a verdade sem transformar um voto perdido em falha de entrega.
    return { pollId: params.id, anotado }
  })
}
