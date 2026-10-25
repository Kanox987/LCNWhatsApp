const BURST_SEGUNDOS = 2
const MAX_ESPERA_MS = 1000

function criarBucket () {
  return { taxa: 0, tokens: 0, ultimoTs: Date.now() }
}

const downloadCfg = criarBucket()
const uploadCfg = criarBucket()

function normalizarTaxa (valor) {
  const taxa = Number(valor)
  return Number.isFinite(taxa) && taxa > 0 ? taxa : 0
}

function refill (bucket, agora = Date.now()) {
  if (!bucket.taxa) {
    bucket.ultimoTs = agora
    return
  }
  const decorridoMs = Math.max(0, agora - bucket.ultimoTs)
  bucket.tokens = Math.min(
    bucket.taxa * BURST_SEGUNDOS,
    bucket.tokens + (decorridoMs / 1000) * bucket.taxa
  )
  bucket.ultimoTs = agora
}

function configurarBucket (bucket, valor) {
  const agora = Date.now()
  refill(bucket, agora)

  const taxa = normalizarTaxa(valor)
  if (taxa === bucket.taxa) return

  bucket.taxa = taxa
  bucket.tokens = taxa ? Math.min(bucket.tokens, taxa * BURST_SEGUNDOS) : 0
  bucket.ultimoTs = agora
}

export function configurar ({ downloadBytesPerSecond, uploadBytesPerSecond } = {}) {
  configurarBucket(downloadCfg, downloadBytesPerSecond)
  configurarBucket(uploadCfg, uploadBytesPerSecond)
}

async function aguardar (bucket, bytes, signal) {
  let restante = Number(bytes)
  if (!Number.isFinite(restante) || restante <= 0 || !bucket.taxa) return

  for (;;) {
    if (!bucket.taxa) return
    refill(bucket)

    // Quita em parcelas porque uma transferência maior que o burst nunca
    // caberia inteira no bucket e, sem isso, esperaria para sempre.
    const consumidos = Math.min(bucket.tokens, restante)
    bucket.tokens -= consumidos
    restante -= consumidos
    if (restante <= 0) return

    const esperaMs = Math.ceil((restante / bucket.taxa) * 1000)
    // Só a leitura recebe sinal. O limitador de upload continua aguardando
    // normalmente, pois abortá-lo poderia interromper um envio já iniciado.
    await new Promise((resolve, reject) => {
      const abortar = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abortar)
        resolve()
      }, Math.max(1, Math.min(esperaMs, MAX_ESPERA_MS)))
      signal?.addEventListener('abort', abortar, { once: true })
      if (signal?.aborted) { signal.removeEventListener('abort', abortar); abortar() }
    })
  }
}

export const aguardarDownload = (bytes, signal) => aguardar(downloadCfg, bytes, signal)
export const aguardarUpload = (bytes) => aguardar(uploadCfg, bytes)
