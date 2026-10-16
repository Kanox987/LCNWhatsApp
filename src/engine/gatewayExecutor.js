import * as enviadas from '../enviadas.js'
import { montarFilho, montarPai, podeVirarAlbum } from './album.js'
import { montarCard, montarCarrossel, podeVirarCarrossel } from './carrossel.js'

const TIMEOUT_ENVIO_MS = 15000
const TIMEOUT_CONFIRMACAO_MS = 1500

function mensagemDoErro (erro) {
  try {
    return erro instanceof Error ? erro.message : String(erro || 'falha desconhecida')
  } catch {
    return 'falha desconhecida'
  }
}

// O que pode ir para o WhatsApp. `ErroDeDownload` carrega duas versões do mesmo
// problema: `message` é o diagnóstico (endereço do serviço, caminho do token,
// status HTTP) e `paraPessoa` é a frase limpa. O log fica com a primeira, a
// conversa com a segunda — quem mandou um link não tem o que fazer com endereço
// interno, e mostrar isso vaza a topologia para qualquer um.
//
// Nomeado em vez de repetido inline porque são DOIS caminhos de falha, e o
// segundo (envio falhando depois do download) estava mandando o erro cru.
function mensagemParaPessoa (erro) {
  const limpa = erro?.paraPessoa
  return typeof limpa === 'string' && limpa ? limpa : mensagemDoErro(erro)
}

// "Não sei se aconteceu" é diferente de "não aconteceu", e o invariante 3 diz
// que resultado ambíguo nunca vira sucesso — mas também não pode virar falha,
// senão o operador tenta consertar à mão algo que talvez já tenha ocorrido.
// Mesmo mecanismo do timeout: um código no erro que o laço traduz em status.
function erroIncerto (mensagem) {
  const erro = new Error(mensagem)
  erro.code = 'LCN_RESULTADO_INCERTO'
  return erro
}

function comTimeout (operacao, timeoutMs, mensagem) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const erro = new Error(mensagem)
      erro.code = 'LCN_TIMEOUT'
      reject(erro)
    }, timeoutMs)
  })
  return Promise.race([Promise.resolve().then(operacao), timeout])
    .finally(() => clearTimeout(timer))
}

// Único placeholder suportado (não é um motor de template genérico): o
// motor não sabe quando a mensagem vai sair de verdade, só o gateway sabe,
// bem aqui, no instante antes do send — por isso a resolução final acontece
// neste processo, não no motor.
function resolverTextoComLatencia (texto, receivedAtMs) {
  if (typeof texto !== 'string' || typeof receivedAtMs !== 'number') return texto
  return texto.replaceAll('{{latencyMs}}', String(Date.now() - receivedAtMs))
}

async function confirmarFailOpen (clienteEngine, comando, status, resultado = null) {
  try {
    await comTimeout(
      () => clienteEngine.execucoes.confirmar(comando.id, { status, ...(resultado ? { resultado } : {}) }),
      TIMEOUT_CONFIRMACAO_MS,
      `timeout ao confirmar o comando ${comando.id}`
    )
  } catch (erro) {
    console.warn(`[engine] Não foi possível confirmar o comando ${comando?.id || '(sem id)'}: ${mensagemDoErro(erro)}`)
  }
}

// Responder MARCANDO a mensagem que originou a conversa.
//
// A citação é OPÇÃO DE ENVIO (terceiro argumento do `send`), não campo do
// conteúdo. A versão anterior punha `contextInfo: { quoted: { key } }` dentro
// do conteúdo, e `quoted` não existe no contrato da biblioteca — os campos são
// `quotedMessageId`/`quotedParticipant`/`quotedRemoteJid`. Campo desconhecido é
// descartado sem erro, então TODA citação deste bot era silenciosamente
// ignorada: as mensagens saíam soltas e nada indicava o problema.
//
// O motor manda só o endereçamento (`replyTo`), nunca o conteúdo — a mesma
// fronteira de sempre. Sem `replyTo`, a mensagem sai solta de propósito.
// Envia e ANOTA o id no registro de "mandado por nós".
//
// Toda saída passa por aqui de propósito: é esse registro que deixa o gatilho
// automático separar a resposta do próprio bot — que não pode reagir a si
// mesma, sob pena de laço — de uma mensagem digitada por uma pessoa no celular
// do bot, que pode e deve disparar automação. Um envio que escape daqui volta
// a parecer "digitado por alguém".
async function enviarERegistrar (client, destino, conteudo, opcoes) {
  const resultado = await client.message.send(destino, conteudo, opcoes)
  enviadas.registrar(resultado?.id)
  return resultado
}

function opcoesDeCitacao (replyTo) {
  if (!replyTo?.id || !replyTo?.remoteJid) return undefined
  const quote = { id: replyTo.id, remoteJid: replyTo.remoteJid, fromMe: replyTo.fromMe === true }
  if (replyTo.participant) quote.participant = replyTo.participant
  return { quote }
}

async function executarResposta (client, comando) {
  const texto = resolverTextoComLatencia(comando.payload.text, comando.payload.receivedAtMs)
  await comTimeout(
    () => enviarERegistrar(client, comando.payload.chatId, { type: 'text', text: texto }, opcoesDeCitacao(comando.payload.replyTo)),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar o comando ${comando.id}`
  )
}

// Recuperação de visualização única — o comando que deu origem ao projeto.
// O motor decidiu que era pra recuperar; aqui a mídia é de fato baixada (o
// token só resolve neste processo) e reenviada como mídia normal.
// 'saved_messages' resolve para o JID da própria conta, que só este lado
// conhece: o motor mandou o destino como intenção, não como endereço.
async function executarRecover (client, comando, deps) {
  const { mediaRefCache, baixarBuffer, limiteBytes, resolverJidProprio } = deps

  const entrada = mediaRefCache.resolver(comando.payload.mediaRef)
  if (!entrada) {
    throw new Error('a visualização única expirou antes do comando voltar do motor')
  }

  const destino = comando.payload.destination === 'saved_messages' || !comando.payload.destinationId
    ? resolverJidProprio(client)
    : comando.payload.destinationId
  if (!destino) throw new Error('não foi possível resolver o destino da recuperação')

  const buffer = await baixarBuffer(client, entrada.node, entrada.tipo, limiteBytes)
  if (!buffer?.length) throw new Error('a mídia da visualização única veio vazia')

  // O mimetype vem do nó original, e é OBRIGATÓRIO para vídeo: sem ele a
  // biblioteca recusa o envio com "mimetype is required for video messages", e
  // a recuperação falha depois de já ter baixado a mídia. Imagem e áudio também
  // ganham, porque mandar o tipo certo é sempre melhor que deixar adivinhar.
  const conteudo = { type: entrada.tipo, media: buffer }
  const mimetype = entrada.node?.mimetype
  if (typeof mimetype === 'string' && mimetype) conteudo.mimetype = mimetype
  else if (entrada.tipo === 'video') conteudo.mimetype = 'video/mp4'
  if (comando.payload.caption) conteudo.caption = comando.payload.caption

  await comTimeout(
    () => enviarERegistrar(client, destino, conteudo),
    TIMEOUT_ENVIO_MS,
    `timeout ao reenviar a mídia recuperada do comando ${comando.id}`
  )
}

// Baixar mídia de um link e mandar no WhatsApp.
//
// Roda INTEIRO aqui, de propósito: pedir ao serviço, esperar o trabalho e
// buscar os bytes são três idas à rede que o motor nunca poderia fazer. O motor
// só decidiu "baixe esta URL e mande aqui, marcando aquela mensagem".
//
// Duas mensagens saem: um aviso na hora (download demora, e silêncio parece que
// o comando não funcionou) e a mídia no fim. As duas marcam a mensagem que tinha
// o link, que é a única forma de saber a qual link a resposta se refere quando a
// conversa andou no meio do caminho.
// Depois de prometer "estou fazendo", qualquer desfecho ruim precisa virar
// mensagem. Ficar com o aviso pendurado e nada depois é o pior resultado: não
// dá nem para saber se o comando funcionou.
//
// Extraído porque agora são dois caminhos que prometem e precisam cumprir — o
// download e a chamada de conexão.
function criarAvisador (client, comando, { chatId, replyTo, errorText }) {
  return async (motivo) => {
    const texto = (errorText || '{{erro}}').replaceAll('{{erro}}', motivo)
    try {
      await comTimeout(
        () => enviarERegistrar(client, chatId, { type: 'text', text: texto }, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar a falha do comando ${comando.id}`
      )
    } catch (erro) {
      // Já estamos num caminho de erro; o throw de quem chamou é o que importa.
      console.warn(`[engine] Não consegui nem avisar a falha: ${mensagemDoErro(erro)}`)
    }
  }
}

// Nota informativa DEPOIS de uma entrega que deu certo. Separada do avisador de
// propósito: aquele é o canal de ERRO e embrulha o texto no `errorText`
// configurado, então usá-lo aqui mandaria "erro: ..." para quem acabou de
// receber as fotos com sucesso.
function criarNotificador (client, comando, { chatId, replyTo }) {
  return async (texto) => {
    try {
      await comTimeout(
        () => enviarERegistrar(client, chatId, { type: 'text', text: texto }, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao mandar a nota do comando ${comando.id}`
      )
    } catch (erro) {
      // A entrega principal já aconteceu; não estragar o comando por causa da nota.
      console.warn(`[engine] Não consegui mandar a nota: ${mensagemDoErro(erro)}`)
    }
  }
}

async function executarDownload (client, comando, deps) {
  const { criarBaixador, cfg } = deps
  const { chatId, url, modo, entrega, replyTo, ackText, caption, errorText } = comando.payload

  const avisar = criarAvisador(client, comando, { chatId, replyTo, errorText })
  const nota = criarNotificador(client, comando, { chatId, replyTo })

  if (ackText) {
    // Aviso é cortesia, não a entrega: se ele falhar, o download continua.
    try {
      await comTimeout(
        () => enviarERegistrar(client, chatId, { type: 'text', text: ackText }, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar o início do download do comando ${comando.id}`
      )
    } catch (erro) {
      console.warn(`[engine] Não consegui avisar o início do download: ${mensagemDoErro(erro)}`)
    }
  }

  let midia
  try {
    midia = await criarBaixador({ cfg }).baixar(url, modo)
  } catch (erro) {
    // O registro fica como falha mesmo assim — a pessoa recebeu uma mensagem,
    // mas não recebeu o que pediu, e o histórico não pode dizer que deu certo.
    //
    // `paraPessoa` quando existe: o erro cru carrega endereço do serviço,
    // caminho do arquivo de token e nome de campo do config.json. Nada disso é
    // acionável por quem só mandou um link, e parte disso nem deveria sair
    // daqui. O detalhe continua inteiro no log, para o dono.
    await avisar(mensagemParaPessoa(erro))
    throw erro
  }

  // A descrição vinda do serviço (título do vídeo, autor) só entra quando o
  // comando não trouxe legenda própria — quem configurou manda.
  const legenda = caption || midia.descricao
  const midias = midia.midias
  const bytesTotais = midias.reduce((n, m) => n + m.buffer.length, 0)

  try {
    await entregarMidias(client, chatId, midias, {
      legenda, entrega, opcoesCitacao: opcoesDeCitacao(replyTo), comandoId: comando.id
    })
  } catch (erro) {
    // ESTE é o caso que deixou o dono olhando "⏳ Baixando…" para sempre: o
    // arquivo veio inteiro e o envio ao WhatsApp é que falhou. O tamanho entra
    // na mensagem porque é a causa mais provável — o serviço aceita arquivo
    // muito maior do que o WhatsApp entrega.
    await avisar(`baixei ${formatarMB(bytesTotais)} mas não consegui enviar aqui (${mensagemParaPessoa(erro)})`)
    throw erro
  }

  // Entregar 8 de 10 fotos calado faria a pessoa achar que o post tinha 8.
  if (midia.foraPorTamanho > 0) {
    const n = midia.foraPorTamanho
    await nota(n === 1
      ? '⚠️ Um dos arquivos era grande demais para o WhatsApp e ficou de fora.'
      : `⚠️ ${n} arquivos eram grandes demais para o WhatsApp e ficaram de fora.`)
  }
}

// Uma mídia por mensagem, na ordem. É o que sempre funciona, e é a queda do
// álbum — nunca há caminho em que as mídias simplesmente não chegam.
const SEM_LEGENDA = new Set(['audio', 'sticker'])

async function enviarEmSequencia (client, chatId, midias, legenda, opcoesCitacao, comandoId) {
  // A legenda vai na PRIMEIRA mídia que aceita legenda — e, se nenhuma aceita,
  // numa mensagem de texto depois.
  //
  // Antes ela só tentava a primeira, e caía no chão quando essa primeira era
  // áudio ou figurinha. Foi o que apareceu na música: o serviço devolve o áudio
  // e a capa, o áudio vem primeiro, e o nome da faixa — a única coisa que diz
  // QUAL música chegou — não era enviado por lugar nenhum.
  const comLegenda = legenda ? midias.findIndex((m) => !SEM_LEGENDA.has(m.tipo)) : -1

  for (const [i, m] of midias.entries()) {
    const conteudo = { type: m.tipo, media: m.buffer, mimetype: m.mime }
    if (m.tipo === 'document') conteudo.fileName = m.nome
    // Uma só leva a legenda: repetida em cada uma, o mesmo texto apareceria
    // dez vezes seguidas. Áudio e figurinha não têm legenda no WhatsApp —
    // mandar uma faria a biblioteca recusar o envio inteiro por causa de um
    // campo decorativo.
    if (i === comLegenda) conteudo.caption = legenda
    await comTimeout(
      // Citar só a primeira: dez respostas citando a mesma mensagem poluem a
      // conversa sem informar nada a mais.
      () => enviarERegistrar(client, chatId, conteudo, i === 0 ? opcoesCitacao : undefined),
      TIMEOUT_ENVIO_MS * 4,
      `timeout ao enviar a mídia ${i + 1}/${midias.length} do comando ${comandoId}`
    )
  }

  // Nenhuma mídia aceitou a legenda (um áudio sozinho, uma figurinha): o texto
  // vai como mensagem, pelo mesmo caminho que o carrossel já usa.
  if (legenda && comLegenda === -1) {
    await comTimeout(
      () => enviarERegistrar(client, chatId, { type: 'text', text: legenda }),
      TIMEOUT_ENVIO_MS,
      `timeout ao enviar a legenda do comando ${comandoId}`
    )
  }
}

// Álbum de verdade: um "pai" declarando quantas fotos e vídeos vêm, e cada
// mídia pendurada nele por `messageAssociation`. Ver src/engine/album.js para
// por que isto é proto cru e por que a queda abaixo é parte do desenho.
async function enviarComoAlbum (client, chatId, midias, legenda, opcoesCitacao, comandoId) {
  let pai
  try {
    pai = await comTimeout(
      () => enviarERegistrar(client, chatId, montarPai(midias), opcoesCitacao),
      TIMEOUT_ENVIO_MS,
      `timeout ao abrir o álbum do comando ${comandoId}`
    )
    if (!pai?.id) throw new Error('o servidor não devolveu o id do álbum')

    for (const [i, m] of midias.entries()) {
      const upload = await client.message.upload(m.buffer, {
        type: m.tipo === 'video' ? 'video' : 'image',
        mimetype: m.mime
      })
      // Só a primeira leva legenda, que é como um álbum de verdade aparece.
      // Picar o texto entre as mídias foi tentado e o dono recusou: "ficou
      // muito feio".
      const filho = montarFilho(m, upload, { chatId, paiId: pai.id, indice: i + 1, legenda: i === 0 ? legenda : null })
      await comTimeout(
        () => enviarERegistrar(client, chatId, filho),
        TIMEOUT_ENVIO_MS * 4,
        `timeout ao enviar a mídia ${i + 1}/${midias.length} do álbum do comando ${comandoId}`
      )
    }
    // O sucesso também fala. Sem isto, "o álbum saiu e o aplicativo não
    // agrupou" e "o álbum nem foi tentado" ficam indistinguíveis — e são
    // problemas em lugares completamente diferentes.
    console.log(`[engine] álbum ${comandoId}: pai ${pai.id} fechado com ${midias.length} mídia(s)`)
  } catch (erro) {
    // Queda para sequência, e ela é DELIBERADA: o protocolo tem álbum, mas nada
    // garante que o servidor aceite de um bot ou que o app de quem recebe
    // agrupe. Igual ao menu com botões — o conteúdo sempre chega de algum jeito.
    //
    // O risco aceito aqui é entregar o álbum pela metade e repetir as mídias já
    // enviadas. Preferir isso a não entregar nada é a mesma escolha do
    // outcome_unknown: melhor duplicar do que sumir em silêncio.
    console.warn(`[engine] Álbum não foi aceito (${mensagemDoErro(erro)}) — enviando as mídias em sequência.`)
    await enviarEmSequencia(client, chatId, midias, legenda, opcoesCitacao, comandoId)
  }
}

// Chamar uma FUNÇÃO declarada numa conexão.
//
// O motor decidiu QUAL conexão e QUAL função e resolveu as entradas; aqui a
// declaração é buscada no motor (pelo socket — o painel nunca expõe essa rota,
// porque ela devolve a chave) e a chamada acontece.
//
// Isto é o que tira o `baixa` de dentro do compilador: endereço, método,
// credencial e o formato da resposta passam a ser dado que o dono edita na aba
// Conexões, em vez de código que só eu mexo.
// Nome e tipo do arquivo que sai daqui. O serviço do outro lado decide o que
// fazer pelo que recebe, então mandar tudo como "arquivo"/octet-stream faria
// qualquer API ter que adivinhar.
const MIME_POR_TIPO = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg', sticker: 'image/webp', document: 'application/octet-stream' }
const EXTENSAO_POR_TIPO = { image: 'jpg', video: 'mp4', audio: 'ogg', sticker: 'webp', document: 'bin' }

function mimeProvavel (tipo) {
  return MIME_POR_TIPO[tipo] || 'application/octet-stream'
}

function nomeDeArquivoDaMidia (tipo, mime) {
  // A extensão sai do mime quando ele veio, porque ele é o que o WhatsApp
  // realmente disse; o tipo é só a categoria.
  const doMime = typeof mime === 'string' ? mime.split('/')[1]?.split(';')[0] : null
  return `arquivo.${doMime || EXTENSAO_POR_TIPO[tipo] || 'bin'}`
}

async function executarChamadaDeConexao (client, comando, deps) {
  const { chatId, conexao, funcao, entradas, entrega, replyTo, ackText, caption, errorText, mediaInput, mediaRef, mediaInput2, mediaRef2 } = comando.payload
  const { clienteEngine, criarExecutorDeConexao, mediaRefCache, baixarBuffer, limiteBytes } = deps
  if (!clienteEngine?.conexoes?.resolvida) throw new Error('sem acesso ao motor para resolver a conexão')

  const avisar = criarAvisador(client, comando, { chatId, replyTo, errorText })
  const nota = criarNotificador(client, comando, { chatId, replyTo })

  if (ackText) {
    // Aviso é cortesia, não a entrega: se ele falhar, a chamada continua.
    try {
      await comTimeout(
        () => enviarERegistrar(client, chatId, { type: 'text', text: ackText }, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar o início da chamada do comando ${comando.id}`
      )
    } catch (erro) {
      console.warn(`[engine] Não consegui avisar o início da chamada: ${mensagemDoErro(erro)}`)
    }
  }

  // O arquivo da mensagem, quando a função pede um.
  //
  // Mesma fronteira da figurinha e do /recover: o motor mandou um token opaco,
  // e só ESTE processo consegue trocá-lo por bytes. O motor nunca viu a mídia.
  //
  // São DOIS porque existe função de duas fotos: trocar o fundo recebe a foto
  // da pessoa e a foto que vira o fundo, e a mensagem de um comando carrega as
  // duas — a citada e a anexada. Qual entrada recebe qual já veio decidido pelo
  // motor; aqui só se troca token por bytes.
  const resolverArquivo = async (ref, campo) => {
    if (!campo || !ref) return null
    const entrada = mediaRefCache.resolver(ref)
    if (!entrada) {
      // TTL curto de propósito. Erro CONHECIDO, não ambíguo: nada foi enviado.
      const recado = 'A mídia deste comando expirou antes de eu conseguir usá-la. Manda de novo.'
      await avisar(recado)
      throw new Error('a mídia da chamada de conexão expirou antes do comando voltar do motor')
    }
    // O arquivo pode já estar AQUI: quando ele veio de uma chamada anterior da
    // cadeia, os bytes nunca saíram deste processo — o cache guardou o próprio
    // buffer em vez de um nó do WhatsApp. Tentar baixar de novo seria pedir ao
    // WhatsApp uma mídia que nunca foi dele.
    const buffer = entrada.node?.lcnBuffer
      ? entrada.node.lcnBuffer
      : await baixarBuffer(client, entrada.node, entrada.tipo, limiteBytes)
    // O mime vem do nó da mídia — é o que o WhatsApp disse que aquilo é, e vale
    // mais que a categoria. `entrada.tipo` é só "image/video/audio".
    const mime = entrada.node?.mimetype || mimeProvavel(entrada.tipo)
    return {
      // Nome e tipo são do ARQUIVO, não do campo: é por eles que o serviço do
      // outro lado sabe o que recebeu.
      buffer,
      nome: nomeDeArquivoDaMidia(entrada.tipo, mime),
      mime,
      // O campo só é escrito para o SEGUNDO: o do primeiro vem da declaração,
      // que é quem sabe qual entrada da função recebe o arquivo.
      ...(campo === mediaInput2 ? { campo } : {})
    }
  }
  const arquivo = await resolverArquivo(mediaRef, mediaInput)
  const arquivo2 = await resolverArquivo(mediaRef2, mediaInput2)

  let resultado
  try {
    const declaracao = await clienteEngine.conexoes.resolvida(conexao)
    resultado = await criarExecutorDeConexao().executar(declaracao, funcao, entradas || {}, arquivo, arquivo2)
  } catch (erro) {
    await avisar(mensagemParaPessoa(erro))
    throw erro
  }

  // ELO DE CADEIA: não entrega nada. Guarda o arquivo aqui mesmo — no mesmo
  // cache da mídia que chega pela conversa — e devolve a REFERÊNCIA. O motor
  // retoma o fluxo com ela e o passo seguinte a recebe como arquivo.
  //
  // O invariante 4 não muda de lado: os bytes continuam só neste processo, e o
  // que atravessa é token. É o contrato de sempre, usado na outra direção.
  if (comando.payload.encadeado) {
    if (resultado.forma === 'texto') {
      const texto = typeof resultado.dados === 'string' ? resultado.dados : JSON.stringify(resultado.dados)
      return { texto }
    }
    const primeira = (resultado.midias || [])[0]
    if (!primeira) {
      await avisar('a chamada terminou mas não veio arquivo nenhum')
      throw new Error(`a chamada ${conexao}.${funcao} não devolveu arquivo para o passo seguinte`)
    }
    // Mais de um arquivo no meio de um cano é ambíguo: qual deles segue? Em
    // vez de escolher calado, o primeiro segue e o resto é dito.
    if ((resultado.midias || []).length > 1) {
      await nota(`⚠️ A conversão devolveu ${resultado.midias.length} arquivos e o próximo passo usa só o primeiro.`)
    }
    return {
      token: mediaRefCache.criar({ node: { lcnBuffer: primeira.buffer, mimetype: primeira.mime }, tipo: primeira.tipo, interno: {} }),
      tipo: primeira.tipo,
      mime: primeira.mime
    }
  }

  // Resposta de texto vai como texto. É o caso de uma IA, de uma consulta de
  // preço, de qualquer coisa que responda em palavras.
  if (resultado.forma === 'texto') {
    const texto = typeof resultado.dados === 'string' ? resultado.dados : JSON.stringify(resultado.dados)
    await comTimeout(
      () => enviarERegistrar(client, chatId, { type: 'text', text: texto }, opcoesDeCitacao(replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao responder a chamada do comando ${comando.id}`
    )
    return
  }

  // Resposta com arquivos: o executor já os buscou (ele tem o endereço e a
  // credencial). Aqui só entrega, pelo mesmo caminho do download — álbum quando
  // dá, sequência quando não dá.
  const midias = resultado.midias || []
  if (!midias.length) {
    await avisar('a chamada terminou mas não veio arquivo nenhum')
    throw new Error(`a chamada ${conexao}.${funcao} não devolveu arquivo`)
  }

  const bytesTotais = midias.reduce((n, m) => n + m.buffer.length, 0)
  try {
    await entregarMidias(client, chatId, midias, {
      // A descrição do serviço (título do vídeo, autor) só entra quando o
      // comando não trouxe legenda própria — quem configurou manda.
      legenda: caption || resultado.descricao || null,
      entrega,
      opcoesCitacao: opcoesDeCitacao(replyTo),
      comandoId: comando.id
    })
  } catch (erro) {
    await avisar(`recebi ${formatarMB(bytesTotais)} mas não consegui enviar aqui (${mensagemParaPessoa(erro)})`)
    throw erro
  }
  if (resultado.foraPorTamanho > 0) {
    const n = resultado.foraPorTamanho
    await nota(n === 1
      ? '⚠️ Um dos arquivos era grande demais para o WhatsApp e ficou de fora.'
      : `⚠️ ${n} arquivos eram grandes demais para o WhatsApp e ficaram de fora.`)
  }
}

// Guardar no acervo a mídia que chegou pelo WhatsApp.
//
// O par que faltava: o acervo sabia ENVIAR (`whatsapp.sendFile`) e só entrava
// coisa por upload no painel. Agora o arquivo que alguém mandou na conversa
// pode virar acervo sem sair do WhatsApp.
//
// Mesma fronteira da figurinha: o motor mandou o token opaco, e quem o resolve
// e carrega bytes é este lado.
async function executarGuardarNoAcervo (client, comando, deps) {
  const { mediaRefCache, baixarBuffer, acervo, limiteBytes } = deps
  const { chatId, mediaRef, sourceKind, replyTo, pasta, nome, descricao, okText, errorText } = comando.payload

  const avisar = criarAvisador(client, comando, { chatId, replyTo, errorText })

  const entrada = mediaRefCache.resolver(mediaRef)
  if (!entrada) {
    // TTL do cache é curto de propósito. Comando que volta tarde do motor não
    // resolve mais a mídia — e é erro conhecido, não resultado ambíguo.
    await avisar('a mídia expirou antes do comando voltar do motor')
    throw new Error('a mídia deste arquivo expirou antes do comando voltar do motor')
  }

  let guardado
  try {
    const buffer = await baixarBuffer(client, entrada.node, entrada.tipo, limiteBytes)
    guardado = acervo.guardar(buffer, {
      mimetype: entrada.node?.mimetype || entrada.mimetype || null,
      name: nome || entrada.node?.fileName || null,
      description: descricao || null,
      folder: pasta || null
    })
  } catch (erro) {
    // O erro do acervo é acionável por quem mandou: "tipo não aceito",
    // "grande demais", "não cabe". Vai inteiro, ao contrário dos nossos.
    await avisar(erro?.message || 'não consegui guardar')
    throw erro
  }

  if (okText) {
    const texto = okText
      .replaceAll('{{caminho}}', guardado.path)
      .replaceAll('{{id}}', guardado.id)
      .replaceAll('{{nome}}', guardado.name)
    await comTimeout(
      () => enviarERegistrar(client, chatId, { type: 'text', text: texto }, opcoesDeCitacao(replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao confirmar o arquivo guardado do comando ${comando.id}`
    )
  }
}

// A entrega de mídias, compartilhada pelo download e pela chamada de conexão.
//
// Estava embutida no download; virou função porque agora são dois caminhos que
// terminam do mesmo jeito. Duplicar traria o problema de sempre: o dia em que
// um for ajustado, o outro fica para trás sem ninguém notar.
// O carrossel de verdade: UMA mensagem com as mídias em cards.
//
// Cai para o álbum quando não é aceito, e o álbum cai para sequência. A
// escada é deliberada, igual à do menu com botões: do melhor formato ao que
// sempre chega. O conteúdo nunca depende de o formato bonito funcionar.
async function enviarComoCarrossel (client, chatId, midias, legenda, opcoesCitacao, comandoId) {
  try {
    const cards = []
    for (const m of midias) {
      const upload = await client.message.upload(m.buffer, {
        type: m.tipo === 'video' ? 'video' : 'image',
        mimetype: m.mime
      })
      // CARD SEM LEGENDA, de propósito.
      //
      // A primeira tentativa foi espalhar a legenda pelos cards, e o dono
      // olhou o resultado: "mudei de ideia, não vai dar para fazer isso, ficou
      // muito feio". O card é estreito e a legenda de um post do Instagram é
      // longa — texto picado dentro de cada quadrinho polui o carrossel
      // inteiro. A legenda vai inteira numa mensagem logo abaixo.
      cards.push(montarCard(m, upload))
    }
    await comTimeout(
      () => enviarERegistrar(client, chatId, montarCarrossel(cards), opcoesCitacao),
      TIMEOUT_ENVIO_MS * 4,
      `timeout ao enviar o carrossel do comando ${comandoId}`
    )
    console.log(`[engine] carrossel ${comandoId}: uma mensagem com ${cards.length} card(s)`)
    if (legenda) {
      await comTimeout(
        () => enviarERegistrar(client, chatId, { type: 'text', text: legenda }),
        TIMEOUT_ENVIO_MS,
        `timeout ao enviar a legenda do comando ${comandoId}`
      )
    }
  } catch (erro) {
    console.warn(`[engine] Carrossel não foi aceito (${mensagemDoErro(erro)}) — tentando como álbum.`)
    await enviarComoAlbum(client, chatId, midias, legenda, opcoesCitacao, comandoId)
  }
}

async function entregarMidias (client, chatId, midias, { legenda, entrega, opcoesCitacao, comandoId }) {
  // Quem montou o comando escolheu; "carrossel" é só o padrão.
  const comoCarrossel = (!entrega || entrega === 'carrossel') && podeVirarCarrossel(midias)
  const comoAlbum = !comoCarrossel && entrega !== 'separate' && podeVirarAlbum(midias)

  // POR QUE ESTA LINHA EXISTE. O dono relatou que um post de várias fotos não
  // chega em carrossel, e não deu para responder por quê: o caminho inteiro
  // era mudo. Álbum só avisava quando CAÍA para sequência, então "nada no log"
  // significava as duas coisas ao mesmo tempo — "nem tentou" e "tentou e deu
  // certo". Agora cada entrega diz o que recebeu e por onde foi.
  //
  // `podeVirarAlbum` exige mais de uma mídia e TODAS foto ou vídeo. Quando a
  // resposta for "sequência", os tipos aqui dizem qual das duas condições
  // faltou, sem precisar de outro teste.
  const caminho = comoCarrossel ? 'carrossel' : (comoAlbum ? 'álbum' : 'sequência')
  console.log(`[engine] entrega ${comandoId}: ${midias.length} mídia(s) [${midias.map((m) => m.tipo).join(', ')}], pedido=${entrega || 'carrossel'} -> ${caminho}`)

  if (comoCarrossel) {
    await enviarComoCarrossel(client, chatId, midias, legenda, opcoesCitacao, comandoId)
  } else if (comoAlbum) {
    await enviarComoAlbum(client, chatId, midias, legenda, opcoesCitacao, comandoId)
  } else {
    await enviarEmSequencia(client, chatId, midias, legenda, opcoesCitacao, comandoId)
  }
}

function formatarMB (bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

// Menu com botões. A lib não expõe um `type: 'menu'` pronto, mas aceita
// protobuf cru no envio e sabe codificar interactiveMessage/nativeFlowMessage
// — o formato é o mesmo que os bots de referência usam.
//
// Mensagem com botão depende do app de quem recebe: versões antigas do
// WhatsApp simplesmente não renderizam. Por isso o fallback para texto não é
// tratamento de erro, é parte do desenho — o menu SEMPRE chega de algum jeito.
function montarMenuInterativo (payload) {
  const linhas = payload.items.slice(0, 10).map((item) => ({
    title: item.label,
    description: item.description || '',
    id: item.id
  }))

  return {
    interactiveMessage: {
      body: { text: payload.header || 'Comandos disponíveis:' },
      ...(payload.footer ? { footer: { text: payload.footer } } : {}),
      nativeFlowMessage: {
        buttons: [{
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: payload.title || 'Ver comandos',
            sections: [{ title: payload.header || 'Comandos', rows: linhas }]
          })
        }],
        messageParamsJson: ''
      }
    }
  }
}

async function executarMenu (client, comando) {
  const payload = comando.payload
  try {
    await comTimeout(
      () => enviarERegistrar(client, payload.chatId, montarMenuInterativo(payload)),
      TIMEOUT_ENVIO_MS,
      `timeout ao enviar o menu do comando ${comando.id}`
    )
  } catch (erro) {
    if (erro?.code === 'LCN_TIMEOUT') throw erro
    // O envio interativo falhou (app antigo, formato recusado pelo servidor).
    // Cair para texto é melhor que a pessoa ficar sem menu nenhum.
    console.warn(`[engine] Menu interativo recusado, enviando como texto: ${mensagemDoErro(erro)}`)
    await comTimeout(
      () => enviarERegistrar(client, payload.chatId, { type: 'text', text: payload.fallbackText }),
      TIMEOUT_ENVIO_MS,
      `timeout ao enviar o menu em texto do comando ${comando.id}`
    )
  }
}

// Apagar a mensagem que acionou a regra. A lib pede { type:'revoke', target }
// com a chave da mensagem — o motor mandou a providerRef original, que é
// exatamente essa chave.
async function executarApagar (client, comando) {
  const ref = comando.payload.messageRef
  const target = {
    remoteJid: ref.remoteJid || comando.payload.chatId,
    id: ref.id,
    fromMe: ref.fromMe === true,
    ...(ref.participant ? { participant: ref.participant } : {})
  }
  await comTimeout(
    () => enviarERegistrar(client, comando.payload.chatId, { type: 'revoke', target }),
    TIMEOUT_ENVIO_MS,
    `timeout ao apagar a mensagem do comando ${comando.id}`
  )
}

// Acha, na resposta por participante, o item que fala do participante pedido.
//
// O casamento é por `jid`, mas com uma saída: pedimos a remoção de UM
// participante só, então um array de um item é a resposta sobre esse pedido,
// mesmo que o servidor devolva o identificador noutro formato — LID e telefone
// são o mesmo alvo aqui, e exigir igualdade literal transformaria remoção
// normal em "resultado incerto". Com mais de um item e nenhum casando, aí não
// dá pra saber qual é qual: devolve null e o chamador trata como incerto.
function acharResultadoDoParticipante (resultado, participantId) {
  if (!Array.isArray(resultado) || resultado.length === 0) return null
  const exato = resultado.find((item) => item?.jid === participantId)
  if (exato) return exato
  return resultado.length === 1 ? resultado[0] : null
}

// Remover participante do grupo. Só funciona se o bot for admin.
//
// O contrato da lib (WaGroupCoordinator, parseParticipantActionResult) é
// `{ jid, status: 'ok' | 'error', code: number }` — o `code` é 200 quando o nó
// não trouxe atributo de erro, e o próprio número do erro quando trouxe. Ler
// `status ?? code` e comparar com '200' dava sempre 'ok' !== '200', ou seja,
// TODA remoção bem-sucedida era gravada como falha, com a mensagem errada.
async function executarRemoverDoGrupo (client, comando) {
  const { chatId, participantId } = comando.payload
  const resultado = await comTimeout(
    () => client.group.removeParticipants(chatId, [participantId]),
    TIMEOUT_ENVIO_MS,
    `timeout ao remover ${participantId} do comando ${comando.id}`
  )

  const item = acharResultadoDoParticipante(resultado, participantId)
  if (!item) {
    throw erroIncerto(`o WhatsApp não confirmou a remoção de ${participantId}: a resposta não trouxe o participante pedido`)
  }

  const codigo = Number(item.code)
  const codigoConhecido = Number.isFinite(codigo)
  const codigoOk = codigoConhecido && codigo >= 200 && codigo < 300

  // Sucesso exige as DUAS confirmações. Uma resposta que traga só metade do
  // contrato é resposta que não entendemos, e não entender não é ter dado certo.
  if (item.status === 'ok' && codigoOk) return

  if (item.status === 'error' || (codigoConhecido && !codigoOk)) {
    const motivo = codigo === 403
      ? 'o bot não é admin do grupo'
      : 'o WhatsApp recusou'
    throw new Error(`a remoção de ${participantId} não aconteceu: ${motivo} (código ${codigoConhecido ? codigo : item.status})`)
  }

  throw erroIncerto(`o WhatsApp respondeu a remoção de ${participantId} num formato que não sei ler (status ${item.status}, código ${item.code}) — não dá para afirmar que aconteceu`)
}

// ⚠️ CAMINHO NÃO OFICIAL DO WHATSAPP — leia antes de mexer.
//
// Não existe API de "mensagem formatada" para bots comuns. O que existe é o
// app renderizar conteúdo rico quando ele vem da Meta AI. Para conseguir isso,
// a mensagem sai marcada como ENCAMINHADA da Meta AI (o JID e o nome do bot
// oficial deles vão no contexto). Duas consequências práticas:
//   1. Nada disso é documentado, então a Meta pode invalidar a qualquer
//      momento, sem aviso e sem versão. É o motivo de o fallback em texto
//      comum ser obrigatório e não opcional.
//   2. A mensagem se apresenta ao destinatário como conteúdo da Meta AI,
//      embora saia do número de quem usa o bot.
// Por isso o template que usa esta ação carrega aviso de "recurso não
// oficial": não é para virar o formato padrão de nada.
const META_AI_BOT_JID = '867051314767696@bot'
const META_AI_BOT_NAME = 'Meta AI'
const FORWARD_ORIGIN_META_AI = 4

function montarMensagemRica (payload) {
  const submensagem = payload.richKind === 'code'
    ? { messageType: 5, codeMetadata: { codeLanguage: payload.language, codeBlocks: [{ codeContent: payload.text }] } }
    : { messageType: 2, messageText: payload.text }

  return {
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: 1,
          submessages: [submensagem],
          contextInfo: {
            isForwarded: true,
            forwardingScore: 1,
            forwardOrigin: FORWARD_ORIGIN_META_AI,
            forwardedAiBotMessageInfo: { botName: META_AI_BOT_NAME, botJid: META_AI_BOT_JID, creatorName: 'Meta' }
          }
        }
      }
    }
  }
}

async function executarMensagemRica (client, comando) {
  const payload = comando.payload
  try {
    await comTimeout(
      () => enviarERegistrar(client, payload.chatId, montarMensagemRica(payload)),
      TIMEOUT_ENVIO_MS,
      `timeout ao enviar a mensagem formatada do comando ${comando.id}`
    )
  } catch (erro) {
    if (erro?.code === 'LCN_TIMEOUT') throw erro
    // Esperado sempre que a Meta mudar algo. Cair para texto comum mantém a
    // automação útil em vez de simplesmente parar de responder.
    console.warn(`[engine] Mensagem formatada recusada, enviando como texto: ${mensagemDoErro(erro)}`)
    await comTimeout(
      () => enviarERegistrar(client, payload.chatId, { type: 'text', text: payload.fallbackText }),
      TIMEOUT_ENVIO_MS,
      `timeout ao enviar o texto de reserva do comando ${comando.id}`
    )
  }
}

// Envia um arquivo do acervo. É aqui, e só aqui, que um id vira bytes — o
// motor nunca carregou o conteúdo, do mesmo jeito que não carrega mídia de
// conversa. Arquivo que sumiu do acervo é erro conhecido, não resultado
// ambíguo: nada foi enviado, e a pessoa recebe o aviso se houver um.
async function executarEnvioDeArquivo (client, comando, deps) {
  const { acervo } = deps
  const payload = comando.payload

  // UMA PASTA INTEIRA, no formato escolhido.
  //
  // É o que faz o carrossel virar peça de comando em vez de consequência de um
  // download: a pasta do acervo é o conjunto, e a entrega é a mesma escada de
  // sempre (carrossel -> álbum -> uma a uma).
  if (payload.pasta) {
    const arquivos = acervo.listarDaPasta(payload.pasta)
    if (!arquivos.length) {
      if (payload.notFoundText) {
        await comTimeout(
          () => enviarERegistrar(client, payload.chatId, { type: 'text', text: payload.notFoundText }),
          TIMEOUT_ENVIO_MS,
          `timeout ao avisar da pasta vazia no comando ${comando.id}`
        )
      }
      throw new Error(`pasta vazia ou inexistente no acervo: ${payload.pasta}`)
    }
    // Texto guardado no acervo não é mídia e não entra num carrossel. Mandar
    // junto como documento seria entregar um .txt no meio das fotos.
    const midias = arquivos
      .filter((r) => r.kind !== 'text')
      .map((r) => ({
        buffer: acervo.lerConteudo(r.id),
        nome: r.name,
        mime: r.mimetype,
        tipo: r.kind === 'document' ? 'document' : r.kind
      }))
    if (!midias.length) throw new Error(`a pasta "${payload.pasta}" só tem texto, e texto não vai em carrossel`)

    await entregarMidias(client, payload.chatId, midias, {
      legenda: payload.caption || null,
      entrega: payload.entrega,
      opcoesCitacao: opcoesDeCitacao(payload.replyTo),
      comandoId: comando.id
    })
    return
  }

  // Por id OU por caminho. O id é estável e nunca muda; o caminho é o que uma
  // pessoa consegue escrever no WhatsApp ("produtos/fotos/capa.jpg"). Os dois
  // resolvem para o mesmo registro.
  const registro = payload.fileId
    ? acervo.obter(payload.fileId)
    : acervo.porCaminho(payload.caminho)

  if (!registro) {
    if (payload.notFoundText) {
      await comTimeout(
        () => enviarERegistrar(client, payload.chatId, { type: 'text', text: payload.notFoundText }),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar do arquivo ausente no comando ${comando.id}`
      )
    }
    throw new Error(`arquivo não encontrado no acervo: ${payload.fileId || payload.caminho}`)
  }

  const buffer = acervo.lerConteudo(registro.id)

  // 'text' no acervo é resposta pronta: vai como mensagem de texto, não como
  // documento anexado — que é o que a pessoa espera ao guardar um texto.
  const conteudo = registro.kind === 'text'
    ? { type: 'text', text: buffer.toString('utf8') }
    : { type: registro.kind === 'document' ? 'document' : registro.kind, media: buffer, mimetype: registro.mimetype }

  if (conteudo.type !== 'text' && payload.caption) conteudo.caption = payload.caption
  if (conteudo.type === 'document') conteudo.fileName = registro.name

  await comTimeout(
    () => enviarERegistrar(client, payload.chatId, conteudo),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar o arquivo do comando ${comando.id}`
  )
}

export async function executarComandos (client, comandos, clienteEngine, deps = {}) {
  for (const comando of Array.isArray(comandos) ? comandos : []) {
    let status

    const executor = {
      'whatsapp.reply': executarResposta,
      'whatsapp.recover': executarRecover,
      'whatsapp.menu': executarMenu,
      'whatsapp.delete': executarApagar,
      'group.remove': executarRemoverDoGrupo,
      'whatsapp.rich': executarMensagemRica,
      'whatsapp.sendFile': executarEnvioDeArquivo,
      'media.download': executarDownload,
      'connection.call': executarChamadaDeConexao,
      'acervo.save': executarGuardarNoAcervo
    }[comando?.commandType]

    let resultado = null
    if (!executor) {
      console.warn(`[engine] Tipo de comando desconhecido; execução recusada: ${comando?.commandType || '(ausente)'}`)
      status = 'outcome_unknown'
    } else {
      try {
        // `clienteEngine` entra nas dependências porque a chamada de conexão
        // precisa buscar a declaração no motor — é o único executor que
        // consulta o motor em vez de só agir sobre o WhatsApp.
        // O executor devolve resultado só quando o comando é ELO DE CADEIA:
        // aí ele não entrega nada, guarda o arquivo e passa a referência
        // adiante. Em tudo mais o retorno é indiferente.
        resultado = (await executor(client, comando, { ...(await resolverDependencias(deps)), clienteEngine })) || null
        status = 'sent'
      } catch (erro) {
        status = (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_RESULTADO_INCERTO')
          ? 'outcome_unknown'
          : 'failed'
        // O nome e a origem entram porque "The operation was aborted" sozinho
        // não diz de qual camada veio — e foi exatamente esse log cego que
        // custou uma investigação inteira para achar o envio do download.
        console.warn(`[engine] Falha ao executar o comando ${comando.id} (${comando.commandType}): ${erro?.name || 'Erro'}: ${mensagemDoErro(erro)}`)
        const origem = String(erro?.stack || '').split('\n')[1]
        if (origem) console.warn(`[engine]   origem:${origem.replace(/^\s*at\s*/, ' ')}`)
      }
    }

    await confirmarFailOpen(clienteEngine, comando, status, resultado)
  }
}

// Carregadas sob demanda para o teste poder injetar tudo sem tocar em disco
// nem em processo externo.
let padroesCarregados = null
async function resolverDependencias (deps) {
  if (deps.mediaRefCache) return deps
  if (!padroesCarregados) {
    const [cache, visu, acervo, downloader, conexao] = await Promise.all([
      import('./mediaRefCache.js'),
      import('../visu.js'),
      import('../mediaLibrary.js'),
      import('../downloader.js'),
      import('./conexaoExecutor.js')
    ])
    padroesCarregados = {
      mediaRefCache: cache,
      acervo,
      criarExecutorDeConexao: conexao.criarExecutorDeConexao,
      baixarBuffer: visu.baixarBuffer,
      // meJid vem com sufixo
      // de dispositivo (":12@") e o self-chat só aceita a forma sem ele.
      resolverJidProprio: (client) => {
        const meJid = client.getCredentials?.()?.meJid
        return meJid ? meJid.replace(/:\d+@/, '@') : null
      },
      criarBaixador: downloader.criarBaixador,
      limiteBytes: 64 * 1024 * 1024
    }
  }
  return { ...padroesCarregados, ...deps }
}
