// Cálculo é um passo declarado do fluxo. O interpolador continua sendo troca
// de texto: não ganha eval, precedência, funções nem conversão de booleano.
export class ErroDeCalculo extends Error {}

export const NUMERO_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function numeroDeCalculo (valor, nome = 'Operando') {
  if (typeof valor !== 'number' && (typeof valor !== 'string' || !NUMERO_DECIMAL.test(valor.trim()))) {
    throw new ErroDeCalculo(`${nome}: esperado número decimal; valor ausente, vazio, booleano ou texto não numérico não serve para calcular.`)
  }
  const n = Number(valor)
  if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n))) {
    throw new ErroDeCalculo(`${nome}: número fora da representação segura do motor.`)
  }
  if (n === 0 && typeof valor === 'string' && /[1-9]/.test(valor.trim().split(/[eE]/)[0])) {
    throw new ErroDeCalculo(`${nome}: número pequeno demais para ser representado; não foi convertido em zero.`)
  }
  return n
}

export function calcular (esquerda, operador, direita) {
  const a = numeroDeCalculo(esquerda, 'Operando esquerdo')
  const b = numeroDeCalculo(direita, 'Operando direito')
  let resultado
  switch (operador) {
    case 'add': resultado = a + b; break
    case 'subtract': resultado = a - b; break
    case 'multiply': resultado = a * b; break
    case 'divide':
      if (b === 0) throw new ErroDeCalculo('Divisão por zero: o cálculo foi interrompido.')
      resultado = a / b
      break
    default: throw new ErroDeCalculo(`Operação aritmética desconhecida: "${operador}".`)
  }
  // Number é o tipo que o documento e o banco já usam. Não arredondamos para
  // inteiro nem para centavos: 5 / 2 precisa continuar 2.5. A precisão é a
  // binária do JavaScript (0.1 + 0.2 pode ser 0.30000000000000004), declarada
  // na ajuda. Infinito, inteiro inseguro e perda total para zero são ERROS,
  // porque serializar esses resultados faria o banco guardar uma mentira.
  numeroDeCalculo(resultado, 'Resultado')
  if (resultado === 0 && a !== 0 && b !== 0 && ['multiply', 'divide'].includes(operador)) {
    throw new ErroDeCalculo('Resultado pequeno demais para ser representado; não foi convertido em zero.')
  }
  return Object.is(resultado, -0) ? 0 : resultado
}
