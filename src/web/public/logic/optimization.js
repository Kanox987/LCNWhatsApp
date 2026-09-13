const UNITS = new Map([
  ['b/s', 1],
  ['kb/s', 1000],
  ['mb/s', 1000 ** 2],
  ['gb/s', 1000 ** 3],
  ['kib/s', 1024],
  ['mib/s', 1024 ** 2],
  ['gib/s', 1024 ** 3]
])

const UNLIMITED = new Set(['sem limite', 'ilimitado', 'ilimitada', '0'])

export function parseBandwidth (input) {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) throw new Error('Use um valor de banda válido.')
    return input
  }
  if (typeof input !== 'string') throw new Error('Informe a banda, por exemplo 500 KB/s, ou sem limite.')
  const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (UNLIMITED.has(normalized)) return 0
  const match = normalized.match(/^(\d+(?:[.,]\d+)?)\s*(b\/s|kb\/s|mb\/s|gb\/s|kib\/s|mib\/s|gib\/s)$/i)
  if (!match) throw new Error('Use uma unidade como KB/s, MB/s ou MiB/s; para liberar, escreva sem limite.')
  const amount = Number(match[1].replace(',', '.'))
  const result = Math.round(amount * UNITS.get(match[2].toLowerCase()))
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('O limite de banda informado é grande demais.')
  return result
}

// Formata uma quantidade TOTAL de bytes (não uma taxa) — painel de
// recursos (Parte C, Módulo 6). Diferente de formatBandwidth, um total
// acumulado raramente é um múltiplo exato de uma unidade, então arredonda
// pra 1 casa decimal em vez de exigir divisão exata.
export function formatBytes (totalBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes < 0) return '—'
  if (totalBytes < 1000) return `${Math.round(totalBytes)} B`
  const units = [['GB', 1000 ** 3], ['MB', 1000 ** 2], ['KB', 1000]]
  for (const [label, factor] of units) {
    if (totalBytes >= factor) return `${(totalBytes / factor).toFixed(1)} ${label}`
  }
  return `${Math.round(totalBytes)} B`
}

export function formatBandwidth (bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return 'sem limite'
  const units = [
    ['GB/s', 1000 ** 3], ['MB/s', 1000 ** 2], ['KB/s', 1000],
    ['GiB/s', 1024 ** 3], ['MiB/s', 1024 ** 2], ['KiB/s', 1024]
  ]
  for (const [label, factor] of units) {
    if (bytesPerSecond >= factor && bytesPerSecond % factor === 0) return `${bytesPerSecond / factor} ${label}`
  }
  return `${Math.round(bytesPerSecond)} B/s`
}
