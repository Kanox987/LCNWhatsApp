// Em qual AÇÃO o cursor está, e em qual CAMPO dela — para a ajuda contextual.
//
// Por que isto existe: a referência da linguagem já descreve as 38 ações com
// tudo o que o pedido exige (nome, explicação, tipos, valores aceitos, padrão,
// obrigatoriedade, dependências, exemplo, resultado, erros comuns e limitação),
// e `/meta/linguagem` já a entrega ao navegador. Faltava a única pergunta que o
// servidor não pode responder: QUAL dessas 38 a pessoa está escrevendo agora.
// Essa pergunta é do editor, e a resposta depende do texto e do cursor.
//
// É função pura, sem DOM e sem rede, igual ao realce: assim roda em teste sem
// navegador, e assim nenhuma lista de palavras nasce aqui. As palavras chegam
// prontas em `acoes`, derivadas do vocabulário.
//
// A REGRA DE FRONTEIRA é importada de `realce.js` de propósito. Duas regras de
// "palavra inteira" divergiriam na primeira correção, e aí o editor acenderia
// uma ação e explicaria outra.
import { comecaCom } from './realce.js'

/**
 * Em qual linha (base 1) está a posição do cursor.
 *
 * Posição fora do texto é presa nas pontas em vez de devolver nada: o cursor
 * pode estar no fim de um texto que acabou de encolher.
 */
export function linhaDoCursor (texto, posicao = 0) {
  const t = String(texto ?? '')
  const p = Math.max(0, Math.min(t.length, Number(posicao) || 0))
  return t.slice(0, p).split('\n').length
}

// A ação da linha, se a linha ABRIR uma ação. Mais longa primeiro, como no
// compilador e no realce: "responde rico" tem de ganhar de "responde".
function acaoQueAbre (linha, acoes) {
  const resto = linha.replace(/^\s+/, '')
  if (!resto || resto.startsWith('#')) return null
  let achada = null
  for (const acao of acoes) {
    const palavra = acao?.palavra
    if (typeof palavra !== 'string' || !palavra) continue
    // `resto[palavra.length] !== ':'` repete o realce: "define:" não é a ação
    // `define`, é um campo com esse nome.
    if (!comecaCom(resto, palavra) || resto[palavra.length] === ':') continue
    if (!achada || palavra.length > achada.palavra.length) achada = acao
  }
  return achada
}

/**
 * A ajuda que cabe na posição do cursor.
 *
 * Sobe da linha do cursor até achar a linha que abre uma ação — a própria linha
 * conta. Se o cursor está no CABEÇALHO, acima de qualquer ação, não há ação e a
 * resposta é `null`: o painel então não fala, em vez de falar da ação errada.
 *
 * O campo sai da linha do cursor: ou é `chave:` declarada por aquela ação, ou é
 * o argumento escrito na mesma linha da ação (o `escrita: 'na mesma linha'` da
 * referência).
 *
 * @param {object} opcoes
 * @param {string} opcoes.texto O documento inteiro.
 * @param {number} opcoes.posicao `selectionStart` do textarea.
 * @param {Array} opcoes.acoes `referencia.acoes`, como vem de /meta/linguagem.
 * @returns {{acao: object, campo: object|null, linha: number}|null}
 */
export function ajudaNoCursor ({ texto = '', posicao = 0, acoes = [] } = {}) {
  const lista = Array.isArray(acoes) ? acoes : []
  if (lista.length === 0) return null
  const linhas = String(texto ?? '').split('\n')
  const linha = linhaDoCursor(texto, posicao)

  let acao = null
  let linhaDaAcao = 0
  for (let i = linha - 1; i >= 0; i--) {
    const achada = acaoQueAbre(linhas[i] ?? '', lista)
    if (achada) { acao = achada; linhaDaAcao = i + 1; break }
  }
  if (!acao) return null

  const atual = (linhas[linha - 1] ?? '').replace(/^\s+/, '')
  const campos = Array.isArray(acao.campos) ? acao.campos : []
  let campo = null
  if (linha === linhaDaAcao) {
    // Na linha da ação, o que a pessoa está digitando é o argumento dela.
    campo = campos.find((c) => c?.escrita === 'na mesma linha') || null
  } else {
    // Mais longa primeiro de novo: "sem arquivo:" contém "sem ".
    for (const c of campos) {
      const escrita = c?.escrita
      if (typeof escrita !== 'string' || !escrita.endsWith(':')) continue
      if (!atual.startsWith(escrita)) continue
      if (!campo || escrita.length > campo.escrita.length) campo = c
    }
  }
  return { acao, campo, linha: linhaDaAcao }
}
