// Ponte fail-open entre o gateway e o motor. O timeout fica aqui, e não no
// client HTTP compartilhado, para não impor o prazo curto da captura às
// operações interativas do dashboard/CLI que usam o mesmo cliente.
import { combinarComEvento, erroDeTimeoutExterno } from './cancelamento.js'

function motivoDaFalha (erro) {
  try {
    return erro instanceof Error ? erro.message : String(erro || 'falha desconhecida')
  } catch {
    return 'falha desconhecida'
  }
}

export async function enviarEventoAoMotor (cliente, eventoCanonico, { timeoutMs = 1500 } = {}) {
  let timer
  let abortar
  const controlador = new AbortController()
  const signal = combinarComEvento(controlador.signal)
  try {
    signal.throwIfAborted()
    const envio = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return cliente.eventos.enviar(eventoCanonico, { signal })
    })
    const aborto = new Promise((resolve) => {
      abortar = () => resolve({ erro: signal.reason })
      signal.addEventListener('abort', abortar, { once: true })
      timer = setTimeout(() => {
        // Vencer a corrida não encerra HTTP: sem abortar, cada timeout soltava
        // uma vaga e deixava outra requisição viva fora do limite de admissão.
        controlador.abort(erroDeTimeoutExterno(timeoutMs, 'motor'))
      }, Math.max(0, timeoutMs))
    })
    const resultado = await Promise.race([
      envio.then((resposta) => ({ resposta }), (erro) => ({ erro })),
      aborto
    ])

    if (resultado.erro) return { ok: false, motivo: motivoDaFalha(signal.aborted ? signal.reason : resultado.erro) }
    return { ok: true, results: Array.isArray(resultado.resposta?.results) ? resultado.resposta.results : [] }
  } catch (erro) {
    // Também cobre cliente/mocks malformados e exceções síncronas.
    return { ok: false, motivo: motivoDaFalha(erro) }
  } finally {
    clearTimeout(timer)
    if (abortar) signal.removeEventListener('abort', abortar)
  }
}
