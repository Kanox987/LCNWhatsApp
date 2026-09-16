// Conexão com o WhatsApp: cria o WaClient (Zapo) com config enxuta, cuida de
// reconexão/backoff, login (QR ou código) e escreve o estado pro dashboard.
// Recarrega o config a quente; só reconecta quando muda algo preso à criação
// do client (logLevel, markOnline).
//
// Migrado de @whiskeysockets/baileys pra zapo-js — ver
// /home/kanox/.claude/plans/agora-o-que-eu-recursive-knuth.md pro plano
// completo. Pontos abaixo marcados "VALIDAR" dependem de comportamento real
// (não documentado com detalhe suficiente) e precisam ser confirmados no
// primeiro teste de conexão real, não presumidos.
import { WaClient, createStore, ConsoleLogger, fetchLatestWaWebVersion } from 'zapo-js'
import { createSqliteStore } from '@zapo-js/store-sqlite'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import readline from 'readline'
import path from 'path'
import { PASTA_SESSAO, PASTA_DADOS, ARQ_GRUPOS_REFRESH, garantirPastas } from './paths.js'
import { carregar, observar } from './config.js'
import { atualizarGrupos, registrarContato } from './directory.js'
import * as state from './state.js'
import * as bandwidth from './bandwidth.js'
import { classificarFechamento, mensagemParaClasse, codigoParaClasse } from './connectionReasons.js'
import { EXIT_QUARANTINED } from './exitCodes.js'
import { resolverAccountId } from './engine/instanceIdentity.js'
import { construirEventoDeMensagem, construirEventoDeIndisponivel } from './engine/zapoAdapter.js'
import { emitirEventoDebug } from './engine/eventSink.js'
import { criarClienteEngine } from './engine/client.js'
import { enviarEventoAoMotor } from './engine/gatewaySink.js'
import * as groupInfo from './engine/groupInfo.js'
import { executarComandos } from './engine/gatewayExecutor.js'
import { APARELHOS, resolverAparelho } from './aparelho.js'

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a)
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
// Pareamento por código aceita o número por argumento ou ambiente, além do
// terminal. Sem isso ele só existia de forma interativa (`pergunta()` no
// stdin), e um bot iniciado pelo painel — que roda destacado, sem terminal —
// ficava pendurado esperando alguém digitar num prompt que ninguém vê.
//
//   node index.js --code=5522999999999
//   LCN_PAIR_NUMBER=5522999999999 node index.js --code
const USAR_CODIGO = process.argv.some((a) => a === '--code' || a.startsWith('--code='))

// Aparelho por argumento/ambiente, com a mesma lógica do --code: quem conecta
// escolhe na hora, sem editar arquivo. O config.json é o padrão de quem não
// escolhe nada.
function aparelhoDoArgumento () {
  const pegar = (nome, env) => {
    const arg = process.argv.find((a) => a.startsWith(`--${nome}=`))
    const bruto = arg ? arg.slice(nome.length + 3) : (process.env[env] || '')
    return String(bruto).trim()
  }
  return { navegador: pegar('aparelho', 'LCN_APARELHO'), sistema: pegar('sistema', 'LCN_APARELHO_SISTEMA') }
}

function numeroDoArgumento () {
  const arg = process.argv.find((a) => a.startsWith('--code='))
  const bruto = arg ? arg.slice('--code='.length) : (process.env.LCN_PAIR_NUMBER || '')
  const digitos = String(bruto).replace(/\D/g, '')
  return digitos.length >= 8 ? digitos : null
}

// Só cai no prompt quando existe terminal de verdade. Num processo destacado
// isso travaria para sempre — e travar em silêncio é pior que recusar.
async function numeroParaParear () {
  const doArgumento = numeroDoArgumento()
  if (doArgumento) return doArgumento
  if (!process.stdin.isTTY) return null
  return (await pergunta('Digite seu número com DDI (ex: 5511999999999): ')).replace(/\D/g, '')
}
const SESSION_ID = 'default'

// Dispara o caminho novo sem bloquear nem substituir a captura existente.
// Embora sink/executor sejam defensivos por conta própria, o catch final
// protege o event emitter contra qualquer regressão futura nesses módulos.
// `cfg` vem por PARÂMETRO, não por closure: a configuração é recarregada a
// quente dentro de `iniciar()`, e esta função mora fora dela. Ler `cfg` aqui
// como variável livre não é "pegar a versão atual" — é ReferenceError, e foi
// exatamente o que quebrou TODAS as automações que produzem comando: o motor
// casava, gravava o comando, e o gateway estourava antes de executar.
export function encaminharEventoAoMotor (client, clienteEngine, eventoCanonico, cfg, log) {
  // O enriquecimento de grupo (nome, tamanho, quem é admin) acontece aqui e
  // não na construção do evento porque é chamada de rede: fica no caminho já
  // assíncrono, sem atrasar o processamento da mensagem. Falha aberto — sem os
  // dados, o evento segue como estava.
  return groupInfo.enriquecerEvento(client, eventoCanonico)
    .catch(() => eventoCanonico)
    .then((evento) => enviarEventoAoMotor(clienteEngine, evento))
    .then(async (resultado) => {
    // Motor fora do ar ou lento passa por aqui: `enviarEventoAoMotor` falha
    // aberto e devolve `ok: false`. Sem esta linha, "o bot parou de responder"
    // não deixa rastro em lugar nenhum.
    if (!resultado.ok) {
      try { log?.(`[engine] evento não avaliado: ${resultado.motivo}`) } catch {}
      return
    }
    for (const avaliacao of resultado.results || []) {
      const comandos = (avaliacao.commands || []).filter((comando) => comando.status === 'pending')
      // O `cfg` chega ao executor porque ações como o download leem
      // configuração (endereço do serviço, token, limite de tamanho). Era a
      // lacuna que também travava a transcrição.
      if (comandos.length) await executarComandos(client, comandos, clienteEngine, { cfg })
    }
  // Engolir o erro aqui deixou o bot mudo por duas horas sem uma linha de log:
  // o comando ficava `pending` para sempre e não havia onde olhar. Continua
  // falhando aberto — o event emitter não pode cair —, mas agora DIZ.
  }).catch((e) => {
    try { log?.(`[engine] falha ao entregar comando: ${e?.message || e}`) } catch {}
  })
}

// O JID da própria conta. meJid vem com
// sufixo de dispositivo (":12@"), e é a forma sem ele que endereça a pessoa.
function jidProprio (client) {
  try {
    const meJid = client.getCredentials?.()?.meJid
    return meJid ? meJid.replace(/:\d+@/, '@') : null
  } catch {
    return null
  }
}

// Alimenta o diretório de contatos conhecidos (usado pelas telas de seleção
// do dashboard) com quem já mandou mensagem — sem sync extra, orgânico.
function registrarContatoConhecido (event) {
  const from = event.key?.remoteJid
  if (!from || event.key.fromMe) return
  if (from.endsWith('@broadcast') || from.endsWith('@newsletter')) return
  // Grupo entra também: antes só conversa direta era registrada, então o nome
  // de quem falava em grupo nunca era lembrado e {{sender.name}} dependia de o
  // WhatsApp mandar o nome naquela mensagem específica. O que se guarda é a
  // PESSOA que escreveu, nunca o grupo.
  const ehGrupo = from.endsWith('@g.us')
  const jidReal = event.key.participantAlt || event.key.participant || (ehGrupo ? null : (event.key.remoteJidAlt || from))
  if (!jidReal) return
  try { registrarContato(jidReal, event.pushName) } catch {}
}

// `event.pushName` é só o nome que a própria pessoa escolheu pro perfil dela
// (às vezes vazio) — não é o nome salvo na agenda. Na Baileys, o nome salvo
// de verdade (agenda do celular) chegava via 'contacts.upsert'/'contacts.update'
// (app-state sync). VALIDAR: o Zapo não documenta um evento equivalente — o
// candidato mais próximo é 'mutation' (app-state sync genérico). Mantido
// como função pura testável; a chamada real (mutationParaContato) tenta
// mapear o evento e loga a forma bruta em debug pra fechar essa lacuna no
// primeiro teste real. Se não houver equivalente, o diretório regride pra
// só pushName — decisão a confirmar, não a assumir.
export function registrarNomesDoDiretorio (contatos) {
  for (const c of contatos || []) {
    const numero = c.phoneNumber || c.id
    const nome = c.name || c.notify
    if (!numero || !nome) continue
    try { registrarContato(numero, nome) } catch {}
  }
}

const pergunta = (texto) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question(texto, (r) => { rl.close(); resolve(r) })
})

// Assinatura só do que é passado pro WaClient na criação (logLevel,
// markOnline) — o resto (contatos/blocklist/grupos) é lido ao vivo por
// passaFiltro() a cada mensagem, sem precisar reconectar.
function assinaturaSocket (cfg) {
  return JSON.stringify({
    logLevel: cfg.hardware?.logLevel,
    markOnline: cfg.hardware?.markOnline
  })
}

// SQLite local (better-sqlite3, addon nativo) — equivalente mais próximo do
// useMultiFileAuthState em arquivos da Baileys.
function criarStore () {
  const caminho = path.join(PASTA_SESSAO, 'zapo.sqlite')
  return createStore({
    backends: { sqlite: createSqliteStore({ path: caminho, driver: 'auto' }) },
    providers: {
      auth: 'sqlite',
      signal: 'sqlite',
      preKey: 'sqlite',
      session: 'sqlite',
      identity: 'sqlite',
      senderKey: 'sqlite',
      appState: 'sqlite',
      privacyToken: 'sqlite',
      messages: 'none',
      threads: 'none',
      contacts: 'none'
    }
  })
}

export async function iniciar () {
  garantirPastas()
  let cfg = carregar()

  // Precedência: o que foi passado na hora de conectar vence o config.json,
  // que vence o padrão. Resolvido UMA vez, aqui, e não a cada reconexão: o
  // rótulo é gravado no pareamento, então mudá-lo no meio da vida da sessão
  // não teria efeito nenhum e só confundiria quem lesse o log.
  const escolha = aparelhoDoArgumento()
  let aparelho
  try {
    aparelho = resolverAparelho({
      navegador: escolha.navegador || cfg.hardware?.aparelho?.navegador,
      sistema: escolha.sistema || cfg.hardware?.aparelho?.sistema
    })
  } catch (erro) {
    // Recusa clara em vez do aparelho sem nome que a biblioteca produziria.
    console.error(erro.message)
    console.error(`Opções: ${APARELHOS.map((a) => `${a.id} (${a.rotulo})`).join(' · ')}`)
    throw erro
  }
  log(`aparelho: ${aparelho.rotulo}`)

  let assinatura = assinaturaSocket(cfg)
  let falhas = 0
  let clienteAtual = null
  let reiniciando = false
  // Handle do setTimeout(conectar, espera) do retry transiente — guardado
  // pra poder cancelar se um fechamento TERMINAL (logout/conflito/
  // fatal_account/quarentena) chegar logo depois de um retry já agendado.
  // Sem isso, o timer antigo dispararia mesmo assim e reconectaria — quebra
  // a garantia de "nunca reconecta sozinho" nesses casos (achado real na
  // revisão de código).
  let handleRetry = null
  const store = criarStore()
  // Etapa 1 do motor de automação (Parte B do plano): identidade estável
  // deste gateway, usada só pra rotular o evento canônico de debug por
  // enquanto (emitirEventoDebug) — nenhum consumidor real ainda. Recalculado
  // no hot-reload porque cfg.instancia.id pode ser editado ao vivo.
  let accountId = resolverAccountId({ cfg, pastaDados: PASTA_DADOS })
  // Uma instância por processo, reaproveitada por todas as mensagens e por
  // todas as reconexões do WaClient.
  const clienteEngine = criarClienteEngine()

  // Hot-reload: a maioria do config (captura, transcrição, atualização) é lida ao
  // vivo pelos handlers via closure em `cfg`. Só reconecta quando muda algo que
  // precisa recriar o client (logLevel, markOnline).
  observar((novo) => {
    cfg = novo
    accountId = resolverAccountId({ cfg, pastaDados: PASTA_DADOS })
    bandwidth.configurar(cfg.hardware?.bandwidthLimit)
    const nova = assinaturaSocket(novo)
    if (nova !== assinatura) {
      assinatura = nova
      log('Config de conexão mudou — reconectando pra aplicar...')
      try { clienteAtual?.disconnect() } catch {}
    }
  })

  // Desligamento gracioso: matar o processo sem desconectar (ex.: SIGTERM
  // abrupto) já causou, na prática, o WhatsApp invalidar a sessão recém-
  // pareada na próxima tentativa de resume (failure_not_authorized/401,
  // credenciais limpas pelo próprio Zapo) — visto num teste real durante a
  // migração. disconnect() fecha a conexão preservando as credenciais.
  let desligando = false
  async function desligarGracioso () {
    if (desligando) return
    desligando = true
    try { await clienteAtual?.disconnect() } catch {}
    process.exit(0)
  }
  process.on('SIGINT', desligarGracioso)
  process.on('SIGTERM', desligarGracioso)

  // Comando "apagar dados do número" (vindo do painel > Serviço): o painel cria
  // data/logout.request; aqui deslogamos, limpamos a sessão e saímos pra reiniciar
  // limpo (o restart policy do container / PM2 recoloca de pé pedindo novo login).
  const reqLogout = path.join(PASTA_DADOS, 'logout.request')
  const reqRestart = path.join(PASTA_DADOS, 'restart.request')
  setInterval(async () => {
    // Painel pediu refresh da lista de grupos (sem precisar reiniciar o bot).
    if (fs.existsSync(ARQ_GRUPOS_REFRESH)) {
      try { fs.unlinkSync(ARQ_GRUPOS_REFRESH) } catch {}
      if (clienteAtual) {
        try { await atualizarGrupos(clienteAtual) } catch (e) { log('erro atualizando grupos:', e.message) }
      }
    }
    // Reiniciar sem apagar sessão (restart policy do container / PM2 recolocam de pé).
    if (fs.existsSync(reqRestart)) {
      try { fs.unlinkSync(reqRestart) } catch {}
      log('🔄 Comando recebido: reiniciando o bot...')
      await sleepMs(300)
      process.exit(0)
    }
    if (!fs.existsSync(reqLogout)) return
    try { fs.unlinkSync(reqLogout) } catch {}
    log('🔌 Comando recebido: apagando dados do número e reiniciando...')
    try { await clienteAtual?.logout() } catch {}
    await sleepMs(800)
    try {
      for (const f of fs.readdirSync(PASTA_SESSAO)) {
        fs.rmSync(path.join(PASTA_SESSAO, f), { recursive: true, force: true })
      }
    } catch (e) { log('erro limpando sessão:', e.message) }
    state.definirConexao({ conectado: false, numero: null, nome: null })
    state.gravar()
    log('Sessão limpa. Reiniciando pra novo login (veja o QR/código nos logs)...')
    await sleepMs(400)
    process.exit(0)
  }, 3000)

  async function conectar () {
    if (reiniciando) return
    bandwidth.configurar(cfg.hardware?.bandwidthLimit)
    const nivel = cfg.hardware?.logLevel
    const logger = nivel && nivel !== 'silent' ? new ConsoleLogger(nivel) : undefined

    const client = new WaClient({
      store,
      sessionId: SESSION_ID,
      deviceBrowser: aparelho.deviceBrowser,
      deviceOsDisplayName: aparelho.deviceOsDisplayName,
      markOnlineOnConnect: cfg.hardware?.markOnline === true,
      // Equivalente a syncFullHistory:false da Baileys: sync leve (só o
      // recente), não o histórico completo.
      history: { enabled: true, requireFullSync: false },
      version: async () => (await fetchLatestWaWebVersion()).version
    }, logger)
    clienteAtual = client

    if (!USAR_CODIGO) {
      client.on('auth_qr', ({ qr }) => {
        qrcode.generate(qr, { small: true })   // pros logs (docker logs -f)
        state.definirQR(qr)                     // pro painel renderizar
        log('QR gerado — escaneie pelo painel (lcn > Serviço > Conectar) ou nos logs.')
      })
    }


    // VALIDAR: candidato a equivalente de contacts.upsert/contacts.update
    // (agenda do telefone) — ver comentário de registrarNomesDoDiretorio.
    client.on('mutation', (event) => {
      if (cfg.hardware?.debug) log('mutation:', JSON.stringify(event).slice(0, 500))
    })

    // Promoveu, rebaixou, entrou, saiu, mudou o nome do grupo: o cache de
    // dados daquele grupo cai na hora. É o que impede {{sender.isAdmin}} de
    // decidir permissão com informação velha — o TTL lá dentro é só rede de
    // segurança para o caso de uma dessas notificações se perder.
    client.on('group', (event) => {
      try { groupInfo.invalidar(event?.groupJid || event?.chatJid) } catch {}
    })

    client.on('message', async (event) => {
      // Capturado antes de qualquer outro trabalho: é o t0 usado por
      // automações como /ping pra medir latência de ponta a ponta
      // (recebimento -> resposta enviada), incluindo o hop pelo motor.
      const recebidoEmMs = Date.now()
      if (cfg.hardware?.debug) log(`message key.id=${event.key?.id} fromMe=${event.key?.fromMe}`)
      registrarContatoConhecido(event)
      // Construção, debug e envio ficam isolados: um erro aqui não pode
      // derrubar o event emitter da conexão.
      try {
        const eventoCanonico = construirEventoDeMensagem(event, { accountId, recebidoEmMs, botId: jidProprio(client) })
        emitirEventoDebug(eventoCanonico, cfg, log)
        encaminharEventoAoMotor(client, clienteEngine, eventoCanonico, cfg, log)
      } catch (e) {
        if (cfg.hardware?.debug) log('evento canônico/motor falhou:', e.message)
      }
    })

    client.on('message_unavailable', async (event) => {
      const recebidoEmMs = Date.now()
      if (cfg.hardware?.debug) log(`message_unavailable kind=${event.kind} resendRequested=${event.resendRequested}`)
      try {
        const eventoCanonico = construirEventoDeIndisponivel(event, { accountId, recebidoEmMs, botId: jidProprio(client) })
        emitirEventoDebug(eventoCanonico, cfg, log)
        encaminharEventoAoMotor(client, clienteEngine, eventoCanonico, cfg, log)
      } catch (e) {
        if (cfg.hardware?.debug) log('evento canônico/motor falhou:', e.message)
      }
    })

    client.on('connection', ({ status, reason, isLogout }) => {
      if (status === 'open') {
        falhas = 0
        state.registrarSucessoConexao()
        state.limparQR()
        state.limparCodigoPareamento()
        const creds = client.getCredentials?.()
        const jid = creds?.meJid
        log('Conectado como', jid || '(jid não disponível)')
        // Marca o dispositivo como ativo — igual ao comportamento anterior. Sem
        // isso, o dispositivo pode ficar "offline" e remetentes podem não
        // encriptar as mensagens pra ele.
        client.presence?.send?.('available').catch(() => {})
        atualizarGrupos(client).catch((e) => log('erro atualizando grupos:', e.message))
        // Carrega de uma vez quem é admin em cada grupo. Sem isto, a PRIMEIRA
        // mensagem de cada grupo depois de conectar pagaria a consulta — e, se
        // ela falhasse, sairia sem {{sender.isAdmin}} e sem {{chat.name}}.
        groupInfo.aquecer(client)
          .then((n) => { if (n) log(`dados de ${n} grupo(s) carregados`) })
          .catch(() => {})
        state.definirConexao({
          conectado: true,
          numero: jid ? jid.split('@')[0].split(':')[0] : null,
          nome: null,
          desde: Date.now()
        })
      }

      // VALIDADO em teste real: o valor do evento é 'close', não 'closed'
      // como a doc do Zapo descreve em prosa.
      if (status === 'close') {
        state.definirConexao({ conectado: false })
        const classe = classificarFechamento({ reason, isLogout })

        if (classe === 'auto_gerenciado') {
          // stream_error_force_login: o Zapo já reconecta o MESMO client
          // sozinho (ver connectionReasons.js). NÃO agendar setTimeout(conectar)
          // aqui é o ponto principal — fazer isso criaria um segundo WaClient
          // pro mesmo sessionId enquanto o Zapo ainda está se recuperando,
          // recriando o incidente de disputa de sessão. Só loga e espera o
          // próximo evento do client atual.
          state.incr('quedas')
          log(`Conexão caiu (motivo ${reason}) — o Zapo reconecta sozinho aqui, não vou interferir.`)
          return
        }

        if (classe === 'transiente') {
          falhas++
          // Usa o valor retornado, não state.ler() — o flush em disco é
          // debounced (250ms), reler o arquivo aqui sempre pegaria o valor
          // ANTERIOR (bug real encontrado em revisão de código).
          const falhasConsecutivas = state.registrarFalhaConexao()
          state.incr('quedas')
          avaliarAutoUpdate(falhas, cfg)
          const limiteQuarentena = cfg.confiabilidade?.falhasConsecutivasParaQuarentena || 15
          if (falhasConsecutivas >= limiteQuarentena) {
            // Mesma trava do bloco terminal abaixo: quarentena também nunca
            // deve reconectar sozinho.
            clearTimeout(handleRetry)
            reiniciando = true
            entrarEmQuarentena(reason)
            return
          }
          const espera = Math.min(30000, 2000 * falhas)
          log(`Conexão caiu (motivo ${reason}), reconectando em ${espera / 1000}s (falha ${falhas})...`)
          state.incr('reconexoes')
          handleRetry = setTimeout(conectar, espera)
          return
        }

        // logout / conflito / fatal_account: nunca reconecta sozinho — motivo
        // exato do incidente que causou este pedaço do plano (duas instâncias
        // da mesma sessão brigando porque o retry era genérico pra qualquer
        // motivo de fechamento, inclusive conflito de sessão). Cancela
        // qualquer retry transiente já agendado e trava conectar() via
        // `reiniciando` — sem isso um timer residual (ou o próprio Zapo
        // reconectando internamente em alguns motivos) poderia reconectar
        // mesmo assim (achado real em revisão de código).
        clearTimeout(handleRetry)
        reiniciando = true
        state.incr('quedas')
        state.definirSaude({ status: classe, motivo: reason, desde: Date.now() })
        log(mensagemParaClasse(classe, reason))
        if (process.env.LCN_SUPERVISED === 'systemd') {
          state.gravar()
          setTimeout(() => process.exit(codigoParaClasse(classe)), 300)
        }
      }
    })

    const conexao = client.connect()

    // A hipótese anterior de que connect() aguardava o pareamento estava errada:
    // no Zapo 1.8.2 ele resolve quando o transporte sobe, mesmo sem meJid.
    // auth_pairing_required nasce só de refresh_code e serve para renovar o código.
    await conexao

    if (USAR_CODIGO) {
      if (!client.getState().registered) {
        const numero = await numeroParaParear()
        if (!numero) throw new Error('pareamento por código exige um número: use --code=5522999999999 ou LCN_PAIR_NUMBER')
        let pedidoCodigo = null

        const solicitarCodigo = () => {
          if (pedidoCodigo) return pedidoCodigo
          pedidoCodigo = client.auth.requestPairingCode(numero)
            .then((codigo) => {
              const formatado = codigo.match(/.{1,4}/g)?.join('-') || codigo
              log('Código de pareamento:', formatado)
              state.definirCodigoPareamento(formatado)
            })
            .finally(() => { pedidoCodigo = null })
          return pedidoCodigo
        }
        const renovarCodigo = () => {
          if (client.getState().registered) return
          void solicitarCodigo().catch((e) => log('Erro renovando código de pareamento:', e.message))
        }
        const encerrarRenovacao = () => {
          client.off('auth_pairing_required', renovarCodigo)
          client.off('auth_paired', encerrarRenovacao)
          client.off('connection', aoMudarConexao)
        }
        const aoMudarConexao = ({ status }) => {
          if (status === 'close') encerrarRenovacao()
        }

        client.on('auth_pairing_required', renovarCodigo)
        client.on('connection', aoMudarConexao)
        client.once('auth_paired', encerrarRenovacao)
        try {
          await solicitarCodigo()
        } catch (e) {
          encerrarRenovacao()
          throw e
        }
      }
    }

    return client
  }

  await conectar()
}

// Em queda persistente, sinaliza que o Zapo pode precisar de atualização.
// Última instância antes de desistir de reconectar sozinho: N falhas
// consecutivas (persistidas em state.saude, sobrevivem a restart do
// processo — ver state.js) sem NENHUM sucesso no meio. Nunca apaga a sessão
// — só para de tentar; o usuário decide (via painel/lcn instances retry) se
// quer só tentar de novo ou limpar a sessão e parear do zero.
function entrarEmQuarentena (motivo) {
  state.definirSaude({ status: 'quarentena', motivo, desde: Date.now() })
  log(`⚠️  Muitas falhas de conexão seguidas sem sucesso — entrando em quarentena (motivo mais recente: ${motivo}). Não vou mais tentar reconectar sozinho.`)
  if (process.env.LCN_SUPERVISED === 'systemd') {
    state.gravar()
    setTimeout(() => process.exit(EXIT_QUARANTINED), 300)
  }
}

function avaliarAutoUpdate (falhas, cfg) {
  const limite = cfg.atualizacao?.falhasParaUpdate || 5
  if (!cfg.atualizacao?.autoUpdateLib) return
  if (falhas < limite) return
  try {
    garantirPastas()
    const flag = path.join(PASTA_DADOS, 'precisa-update.flag')
    fs.writeFileSync(flag, `Quedas consecutivas: ${falhas}. Rode a atualização (sh update.sh) ou "lcn" > Atualizar.\n`)
    log('⚠️  Muitas quedas seguidas — pode ser mudança de protocolo do WhatsApp. Sinalizado update do zapo-js.')
  } catch {}
}
