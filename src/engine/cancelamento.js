import { AsyncLocalStorage } from 'node:async_hooks'
import { setTimeout as esperar } from 'node:timers/promises'

// O evento é o dono do trabalho externo, mesmo quando a prioridade muda
// entre comandos. Um sinal por evento evita cancelar outra conversa quando
// uma fila recusa trabalho; send e upload nunca consultam este contexto.
const contextoDoEvento = new AsyncLocalStorage()

export const comEvento = (controle, tarefa) => contextoDoEvento.run(controle, tarefa)
export const sinalDoEvento = () => contextoDoEvento.getStore()?.signal

export function erroDeCancelamento (motivo, recurso = 'admissao') {
  const mensagem = motivo === 'desligamento'
    ? 'Trabalho externo cancelado por desligamento da instância.'
    : `Trabalho externo cancelado por recusa na admissão (${recurso}).`
  return Object.assign(new Error(mensagem), { code: 'LCN_CANCELADO', motivo, recurso })
}

export function cancelarTrabalhoExterno (motivo, recurso) {
  contextoDoEvento.getStore()?.abort(erroDeCancelamento(motivo, recurso))
}

export function erroDeTimeoutExterno (ms, recurso) {
  // Este relógio vence antes de qualquer envio. Usar o código do timeout do
  // socket produziria outcome_unknown para um arquivo que nem foi recebido.
  return Object.assign(new Error(`timeout após ${ms}ms no trabalho externo (${recurso}).`), {
    code: 'LCN_TIMEOUT_EXTERNO', motivo: 'timeout', recurso
  })
}

export function combinarComEvento (signal) {
  const externo = sinalDoEvento()
  return externo ? AbortSignal.any([externo, signal]) : signal
}

export const dormirComSinal = (ms, signal) => esperar(ms, undefined, { signal })

export async function esperarNoEvento (ms, dormir = dormirComSinal) {
  const signal = sinalDoEvento()
  signal?.throwIfAborted()
  let abortar
  try {
    // A espera injetada também pode ser interrompida. Na implementação real,
    // o mesmo sinal limpa o timer; o listener abaixo é retirado em todo fim.
    const espera = Promise.resolve().then(() => dormir(ms, signal))
    if (!signal) return await espera
    return await Promise.race([espera, new Promise((_, rejeitar) => {
      abortar = () => rejeitar(signal.reason)
      signal.addEventListener('abort', abortar, { once: true })
      if (signal.aborted) abortar()
    })])
  } catch (erro) {
    throw signal?.aborted ? signal.reason : erro
  } finally {
    if (abortar) signal.removeEventListener('abort', abortar)
  }
}
