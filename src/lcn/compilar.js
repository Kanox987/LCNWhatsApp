// Texto `.lcn` -> documento de automação.
//
// COMPILA, nunca interpreta. O resultado é o mesmo grafo de nós que o motor já
// executava antes da linguagem existir, e passa pelo mesmo schema e pelo mesmo
// publish. Um `.lcn` malicioso no máximo produz JSON que a validação rejeita —
// o mesmo portão do JSON escrito à mão. É isto que deixa a linguagem existir
// sem reabrir a decisão de não executar código de usuário.
import {
  ACOES, CASAMENTOS, CLASSES, DESTINOS, EXIGENCIAS, NIVEIS_DE_AVISO, ONDE_PROCURAR, OPERADORES, ORIGENS,
  TIPOS_DE_CONFIG, TIPOS_DE_MENSAGEM, TIPOS_DE_VALOR,
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
const CONFIG_POR_PALAVRA = inverter(TIPOS_DE_CONFIG)
const AVISO_POR_PALAVRA = inverter(NIVEIS_DE_AVISO)
const VALOR_POR_PALAVRA = inverter(TIPOS_DE_VALOR)

// Num TEMPLATE, onde a automação teria um valor fechado há um marcador
// (`{{params.allowFrom}}`) — quem instala é que escolhe. Validar o enum aqui
// recusaria todo template parametrizado; deixar passar qualquer coisa
// esconderia erro de digitação. Marcador passa, o resto é conferido.
const ehMarcador = (texto) => /^\{\{[^{}]+\}\}$/.test(String(texto).trim())

function traduzir (mapa, valor, oQue, linha) {
  const limpo = String(valor).trim()
  if (ehMarcador(limpo)) return limpo
  const codigo = mapa[limpo]
  if (!codigo) throw new ErroDeSintaxe(`${oQue} desconhecid${oQue.endsWith('a') ? 'a' : 'o'}: "${limpo}"`, linha)
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
      // `a mídia` é o arquivo da mensagem, e ele NÃO entra no mapa de entradas:
      // o que vai para o serviço são bytes, não texto interpolado. Fica num
      // campo próprio, que diz só QUAL entrada da função recebe o arquivo.
      if (def.arquivo && cru === def.arquivo.palavra) {
        config[def.arquivo.chave] = filha.texto.slice(0, sep).trim()
        continue
      }
      mapa[filha.texto.slice(0, sep).trim()] = cru.startsWith('"') ? descitar(cru, filha.n) : cru
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
    else if (campo.tipo === 'booleano') config[campo.chave] = valor === 'sim' || valor === 'true'
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

export function compilar (texto) {
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
      else throw new ErroDeSintaxe(`template não tem campo "${chave}"`, l.n)
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
    flow: { nodes: [], edges: [] }
  }
  let display = null

  // O id entra AQUI, antes do laço do cabeçalho, porque é de onde ele vem: a
  // abertura. Entrar depois punha as chaves `id` e `revision` em ordem trocada
  // em relação ao texto escrito à mão, e a ida e volta deixava de bater por uma
  // diferença que não é diferença nenhuma.
  if (idDaAbertura) doc.id = idDaAbertura

  // --- cabeçalho ----------------------------------------------------------
  let i = 1
  for (; i < linhas.length; i++) {
    const l = linhas[i]
    if (l.indent !== 1) break
    if (acaoPorPalavra(l.texto) || l.texto.startsWith('se ')) break

    if (l.texto === 'só dono') { gatilhoConfig.requireOwner = true; continue }
    if (l.texto === 'com link') { gatilhoConfig.containsLink = true; continue }
    if (l.texto === 'só link de mídia') { gatilhoConfig.mediaLinkOnly = true; continue }
    // Por padrão a regra automática CEDE quando a mensagem já virou comando —
    // senão "/dow <link>" aciona o comando e a regra, e o mesmo link é baixado
    // duas vezes. Esta linha é o jeito de dizer "quero ver o comando também",
    // que é o que uma regra de auditoria precisa.
    if (l.texto === 'também em comandos') { gatilhoConfig.alsoOnCommands = true; continue }
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
      // A CLASSE, e ela é obrigatória — ver a conferência depois do laço.
      case 'tipo': {
        const achado = Object.keys(CLASSES).find((k) => CLASSES[k] === valor)
        if (!achado) {
          throw new ErroDeSintaxe(`tipo desconhecido: "${valor}". Use: ${Object.values(CLASSES).join(' ou ')}.`, l.n)
        }
        tipoDoGatilho = achado
        break
      }
      // O que acorda a automação. Para comando é a palavra digitada; para vigia
      // é "qualquer mensagem", e os filtros (com link, palavras, quando for)
      // refinam em linhas próprias.
      case 'dispara com': {
        if (!tipoDoGatilho) throw new ErroDeSintaxe('"dispara com" precisa vir depois de "tipo:"', l.n)
        if (tipoDoGatilho === 'trigger.command') {
          if (!valor || /\s/.test(valor)) {
            throw new ErroDeSintaxe(`um comando dispara com uma palavra só, como "/menu" — veio "${valor}"`, l.n)
          }
          gatilhoConfig.command = valor
        } else if (valor !== 'qualquer mensagem') {
          throw new ErroDeSintaxe(
            `um vigia dispara com "qualquer mensagem" — o que ele observa se diz nas linhas seguintes (com link, palavras, quando for). Veio "${valor}"`,
            l.n
          )
        }
        break
      }
      // "precisa de um link: na mensagem ou na citada"
      //
      // A chave chega aqui já partida em "precisa de X" + o valor, porque o
      // formato do cabeçalho é "campo: valor". Ver EXIGENCIAS no vocabulário
      // para por que isto existe.
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
        // A ordem escrita é a ordem de procura: "na citada ou na mensagem"
        // olha primeiro a mensagem marcada.
        doc.inputPolicy.requires = { kind, from: onde }
        break
      }
      // Fica junto do que ele guarda — e não perdido entre os textos da ação,
      // que é onde o `sem mídia`/`sem dados` morava.
      case 'sem ele':
      case 'sem ela': {
        if (!doc.inputPolicy.requires) {
          throw new ErroDeSintaxe(`"${chave}" precisa vir depois de "precisa de ..."`, l.n)
        }
        doc.inputPolicy.requires.missingText = descitar(valor, l.n)
        break
      }
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
      // "acessa" e não "tipos": é EXIGÊNCIA, não filtro. O motor não avalia a
      // automação para tipo que não esteja aqui, então um contador que declara
      // só texto NUNCA vê a mensagem de voz — e falha calado. A palavra antiga
      // lia como se fosse preferência.
      case 'acessa':
        doc.inputPolicy.acceptedMessageKinds = valor.split(',').map((t) => traduzir(TIPO_POR_PALAVRA, t, 'tipo de mensagem', l.n))
        break
      case 'casa': gatilhoConfig.match = traduzir(CASAMENTO_POR_PALAVRA, valor, 'modo de casamento', l.n); break
      case 'quem': gatilhoConfig.allowFrom = traduzir(ORIGEM_POR_PALAVRA, valor, 'quem pode acionar', l.n); break
      case 'quando for':
        gatilhoConfig.messageKinds = valor.split(',').map((t) => traduzir(TIPO_POR_PALAVRA, t, 'tipo de mensagem', l.n))
        break
      case 'palavras':
        gatilhoConfig.keywords = valor.split(',').map((p) => descitar(p, l.n))
        break
      default: throw new ErroDeSintaxe(`não conheço o campo "${chave}"`, l.n)
    }
  }

  // Sem tipo não há automação: é a diferença entre algo que alguém digita e algo
  // que fica ligado o tempo todo olhando a conversa. Deixar isso implícito foi o
  // que fez a classe virar detalhe de gatilho.
  if (!tipoDoGatilho) {
    throw new ErroDeSintaxe(`falta "tipo:" — ${Object.values(CLASSES).join(' ou ')}`, cabeca.n)
  }
  if (tipoDoGatilho === 'trigger.command' && !gatilhoConfig.command) {
    throw new ErroDeSintaxe('falta "dispara com:" — a palavra que aciona o comando', cabeca.n)
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
      // Desce MAIS de um nível: a chamada de conexão tem um bloco `com` cujas
      // entradas ficam dois níveis abaixo da ação. Só uma ação irmã, no nível
      // logo abaixo, encerra a coleta.
      while (i < ate && linhas[i].indent > indentAlvo &&
             !(linhas[i].indent === indentAlvo + 1 && acaoPorPalavra(linhas[i].texto))) {
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
