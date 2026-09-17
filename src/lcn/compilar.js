// Texto `.lcn` -> documento de automação.
//
// COMPILA, nunca interpreta. O resultado é o mesmo grafo de nós que o motor já
// executava antes da linguagem existir, e passa pelo mesmo schema e pelo mesmo
// publish. Um `.lcn` malicioso no máximo produz JSON que a validação rejeita —
// o mesmo portão do JSON escrito à mão. É isto que deixa a linguagem existir
// sem reabrir a decisão de não executar código de usuário.
import {
  ACOES, CASAMENTOS, DESTINOS, OPERADORES, ORIGENS, TIPOS_DE_MENSAGEM,
  acaoPorPalavra, inverter
} from './vocabulario.js'

export class ErroDeSintaxe extends Error {
  constructor (mensagem, linha) {
    super(linha ? `linha ${linha}: ${mensagem}` : mensagem)
    this.linha = linha
  }
}

const CASAMENTO_POR_PALAVRA = inverter(CASAMENTOS)
const ORIGEM_POR_PALAVRA = inverter(ORIGENS)
const TIPO_POR_PALAVRA = inverter(TIPOS_DE_MENSAGEM)
const OPERADOR_POR_SIMBOLO = inverter(OPERADORES)
const DESTINO_POR_PALAVRA = inverter(DESTINOS)

function descitar (bruto, linha) {
  const texto = bruto.trim()
  if (!texto.startsWith('"')) throw new ErroDeSintaxe(`esperava texto entre aspas, veio ${texto || '(vazio)'}`, linha)
  try {
    return JSON.parse(texto)
  } catch {
    throw new ErroDeSintaxe('texto entre aspas malformado', linha)
  }
}

function medirIndentacao (linha) {
  const m = linha.match(/^( *)/)
  return Math.floor(m[1].length / 2)
}

// Ignora linha vazia e comentário, MENOS o rodapé de nomes dos nós, que é dado.
function tokenizar (texto) {
  const linhas = []
  let nomes = null
  texto.split('\n').forEach((bruta, i) => {
    const semFim = bruta.replace(/\s+$/, '')
    if (!semFim.trim()) return
    const nomeados = semFim.trim().match(/^#\s*nós:\s*(.*)$/)
    if (nomeados) { nomes = nomeados[1].split(',').map((s) => s.trim()).filter(Boolean); return }
    if (semFim.trim().startsWith('#')) return
    linhas.push({ indent: medirIndentacao(semFim), texto: semFim.trim(), n: i + 1 })
  })
  return { linhas, nomes }
}

function lerEscopoEChave (bruto, linha) {
  // "chat", "group_member:categoria", "sender"
  const [escopo, categoria] = String(bruto).split(':')
  if (!escopo) throw new ErroDeSintaxe('faltou o escopo da variável', linha)
  return { scope: escopo, categoryKey: categoria }
}

function lerOperando (bruto, linha) {
  const texto = bruto.trim()
  if (texto.startsWith('"')) return { source: 'literal', value: descitar(texto, linha) }
  // Sem aspas e parecendo número ou sim/não, o literal MANTÉM o tipo — a
  // comparação é tipada, e transformar 3 em "3" faria `"10" >= "3"` virar
  // falso sem nada avisando.
  if (/^-?\d+(\.\d+)?$/.test(texto)) return { source: 'literal', value: Number(texto) }
  if (texto === 'true' || texto === 'false') return { source: 'literal', value: texto === 'true' }
  const varMatch = texto.match(/^var\s+(\S+)\s+(\S+)$/)
  if (varMatch) {
    const { scope, categoryKey } = lerEscopoEChave(varMatch[1], linha)
    return { source: 'variable', scope, key: varMatch[2], ...(categoryKey ? { categoryKey } : {}) }
  }
  const eventoMatch = texto.match(/^evento\s+(\S+)$/)
  if (eventoMatch) return { source: 'event', field: eventoMatch[1] }
  throw new ErroDeSintaxe(`não entendi o operando "${texto}"`, linha)
}

function lerDestino (bruto, linha) {
  const texto = bruto.trim()
  for (const [palavra, kind] of Object.entries(DESTINO_POR_PALAVRA)) {
    if (texto === palavra) return { kind }
    if (texto.startsWith(`${palavra} `)) {
      return { kind, id: texto.slice(palavra.length + 1).trim() }
    }
  }
  throw new ErroDeSintaxe(`destino desconhecido: "${texto}"`, linha)
}

// Monta um nó de ação a partir da linha e das linhas indentadas sob ela.
function lerAcao (linha, filhas) {
  const def = acaoPorPalavra(linha.texto)
  if (!def) throw new ErroDeSintaxe(`não conheço a ação "${linha.texto.split(' ')[0]}"`, linha.n)

  if (def.forma === 'variavel') {
    const m = linha.texto.match(/^\S+(?:\s+\S+)?\s+(\S+)\s+(\S+)\s*=\s*(.+)$/)
    const sobra = linha.texto.slice(def.palavra.length).trim()
    const mm = sobra.match(/^(\S+)\s+(\S+)\s*=\s*(.+)$/)
    if (!mm) throw new ErroDeSintaxe(`esperava "${def.palavra} <escopo> <chave> = <valor>"`, linha.n)
    const { scope, categoryKey } = lerEscopoEChave(mm[1], linha.n)
    const config = { scope, key: mm[2] }
    if (categoryKey) config.categoryKey = categoryKey
    if (def.palavra === 'soma') {
      const n = Number(mm[3].trim())
      if (!Number.isInteger(n)) throw new ErroDeSintaxe('"soma" precisa de um número inteiro', linha.n)
      config.by = n
    } else {
      config.value = descitar(mm[3], linha.n)
    }
    return { type: def.tipo, config }
  }

  const config = {}
  const inline = def.campos.find((c) => c.inline)
  const sobra = linha.texto.slice(def.palavra.length).trim()
  if (sobra) {
    if (!inline) throw new ErroDeSintaxe(`"${def.palavra}" não recebe valor na mesma linha`, linha.n)
    config[inline.chave] = descitar(sobra, linha.n)
  }

  for (const filha of filhas) {
    const sep = filha.texto.indexOf(':')
    if (sep < 0) throw new ErroDeSintaxe(`esperava "campo: valor", veio "${filha.texto}"`, filha.n)
    const rotulo = filha.texto.slice(0, sep).trim()
    const valor = filha.texto.slice(sep + 1).trim()
    const campo = def.campos.find((c) => c.rotulo === rotulo)
    if (!campo) throw new ErroDeSintaxe(`"${def.palavra}" não tem campo "${rotulo}"`, filha.n)
    if (campo.tipo === 'texto') config[campo.chave] = descitar(valor, filha.n)
    else if (campo.tipo === 'booleano') config[campo.chave] = valor === 'sim' || valor === 'true'
    else if (campo.tipo === 'numero') config[campo.chave] = Number(valor)
    else config[campo.chave] = valor
  }
  return { type: def.tipo, config }
}

export function compilar (texto) {
  const { linhas, nomes } = tokenizar(texto)
  if (!linhas.length) throw new ErroDeSintaxe('arquivo vazio')

  const cabeca = linhas[0]
  if (cabeca.indent !== 0) throw new ErroDeSintaxe('a primeira linha precisa começar na margem', cabeca.n)

  const gatilhoConfig = {}
  let tipoDoGatilho
  const comando = cabeca.texto.match(/^comando\s+(\S+)$/)
  if (comando) {
    tipoDoGatilho = 'trigger.command'
    gatilhoConfig.command = comando[1]
  } else if (cabeca.texto === 'ao receber mensagem') {
    tipoDoGatilho = 'trigger.message'
  } else {
    throw new ErroDeSintaxe('a automação começa com "comando /x" ou "ao receber mensagem"', cabeca.n)
  }

  const doc = {
    schemaVersion: 1,
    enabled: true,
    name: '',
    scope: { include: [], exclude: [] },
    inputPolicy: { acceptedMessageKinds: [], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: '' },
    flow: { nodes: [], edges: [] }
  }
  let display = null

  // --- cabeçalho ----------------------------------------------------------
  let i = 1
  for (; i < linhas.length; i++) {
    const l = linhas[i]
    if (l.indent !== 1) break
    if (acaoPorPalavra(l.texto) || l.texto.startsWith('se ')) break

    if (l.texto === 'só dono') { gatilhoConfig.requireOwner = true; continue }
    if (l.texto === 'com link') { gatilhoConfig.containsLink = true; continue }
    if (l.texto === 'desligada') { doc.enabled = false; continue }

    const sep = l.texto.indexOf(':')
    // Sem dois-pontos, a linha estava querendo ser uma AÇÃO — e é isso que a
    // pessoa precisa ouvir. Dizer "não entendi" aqui manda procurar erro de
    // cabeçalho quem só escreveu o nome da ação errado.
    if (sep < 0) {
      throw new ErroDeSintaxe(`não conheço a ação "${l.texto.split(' ')[0]}"`, l.n)
    }
    const chave = l.texto.slice(0, sep).trim()
    const valor = l.texto.slice(sep + 1).trim()

    switch (chave) {
      case 'id': doc.id = valor; break
      case 'revisão': doc.revision = Number(valor); break
      case 'nome': doc.name = valor; break
      case 'menu': {
        const [rotulo, ...resto] = valor.split('—')
        display = { menuLabel: rotulo.trim() }
        if (resto.length) display.menuDescription = resto.join('—').trim()
        break
      }
      case 'onde': doc.scope.include.push(lerDestino(valor, l.n)); break
      case 'menos': doc.scope.exclude.push(lerDestino(valor, l.n)); break
      case 'pool': doc.responder.poolId = valor; break
      case 'histórico': doc.inputPolicy.historyPolicy = valor; break
      case 'tipos':
        doc.inputPolicy.acceptedMessageKinds = valor.split(',').map((t) => {
          const limpo = t.trim()
          const cod = TIPO_POR_PALAVRA[limpo]
          if (!cod) throw new ErroDeSintaxe(`tipo de mensagem desconhecido: "${limpo}"`, l.n)
          return cod
        })
        break
      case 'casa': {
        const cod = CASAMENTO_POR_PALAVRA[valor]
        if (!cod) throw new ErroDeSintaxe(`modo de casamento desconhecido: "${valor}"`, l.n)
        gatilhoConfig.match = cod
        break
      }
      case 'de': {
        const cod = ORIGEM_POR_PALAVRA[valor]
        if (!cod) throw new ErroDeSintaxe(`origem desconhecida: "${valor}"`, l.n)
        gatilhoConfig.allowFrom = cod
        break
      }
      case 'quando for':
        gatilhoConfig.messageKinds = valor.split(',').map((t) => {
          const cod = TIPO_POR_PALAVRA[t.trim()]
          if (!cod) throw new ErroDeSintaxe(`tipo desconhecido: "${t.trim()}"`, l.n)
          return cod
        })
        break
      case 'palavras':
        gatilhoConfig.keywords = valor.split(',').map((p) => descitar(p, l.n))
        break
      default: throw new ErroDeSintaxe(`não conheço o campo "${chave}"`, l.n)
    }
  }

  if (display) doc.display = display

  // --- corpo --------------------------------------------------------------
  const nos = [{ id: null, type: tipoDoGatilho, config: gatilhoConfig }]
  const arestas = []

  // Junta cada ação com as linhas indentadas sob ela.
  function lerBloco (indentAlvo, ate) {
    const acoes = []
    while (i < ate) {
      const l = linhas[i]
      if (l.indent !== indentAlvo) break
      if (l.texto.startsWith('se ') || l.texto === 'senão') break
      i++
      const filhas = []
      while (i < ate && linhas[i].indent === indentAlvo + 1 && !acaoPorPalavra(linhas[i].texto)) {
        filhas.push(linhas[i]); i++
      }
      acoes.push(lerAcao(l, filhas))
    }
    return acoes
  }

  const prelude = lerBloco(1, linhas.length)
  let condicao = null
  let ramoTrue = []
  let ramoFalse = []

  if (i < linhas.length && linhas[i].texto.startsWith('se ')) {
    const l = linhas[i]; i++
    const corpo = l.texto.slice(3).trim()
    const simbolo = Object.values(OPERADORES)
      .sort((a, b) => b.length - a.length)
      .find((s) => corpo.includes(` ${s} `))
    if (!simbolo) throw new ErroDeSintaxe('a condição precisa de um operador', l.n)
    const pos = corpo.indexOf(` ${simbolo} `)
    condicao = {
      type: 'condition.compare',
      config: {
        left: lerOperando(corpo.slice(0, pos), l.n),
        operator: OPERADOR_POR_SIMBOLO[simbolo],
        right: lerOperando(corpo.slice(pos + simbolo.length + 2), l.n)
      }
    }
    ramoTrue = lerBloco(2, linhas.length)
    if (i < linhas.length && linhas[i].texto === 'senão') {
      i++
      ramoFalse = lerBloco(2, linhas.length)
    }
  }

  // --- montar o grafo -----------------------------------------------------
  const gerados = []
  const empilhar = (no) => { nos.push(no); gerados.push(no); return no }
  for (const a of prelude) empilhar(a)
  if (condicao) {
    empilhar(condicao)
    for (const a of ramoTrue) empilhar(a)
    for (const a of ramoFalse) empilhar(a)
  }

  // Nomes: o rodapé manda, e o que faltar é gerado. Editar o texto não pode
  // exigir manter uma lista de ids em dia — quem escreve automação não pensa
  // em id de nó.
  const usados = new Set()
  nos.forEach((no, idx) => {
    const doRodape = nomes && nomes[idx]
    let nome = doRodape || (no.type.startsWith('trigger.') ? 'gatilho' : no.type.split('.').pop())
    if (usados.has(nome)) {
      let n = 2
      while (usados.has(`${nome}-${n}`)) n++
      nome = `${nome}-${n}`
    }
    usados.add(nome)
    no.id = nome
  })

  // Arestas: prelúdio em cadeia a partir do gatilho, condição no fim com os
  // dois ramos. É a forma que os templates já usavam — validate.js exige
  // exatamente isso.
  const gatilho = nos[0]
  const emCadeia = (primeiro, lista, de, rotulo) => {
    let anterior = de
    let label = rotulo
    for (const no of lista) {
      arestas.push({ from: anterior, to: no.id, on: label })
      anterior = no.id
      label = 'success'
    }
    return anterior
  }

  const fimDoPrelude = emCadeia(null, prelude, gatilho.id, 'matched')
  if (condicao) {
    arestas.push({ from: fimDoPrelude, to: condicao.id, on: prelude.length ? 'success' : 'matched' })
    emCadeia(null, ramoTrue, condicao.id, 'true')
    emCadeia(null, ramoFalse, condicao.id, 'false')
  }

  doc.flow.nodes = nos
  doc.flow.edges = arestas
  return doc
}
