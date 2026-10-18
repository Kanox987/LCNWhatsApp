// Inserir um trecho pronto no texto, como função pura.
//
// Pura e fora da tela de propósito: a conta de onde começa a linha, quanto
// recuo ela tem e onde o cursor fica depois é exatamente o tipo de coisa que
// erra por um caractere, e um erro aqui quebra o texto de quem confiou no
// botão. Fora do DOM, isto se testa sem navegador.
//
// A indentação importa na linguagem (2 espaços = 1 nível), então o trecho
// entra com o recuo DA LINHA onde o cursor está: inserir uma ação dentro de um
// `se` tem de manter o nível do ramo, não voltar para a margem.

/** O começo da linha que contém `posicao`. */
function inicioDaLinha (texto, posicao) {
  const anterior = texto.lastIndexOf('\n', Math.max(0, posicao - 1))
  return anterior === -1 ? 0 : anterior + 1
}

/** O recuo da linha que contém `posicao`. */
export function recuoDaLinha (texto, posicao) {
  const inicio = inicioDaLinha(texto, posicao)
  const fim = texto.indexOf('\n', inicio)
  const linha = texto.slice(inicio, fim === -1 ? texto.length : fim)
  return linha.match(/^[ ]*/)[0]
}

/**
 * Insere `trecho` no começo da linha do cursor, com o recuo dela.
 *
 * @param {string} texto O texto inteiro.
 * @param {number} posicao Onde está o cursor.
 * @param {string} trecho O trecho, escrito a partir da margem.
 * @returns {{texto: string, posicao: number}} O texto novo e onde deixar o
 *   cursor: no FIM do que foi inserido, que é de onde a pessoa continua.
 */
export function inserirTrecho (texto, posicao, trecho) {
  const base = String(texto ?? '')
  const corte = Math.max(0, Math.min(Number(posicao) || 0, base.length))
  const inicio = inicioDaLinha(base, corte)
  const recuo = recuoDaLinha(base, corte)

  const comRecuo = String(trecho ?? '')
    .split('\n')
    // Linha vazia fica VAZIA, sem o recuo: espaço solto no fim da linha é
    // sujeira que a próxima leitura do texto mostra como diferença.
    .map((l) => (l === '' ? '' : recuo + l))
    .join('\n')

  // A linha onde o cursor estava continua abaixo do trecho, inteira. Substituir
  // o que estava ali apagaria texto que ninguém pediu para apagar.
  const antes = base.slice(0, inicio)
  const depois = base.slice(inicio)
  // Sem a quebra, o trecho e a linha de baixo viram uma linha só, e a linguagem
  // é sensível a linha.
  const inserido = `${comRecuo}\n`
  return { texto: antes + inserido + depois, posicao: inicio + inserido.length - 1 }
}
