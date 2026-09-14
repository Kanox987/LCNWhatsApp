// O QUE DÁ PARA ESCREVER NUM COMANDO É O QUE ESTÁ NO CONTEXTO — ponto.
//
// Isto era uma lista de nomes permitidos por namespace, e a lista era o
// problema: o dado chegava no evento, aparecia no JSON, e mesmo assim o
// placeholder ficava literal até alguém lembrar de acrescentar o nome ao
// conjunto. Pior, a mesma lista existia em três lugares (aqui, no mapa de
// campos da condição e no enum do schema) e eles saíam de sincronia — foi assim
// que {{sender.isAdmin}} passou a existir no texto e NÃO na condição.
//
// A fronteira de verdade é outra, e sempre foi: o CONTEXTO. Quem monta o
// contexto (evaluator.js) decide o que é legível, e já tira de lá o que não
// pode ser lido — token de mídia, principalmente. Então o que está no contexto
// é endereçável, sem segunda lista para manter em dia.

// Escopos de variável endereçáveis por {{var.<escopo>.<chave>}}. 'category'
// fica de fora porque leva um segmento a mais: {{var.category.<qual>.<chave>}}.
const ESCOPOS_SIMPLES = new Set(['chat', 'sender', 'member', 'target', 'targetMember', 'global'])

function lerDe (mapa, chave) {
  return mapa && Object.hasOwn(mapa, chave) ? mapa[chave] : undefined
}

function obterValorDeEscopo (contexto, campo) {
  const variaveis = contexto?.var
  if (!variaveis) return undefined

  const primeiroPonto = campo.indexOf('.')
  if (primeiroPonto === -1) return undefined
  const escopo = campo.slice(0, primeiroPonto)
  const resto = campo.slice(primeiroPonto + 1)
  if (!resto) return undefined

  if (ESCOPOS_SIMPLES.has(escopo)) return lerDe(variaveis[escopo], resto)

  if (escopo === 'category') {
    // {{var.category.vip.usos}} -> categoria "vip", chave "usos". A chave pode
    // conter ponto; o nome da categoria, não.
    const segundoPonto = resto.indexOf('.')
    if (segundoPonto === -1) return undefined
    const categoria = resto.slice(0, segundoPonto)
    const chave = resto.slice(segundoPonto + 1)
    if (!categoria || !chave) return undefined
    return lerDe(variaveis.category?.[categoria], chave)
  }

  return undefined
}

// Caminho com pontos dentro do contexto: "sender.isAdmin", "media.caption".
// Só percorre propriedade própria — nunca prototype, então "constructor" e
// "__proto__" não levam a lugar nenhum.
export function resolverCaminho (contexto, caminho) {
  if (!contexto || typeof caminho !== 'string' || !caminho) return undefined
  let atual = contexto
  for (const parte of caminho.split('.')) {
    if (atual === null || typeof atual !== 'object' || !Object.hasOwn(atual, parte)) return undefined
    atual = atual[parte]
  }
  return typeof atual === 'function' ? undefined : atual
}

// Variável de usuário tem UM endereço só: {{var.<escopo>.<chave>}}. Qualquer
// apelido que resolvesse para o mesmo valor com outro nome esconderia o
// escopo — e escopo é justamente o que decide de quem é aquele valor.
function obterValor (contexto, namespace, campo) {
  if (namespace === 'var') return obterValorDeEscopo(contexto, campo)
  return resolverCaminho(contexto, `${namespace}.${campo}`)
}

function converterParaTexto (valor) {
  if (typeof valor === 'string') return valor
  try { return JSON.stringify(valor) } catch { return undefined }
}

export function interpolar (texto, contexto = {}) {
  if (typeof texto !== 'string' || !texto.includes('{{')) return texto

  return texto.replace(/\{\{([^{}.]+)\.([^{}]+)\}\}/g, (placeholder, namespace, campo) => {
    const valor = obterValor(contexto, namespace, campo)
    if (valor === undefined) return placeholder
    return converterParaTexto(valor) ?? placeholder
  })
}
