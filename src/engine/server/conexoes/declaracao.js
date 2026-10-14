// O que uma CONEXÃO declara, e como validar isso.
//
// POR QUE ISTO EXISTE
//
// O dono apontou o defeito com um exemplo exato. A linha da linguagem era:
//
//     baixa "{{quoted.link}} {{message.link}}"
//
// e nada nela é explícito: o argumento não tem rótulo, os dois marcadores
// colados são um truque (o motor apaga o que não resolveu e pega o primeiro
// link que sobrar), e — o principal — QUEM baixa não aparece em lugar nenhum.
// O serviço mora no config.json, invisível.
//
// A palavra dele: "minha crítica é que baixar aí aparece no código interno e
// não como configurável pelo dono". E o destino: "não existe problema em criar
// a função baixar que recebe um link ou baixar2 que recebe o mesmo link com
// outra configuração na API, se eu sei o que está acontecendo".
//
// Então função deixa de ser palavra do compilador e vira DADO: o dono declara,
// na aba Conexões, o que dá para pedir a cada serviço. Integração nova não
// exige mexer na linguagem.
//
// O QUE ISTO NÃO REABRE
//
// O invariante 5 continua de pé — e fica mais forte, não mais fraco. A
// automação não monta requisição: ela chama uma função DECLARADA, com entradas
// tipadas. Quem escolhe endereço, método e caminho é o dono, na conexão.
//
// É isso que destrava o que o `action.http` genérico não conseguia: lá a
// automação escolheria a URL, e por isso exigia proteção contra SSRF. Aqui ela
// não tem essa escolha — o destino é fixo na declaração.
//
// E POR QUE AGORA, SE O action.http ESTAVA PARADO
//
// O action.http foi desenhado como chamada SÍNCRONA no meio do fluxo, e o
// gateway desiste de esperar o motor em 1,5 s. Uma função declarada encerra a
// cadeia: vira comando terminal, igual ao media.download de hoje. O motor
// decide e devolve; o gateway leva o tempo que a chamada precisar.

export class ErroDeDeclaracao extends Error {}

// Como a resposta do serviço chega.
//
// `trabalho` é o caso do serviço de download: ele não devolve o arquivo, devolve
// um identificador de trabalho e a gente acompanha até terminar. Declarar isso
// em vez de embutir no código é o que permite ao dono ver — e trocar — o
// protocolo sem depender de mim.
export const FORMAS_DE_RESPOSTA = Object.freeze({
  texto: 'texto',
  midia: 'mídia',
  trabalho: 'trabalho',
  // O serviço devolve O ARQUIVO na própria resposta, em base64 dentro do JSON.
  //
  // É a forma de quem converte em segundos — figurinha, troca de formato,
  // remoção de fundo. `mídia` espera uma LISTA de endereços para buscar
  // depois, e `trabalho` espera protocolo de acompanhamento; obrigar um
  // serviço de dois segundos a qualquer um dos dois complicaria o lado de
  // quem escreve a API sem ganhar nada.
  arquivo: 'arquivo'
})

// Como o arquivo que volta deve ser ENVIADO no WhatsApp.
//
// Figurinha não é "uma imagem com outro nome": é outro tipo de envio, sem
// legenda e sem miniatura. E um webp pode ser as duas coisas, então o mime não
// basta para decidir — quem sabe é a função, e por isso ela declara.
//
// Ausente, deduz-se do mime: é o caso de uma função de conversão, onde o tipo
// da saída depende do formato que a automação pediu.
export const TIPOS_DE_ENVIO = Object.freeze({
  figurinha: 'sticker',
  foto: 'image',
  'vídeo': 'video',
  'áudio': 'audio',
  documento: 'document'
})

// A entrada `mídia` é diferente das outras três em natureza, não em formato.
//
// As outras levam um VALOR que a automação escreveu ou interpolou. Esta leva o
// ARQUIVO da mensagem — a foto, o vídeo, o áudio que chegou pelo WhatsApp. O
// motor nunca vê esses bytes (invariante 4): ele só sabe que a função pede
// mídia, e quem resolve o token e anexa o arquivo é o gateway.
//
// Por isso ela não aparece em `inputs` no documento: vive num campo próprio
// (`mediaInput`), que diz QUAL entrada da função recebe o arquivo. Se entrasse
// pelo mapa de entradas, passaria pelo interpolador — e token de mídia no
// interpolador é exatamente o que o invariante 4 proíbe.
export const TIPO_MIDIA = 'mídia'

export const TIPOS_DE_ENTRADA = Object.freeze(['texto', 'número', 'opção', 'liga/desliga', TIPO_MIDIA])

// COMO a credencial viaja — não só como ela se chama.
//
// Isto corrige um erro meu que contrariava decisão já registrada do projeto
// ("credencial tipada em vez de header livre"): a tela pedia o NOME do campo e
// nunca a forma. Saber que a credencial se chama "token" não permite montar
// requisição nenhuma — falta saber se ela vai em `Authorization: Bearer`, num
// cabeçalho próprio, ou como parâmetro na URL.
//
// Tipado, e não header livre, por um motivo concreto: header livre deixaria
// alguém escrever `Host`, `Cookie` ou `Content-Length` e mexer no transporte da
// requisição, não só na autenticação.
export const FORMAS_DE_AUTENTICACAO = Object.freeze({
  nenhuma: 'nenhuma',
  bearer: 'bearer',
  cabecalho: 'cabeçalho',
  parametro: 'parâmetro'
})

// Cabeçalhos que mudam o TRANSPORTE, não a autenticação. Deixar a credencial
// entrar por um deles seria dar controle da requisição a quem só deveria estar
// dizendo quem é.
const CABECALHOS_PROIBIDOS = new Set([
  'host', 'content-length', 'content-type', 'connection', 'transfer-encoding',
  'cookie', 'origin', 'referer', 'upgrade', 'te', 'trailer', 'expect'
])

// DE ONDE a chave vem. São duas, e as duas são legítimas.
//
// `colada` é o pedido do dono: quem aluga o sistema não tem terminal, então
// precisa conseguir colar a chave pelo painel.
//
// `arquivo` é a forma que já existia (download.tokenArquivo no config.json), e
// ela não some por isso: para quem TEM terminal continua sendo melhor — a chave
// não entra no banco, não entra em backup do banco, e mantém a permissão que o
// dono deu a ela no disco.
//
// Sem esta segunda forma o painel mentia: a conexão de download aparecia como
// "falta a chave" enquanto a chave existia, funcionando, num arquivo.
export const ORIGENS_DE_CHAVE = Object.freeze({ colada: 'colada', arquivo: 'arquivo' })

export function validarAutenticacao (auth) {
  const tipo = auth?.tipo || FORMAS_DE_AUTENTICACAO.nenhuma
  if (!Object.values(FORMAS_DE_AUTENTICACAO).includes(tipo)) {
    throw new ErroDeDeclaracao(
      `Forma de autenticação desconhecida: "${tipo}". Use: ${Object.values(FORMAS_DE_AUTENTICACAO).join(', ')}.`
    )
  }
  if (tipo === FORMAS_DE_AUTENTICACAO.nenhuma) return { tipo }

  const origem = auth?.origem || ORIGENS_DE_CHAVE.colada
  if (!Object.values(ORIGENS_DE_CHAVE).includes(origem)) {
    throw new ErroDeDeclaracao(
      `Origem de chave desconhecida: "${origem}". Use: ${Object.values(ORIGENS_DE_CHAVE).join(', ')}.`
    )
  }
  const daOrigem = origem === ORIGENS_DE_CHAVE.arquivo
    ? { origem, arquivo: exigirTexto(auth?.arquivo, 'O caminho do arquivo da chave') }
    : { origem }

  // O bearer já sabe onde vai: `Authorization: Bearer <valor>`.
  if (tipo === FORMAS_DE_AUTENTICACAO.bearer) return { tipo, ...daOrigem }

  const nome = exigirTexto(auth?.nome, tipo === FORMAS_DE_AUTENTICACAO.cabecalho
    ? 'O nome do cabeçalho'
    : 'O nome do parâmetro')
  if (tipo === FORMAS_DE_AUTENTICACAO.cabecalho) {
    if (!/^[A-Za-z0-9-]+$/.test(nome)) {
      throw new ErroDeDeclaracao(`Nome de cabeçalho inválido: "${nome}". Use letras, números e hífen.`)
    }
    if (CABECALHOS_PROIBIDOS.has(nome.toLowerCase())) {
      throw new ErroDeDeclaracao(
        `O cabeçalho "${nome}" controla o transporte da requisição, não a autenticação, e não pode carregar a credencial.`
      )
    }
  }
  return { tipo, nome, ...daOrigem }
}

const METODOS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

// Nome de função e de entrada viram parte da linguagem (`chama midia.baixar`),
// então precisam ser escrevíveis sem aspas e sem ambiguidade.
const NOME = /^[a-zA-Z][\w-]*$/

function exigirTexto (valor, oQue) {
  if (typeof valor !== 'string' || !valor.trim()) {
    throw new ErroDeDeclaracao(`${oQue} é obrigatório.`)
  }
  return valor.trim()
}

function validarEntrada (entrada, ondeEstou) {
  const onde = `${ondeEstou}: entrada`
  const nome = exigirTexto(entrada?.nome, `${onde} — o nome`)
  if (!NOME.test(nome)) {
    throw new ErroDeDeclaracao(`${onde} "${nome}": o nome começa por letra e aceita letras, números, _ e -.`)
  }
  const tipo = entrada?.tipo || 'texto'
  if (!TIPOS_DE_ENTRADA.includes(tipo)) {
    throw new ErroDeDeclaracao(`${onde} "${nome}": tipo desconhecido "${tipo}". Use: ${TIPOS_DE_ENTRADA.join(', ')}.`)
  }
  if (tipo === 'opção') {
    const opcoes = Array.isArray(entrada.opcoes) ? entrada.opcoes.filter((o) => typeof o === 'string' && o.trim()) : []
    if (!opcoes.length) {
      throw new ErroDeDeclaracao(`${onde} "${nome}": tipo "opção" precisa da lista de escolhas.`)
    }
    // Padrão fora da lista é falha silenciosa: a declaração nasceria válida e a
    // chamada falharia depois, com o serviço recusando um valor que ninguém
    // lembra de onde veio. Mesma classe do `opção` dos templates.
    if (entrada.padrao !== undefined && entrada.padrao !== null && entrada.padrao !== '' &&
        !opcoes.includes(String(entrada.padrao))) {
      throw new ErroDeDeclaracao(
        `${onde} "${nome}": o padrão "${entrada.padrao}" não está entre as escolhas (${opcoes.join(', ')}).`
      )
    }
    return { nome, tipo, opcoes, obrigatoria: entrada.obrigatoria !== false, padrao: entrada.padrao }
  }
  if (tipo === TIPO_MIDIA) {
    // Padrão não existe para arquivo: não há "arquivo padrão" que faça sentido,
    // e aceitar o campo deixaria alguém declarar um valor que nunca é usado.
    if (entrada.padrao !== undefined && entrada.padrao !== null && entrada.padrao !== '') {
      throw new ErroDeDeclaracao(`${onde} "${nome}": entrada de mídia não tem padrão — o arquivo vem da mensagem.`)
    }
    return { nome, tipo, obrigatoria: entrada.obrigatoria !== false }
  }
  return { nome, tipo, obrigatoria: entrada.obrigatoria !== false, padrao: entrada.padrao }
}

function validarResposta (resposta, onde) {
  const forma = resposta?.forma
  if (!Object.values(FORMAS_DE_RESPOSTA).includes(forma)) {
    throw new ErroDeDeclaracao(
      `${onde}: a resposta precisa de uma forma conhecida (${Object.values(FORMAS_DE_RESPOSTA).join(', ')}).`
    )
  }
  if (forma === FORMAS_DE_RESPOSTA.arquivo) {
    const tipo = resposta.tipo ? String(resposta.tipo) : null
    if (tipo && !Object.hasOwn(TIPOS_DE_ENVIO, tipo)) {
      throw new ErroDeDeclaracao(
        `${onde}: tipo de envio desconhecido "${tipo}". Use: ${Object.keys(TIPOS_DE_ENVIO).join(', ')} — ou deixe em branco para deduzir do tipo do arquivo.`
      )
    }
    return {
      forma,
      // Sem saber ONDE o conteúdo vem, não há o que entregar. Aceitar isto
      // ausente faria a chamada terminar sempre em "não veio arquivo".
      campo: exigirTexto(resposta.campo, `${onde} — o campo que traz o arquivo`),
      campoDoMime: resposta.campoDoMime ? String(resposta.campoDoMime) : null,
      tipo,
      campoDoErro: resposta.campoDoErro ? String(resposta.campoDoErro) : null
    }
  }

  if (forma !== FORMAS_DE_RESPOSTA.trabalho) {
    return {
      forma,
      campo: resposta.campo || null,
      // Também na resposta imediata: um serviço que converte em dois segundos
      // ainda precisa de um jeito de dizer "não deu, e o motivo é este" sem
      // depender de status HTTP, e esse texto é o que chega à pessoa.
      campoDoErro: resposta.campoDoErro ? String(resposta.campoDoErro) : null
    }
  }

  // O protocolo assíncrono, declarado em vez de embutido. Cada campo aqui é
  // algo que hoje está fixo dentro de src/downloader.js.
  return {
    forma,
    campoDoTrabalho: exigirTexto(resposta.campoDoTrabalho, `${onde} — o campo que traz o identificador do trabalho`),
    caminhoDeAcompanhamento: exigirTexto(resposta.caminhoDeAcompanhamento, `${onde} — o caminho para acompanhar o trabalho`),
    campoDoEstado: exigirTexto(resposta.campoDoEstado, `${onde} — o campo que traz o estado`),
    estadosEmAndamento: Array.isArray(resposta.estadosEmAndamento) && resposta.estadosEmAndamento.length
      ? resposta.estadosEmAndamento.map(String)
      // Sem esta lista a gente não sabe quando PARAR de perguntar, e um estado
      // desconhecido faria o acompanhamento girar para sempre.
      : (() => { throw new ErroDeDeclaracao(`${onde}: diga quais estados significam "ainda não acabou".`) })(),
    campoDoResultado: exigirTexto(resposta.campoDoResultado, `${onde} — o campo que traz o resultado`),
    campoDoErro: resposta.campoDoErro ? String(resposta.campoDoErro) : null
  }
}

export function validarFuncao (funcao) {
  const nome = exigirTexto(funcao?.nome, 'O nome da função')
  const onde = `função "${nome}"`
  if (!NOME.test(nome)) {
    throw new ErroDeDeclaracao(`${onde}: o nome começa por letra e aceita letras, números, _ e -.`)
  }
  const metodo = String(funcao.metodo || 'POST').toUpperCase()
  if (!METODOS.includes(metodo)) {
    throw new ErroDeDeclaracao(`${onde}: método desconhecido "${metodo}". Use: ${METODOS.join(', ')}.`)
  }
  // O caminho pode ser relativo à conexão OU uma URL inteira.
  //
  // O dono pediu a segunda forma, e o argumento dele está certo: uma API em
  // outro servidor é caso legítimo. O que NÃO acompanha é o segredo — ver
  // `resolverDestino` logo abaixo. Uma conexão carrega um token, e deixar uma
  // função trocar o host sem mais nada faria esse token viajar para um domínio
  // que não é o dono dele, por causa de um campo de caminho.
  const caminho = exigirTexto(funcao.caminho, `${onde} — o caminho`)
  const enderecoProprio = /^[a-zA-Z][\w+.-]*:/.test(caminho)
  if (enderecoProprio) {
    // Passa pela MESMA validação do endereço da conexão: http/https e nada mais.
    validarEndereco(caminho)
  } else if (!caminho.startsWith('/')) {
    throw new ErroDeDeclaracao(
      `${onde}: o caminho começa com "/" (relativo ao endereço da conexão) ou é uma URL http/https inteira.`
    )
  }

  const entradas = (Array.isArray(funcao.entradas) ? funcao.entradas : []).map((e) => validarEntrada(e, onde))
  const vistos = new Set()
  for (const e of entradas) {
    if (vistos.has(e.nome)) throw new ErroDeDeclaracao(`${onde}: a entrada "${e.nome}" está declarada duas vezes.`)
    vistos.add(e.nome)
  }

  const deMidia = entradas.filter((e) => e.tipo === TIPO_MIDIA)
  if (deMidia.length > 1) {
    // Uma mensagem traz UMA mídia. Duas entradas de arquivo prometeriam algo
    // que o WhatsApp não entrega, e a segunda chegaria vazia na chamada.
    throw new ErroDeDeclaracao(
      `${onde}: só uma entrada de mídia por função — vieram ${deMidia.map((e) => `"${e.nome}"`).join(' e ')}.`
    )
  }
  if (deMidia.length && (metodo === 'GET' || metodo === 'DELETE')) {
    // Arquivo viaja no corpo. GET e DELETE não têm corpo, então a declaração
    // nasceria impossível — e a falha apareceria só na primeira chamada.
    throw new ErroDeDeclaracao(`${onde}: ${metodo} não tem corpo, então não dá para mandar arquivo nela. Use POST, PUT ou PATCH.`)
  }

  // QUANTO ESPERAR POR ESTA FUNÇÃO, e por que isto é declarado.
  //
  // 20 segundos serve para quase tudo e não serve para nada que pense: a
  // melhoria de foto em 4K leva de 15 s a 2 minutos nesta máquina, e um teto
  // fixo no meu código abortaria a chamada no meio — com o trabalho já feito
  // do outro lado. Teto fixo é a única coisa que quem monta o comando não
  // consegue contornar, e aqui ele não tem razão de ser: quem sabe quanto a
  // função demora é quem declara a função.
  //
  // O teto de 900 s existe só para o pedido não ficar pendurado para sempre
  // se o serviço nunca responder.
  const espera = funcao.esperaSegundos
  if (espera !== undefined && espera !== null && espera !== '') {
    const n = Number(espera)
    if (!Number.isFinite(n) || n <= 0 || n > 900) {
      throw new ErroDeDeclaracao(`${onde}: a espera vai de 1 a 900 segundos — veio "${espera}".`)
    }
    return {
      nome,
      descricao: typeof funcao.descricao === 'string' ? funcao.descricao : '',
      metodo,
      caminho,
      enderecoProprio,
      esperaSegundos: Math.round(n),
      entradas,
      resposta: validarResposta(funcao.resposta, onde)
    }
  }

  return {
    nome,
    descricao: typeof funcao.descricao === 'string' ? funcao.descricao : '',
    metodo,
    caminho,
    enderecoProprio,
    entradas,
    resposta: validarResposta(funcao.resposta, onde)
  }
}

// Para onde a chamada vai, e se o segredo da conexão pode ir junto.
//
// ESTA É A REGRA QUE SUSTENTA O ENDEREÇO PRÓPRIO.
//
// Segredo pertence a um SERVIÇO, não à conexão como objeto. Se a função aponta
// para outra origem, mandar o `Authorization` da conexão entregaria a chave de
// um serviço a outro — e não por ataque nenhum: bastaria alguém editar um campo
// de caminho e não perceber o que mudou junto.
//
// A comparação é por ORIGEM inteira (esquema + host + porta), não só pelo nome
// do host: o mesmo host em `http` em vez de `https` é rebaixamento de
// transporte, e mandar credencial em claro por causa disso seria o mesmo
// vazamento com outra roupa.
export function resolverDestino (endereco, funcao) {
  if (!funcao?.enderecoProprio) {
    return { url: `${endereco}${funcao.caminho}`, enviaSegredo: true }
  }
  const daConexao = new URL(endereco)
  const daFuncao = new URL(funcao.caminho)
  return {
    url: funcao.caminho,
    enviaSegredo: daConexao.origin === daFuncao.origin
  }
}

// O endereço do serviço.
//
// Só http/https, e a recusa é explícita: um `file://` ou um esquema exótico aqui
// viraria leitura de disco pelo processo do gateway.
export function validarEndereco (endereco) {
  const texto = exigirTexto(endereco, 'O endereço do serviço')
  let url
  try {
    url = new URL(texto)
  } catch {
    throw new ErroDeDeclaracao(`Endereço inválido: "${texto}". Escreva algo como http://127.0.0.1:8765.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ErroDeDeclaracao(`Endereço precisa ser http ou https — veio "${url.protocol}".`)
  }
  return texto.replace(/\/+$/, '')
}

export function validarConfiguracao (config) {
  const endereco = validarEndereco(config?.endereco)
  const autenticacao = validarAutenticacao(config?.autenticacao)
  const funcoes = (Array.isArray(config?.funcoes) ? config.funcoes : []).map(validarFuncao)
  const nomes = new Set()
  for (const f of funcoes) {
    if (nomes.has(f.nome)) throw new ErroDeDeclaracao(`A função "${f.nome}" está declarada duas vezes nesta conexão.`)
    nomes.add(f.nome)
  }
  return { endereco, autenticacao, funcoes }
}
