// Documento de automação -> texto `.lcn`.
//
// Esta direção é a que destrava o painel. A tela de criação sabe montar UMA
// forma (um comando que responde um texto), e as 13 automações instaladas estão
// todas fora dela — o /ping inclusive. Elas abrem em somente leitura não porque
// editar seja perigoso, mas porque a tela não consegue REPRESENTÁ-LAS.
//
// Com o texto, qualquer documento vira algo que uma pessoa lê e edita.
import {
  ACOES, CASAMENTOS, DESTINOS, NIVEIS_DE_AVISO, ORIGENS, OPERADORES,
  TIPOS_DE_CONFIG, TIPOS_DE_MENSAGEM, TIPOS_DE_VALOR, acaoPorTipo
} from './vocabulario.js'

const IDENT = '  '

function citar (valor) {
  return JSON.stringify(String(valor ?? ''))
}

// A ordem em que os nós saem no texto é a ordem do PERCURSO, não a do array —
// é o percurso que conta a história ("casou -> faz isto -> depois aquilo").
function seguir (mapa, arestas, de, rotulo) {
  const aresta = arestas.find((e) => e.from === de && e.on === rotulo)
  return aresta ? mapa.get(aresta.to) : null
}

function cadeia (mapa, arestas, primeiro) {
  const saida = []
  let atual = primeiro
  while (atual && atual.type !== 'condition.compare') {
    saida.push(atual)
    atual = seguir(mapa, arestas, atual.id, 'success')
  }
  return { acoes: saida, condicao: atual || null }
}

function linhaDeAcao (no) {
  const def = acaoPorTipo(no.type)
  if (!def) throw new Error(`Ação sem palavra na linguagem: ${no.type}`)
  const cfg = no.config || {}

  // `define`/`soma` têm forma própria: quatro linhas indentadas para gravar uma
  // variável seria pior de ler que a linha única que elas pedem.
  if (def.forma === 'variavel') {
    const escopo = cfg.scope + (cfg.categoryKey ? `:${cfg.categoryKey}` : '')
    const valor = def.palavra === 'soma' ? String(cfg.by) : citar(cfg.value)
    return [`${def.palavra} ${escopo} ${cfg.key} = ${valor}`]
  }

  const inline = def.campos.find((c) => c.inline)
  const cabeca = inline && cfg[inline.chave] !== undefined
    ? `${def.palavra} ${citar(cfg[inline.chave])}`
    : def.palavra

  const linhas = [cabeca]
  for (const campo of def.campos) {
    if (campo.inline) continue
    const valor = cfg[campo.chave]
    // Ausente continua ausente: inventar um valor aqui faria o texto prometer
    // configuração que o documento não tem.
    if (valor === undefined || valor === null) continue
    const escrito = campo.tipo === 'texto' ? citar(valor) : String(valor)
    linhas.push(`${IDENT}${campo.rotulo}: ${escrito}`)
  }
  return linhas
}

// Literal MANTÉM o tipo. Número virando texto não é detalhe de formatação: a
// comparação desta base é tipada de propósito, porque `"10" >= "3"` é FALSO em
// texto. Um anti-link editado pela linguagem pararia de remover depois do
// décimo aviso, sem erro em lugar nenhum.
function escreverLiteral (valor) {
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  return citar(valor)
}

function escreverOperando (op) {
  if (!op) return '?'
  if (op.source === 'literal') return escreverLiteral(op.value)
  if (op.source === 'variable') {
    const escopo = op.scope + (op.categoryKey ? `:${op.categoryKey}` : '')
    return `var ${escopo} ${op.key}`
  }
  if (op.source === 'event') return `evento ${op.field}`
  return '?'
}

function escreverDestino (ref) {
  const palavra = DESTINOS[ref.kind]
  if (!palavra) return ref.kind
  if (ref.kind === 'tagged') return `${palavra} ${ref.id}`
  if (ref.kind === 'contact' || ref.kind === 'group') return `${palavra} ${ref.id}`
  return palavra
}

function cabecalhoDoGatilho (gatilho) {
  const cfg = gatilho.config || {}
  if (gatilho.type === 'trigger.command') {
    return { titulo: `comando ${cfg.command}`, cfg }
  }
  return { titulo: 'ao receber mensagem', cfg }
}

export function descompilar (documento, template = null) {
  const nos = documento?.flow?.nodes || []
  const arestas = documento?.flow?.edges || []
  const mapa = new Map(nos.map((n) => [n.id, n]))
  const gatilho = nos.find((n) => typeof n.type === 'string' && n.type.startsWith('trigger.'))
  if (!gatilho) throw new Error('O documento não tem gatilho.')

  const { titulo, cfg } = cabecalhoDoGatilho(gatilho)
  const linhas = []

  // Cabeçalho de template vem ANTES do comando: é o que identifica o arquivo.
  if (template) {
    linhas.push(`template ${template.templateId} v${template.templateVersion}`)
    if (template.name) linhas.push(`${IDENT}nome: ${template.name}`)
    if (template.description) linhas.push(`${IDENT}descrição: ${template.description}`)
    if (template.category) linhas.push(`${IDENT}categoria: ${template.category}`)
    // Só aparece quando não é 1 — é o padrão do schema, e escrever "motor: 1"
    // em vinte arquivos não informa nada a ninguém.
    if (template.minEngineVersion !== undefined && template.minEngineVersion !== 1) {
      linhas.push(`${IDENT}motor: ${template.minEngineVersion}`)
    }
    for (const d of template.dependsOn || []) linhas.push(`${IDENT}depende de: ${d}`)
    for (const c of template.requiredCapabilities || []) linhas.push(`${IDENT}exige: ${c}`)
    linhas.push('')
  }

  linhas.push(titulo)
  const h = (texto) => linhas.push(`${IDENT}${texto}`)

  if (!template) {
    h(`id: ${documento.id}`)
    if (documento.revision !== undefined) h(`revisão: ${documento.revision}`)
  }
  h(`nome: ${documento.name}`)
  if (documento.display?.menuLabel) {
    const desc = documento.display.menuDescription
    h(`menu: ${documento.display.menuLabel}${desc ? ` — ${desc}` : ''}`)
  }
  if (documento.enabled === false) h('desligada')

  for (const ref of documento.scope?.include || []) h(`onde: ${escreverDestino(ref)}`)
  for (const ref of documento.scope?.exclude || []) h(`menos: ${escreverDestino(ref)}`)
  h(`pool: ${documento.responder?.poolId ?? ''}`)

  const tipos = documento.inputPolicy?.acceptedMessageKinds || []
  h(`tipos: ${tipos.map((t) => TIPOS_DE_MENSAGEM[t] || t).join(', ')}`)
  if (documento.inputPolicy?.historyPolicy && documento.inputPolicy.historyPolicy !== 'live_only') {
    h(`histórico: ${documento.inputPolicy.historyPolicy}`)
  }

  if (gatilho.type === 'trigger.command') {
    h(`casa: ${CASAMENTOS[cfg.match] || cfg.match}`)
  } else {
    if (cfg.containsLink === true) h('com link')
    if (cfg.mediaLinkOnly === true) h('só link de mídia')
    if (Array.isArray(cfg.messageKinds) && cfg.messageKinds.length) {
      h(`quando for: ${cfg.messageKinds.map((t) => TIPOS_DE_MENSAGEM[t] || t).join(', ')}`)
    }
    if (Array.isArray(cfg.keywords) && cfg.keywords.length) {
      h(`palavras: ${cfg.keywords.map(citar).join(', ')}`)
    }
  }
  h(`de: ${ORIGENS[cfg.allowFrom] || cfg.allowFrom}`)
  if (cfg.requireOwner === true) h('só dono')

  linhas.push('')

  const primeiro = seguir(mapa, arestas, gatilho.id, 'matched')
  const { acoes, condicao } = cadeia(mapa, arestas, primeiro)
  for (const no of acoes) for (const l of linhaDeAcao(no)) linhas.push(`${IDENT}${l}`)

  if (condicao) {
    const c = condicao.config || {}
    linhas.push(`${IDENT}se ${escreverOperando(c.left)} ${OPERADORES[c.operator] || c.operator} ${escreverOperando(c.right)}`)
    for (const rotulo of ['true', 'false']) {
      const ramo = cadeia(mapa, arestas, seguir(mapa, arestas, condicao.id, rotulo))
      if (rotulo === 'false') linhas.push(`${IDENT}senão`)
      for (const no of ramo.acoes) for (const l of linhaDeAcao(no)) linhas.push(`${IDENT}${IDENT}${l}`)
    }
  }

  // --- blocos de template -------------------------------------------------
  // Um `.lcn` representa tanto uma automação solta quanto um template. O que é
  // do template sai DEPOIS do corpo: quem abre o arquivo quer ler o que o
  // comando faz, não o formulário de instalação.
  if (template) {
    if (template.parameters?.length) {
      linhas.push('')
      linhas.push('configurável')
      for (const p of template.parameters) {
        const tipo = TIPOS_DE_CONFIG[p.type] || p.type
        const opcoes = p.options?.length ? ` (${p.options.join(', ')})` : ''
        const padrao = p.default === undefined || p.default === null
          ? ''
          : ` = ${typeof p.default === 'string' ? citar(p.default) : String(p.default)}`
        linhas.push(`${IDENT}${p.key}: ${tipo}${opcoes}${padrao}`)
        if (p.label) linhas.push(`${IDENT}${IDENT}rótulo: ${p.label}`)
        if (p.help) linhas.push(`${IDENT}${IDENT}ajuda: ${p.help}`)
      }
    }
    if (template.variables?.length) {
      linhas.push('')
      linhas.push('declara')
      for (const v of template.variables) {
        linhas.push(`${IDENT}${v.scope} ${v.key}: ${TIPOS_DE_VALOR[v.valueType] || v.valueType}`)
        if (v.description) linhas.push(`${IDENT}${IDENT}${v.description}`)
      }
    }
    for (const a of template.warnings || []) {
      linhas.push('')
      linhas.push(`avisa ${NIVEIS_DE_AVISO[a.level] || a.level}`)
      linhas.push(`${IDENT}${a.text}`)
    }
  }

  // Os nomes dos nós saem num rodapé, não coladas em cada linha: eles existem
  // para o documento voltar IGUAL, e ninguém lê uma automação pelos ids.
  // Quando falta nome para algum nó, o compilador gera — mexer no texto não
  // pode exigir manter esta linha em dia.
  linhas.push('')
  linhas.push(`# nós: ${nos.map((n) => n.id).join(', ')}`)

  return linhas.join('\n') + '\n'
}
