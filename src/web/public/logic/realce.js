// Realce de sintaxe da linguagem `.lcn`, como função pura.
//
// A REGRA DURA, e é a única que importa de verdade: o realce NUNCA altera o
// texto. Ele recebe o texto e devolve os mesmos caracteres, na mesma ordem,
// repartidos em pedaços com um nome de classe. Um realce que come um espaço ou
// troca um caractere corrompe o que a pessoa escreveu — e corromperia calado,
// porque quem digita olha a cor, não o conteúdo. Há um teste que junta os
// pedaços de volta e compara com a entrada, sobre os 42 arquivos do catálogo.
//
// AS PALAVRAS VÊM DE FORA. Nada de lista de palavras-chave escrita aqui: elas
// chegam prontas de `/meta/linguagem`, que as deriva do vocabulário. Escrever
// as palavras aqui faria desta a quarta cópia do vocabulário — e a primeira a
// envelhecer, porque palavra nova no compilador não acende sozinha no editor.
//
// É função pura, sem DOM: quem monta os elementos é a camada de tela. Assim
// isto roda em teste sem navegador.

// Os pedaços reconhecidos dentro de uma linha, independentes de palavra:
// marcador de interpolação, texto entre aspas, número.
const MARCADOR = /^\{\{[^{}]*\}\}/
const ASPAS = /^"(?:[^"\\]|\\.)*"?/
const NUMERO = /^-?\d+(?:\.\d+)?\b/

// Ordena as palavras da mais longa para a mais curta. "responde rico" tem de
// ganhar de "responde", exatamente como no compilador — senão a linha acende
// como a ação errada, sem erro nenhum.
function maisLongaPrimeiro (palavras) {
  return [...(palavras || [])].sort((a, b) => b.length - a.length)
}

function comecaCom (resto, palavra) {
  if (!resto.startsWith(palavra)) return false
  const depois = resto[palavra.length]
  // Palavra inteira: "casa" não pode acender dentro de "casamento". Fim de
  // linha, espaço e dois-pontos fecham a palavra.
  return depois === undefined || depois === ' ' || depois === ':'
}

/**
 * Reparte uma linha em pedaços com classe.
 *
 * @returns {Array<{t: string, c: string|null}>} `t` é o texto do pedaço e `c` a
 *   classe (ou null, quando é texto comum). Juntar todos os `t` devolve a linha.
 */
export function realcarLinha (linha, palavras = {}) {
  const pedacos = []
  const empurrar = (t, c = null) => { if (t) pedacos.push({ t, c }) }

  // A indentação é significativa na linguagem (2 espaços = 1 nível), então ela
  // é preservada como está, sem classe.
  const recuo = linha.match(/^\s*/)[0]
  empurrar(recuo)
  let resto = linha.slice(recuo.length)

  if (resto.startsWith('#')) {
    empurrar(resto, 'lcn-comentario')
    return pedacos
  }

  // --- a primeira palavra da linha, que é o que a linha É ------------------
  //
  // A ordem importa: blocos e ações são palavras de abertura, e campo é
  // "chave:". Tentar campo primeiro faria "avisa: oi" dentro de uma ação
  // acender como bloco `avisa`.
  const porOrdem = [
    ['lcn-bloco', palavras.blocos],
    ['lcn-acao', palavras.acoes],
    ['lcn-estrutura', palavras.estrutura],
    ['lcn-marca', palavras.marcas]
  ]
  let abriu = false
  for (const [classe, lista] of porOrdem) {
    for (const palavra of maisLongaPrimeiro(lista)) {
      if (comecaCom(resto, palavra) && resto[palavra.length] !== ':') {
        empurrar(palavra, classe)
        resto = resto.slice(palavra.length)
        abriu = true
        break
      }
    }
    if (abriu) break
  }

  // --- "chave:" ------------------------------------------------------------
  if (!abriu) {
    const doisPontos = resto.indexOf(':')
    if (doisPontos > 0) {
      const chave = resto.slice(0, doisPontos)
      // Só acende o que a linguagem conhece. Chave desconhecida fica sem cor, e
      // essa ausência de cor é informação: é o primeiro sinal de que a linha vai
      // ser recusada, antes de qualquer conferência.
      if ((palavras.campos || []).includes(chave)) {
        empurrar(chave, 'lcn-campo')
        empurrar(':')
        resto = resto.slice(doisPontos + 1)
      }
    }
  }

  // --- o resto da linha ----------------------------------------------------
  const valores = maisLongaPrimeiro(palavras.valores)
  const arquivos = maisLongaPrimeiro(palavras.arquivos)
  const operadores = maisLongaPrimeiro(palavras.operadores)
  // `var` e `evento` valem no MEIO da linha (dentro do `se`), ao contrário de
  // `se`/`senão`/`com`, que só abrem linha.
  const operandos = maisLongaPrimeiro(palavras.operandos)
  let comum = ''
  const fecharComum = () => { empurrar(comum); comum = '' }

  while (resto) {
    const marcador = resto.match(MARCADOR)
    if (marcador) {
      fecharComum()
      empurrar(marcador[0], 'lcn-marcador')
      resto = resto.slice(marcador[0].length)
      continue
    }
    if (resto[0] === '"') {
      fecharComum()
      // A aspa sem par acende igual: quem está escrevendo ainda não fechou, e
      // apagar a cor no meio da digitação pisca a tela a cada tecla.
      const texto = resto.match(ASPAS)[0]
      empurrar(texto, 'lcn-texto')
      resto = resto.slice(texto.length)
      continue
    }
    // Só no começo de uma palavra, para não acender o "2" de "mp3".
    const inicioDePalavra = comum === '' || /[\s(,]$/.test(comum)
    if (inicioDePalavra) {
      const numero = resto.match(NUMERO)
      if (numero) {
        fecharComum()
        empurrar(numero[0], 'lcn-numero')
        resto = resto.slice(numero[0].length)
        continue
      }
      // Palavra de arquivo antes de valor: "a mídia citada" é mais longa que
      // qualquer valor e precisa acender inteira.
      const achada = arquivos.find((p) => comecaCom(resto, p)) ||
        operandos.find((p) => comecaCom(resto, p)) ||
        valores.find((p) => comecaCom(resto, p))
      if (achada) {
        fecharComum()
        const classe = arquivos.includes(achada)
          ? 'lcn-arquivo'
          : operandos.includes(achada) ? 'lcn-estrutura' : 'lcn-valor'
        empurrar(achada, classe)
        resto = resto.slice(achada.length)
        continue
      }
    }
    const operador = operadores.find((op) => resto.startsWith(op))
    if (operador) {
      fecharComum()
      empurrar(operador, 'lcn-operador')
      resto = resto.slice(operador.length)
      continue
    }
    comum += resto[0]
    resto = resto.slice(1)
  }
  fecharComum()
  return pedacos
}

/**
 * O texto inteiro realçado, linha por linha.
 *
 * @returns {Array<Array<{t,c}>>} uma lista de linhas; cada linha é a lista de
 *   pedaços. As quebras de linha NÃO entram nos pedaços — quem remonta as põe
 *   de volta, e é isso que mantém a conta de linhas igual à do textarea.
 */
export function realcar (texto, palavras = {}) {
  return String(texto ?? '').split('\n').map((linha) => realcarLinha(linha, palavras))
}

/** Junta os pedaços de volta. Existe para o teste poder provar a regra dura. */
export function juntar (linhas) {
  return linhas.map((pedacos) => pedacos.map((p) => p.t).join('')).join('\n')
}
