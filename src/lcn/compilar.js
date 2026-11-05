// Texto `.lcn` -> documento de automação.
//
// COMPILA, nunca interpreta. O resultado é o mesmo grafo de nós que o motor já
// executava antes da linguagem existir, e passa pelo mesmo schema e pelo mesmo
// publish. Um `.lcn` malicioso no máximo produz JSON que a validação rejeita —
// o mesmo portão do JSON escrito à mão. É isto que deixa a linguagem existir
// sem reabrir a decisão de não executar código de usuário.
import {
  ACOES, ACOES_DE_GRUPO, BLOCOS_DE_CONDICAO, PROFUNDIDADE_CONDICOES_PADRAO, CAMPOS_DO_CABECALHO, CAMPOS_DO_TEMPLATE, CASAMENTOS, CLASSES, DESTINOS, EXIGENCIAS,
  MARCAS_DO_CABECALHO, NIVEIS_DE_AVISO, ONDE_PROCURAR, OPERADORES, OPERACOES_ARITMETICAS, ORIGENS, PRIORIDADES,
  TIPOS_DE_CONFIG, TIPOS_DE_MENSAGEM, TIPOS_DE_VALOR,
  acaoPorPalavra, inverter
} from './vocabulario.js'
import { numeroDeCalculo } from '../engine/server/aritmetica.js'
import { arestasDaEstrutura, precisaEstrutura } from './estrutura.js'
import { interpretarTempo } from './tempo.js'

export class ErroDeSintaxe extends Error {
  constructor (mensagem, linha) {
    super(linha ? `linha ${linha}: ${mensagem}` : mensagem)
    this.linha = linha
  }
}

const CASAMENTO_POR_PALAVRA = inverter(CASAMENTOS)
const ORIGEM_POR_PALAVRA = inverter(ORIGENS)
const PRIORIDADE_POR_PALAVRA = inverter(PRIORIDADES)
const TIPO_POR_PALAVRA = inverter(TIPOS_DE_MENSAGEM)
const ACAO_DE_GRUPO_POR_PALAVRA = inverter(ACOES_DE_GRUPO)
const OPERADOR_POR_SIMBOLO = inverter(OPERADORES)
const DESTINO_POR_PALAVRA = inverter(DESTINOS)
const CONFIG_POR_PALAVRA = inverter(TIPOS_DE_CONFIG)
const AVISO_POR_PALAVRA = inverter(NIVEIS_DE_AVISO)
const VALOR_POR_PALAVRA = inverter(TIPOS_DE_VALOR)

const INCOMPATIVEIS_COM_PORTEIRO = Object.freeze({
  'com link': '"com link" não se aplica a porteiro: eventos de grupo não contêm links.',
  'só link de mídia': '"só link de mídia" não se aplica a porteiro: eventos de grupo não contêm links.',
  'também em comandos': '"também em comandos" não se aplica a porteiro: eventos de grupo não são comandos.',
  'dispara com': 'um porteiro não usa "dispara com": ele monitora a porta do grupo, use "quando for: entrou | saiu | promoveu | rebaixou | mudou o nome"',
  'acessa': '"acessa" não se aplica a porteiro: um porteiro observa eventos de entrada, saída e moderação de grupo, não mensagens.',
  'argumentos': '"argumentos" não se aplica a porteiro: um porteiro não tem texto nem parâmetros após comando.',
  'precisa de um link': '"precisa de um link" não se aplica a porteiro: eventos de grupo não trazem mensagens para exigir link ou arquivo.',
  'precisa de uma mídia': '"precisa de uma mídia" não se aplica a porteiro: eventos de grupo não trazem mensagens para exigir link ou arquivo.',
  'sem ele': '"sem ele" não se aplica a porteiro: eventos de grupo não trazem mensagens.',
  'sem ela': '"sem ela" não se aplica a porteiro: eventos de grupo não trazem mensagens.',
  'menu': '"menu" não se aplica a porteiro: eventos de grupo não aparecem no menu de comandos.',
  'histórico': '"histórico" não se aplica a porteiro: eventos de grupo ocorrem sempre em tempo real.',
  'casa': '"casa" não se aplica a porteiro: modo de casamento é exclusivo de comandos digitados.',
  'quem': '"quem" não se aplica a porteiro: eventos de grupo ocorrem sempre dentro do grupo.',
  'palavras': '"palavras" não se aplica a porteiro: eventos de grupo não contêm texto de conversa.'
})

// O agendado acorda pelo relógio: não há mensagem, remetente nem argumentos. Cada
// campo que pressupõe um deles é recusado na linha, dizendo por quê — aceitar
// calado produziria uma automação que nunca poderia casar.
const SEM_MENSAGEM = 'um agendado acorda pelo relógio, sem mensagem de ninguém'
const INCOMPATIVEIS_COM_AGENDADO = Object.freeze({
  'com link': `"com link" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'só link de mídia': `"só link de mídia" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'também em comandos': `"também em comandos" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'dispara com': 'um agendado não usa "dispara com": ele acorda por "agenda:", como "agenda: daqui 30 minutos" ou "agenda: 23/08/2030 às 14:30"',
  'acessa': `"acessa" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'argumentos': `"argumentos" não se aplica a agendado: ${SEM_MENSAGEM}, então não há texto para dividir.`,
  'precisa de um link': `"precisa de um link" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'precisa de uma mídia': `"precisa de uma mídia" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'sem ele': `"sem ele" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'sem ela': `"sem ela" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'menu': '"menu" não se aplica a agendado: ninguém o digita, então não há o que listar.',
  'histórico': '"histórico" não se aplica a agendado: ele acorda sempre em tempo real.',
  'casa': '"casa" não se aplica a agendado: modo de casamento é exclusivo de comandos digitados.',
  'quem': '"quem" não se aplica a agendado: não há quem acionar. Quem publicou a automação é quem responde por ela.',
  'palavras': `"palavras" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'quando for': `"quando for" não se aplica a agendado: ${SEM_MENSAGEM}.`,
  'menos': '"menos" não se aplica a agendado: ele fala só com os destinos de "onde".',
  'só dono': `"só dono" não se aplica a agendado: ${SEM_MENSAGEM}.`
})

// Tudo que depende de uma mensagem, de quem a mandou ou do que veio depois do
// comando. Num agendado esses marcadores nunca teriam valor.
const DEPENDE_DE_MENSAGEM = /\{\{\s*(?:message|sender|args|quoted|link|media)[.\s}]/

// Num TEMPLATE, onde a automação teria um valor fechado há um marcador
// (`{{params.allowFrom}}`) — quem instala é que escolhe. Validar o enum aqui
// recusaria todo template parametrizado; deixar passar qualquer coisa
// esconderia erro de digitação. Marcador passa, o resto é conferido.
const ehMarcador = (texto) => /^\{\{[^{}]+\}\}$/.test(String(texto).trim())

// Os campos e as linhas soltas que valem para a classe declarada, para a
// mensagem de erro poder dizer o que existe. `vale` é 'comando', 'vigia',
// 'porteiro', array de classes ou 'ambos'; sem classe declarada ainda, oferece tudo.
function camposQueValem (tipoDoGatilho) {
  const classe = CLASSES[tipoDoGatilho] || null
  const serve = (item) => {
    if (!classe) return true
    if (item.vale === 'ambos' || item.vale === 'todos') return true
    if (Array.isArray(item.vale)) return item.vale.includes(classe)
    return item.vale === classe
  }
  const campos = CAMPOS_DO_CABECALHO.filter(serve).map((c) => `${c.chave}:`)
  const marcas = MARCAS_DO_CABECALHO.filter(serve).map((m) => m.chave)
  return `Conheço: ${campos.join(', ')} — e as linhas soltas: ${marcas.join(', ')}.`
}

function traduzir (mapa, valor, oQue, linha) {
  const limpo = String(valor).trim()
  if (ehMarcador(limpo)) return limpo
  const codigo = mapa[limpo]
  if (!codigo) {
    const feminino = oQue.startsWith('ação') || oQue.endsWith('a')
    const genero = feminino ? 'desconhecida' : 'desconhecido'
    const opcoes = Object.keys(mapa).join(', ')
    throw new ErroDeSintaxe(`${oQue} ${genero}: "${limpo}". Use: ${opcoes}.`, linha)
  }
  return codigo
}

function descitar (bruto, linha) {
  const texto = bruto.trim()
  if (!texto.startsWith('"')) throw new ErroDeSintaxe(`esperava texto entre aspas, veio ${texto || '(vazio)'}`, linha)
  try {
    return JSON.parse(texto)
  } catch {
    throw new ErroDeSintaxe('texto entre aspas malformado', linha)
  }
}

// Os tipos de campo que o vocabulário pode declarar.
//
// `palavra` e `operando` chegam aqui quando o campo não traz lista de palavras
// (o `language` do bloco de código é assim): aí o valor segue como texto, que
// é o certo. O que NÃO pode seguir é um tipo escrito errado — foi assim que
// 'número' com acento virou texto em silêncio e quebrou a ida e volta só na
// recompilação.
const TIPOS_DE_CAMPO = new Set(['texto', 'palavra', 'booleano', 'numero', 'operando'])

function medirIndentacao (linha, numero) {
  const prefixo = linha.match(/^\s*/)[0]
  // Arredondar três espaços para um nível mudava o ramo sem avisar.
  if (/[^ ]/.test(prefixo) || prefixo.length % 2) {
    throw new ErroDeSintaxe('a indentação usa dois espaços por nível, sem tabulação', numero)
  }
  return prefixo.length / 2
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
    linhas.push({ indent: medirIndentacao(semFim, i + 1), texto: semFim.trim(), n: i + 1 })
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

function lerCalculo (texto, linha) {
  // Operandos tipados, como na condição. O operador fica ENTRE eles, com
  // espaços: hífen numa chave e sinal num número não viram subtração.
  const op = '(?:var\\s+\\S+\\s+\\S+|evento\\s+\\S+|"(?:[^"\\\\]|\\\\.)*"|\\{\\{[^{}]+\\}\\}|[^\\s]+)'
  const m = texto.trim().match(new RegExp(`^(${op})\\s+([+*/×÷-])\\s+(${op})$`))
  if (!m) throw new ErroDeSintaxe('escreva um cálculo com dois operandos e um operador (+, -, *, /), separados por espaços', linha)
  const ler = (bruto) => {
    // O marcador pertence ao formulário do TEMPLATE; no runtime o operando
    // já está tipado. Não é autorização para expressão dentro de {{...}}.
    if (/^\{\{params\.[A-Za-z_][A-Za-z0-9_]*\}\}$/.test(bruto)) return { source: 'literal', value: bruto }
    if (/^(var|evento)\s/.test(bruto)) return lerOperando(bruto, linha)
    const valor = bruto.startsWith('"') ? descitar(bruto, linha) : bruto
    try {
      const numero = numeroDeCalculo(valor)
      return { source: 'literal', value: bruto.startsWith('"') ? valor : numero }
    } catch (erro) { throw new ErroDeSintaxe(erro.message, linha) }
  }
  const simbolo = m[2] === '×' ? '*' : m[2] === '÷' ? '/' : m[2]
  return { left: ler(m[1]), operator: inverter(OPERACOES_ARITMETICAS)[simbolo], right: ler(m[3]) }
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
    if (def.palavra === 'calcula') {
      if (filhas.length) throw new ErroDeSintaxe('"calcula" não tem campos indentados; escreva uma operação por linha', filhas[0].n)
      Object.assign(config, lerCalculo(mm[3], linha.n))
    } else if (def.palavra === 'sorteia') {
      // Duas formas, e a segunda existe porque a linguagem não manipula lista:
      //   sorteia local dado = 1 até 6
      //   sorteia local prato = entre "pizza, pastel, sushi"
      // Quem tem a coleção faz o trabalho — mesma ideia do sorteio de membro.
      const bruto = mm[3].trim()
      const entre = bruto.match(/^entre\s+(.+)$/)
      if (entre) {
        config.entre = descitar(entre[1], linha.n)
      } else {
        const faixa = bruto.match(/^(\S+)\s+at[ée]\s+(\S+)$/)
        if (!faixa) {
          throw new ErroDeSintaxe('"sorteia" aceita "<de> até <até>" ou \'entre "um, outro"\'', linha.n)
        }
        const lerNumero = (x) => {
          if (ehMarcador(x)) return x
          const n = Number(x)
          if (!Number.isInteger(n)) throw new ErroDeSintaxe(`"sorteia" precisa de números inteiros; veio "${x}"`, linha.n)
          return n
        }
        config.minimo = lerNumero(faixa[1])
        config.maximo = lerNumero(faixa[2])
      }
    } else if (def.palavra === 'soma') {
      const bruto = mm[3].trim()
      // Num TEMPLATE o passo pode ser o buraco que quem instala preenche,
      // igual a qualquer outro campo numérico. Sem esta exceção, `soma chat x
      // = {{params.passo}}` era erro de sintaxe — a única família de campo em
      // que o marcador não valia.
      if (ehMarcador(bruto)) {
        config.by = bruto
      } else {
        const n = Number(bruto)
        if (!Number.isInteger(n)) throw new ErroDeSintaxe('"soma" precisa de um número inteiro', linha.n)
        config.by = n
      }
    } else {
      config.value = descitar(mm[3], linha.n)
    }
    return { type: def.tipo, config }
  }

  const sobra = linha.texto.slice(def.palavra.length).trim()

  if (def.tipo === 'action.whatsapp.buttons') {
    const config = {}
    if (sobra) config.text = descitar(sobra, linha.n)
    const buttons = []
    for (const filha of filhas) {
      if (filha.texto.startsWith('botão ') || filha.texto.startsWith('botao ')) {
        const resto = filha.texto.slice(filha.texto.indexOf(' ') + 1).trim()
        let rotulo, comando
        if (resto.startsWith('"')) {
          let fim = -1
          let esc = false
          for (let i = 1; i < resto.length; i++) {
            if (esc) { esc = false; continue }
            if (resto[i] === '\\') { esc = true; continue }
            if (resto[i] === '"') { fim = i; break }
          }
          if (fim < 0) throw new ErroDeSintaxe('esperava texto entre aspas no botão', filha.n)
          rotulo = JSON.parse(resto.slice(0, fim + 1))
          const depois = resto.slice(fim + 1).trim()
          if (depois.startsWith(':')) {
            const cmd = depois.slice(1).trim()
            comando = cmd.startsWith('"') ? descitar(cmd, filha.n) : cmd
          } else {
            comando = rotulo
          }
        } else {
          const sep = resto.indexOf(':')
          if (sep >= 0) {
            rotulo = resto.slice(0, sep).trim()
            const cmd = resto.slice(sep + 1).trim()
            comando = cmd.startsWith('"') ? descitar(cmd, filha.n) : cmd
          } else {
            rotulo = resto
            comando = resto
          }
        }
        if (buttons.length >= 3) {
          throw new ErroDeSintaxe('o WhatsApp aceita no máximo 3 botões de resposta rápida', filha.n)
        }
        buttons.push({ text: rotulo, command: comando })
        continue
      }
      const sep = filha.texto.indexOf(':')
      if (sep < 0) throw new ErroDeSintaxe(`esperava "campo: valor", veio "${filha.texto}"`, filha.n)
      const rotulo = filha.texto.slice(0, sep).trim()
      const valor = filha.texto.slice(sep + 1).trim()
      if (rotulo === 'rodapé' || rotulo === 'rodape') {
        config.footer = descitar(valor, filha.n)
      } else if (rotulo === 'senão' || rotulo === 'senao') {
        config.fallbackText = descitar(valor, filha.n)
      } else {
        throw new ErroDeSintaxe(`"${def.palavra}" não tem campo "${rotulo}"`, filha.n)
      }
    }
    if (!buttons.length) {
      throw new ErroDeSintaxe('"responde com botões" precisa de pelo menos um botão declarado', linha.n)
    }
    config.buttons = buttons
    return { type: def.tipo, config }
  }

  if (def.tipo === 'action.whatsapp.carousel') {
    const config = {}
    if (sobra) config.text = descitar(sobra, linha.n)
    const cards = []
    let cardAtual = null
    const baseIndent = filhas[0]?.indent ?? (linha.indent + 1)
    for (let i = 0; i < filhas.length; i++) {
      const filha = filhas[i]
      if (filha.texto === 'card' && filha.indent === baseIndent) {
        cardAtual = {}
        cards.push(cardAtual)
        continue
      }
      if (cardAtual && filha.indent > baseIndent) {
        if (filha.texto.startsWith('botão ') || filha.texto.startsWith('botao ') || filha.texto.startsWith('botão:') || filha.texto.startsWith('botao:')) {
          let resto = filha.texto.replace(/^(botão|botao)[: ]\s*/, '')
          let rotulo, comando
          if (resto.startsWith('"')) {
            let fim = -1
            let esc = false
            for (let k = 1; k < resto.length; k++) {
              if (esc) { esc = false; continue }
              if (resto[k] === '\\') { esc = true; continue }
              if (resto[k] === '"') { fim = k; break }
            }
            if (fim > 0) {
              rotulo = descitar(resto.slice(0, fim + 1), filha.n)
              const depois = resto.slice(fim + 1).trim()
              if (depois.startsWith(':')) {
                const cmd = depois.slice(1).trim()
                comando = cmd.startsWith('"') ? descitar(cmd, filha.n) : cmd
              } else {
                comando = rotulo
              }
            } else {
              rotulo = descitar(resto, filha.n)
              comando = rotulo
            }
          } else {
            const sep = resto.indexOf(':')
            if (sep >= 0) {
              rotulo = resto.slice(0, sep).trim()
              const cmd = resto.slice(sep + 1).trim()
              comando = cmd.startsWith('"') ? descitar(cmd, filha.n) : cmd
            } else {
              rotulo = resto
              comando = resto
            }
          }
          cardAtual.buttonText = rotulo
          if (/^https?:\/\//i.test(comando)) cardAtual.buttonUrl = comando
          else cardAtual.buttonCommand = comando
          continue
        }
        const sep = filha.texto.indexOf(':')
        if (sep < 0) throw new ErroDeSintaxe(`esperava "campo: valor", veio "${filha.texto}"`, filha.n)
        const chave = filha.texto.slice(0, sep).trim()
        const valor = filha.texto.slice(sep + 1).trim()
        if (chave === 'arquivo') {
          const val = descitar(valor, filha.n)
          if (/^[0-9a-f]{24}$/.test(val)) cardAtual.fileId = val
          else cardAtual.path = val
        } else if (chave === 'título' || chave === 'titulo') {
          cardAtual.title = descitar(valor, filha.n)
        } else if (chave === 'corpo') {
          cardAtual.body = descitar(valor, filha.n)
        } else if (chave === 'rodapé' || chave === 'rodape') {
          cardAtual.footer = descitar(valor, filha.n)
        } else {
          throw new ErroDeSintaxe(`card não tem campo "${chave}"`, filha.n)
        }
        continue
      }
      cardAtual = null
      const sep = filha.texto.indexOf(':')
      if (sep < 0) throw new ErroDeSintaxe(`esperava "campo: valor", veio "${filha.texto}"`, filha.n)
      const rotulo = filha.texto.slice(0, sep).trim()
      const valor = filha.texto.slice(sep + 1).trim()
      if (rotulo === 'pasta') config.folder = descitar(valor, filha.n)
      else if (rotulo === 'botão' || rotulo === 'botao') config.buttonText = descitar(valor, filha.n)
      else if (rotulo === 'comando') config.buttonCommand = descitar(valor, filha.n)
      else if (rotulo === 'rodapé' || rotulo === 'rodape') config.footer = descitar(valor, filha.n)
      else if (rotulo === 'estilo') {
        const est = ehMarcador(valor) ? valor : valor.trim()
        config.estilo = est
      }
      else if (rotulo === 'sem arquivo') config.notFoundText = descitar(valor, filha.n)
      else if (rotulo === 'senão' || rotulo === 'senao') config.fallbackText = descitar(valor, filha.n)
      else throw new ErroDeSintaxe(`campo desconhecido em "mostra carrossel": "${rotulo}"`, filha.n)
    }
    if (cards.length) config.cards = cards
    if (!config.folder && !cards.length) {
      throw new ErroDeSintaxe('"mostra carrossel" precisa de uma pasta do acervo ou de pelo menos um card', linha.n)
    }
    return { type: def.tipo, config }
  }

  const config = {}
  const inline = def.campos.find((c) => c.inline)
  if (sobra) {
    // `chama midia.baixar` — a conexão e a função na mesma linha. Ler as duas
    // juntas é o que faz a leitura dizer de cara de QUEM o comando depende, que
    // era exatamente o que faltava no `baixa`.
    if (def.alvo) {
      // O ponto que separa precisa estar FORA de um marcador: um template
      // escreve `chama {{params.conexao}}.baixar`, e o primeiro ponto dali é o
      // de dentro do marcador. Separar nele produzia a conexão "{{params" e a
      // função "conexao}}.baixar" — e o documento saía errado sem erro nenhum.
      let profundidade = 0
      let ponto = -1
      for (let k = 0; k < sobra.length; k++) {
        if (sobra.startsWith('{{', k)) { profundidade++; k++; continue }
        if (sobra.startsWith('}}', k)) { profundidade--; k++; continue }
        if (sobra[k] === '.' && profundidade === 0) { ponto = k; break }
      }
      if (ponto <= 0 || ponto === sobra.length - 1) {
        throw new ErroDeSintaxe(`"${def.palavra}" espera "conexão.função", veio "${sobra}"`, linha.n)
      }
      config[def.alvo.conexao] = sobra.slice(0, ponto).trim()
      config[def.alvo.funcao] = sobra.slice(ponto + 1).trim()
    } else if (!inline) {
      throw new ErroDeSintaxe(`"${def.palavra}" não recebe valor na mesma linha`, linha.n)
    } else {
      config[inline.chave] = descitar(sobra, linha.n)
    }
  } else if (def.alvo) {
    throw new ErroDeSintaxe(`"${def.palavra}" precisa dizer qual conexão e qual função, como "chama midia.baixar"`, linha.n)
  }

  // O bloco de campos ABERTOS. As entradas são o que a conexão declarou, e o
  // compilador não pode conhecê-las: se conhecesse, o serviço estaria fixo no
  // código de novo.
  const base = linha.indent + 1
  if (def.mapa) {
    const mapa = {}
    let dentro = false
    // Quantas linhas de arquivo já foram escritas neste bloco: a primeira vai
    // para `mediaInput`, a segunda para `mediaInput2`.
    let arquivosEscritos = 0
    for (const filha of filhas) {
      if (filha.indent === base && filha.texto === def.mapa.bloco) { dentro = true; continue }
      if (filha.indent === base) { dentro = false; continue }
      if (!dentro || filha.indent !== base + 1) continue
      const sep = filha.texto.indexOf(':')
      if (sep < 0) throw new ErroDeSintaxe(`esperava "entrada: valor", veio "${filha.texto}"`, filha.n)
      // Entre aspas quando tem espaço ou marcador; palavra solta quando é um
      // valor simples (`modo: auto`). Exigir aspas sempre encheria de cerimônia
      // o caso mais comum.
      const cru = filha.texto.slice(sep + 1).trim()
      // `o link` aponta para o que o cabeçalho declarou precisar. É o que
      // substitui `"{{quoted.link}} {{message.link}}"` — a string que esconde
      // um algoritmo. O marcador interno existe porque o motor interpola; a
      // linguagem nunca o mostra.
      if (cru === 'o link') { mapa[filha.texto.slice(0, sep).trim()] = '{{precisa.link}}'; continue }
      // `a mídia` é um ARQUIVO, e ele NÃO entra no mapa de entradas: o que vai
      // para o serviço são bytes, não texto interpolado. Fica num campo
      // próprio, que diz só QUAL entrada da função recebe o arquivo.
      //
      // A PRIMEIRA linha de arquivo do bloco é `mediaInput`; a segunda,
      // `mediaInput2`. São duas porque existe função de duas fotos (trocar o
      // fundo), e a mensagem de comando carrega duas: a citada e a anexada.
      const dicionario = def.arquivos?.find((a) => cru === a.palavra)
      if (dicionario) {
        const sufixo = arquivosEscritos === 0 ? '' : '2'
        if (arquivosEscritos >= 2) {
          throw new ErroDeSintaxe('uma chamada recebe no máximo dois arquivos', filha.n)
        }
        config[`${dicionario.chave}${sufixo}`] = filha.texto.slice(0, sep).trim()
        if (dicionario.valor) config[`${dicionario.origem}${sufixo}`] = dicionario.valor
        arquivosEscritos++
        continue
      }
      // Entre aspas é TEXTO, sempre. Sem aspas, o tipo é o que a entrada
      // declarada espera: um campo de peso recebe número, e a entrada da
      // conexão tem tipo. Antes tudo virava texto, e o número instalado pelo
      // formulário voltava como string — a ida e volta deixava de bater, que é
      // o sinal de que a linguagem está perdendo informação.
      //
      // Quem quer a STRING "512" escreve com aspas. É a mesma convenção da
      // condição, onde `>= 3` compara número e `>= "3"` compara texto.
      const nome = filha.texto.slice(0, sep).trim()
      if (cru.startsWith('"')) { mapa[nome] = descitar(cru, filha.n); continue }
      if (/^-?\d+(\.\d+)?$/.test(cru)) { mapa[nome] = Number(cru); continue }
      if (cru === 'true' || cru === 'false') { mapa[nome] = cru === 'true'; continue }
      mapa[nome] = cru
    }
    if (Object.keys(mapa).length) config[def.mapa.chave] = mapa
  }

  for (const filha of filhas) {
    // O bloco aberto já foi lido acima; suas linhas não são campos da ação.
    if (def.mapa && (filha.texto === def.mapa.bloco || filha.indent > base)) continue
    const sep = filha.texto.indexOf(':')
    if (sep < 0) throw new ErroDeSintaxe(`esperava "campo: valor", veio "${filha.texto}"`, filha.n)
    const rotulo = filha.texto.slice(0, sep).trim()
    const valor = filha.texto.slice(sep + 1).trim()
    const campo = def.campos.find((c) => c.rotulo === rotulo)
    if (!campo) throw new ErroDeSintaxe(`"${def.palavra}" não tem campo "${rotulo}"`, filha.n)
    if (campo.tipo === 'texto') config[campo.chave] = descitar(valor, filha.n)
    else if (campo.tipo === 'booleano') {
      // MESMA EXCEÇÃO DO NÚMERO E DA OPÇÃO, e a falta dela aqui era a pior das
      // três: `{{params.x}}` não é "sim" nem "true", então virava `false`
      // CALADO. O campo ficava no documento com o valor errado, e quem
      // instalou escolhendo "sim" recebia o contrário sem nada avisando.
      // Apareceu instalando o comando de página: `dentroDoApp: true` saiu
      // `inApp: false`.
      if (!ehMarcador(valor) && !['sim', 'não', 'nao', 'true', 'false'].includes(valor)) {
        throw new ErroDeSintaxe(`"${rotulo}" aceita sim ou não; veio "${valor}"`, filha.n)
      }
      config[campo.chave] = ehMarcador(valor) ? valor : (valor === 'sim' || valor === 'true')
    }
    else if (campo.tipo === 'numero') {
      // Mesma razão do `ehMarcador` logo abaixo, e o mesmo defeito que lá já
      // estava resolvido: num TEMPLATE o valor pode ser o buraco que quem
      // instala preenche. `Number('{{params.tamanho}}')` é NaN, e NaN vira
      // `null` no JSON — o campo sumiria do documento sem erro nenhum.
      config[campo.chave] = ehMarcador(valor) ? valor : Number(valor)
    }
    else if (campo.palavras) {
      // `{{params.x}}` num template NÃO é palavra da lista: é o buraco que quem
      // instala preenche. Traduzir aqui recusaria o catálogo inteiro na carga —
      // `auto-download.lcn` escreve exatamente `modo: {{params.modo}}`.
      if (ehMarcador(valor)) { config[campo.chave] = valor; continue }
      // Aceita a palavra legível OU o código do documento.
      //
      // Escrever é que é opinativo: o descompilador sempre devolve a palavra em
      // português. Aceitar o código na entrada custa nada e evita transformar
      // cada tradução nova numa migração obrigatória de todos os .lcn que já
      // existem — inclusive os que alguém escreveu fora deste repositório.
      const porPalavra = Object.keys(campo.palavras).find((k) => campo.palavras[k] === valor)
      const codigo = porPalavra || (campo.palavras[valor] ? valor : null)
      if (!codigo) {
        // Lista fechada: recusar o desconhecido aqui, com a linha, evita gerar
        // um documento que o publish rejeitaria depois sem dizer onde foi.
        const validas = Object.values(campo.palavras).join(', ')
        throw new ErroDeSintaxe(`"${rotulo}" aceita: ${validas} — veio "${valor}"`, filha.n)
      }
      config[campo.chave] = codigo
    } else if (campo.tipo && !TIPOS_DE_CAMPO.has(campo.tipo)) {
      // TIPO DESCONHECIDO É ERRO, e não "trata como texto".
      //
      // Isto custou uma ida e volta quebrada: um campo declarado como
      // 'número' (com acento) não casava com 'numero', caía aqui calado e
      // virava string. O documento compilava, o render funcionava, e a
      // diferença só aparecia ao recompilar o texto descompilado — ou seja,
      // num teste, e não antes. Errar o nome do tipo agora é recusado na cara.
      throw new ErroDeSintaxe(`o campo "${rotulo}" foi declarado com um tipo que não existe: "${campo.tipo}"`, filha.n)
    } else config[campo.chave] = valor
  }
  return { type: def.tipo, config }
}

// Lê os blocos que pertencem ao TEMPLATE, não à automação: o formulário que
// quem instala preenche, as variáveis que o comando usa, e os avisos.
//
// O bloco `configurável` é o pedido do dono: quem escreve o comando declara o
// esquema, e quem usa configura pelo painel sem abrir arquivo nenhum. Os quatro
// tipos são os que ele pediu — digitar livremente, escolher da lista, número, e
// liga/desliga.
function lerBlocosDeTemplate (linhas, inicio, template) {
  let i = inicio
  const filhasDe = (indentAlvo) => {
    const out = []
    while (i < linhas.length && linhas[i].indent === indentAlvo) { out.push(linhas[i]); i++ }
    return out
  }

  while (i < linhas.length) {
    const l = linhas[i]
    if (l.indent !== 0) break

    if (l.texto === 'configurável') {
      i++
      while (i < linhas.length && linhas[i].indent === 1) {
        const decl = linhas[i]; i++
        const m = decl.texto.match(/^(\S+):\s*([^=(]+?)\s*(?:\(([^)]*)\))?\s*(?:=\s*(.+))?$/)
        if (!m) throw new ErroDeSintaxe(`esperava "chave: tipo [= padrão]"`, decl.n)
        const tipo = CONFIG_POR_PALAVRA[m[2].trim()]
        if (!tipo) throw new ErroDeSintaxe(`tipo de configuração desconhecido: "${m[2].trim()}"`, decl.n)
        const param = { key: m[1], type: tipo }
        if (m[3] !== undefined) param.options = m[3].split(',').map((o) => o.trim()).filter(Boolean)
        // As duas metades do "escolher da lista" precisam andar juntas.
        //
        // Sem isto o compilador aceitava `opção` e produzia { type: 'enum' },
        // que o schema do template rejeitava — e como o catálogo valida TODO
        // arquivo na carga, um único .lcn com `opção` derrubava o catálogo
        // inteiro, não só ele mesmo. Recusar aqui, com o número da linha, é o
        // que transforma isso num erro que se conserta em dez segundos.
        if (tipo === 'enum' && !param.options?.length) {
          throw new ErroDeSintaxe('"opção" precisa da lista de escolhas entre parênteses, ex.: modo: opção (auto, video)', decl.n)
        }
        if (tipo !== 'enum' && param.options) {
          throw new ErroDeSintaxe(`lista de opções só vale com o tipo "${TIPOS_DE_CONFIG.enum}" — em "${m[2].trim()}" ela seria ignorada`, decl.n)
        }
        if (m[4] !== undefined) {
          const cru = m[4].trim()
          if (tipo === 'number') param.default = Number(cru)
          else if (tipo === 'boolean') param.default = cru === 'sim' || cru === 'true'
          else if (cru.startsWith('"')) param.default = descitar(cru, decl.n)
          else param.default = cru
        }
        for (const f of filhasDe(2)) {
          const sep = f.texto.indexOf(':')
          if (sep < 0) throw new ErroDeSintaxe(`esperava "rótulo:" ou "ajuda:"`, f.n)
          const chave = f.texto.slice(0, sep).trim()
          const valor = f.texto.slice(sep + 1).trim()
          if (chave === 'rótulo') param.label = valor
          else if (chave === 'ajuda') param.help = valor
          // Campo de várias linhas. Serve para o que NASCE com uma linha e
          // ainda assim precisa aceitar várias — o padrão com quebra o painel
          // já reconhece sozinho. Sem isto, um campo de uma linha nunca
          // poderia receber uma segunda, e isso seria teto no meu código.
          else if (chave === 'várias linhas') param.multiline = valor === 'sim' || valor === 'true'
          else throw new ErroDeSintaxe(`configuração não tem campo "${chave}"`, f.n)
        }
        template.parameters.push(param)
      }
      continue
    }

    if (l.texto === 'declara') {
      i++
      while (i < linhas.length && linhas[i].indent === 1) {
        const decl = linhas[i]; i++
        const m = decl.texto.match(/^(\S+)\s+(\S+):\s*(.+)$/)
        if (!m) throw new ErroDeSintaxe('esperava "<escopo> <chave>: <tipo>"', decl.n)
        const valueType = VALOR_POR_PALAVRA[m[3].trim()]
        if (!valueType) throw new ErroDeSintaxe(`tipo de valor desconhecido: "${m[3].trim()}"`, decl.n)
        const variavel = { scope: m[1], key: m[2], valueType }
        const descricao = filhasDe(2).map((f) => f.texto).join(' ')
        if (descricao) variavel.description = descricao
        template.variables.push(variavel)
      }
      continue
    }

    const aviso = l.texto.match(/^avisa\s+(.+)$/)
    if (aviso) {
      i++
      const nivel = AVISO_POR_PALAVRA[aviso[1].trim()]
      if (!nivel) throw new ErroDeSintaxe(`nível de aviso desconhecido: "${aviso[1].trim()}"`, l.n)
      const texto = filhasDe(1).map((f) => f.texto).join(' ')
      template.warnings.push({ level: nivel, text: texto })
      continue
    }

    throw new ErroDeSintaxe(`não conheço o bloco "${l.texto}"`, l.n)
  }
  return i
}

// `agora` só serve para conferir a data do agendado; `permitirPassado` é para quem
// RELÊ um texto já publicado (ida e volta, abrir no editor), que não pode deixar
// de compilar só porque a data venceu. Quem escreve texto novo não passa nada.
export function compilar (texto, { maxProfundidade = process.env.LCN_MAX_PROFUNDIDADE_CONDICOES ?? PROFUNDIDADE_CONDICOES_PADRAO, agora = new Date(), permitirPassado = false } = {}) {
  const limite = Number(maxProfundidade)
  if (!['number', 'string'].includes(typeof maxProfundidade) || !Number.isSafeInteger(limite) || limite < 1) {
    throw new ErroDeSintaxe('maxProfundidade (LCN_MAX_PROFUNDIDADE_CONDICOES) precisa ser um inteiro positivo')
  }
  const { linhas, nomes } = tokenizar(texto)
  if (!linhas.length) throw new ErroDeSintaxe('arquivo vazio')

  // Cabeçalho de template, quando existe. `template x v1` identifica o arquivo
  // como algo instalável, não como uma automação já publicada.
  let template = null
  let base = 0
  const cabTemplate = linhas[0].texto.match(/^template\s+(\S+)\s+v(\d+)$/)
  if (cabTemplate) {
    template = {
      templateId: cabTemplate[1],
      templateVersion: Number(cabTemplate[2]),
      dependsOn: [],
      requiredCapabilities: [],
      variables: [],
      warnings: [],
      parameters: [],
      minEngineVersion: 1
    }
    base = 1
    while (base < linhas.length && linhas[base].indent === 1) {
      const l = linhas[base]; base++
      const sep = l.texto.indexOf(':')
      if (sep < 0) throw new ErroDeSintaxe(`não entendi "${l.texto}"`, l.n)
      const chave = l.texto.slice(0, sep).trim()
      const valor = l.texto.slice(sep + 1).trim()
      if (chave === 'nome') template.name = valor
      else if (chave === 'descrição') template.description = valor
      else if (chave === 'categoria') template.category = valor
      else if (chave === 'motor') template.minEngineVersion = Number(valor)
      else if (chave === 'depende de') template.dependsOn.push(valor)
      else if (chave === 'exige') template.requiredCapabilities.push(valor)
      else {
        throw new ErroDeSintaxe(
          `template não tem campo "${chave}". Conheço: ${CAMPOS_DO_TEMPLATE.map((c) => `${c.chave}:`).join(', ')}.`, l.n
        )
      }
    }
    linhas.splice(0, base)
  }

  const cabeca = linhas[0]
  if (cabeca.indent !== 0) throw new ErroDeSintaxe('a primeira linha precisa começar na margem', cabeca.n)

  // A ABERTURA SÓ IDENTIFICA. O que a automação É virou campo do cabeçalho.
  //
  // Antes a classe estava escondida na palavra de abertura — `comando /x` contra
  // `ao receber mensagem` — como se as duas fossem variação do mesmo gatilho. O
  // dono pediu o contrário: "um campo nas primeiras linhas dizendo o tipo e o
  // que ele necessita pra ser disparado, ou se é de uso contínuo".
  //
  // `automação <id>` numa automação publicada; `automação` sozinha num template,
  // onde o id vem do cabeçalho `template`.
  const gatilhoConfig = {}
  let tipoDoGatilho = null
  const abertura = cabeca.texto.match(/^automação(?:\s+(\S+))?$/)
  if (!abertura) {
    // A forma antiga some, e a mensagem precisa dizer o que fazer — "não
    // entendi" aqui manda procurar erro no lugar errado.
    if (/^comando\s|^ao receber mensagem$/.test(cabeca.texto)) {
      throw new ErroDeSintaxe(
        'a automação agora começa com "automação <id>", e o que ela é vira campo: "tipo: comando" + "dispara com: /x", ou "tipo: vigia"',
        cabeca.n
      )
    }
    throw new ErroDeSintaxe('a automação começa com "automação <id>"', cabeca.n)
  }
  const idDaAbertura = abertura[1] || null

  const doc = {
    schemaVersion: 1,
    enabled: true,
    name: '',
    scope: { include: [], exclude: [] },
    inputPolicy: { acceptedMessageKinds: [], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: '' },
    // Quem não declara urgência fica no meio, e quem não declara o que fazer
    // sem vaga descarta calado: avisar por omissão somaria barulho ao barulho
    // exatamente quando o sistema já está apertado.
    scheduling: { priority: 'normal', onNoSlot: { kind: 'discard' } },
    flow: { nodes: [], edges: [] }
  }
  const display = {}

  // O id entra AQUI, antes do laço do cabeçalho, porque é de onde ele vem: a
  // abertura. Entrar depois punha as chaves `id` e `revision` em ordem trocada
  // em relação ao texto escrito à mão, e a ida e volta deixava de bater por uma
  // diferença que não é diferença nenhuma.
  if (idDaAbertura) doc.id = idDaAbertura

  // --- cabeçalho ----------------------------------------------------------
  // Delimita as linhas do cabeçalho (indentação 1 até a primeira ação ou condição).
  const linhasCabecalho = []
  let i = 1
  for (; i < linhas.length; i++) {
    const l = linhas[i]
    if (l.indent !== 1) break
    if (acaoPorPalavra(l.texto) || /^(se|senão)(?: |$)/.test(l.texto)) break
    linhasCabecalho.push(l)
  }

  // A POLÍTICA DE PRECEDÊNCIA DO CABEÇALHO:
  // 1. Identificar a classe (tipo:) — ela já é única, repetição já é recusada.
  for (const l of linhasCabecalho) {
    const sep = l.texto.indexOf(':')
    if (sep < 0) continue
    const chave = l.texto.slice(0, sep).trim()
    const valor = l.texto.slice(sep + 1).trim()
    if (chave === 'tipo') {
      const achado = Object.keys(CLASSES).find((k) => CLASSES[k] === valor)
      if (!achado) {
        throw new ErroDeSintaxe(`tipo desconhecido: "${valor}". Use: ${Object.values(CLASSES).join(' ou ')}.`, l.n)
      }
      if (tipoDoGatilho) {
        throw new ErroDeSintaxe(
          `"tipo:" aparece duas vezes, dizendo ${CLASSES[tipoDoGatilho]} e depois ${valor}. A classe decide o que todas as outras linhas significam, então escolha uma.`,
          l.n
        )
      }
      tipoDoGatilho = achado
    }
  }

  // Sem tipo não há automação: é a diferença entre algo que alguém digita e algo
  // que fica ligado o tempo todo olhando a conversa.
  //
  // Mas ANTES de cobrar o tipo, um campo que não existe para classe NENHUMA é
  // recusado na linha dele. Sem isto, quem escreve "nomee: errado" e esquece o
  // tipo ouve "falta tipo:" apontando a primeira linha — verdade inútil, porque
  // o erro de verdade é o nome do campo, duas linhas abaixo. Campo inexistente
  // não depende de classe para ser inexistente, então não espera a classe.
  if (!tipoDoGatilho) {
    const conhecidos = new Set(CAMPOS_DO_CABECALHO.map((c) => c.chave))
    const marcas = new Set(MARCAS_DO_CABECALHO.map((m) => m.chave))
    for (const l of linhasCabecalho) {
      if (marcas.has(l.texto)) continue
      const sep = l.texto.indexOf(':')
      if (sep < 0) continue
      const chave = l.texto.slice(0, sep).trim()
      if (!conhecidos.has(chave)) {
        throw new ErroDeSintaxe(`não conheço o campo "${chave}". ${camposQueValem(null)}`, l.n)
      }
    }
    throw new ErroDeSintaxe(`falta "tipo:" — ${Object.values(CLASSES).join(' ou ')}`, cabeca.n)
  }

  let versaoRequires = 0
  const relogio = {}
  let temDisparaCom = false
  let temQuandoFor = false

  // 2. Percorrer os campos NA ORDEM DO ARQUIVO.
  for (const l of linhasCabecalho) {
    const deAgendado = tipoDoGatilho === 'trigger.schedule' && INCOMPATIVEIS_COM_AGENDADO[l.texto]
    if (deAgendado) throw new ErroDeSintaxe(deAgendado, l.n)
    if (l.texto === 'só dono') {
      gatilhoConfig.requireOwner = true
      continue
    }
    if (l.texto === 'com link') {
      if (tipoDoGatilho === 'trigger.group') {
        throw new ErroDeSintaxe(INCOMPATIVEIS_COM_PORTEIRO['com link'], l.n)
      }
      gatilhoConfig.containsLink = true
      continue
    }
    if (l.texto === 'só link de mídia') {
      if (tipoDoGatilho === 'trigger.group') {
        throw new ErroDeSintaxe(INCOMPATIVEIS_COM_PORTEIRO['só link de mídia'], l.n)
      }
      gatilhoConfig.mediaLinkOnly = true
      continue
    }
    if (l.texto === 'também em comandos') {
      if (tipoDoGatilho === 'trigger.group') {
        throw new ErroDeSintaxe(INCOMPATIVEIS_COM_PORTEIRO['também em comandos'], l.n)
      }
      gatilhoConfig.alsoOnCommands = true
      continue
    }
    if (l.texto === 'desligada') {
      doc.enabled = false
      continue
    }

    const sep = l.texto.indexOf(':')
    // Sem dois-pontos, a linha estava querendo ser uma AÇÃO — e é isso que a
    // pessoa precisa ouvir. Dizer "não entendi" aqui manda procurar erro de
    // cabeçalho quem só escreveu o nome da ação errado.
    if (sep < 0) {
      throw new ErroDeSintaxe(`não conheço a ação "${l.texto.split(' ')[0]}"`, l.n)
    }
    const chave = l.texto.slice(0, sep).trim()
    const valor = l.texto.slice(sep + 1).trim()

    // 3. Para cada campo: conferir PRIMEIRO se ele pertence à classe.
    if (tipoDoGatilho === 'trigger.group') {
      const msg = INCOMPATIVEIS_COM_PORTEIRO[chave]
      if (msg) throw new ErroDeSintaxe(msg, l.n)
    }
    if (tipoDoGatilho === 'trigger.schedule') {
      const msg = INCOMPATIVEIS_COM_AGENDADO[chave]
      if (msg) throw new ErroDeSintaxe(msg, l.n)
    }

    // 4. Só se pertencer, validar o CONTEÚDO.
    switch (chave) {
      case 'tipo': {
        // A classe já foi identificada e sua unicidade conferida no passo 1.
        break
      }
      case 'dispara com': {
        temDisparaCom = true
        if (tipoDoGatilho === 'trigger.command') {
          // ATALHOS: "dispara com: /play, /p" — o primeiro é o nome canônico,
          // os outros são apelidos da MESMA automação. A vírgula separa porque
          // é o que uma pessoa escreveria sem ler manual nenhum.
          const palavras = valor.split(',').map((x) => x.trim()).filter(Boolean)
          if (!palavras.length) {
            throw new ErroDeSintaxe('"dispara com" precisa de pelo menos uma palavra, como "/menu"', l.n)
          }
          for (const palavra of palavras) {
            if (/\s/.test(palavra)) {
              throw new ErroDeSintaxe(`um comando dispara com uma palavra só, como "/menu" — veio "${palavra}"`, l.n)
            }
          }
          if (new Set(palavras.map((x) => x.toLowerCase())).size !== palavras.length) {
            throw new ErroDeSintaxe(`a mesma palavra aparece duas vezes em "dispara com": ${valor}`, l.n)
          }
          gatilhoConfig.command = palavras[0]
          // Lista vazia não vira campo: documento antigo e documento novo sem
          // atalho têm de sair IDÊNTICOS, senão a ida e volta quebra para os
          // 108 templates do catálogo de uma vez.
          if (palavras.length > 1) gatilhoConfig.aliases = palavras.slice(1)
        } else if (tipoDoGatilho === 'trigger.message') {
          if (valor !== 'qualquer mensagem') {
            throw new ErroDeSintaxe(
              `um vigia dispara com "qualquer mensagem" — o que ele observa se diz nas linhas seguintes (com link, palavras, quando for). Veio "${valor}"`,
              l.n
            )
          }
        }
        break
      }
      case 'agenda':
      case 'fuso': {
        if (tipoDoGatilho !== 'trigger.schedule') {
          throw new ErroDeSintaxe(
            `"${chave}" é só de agendado — ${CLASSES[tipoDoGatilho] === 'comando' ? 'um comando acorda quando alguém o digita' : 'esta classe acorda por mensagem ou por evento do grupo'}, não pelo relógio.`,
            l.n
          )
        }
        if (relogio[chave]) {
          throw new ErroDeSintaxe(`"${chave}:" aparece duas vezes (linha ${relogio[chave].n}). Escolha uma.`, l.n)
        }
        if (!valor) {
          throw new ErroDeSintaxe(chave === 'agenda' ? 'falta dizer quando. Exemplos: daqui 30 minutos, 23/08/2030 às 14:30, todo dia às 08:00' : 'falta o fuso, como America/Sao_Paulo', l.n)
        }
        // Frase de tempo é lida depois do laço, quando o fuso já é conhecido
        // seja qual for a ordem das linhas.
        relogio[chave] = { valor, n: l.n }
        break
      }
      case 'precisa de um link':
      case 'precisa de uma mídia': {
        const oQue = chave.slice('precisa de '.length)
        const kind = Object.keys(EXIGENCIAS).find((k) => EXIGENCIAS[k] === oQue)
        const onde = valor.split(/\s+ou\s+|,/).map((parte) => {
          const limpo = parte.trim()
          const achado = Object.keys(ONDE_PROCURAR).find((k) => ONDE_PROCURAR[k] === limpo)
          if (!achado) {
            throw new ErroDeSintaxe(
              `não sei procurar "${limpo}". Use: ${Object.values(ONDE_PROCURAR).join(' ou ')}.`, l.n
            )
          }
          return achado
        })
        doc.inputPolicy.requires = { kind, from: onde }
        versaoRequires++
        break
      }
      case 'sem ele':
      case 'sem ela': {
        if (!doc.inputPolicy.requires || versaoRequires === 0) {
          throw new ErroDeSintaxe(`"${chave}" precisa vir depois de "precisa de ..."`, l.n)
        }
        // O `descitar` vem ANTES de decidir se o texto será usado, e a ordem é o
        // conserto de um defeito: pular a entrada descartada pulava também a
        // conferência das aspas, e "sem ele: sem aspas" passava calado quando uma
        // exigência posterior substituía a dele. Texto malformado é erro de escrita
        // em qualquer posição — descartar não é desculpa para não olhar.
        const texto = descitar(valor, l.n)
        // Texto VAZIO é o mesmo que texto nenhum: o motor faz `if (aviso)`
        // (evaluator.js:1552-1553) e não responde em nenhum dos dois casos.
        // Guardar a string vazia não configurava nada e quebrava a ida e volta —
        // o descompilador não escreve a linha, e a recompilação perdia a
        // propriedade. Nada observável muda.
        if (!texto) break
        // O PAR É CONTRATO, e ele mora no vocabulário: cada campo declara de
        // qual exigência depende (`depende`), e a regra sai de lá em vez de um
        // mapa escrito aqui — segunda fonte da verdade é o defeito que este
        // projeto mais sofre.
        //
        // Recusar sem dizer a palavra certa manda a pessoa adivinhar qual das
        // duas é a dela, então a mensagem nomeia a que serve. "ele" para link,
        // "ela" para mídia: a linguagem é em português e o par é concordância.
        const campo = CAMPOS_DO_CABECALHO.find((c) => c.chave === chave)
        const exigenciaDeclarada = `precisa de ${EXIGENCIAS[doc.inputPolicy.requires.kind] || doc.inputPolicy.requires.kind}`
        if (campo?.depende && campo.depende !== exigenciaDeclarada) {
          const certo = CAMPOS_DO_CABECALHO.find((c) => c.depende === exigenciaDeclarada)
          throw new ErroDeSintaxe(
            `"${chave}" é de "${campo.depende}", e aqui está declarado "${exigenciaDeclarada}"${certo ? ` — escreva "${certo.chave}"` : ''}`,
            l.n
          )
        }
        doc.inputPolicy.requires.missingText = texto
        break
      }
      case 'id': doc.id = valor; break
      case 'revisão': doc.revision = Number(valor); break
      case 'nome': doc.name = valor; break
      case 'argumentos': {
        if (tipoDoGatilho !== 'trigger.command') {
          throw new ErroDeSintaxe('"argumentos" é só de comando — um vigia não tem o que vem depois da palavra digitada.', l.n)
        }
        const partes = valor.split(/\s*([^\s\w\u00c0-\u017f])\s*/).filter((x) => x !== '')
        const nomes = partes.filter((_, i) => i % 2 === 0)
        const separadores = [...new Set(partes.filter((_, i) => i % 2 === 1))]
        if (nomes.length < 2 || separadores.length !== 1) {
          throw new ErroDeSintaxe('escreva os nomes separados por um símbolo só, como "argumentos: pacote / autor"', l.n)
        }
        for (const nome of nomes) {
          if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(nome)) {
            throw new ErroDeSintaxe(`nome de argumento inválido: "${nome}" — comece por letra, use letras, números e _`, l.n)
          }
        }
        if (new Set(nomes).size !== nomes.length) {
          throw new ErroDeSintaxe('dois argumentos com o mesmo nome: o segundo apagaria o primeiro', l.n)
        }
        gatilhoConfig.args = { separator: separadores[0], names: nomes }
        break
      }
      case 'menu': {
        // ESCONDER É DIZÍVEL, e precisa ser: o rótulo do menu cai no próprio
        // comando quando `menuLabel` falta (evaluator.js, automacoesVisiveisEm),
        // então apagar a linha NÃO tira o comando da lista — só troca o rótulo
        // por `/comando`. Sem esta palavra, o /menu obrigatoriamente se lista,
        // e quem instalou não tem como mudar isso de dentro do .lcn.
        if (/^(não|nao|oculto|escondido)$/i.test(valor.trim())) {
          display.menuHidden = true
          delete display.menuLabel
          delete display.menuDescription
          break
        }
        delete display.menuHidden
        const [rotulo, ...resto] = valor.split('—')
        display.menuLabel = rotulo.trim()
        // Repetir "menu:" substitui o PAR INTEIRO: antes só o rótulo era
        // reescrito e a descrição da declaração anterior ficava pendurada,
        // metade de cada uma. E descrição VAZIA é o mesmo que descrição
        // nenhuma — o motor lê `menuDescription || null` (evaluator.js:1734),
        // então "menu: X —" com nada depois do travessão não configura coisa
        // alguma, e guardar a string vazia quebrava a ida e volta.
        const descricao = resto.length ? resto.join('—').trim() : ''
        if (descricao) display.menuDescription = descricao
        else delete display.menuDescription
        break
      }
      case 'família': display.family = valor; break
      case 'onde': doc.scope.include.push(lerDestino(valor, l.n)); break
      case 'menos': doc.scope.exclude.push(lerDestino(valor, l.n)); break
      case 'pool': doc.responder.poolId = valor; break
      case 'histórico':
        doc.inputPolicy.historyPolicy = valor
        break
      case 'prioridade': {
        if (ehMarcador(valor)) { doc.scheduling.priority = valor; break }
        const codigo = PRIORIDADE_POR_PALAVRA[valor]
        if (!codigo) {
          throw new ErroDeSintaxe(
            `"prioridade" aceita: ${Object.values(PRIORIDADES).join(', ')} — veio "${valor}"`, l.n
          )
        }
        doc.scheduling.priority = codigo
        break
      }
      case 'sem vaga': {
        if (valor.startsWith('"')) {
          doc.scheduling.onNoSlot = { kind: 'notify', text: descitar(valor, l.n) }
          break
        }
        if (valor === 'descarta') { doc.scheduling.onNoSlot = { kind: 'discard' }; break }
        if (valor === 'tenta de novo') {
          throw new ErroDeSintaxe(
            'ainda não sei "tenta de novo": reexecutar depende de um agendamento que sobreviva a reinício, e ele não existe. Use "descarta" ou um texto entre aspas para avisar.',
            l.n
          )
        }
        throw new ErroDeSintaxe(
          `"sem vaga" aceita descarta, ou um texto entre aspas para avisar — veio "${valor}"`, l.n
        )
      }
      case 'acessa':
        doc.inputPolicy.acceptedMessageKinds = valor.split(',').map((t) => traduzir(TIPO_POR_PALAVRA, t, 'tipo de mensagem', l.n))
        break
      case 'casa':
        gatilhoConfig.match = traduzir(CASAMENTO_POR_PALAVRA, valor, 'modo de casamento', l.n)
        break
      case 'quem':
        gatilhoConfig.allowFrom = traduzir(ORIGEM_POR_PALAVRA, valor, 'quem pode acionar', l.n)
        break
      case 'quando for': {
        if (tipoDoGatilho === 'trigger.group') {
          if (!valor.trim()) {
            throw new ErroDeSintaxe('falta "quando for:" — um porteiro precisa dizer quais ações observa: entrou, saiu, promoveu, rebaixou ou mudou o nome', cabeca.n)
          }
          gatilhoConfig.actions = valor.split(',').map((t) => traduzir(ACAO_DE_GRUPO_POR_PALAVRA, t, 'ação de grupo', l.n))
          temQuandoFor = true
        } else {
          gatilhoConfig.messageKinds = valor.split(',').map((t) => traduzir(TIPO_POR_PALAVRA, t, 'tipo de mensagem', l.n))
          temQuandoFor = true
        }
        break
      }
      case 'palavras':
        gatilhoConfig.keywords = valor.split(',').map((p) => descitar(p, l.n))
        break
      default: throw new ErroDeSintaxe(
        `não conheço o campo "${chave}". ${camposQueValem(tipoDoGatilho)}`, l.n
      )
    }
  }

  // Conferência de campos obrigatórios
  if (tipoDoGatilho === 'trigger.command') {
    if (!temDisparaCom) {
      throw new ErroDeSintaxe('falta "dispara com:" — a palavra que aciona o comando', cabeca.n)
    }
    // O schema do motor exige `match` e `allowFrom` em trigger.command, e o
    // compilador não inventa padrão para nenhum dos dois: `allowFrom` é campo de
    // permissão. Sem esta recusa o documento compila e só é rejeitado com 422 na
    // instalação, longe do editor.
    if (gatilhoConfig.match === undefined) {
      throw new ErroDeSintaxe(`falta "casa:" — como comparar a mensagem. Use: ${Object.values(CASAMENTOS).join(', ')}`, cabeca.n)
    }
    if (gatilhoConfig.allowFrom === undefined) {
      throw new ErroDeSintaxe(`falta "quem:" — quem pode acionar. Use: ${Object.values(ORIGENS).join(', ')}`, cabeca.n)
    }
  } else if (tipoDoGatilho === 'trigger.message') {
    // trigger.message exige só `allowFrom` no schema.
    if (gatilhoConfig.allowFrom === undefined) {
      throw new ErroDeSintaxe(`falta "quem:" — quem pode acionar. Use: ${Object.values(ORIGENS).join(', ')}`, cabeca.n)
    }
  } else if (tipoDoGatilho === 'trigger.group') {
    if (!temQuandoFor) {
      throw new ErroDeSintaxe('falta "quando for:" — um porteiro precisa dizer quais ações observa: entrou, saiu, promoveu, rebaixou ou mudou o nome', cabeca.n)
    }
    // O porteiro observa a porta do grupo, recebendo eventos canônicos de grupo
    // em vez de mensagens normais de conversa.
    doc.inputPolicy.acceptedMessageKinds = ['group']
  } else if (tipoDoGatilho === 'trigger.schedule') {
    if (!relogio.agenda) {
      throw new ErroDeSintaxe('falta "agenda:" — quando acordar. Exemplos: "agenda: daqui 30 minutos", "agenda: 23/08/2030 às 14:30", "agenda: todo dia às 08:00"', cabeca.n)
    }
    const fuso = relogio.fuso ? relogio.fuso.valor : 'America/Sao_Paulo'
    const lido = interpretarTempo(relogio.agenda.valor, { agora, fuso, permitirPassado })
    if (!lido.ok) {
      // Erro de fuso é da linha do fuso; o resto é da linha da agenda.
      const doFuso = /^Fuso desconhecido/.test(lido.erro) && relogio.fuso
      throw new ErroDeSintaxe(lido.erro, doFuso ? relogio.fuso.n : relogio.agenda.n)
    }
    const { ok, fuso: _fuso, passado, ...agenda } = lido
    gatilhoConfig.timezone = fuso
    gatilhoConfig.schedule = agenda
    // Um agendado só fala para onde "onde" mandar: não há conversa de origem.
    // Sem destino certo ele não teria para quem enviar, e destino amplo
    // (todos os grupos, todos os contatos) viraria disparo em massa por relógio.
    const destinos = doc.scope.include
    if (!destinos.length) {
      throw new ErroDeSintaxe('falta "onde:" — um agendado precisa dizer para quem fala, como "onde: grupo 1203630@g.us" ou "onde: contato 5511999990000@s.whatsapp.net"', cabeca.n)
    }
    const ruim = destinos.find((d) => !['group', 'contact'].includes(d.kind) || !d.id)
    if (ruim) {
      throw new ErroDeSintaxe('"onde" de um agendado aceita só um grupo ou um contato específico — o relógio não deve disparar em massa', cabeca.n)
    }
    doc.inputPolicy.acceptedMessageKinds = ['schedule']
  }

  if (Object.keys(display).length) doc.display = display

  // --- corpo --------------------------------------------------------------
  const nos = [{ id: null, type: tipoDoGatilho, config: gatilhoConfig }]
  const ehSe = (texto) => texto.startsWith(`${BLOCOS_DE_CONDICAO.se} `)
  const ehSenao = (texto) => texto === BLOCOS_DE_CONDICAO.senao || texto.startsWith(`${BLOCOS_DE_CONDICAO.senao} `)

  function lerCondicao (indent, profundidade, encadeada = false) {
    const l = linhas[i++]
    if (profundidade > limite) {
      throw new ErroDeSintaxe(`a condição chegou à profundidade ${profundidade}; o limite é ${limite}. Ajuste maxProfundidade ou LCN_MAX_PROFUNDIDADE_CONDICOES.`, l.n)
    }
    const prefixo = encadeada ? BLOCOS_DE_CONDICAO.senaoSe : BLOCOS_DE_CONDICAO.se
    const corpo = l.texto.slice(prefixo.length).trim()
    const simbolo = Object.values(OPERADORES)
      .sort((a, b) => b.length - a.length)
      .find((s) => corpo.includes(` ${s} `))
    if (!simbolo) throw new ErroDeSintaxe('a condição precisa de um operador', l.n)
    const pos = corpo.indexOf(` ${simbolo} `)
    const no = {
      type: 'condition.compare',
      config: {
        left: lerOperando(corpo.slice(0, pos), l.n),
        operator: OPERADOR_POR_SIMBOLO[simbolo],
        right: lerOperando(corpo.slice(pos + simbolo.length + 2), l.n)
      }
    }
    nos.push(no)
    const item = { no, true: lerBloco(indent + 1, profundidade) }
    if (i < linhas.length && linhas[i].indent === indent && ehSenao(linhas[i].texto)) {
      if (linhas[i].texto.startsWith(`${BLOCOS_DE_CONDICAO.senaoSe} `)) {
        item.elseIf = true
        item.false = [lerCondicao(indent, profundidade + 1, true)]
      } else if (linhas[i].texto === BLOCOS_DE_CONDICAO.senao) {
        i++
        item.false = lerBloco(indent + 1, profundidade)
      } else {
        throw new ErroDeSintaxe('escreva "senão" ou "senão se <condição>"', linhas[i].n)
      }
    }
    // O ramo ausente é legítimo; os DOIS vazios escondem uma regra sem efeito.
    // Conferimos antes de ligar a continuação, que não conta como ramo com ação.
    if (!item.true.length && !item.false?.length) {
      throw new ErroDeSintaxe('um "se" precisa de pelo menos um ramo com ação', l.n)
    }
    return item
  }

  function lerBloco (indent, profundidade) {
    const passos = []
    while (i < linhas.length && linhas[i].indent >= indent) {
      const l = linhas[i]
      if (l.indent !== indent) {
        throw new ErroDeSintaxe(`indentação inesperada: este bloco usa ${indent * 2} espaços`, l.n)
      }
      if (ehSenao(l.texto)) {
        throw new ErroDeSintaxe('"senão" precisa vir logo após um "se", na mesma indentação', l.n)
      }
      if (ehSe(l.texto)) {
        passos.push(lerCondicao(indent, profundidade + 1))
        continue
      }
      i++
      const filhas = []
      while (i < linhas.length && linhas[i].indent > indent) {
        const filha = linhas[i]
        // Campos de ação e `com` também têm filhos. Uma condição só pode
        // morar num ramo, nunca virar campo ignorado de uma ação.
        if (ehSe(filha.texto) || ehSenao(filha.texto) || acaoPorPalavra(filha.texto)) {
          throw new ErroDeSintaxe('ação ou condição indentada sob uma ação; alinhe os passos do mesmo bloco', filha.n)
        }
        filhas.push(filha)
        i++
      }
      const no = lerAcao(l, filhas)
      nos.push(no)
      passos.push({ no })
    }
    return passos
  }

  const corpo = lerBloco(1, 0)

  if (tipoDoGatilho === 'trigger.schedule') {
    for (const no of nos.slice(1)) {
      const bruto = JSON.stringify(no.config ?? {})
      const marcador = bruto.match(DEPENDE_DE_MENSAGEM)
      const evento = (bruto.match(/"source":"event","field":"(?:message|sender|args|quoted)[^"]*"/) || [])[0]
      if (marcador || evento) {
        throw new ErroDeSintaxe(
          `um agendado não tem mensagem nem remetente: "${(marcador || [evento])[0].replace(/\\"/g, '"')}" nunca teria valor. Fale do grupo ou da hora com {{chat.…}} e {{now.…}}.`,
          cabeca.n
        )
      }
    }
  }

  // Nomes: o rodapé manda, e o que faltar é gerado. Editar o texto não pode
  // exigir manter uma lista de ids em dia — quem escreve automação não pensa
  // em id de nó.
  const usados = new Set()
  // `usados` só cresce, então todo sufixo abaixo da última dica já está
  // ocupado: retomar dali dá o mesmo menor livre sem reler de 2 a cada nó
  // repetido (20 mil respostas custavam 16 s de laço).
  const proximoSufixo = new Map()
  nos.forEach((no, idx) => {
    const doRodape = nomes && nomes[idx]
    let nome = doRodape || (no.type.startsWith('trigger.') ? 'gatilho' : no.type.split('.').pop())
    if (usados.has(nome)) {
      let n = proximoSufixo.get(nome) ?? 2
      while (usados.has(`${nome}-${n}`)) n++
      proximoSufixo.set(nome, n + 1)
      nome = `${nome}-${n}`
    }
    usados.add(nome)
    no.id = nome
  })

  const descrever = (passos) => passos.map((item) => item.true
    ? { nodeId: item.no.id, true: descrever(item.true),
        ...(item.false ? { false: descrever(item.false) } : {}),
        ...(item.elseIf ? { elseIf: true } : {}) }
    : item.no.id)
  const estrutura = descrever(corpo)
  // As pontas dos dois ramos ficam pendentes até o próximo irmão. Toda
  // ligação vai para um nó novo, posterior na escrita: não há salto para trás.
  const arestas = arestasDaEstrutura(estrutura, nos[0].id)
  if (precisaEstrutura(estrutura)) doc.flow.structure = estrutura

  // Bloco de template só faz sentido em arquivo de template. Deixar cair num
  // objeto descartado seria perder a configuração inteira sem avisar — o
  // formulário simplesmente não apareceria e ninguém saberia por quê.
  if (i < linhas.length) {
    if (!template) {
      throw new ErroDeSintaxe(
        `"${linhas[i].texto}" só existe em arquivo de template (comece com "template <id> v1")`, linhas[i].n)
    }
    lerBlocosDeTemplate(linhas, i, template)
  }

  doc.flow.nodes = nos
  doc.flow.edges = arestas
  return template ? { template, documentTemplate: doc } : doc
}
