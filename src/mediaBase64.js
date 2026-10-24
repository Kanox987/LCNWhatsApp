const BASE64_VALIDO = /^[A-Za-z0-9+/]+={0,2}$/

export function decodificarBase64 (bruto, limiteBytes, reservar = () => {}) {
  if (!Number.isSafeInteger(limiteBytes) || limiteBytes <= 0) throw new Error('Limite de mídia inválido: a decodificação precisa de um teto finito.')
  if (typeof bruto !== 'string' || !bruto) throw new Error('Conteúdo do arquivo inválido ou vazio.')
  // Espaços também ocupam memória. Recusar o comprimento BRUTO antes do
  // replace impede que uma entrada enorme aloque outra string só para falhar.
  const limiteCodificado = 4 * Math.ceil(limiteBytes / 3)
  if (bruto.length > limiteCodificado) throw new Error('Arquivo grande demais: o conteúdo base64 excede o limite de mídia.')
  const limpo = bruto.replace(/\s+/g, '')
  if (!limpo || limpo.length % 4 !== 0 || !BASE64_VALIDO.test(limpo)) throw new Error('Conteúdo do arquivo inválido ou vazio.')
  const bytes = limpo.length / 4 * 3 - (limpo.endsWith('==') ? 2 : limpo.endsWith('=') ? 1 : 0)
  // O arredondamento do base64 pode esconder até dois bytes além do teto.
  // A reserva acontece só depois do formato válido, mas antes de Buffer.from.
  if (bytes > limiteBytes) throw new Error('Arquivo grande demais: o conteúdo decodificado excede o limite de mídia.')
  reservar(bytes)
  return Buffer.from(limpo, 'base64')
}
