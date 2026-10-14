// Documento de automação -> texto `.lcn`.
//
// Esta direção é a que destrava o painel. A tela de criação sabe montar UMA
// forma (um comando que responde um texto), e as 13 automações instaladas estão
// todas fora dela — o /ping inclusive. Elas abrem em somente leitura não porque
// editar seja perigoso, mas porque a tela não consegue REPRESENTÁ-LAS.
//
// Com o texto, qualquer documento vira algo que uma pessoa lê e edita.
import {
  ACOES, CASAMENTOS, CLASSES, DESTINOS, EXIGENCIAS, NIVEIS_DE_AVISO, ONDE_PROCURAR, ORIGENS, OPERADORES,
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
  // `chama midia.baixar`: a conexão e a função voltam juntas na primeira linha,
  // que é onde elas dizem de quem o comando depende.
  const cabeca = def.alvo
    ? `${def.palavra} ${cfg[def.alvo.conexao]}.${cfg[def.alvo.funcao]}`
    : (inline && cfg[inline.chave] !== undefined ? `${def.palavra} ${citar(cfg[inline.chave])}` : def.palavra)

  const linhas = [cabeca]

  // O bloco de campos abertos vem PRIMEIRO: as entradas são o que a função
  // recebe, e ler isso antes dos textos de aviso é a ordem em que a pessoa
  // pensa — o que eu mando, depois o que eu digo.
  const entradasDoMapa = def.mapa ? (cfg[def.mapa.chave] || {}) : {}
  const nomeDoArquivo = def.arquivo ? cfg[def.arquivo.chave] : null
  if (def.mapa && (Object.keys(entradasDoMapa).length || nomeDoArquivo)) {
    linhas.push(`${IDENT}${def.mapa.bloco}`)
    // O arquivo primeiro: numa chamada que converte mídia, ele é o assunto, e
    // o resto são ajustes em cima dele.
    if (nomeDoArquivo) linhas.push(`${IDENT}${IDENT}${nomeDoArquivo}: ${def.arquivo.palavra}`)
    for (const [nome, valor] of Object.entries(entradasDoMapa)) {
      // O caminho de volta do `o link`: o marcador interno nunca aparece na
      // linguagem.
      if (String(valor) === '{{precisa.link}}') {
        linhas.push(`${IDENT}${IDENT}${nome}: o link`)
        continue
      }
      // Número e liga/desliga saem SEM aspas: é assim que voltam com o tipo
      // que têm. Com aspas eles voltariam como texto, e a ida e volta deixaria
      // de bater — a linguagem perderia informação sem nada avisando.
      if (typeof valor === 'number' || typeof valor === 'boolean') {
        linhas.push(`${IDENT}${IDENT}${nome}: ${valor}`)
        continue
      }
      // Aspas quando precisam: valor com espaço, marcador ou vazio. E TAMBÉM
      // quando o texto se parece com número ou com true/false — sem elas,
      // a string "512" voltaria como o número 512.
      const texto = String(valor)
      const precisaAspas = texto === '' || /[\s"{}]/.test(texto) ||
        /^-?\d+(\.\d+)?$/.test(texto) || texto === 'true' || texto === 'false'
      linhas.push(`${IDENT}${IDENT}${nome}: ${precisaAspas ? citar(texto) : texto}`)
    }
  }
  for (const campo of def.campos) {
    if (campo.inline) continue
    const valor = cfg[campo.chave]
    // Ausente continua ausente: inventar um valor aqui faria o texto prometer
    // configuração que o documento não tem.
    if (valor === undefined || valor === null) continue
    const escrito = campo.tipo === 'texto'
      ? citar(valor)
      : String(campo.palavras?.[valor] ?? valor)
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

// A abertura só IDENTIFICA; a classe virou campo do cabeçalho. Ver o comentário
// correspondente em compilar.js.
function cabecalhoDoGatilho (gatilho, documento, template) {
  const cfg = gatilho.config || {}
  // Num template o id vem do cabeçalho `template`; numa automação publicada ele
  // vem aqui, na abertura.
  const id = template ? null : documento?.id
  return { titulo: id ? `automação ${id}` : 'automação', cfg }
}

export function descompilar (documento, template = null) {
  const nos = documento?.flow?.nodes || []
  const arestas = documento?.flow?.edges || []
  const mapa = new Map(nos.map((n) => [n.id, n]))
  const gatilho = nos.find((n) => typeof n.type === 'string' && n.type.startsWith('trigger.'))
  if (!gatilho) throw new Error('O documento não tem gatilho.')

  const { titulo, cfg } = cabecalhoDoGatilho(gatilho, documento, template)
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

  if (!template && documento.revision !== undefined) h(`revisão: ${documento.revision}`)
  h(`nome: ${documento.name}`)

  // O QUE ELA É, e o que a acorda — as duas primeiras coisas que se lê.
  h(`tipo: ${CLASSES[gatilho.type] || gatilho.type}`)
  h(`dispara com: ${gatilho.type === 'trigger.command' ? cfg.command : 'qualquer mensagem'}`)
  if (documento.display?.menuLabel) {
    const desc = documento.display.menuDescription
    h(`menu: ${documento.display.menuLabel}${desc ? ` — ${desc}` : ''}`)
  }
  if (documento.enabled === false) h('desligada')

  for (const ref of documento.scope?.include || []) h(`onde: ${escreverDestino(ref)}`)
  for (const ref of documento.scope?.exclude || []) h(`menos: ${escreverDestino(ref)}`)
  h(`pool: ${documento.responder?.poolId ?? ''}`)

  const tipos = documento.inputPolicy?.acceptedMessageKinds || []
  h(`acessa: ${tipos.map((t) => TIPOS_DE_MENSAGEM[t] || t).join(', ')}`)
  if (documento.inputPolicy?.historyPolicy && documento.inputPolicy.historyPolicy !== 'live_only') {
    h(`histórico: ${documento.inputPolicy.historyPolicy}`)
  }

  // A exigência e a mensagem de falta, lado a lado.
  const exige = documento.inputPolicy?.requires
  if (exige) {
    const onde = (exige.from || []).map((f) => ONDE_PROCURAR[f] || f).join(' ou ')
    h(`precisa de ${EXIGENCIAS[exige.kind] || exige.kind}: ${onde}`)
    if (exige.missingText) {
      // "ele" para link, "ela" para mídia — a linguagem é em português, e
      // concordar custa uma linha.
      h(`${exige.kind === 'media' ? 'sem ela' : 'sem ele'}: ${citar(exige.missingText)}`)
    }
  }

  if (gatilho.type === 'trigger.command') {
    h(`casa: ${CASAMENTOS[cfg.match] || cfg.match}`)
  } else {
    if (cfg.containsLink === true) h('com link')
    if (cfg.mediaLinkOnly === true) h('só link de mídia')
    if (cfg.alsoOnCommands === true) h('também em comandos')
    if (Array.isArray(cfg.messageKinds) && cfg.messageKinds.length) {
      h(`quando for: ${cfg.messageKinds.map((t) => TIPOS_DE_MENSAGEM[t] || t).join(', ')}`)
    }
    if (Array.isArray(cfg.keywords) && cfg.keywords.length) {
      h(`palavras: ${cfg.keywords.map(citar).join(', ')}`)
    }
  }
  h(`quem: ${ORIGENS[cfg.allowFrom] || cfg.allowFrom}`)
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
        if (p.multiline === true) linhas.push(`${IDENT}${IDENT}várias linhas: sim`)
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
