// Ponte fail-open entre o gateway e o motor. O timeout fica aqui, e não no
// client HTTP compartilhado, para não impor o prazo curto da captura às
// operações interativas do dashboard/CLI que usam o mesmo cliente.
function motivoDaFalha (erro) {
  try {
    return erro instanceof Error ? erro.message : String(erro || 'falha desconhecida')
  } catch {
    return 'falha desconhecida'
  }
}

export async function enviarEventoAoMotor (cliente, eventoCanonico, { timeoutMs = 1500 } = {}) {
  let timer
  try {
    const envio = Promise.resolve().then(() => cliente.eventos.enviar(eventoCanonico))
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ timeout: true }), Math.max(0, timeoutMs))
    })
    const resultado = await Promise.race([
      envio.then((resposta) => ({ resposta }), (erro) => ({ erro })),
      timeout
    ])

    if (resultado.timeout) return { ok: false, motivo: `timeout após ${timeoutMs}ms` }
    if (resultado.erro) return { ok: false, motivo: motivoDaFalha(resultado.erro) }
    return { ok: true, results: Array.isArray(resultado.resposta?.results) ? resultado.resposta.results : [] }
  } catch (erro) {
    // Também cobre cliente/mocks malformados e exceções síncronas.
    return { ok: false, motivo: motivoDaFalha(erro) }
  } finally {
    clearTimeout(timer)
  }
}
