import { AsyncLocalStorage } from 'async_hooks'
import * as enviadas from '../enviadas.js'
import { limitesDeMidia } from '../mediaLimits.js'
import { criarOrcamentoDeMidia } from '../mediaBudget.js'
import { criarFilasDeRecursos, comContextoDeComando, filasDoComando, prioridadeDoComando } from './filasDeRecursos.js'
import { sinalDoEvento, cancelarTrabalhoExterno } from './cancelamento.js'
import { registrarFonteDeRecursos } from '../state.js'
import { montarFilho, montarPai, podeVirarAlbum } from './album.js'
import {
  ESTILOS_DE_CARROSSEL, FORMAS_DE_ESCOLHA, montarBotoesDeEscolha, montarCard,
  montarCarrossel, montarMenuDeEscolha, opcoesDoCarrossel, podeVirarCarrossel, montarBotaoDePagina, VARIACOES_DE_PAGINA } from './carrossel.js'
import { montarWastickersZip } from './wastickers.js'

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

// O RELÓGIO DE QUEM ESPERA, e o lugar onde ele pode ser rearmado.
//
// `comTimeout` existe para dizer "esta mídia tem 15 s para sair". Com a fila
// do socket no meio, o tempo PARADO NA FILA entrava nessa conta — numa rajada,
// a mensagem era dada como perdida sem o socket ter sido nem tocado, e o
// comando terminava em "não sei se foi". Trocar lentidão por mensagem perdida
// é pior do que a lentidão.
//
// O contexto assíncrono carrega o rearme até lá dentro, e a fila o aciona no
// instante em que a vez chega. Sem isso, cada um dos 28 pontos de envio teria
// que repassar o rearme na mão.
const relogioDoEnvio = new AsyncLocalStorage()

export function comTimeout (operacao, timeoutMs, mensagem) {
  let timer
  let rejeitar = null
  const armar = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const erro = new Error(mensagem)
      erro.code = 'LCN_TIMEOUT'
      rejeitar?.(erro)
    }, timeoutMs)
  }
  // PAUSAR é limpar o relógio enquanto a tarefa espera vez na fila. Rearmar,
  // quando a vez chega, faz os 15 s valerem para o envio de verdade.
  //
  // Pausado para sempre seria espera infinita — e essa porta está fechada do
  // outro lado: a fila tem teto de espera própria e recusa o que passa dele.
  const pausar = () => clearTimeout(timer)
  const timeout = new Promise((resolve, reject) => {
    rejeitar = reject
    armar()
  })
  return Promise.race([
    relogioDoEnvio.run({ armar, pausar }, () => Promise.resolve().then(operacao)),
    timeout
  ]).finally(() => clearTimeout(timer))
}

// Roda a tarefa dando a ela um jeito de dizer "agora eu COMECEI de verdade" —
// e quem estiver cronometrando por fora rearma o relógio nesse instante.
export function semContarAEspera (tarefa) {
  const relogio = relogioDoEnvio.getStore()
  // O relógio para ANTES de entrar na fila e volta a contar quando a tarefa
  // diz que começou. Sem a pausa, ele dispararia no meio da espera — que é
  // exatamente o que fazia a música sumir numa rajada.
  relogio?.pausar?.()
  return tarefa(() => relogio?.armar?.())
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
      () => clienteEngine.execucoes.confirmar(comando.id, {
        status,
        // Resultado alimenta a continuação de uma cadeia; detail é persistido
        // no histórico mesmo quando a execução termina recusada.
        ...(resultado ? (['LCN_SEM_VAGA', 'LCN_CANCELADO', 'LCN_TIMEOUT_EXTERNO'].includes(resultado.code) ? { detail: resultado } : { resultado }) : {})
      }),
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
// TUDO QUE FALA COM O WHATSAPP PASSA POR AQUI, E A FILA É AQUI.
//
// A primeira versão da fila ficou em volta do COMANDO INTEIRO, e isso estava
// errado por um motivo que o dono sentiu na hora: um `/play` passa quase todo
// o tempo dele esperando a API de download — minutos, às vezes — e durante
// essa espera ele não usa a conexão para nada. Segurando a vaga, ele fazia um
// `/ping` esperar atrás de um download. O remédio ficou pior que a doença.
//
// O recurso disputado é o SOCKET: enviar e subir mídia. É só isso que a fila
// protege agora. Um comando longo ocupa a conexão só nos instantes em que
// realmente fala com ela, e solta entre um e outro.
const filasPorCliente = new WeakMap()
let configuracaoDasFilas = {}

// Mantido para quem configura antes do primeiro envio. Cada instância nasce
// com sua configuração; alterar uma fila viva perderia pendências admitidas.
export function configurarFilaDoSocket (cfg) {
  if (cfg) configuracaoDasFilas = cfg
}

export function obterFilasDoGateway (client, cfg = configuracaoDasFilas) {
  if (!filasPorCliente.has(client)) {
    const ultimoAviso = {}
    const filas = criarFilasDeRecursos(cfg, {
      aoMudar: ({ recurso, esperando, emCurso, limite }) => {
        if (!esperando) return
        const agora = Date.now()
        if (agora - (ultimoAviso[recurso] || 0) < 5000) return
        ultimoAviso[recurso] = agora
        console.log(`[engine] fila ${recurso}: ${emCurso} em curso, ${esperando} esperando (limite ${limite})`)
      }
    })
    filasPorCliente.set(client, filas)
  }
  return filasPorCliente.get(client)
}

function socket () {
  return filasDoComando().socket
}

// A ESPERA NA FILA NÃO CONTA PARA O RELÓGIO DO ENVIO.
//
// Quem chama envolve o envio num `comTimeout` — "15 s para mandar esta
// mídia". Com a fila no meio, o tempo parado na fila entrava nessa conta: numa
// rajada, a mensagem era dada como perdida por timeout sem o socket ter sido
// nem tocado, e o comando terminava em "não sei se foi". Era trocar lentidão
// por mensagem perdida, que é pior.
//
// Então o relógio de quem chamou é PAUSADO enquanto a tarefa espera vez: o
// `comTimeout` recebe uma função que só começa a contar quando a fila libera.
// Ver `pausarRelogioAte` logo abaixo.
async function enviarERegistrar (client, destino, conteudo, opcoes) {
  const resultado = await semContarAEspera((sinal) => socket().executar(() => {
    sinal()
    return client.message.send(destino, conteudo, opcoes)
  }, { prioridade: prioridadeDoComando() }))
  enviadas.registrar(resultado?.id)
  return resultado
}

// Subir mídia é a parte CARA: cada foto do carrossel é um upload, e cinco
// buscas ao mesmo tempo eram vinte e cinco subindo juntas pela mesma conexão.
async function subirMidia (client, buffer, opcoes) {
  return semContarAEspera((sinal) => socket().executar(() => {
    sinal()
    return client.message.upload(buffer, opcoes)
  }, { prioridade: prioridadeDoComando() }))
}

function opcoesDeCitacao (replyTo) {
  if (!replyTo?.id || !replyTo?.remoteJid) return undefined
  const quote = { id: replyTo.id, remoteJid: replyTo.remoteJid, fromMe: replyTo.fromMe === true }
  if (replyTo.participant) quote.participant = replyTo.participant
  return { quote }
}

// Os metadados que o comando declarou, somados à citação.
//
// Menção e selo de encaminhada viajam no CONTEXTO da mensagem, ao lado do
// texto — não dentro dele. Quem monta o contexto é o zapo-js, a partir destas
// chaves; aqui só se repassa o que o motor resolveu, já em forma de JID.
//
// Visualização única viaja nas opções de envio (options.viewOnce do zapo-js).
// Ela instrui o despachante a embrulhar a mensagem de mídia com viewOnce: true
// e a emitir o atributo <meta view_once="true"/> na stanza.
function opcoesDeEnvio (payload) {
  const opcoes = opcoesDeCitacao(payload?.replyTo) || {}
  if (Array.isArray(payload?.mentions) && payload.mentions.length) opcoes.mentions = payload.mentions
  if (payload?.forward === true) opcoes.forward = true
  if (payload?.viewOnce === true) opcoes.viewOnce = true
  return Object.keys(opcoes).length ? opcoes : undefined
}

// MANDAR UMA PÁGINA.
//
// É uma mensagem interativa com um botão `cta_url`, e cai para TEXTO quando o
// aplicativo de quem recebe não a desenha. A queda não é tratamento de erro, é
// parte do desenho: uma mensagem interativa que o servidor aceita e o
// aplicativo não desenha não deixa rastro nenhum — a conversa fica vazia e
// ninguém sabe por quê. Com a queda, o endereço SEMPRE chega, nem que seja
// como link escrito, que é clicável de qualquer jeito.
async function executarPagina (client, comando) {
  const p = comando.payload
  const comoTexto = [p.text, p.url, p.footer].filter(Boolean).join('\n')

  // DIAGNÓSTICO: manda TODAS as variações, numeradas, de uma vez.
  //
  // Quando o aplicativo não desenha, não há erro em lugar nenhum — o envio é
  // confirmado e a conversa fica vazia. Descobrir qual variação ele aceita uma
  // por vez custa uma ida e volta com a pessoa a cada tentativa. Assim, uma
  // resposta só ("vieram a 2 e a 5") resolve. É o mesmo recurso que o
  // carrossel já tem, pelo mesmo motivo.
  if (p.forma === 'diagnóstico') {
    let n = 0
    for (const variacao of VARIACOES_DE_PAGINA) {
      n++
      try {
        await comTimeout(
          () => enviarERegistrar(client, p.chatId, montarBotaoDePagina({
            texto: `[${n}] ${variacao.nome}`,
            rodape: p.footer,
            url: p.url,
            rotulo: p.buttonLabel,
            janela: p.inApp !== false,
            forma: variacao.forma,
            variacao
          })),
          TIMEOUT_ENVIO_MS,
          `timeout na variação ${variacao.nome} do comando ${comando.id}`
        )
        console.log(`[engine] página ${comando.id}: variação ${n} "${variacao.nome}" enviada`)
      } catch (erro) {
        if (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_SEM_VAGA') throw erro
        console.warn(`[engine] variação ${n} "${variacao.nome}" recusada: ${mensagemDoErro(erro)}`)
      }
    }
    // O fecho diz quantas foram, para a pessoa saber quantas PROCURAR — sem
    // isso ela não tem como distinguir "a 7 não apareceu" de "só vieram 6".
    await comTimeout(
      () => enviarERegistrar(client, p.chatId, {
        type: 'text',
        text: `Mandei ${n} variações numeradas acima. Diga quais apareceram — as que não aparecerem, o aplicativo recusou sem avisar.`
      }),
      TIMEOUT_ENVIO_MS,
      `timeout ao fechar o diagnóstico do comando ${comando.id}`
    )
    return
  }

  try {
    await comTimeout(
      () => enviarERegistrar(client, p.chatId, montarBotaoDePagina({
        texto: p.text,
        rodape: p.footer,
        url: p.url,
        rotulo: p.buttonLabel,
        janela: p.inApp !== false,
        forma: p.forma === 'janela' ? 'janela' : 'link'
      }), opcoesDeCitacao(p.replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao mandar a página do comando ${comando.id}`
    )
  } catch (erro) {
    if (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_SEM_VAGA') throw erro
    console.warn(`[engine] Botão de página recusado (${mensagemDoErro(erro)}) — mandando o endereço como texto.`)
    await comTimeout(
      () => enviarERegistrar(client, p.chatId, { type: 'text', text: comoTexto }, opcoesDeCitacao(p.replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao mandar o endereço do comando ${comando.id}`
    )
  }
}

async function executarResposta (client, comando) {
  const texto = resolverTextoComLatencia(comando.payload.text, comando.payload.receivedAtMs)
  await comTimeout(
    () => enviarERegistrar(client, comando.payload.chatId, { type: 'text', text: texto }, opcoesDeEnvio(comando.payload)),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar o comando ${comando.id}`
  )
}

// MANDAR BOTÕES DE ESCOLHA declarados no próprio comando.
//
// Três botões de resposta rápida (quick_reply). Ao serem tocados, o WhatsApp
// envia o `id` (ou comando configurado) de volta como mensagem de texto comum,
// que aciona outra automação que case com aquele gatilho.
//
// Honestidade sobre o que não desenha: mensagem com botões interativos depende
// do suporte do aplicativo de quem recebe. Se o envio interativo falhar, cai
// para texto. Porém, se o aplicativo aceitar mas descartar calado sem renderizar,
// não há erro reportado — a conversa simplesmente não mostra os botões.
async function executarBotoes (client, comando) {
  const p = comando.payload
  const botoes = (p.buttons || []).map((b) => ({ text: b.text, id: b.id || b.command || b.text }))
  const comoTexto = p.fallbackText || [
    p.text,
    p.footer ? `_${p.footer}_` : null,
    ...(p.buttons || []).map((b, i) => `${i + 1}. ${b.text}`)
  ].filter(Boolean).join('\n')

  try {
    await comTimeout(
      () => enviarERegistrar(client, p.chatId, montarBotoesDeEscolha(botoes, { texto: p.text, rodape: p.footer }), opcoesDeCitacao(p.replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao mandar os botões do comando ${comando.id}`
    )
    console.log(`[engine] botões ${comando.id}: ${botoes.length} botão(ões) enviados`)
  } catch (erro) {
    if (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_SEM_VAGA') throw erro
    console.warn(`[engine] Botões de resposta recusados (${mensagemDoErro(erro)}) — mandando como texto.`)
    await comTimeout(
      () => enviarERegistrar(client, p.chatId, { type: 'text', text: comoTexto }, opcoesDeCitacao(p.replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao mandar o texto de reserva dos botões do comando ${comando.id}`
    )
  }
}

// CARROSSEL DE VALORES PRÓPRIOS ou de pasta do acervo.
//
// Cards com imagem/vídeo, título, texto e botão, vindos de valores declarados
// ou de uma pasta do acervo (sem depender de conexão externa).
//
// CONTRATO DE CARREGADOR TARDIO E ORÇAMENTO:
// Cada foto ou vídeo de card passa por `referenciaDoAcervo` e `usarMidia`,
// alocando reserva no orçamento de bytes antes de carregar o buffer e
// liberando a memória imediatamente após o upload para o servidor do WhatsApp.
// Nunca se carregam os buffers de todos os cards juntos na memória.
async function executarCarrossel (client, comando, deps) {
  const { acervo } = deps
  const p = comando.payload
  const chatId = p.chatId
  const replyTo = p.replyTo

  const avisarFalta = async (msg) => {
    if (p.notFoundText) {
      await comTimeout(
        () => enviarERegistrar(client, chatId, { type: 'text', text: p.notFoundText }, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar falta de mídia do carrossel do comando ${comando.id}`
      )
    }
    throw new Error(msg)
  }

  const cardsParaMontar = []

  if (p.folder) {
    const arquivos = acervo.listarDaPasta(p.folder)
    if (!arquivos.length) {
      return avisarFalta(`pasta vazia ou inexistente no acervo: ${p.folder}`)
    }
    const validos = arquivos.filter((r) => r.kind === 'image' || r.kind === 'video')
    if (!validos.length) {
      return avisarFalta(`a pasta "${p.folder}" não contém imagens ou vídeos para o carrossel`)
    }
    for (const r of validos) {
      const midia = referenciaDoAcervo(r, deps)
      let botao = null
      if (p.buttonText) {
        const cmd = (p.buttonCommand || p.buttonText)
          .replaceAll('{{nome}}', r.name)
          .replaceAll('{{id}}', r.id)
          .replaceAll('{{caminho}}', r.path || '')
        botao = { texto: p.buttonText, comando: cmd }
      }
      cardsParaMontar.push({
        midia,
        titulo: r.name,
        corpo: r.description || '',
        rodape: '',
        botao
      })
    }
  } else if (Array.isArray(p.cards) && p.cards.length) {
    for (const c of p.cards) {
      const registro = c.fileId ? acervo.obter(c.fileId) : acervo.porCaminho(c.path)
      if (!registro) {
        return avisarFalta(`arquivo não encontrado no acervo para o card: ${c.fileId || c.path}`)
      }
      if (registro.kind !== 'image' && registro.kind !== 'video') {
        return avisarFalta(`o arquivo "${registro.name}" não é imagem nem vídeo e não pode entrar em carrossel`)
      }
      const midia = referenciaDoAcervo(registro, deps)
      let botao = null
      if (c.buttonText) {
        const url = c.buttonUrl
        const cmd = c.buttonCommand || c.buttonText
        botao = url ? { texto: c.buttonText, url } : { texto: c.buttonText, comando: cmd }
      }
      cardsParaMontar.push({
        midia,
        titulo: c.title || '',
        corpo: c.body || '',
        rodape: c.footer || '',
        botao
      })
    }
  } else {
    return avisarFalta('carrossel precisa de uma pasta do acervo ou de uma lista de cards')
  }

  if (!cardsParaMontar.length) {
    return avisarFalta('nenhum card válido encontrado para montar o carrossel')
  }

  const cards = []
  const itensDeEscolha = []
  for (const item of cardsParaMontar) {
    const upload = await usarMidia(item.midia, (buffer) => subirMidia(client, buffer, {
      type: item.midia.tipo === 'video' ? 'video' : 'image',
      mimetype: item.midia.mime
    }))
    cards.push(montarCard(item.midia, upload, {
      titulo: item.titulo,
      legenda: item.corpo,
      rodape: item.rodape,
      botao: item.botao
    }))
    itensDeEscolha.push({
      titulo: item.titulo,
      corpo: item.corpo,
      rodape: item.rodape,
      botao: item.botao
    })
  }

  const abertura = p.text || null
  const estilos = p.estilo === 'diagnóstico'
    ? [...ESTILOS_DE_CARROSSEL, ...FORMAS_DE_ESCOLHA]
    : [p.estilo || 'completo']

  try {
    for (const estilo of estilos) {
      const texto = estilos.length > 1 ? `[${estilo}] ${abertura || ''}`.trim() : abertura
      if (FORMAS_DE_ESCOLHA.includes(estilo)) {
        await comTimeout(
          () => enviarERegistrar(client, chatId, montarCarrossel(cards.map((c) => ({ ...c, nativeFlowMessage: { buttons: [] } })), { estilo: 'simples' })),
          TIMEOUT_ENVIO_MS * 4,
          `timeout ao enviar os cards do carrossel do comando ${comando.id}`
        )
        const escolha = estilo === 'botoes'
          ? montarBotoesDeEscolha(itensDeEscolha, { texto, rodape: p.footer })
          : montarMenuDeEscolha(itensDeEscolha, { texto, rodape: p.footer })
        await comTimeout(
          () => enviarERegistrar(client, chatId, escolha),
          TIMEOUT_ENVIO_MS,
          `timeout ao enviar a escolha do carrossel do comando ${comando.id}`
        )
        console.log(`[engine] escolha do carrossel ${comando.id}: forma "${estilo}", ${itensDeEscolha.length} opções`)
        continue
      }

      if (estilo === 'simples' && texto) {
        await comTimeout(
          () => enviarERegistrar(client, chatId, { type: 'text', text: texto }),
          TIMEOUT_ENVIO_MS,
          `timeout ao abrir o carrossel do comando ${comando.id}`
        )
      }

      await comTimeout(
        () => enviarERegistrar(client, chatId, montarCarrossel(cards, { texto, rodape: p.footer, estilo }), opcoesDoCarrossel(estilo)),
        TIMEOUT_ENVIO_MS * 4,
        `timeout ao enviar o carrossel do comando ${comando.id}`
      )
      console.log(`[engine] carrossel ${comando.id}: forma "${estilo}", ${cards.length} card(s)`)
    }
  } catch (erro) {
    if (erro?.code === 'LCN_SEM_VAGA' || erro?.code === 'LCN_TIMEOUT') throw erro
    console.warn(`[engine] Carrossel próprio recusado (${mensagemDoErro(erro)}) — mandando como texto.`)
    const linhas = itensDeEscolha.map((c, i) => `*${i + 1}.* ${c.titulo || ''}\n${c.corpo}${c.rodape ? `\n_${c.rodape}_` : ''}`)
    const textoFinal = p.fallbackText || [abertura, ...linhas, p.footer ? `_${p.footer}_` : null].filter(Boolean).join('\n\n')
    await comTimeout(
      () => enviarERegistrar(client, chatId, { type: 'text', text: textoFinal }, opcoesDeCitacao(replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao mandar a lista alternativa do carrossel do comando ${comando.id}`
    )
  }
}

// PACOTE DE FIGURINHAS (.wastickers ou nativo).
//
// O protocolo WhatsApp Web implementado pelo zapo-js expõe `type: 'sticker-pack'`,
// com upload de zip em `/mms/sticker-pack`, thumbnail em `/mms/thumbnail-sticker-pack`
// e o proto `stickerPackMessage` com `stickerPackOrigin: USER_CREATED`.
//
// HONESTIDADE SOBRE O QUE NÃO FOI MEDIDO:
// O caminho de envio existe na biblioteca. O que NÃO foi medido num aparelho
// real é se o aplicativo oficial de quem recebe desenha o pacote e permite
// a instalação em conversas normais (1:1 e grupo) — como aconteceu com o botão
// de página, mensagem interativa que o servidor aceita e o aplicativo não
// desenha não deixa rastro de erro: o envio é confirmado e a conversa fica vazia.
//
// DUAS FORMAS DE ENVIO:
//   - pacote: tenta o envio nativo pelo protocolo (stickerPackMessage). Se o
//             servidor recusar o envio, cai para o documento .wastickers.
//   - arquivo: monta um arquivo .wastickers (ZIP contendo title.txt, author.txt
//              e as figurinhas WebP) e entrega como documento. A pessoa abre
//              no celular em apps como o Sticker Maker para importar no WhatsApp.
//   - diagnóstico: manda as duas formas numeradas de uma vez, para medir qual
//                  aparece naquele aparelho sem precisar de tentativas isoladas.
//
// CONTRATO DE CARREGADOR TARDIO E ORÇAMENTO:
// As figurinhas da pasta têm o tamanho verificado contra o limite geral e
// o orçamento é reservado ANTES de alocar memória do disco. Os buffers são
// carregados sob demanda e liberados no finally, zerando o saldo.
async function executarPacoteDeFigurinhas (client, comando, deps) {
  const p = comando.payload
  const { acervo, limiteBytes, orcamento } = deps
  const chatId = p.chatId
  const replyTo = p.replyTo

  const avisarFalta = async (msg) => {
    if (p.notFoundText) {
      await comTimeout(
        () => enviarERegistrar(client, chatId, { type: 'text', text: p.notFoundText }, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar falta de figurinhas do pacote ${comando.id}`
      )
    }
    throw new Error(msg)
  }

  const arquivos = acervo.listarDaPasta(p.folder)
  if (!arquivos || !arquivos.length) {
    return avisarFalta(`pasta vazia ou inexistente no acervo: ${p.folder}`)
  }

  // Figurinhas ou imagens estáticas/animadas (máximo de 30 por pacote no WhatsApp)
  const MAX_FIGURINHAS = 30
  const validos = arquivos.filter((r) => r.kind === 'sticker' || r.kind === 'image').slice(0, MAX_FIGURINHAS)
  if (!validos.length) {
    return avisarFalta(`a pasta "${p.folder}" não contém figurinhas ou imagens válidas para o pacote`)
  }

  const bytesTotais = validos.reduce((acc, r) => acc + (r.sizeBytes || 0), 0)
  if (bytesTotais > limiteBytes) {
    throw new Error('O conjunto de figurinhas do pacote excede o limite geral de mídia configurado.')
  }

  orcamento.adquirir(bytesTotais)
  let figurinhasCarregadas = []

  try {
    for (const r of validos) {
      const buffer = r.carregar ? await r.carregar() : await acervo.lerConteudoAsync(r.id, limiteBytes)
      figurinhasCarregadas.push({
        id: r.id,
        nome: r.name,
        buffer,
        mimetype: r.mimetype || 'image/webp'
      })
    }

    const nomePacote = p.name || 'Pacote de Figurinhas'
    const autorPacote = p.author || 'LCN'

    const enviarPacoteNativo = async (prefixoLegenda = '') => {
      const stickers = figurinhasCarregadas.map((f, i) => ({
        media: f.buffer,
        fileName: f.nome.endsWith('.webp') ? f.nome : `sticker_${i + 1}.webp`,
        emojis: ['✨'],
        mimetype: f.mimetype
      }))
      const capa = figurinhasCarregadas[0].buffer
      const legendaFinal = [prefixoLegenda, p.caption].filter(Boolean).join(' ') || undefined

      const conteudo = {
        type: 'sticker-pack',
        stickerPackId: `pack-${comando.id}-${Date.now()}`,
        name: nomePacote,
        publisher: autorPacote,
        stickers,
        trayIcon: {
          media: capa,
          fileName: 'tray_icon.png'
        },
        coverThumbnail: capa,
        ...(legendaFinal ? { caption: legendaFinal } : {})
      }

      await comTimeout(
        () => enviarERegistrar(client, chatId, conteudo, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS * 4,
        `timeout ao enviar pacote nativo do comando ${comando.id}`
      )
      console.log(`[engine] pacote nativo ${comando.id}: "${nomePacote}" com ${stickers.length} figurinha(s)`)
    }

    const enviarArquivoWastickers = async (prefixoLegenda = '') => {
      const zipBuffer = montarWastickersZip({
        titulo: nomePacote,
        autor: autorPacote,
        figurinhas: figurinhasCarregadas,
        cover: figurinhasCarregadas[0]?.buffer
      })
      const nomeArquivo = `${nomePacote.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'pacote'}.wastickers`
      const legendaFinal = [prefixoLegenda, p.caption].filter(Boolean).join(' ') || undefined

      const conteudo = {
        type: 'document',
        media: zipBuffer,
        fileName: nomeArquivo,
        mimetype: 'application/octet-stream',
        ...(legendaFinal ? { caption: legendaFinal } : {})
      }

      await comTimeout(
        () => enviarERegistrar(client, chatId, conteudo, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS * 4,
        `timeout ao enviar documento .wastickers do comando ${comando.id}`
      )
      console.log(`[engine] documento .wastickers ${comando.id}: "${nomeArquivo}" com ${figurinhasCarregadas.length} figurinha(s)`)
    }

    if (p.forma === 'diagnóstico') {
      // Diagnóstico: envia as duas variações numeradas de uma vez para medição real
      await enviarPacoteNativo('[1/2] Pacote nativo (stickerPackMessage):')
      await enviarArquivoWastickers('[2/2] Documento (.wastickers):')
      await comTimeout(
        () => enviarERegistrar(client, chatId, {
          type: 'text',
          text: 'Foram enviadas as 2 variações do pacote de figurinhas (1: pacote nativo pelo protocolo; 2: documento .wastickers para app terceiro). Verifique qual o seu aparelho recebeu e desenhou.'
        }, opcoesDeCitacao(replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao enviar fechamento de diagnóstico do comando ${comando.id}`
      )
      return
    }

    if (p.forma === 'arquivo') {
      await enviarArquivoWastickers()
      return
    }

    // Padrão: forma "pacote" (envio nativo pelo protocolo)
    try {
      await enviarPacoteNativo()
    } catch (erro) {
      if (erro?.code === 'LCN_SEM_VAGA' || erro?.code === 'LCN_TIMEOUT') throw erro
      console.warn(`[engine] Envio de pacote nativo recusado (${mensagemDoErro(erro)}) — caindo para documento .wastickers.`)
      try {
        await enviarArquivoWastickers('📦 [Pacote alternativo em .wastickers]')
      } catch (erroArquivo) {
        if (erroArquivo?.code === 'LCN_SEM_VAGA' || erroArquivo?.code === 'LCN_TIMEOUT') throw erroArquivo
        if (p.fallbackText) {
          await comTimeout(
            () => enviarERegistrar(client, chatId, { type: 'text', text: p.fallbackText }, opcoesDeCitacao(replyTo)),
            TIMEOUT_ENVIO_MS,
            `timeout ao enviar texto de reserva do pacote ${comando.id}`
          )
          return
        }
        throw erroArquivo
      }
    }
  } finally {
    orcamento.liberar(bytesTotais)
    figurinhasCarregadas = null
  }
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
    // Desligamento e recusa já têm destino no histórico; iniciar um aviso
    // depois de abandonar o trabalho só acrescentaria envio à drenagem.
    if (sinalDoEvento()?.aborted) return
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
      if (erro?.code === 'LCN_SEM_VAGA') throw erro
      console.warn(`[engine] Não consegui avisar o início do download: ${mensagemDoErro(erro)}`)
    }
  }

  let midia
  try {
    midia = await criarBaixador({ cfg, orcamento: deps.orcamento }).baixar(url, modo)
  } catch (erro) {
    if (erro?.code === 'LCN_SEM_VAGA') throw erro
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
    if (erro?.code === 'LCN_SEM_VAGA') throw erro
    // ESTE é o caso que deixou o dono olhando "⏳ Baixando…" para sempre: o
    // arquivo veio inteiro e o envio ao WhatsApp é que falhou. O tamanho entra
    // na mensagem porque é a causa mais provável — o serviço aceita arquivo
    // muito maior do que o WhatsApp entrega.
    await avisar(`baixei ${formatarMB(bytesTotais)} mas não consegui enviar aqui (${mensagemParaPessoa(erro)})`)
    throw erro
  } finally {
    midia.liberar?.()
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

async function usarMidia (midia, operacao) {
  if (midia.usar) return midia.usar(operacao)
  return operacao(midia.carregar ? await midia.carregar() : midia.buffer)
}

function referenciaDoAcervo (registro, { acervo, limiteBytes, orcamento }) {
  const midia = {
    id: registro.id,
    nome: registro.name,
    mime: registro.mimetype,
    tipo: registro.kind,
    bytes: registro.sizeBytes,
    carregar: () => acervo.lerConteudoAsync(registro.id, Math.min(registro.sizeBytes, limiteBytes))
  }
  midia.usar = async (operacao) => {
    if (midia.bytes > limiteBytes) throw new Error('O arquivo do acervo excede o limite geral de mídia configurado.')
    orcamento.adquirir(midia.bytes)
    try {
      // Nenhum buffer fica na lista. A queda de carrossel para álbum chama
      // carregar de novo pelo id, sem guardar a pasta inteira como reserva.
      let buffer = await midia.carregar()
      try { return await operacao(buffer) } finally { buffer = null }
    } finally {
      orcamento.liberar(midia.bytes)
    }
  }
  return midia
}

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
    await comTimeout(
      () => usarMidia(m, async (buffer) => {
        const conteudo = { type: m.tipo, media: buffer, mimetype: m.mime }
        if (m.tipo === 'document') conteudo.fileName = m.nome
        // A legenda só acompanha a primeira mídia compatível; áudio e
        // figurinha não aceitam esse campo e fariam o envio ser recusado.
        if (i === comLegenda) conteudo.caption = legenda
        return enviarERegistrar(client, chatId, conteudo, i === 0 ? opcoesCitacao : undefined)
      }),
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
      const upload = await usarMidia(m, (buffer) => subirMidia(client, buffer, {
        type: m.tipo === 'video' ? 'video' : 'image',
        mimetype: m.mime
      }))
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
    // Trocar o formato não cria memória: uma recusa de reserva não deve
    // começar outra tentativa nem ser confundida com falha do álbum.
    if (erro?.code === 'LCN_SEM_VAGA') throw erro
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
  const { clienteEngine, criarExecutorDeConexao, mediaRefCache, baixarBuffer, limiteBytes, orcamento, cfg } = deps
  const usosDasEntradas = []
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
      if (erro?.code === 'LCN_SEM_VAGA') throw erro
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
    if (entrada.node?.lcnMidia) usosDasEntradas.push(entrada.node.lcnMidia.reter())
    const buffer = entrada.node?.lcnBuffer
      ? entrada.node.lcnBuffer
      : await baixarBuffer(client, entrada.node, entrada.tipo, limiteBytes)
    if (buffer.length > limiteBytes) throw new Error('A mídia da conexão excede o limite geral configurado.')
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
  let resultado
  try {
    const arquivo = await resolverArquivo(mediaRef, mediaInput)
    const arquivo2 = await resolverArquivo(mediaRef2, mediaInput2)

    try {
      const declaracao = await clienteEngine.conexoes.resolvida(conexao, { signal: sinalDoEvento() })
      resultado = await criarExecutorDeConexao({ limiteBytes, orcamento, cfg }).executar(declaracao, funcao, entradas || {}, arquivo, arquivo2)
    } catch (erro) {
      if (erro?.code === 'LCN_SEM_VAGA') throw erro
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
      const node = { lcnBuffer: primeira.buffer, lcnMidia: primeira.reter ? primeira : null, mimetype: primeira.mime }
      const token = mediaRefCache.criar({ node, tipo: primeira.tipo, interno: {} }, undefined, () => {
        node.lcnBuffer = null
        node.lcnMidia = null
        primeira.liberar?.()
      })
      resultado.transferir?.(primeira)
      return { token, tipo: primeira.tipo, mime: primeira.mime }
    }

    // CARDS COM BOTÃO: uma mensagem só, com a capa, o texto e o botão de cada
    // resultado. Cada imagem é enviada ao servidor do WhatsApp antes, como no
    // carrossel de mídia — a diferença é que aqui o card leva botão.
    if (resultado.forma === 'carrossel') {
      const cards = []
      for (const card of resultado.cards || []) {
        const upload = await usarMidia(card.midia, (buffer) => subirMidia(client, buffer, { type: 'image', mimetype: card.midia.mime }))
        cards.push(montarCard(card.midia, upload, { titulo: card.titulo, legenda: card.corpo, rodape: card.rodape, botao: card.botao }))
      }
      const abertura = caption || resultado.cabecalho
      // A FORMA vem da declaração. "diagnóstico" manda as três, numeradas: uma
      // tentativa só responde qual delas o aplicativo de quem recebe desenha —
      // porque quando ele não desenha, não há erro em lugar nenhum para ler.
      // No diagnóstico entram as formas de carrossel E as de escolha: o teste do
      // dono mostrou que carrossel com botão não é desenhado em forma nenhuma,
      // então a pergunta passou a ser "e o botão FORA do card, aparece?".
      const estilos = resultado.estilo === 'diagnóstico'
        ? [...ESTILOS_DE_CARROSSEL, ...FORMAS_DE_ESCOLHA]
        : [resultado.estilo || 'completo']
      try {
        for (const estilo of estilos) {
          const texto = estilos.length > 1 ? `[${estilo}] ${abertura || ''}`.trim() : abertura
          // BOTÃO FORA DO CARD. O carrossel vai sem botão — que é a forma
          // desenhada aqui há semanas — e a escolha vem na mensagem seguinte.
          if (FORMAS_DE_ESCOLHA.includes(estilo)) {
            await comTimeout(
              () => enviarERegistrar(client, chatId, montarCarrossel(cards.map((c) => ({ ...c, nativeFlowMessage: { buttons: [] } })), { estilo: 'simples' })),
              TIMEOUT_ENVIO_MS * 4,
              `timeout ao enviar os cards do comando ${comando.id}`
            )
            const escolha = estilo === 'botoes'
              ? montarBotoesDeEscolha(resultado.cards, { texto })
              : montarMenuDeEscolha(resultado.cards, { texto })
            await comTimeout(
              () => enviarERegistrar(client, chatId, escolha),
              TIMEOUT_ENVIO_MS,
              `timeout ao enviar a escolha do comando ${comando.id}`
            )
            console.log(`[engine] escolha ${comando.id}: forma "${estilo}", ${resultado.cards.length} opção(ões)`)
            continue
          }
          // Na forma "simples" o texto não cabe dentro da mensagem: vai antes.
          if (estilo === 'simples' && texto) {
            await comTimeout(
              () => enviarERegistrar(client, chatId, { type: 'text', text: texto }),
              TIMEOUT_ENVIO_MS,
              `timeout ao abrir o carrossel do comando ${comando.id}`
            )
          }
          await comTimeout(
            // Sem citar a mensagem que acionou: é como o `sendCarousel` do
            // takeshi-bot manda, e citação em mensagem interativa é mais uma
            // chance de o aplicativo descartar tudo calado.
            //
            // As opções levam o nó <biz> quando a forma pede — ver carrossel.js.
            () => enviarERegistrar(client, chatId, montarCarrossel(cards, { texto, estilo }), opcoesDoCarrossel(estilo)),
            TIMEOUT_ENVIO_MS * 4,
            `timeout ao enviar o carrossel do comando ${comando.id}`
          )
          console.log(`[engine] carrossel ${comando.id}: forma "${estilo}", ${cards.length} card(s) e botão`)
        }
      } catch (erro) {
        if (erro?.code === 'LCN_SEM_VAGA') throw erro
        // Mensagem interativa depende do aplicativo de quem recebe. Cair para
        // texto não é tratamento de erro, é parte do desenho: o conteúdo sempre
        // chega de algum jeito, e aqui ele chega como a lista escrita.
        console.warn(`[engine] Carrossel com botão recusado (${mensagemDoErro(erro)}) — mandando como texto.`)
        const linhas = (resultado.cards || []).map((c, i) => `*${i + 1}.* ${c.titulo || ''}\n${c.corpo}${c.rodape ? `\n_${c.rodape}_` : ''}`)
        await comTimeout(
          () => enviarERegistrar(client, chatId, {
            type: 'text',
            text: [abertura, ...linhas].filter(Boolean).join('\n')
          }, opcoesDeCitacao(replyTo)),
          TIMEOUT_ENVIO_MS,
          `timeout ao mandar a lista do comando ${comando.id}`
        )
      }
      return
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
      if (erro?.code === 'LCN_SEM_VAGA') throw erro
      await avisar(`recebi ${formatarMB(bytesTotais)} mas não consegui enviar aqui (${mensagemParaPessoa(erro)})`)
      throw erro
    }
    if (resultado.foraPorTamanho > 0) {
      const n = resultado.foraPorTamanho
      await nota(n === 1
        ? '⚠️ Um dos arquivos era grande demais para o WhatsApp e ficou de fora.'
        : `⚠️ ${n} arquivos eram grandes demais para o WhatsApp e ficaram de fora.`)
    }
  } finally {
    resultado?.liberar?.()
    for (const soltar of usosDasEntradas) soltar()
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
    if (erro?.code === 'LCN_SEM_VAGA') throw erro
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

// Apagar um arquivo do acervo pelo id ou pelo caminho.
//
// O projeto prefere erro claro a falha calada: se o arquivo não existir, o
// comando avisa via `notFoundText` (se configurado) e lança erro, para que a
// execução registre falha e não finja que apagou o que não existia.
async function executarApagarDoAcervo (client, comando, deps) {
  const { acervo } = deps
  const payload = comando.payload
  const avisar = criarAvisador(client, comando, { chatId: payload.chatId, replyTo: payload.replyTo, errorText: payload.errorText })

  const registro = (payload.fileId ? acervo.obter(payload.fileId) : null) ||
                   (payload.caminho ? (acervo.porCaminho(payload.caminho) || (/^[0-9a-f]{24}$/i.test(payload.caminho) ? acervo.obter(payload.caminho) : null)) : null)

  if (!registro) {
    if (payload.notFoundText) {
      try {
        await comTimeout(
          () => enviarERegistrar(client, payload.chatId, { type: 'text', text: payload.notFoundText }, opcoesDeCitacao(payload.replyTo)),
          TIMEOUT_ENVIO_MS,
          `timeout ao avisar do arquivo ausente no comando ${comando.id}`
        )
      } catch (erroAviso) {
        if (erroAviso?.code === 'LCN_SEM_VAGA') throw erroAviso
        console.warn(`[engine] Não consegui avisar arquivo ausente no comando ${comando.id}: ${mensagemDoErro(erroAviso)}`)
      }
    }
    throw new Error(`arquivo não encontrado no acervo: ${payload.fileId || payload.caminho}`)
  }

  try {
    const removido = acervo.remover(registro.id)
    if (!removido) throw new Error(`não foi possível remover o arquivo: ${registro.id}`)
  } catch (erro) {
    await avisar(erro?.message || 'não consegui apagar o arquivo')
    throw erro
  }

  if (payload.okText) {
    const confirmacao = payload.okText
      .replaceAll('{{caminho}}', registro.path)
      .replaceAll('{{id}}', registro.id)
      .replaceAll('{{nome}}', registro.name)
    await comTimeout(
      () => enviarERegistrar(client, payload.chatId, { type: 'text', text: confirmacao }, opcoesDeCitacao(payload.replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao confirmar a remoção do comando ${comando.id}`
    )
  }
}

// Criar um arquivo de texto no acervo a partir de variáveis ou valores conhecidos.
//
// O acervo trata `kind: 'text'` de forma especial: o texto guardado é enviado
// como mensagem de texto comum, e não como documento anexado.
//
// Passa obrigatoriamente pela reserva de orçamento de bytes e confere a cota do
// acervo e o teto por arquivo antes de gravar no disco.
async function executarCriarTextoNoAcervo (client, comando, deps) {
  const { acervo, limiteBytes, orcamento } = deps
  const payload = comando.payload
  const avisar = criarAvisador(client, comando, { chatId: payload.chatId, replyTo: payload.replyTo, errorText: payload.errorText })

  const texto = typeof payload.text === 'string' ? payload.text : ''
  const tamanho = Buffer.byteLength(texto, 'utf8')
  if (!tamanho) {
    await avisar('conteúdo de texto vazio para criar no acervo')
    throw new Error('conteúdo de texto vazio para criar no acervo')
  }
  if (tamanho > limiteBytes) {
    await avisar(`o texto excede o limite geral de mídia configurado (${formatarMB(tamanho)})`)
    throw new Error('o texto excede o limite geral de mídia configurado')
  }

  orcamento?.adquirir?.(tamanho)
  let guardado
  try {
    const buffer = Buffer.from(texto, 'utf8')
    let pasta = payload.pasta || null
    let nome = payload.nome || null
    if (payload.caminho && !nome) {
      const partes = payload.caminho.split('/')
      nome = partes.pop()
      if (partes.length && !pasta) pasta = partes.join('/')
    }
    if (nome && !nome.includes('.')) nome = `${nome}.txt`

    guardado = acervo.guardar(buffer, {
      mimetype: 'text/plain',
      name: nome || 'texto.txt',
      description: payload.descricao || null,
      folder: pasta || null
    })
  } catch (erro) {
    if (erro?.code === 'LCN_SEM_VAGA') throw erro
    await avisar(erro?.message || 'não consegui criar o arquivo de texto')
    throw erro
  } finally {
    orcamento?.liberar?.(tamanho)
  }

  if (payload.okText) {
    const confirmacao = payload.okText
      .replaceAll('{{caminho}}', guardado.path)
      .replaceAll('{{id}}', guardado.id)
      .replaceAll('{{nome}}', guardado.name)
    await comTimeout(
      () => enviarERegistrar(client, payload.chatId, { type: 'text', text: confirmacao }, opcoesDeCitacao(payload.replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao confirmar o arquivo criado do comando ${comando.id}`
    )
  }
  return guardado
}

// Sobrescrever o conteúdo de um arquivo mantendo o seu id estável.
//
// O id é o identificador por onde outros comandos referenciam o arquivo:
// substituí-lo quebraria automações existentes em silêncio. A reescrita
// atualiza os bytes no disco e atualiza a data de modificação sem gerar id novo.
//
// Aceita tanto texto direto quanto mídia que acabou de chegar pelo WhatsApp.
async function executarSobrescreverNoAcervo (client, comando, deps) {
  const { acervo, limiteBytes, orcamento, mediaRefCache, baixarBuffer } = deps
  const payload = comando.payload
  const avisar = criarAvisador(client, comando, { chatId: payload.chatId, replyTo: payload.replyTo, errorText: payload.errorText })

  const registro = (payload.fileId ? acervo.obter(payload.fileId) : null) ||
                   (payload.caminho ? (acervo.porCaminho(payload.caminho) || (/^[0-9a-f]{24}$/i.test(payload.caminho) ? acervo.obter(payload.caminho) : null)) : null)

  if (!registro) {
    if (payload.notFoundText) {
      try {
        await comTimeout(
          () => enviarERegistrar(client, payload.chatId, { type: 'text', text: payload.notFoundText }, opcoesDeCitacao(payload.replyTo)),
          TIMEOUT_ENVIO_MS,
          `timeout ao avisar do arquivo ausente no comando ${comando.id}`
        )
      } catch (erroAviso) {
        if (erroAviso?.code === 'LCN_SEM_VAGA') throw erroAviso
        console.warn(`[engine] Não consegui avisar arquivo ausente no comando ${comando.id}: ${mensagemDoErro(erroAviso)}`)
      }
    }
    throw new Error(`arquivo não encontrado no acervo: ${payload.fileId || payload.caminho}`)
  }

  let buffer
  let tamanho
  if (typeof payload.text === 'string') {
    tamanho = Buffer.byteLength(payload.text, 'utf8')
    if (!tamanho) {
      await avisar('conteúdo de texto vazio para sobrescrever no acervo')
      throw new Error('conteúdo de texto vazio para sobrescrever no acervo')
    }
    if (tamanho > limiteBytes) throw new Error('O conteúdo excede o limite geral de mídia configurado.')
    orcamento?.adquirir?.(tamanho)
    buffer = Buffer.from(payload.text, 'utf8')
  } else if (payload.mediaRef) {
    const entrada = mediaRefCache?.resolver(payload.mediaRef)
    if (!entrada) {
      await avisar('a mídia expirou antes do comando voltar do motor')
      throw new Error('a mídia deste arquivo expirou antes do comando voltar do motor')
    }
    buffer = await baixarBuffer(client, entrada.node, entrada.tipo, limiteBytes)
    tamanho = buffer.length
    if (tamanho > limiteBytes) throw new Error('A mídia excede o limite geral configurado.')
    orcamento?.adquirir?.(tamanho)
  } else {
    if (payload.notFoundText) {
      await comTimeout(
        () => enviarERegistrar(client, payload.chatId, { type: 'text', text: payload.notFoundText }, opcoesDeCitacao(payload.replyTo)),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar de falta de conteúdo no comando ${comando.id}`
      )
    }
    throw new Error('nenhum conteúdo fornecido para sobrescrever o arquivo')
  }

  let atualizado
  try {
    atualizado = acervo.reescrever(registro.id, buffer)
  } catch (erro) {
    if (erro?.code === 'LCN_SEM_VAGA') throw erro
    await avisar(erro?.message || 'não consegui sobrescrever o arquivo')
    throw erro
  } finally {
    orcamento?.liberar?.(tamanho)
  }

  if (payload.okText) {
    const confirmacao = payload.okText
      .replaceAll('{{caminho}}', atualizado.path)
      .replaceAll('{{id}}', atualizado.id)
      .replaceAll('{{nome}}', atualizado.name)
    await comTimeout(
      () => enviarERegistrar(client, payload.chatId, { type: 'text', text: confirmacao }, opcoesDeCitacao(payload.replyTo)),
      TIMEOUT_ENVIO_MS,
      `timeout ao confirmar o arquivo sobrescrito do comando ${comando.id}`
    )
  }
  return atualizado
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
      const upload = await usarMidia(m, (buffer) => subirMidia(client, buffer, {
        type: m.tipo === 'video' ? 'video' : 'image',
        mimetype: m.mime
      }))
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
      // Forma "simples", que é a que este caminho sempre usou e a única
      // PROVADA no aparelho do dono: só os cards, sem embrulho e sem texto
      // dentro. Não se troca o que está provado por simetria com o caminho
      // novo — a legenda continua indo em mensagem separada, logo abaixo.
      () => enviarERegistrar(client, chatId, montarCarrossel(cards, { estilo: 'simples' }), opcoesCitacao),
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
    if (erro?.code === 'LCN_SEM_VAGA') throw erro
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
    if (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_SEM_VAGA') throw erro
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

// As operações de participante que NÃO são remoção. O contrato de resposta da
// lib é o mesmo (`{ jid, status, code }` por participante), então a leitura é a
// mesma — inclusive a exigência das DUAS confirmações, que existe porque ler só
// metade do contrato gravava remoção bem-sucedida como falha.
//
// Fica num executor genérico em vez de três copiados: o que muda entre promover,
// rebaixar e adicionar é a chamada da lib e o verbo da mensagem de erro. Copiar
// o corpo três vezes criaria três lugares para o mesmo defeito voltar.
async function executarOperacaoDeParticipante (client, comando, { operacao, verbo }) {
  const { chatId, participantId } = comando.payload
  const resultado = await comTimeout(
    () => operacao(chatId, [participantId]),
    TIMEOUT_ENVIO_MS,
    `timeout ao ${verbo} ${participantId} do comando ${comando.id}`
  )

  const item = acharResultadoDoParticipante(resultado, participantId)
  if (!item) {
    throw erroIncerto(`o WhatsApp não confirmou ${verbo} ${participantId}: a resposta não trouxe o participante pedido`)
  }

  const codigo = Number(item.code)
  const codigoConhecido = Number.isFinite(codigo)
  const codigoOk = codigoConhecido && codigo >= 200 && codigo < 300

  if (item.status === 'ok' && codigoOk) return

  if (item.status === 'error' || (codigoConhecido && !codigoOk)) {
    const motivo = codigo === 403
      ? (verbo === 'adicionar' ? 'a pessoa não pode ser adicionada (privacidade) ou o bot não é admin' : 'o bot não é admin do grupo')
      : 'o WhatsApp recusou'
    throw new Error(`${verbo} ${participantId} não aconteceu: ${motivo} (código ${codigoConhecido ? codigo : item.status})`)
  }

  throw erroIncerto(`o WhatsApp respondeu ${verbo} ${participantId} num formato que não sei ler (status ${item.status}, código ${item.code}) — não dá para afirmar que aconteceu`)
}

async function executarPromoverNoGrupo (client, comando) {
  return executarOperacaoDeParticipante(client, comando, {
    operacao: (chatId, ids) => client.group.promoteParticipants(chatId, ids),
    verbo: 'promover'
  })
}

async function executarRebaixarNoGrupo (client, comando) {
  return executarOperacaoDeParticipante(client, comando, {
    operacao: (chatId, ids) => client.group.demoteParticipants(chatId, ids),
    verbo: 'rebaixar'
  })
}

async function executarAdicionarNoGrupo (client, comando) {
  return executarOperacaoDeParticipante(client, comando, {
    operacao: (chatId, ids) => client.group.addParticipants(chatId, ids),
    verbo: 'adicionar'
  })
}

function tratarErroDeConfiguracaoDeGrupo (erro, verbo) {
  if (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_SEM_VAGA' || erro?.code === 'LCN_RESULTADO_INCERTO') {
    throw erro
  }
  const codigo = Number(erro?.code || erro?.status || erro?.statusCode || erro?.data?.status || erro?.output?.statusCode)
  const codigoConhecido = Number.isFinite(codigo)
  const msg = mensagemDoErro(erro)
  const eh403 = codigo === 403 || msg.includes('403') || msg.toLowerCase().includes('admin') || msg.toLowerCase().includes('forbidden')
  const motivo = eh403 ? 'o bot não é admin do grupo' : 'o WhatsApp recusou'
  const codStr = codigoConhecido ? ` (código ${codigo})` : (eh403 ? ' (código 403)' : ` (${msg})`)
  throw new Error(`${verbo} não aconteceu: ${motivo}${codStr}`)
}

async function executarMudarNomeDoGrupo (client, comando) {
  const { chatId, subject } = comando.payload
  try {
    await comTimeout(
      () => client.group.setSubject(chatId, subject),
      TIMEOUT_ENVIO_MS,
      `timeout ao mudar o nome do grupo do comando ${comando.id}`
    )
  } catch (erro) {
    tratarErroDeConfiguracaoDeGrupo(erro, 'mudar o nome do grupo')
  }
}

async function executarMudarDescricaoDoGrupo (client, comando) {
  const { chatId, description } = comando.payload
  try {
    await comTimeout(
      () => client.group.setDescription(chatId, description || null),
      TIMEOUT_ENVIO_MS,
      `timeout ao mudar a descrição do grupo do comando ${comando.id}`
    )
  } catch (erro) {
    tratarErroDeConfiguracaoDeGrupo(erro, 'mudar a descrição do grupo')
  }
}

async function executarConfigurarAnuncioDoGrupo (client, comando) {
  const { chatId, close } = comando.payload
  const fechar = close !== false
  const verbo = fechar ? 'fechar o grupo' : 'abrir o grupo'
  try {
    await comTimeout(
      () => client.group.setSetting(chatId, 'announcement', fechar),
      TIMEOUT_ENVIO_MS,
      `timeout ao ${verbo} do comando ${comando.id}`
    )
  } catch (erro) {
    tratarErroDeConfiguracaoDeGrupo(erro, verbo)
  }
}

async function executarLinkDoGrupo (client, comando) {
  const { chatId, renova, text } = comando.payload
  const verbo = renova ? 'renovar o link do grupo' : 'obter o link do grupo'
  let codigo
  try {
    codigo = await comTimeout(
      () => (renova ? client.group.revokeInvite(chatId) : client.group.queryInviteCode(chatId)),
      TIMEOUT_ENVIO_MS,
      `timeout ao ${verbo} do comando ${comando.id}`
    )
  } catch (erro) {
    tratarErroDeConfiguracaoDeGrupo(erro, verbo)
  }

  const link = `https://chat.whatsapp.com/${codigo}`
  const textoFinal = text
    ? text.replaceAll('{{link}}', link).replaceAll('{{codigo}}', String(codigo))
    : link

  await comTimeout(
    () => enviarERegistrar(client, chatId, { type: 'text', text: textoFinal }, opcoesDeEnvio(comando.payload)),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar o link do grupo do comando ${comando.id}`
  )
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
    if (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_SEM_VAGA') throw erro
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
      .map((r) => referenciaDoAcervo(r, deps))
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

  await comTimeout(
    () => usarMidia(referenciaDoAcervo(registro, deps), async (buffer) => {
      // Texto guardado é resposta pronta: mandar como anexo mudaria o que a
      // pessoa espera ao escolher um texto do acervo.
      const conteudo = registro.kind === 'text'
        ? { type: 'text', text: buffer.toString('utf8') }
        : { type: registro.kind, media: buffer, mimetype: registro.mimetype }
      if (conteudo.type !== 'text' && payload.caption) conteudo.caption = payload.caption
      if (conteudo.type === 'document') conteudo.fileName = registro.name

      // VISUALIZAÇÃO ÚNICA REAL:
      //
      // Só existe no WhatsApp para imagem, vídeo e áudio (VIEW_ONCE_MEDIA_FIELDS
      // no zapo-js). Em texto e documento o protocolo não tem visualização única
      // e o envio sai como conteúdo comum.
      //
      // NÃO CONFUNDIR COM O EMBRULHO DE TRANSPORTE (carrossel.js):
      // No carrossel e menu interativo, `viewOnceMessageV2` é truque de
      // transporte para o WhatsApp desenhar botões interativos; aqui,
      // `viewOnce: true` é o pedido real de mídia efêmera que expira após
      // ser visualizada.
      //
      // LIMITE HONESTO: é apenas um pedido ao aplicativo de quem recebe.
      // Modificações de WhatsApp e comandos de recuperação (como o nosso /x9)
      // capturam a mídia antes de expirar. Não garante privacidade absoluta.
      if (payload.viewOnce && (conteudo.type === 'image' || conteudo.type === 'video' || conteudo.type === 'audio')) {
        conteudo.viewOnce = true
      }
      return enviarERegistrar(client, payload.chatId, conteudo, opcoesDeEnvio(payload))
    }),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar o arquivo do comando ${comando.id}`
  )
}

async function tratarSemVaga (client, comando, erro, filas) {
  filas.registrarRecusa(erro)
  const politica = comando.payload?.scheduling?.onNoSlot
  const resultado = {
    code: 'LCN_SEM_VAGA', recurso: erro.recurso || 'desconhecido',
    motivo: erro.motivo || 'sem_orcamento', prioridade: prioridadeDoComando(),
    decisao: politica?.kind === 'notify' ? 'notify' : 'discard'
  }
  console.warn(`[engine] LCN_SEM_VAGA comando=${comando.id} recurso=${resultado.recurso} prioridade=${resultado.prioridade} motivo=${resultado.motivo} decisao=${resultado.decisao}`)
  if (resultado.decisao === 'notify') {
    try {
      if (!comando.payload?.chatId || typeof politica.text !== 'string' || !politica.text.trim()) {
        throw new Error('O aviso de falta de vaga veio sem conversa ou texto válido.')
      }
      // Uma única tentativa na mesma fila de envios e com a mesma urgência.
      // Este catch nunca volta ao executor: falhar no aviso não cria recursão.
      await comTimeout(
        () => enviarERegistrar(client, comando.payload.chatId, { type: 'text', text: politica.text }, opcoesDeCitacao(comando.payload.replyTo)),
        TIMEOUT_ENVIO_MS, `timeout ao avisar falta de vaga do comando ${comando.id}`
      )
      resultado.aviso = 'enviado'
      filas.registrarAviso('enviados')
    } catch (erroDoAviso) {
      resultado.aviso = erroDoAviso?.code === 'LCN_SEM_VAGA' ? 'recusado' : 'falhou'
      resultado.codigoDoAviso = erroDoAviso?.code || 'LCN_FALHA_AVISO'
      filas.registrarAviso(resultado.aviso === 'recusado' ? 'recusados' : 'falharam')
      console.warn(`[engine] Aviso de LCN_SEM_VAGA ${resultado.aviso} comando=${comando.id}: ${resultado.codigoDoAviso}: ${mensagemDoErro(erroDoAviso)}; erro original preservado: ${mensagemDoErro(erro)}`)
    }
  }
  return resultado
}

export async function executarComandos (client, comandos, clienteEngine, deps = {}) {
  const filas = deps.filas || obterFilasDoGateway(client, deps.cfg)
  registrarFonteDeRecursos(() => ({ ...filas.estado, memoria: (deps.orcamento || orcamentoDoGateway)?.estado() || null }))
  for (const comando of Array.isArray(comandos) ? comandos : []) {
    await comContextoDeComando(comando?.payload?.scheduling, filas, async () => {
      let status
      const politica = comando?.payload?.scheduling?.onNoSlot
      if (politica?.kind && !['discard', 'notify'].includes(politica.kind)) {
        filas.registrarPoliticaInvalida()
        console.warn(`[engine] Política sem vaga inválida (${politica.kind}) no comando ${comando.id}; o compilador deveria ter barrado. Tratando como discard, sem repetir.`)
      }
      const executor = {
        'whatsapp.reply': executarResposta,
        'whatsapp.buttons': executarBotoes,
        'whatsapp.carousel': executarCarrossel,
        'whatsapp.webview': executarPagina,
        'whatsapp.recover': executarRecover,
        'whatsapp.menu': executarMenu,
        'whatsapp.delete': executarApagar,
        'group.remove': executarRemoverDoGrupo,
        'group.promote': executarPromoverNoGrupo,
        'group.demote': executarRebaixarNoGrupo,
        'group.add': executarAdicionarNoGrupo,
        'group.setSubject': executarMudarNomeDoGrupo,
        'group.setDescription': executarMudarDescricaoDoGrupo,
        'group.setAnnounce': executarConfigurarAnuncioDoGrupo,
        'group.inviteCode': executarLinkDoGrupo,
        'whatsapp.rich': executarMensagemRica,
        'whatsapp.sendFile': executarEnvioDeArquivo,
        'media.download': executarDownload,
        'connection.call': executarChamadaDeConexao,
        'acervo.save': executarGuardarNoAcervo,
        'acervo.delete': executarApagarDoAcervo,
        'acervo.createText': executarCriarTextoNoAcervo,
        'acervo.rewrite': executarSobrescreverNoAcervo,
        'whatsapp.stickerPack': executarPacoteDeFigurinhas
      }[comando?.commandType]
      let resultado = null
      if (!executor) {
        console.warn(`[engine] Tipo de comando desconhecido; execução recusada: ${comando?.commandType || '(ausente)'}`)
        status = 'outcome_unknown'
      } else {
        try {
          const resolvidas = await resolverDependencias(deps)
          // A recuperação e a entrada de mídia compartilham rede com o HTTP,
          // sem segurar a vaga de socket durante o download.
          const baixarBuffer = (...args) => filas.executar('rede', () => resolvidas.baixarBuffer(...args))
          resultado = (await executor(client, comando, { ...resolvidas, baixarBuffer, clienteEngine })) || null
          status = 'sent'
        } catch (erro) {
          if (erro?.code === 'LCN_SEM_VAGA') {
            cancelarTrabalhoExterno('recusa_admissao', erro.recurso)
            status = 'failed'
            resultado = await tratarSemVaga(client, comando, erro, filas)
          } else {
            status = (erro?.code === 'LCN_TIMEOUT' || erro?.code === 'LCN_RESULTADO_INCERTO') ? 'outcome_unknown' : 'failed'
            if (erro?.code === 'LCN_CANCELADO' || erro?.code === 'LCN_TIMEOUT_EXTERNO') {
              resultado = { code: erro.code, motivo: erro.motivo, recurso: erro.recurso, mensagem: mensagemDoErro(erro) }
            }
            console.warn(`[engine] Falha ao executar o comando ${comando.id} (${comando.commandType}): ${erro?.name || 'Erro'}: ${mensagemDoErro(erro)}`)
            const origem = String(erro?.stack || '').split('\n')[1]
            if (origem) console.warn(`[engine]   origem:${origem.replace(/^\s*at\s*/, ' ')}`)
          }
        }
      }
      await confirmarFailOpen(clienteEngine, comando, status, resultado)
    })
  }
}

// Carregadas sob demanda para o teste poder injetar tudo sem tocar em disco
// nem em processo externo.
let padroesCarregados = null
let orcamentoDoGateway = null
async function resolverDependencias (deps) {
  const limites = limitesDeMidia(deps.cfg)
  if (!deps.orcamento) {
    orcamentoDoGateway ||= criarOrcamentoDeMidia(limites.orcamento)
    orcamentoDoGateway.ajustarLimite(limites.orcamento)
  }
  const limiteInjetado = Number(deps.limiteBytes)
  deps = {
    ...deps,
    limiteBytes: Number.isSafeInteger(limiteInjetado) && limiteInjetado > 0 ? Math.min(limiteInjetado, limites.geral) : limites.geral,
    orcamento: deps.orcamento || orcamentoDoGateway
  }
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
      criarBaixador: downloader.criarBaixador
    }
  }
  return { ...padroesCarregados, ...deps }
}
