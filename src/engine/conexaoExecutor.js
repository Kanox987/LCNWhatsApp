// Executar uma FUNÇÃO declarada numa conexão.
//
// Este é o lado do gateway do que o motor emite como `connection.call`. A
// fronteira é a de sempre: o motor decidiu QUAL conexão e QUAL função, e passou
// as entradas resolvidas; quem monta a requisição, aplica a credencial, espera
// e carrega bytes é este lado.
//
// O QUE SUBSTITUI. Antes, cada integração exigia uma ação nova no motor e uma
// palavra nova na linguagem — o `baixa` era isso. O dono apontou: "baixar aí
// aparece no código interno e não como configurável pelo dono". Aqui o serviço
// é dado: endereço, método, caminho, entradas e o formato da resposta vêm da
// declaração que ele escreveu na aba Conexões.
//
// O QUE NÃO MUDA. A automação continua sem escolher destino: ela nomeia uma
// função declarada. É isso que dispensa a proteção contra SSRF exigida pelo
// `action.http` genérico — quem aponta o endereço é o dono, não o comando.
import { resolverDestino } from './server/conexoes/declaracao.js'

const TIMEOUT_REQUISICAO_MS = 20000
const ESPERA_ENTRE_CONSULTAS_MS = 1500
const ESPERA_MAXIMA_ENTRE_CONSULTAS_MS = 5000

// O que o serviço chama de tipo, traduzido para o que o WhatsApp aceita.
const TIPO_WHATSAPP = {
  video: 'video',
  audio: 'audio',
  imagem: 'image',
  image: 'image',
  // Figurinha não é "uma imagem com outro nome": é outro tipo de envio no
  // WhatsApp, sem legenda e sem miniatura. Um serviço que converte precisa
  // poder dizer isso, senão o webp chegaria como foto.
  figurinha: 'sticker',
  sticker: 'sticker'
}

// Duas faces do mesmo erro, como no downloader: `message` é o diagnóstico
// (endereço, status, caminho de arquivo) e `paraPessoa` é o que pode ir para o
// WhatsApp. Quem mandou um link não tem o que fazer com endereço interno, e
// mostrar isso vaza a topologia para qualquer um.
export class ErroDeConexao extends Error {
  constructor (mensagem, { paraPessoa } = {}) {
    super(mensagem)
    this.name = 'ErroDeConexao'
    this.paraPessoa = paraPessoa || mensagem
  }
}

const FALHA_NOSSA = 'O serviço que eu consulto para isso está com problema agora. Tente de novo daqui a pouco — se continuar, avise o dono do bot.'

// A credencial entra na requisição do jeito DECLARADO, e nunca de outro.
//
// Header livre deixaria a chave ir em `Host` ou `Cookie`, mexendo no transporte
// em vez de dizer quem é — por isso a forma é tipada.
function aplicarCredencial (url, cabecalhos, { autenticacao, chave, enviaSegredo }) {
  const tipo = autenticacao?.tipo || 'nenhuma'
  // `enviaSegredo` é falso quando a função aponta para OUTRA origem. Mandar a
  // chave desta conexão para lá entregaria a credencial de um serviço a outro
  // — e bastaria alguém editar um campo de caminho sem perceber.
  if (tipo === 'nenhuma' || !chave || !enviaSegredo) return url
  if (tipo === 'bearer') {
    cabecalhos.Authorization = `Bearer ${chave}`
    return url
  }
  if (tipo === 'cabeçalho') {
    cabecalhos[autenticacao.nome] = chave
    return url
  }
  const comParametro = new URL(url)
  comParametro.searchParams.set(autenticacao.nome, chave)
  return comParametro.toString()
}

// As entradas viram corpo ou query, conforme o método. GET não tem corpo, e
// mandar um faria o serviço recusar de um jeito que ninguém liga à automação.
//
// Com ARQUIVO, o corpo deixa de ser JSON e vira multipart — é o único formato
// que leva bytes e campos na mesma requisição sem inventar codificação. O
// `Content-Type` NÃO é escrito à mão aqui de propósito: ele precisa carregar o
// boundary que o FormData gera, e fixá-lo faria o serviço receber um corpo que
// não consegue separar.
function montarRequisicao (url, metodo, entradas, cabecalhos, arquivo) {
  if (metodo === 'GET' || metodo === 'DELETE') {
    const comQuery = new URL(url)
    for (const [nome, valor] of Object.entries(entradas)) comQuery.searchParams.set(nome, String(valor))
    return { url: comQuery.toString(), opcoes: { method: metodo, headers: cabecalhos } }
  }
  if (arquivo) {
    const forma = new FormData()
    for (const [nome, valor] of Object.entries(entradas)) forma.set(nome, String(valor))
    forma.set(arquivo.campo, new Blob([arquivo.buffer], { type: arquivo.mime || 'application/octet-stream' }), arquivo.nome || 'arquivo')
    return { url, opcoes: { method: metodo, headers: cabecalhos, body: forma } }
  }
  return {
    url,
    opcoes: { method: metodo, headers: { ...cabecalhos, 'Content-Type': 'application/json' }, body: JSON.stringify(entradas) }
  }
}

function porCaminho (objeto, caminho) {
  if (!caminho) return objeto
  return String(caminho).split('.').reduce((atual, parte) => (atual == null ? atual : atual[parte]), objeto)
}

export function criarExecutorDeConexao ({
  buscar = fetch,
  dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  agora = () => Date.now(),
  esperaMaximaMs = 300000,
  limiteBytes = 64 * 1024 * 1024
} = {}) {
  async function chamar (url, opcoes) {
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), TIMEOUT_REQUISICAO_MS)
    try {
      return await buscar(url, { ...opcoes, signal: controle.signal })
    } catch {
      // O endereço fica no diagnóstico, não na conversa.
      throw new ErroDeConexao(`Não consegui falar com o serviço (${url}).`, { paraPessoa: FALHA_NOSSA })
    } finally {
      clearTimeout(timer)
    }
  }

  async function jsonOuErro (resposta, oQue) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDeConexao(`O serviço recusou a credencial ao ${oQue} (${resposta.status}).`, { paraPessoa: FALHA_NOSSA })
    }
    if (resposta.status === 429) {
      throw new ErroDeConexao('O serviço pediu para esperar — tem muita coisa na fila agora. Tente de novo daqui a pouco.')
    }
    if (!resposta.ok) {
      throw new ErroDeConexao(`O serviço respondeu ${resposta.status} ao ${oQue}.`, { paraPessoa: FALHA_NOSSA })
    }
    try {
      return await resposta.json()
    } catch {
      throw new ErroDeConexao(`O serviço devolveu uma resposta inesperada ao ${oQue}.`, { paraPessoa: FALHA_NOSSA })
    }
  }

  // Resposta que não vem na hora: o serviço devolve um identificador e a gente
  // pergunta até terminar. Todos os campos vêm da DECLARAÇÃO — era isto que
  // estava fixo dentro do downloader.
  async function acompanharTrabalho (resposta, { base, cabecalhos, resposta: forma, oQueFaz }) {
    const trabalho = porCaminho(resposta, forma.campoDoTrabalho)
    if (!trabalho) {
      throw new ErroDeConexao(`O serviço aceitou o pedido mas não devolveu "${forma.campoDoTrabalho}" para acompanhar.`, { paraPessoa: FALHA_NOSSA })
    }
    const caminho = String(forma.caminhoDeAcompanhamento).replace(/\{[^}]+\}/g, encodeURIComponent(String(trabalho)))
    const url = /^https?:\/\//i.test(caminho) ? caminho : `${base}${caminho}`
    const emAndamento = new Set(forma.estadosEmAndamento.map(String))

    const comeco = agora()
    const limite = comeco + esperaMaximaMs
    let estado = null
    while (agora() < limite) {
      // Passados 30s, perguntar de 5 em 5 em vez de 1,5: o pedido curto
      // continua respondendo rápido, e o longo para de encher o log.
      await dormir(agora() - comeco > 30000 ? ESPERA_MAXIMA_ENTRE_CONSULTAS_MS : ESPERA_ENTRE_CONSULTAS_MS)
      estado = await jsonOuErro(await chamar(url, { method: 'GET', headers: cabecalhos }), `acompanhar ${oQueFaz}`)
      const atual = String(porCaminho(estado, forma.campoDoEstado) ?? '')
      // Estado desconhecido ENCERRA a espera. Girar num estado que esta versão
      // não conhece é pior que parar e dizer o que veio.
      if (!emAndamento.has(atual)) return estado
    }
    throw new ErroDeConexao(`Passou de ${Math.round(esperaMaximaMs / 1000)}s sem terminar, então parei de esperar. Tente de novo.`)
  }

  // `declaracao` é o que a rota interna do motor devolve: endereço,
  // autenticação, funções e a chave já resolvida.
  async function executar (declaracao, nomeDaFuncao, entradas, arquivo = null) {
    const funcao = (declaracao?.funcoes || []).find((f) => f.nome === nomeDaFuncao)
    if (!funcao) {
      // Diagnóstico e conversa separados: o nome da função é detalhe de
      // configuração, não algo que quem digitou o comando possa resolver.
      throw new ErroDeConexao(
        `A conexão "${declaracao?.id}" não tem a função "${nomeDaFuncao}".`,
        { paraPessoa: 'Este comando aponta para algo que não existe mais na configuração. Avise o dono do bot.' }
      )
    }

    const destino = resolverDestino(declaracao.endereco, funcao)
    const cabecalhos = {}
    const url = aplicarCredencial(destino.url, cabecalhos, {
      autenticacao: declaracao.autenticacao,
      chave: declaracao.chave,
      enviaSegredo: destino.enviaSegredo
    })

    // Os padrões declarados entram no que a automação não informou.
    const corpo = { ...entradas }
    for (const entrada of funcao.entradas || []) {
      if (entrada.tipo === 'mídia') continue
      if (corpo[entrada.nome] === undefined && entrada.padrao !== undefined && entrada.padrao !== null && entrada.padrao !== '') {
        corpo[entrada.nome] = entrada.padrao
      }
    }

    // O arquivo vai no campo que a FUNÇÃO declarou, não no que o comando
    // escreveu. Se a declaração mudou e o nome não existe mais, isto é erro de
    // configuração: mandar num campo que o serviço não espera faria a chamada
    // falhar do outro lado, com uma mensagem que não aponta para cá.
    const campoDeMidia = (funcao.entradas || []).find((e) => e.tipo === 'mídia')?.nome || null
    if (arquivo && !campoDeMidia) {
      throw new ErroDeConexao(
        `A função "${funcao.nome}" não declara entrada de mídia, mas o comando mandou um arquivo.`,
        { paraPessoa: 'Este comando e a configuração do serviço não combinam mais. Avise o dono do bot.' }
      )
    }
    const anexo = arquivo && campoDeMidia ? { ...arquivo, campo: campoDeMidia } : null

    const pedido = montarRequisicao(url, funcao.metodo, corpo, cabecalhos, anexo)
    const primeira = await jsonOuErro(await chamar(pedido.url, pedido.opcoes), `chamar ${funcao.nome}`)

    // Resposta com arquivos NA HORA, sem protocolo de trabalho: conversão é
    // rápida, e obrigar um serviço de dois segundos a devolver identificador e
    // aceitar consulta seria complicar o lado de quem escreve a API.
    //
    // Este ramo existia declarável e NÃO buscava arquivo nenhum — quem
    // declarasse `forma: mídia` recebia "não devolveu arquivo" sempre. Era
    // ramo morto, sem teste.
    if (funcao.resposta?.forma === 'mídia') {
      const erroDireto = funcao.resposta.campoDoErro ? porCaminho(primeira, funcao.resposta.campoDoErro) : null
      if (erroDireto) throw new ErroDeConexao(String(erroDireto))
      return {
        forma: 'mídia',
        ...(await buscarArquivos(porCaminho(primeira, funcao.resposta?.campo), { base: declaracao.endereco, cabecalhos })),
        descricao: typeof primeira?.descricao === 'string' ? primeira.descricao : null
      }
    }

    if (funcao.resposta?.forma !== 'trabalho') {
      return { forma: funcao.resposta?.forma || 'texto', dados: porCaminho(primeira, funcao.resposta?.campo) }
    }

    const final = await acompanharTrabalho(primeira, {
      base: declaracao.endereco,
      cabecalhos,
      resposta: funcao.resposta,
      oQueFaz: funcao.nome
    })
    const erroDoServico = funcao.resposta.campoDoErro ? porCaminho(final, funcao.resposta.campoDoErro) : null
    if (erroDoServico) throw new ErroDeConexao(String(erroDoServico))

    const lista = porCaminho(final, funcao.resposta.campoDoResultado)
    return {
      forma: 'mídia',
      ...(await buscarArquivos(lista, { base: declaracao.endereco, cabecalhos })),
      descricao: typeof final?.descricao === 'string' ? final.descricao : null
    }
  }

  // Os arquivos que o serviço apontou.
  //
  // Um arquivo grande demais NÃO leva os outros junto: num post de várias
  // fotos, recusar tudo por causa de um vídeo entregaria zero foto. Se nenhum
  // couber, aí sim é erro. E quem entrega precisa saber quantos ficaram de
  // fora — entregar 8 de 10 calado faria a pessoa achar que o post tinha 8.
  async function buscarArquivos (lista, { base, cabecalhos }) {
    const itens = Array.isArray(lista) ? lista.filter((m) => m?.url) : []
    const midias = []
    let foraPorTamanho = 0
    let maior = 0

    for (const item of itens) {
      // O tamanho vem no registro, ANTES de transferir: recusar aqui evita
      // puxar centenas de MB para descobrir no fim que não cabe.
      if (item.bytes && item.bytes > limiteBytes) {
        foraPorTamanho++
        maior = Math.max(maior, item.bytes)
        continue
      }
      const url = /^https?:\/\//i.test(item.url) ? item.url : `${base}${item.url}`
      const resposta = await chamar(url, { method: 'GET', headers: cabecalhos })
      if (!resposta.ok) {
        throw new ErroDeConexao(`Não consegui buscar o arquivo (${resposta.status}).`, { paraPessoa: FALHA_NOSSA })
      }
      const buffer = Buffer.from(await resposta.arrayBuffer())
      if (!buffer.length) throw new ErroDeConexao('O arquivo veio vazio.', { paraPessoa: FALHA_NOSSA })
      if (buffer.length > limiteBytes) {
        foraPorTamanho++
        maior = Math.max(maior, buffer.length)
        continue
      }
      midias.push({
        buffer,
        nome: item.nome || 'arquivo',
        mime: item.mime || 'application/octet-stream',
        // O que o serviço não classifica vai como documento, que é o único
        // formato que o WhatsApp aceita para qualquer coisa.
        tipo: TIPO_WHATSAPP[item.tipo] || 'document'
      })
    }

    if (!midias.length && foraPorTamanho) {
      const mb = (n) => `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
      throw new ErroDeConexao(`O arquivo tem ${mb(maior)} e o limite para envio é ${mb(limiteBytes)}.`)
    }
    return { midias, foraPorTamanho }
  }

  return { executar }
}
