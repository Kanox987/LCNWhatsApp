const MB = 1024 * 1024

function emBytes (valor, padraoMB) {
  const n = Number(valor)
  const bytes = Math.floor(n * MB)
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : padraoMB * MB
}

export function limitesDeMidia (cfg) {
  // Ausente continua protegido. O limite específico não pode furar o teto
  // geral, e aumentar só o teto geral não altera a escolha do downloader.
  const geral = emBytes(cfg?.hardware?.maxMidiaMB, 64)
  return {
    geral,
    downloadConcorrencia: Number.isSafeInteger(cfg?.hardware?.downloadConcorrencia) && cfg.hardware.downloadConcorrencia > 0
      ? cfg.hardware.downloadConcorrencia : 2,
    download: Math.min(geral, emBytes(cfg?.download?.limiteMB, 64)),
    // O álbum fica vivo até a entrega: limitar cada arquivo não limita a
    // soma. Este padrão pode ser trocado em hardware.orcamentoMidiaMB.
    orcamento: emBytes(cfg?.hardware?.orcamentoMidiaMB, 256)
  }
}
