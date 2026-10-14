import fs from 'fs'
import path from 'path'
import Ajv from 'ajv'
import { fileURLToPath } from 'url'

const arquivoSchema = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema', 'automation.v1.schema.json')
const schema = JSON.parse(fs.readFileSync(arquivoSchema, 'utf8'))
const ajv = new Ajv({ allErrors: true, strict: false })
const validarSchema = ajv.compile(schema)

function caminhoAjv (erro) {
  if (erro.keyword === 'required') return `${erro.instancePath}/${erro.params.missingProperty}` || '/'
  if (erro.keyword === 'additionalProperties') return `${erro.instancePath}/${erro.params.additionalProperty}` || '/'
  return erro.instancePath || '/'
}

function temCiclo (ids, edges) {
  const adjacencias = new Map([...ids].map((id) => [id, []]))
  for (const edge of edges) {
    if (ids.has(edge?.from) && ids.has(edge?.to)) adjacencias.get(edge.from).push(edge.to)
  }

  const visitando = new Set()
  const visitados = new Set()
  const visitar = (id) => {
    if (visitando.has(id)) return true
    if (visitados.has(id)) return false
    visitando.add(id)
    for (const destino of adjacencias.get(id) || []) {
      if (visitar(destino)) return true
    }
    visitando.delete(id)
    visitados.add(id)
    return false
  }
  return [...ids].some(visitar)
}

export function validarAutomacao (db, documento) {
  const erros = []
  if (!validarSchema(documento)) {
    for (const erro of validarSchema.errors || []) {
      erros.push({ path: caminhoAjv(erro), message: erro.message || 'valor inválido' })
    }
  }

  const nodes = Array.isArray(documento?.flow?.nodes) ? documento.flow.nodes : []
  const edges = Array.isArray(documento?.flow?.edges) ? documento.flow.edges : []
  const ids = new Set()
  nodes.forEach((node, indice) => {
    if (typeof node?.id !== 'string' || !node.id) return
    if (ids.has(node.id)) erros.push({ path: `/flow/nodes/${indice}/id`, message: `id de nó duplicado: ${node.id}` })
    ids.add(node.id)
  })

  edges.forEach((edge, indice) => {
    if (typeof edge?.from === 'string' && !ids.has(edge.from)) {
      erros.push({ path: `/flow/edges/${indice}/from`, message: `nó inexistente: ${edge.from}` })
    }
    if (typeof edge?.to === 'string' && !ids.has(edge.to)) {
      erros.push({ path: `/flow/edges/${indice}/to`, message: `nó inexistente: ${edge.to}` })
    }
  })

  const saidasPorEvento = new Set()
  edges.forEach((edge, indice) => {
    if (typeof edge?.from !== 'string' || typeof edge?.on !== 'string') return
    const chave = JSON.stringify([edge.from, edge.on])
    if (saidasPorEvento.has(chave)) {
      erros.push({
        path: `/flow/edges/${indice}/on`,
        message: `o nó ${edge.from} não pode ter mais de uma aresta de saída com on '${edge.on}'`
      })
    } else {
      saidasPorEvento.add(chave)
    }
  })

  if (temCiclo(ids, edges)) erros.push({ path: '/flow/edges', message: 'o fluxo não pode conter ciclo' })

  // maxTriggers:1 era anunciado em runtimeCapabilities mas nunca imposto aqui,
  // e o avaliador usa .find() — com dois gatilhos, o segundo era ignorado em
  // silêncio e a automação parecia publicada e correta.
  const gatilhos = nodes.filter((node) => typeof node?.type === 'string' && node.type.startsWith('trigger.'))
  if (!gatilhos.length) {
    erros.push({ path: '/flow/nodes', message: 'o fluxo precisa de exatamente um gatilho' })
  } else if (gatilhos.length > 1) {
    erros.push({ path: '/flow/nodes', message: `o fluxo só aceita um gatilho, mas tem ${gatilhos.length}` })
  }

  // Cada tipo de nó só pode sair pelas arestas que ele de fato produz. Sem
  // isso dá pra publicar uma condição ligada por 'success' (que nunca
  // dispara) ou uma ação ligada por 'true' — fluxo que morre calado.
  const tipoPorId = new Map(nodes.filter((n) => typeof n?.id === 'string').map((n) => [n.id, n.type]))
  const SAIDAS_ADMITIDAS = {
    trigger: new Set(['matched']),
    condition: new Set(['true', 'false']),
    action: new Set(['success'])
  }
  edges.forEach((edge, indice) => {
    const tipo = tipoPorId.get(edge?.from)
    if (typeof tipo !== 'string') return
    const familia = tipo.split('.')[0]
    const admitidas = SAIDAS_ADMITIDAS[familia]
    if (admitidas && typeof edge?.on === 'string' && !admitidas.has(edge.on)) {
      erros.push({
        path: `/flow/edges/${indice}/on`,
        message: `${tipo} não produz a saída '${edge.on}' (aceita: ${[...admitidas].join(', ')})`
      })
    }
  })

  // Uma condição sem os dois caminhos é meia decisão: o lado faltante encerra
  // o fluxo em silêncio, que é exatamente o que a ramificação veio evitar.
  nodes.forEach((node, indice) => {
    if (node?.type !== 'condition.compare') return
    for (const lado of ['true', 'false']) {
      const temSaida = edges.some((e) => e.from === node.id && e.on === lado)
      if (!temSaida) {
        erros.push({ path: `/flow/nodes/${indice}`, message: `a condição ${node.id} precisa de uma saída '${lado}'` })
      }
    }
  })

  const connectionExiste = db.prepare('SELECT 1 FROM connections WHERE id = ?')
  const conexaoCompleta = db.prepare('SELECT config_json FROM connections WHERE id = ?')
  nodes.forEach((node, indice) => {
    const ref = node?.type === 'action.http' ? node.config?.connectionRef : null
    if (typeof ref === 'string' && ref && !connectionExiste.get(ref)) {
      erros.push({ path: `/flow/nodes/${indice}/config/connectionRef`, message: `conexão inexistente: ${ref}` })
    }
  })

  // A chamada de função é conferida CONTRA A DECLARAÇÃO, na publicação.
  //
  // O portão importa porque o erro seria caro do outro lado: uma função com nome
  // trocado ou uma entrada obrigatória faltando só apareceria quando alguém
  // usasse o comando, e o serviço recusaria com uma mensagem que ninguém liga à
  // automação. Recusar aqui transforma isso em erro de publicação, com caminho.
  nodes.forEach((node, indice) => {
    if (node?.type !== 'action.connection.call') return
    const caminho = `/flow/nodes/${indice}/config`
    const ref = node.config?.connectionRef
    const linha = typeof ref === 'string' && ref ? conexaoCompleta.get(ref) : null
    if (!linha) {
      erros.push({ path: `${caminho}/connectionRef`, message: `conexão inexistente: ${ref}` })
      return
    }
    let config = null
    try { config = JSON.parse(linha.config_json) } catch { config = null }
    const funcoes = Array.isArray(config?.funcoes) ? config.funcoes : []
    const funcao = funcoes.find((f) => f.nome === node.config?.function)
    if (!funcao) {
      const disponiveis = funcoes.map((f) => f.nome).join(', ') || 'nenhuma declarada'
      erros.push({
        path: `${caminho}/function`,
        message: `a conexão "${ref}" não tem a função "${node.config?.function}". Declaradas: ${disponiveis}.`
      })
      return
    }

    const informadas = node.config?.inputs && typeof node.config.inputs === 'object' ? node.config.inputs : {}

    // A entrada de ARQUIVO não vive em `inputs` — ela é nomeada em
    // `mediaInput`, porque o token não pode passar pelo interpolador. Aqui é o
    // lugar de conferir que os dois lados concordam: o nome existe na função, e
    // é de fato a entrada de mídia. Sem isto, trocar o nome na declaração
    // deixaria o comando mandando arquivo num campo que o serviço ignora.
    const entradaDeMidia = (funcao.entradas || []).find((e) => e.tipo === 'mídia')
    const nomeDeMidia = typeof node.config?.mediaInput === 'string' ? node.config.mediaInput.trim() : ''
    if (nomeDeMidia) {
      if (!entradaDeMidia) {
        erros.push({ path: `${caminho}/mediaInput`, message: `a função "${funcao.nome}" não recebe arquivo.` })
      } else if (entradaDeMidia.nome !== nomeDeMidia) {
        erros.push({
          path: `${caminho}/mediaInput`,
          message: `a entrada de arquivo da função "${funcao.nome}" se chama "${entradaDeMidia.nome}", não "${nomeDeMidia}".`
        })
      }
    } else if (entradaDeMidia && entradaDeMidia.obrigatoria !== false) {
      erros.push({
        path: `${caminho}/mediaInput`,
        message: `a função "${funcao.nome}" precisa do arquivo em "${entradaDeMidia.nome}" — diga de onde ele vem.`
      })
    }

    for (const entrada of funcao.entradas || []) {
      // Já conferida acima, e ela nunca aparece em `inputs`.
      if (entrada.tipo === 'mídia') continue
      const temValor = Object.hasOwn(informadas, entrada.nome) && String(informadas[entrada.nome] ?? '').trim()
      const temPadrao = entrada.padrao !== undefined && entrada.padrao !== null && entrada.padrao !== ''
      if (entrada.obrigatoria !== false && !temValor && !temPadrao) {
        erros.push({ path: `${caminho}/inputs/${entrada.nome}`, message: `a função "${funcao.nome}" precisa da entrada "${entrada.nome}".` })
      }
      // Valor FIXO fora da lista é erro agora; valor com variável só dá para
      // conferir em tempo de execução, e recusar aqui impediria o uso legítimo.
      if (entrada.tipo === 'opção' && temValor) {
        const valor = String(informadas[entrada.nome]).trim()
        if (!valor.includes('{{') && !(entrada.opcoes || []).includes(valor)) {
          erros.push({
            path: `${caminho}/inputs/${entrada.nome}`,
            message: `"${valor}" não é uma escolha de "${entrada.nome}" (${(entrada.opcoes || []).join(', ')}).`
          })
        }
      }
    }
    // A entrada de mídia fica FORA deste conjunto de propósito: escrevê-la em
    // `inputs` é engano, e um engano que passaria calado. Ali o valor é
    // interpolado como texto, então o serviço receberia a string que a pessoa
    // escreveu em vez do arquivo — e a chamada falharia do outro lado.
    const declaradas = new Set((funcao.entradas || []).filter((e) => e.tipo !== 'mídia').map((e) => e.nome))
    for (const nome of Object.keys(informadas)) {
      if (declaradas.has(nome)) continue
      if (entradaDeMidia && nome === entradaDeMidia.nome) {
        erros.push({
          path: `${caminho}/inputs/${nome}`,
          message: `"${nome}" é a entrada de ARQUIVO da função "${funcao.nome}" e não vai aqui — diga de onde o arquivo vem, não um valor de texto.`
        })
        continue
      }
      // Entrada que a função não declara seria descartada em silêncio, e quem
      // escreveu ficaria esperando um efeito que nunca vem.
      erros.push({ path: `${caminho}/inputs/${nome}`, message: `a função "${funcao.nome}" não recebe "${nome}".` })
    }
  })

  const poolId = documento?.responder?.poolId
  if (typeof poolId === 'string' && poolId) {
    const poolExiste = db.prepare('SELECT 1 FROM pools WHERE id = ?').get(poolId)
    if (!poolExiste) erros.push({ path: '/responder/poolId', message: `pool inexistente: ${poolId}` })
  }

  return erros
}

export const validarDocumentoAutomacao = validarAutomacao
