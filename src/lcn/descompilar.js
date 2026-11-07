// Documento de automação -> texto `.lcn`.
//
// Esta direção é a que destrava o painel. A tela de criação sabe montar UMA
// forma (um comando que responde um texto), e as 13 automações instaladas estão
// todas fora dela — o /ping inclusive. Elas abrem em somente leitura não porque
// editar seja perigoso, mas porque a tela não consegue REPRESENTÁ-LAS.
//
// Com o texto, qualquer documento vira algo que uma pessoa lê e edita.
import {
  ACOES, ACOES_DE_GRUPO, CASAMENTOS, CLASSES, DESTINOS, EXIGENCIAS, NIVEIS_DE_AVISO, ONDE_PROCURAR, ORIGENS, OPERADORES,
  TIPOS_DE_CONFIG, TIPOS_DE_MENSAGEM, TIPOS_DE_VALOR, acaoPorTipo,
  PRIORIDADES, OPERACOES_ARITMETICAS, BLOCOS_DE_CONDICAO
} from './vocabulario.js'
import { conferirEstrutura, inferirEstrutura } from './estrutura.js'
import { escreverTempo } from './tempo.js'

const IDENT = '  '

function citar (valor) {
  return JSON.stringify(String(valor ?? ''))
}

function linhaDeAcao (no) {
  const def = acaoPorTipo(no.type)
  if (!def) throw new Error(`Ação sem palavra na linguagem: ${no.type}`)
  const cfg = no.config || {}

  // `define`/`soma` têm forma própria: quatro linhas indentadas para gravar uma
  // variável seria pior de ler que a linha única que elas pedem.
  if (def.forma === 'variavel') {
    const escopo = cfg.scope + (cfg.categoryKey ? `:${cfg.categoryKey}` : '')
    if (def.palavra === 'calcula') {
      const operando = (op) => op?.source === 'literal' && /^\{\{params\.[^{}]+\}\}$/.test(op.value)
        ? op.value : escreverOperando(op)
      const simbolo = OPERACOES_ARITMETICAS[cfg.operator]
      if (!simbolo) throw new Error(`Operação aritmética desconhecida: ${cfg.operator}`)
      return [`calcula ${escopo} ${cfg.key} = ${operando(cfg.left)} ${simbolo} ${operando(cfg.right)}`]
    }
    if (def.palavra === 'sorteia') {
      const corpo = cfg.entre !== undefined && cfg.entre !== null
        ? `entre ${citar(cfg.entre)}`
        : `${cfg.minimo} até ${cfg.maximo}`
      return [`sorteia ${escopo} ${cfg.key} = ${corpo}`]
    }
    const valor = def.palavra === 'soma' ? String(cfg.by) : citar(cfg.value)
    return [`${def.palavra} ${escopo} ${cfg.key} = ${valor}`]
  }

  if (def.tipo === 'action.whatsapp.buttons') {
    const texto = cfg.text !== undefined && cfg.text !== null ? ` ${citar(cfg.text)}` : ''
    const out = [`${def.palavra}${texto}`]
    for (const b of cfg.buttons || []) {
      const rotulo = citar(b.text ?? '')
      const cmd = b.command ?? b.id
      if (cmd && cmd !== b.text) {
        out.push(`${IDENT}botão ${rotulo}: ${citar(cmd)}`)
      } else {
        out.push(`${IDENT}botão ${rotulo}`)
      }
    }
    if (cfg.footer) out.push(`${IDENT}rodapé: ${citar(cfg.footer)}`)
    if (cfg.fallbackText) out.push(`${IDENT}senão: ${citar(cfg.fallbackText)}`)
    return out
  }

  if (def.tipo === 'action.whatsapp.carousel') {
    const texto = cfg.text !== undefined && cfg.text !== null ? ` ${citar(cfg.text)}` : ''
    const out = [`${def.palavra}${texto}`]
    if (cfg.folder) out.push(`${IDENT}pasta: ${citar(cfg.folder)}`)
    if (cfg.buttonText) out.push(`${IDENT}botão: ${citar(cfg.buttonText)}`)
    if (cfg.buttonCommand) out.push(`${IDENT}comando: ${citar(cfg.buttonCommand)}`)
    for (const c of cfg.cards || []) {
      out.push(`${IDENT}card`)
      if (c.path) out.push(`${IDENT}${IDENT}arquivo: ${citar(c.path)}`)
      else if (c.fileId) out.push(`${IDENT}${IDENT}arquivo: ${citar(c.fileId)}`)
      if (c.title) out.push(`${IDENT}${IDENT}título: ${citar(c.title)}`)
      if (c.body) out.push(`${IDENT}${IDENT}corpo: ${citar(c.body)}`)
      if (c.footer) out.push(`${IDENT}${IDENT}rodapé: ${citar(c.footer)}`)
      if (c.buttonText) {
        const cmd = c.buttonUrl || c.buttonCommand
        if (cmd && cmd !== c.buttonText) {
          out.push(`${IDENT}${IDENT}botão: ${citar(c.buttonText)}: ${citar(cmd)}`)
        } else {
          out.push(`${IDENT}${IDENT}botão: ${citar(c.buttonText)}`)
        }
      }
    }
    if (cfg.footer) out.push(`${IDENT}rodapé: ${citar(cfg.footer)}`)
    if (cfg.estilo) {
      const palavra = def.campos.find((c) => c.chave === 'estilo')?.palavras?.[cfg.estilo] ?? cfg.estilo
      out.push(`${IDENT}estilo: ${palavra}`)
    }
    if (cfg.notFoundText) out.push(`${IDENT}sem arquivo: ${citar(cfg.notFoundText)}`)
    if (cfg.fallbackText) out.push(`${IDENT}senão: ${citar(cfg.fallbackText)}`)
    return out
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
  // Os arquivos, na ordem em que o comando os nomeia: `mediaInput` e, quando
  // a função recebe duas fotos, `mediaInput2`.
  const arquivosEscritos = []
  for (const sufixo of ['', '2']) {
    const nome = cfg[`mediaInput${sufixo}`]
    if (!nome) continue
    const origem = cfg[`mediaFrom${sufixo}`]
    // A palavra que devolve a MESMA origem. Sem origem declarada é "a mídia",
    // que é a da mensagem ou a da citada — o comportamento de sempre.
    const palavra = (def.arquivos || []).find((a) => (a.valor || null) === (origem || null))?.palavra
    if (palavra) arquivosEscritos.push(`${IDENT}${IDENT}${nome}: ${palavra}`)
  }
  if (def.mapa && (Object.keys(entradasDoMapa).length || arquivosEscritos.length)) {
    linhas.push(`${IDENT}${def.mapa.bloco}`)
    // O arquivo primeiro: numa chamada que converte mídia, ele é o assunto, e
    // o resto são ajustes em cima dele.
    linhas.push(...arquivosEscritos)
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
  if (ref.kind === 'tagged' || ref.kind === 'listed') return `${palavra} ${ref.id}`
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
  if (documento.name) h(`nome: ${documento.name}`)

  // O QUE ELA É, e o que a acorda — as duas primeiras coisas que se lê.
  h(`tipo: ${CLASSES[gatilho.type] || gatilho.type}`)
  const agendado = gatilho.type === 'trigger.schedule'
  if (agendado) {
    // O relógio no lugar das linhas de mensagem. O fuso só aparece quando não é
    // o padrão: o compilador repõe America/Sao_Paulo na volta.
    h(`agenda: ${escreverTempo(cfg.schedule)}`)
    if (cfg.timezone && cfg.timezone !== 'America/Sao_Paulo') h(`fuso: ${cfg.timezone}`)
  }
  if (gatilho.type !== 'trigger.group' && !agendado) {
    // O canônico primeiro, os atalhos depois e na ordem em que foram
    // declarados: é assim que o texto volta igual ao que entrou.
    const comandoEscrito = gatilho.type === 'trigger.command'
      ? [cfg.command, ...(Array.isArray(cfg.aliases) ? cfg.aliases : [])].join(', ')
      : 'qualquer mensagem'
    h(`dispara com: ${comandoEscrito}`)
  }
  if (documento.display?.family) h(`família: ${documento.display.family}`)
  if (documento.display?.menuHidden) h('menu: não')
  else if (documento.display?.menuLabel) {
    const desc = documento.display.menuDescription
    h(`menu: ${documento.display.menuLabel}${desc ? ` — ${desc}` : ''}`)
  }
  if (documento.enabled === false) h('desligada')

  for (const ref of documento.scope?.include || []) h(`onde: ${escreverDestino(ref)}`)
  for (const ref of documento.scope?.exclude || []) h(`menos: ${escreverDestino(ref)}`)
  // Linha de cabeçalho VAZIA é pior que linha ausente, pela mesma razão da
  // política de fila mais abaixo: ela não decide nada e ainda confunde. E em
  // `acessa:` é pior que confundir — recompilar `acessa: ` QUEBRA, com erro que
  // nem nomeia o campo ("tipo de mensagem desconhecido: \"\""). Medido: para os
  // três campos, omitir a linha devolve o MESMO documento que a linha vazia.
  if (documento.responder?.poolId) h(`pool: ${documento.responder.poolId}`)

  if (gatilho.type !== 'trigger.group' && !agendado) {
    const tipos = documento.inputPolicy?.acceptedMessageKinds || []
    if (tipos.length) h(`acessa: ${tipos.map((t) => TIPOS_DE_MENSAGEM[t] || t).join(', ')}`)
  }
  if (documento.inputPolicy?.historyPolicy && documento.inputPolicy.historyPolicy !== 'live_only') {
    h(`histórico: ${documento.inputPolicy.historyPolicy}`)
  }

  // A POLÍTICA DE FILA, e só quando ela NÃO é o padrão.
  //
  // Escrever `prioridade: normal` e `sem vaga: descarta` em toda automação
  // encheria o cabeçalho de linha que não decide nada — e o que não decide nada
  // some no meio do que decide. Quem lê precisa ver a linha justamente quando
  // ela é a exceção. O compilador repõe o padrão na volta, então nada se perde.
  const fila = documento.scheduling
  if (fila?.priority && fila.priority !== 'normal') {
    h(`prioridade: ${PRIORIDADES[fila.priority] || fila.priority}`)
  }
  if (fila?.onNoSlot?.kind === 'notify') h(`sem vaga: ${JSON.stringify(fila.onNoSlot.text ?? '')}`)
  else if (fila?.onNoSlot?.kind && fila.onNoSlot.kind !== 'discard') h(`sem vaga: ${fila.onNoSlot.kind}`)

  // A exigência e a mensagem de falta, lado a lado.
  const exige = documento.inputPolicy?.requires
  // Sem local onde procurar, a exigência não é escrevível: `precisa de um
  // link: ` vazio QUEBRA ao recompilar (`não sei procurar ""`), igual ao
  // `acessa:` de mais acima. E não dá para emitir só o `sem ele:`, porque o
  // compilador exige que ele venha DEPOIS de um `precisa de ...`. Então o bloco
  // inteiro é condicional. O schema já proíbe esse estado (`from` é required
  // com `minItems: 1`), então aqui é a rede embaixo da rede.
  const ondeProcurar = (exige?.from || []).map((f) => ONDE_PROCURAR[f] || f).join(' ou ')
  if (exige && ondeProcurar) {
    const onde = ondeProcurar
    h(`precisa de ${EXIGENCIAS[exige.kind] || exige.kind}: ${onde}`)
    if (exige.missingText) {
      // "ele" para link, "ela" para mídia — a linguagem é em português, e
      // concordar custa uma linha.
      h(`${exige.kind === 'media' ? 'sem ela' : 'sem ele'}: ${citar(exige.missingText)}`)
    }
  }

  if (gatilho.type === 'trigger.command') {
    // A linha mostra o que a pessoa vai digitar: os nomes com o separador no
    // meio. Guardar separador e nomes em campos distintos e escrever os dois
    // seria mostrar a estrutura em vez do uso.
    if (cfg.args?.names?.length) {
      h(`argumentos: ${cfg.args.names.join(` ${cfg.args.separator} `)}`)
    }
    h(`casa: ${CASAMENTOS[cfg.match] || cfg.match}`)
  } else if (gatilho.type === 'trigger.group') {
    if (Array.isArray(cfg.actions) && cfg.actions.length) {
      h(`quando for: ${cfg.actions.map((a) => ACOES_DE_GRUPO[a] || a).join(', ')}`)
    }
  } else if (!agendado) {
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
  if (gatilho.type !== 'trigger.group' && !agendado) {
    h(`quem: ${ORIGENS[cfg.allowFrom] || cfg.allowFrom}`)
  }
  if (cfg.requireOwner === true && !agendado) h('só dono')
  if (typeof cfg.access === 'string' && !agendado) h(`acesso: ${cfg.access}`)
  if (cfg.requireAdmin === true && !agendado) h('acesso: admins')
  if (typeof cfg.requireList === 'string' && !agendado) h(`acesso: lista ${cfg.requireList}`)

  linhas.push('')

  conferirEstrutura(documento.flow)
  const estrutura = documento.flow.structure || inferirEstrutura(documento.flow, gatilho.id)
  const ordem = [gatilho.id]
  function escreverCondicao (item, indent, palavra = BLOCOS_DE_CONDICAO.se) {
    ordem.push(item.nodeId)
    const c = mapa.get(item.nodeId).config
    linhas.push(`${IDENT.repeat(indent)}${palavra} ${escreverOperando(c.left)} ${OPERADORES[c.operator] || c.operator} ${escreverOperando(c.right)}`)
    escreverBloco(item.true, indent + 1)
    if (item.elseIf) {
      escreverCondicao(item.false[0], indent, BLOCOS_DE_CONDICAO.senaoSe)
    } else if (item.false) {
      linhas.push(`${IDENT.repeat(indent)}${BLOCOS_DE_CONDICAO.senao}`)
      escreverBloco(item.false, indent + 1)
    }
  }
  function escreverBloco (itens, indent) {
    for (const item of itens) {
      if (typeof item === 'string') {
        ordem.push(item)
        for (const l of linhaDeAcao(mapa.get(item))) linhas.push(`${IDENT.repeat(indent)}${l}`)
      } else {
        escreverCondicao(item, indent)
      }
    }
  }
  escreverBloco(estrutura, 1)

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
  linhas.push(`# nós: ${ordem.join(', ')}`)

  return linhas.join('\n') + '\n'
}
