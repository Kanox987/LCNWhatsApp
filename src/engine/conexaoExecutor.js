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
import { resolverDestino, TIPOS_DE_ENVIO } from './server/conexoes/declaracao.js'

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

// O tipo de envio DEDUZIDO do mime, para a função que não declara um fixo — é
// o caso de uma conversão, onde a saída depende do formato pedido. Um webp cai
// em foto de propósito: figurinha é escolha da função, não do formato.
function tipoPeloMime (mime) {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  // O que não se classifica vai como documento, que é o único formato que o
  // WhatsApp aceita para qualquer coisa.
  return 'document'
}

// Nome do arquivo que sai. Documento SEM nome chega como "arquivo" na conversa,
// e quem recebe não sabe nem a extensão.
const EXTENSAO_ESTRANHA = /[^a-z0-9]/
function nomeParaMime (mime) {
  const sub = mime.split('/')[1]?.split(';')[0]?.toLowerCase() || ''
  const ext = !sub || EXTENSAO_ESTRANHA.test(sub) ? 'bin' : sub
  return `arquivo.${ext}`
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
function montarRequisicao (url, metodo, entradas, cabecalhos, arquivos = []) {
  if (metodo === 'GET' || metodo === 'DELETE') {
    const comQuery = new URL(url)
    for (const [nome, valor] of Object.entries(entradas)) comQuery.searchParams.set(nome, String(valor))
    return { url: comQuery.toString(), opcoes: { method: metodo, headers: cabecalhos } }
  }
  if (arquivos.length) {
    const forma = new FormData()
    for (const [nome, valor] of Object.entries(entradas)) forma.set(nome, String(valor))
    // Um campo por arquivo. São até dois: a função que troca o fundo recebe a
    // foto da pessoa e a foto que vira o fundo.
    for (const a of arquivos) {
      forma.set(a.campo, new Blob([a.buffer], { type: a.mime || 'application/octet-stream' }), a.nome || 'arquivo')
    }
    return { url, opcoes: { method: metodo, headers: cabecalhos, body: forma } }
  }
  return {
    url,
    opcoes: { method: metodo, headers: { ...cabecalhos, 'Content-Type': 'application/json' }, body: JSON.stringify(entradas) }
  }
}

// O texto de uma linha da lista, com os campos daquele item.
//
// Marcador que não resolve FICA LITERAL, como em todo o resto do sistema: a
// linha chega escrita "{{preco}}" e quem declarou vê na hora qual campo errou.
// Apagar seria esconder o defeito atrás de um texto que parece certo.
function escrever (modelo, valores) {
  // `{{a ?? b}}`: o primeiro que tiver valor. Existe porque serviço devolve
  // campo vazio o tempo todo e isso NÃO é erro — a busca de música só sabe
  // faixa e artista quando o vídeo é do YouTube Music; nos outros, o que ela
  // tem é título e canal, e a legenda tem que dizer a mesma coisa com o que
  // existe. Sem isto, a conversa recebia "{{metadados.faixa}}" escrito.
  return String(modelo).replace(/\{\{\s*([\w.]+(?:\s*\?\?\s*[\w.]+)*)\s*(\|\w+)?\s*\}\}/g, (marcador, caminhos, filtro) => {
    let valor
    for (const caminho of String(caminhos).split('??').map((c) => c.trim())) {
      const achado = porCaminho(valores, caminho)
      if (achado !== undefined && achado !== null && achado !== '') { valor = achado; break }
    }
    if (valor === undefined) return marcador
    // `|tempo` é a única conta desta camada, e existe porque serviço nenhum
    // devolve "4:59": eles devolvem 299 segundos, e ninguém lê isso como
    // duração de música.
    if (filtro === '|tempo') {
      const segundos = Math.round(Number(valor))
      if (!Number.isFinite(segundos) || segundos < 0) return marcador
      const h = Math.floor(segundos / 3600)
      const m = Math.floor((segundos % 3600) / 60)
      const s = segundos % 60
      return h
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`
    }
    return String(valor)
  })
}

// CARDS DO MESMO TAMANHO.
//
// O card cresce com o texto, e nome de música tem comprimento qualquer: um de
// uma linha ao lado de um de três deixa o carrossel torto. Os menores ganham
// linhas vazias até empatar com o maior.
//
// A conta é uma ESTIMATIVA, e não tem como ser outra coisa: quem decide onde a
// linha quebra é o aplicativo de quem recebe, com a fonte e a largura de tela
// dele. 28 caracteres por linha é a largura típica do card; errar por uma
// linha deixa o carrossel levemente torto, que é muito melhor que o que havia
// antes.
const LARGURA_DO_CARD = 28
// Teto para o caso patológico: um título gigante não pode empurrar os outros
// cards para dez linhas de nada.
const MAXIMO_DE_LINHAS_VAZIAS = 6
// Espaço de largura zero: linha "vazia" que o WhatsApp não come ao aparar o
// texto. Linha com espaço comum ele apara.
const LINHA_VAZIA = '\u200b'

function linhasOcupadas (texto) {
  if (!texto) return 0
  return String(texto).split('\n')
    .reduce((total, linha) => total + Math.max(1, Math.ceil(linha.length / LARGURA_DO_CARD)), 0)
}

function igualarAlturaDosCards (cards) {
  if (cards.length < 2) return
  const altura = (c) => linhasOcupadas(c.titulo) + linhasOcupadas(c.corpo)
  const maior = Math.max(...cards.map(altura))
  for (const card of cards) {
    const faltam = Math.min(maior - altura(card), MAXIMO_DE_LINHAS_VAZIAS)
    if (faltam > 0) card.corpo = `${card.corpo}${`\n${LINHA_VAZIA}`.repeat(faltam)}`
  }
}

// A lista, virada mensagem.
//
// Numerada porque é para escolher: "manda o 2" só funciona se o 2 estiver
// escrito. O número é `{{n}}` e fica disponível para a linha declarada usar
// onde quiser — ou não usar.
function montarLista (corpo, forma) {
  const bruta = porCaminho(corpo, forma.campo)
  const itens = Array.isArray(bruta) ? bruta : []
  if (!itens.length) {
    return forma.vazio || 'Não achei nada.'
  }
  const usados = forma.limite ? itens.slice(0, forma.limite) : itens
  const linhas = usados.map((item, i) => escrever(forma.linha, { ...(item && typeof item === 'object' ? item : { valor: item }), n: i + 1 }))
  const cabecalho = forma.cabecalho ? escrever(forma.cabecalho, corpo) : null
  return [cabecalho, ...linhas].filter(Boolean).join('\n')
}

// A LINHA QUE NÃO TEM VALOR SOME — e só na legenda.
//
// Em todo o resto desta base, marcador que não resolve fica LITERAL: é o sinal
// de erro, e quem escreveu o comando vê na hora qual campo errou. A legenda é o
// contrário: quem lê é quem usou o comando, não quem o escreveu, e
// "⏱️ {{duracao}}" no meio de uma música não diz nada a essa pessoa.
//
// Então aqui a linha inteira sai, e o que tem valor continua chegando. Com
// `??` na declaração, o normal é nem chegar neste ponto.
function semLinhasOcas (texto) {
  const linhas = String(texto).split('\n').filter((linha) => !/\{\{[^}]*\}\}/.test(linha))
  return textoOuNulo(linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim())
}

function textoOuNulo (valor) {
  return typeof valor === 'string' && valor.trim() ? valor : null
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
  async function chamar (url, opcoes, esperaMs = TIMEOUT_REQUISICAO_MS) {
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), esperaMs)
    try {
      return await buscar(url, { ...opcoes, signal: controle.signal })
    } catch {
      // O endereço fica no diagnóstico, não na conversa.
      throw new ErroDeConexao(`Não consegui falar com o serviço (${url}).`, { paraPessoa: FALHA_NOSSA })
    } finally {
      clearTimeout(timer)
    }
  }

  // A FRASE DO SERVIÇO, quando ela serve a quem usou o comando.
  //
  // "Ficou com 151,5 KB e o limite é 2,9 KB, mesmo em qualidade 15 e 8 fps" diz
  // exatamente o que fazer; "o serviço respondeu 422" não diz nada. Quem sabe
  // escrever essa frase é o serviço, e a declaração diz em que campo ela vem.
  //
  // Credencial recusada continua sendo FALHA_NOSSA: 401/403 é configuração do
  // dono, e não há nada que quem digitou possa fazer com isso.
  async function textoDoErro (resposta, campoDoErro) {
    if (!campoDoErro) return null
    try {
      const corpo = await resposta.json()
      const frase = porCaminho(corpo, campoDoErro)
      return typeof frase === 'string' && frase.trim() ? frase.trim() : null
    } catch {
      return null
    }
  }

  async function jsonOuErro (resposta, oQue, campoDoErro = null) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDeConexao(`O serviço recusou a credencial ao ${oQue} (${resposta.status}).`, { paraPessoa: FALHA_NOSSA })
    }
    if (!resposta.ok) {
      const frase = await textoDoErro(resposta, campoDoErro)
      if (resposta.status === 429) {
        throw new ErroDeConexao(frase || 'O serviço pediu para esperar — tem muita coisa na fila agora. Tente de novo daqui a pouco.')
      }
      throw new ErroDeConexao(
        `O serviço respondeu ${resposta.status} ao ${oQue}${frase ? `: ${frase}` : ''}.`,
        { paraPessoa: frase || FALHA_NOSSA }
      )
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
      estado = await jsonOuErro(await chamar(url, { method: 'GET', headers: cabecalhos }), `acompanhar ${oQueFaz}`, forma.campoDoErro)
      const atual = String(porCaminho(estado, forma.campoDoEstado) ?? '')
      // Estado desconhecido ENCERRA a espera. Girar num estado que esta versão
      // não conhece é pior que parar e dizer o que veio.
      if (!emAndamento.has(atual)) return estado
    }
    throw new ErroDeConexao(`Passou de ${Math.round(esperaMaximaMs / 1000)}s sem terminar, então parei de esperar. Tente de novo.`)
  }

  // `declaracao` é o que a rota interna do motor devolve: endereço,
  // autenticação, funções e a chave já resolvida.
  async function executar (declaracao, nomeDaFuncao, entradas, arquivo = null, arquivo2 = null) {
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
    const camposDeMidia = (funcao.entradas || []).filter((e) => e.tipo === 'mídia').map((e) => e.nome)
    if (arquivo && !camposDeMidia.length) {
      throw new ErroDeConexao(
        `A função "${funcao.nome}" não declara entrada de mídia, mas o comando mandou um arquivo.`,
        { paraPessoa: 'Este comando e a configuração do serviço não combinam mais. Avise o dono do bot.' }
      )
    }
    // O PRIMEIRO arquivo vai no campo que a FUNÇÃO declarou, não no que o
    // comando escreveu: se a declaração mudou e o nome não existe mais, isto é
    // erro de configuração, e mandar num campo que o serviço não espera faria a
    // chamada falhar do outro lado com uma mensagem que não aponta para cá.
    //
    // O SEGUNDO traz o campo consigo, porque com duas entradas de mídia a
    // função sozinha não desempata qual é qual — quem decide é o comando, e o
    // publish já conferiu que o nome existe na função.
    const anexos = []
    if (arquivo) anexos.push({ ...arquivo, campo: arquivo.campo || camposDeMidia[0] })
    if (arquivo2) {
      const campo2 = arquivo2.campo || camposDeMidia.find((n) => n !== anexos[0]?.campo)
      if (!campo2) {
        throw new ErroDeConexao(
          `A função "${funcao.nome}" recebe um arquivo só, mas o comando mandou dois.`,
          { paraPessoa: 'Este comando e a configuração do serviço não combinam mais. Avise o dono do bot.' }
        )
      }
      anexos.push({ ...arquivo2, campo: campo2 })
    }

    const pedido = montarRequisicao(url, funcao.metodo, corpo, cabecalhos, anexos)
    // A espera é da FUNÇÃO quando ela declara uma. Sem isto, uma melhoria de
    // foto de dois minutos morria aos 20 segundos — com o serviço ainda
    // trabalhando do outro lado, e ninguém sabendo por quê.
    const espera = Number.isFinite(funcao.esperaSegundos) ? funcao.esperaSegundos * 1000 : TIMEOUT_REQUISICAO_MS
    const primeira = await jsonOuErro(await chamar(pedido.url, pedido.opcoes, espera), `chamar ${funcao.nome}`, funcao.resposta?.campoDoErro)

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
        descricao: textoOuNulo(porCaminho(primeira, funcao.resposta?.campoDaDescricao || 'descricao'))
      }
    }

    // O ARQUIVO veio na própria resposta, em base64. Um arquivo, um envio.
    if (funcao.resposta?.forma === 'arquivo') {
      const conteudo = porCaminho(primeira, funcao.resposta.campo)
      if (typeof conteudo !== 'string' || !conteudo) {
        throw new ErroDeConexao(
          `O serviço respondeu sem "${funcao.resposta.campo}" ao chamar ${funcao.nome}.`,
          { paraPessoa: FALHA_NOSSA }
        )
      }
      const buffer = Buffer.from(conteudo, 'base64')
      if (!buffer.length) throw new ErroDeConexao('O arquivo veio vazio.', { paraPessoa: FALHA_NOSSA })
      if (buffer.length > limiteBytes) {
        const mb = (n) => `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
        throw new ErroDeConexao(`O arquivo tem ${mb(buffer.length)} e o limite para envio é ${mb(limiteBytes)}.`)
      }
      const mime = (funcao.resposta.campoDoMime ? porCaminho(primeira, funcao.resposta.campoDoMime) : null) ||
        'application/octet-stream'
      // O tipo DECLARADO ganha do deduzido: um webp pode ser figurinha ou foto,
      // e só a função sabe qual dos dois ela produz.
      const tipo = funcao.resposta.tipo
        ? TIPOS_DE_ENVIO[funcao.resposta.tipo]
        : tipoPeloMime(String(mime))
      return {
        forma: 'mídia',
        midias: [{ buffer, nome: nomeParaMime(String(mime)), mime: String(mime), tipo }],
        foraPorTamanho: 0,
        descricao: null
      }
    }

    // A LISTA EM CARDS. Cada item vira um card com imagem, texto e um botão.
    //
    // As imagens vêm por ENDEREÇO, como na forma `mídia`, e são buscadas com a
    // mesma credencial quando moram no serviço. A diferença é o que volta: em
    // vez de arquivos para entregar, cards para montar uma mensagem só.
    if (funcao.resposta?.forma === 'carrossel') {
      const forma = funcao.resposta
      const erroDireto = forma.campoDoErro ? porCaminho(primeira, forma.campoDoErro) : null
      if (erroDireto) throw new ErroDeConexao(String(erroDireto))
      const bruta = porCaminho(primeira, forma.campo)
      const itens = (Array.isArray(bruta) ? bruta : []).filter((i) => i && typeof i === 'object')
      if (!itens.length) {
        // Busca sem resultado é resposta normal, não erro: o texto declarado
        // vai como mensagem simples.
        return { forma: 'texto', dados: forma.vazio || 'Não achei nada.' }
      }
      const usados = forma.limite ? itens.slice(0, forma.limite) : itens
      const cards = []
      for (const [i, item] of usados.entries()) {
        // Os candidatos, em ordem: nome de campo ou endereço montado com os
        // campos do item. O primeiro que responder vira a capa do card.
        let achada = null
        for (const candidato of forma.imagem) {
          const endereco = candidato.includes('{{')
            ? escrever(candidato, item)
            : porCaminho(item, candidato)
          if (typeof endereco !== 'string' || !endereco || endereco.includes('{{')) continue
          const url = /^https?:\/\//i.test(endereco) ? endereco : `${declaracao.endereco}${endereco}`
          // A credencial só acompanha endereço do PRÓPRIO serviço: mandá-la
          // para outra origem entregaria a chave dele a quem ele apontou.
          const mesmaOrigem = url.startsWith(declaracao.endereco)
          let resposta
          try {
            resposta = await chamar(url, { method: 'GET', headers: mesmaOrigem ? cabecalhos : {} })
          } catch {
            continue
          }
          if (!resposta.ok) continue
          const buffer = Buffer.from(await resposta.arrayBuffer())
          if (!buffer.length || buffer.length > limiteBytes) continue
          achada = { buffer, mime: resposta.headers?.get?.('content-type') || 'image/jpeg' }
          break
        }
        if (!achada) continue
        const valores = { ...item, n: cards.length + 1 }
        cards.push({
          midia: { buffer: achada.buffer, mime: achada.mime, tipo: 'image', nome: `card-${i + 1}.jpg` },
          titulo: forma.titulo ? escrever(forma.titulo, valores) : null,
          corpo: escrever(forma.corpo, valores),
          rodape: forma.rodape ? escrever(forma.rodape, valores) : null,
          botao: forma.botao
            ? { texto: escrever(forma.botao.texto, valores), comando: escrever(forma.botao.comando, valores) }
            : null
        })
      }
      if (forma.igualarAltura) igualarAlturaDosCards(cards)
      if (!cards.length) {
        throw new ErroDeConexao(
          `Nenhum dos ${usados.length} resultados trouxe imagem que desse para buscar.`,
          { paraPessoa: 'Achei os resultados mas não consegui montar as capas. Tente de novo daqui a pouco.' }
        )
      }
      return {
        forma: 'carrossel',
        cards,
        estilo: forma.estilo,
        cabecalho: forma.cabecalho ? escrever(forma.cabecalho, primeira) : null
      }
    }

    if (funcao.resposta?.forma === 'lista') {
      const erroDireto = funcao.resposta.campoDoErro ? porCaminho(primeira, funcao.resposta.campoDoErro) : null
      if (erroDireto) throw new ErroDeConexao(String(erroDireto))
      return { forma: 'texto', dados: montarLista(primeira, funcao.resposta) }
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
    const buscados = await buscarArquivos(lista, { base: declaracao.endereco, cabecalhos })
    // A ordem declarada, quando existe: a capa antes da música, por exemplo.
    // O que não está na lista vai para o fim, na ordem em que veio.
    if (funcao.resposta.ordemDosTipos) {
      // A declaração fala a língua de quem declara ("foto", "áudio"); a mídia
      // já está traduzida para a do WhatsApp. A tradução acontece aqui, na
      // hora de usar — guardá-la traduzida fazia a conexão não poder ser
      // gravada de novo.
      const ordem = funcao.resposta.ordemDosTipos.map((t) => TIPOS_DE_ENVIO[t] || t)
      const posicao = (m) => {
        const i = ordem.indexOf(m.tipo)
        return i === -1 ? ordem.length : i
      }
      buscados.midias = buscados.midias
        .map((m, i) => ({ m, i }))
        .sort((a, b) => (posicao(a.m) - posicao(b.m)) || (a.i - b.i))
        .map((x) => x.m)
    }
    return {
      forma: 'mídia',
      ...buscados,
      descricao: funcao.resposta.modeloDaDescricao
        ? semLinhasOcas(escrever(funcao.resposta.modeloDaDescricao, final))
        : textoOuNulo(porCaminho(final, funcao.resposta.campoDaDescricao || 'descricao'))
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
