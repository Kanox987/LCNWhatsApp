import { ErroHttp } from '../transport.js'
import { compactar, contar, ErroDeRetencao, gravarRetencao, lerRetencao, varrer } from '../retencao.js'

export function registrarRotasRetencao (roteador, db) {
  // O estado: a janela que vale, se ela é o padrão, e o tamanho do histórico.
  // A tela mostra os dois juntos porque "72 horas" não quer dizer nada sem
  // "e isso apagaria 451 mil linhas".
  roteador.get('/retencao', () => ({ ...lerRetencao(db), ...contar(db) }))

  roteador.put('/retencao', ({ body }) => {
    try {
      const salvo = gravarRetencao(db, { horas: body?.horas })
      return { ...salvo, ...contar(db) }
    } catch (erro) {
      if (erro instanceof ErroDeRetencao) throw new ErroHttp(400, erro.message)
      throw erro
    }
  })

  // Varrer AGORA, sem esperar a hora cheia. Serve para a primeira limpeza (que
  // é a grande) e para conferir o efeito de uma janela nova na hora de mudá-la.
  //
  // `compactar` é pedido à parte porque reescreve o banco inteiro: é o que
  // devolve o disco depois de uma varredura grande, e não é o que se quer em
  // toda passada.
  roteador.post('/retencao/varrer', ({ body }) => {
    try {
      const apagado = varrer(db, body?.horas === undefined || body?.horas === null ? {} : { horas: body.horas })
      const disco = body?.compactar ? compactar(db) : null
      return { apagado, ...(disco ? { disco } : {}), ...contar(db) }
    } catch (erro) {
      if (erro instanceof ErroDeRetencao) throw new ErroHttp(400, erro.message)
      throw erro
    }
  })
}
