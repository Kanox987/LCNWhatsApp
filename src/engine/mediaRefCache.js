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
// Cada entrada guarda a mensagem inteira por 5 min. Só o TTL não limita a
// quantidade: um grupo que despeja mídia mais rápido do que ela expira faz o
// cache crescer sem teto. O padrão cobre ~66 mídias/s sustentadas; passou
// disso, sai a mais antiga (a mais perto de expirar de qualquer jeito) e o
// comando que a pedir recebe a mesma resposta de "mídia expirou".
const MAX_ENTRADAS_PADRAO = 20000
const cache = new Map() // token -> { valor, expiraEm }

function maxEntradas () {
  const n = Number(process.env.LCN_MAX_MEDIAREFS)
  return Number.isInteger(n) && n > 0 ? n : MAX_ENTRADAS_PADRAO
}

let intervaloVarredura = null

function descartar (token) {
  const entrada = cache.get(token)
  if (!entrada) return
  cache.delete(token)
  // Mídia produzida por uma conexão conserva a reserva enquanto o próximo
  // elo ainda pode usá-la. Expirar o token também devolve esses bytes.
  entrada.aoDescartar?.()
}

function iniciarVarredura () {
  if (intervaloVarredura) return
  intervaloVarredura = setInterval(() => {
    const agora = Date.now()
    for (const [token, entrada] of cache) {
      if (entrada.expiraEm <= agora) descartar(token)
    }
  }, 60 * 1000)
  intervaloVarredura.unref?.() // não deve manter o processo vivo sozinho
}

export function criar (valor, ttlMs = TTL_MS, aoDescartar = null) {
  iniciarVarredura()
  const token = crypto.randomUUID()
  cache.set(token, { valor, expiraEm: Date.now() + ttlMs, aoDescartar })
  const teto = maxEntradas()
  // O Map preserva a ordem de inserção: a primeira chave é a mais antiga.
  while (cache.size > teto) descartar(cache.keys().next().value)
  return token
}

export function resolver (token) {
  const entrada = cache.get(token)
  if (!entrada) return null
  if (entrada.expiraEm <= Date.now()) {
    descartar(token)
    return null
  }
  return entrada.valor
}

export function _tamanho () {
  return cache.size
}

// Só pra teste — evita que o setInterval real vaze estado entre casos.
export function _reiniciarParaTeste () {
  for (const token of cache.keys()) descartar(token)
  if (intervaloVarredura) { clearInterval(intervaloVarredura); intervaloVarredura = null }
}
