const TIMEOUT_ENVIO_MS = 15000
const TIMEOUT_CONFIRMACAO_MS = 1500

function mensagemDoErro (erro) {
  try {
    return erro instanceof Error ? erro.message : String(erro || 'falha desconhecida')
  } catch {
    return 'falha desconhecida'
  }
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

async function confirmarFailOpen (clienteEngine, comando, status) {
  try {
    await comTimeout(
      () => clienteEngine.execucoes.confirmar(comando.id, { status }),
      TIMEOUT_CONFIRMACAO_MS,
      `timeout ao confirmar o comando ${comando.id}`
    )
  } catch (erro) {
    console.warn(`[engine] Não foi possível confirmar o comando ${comando?.id || '(sem id)'}: ${mensagemDoErro(erro)}`)
  }
}

async function executarResposta (client, comando) {
  const texto = resolverTextoComLatencia(comando.payload.text, comando.payload.receivedAtMs)
  await comTimeout(
    () => client.message.send(comando.payload.chatId, { type: 'text', text: texto }),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar o comando ${comando.id}`
  )
}

// Figurinha: o motor mandou só o token opaco da mídia, porque ele nunca vê o
// conteúdo. Resolver o token, baixar e converter é trabalho deste processo —
// e só DESTE, já que o token só existe na memória de quem o criou.
// A conversão tem timeout próprio, maior que o do envio, porque o ffmpeg
// pode levar segundos num vídeo; por isso não fica dentro do comTimeout do send.
async function executarFigurinha (client, comando, deps) {
  const { mediaRefCache, baixarBuffer, converterParaFigurinha, podeVirarFigurinha, ehAnimada, limiteBytes } = deps

  const entrada = mediaRefCache.resolver(comando.payload.mediaRef)
  if (!entrada) {
    // TTL do cache é curto de propósito. Um comando que volta tarde demais do
    // motor não tem mais como resolver a mídia — e é erro conhecido, não
    // resultado ambíguo: nada foi enviado.
    throw new Error('a mídia desta figurinha expirou antes do comando voltar do motor')
  }
  if (!podeVirarFigurinha(entrada.tipo)) {
    throw new Error(`não dá pra fazer figurinha de ${entrada.tipo}`)
  }

  const bruto = await baixarBuffer(client, entrada.node, entrada.tipo, limiteBytes)
  const figurinha = await converterParaFigurinha(bruto, { animada: ehAnimada(entrada.tipo) })

  await comTimeout(
    () => client.message.send(comando.payload.chatId, { type: 'sticker', media: figurinha }),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar a figurinha do comando ${comando.id}`
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

  const conteudo = { type: entrada.tipo, media: buffer }
  if (comando.payload.caption) conteudo.caption = comando.payload.caption

  await comTimeout(
    () => client.message.send(destino, conteudo),
    TIMEOUT_ENVIO_MS,
    `timeout ao reenviar a mídia recuperada do comando ${comando.id}`
  )
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
      () => client.message.send(payload.chatId, montarMenuInterativo(payload)),
      TIMEOUT_ENVIO_MS,
      `timeout ao enviar o menu do comando ${comando.id}`
    )
  } catch (erro) {
    if (erro?.code === 'LCN_TIMEOUT') throw erro
    // O envio interativo falhou (app antigo, formato recusado pelo servidor).
    // Cair para texto é melhor que a pessoa ficar sem menu nenhum.
    console.warn(`[engine] Menu interativo recusado, enviando como texto: ${mensagemDoErro(erro)}`)
    await comTimeout(
      () => client.message.send(payload.chatId, { type: 'text', text: payload.fallbackText }),
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
    () => client.message.send(comando.payload.chatId, { type: 'revoke', target }),
    TIMEOUT_ENVIO_MS,
    `timeout ao apagar a mensagem do comando ${comando.id}`
  )
}

// Remover participante do grupo. Só funciona se o bot for admin; quando não
// for, a lib responde com falha por participante e isso vira 'failed' — erro
// conhecido, não resultado ambíguo.
async function executarRemoverDoGrupo (client, comando) {
  const { chatId, participantId } = comando.payload
  const resultado = await comTimeout(
    () => client.group.removeParticipants(chatId, [participantId]),
    TIMEOUT_ENVIO_MS,
    `timeout ao remover ${participantId} do comando ${comando.id}`
  )
  // A API devolve o resultado POR participante: um array "ok" com status de
  // erro dentro não é sucesso, e tratar como sucesso esconderia "o bot não é
  // admin" — o motivo mais comum dessa ação falhar.
  const item = Array.isArray(resultado) ? resultado[0] : null
  const status = item?.status ?? item?.code
  if (status !== undefined && String(status) !== '200' && item?.success !== true) {
    throw new Error(`o WhatsApp recusou a remoção (status ${status}) — o bot provavelmente não é admin do grupo`)
  }
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
      () => client.message.send(payload.chatId, montarMensagemRica(payload)),
      TIMEOUT_ENVIO_MS,
      `timeout ao enviar a mensagem formatada do comando ${comando.id}`
    )
  } catch (erro) {
    if (erro?.code === 'LCN_TIMEOUT') throw erro
    // Esperado sempre que a Meta mudar algo. Cair para texto comum mantém a
    // automação útil em vez de simplesmente parar de responder.
    console.warn(`[engine] Mensagem formatada recusada, enviando como texto: ${mensagemDoErro(erro)}`)
    await comTimeout(
      () => client.message.send(payload.chatId, { type: 'text', text: payload.fallbackText }),
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
  const registro = acervo.obter(payload.fileId)

  if (!registro) {
    if (payload.notFoundText) {
      await comTimeout(
        () => client.message.send(payload.chatId, { type: 'text', text: payload.notFoundText }),
        TIMEOUT_ENVIO_MS,
        `timeout ao avisar do arquivo ausente no comando ${comando.id}`
      )
    }
    throw new Error(`o arquivo ${payload.fileId} não está mais no acervo`)
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
    () => client.message.send(payload.chatId, conteudo),
    TIMEOUT_ENVIO_MS,
    `timeout ao enviar o arquivo do comando ${comando.id}`
  )
}

export async function executarComandos (client, comandos, clienteEngine, deps = {}) {
  for (const comando of Array.isArray(comandos) ? comandos : []) {
    let status

    const executor = {
      'whatsapp.reply': executarResposta,
      'whatsapp.sticker': executarFigurinha,
      'whatsapp.recover': executarRecover,
      'whatsapp.menu': executarMenu,
      'whatsapp.delete': executarApagar,
      'group.remove': executarRemoverDoGrupo,
      'whatsapp.rich': executarMensagemRica,
      'whatsapp.sendFile': executarEnvioDeArquivo
    }[comando?.commandType]

    if (!executor) {
      console.warn(`[engine] Tipo de comando desconhecido; execução recusada: ${comando?.commandType || '(ausente)'}`)
      status = 'outcome_unknown'
    } else {
      try {
        await executor(client, comando, await resolverDependencias(deps))
        status = 'sent'
      } catch (erro) {
        status = erro?.code === 'LCN_TIMEOUT' ? 'outcome_unknown' : 'failed'
        console.warn(`[engine] Falha ao executar o comando ${comando.id}: ${mensagemDoErro(erro)}`)
      }
    }

    await confirmarFailOpen(clienteEngine, comando, status)
  }
}

// Carregadas sob demanda para que um gateway que nunca manda figurinha não
// pague o import de ffmpeg/visu, e para o teste poder injetar tudo sem tocar
// em disco nem em processo externo.
let padroesCarregados = null
async function resolverDependencias (deps) {
  if (deps.mediaRefCache) return deps
  if (!padroesCarregados) {
    const [cache, visu, sticker, acervo] = await Promise.all([
      import('./mediaRefCache.js'),
      import('../visu.js'),
      import('../sticker.js'),
      import('../mediaLibrary.js')
    ])
    padroesCarregados = {
      mediaRefCache: cache,
      acervo,
      baixarBuffer: visu.baixarBuffer,
      converterParaFigurinha: sticker.converterParaFigurinha,
      podeVirarFigurinha: sticker.podeVirarFigurinha,
      ehAnimada: sticker.ehAnimada,
      // Mesma normalização de capture.js (jidProprio): meJid vem com sufixo
      // de dispositivo (":12@") e o self-chat só aceita a forma sem ele.
      resolverJidProprio: (client) => {
        const meJid = client.getCredentials?.()?.meJid
        return meJid ? meJid.replace(/:\d+@/, '@') : null
      },
      limiteBytes: 64 * 1024 * 1024
    }
  }
  return { ...padroesCarregados, ...deps }
}
