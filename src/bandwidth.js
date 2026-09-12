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

async function aguardar (bucket, bytes) {
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
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(esperaMs, MAX_ESPERA_MS))))
  }
}

export const aguardarDownload = (bytes) => aguardar(downloadCfg, bytes)
export const aguardarUpload = (bytes) => aguardar(uploadCfg, bytes)
