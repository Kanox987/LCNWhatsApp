// mediaRef pode carregar segredo de verdade (mediaKey, fileEncSha256,
// directPath do node cru) e NUNCA pode ser serializado pro motor — o motor
// roda como processo separado (Parte B, Etapa 2+), então "opaco pro motor"
// só é garantido de verdade se o valor que atravessa essa fronteira for um
// token que só o PRÓPRIO gateway sabe resolver, nunca o objeto em si.
//
// Cache em memória por processo (não em disco, não compartilhado) — cada
// gateway resolve só os próprios tokens. TTL curto porque isto existe só
// pra cobrir a janela entre "evento canônico foi emitido" e "motor decidiu
// agir sobre aquela mídia" — não é armazenamento de longo prazo.
import crypto from 'crypto'

const TTL_MS = 5 * 60 * 1000
const cache = new Map() // token -> { valor, expiraEm }

let intervaloVarredura = null

function iniciarVarredura () {
  if (intervaloVarredura) return
  intervaloVarredura = setInterval(() => {
    const agora = Date.now()
    for (const [token, entrada] of cache) {
      if (entrada.expiraEm <= agora) cache.delete(token)
    }
  }, 60 * 1000)
  intervaloVarredura.unref?.() // não deve manter o processo vivo sozinho
}

export function criar (valor, ttlMs = TTL_MS) {
  iniciarVarredura()
  const token = crypto.randomUUID()
  cache.set(token, { valor, expiraEm: Date.now() + ttlMs })
  return token
}

export function resolver (token) {
  const entrada = cache.get(token)
  if (!entrada) return null
  if (entrada.expiraEm <= Date.now()) {
    cache.delete(token)
    return null
  }
  return entrada.valor
}

// Só pra teste — evita que o setInterval real vaze estado entre casos.
export function _reiniciarParaTeste () {
  cache.clear()
  if (intervaloVarredura) { clearInterval(intervaloVarredura); intervaloVarredura = null }
}
