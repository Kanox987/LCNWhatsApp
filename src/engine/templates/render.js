// Materialização de template -> documento de automação (Parte C, Módulo 4
// do plano). Substituição ESTRUTURAL e tipada, nunca interpolação de texto
// livre: só o namespace fixo `params.<chave>` é reconhecido, resolvido
// contra os parâmetros tipados declarados no próprio template — não é um
// motor de expressão, é troca de placeholder puro (mesmo espírito de
// segurança do interpolador de runtime em server/interpolate.js, mas uma
// camada anterior e totalmente separada: esta roda uma vez, na instalação,
// pra produzir o `doc_json` final; qualquer `{{namespace.campo}}` que sobrar
// no documento gerado — ex.: `{{latencyMs}}`, `{{custom.vip}}` — nunca casa
// com `params.` e chega intacto no avaliador de verdade, pra ser resolvido
// em tempo de execução como já acontece hoje).
const PLACEHOLDER_EXATO = /^\{\{params\.([^{}.]+)\}\}$/
const PLACEHOLDER_QUALQUER = /\{\{params\.([^{}.]+)\}\}/g

function converterTipo (valor, tipo, chave) {
  if (tipo === 'number') {
    const numero = Number(valor)
    if (!Number.isFinite(numero)) throw new Error(`Parâmetro "${chave}" precisa ser numérico.`)
    return numero
  }
  if (tipo === 'boolean') return valor === true || valor === 'true'
  return String(valor)
}

function resolverParametros (template, parametrosFornecidos) {
  const resolvidos = {}
  for (const definicao of template.parameters || []) {
    const bruto = Object.hasOwn(parametrosFornecidos || {}, definicao.key)
      ? parametrosFornecidos[definicao.key]
      : definicao.default
    if (bruto === undefined) throw new Error(`Parâmetro obrigatório não informado: ${definicao.key}.`)
    resolvidos[definicao.key] = converterTipo(bruto, definicao.type, definicao.key)
  }
  return resolvidos
}

function substituirEmString (texto, parametros) {
  const matchExato = texto.match(PLACEHOLDER_EXATO)
  if (matchExato) {
    const chave = matchExato[1]
    if (!Object.hasOwn(parametros, chave)) throw new Error(`Template referencia parâmetro inexistente: ${chave}.`)
    return parametros[chave]
  }
  return texto.replace(PLACEHOLDER_QUALQUER, (placeholder, chave) => {
    if (!Object.hasOwn(parametros, chave)) throw new Error(`Template referencia parâmetro inexistente: ${chave}.`)
    return String(parametros[chave])
  })
}

function substituirEmValor (valor, parametros) {
  if (typeof valor === 'string') return substituirEmString(valor, parametros)
  if (Array.isArray(valor)) return valor.map((item) => substituirEmValor(item, parametros))
  if (valor && typeof valor === 'object') {
    const saida = {}
    for (const [chave, item] of Object.entries(valor)) saida[chave] = substituirEmValor(item, parametros)
    return saida
  }
  return valor
}

export function renderizarTemplate (template, parametrosFornecidos = {}) {
  const parametros = resolverParametros(template, parametrosFornecidos)
  return substituirEmValor(structuredClone(template.documentTemplate), parametros)
}
