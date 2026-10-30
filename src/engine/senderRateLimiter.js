// Token bucket per sender. In-memory only — resets on process restart.
// Fail-open by design: if the limiter itself throws, the message passes.

export const PADRAO = Object.freeze({
  maxTokens: 5,          // burst capacity: 5 messages instantly
  refillRate: 1,         // tokens per second
  refillIntervalMs: 1000 // granularity of refill
})

/**
 * @param {Object} cfg - hardware.senderRateLimit from config
 * @returns {{ verificar: (senderId: string) => boolean, resetar: (senderId?: string) => void, estado: () => Map }}
 */
export function criarSenderRateLimiter (cfg = {}) {
  const maxTokens = Number.isFinite(cfg.maxTokens) && cfg.maxTokens >= 1
    ? Math.floor(cfg.maxTokens) : PADRAO.maxTokens
  const refillRate = Number.isFinite(cfg.refillRate) && cfg.refillRate > 0
    ? cfg.refillRate : PADRAO.refillRate
  const refillIntervalMs = Number.isFinite(cfg.refillIntervalMs) && cfg.refillIntervalMs >= 100
    ? Math.floor(cfg.refillIntervalMs) : PADRAO.refillIntervalMs

  // maxTokens === 0 disables the limiter entirely
  const desativado = Number.isFinite(cfg.maxTokens) && cfg.maxTokens === 0

  const buckets = new Map() // senderId -> { tokens: number, lastRefill: number }

  function obterBucket (senderId) {
    let bucket = buckets.get(senderId)
    const agora = Date.now()
    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: agora }
      buckets.set(senderId, bucket)
      return bucket
    }
    // Refill based on elapsed time
    const decorrido = agora - bucket.lastRefill
    if (decorrido >= refillIntervalMs) {
      const intervalos = Math.floor(decorrido / refillIntervalMs)
      const novosTokens = intervalos * refillRate
      bucket.tokens = Math.min(maxTokens, bucket.tokens + novosTokens)
      bucket.lastRefill += intervalos * refillIntervalMs
    }
    return bucket
  }

  function verificar (senderId) {
    try {
      if (desativado) return true
      if (!senderId) return true
      const bucket = obterBucket(senderId)
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        return true
      }
      return false
    } catch {
      // Fail-open: any internal error allows the message through
      return true
    }
  }

  function resetar (senderId) {
    try {
      if (senderId) {
        buckets.delete(senderId)
      } else {
        buckets.clear()
      }
    } catch {}
  }

  function estado () {
    try {
      const snapshot = new Map()
      for (const [id, bucket] of buckets) {
        snapshot.set(id, { tokens: bucket.tokens, lastRefill: bucket.lastRefill })
      }
      return snapshot
    } catch {
      return new Map()
    }
  }

  return { verificar, resetar, estado }
}