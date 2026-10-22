// Materialização de template -> documento de automação (Parte C, Módulo 4
// do plano). Substituição ESTRUTURAL e tipada, nunca interpolação de texto
// livre: só o namespace fixo `params.<chave>` é reconhecido, resolvido
// contra os parâmetros tipados declarados no próprio template — não é um
// motor de expressão, é troca de placeholder puro (mesmo espírito de
// segurança do interpolador de runtime em server/interpolate.js, mas uma
// camada anterior e totalmente separada: esta roda uma vez, na instalação,
// pra produzir o `doc_json` final; qualquer `{{namespace.campo}}` que sobrar
// no documento gerado — ex.: `{{latencyMs}}`, `{{var.chat.vip}}` — nunca casa
// com `params.` e chega intacto no avaliador de verdade, pra ser resolvido
// em tempo de execução como já acontece hoje).
const PLACEHOLDER_EXATO = /^\{\{params\.([^{}.]+)\}\}$/
const PLACEHOLDER_QUALQUER = /\{\{params\.([^{}.]+)\}\}/g

// Recebe a DEFINIÇÃO inteira, não só o tipo: sem ela o enum não teria contra o
// que conferir, e "escolha da lista" viraria texto livre com outro nome.
function converterTipo (valor, definicao) {
  const { type: tipo, key: chave } = definicao
  if (tipo === 'number') {
    const numero = Number(valor)
    if (!Number.isFinite(numero)) throw new Error(`Parâmetro "${chave}" precisa ser numérico.`)
    return numero
  }
  if (tipo === 'boolean') return valor === true || valor === 'true'
  if (tipo === 'enum') {
    const texto = String(valor)
    const opcoes = Array.isArray(definicao.options) ? definicao.options : []
    // Recusar aqui, na instalação, é o ponto certo: um valor fora da lista
    // geraria um documento que passa no schema e não faz nada — o marcador que
    // ninguém lê, o modo de download que não existe. Falha silenciosa é o que
    // este tipo existe para evitar, então ele não pode nascer sendo uma.
    if (!opcoes.includes(texto)) {
      throw new Error(`Parâmetro "${chave}" precisa ser uma destas opções: ${opcoes.join(', ')}. Recebi: "${texto}".`)
    }
    return texto
  }
  return String(valor)
}

function resolverParametros (template, parametrosFornecidos) {
  const resolvidos = {}
  for (const definicao of template.parameters || []) {
    const bruto = Object.hasOwn(parametrosFornecidos || {}, definicao.key)
      ? parametrosFornecidos[definicao.key]
      : definicao.default
    if (bruto === undefined) throw new Error(`Parâmetro obrigatório não informado: ${definicao.key}.`)
    resolvidos[definicao.key] = converterTipo(bruto, definicao)
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
  const documento = substituirEmValor(structuredClone(template.documentTemplate), parametros)
  // A CATEGORIA DO TEMPLATE VIRA A FAMÍLIA DO COMANDO.
  //
  // Antes ela morria aqui: servia para agrupar a vitrine do catálogo e não
  // chegava ao comando instalado. Depois de instalar, 29 comandos viravam uma
  // lista plana sem nenhum agrupamento — e era isso que impedia "desligar os
  // comandos de download neste grupo" de sequer ser uma frase com sentido.
  //
  // É VALOR INICIAL, não imposição: o template pode declarar a própria família
  // (e aí ela ganha), e quem editar o texto depois troca para o que quiser.
  // A lista fechada de categorias continua valendo só para o catálogo.
  if (template?.category && !documento?.display?.family) {
    documento.display = { ...(documento.display || {}), family: template.category }
  }
  return documento
}

// As declarações de variável passam pela MESMA substituição do documento —
// o nome da variável pode vir de um parâmetro (é o caso do marcar-variavel,
// onde quem instala escolhe como a variável se chama). Declarar sem resolver
// registraria a variável com "{{params.variavel}}" no nome.
export function renderizarVariaveisDeclaradas (template, parametrosFornecidos = {}) {
  if (!Array.isArray(template?.variables) || !template.variables.length) return []
  const parametros = resolverParametros(template, parametrosFornecidos)
  return substituirEmValor(structuredClone(template.variables), parametros)
}
