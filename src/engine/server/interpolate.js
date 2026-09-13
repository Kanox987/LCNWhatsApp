const NAMESPACES_EMBUTIDOS = {
  message: new Set(['text', 'kind', 'args']),
  sender: new Set(['id', 'isOwner']),
  chat: new Set(['id', 'kind']),
  // Quem o comando mira: o primeiro @mencionado ou o autor da mensagem
  // citada. Fica vazio (placeholder intacto) quando não há alvo nenhum.
  target: new Set(['id'])
}

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

function obterValor (contexto, namespace, campo) {
  if (namespace === 'var') return obterValorDeEscopo(contexto, campo)

  // Atalho histórico: {{custom.X}} sempre significou "a variável desta
  // conversa" e continua significando, para não quebrar documento publicado.
  if (namespace === 'custom') return lerDe(contexto?.custom, campo)

  if (!NAMESPACES_EMBUTIDOS[namespace]?.has(campo)) return undefined
  const origem = contexto?.[namespace]
  return origem && Object.hasOwn(origem, campo) ? origem[campo] : undefined
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
