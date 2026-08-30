// Conexão com o WhatsApp: cria o socket com config enxuta, aplica a barreira
// shouldIgnoreJid (só broadcast/newsletter — ver src/ignore.js), cuida de
// reconexão/backoff, login (QR ou código) e escreve o estado pro dashboard.
// Recarrega o config a quente; só reconecta quando muda algo preso à criação
// do socket (logLevel, markOnline).
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import fs from 'fs'
import readline from 'readline'
import path from 'path'
import { PASTA_SESSAO, PASTA_DADOS, ARQ_GRUPOS_REFRESH, garantirPastas } from './paths.js'
import { carregar, observar } from './config.js'
import { montarShouldIgnore } from './ignore.js'
import { criarHandler } from './capture.js'
import { atualizarGrupos, registrarContato } from './directory.js'
import * as state from './state.js'

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a)
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
const USAR_CODIGO = process.argv.includes('--code')

// Alimenta o diretório de contatos conhecidos (usado pelas telas de seleção
// do dashboard) com quem já mandou mensagem — sem sync extra, orgânico.
function registrarContatoConhecido (info) {
  const from = info.key?.remoteJid
  if (!from || info.key.fromMe) return
  if (from.endsWith('@g.us') || from.endsWith('@broadcast') || from.endsWith('@newsletter')) return
  const jidReal = info.key.participantAlt || info.key.remoteJidAlt || info.key.participant || from
  try { registrarContato(jidReal, info.pushName) } catch {}
}

// `info.pushName` é só o nome que a própria pessoa escolheu pro perfil dela
// (às vezes vazio) — não é o nome salvo na agenda. O nome salvo de verdade
// (agenda do celular) chega via 'contacts.upsert'/'contacts.update' (evento
// de app-state sync da Baileys, `name`/`notify`), inclusive pra gente que
// nunca mandou mensagem pro bot. Confirmado lendo
// node_modules/@whiskeysockets/baileys/lib/Utils/sync-action-utils.js.
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

// Assinatura só do que é passado pro makeWASocket na criação (logLevel,
// markOnline) — o resto (contatos/blocklist/grupos) é lido ao vivo por
// passaFiltro() a cada mensagem, sem precisar reconectar.
function assinaturaSocket (cfg) {
  return JSON.stringify({
    logLevel: cfg.hardware?.logLevel,
    markOnline: cfg.hardware?.markOnline
  })
}

export async function iniciar () {
  garantirPastas()
  let cfg = carregar()
  let assinatura = assinaturaSocket(cfg)
  let falhas = 0
  let socketAtual = null
  let reiniciando = false

  // Hot-reload: a maioria do config (captura, transcrição, atualização) é lida ao
  // vivo pelos handlers via closure em `cfg`. Só reconecta quando muda algo que
  // precisa recriar o socket (logLevel, markOnline).
  observar((novo) => {
    cfg = novo
    const nova = assinaturaSocket(novo)
    if (nova !== assinatura) {
      assinatura = nova
      log('Config de conexão mudou — reconectando pra aplicar...')
      try { socketAtual?.end(new Error('reload')) } catch {}
    }
  })

  // Comando "apagar dados do número" (vindo do painel > Serviço): o painel cria
  // data/logout.request; aqui deslogamos, limpamos a sessão e saímos pra reiniciar
  // limpo (o restart policy do container / PM2 recoloca de pé pedindo novo login).
  const reqLogout = path.join(PASTA_DADOS, 'logout.request')
  const reqRestart = path.join(PASTA_DADOS, 'restart.request')
  setInterval(async () => {
    // Painel pediu refresh da lista de grupos (sem precisar reiniciar o bot).
    if (fs.existsSync(ARQ_GRUPOS_REFRESH)) {
      try { fs.unlinkSync(ARQ_GRUPOS_REFRESH) } catch {}
      if (socketAtual) {
        try { await atualizarGrupos(socketAtual) } catch (e) { log('erro atualizando grupos:', e.message) }
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
    try { await socketAtual?.logout() } catch {}
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
    const { state: authState, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO)
    const { version, isLatest } = await fetchLatestBaileysVersion()
    log(`Baileys WA v${version.join('.')} (mais recente: ${isLatest})`)

    const logger = pino({ level: cfg.hardware?.logLevel || 'silent' })
    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger)
      },
      browser: USAR_CODIGO ? Browsers.ubuntu('Chrome') : Browsers.macOS('Desktop'),
      markOnlineOnConnect: cfg.hardware?.markOnline === true,
      // NÃO desabilitar o history sync: no WhatsApp atual os remetentes vêm como
      // @lid e a Baileys precisa do sync inicial pra obter os mapeamentos LID —
      // sem eles a descriptografia das mensagens de PV falha (message = null).
      // syncFullHistory:false já mantém o sync leve (só o recente, não o arquivo todo).
      syncFullHistory: false,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: montarShouldIgnore(cfg),
      getMessage: async () => undefined
    })
    socketAtual = sock

    if (USAR_CODIGO && !sock.authState.creds.registered) {
      const numero = (await pergunta('Digite seu número com DDI (ex: 5511999999999): ')).replace(/\D/g, '')
      const codigo = await sock.requestPairingCode(numero)
      log('Código de pareamento:', codigo.match(/.{1,4}/g)?.join('-') || codigo)
    }

    sock.ev.on('creds.update', saveCreds)

    const handler = criarHandler({ sock, getConfig: () => cfg })

    sock.ev.on('contacts.upsert', registrarNomesDoDiretorio)
    sock.ev.on('contacts.update', registrarNomesDoDiretorio)

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (cfg.hardware?.debug) log(`messages.upsert type=${type} n=${messages.length}`)
      // 'notify' = tempo real; 'append' = mensagens recentes sincronizadas (também
      // podem trazer visu única que chegou enquanto reconectava).
      if (type !== 'notify' && type !== 'append') return
      for (const info of messages) {
        registrarContatoConhecido(info)
        await handler(info)
      }
    })

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr && !USAR_CODIGO) {
        qrcode.generate(qr, { small: true })   // pros logs (docker logs -f)
        state.definirQR(qr)                     // pro painel renderizar
        log('QR gerado — escaneie pelo painel (lcn > Serviço > Conectar) ou nos logs.')
      }

      if (connection === 'open') {
        falhas = 0
        state.limparQR()
        const jid = jidNormalizedUser(sock.user.id)
        log('Conectado como', jid, '-', sock.user?.name || 'sem nome')
        // Marca o dispositivo como ativo — igual aos bots de exemplo. Sem isso, o
        // dispositivo fica "offline" e remetentes podem não encriptar as mensagens
        // pra ele (erro "Message absent from node" na descriptografia).
        sock.sendPresenceUpdate('available').catch(() => {})
        atualizarGrupos(sock).catch((e) => log('erro atualizando grupos:', e.message))
        state.definirConexao({
          conectado: true,
          numero: jid.split('@')[0].split(':')[0],
          nome: sock.user?.name || null,
          desde: Date.now()
        })
      }

      if (connection === 'close') {
        state.definirConexao({ conectado: false })
        const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode
        if (motivo === DisconnectReason.loggedOut) {
          log('Sessão encerrada no celular. Apague a pasta ./sessao e reconecte.')
          state.incr('quedas')
          return
        }
        falhas++
        state.incr('quedas')
        avaliarAutoUpdate(falhas, cfg)
        const espera = Math.min(30000, 2000 * falhas)
        log(`Conexão caiu (código ${motivo}), reconectando em ${espera / 1000}s (falha ${falhas})...`)
        state.incr('reconexoes')
        setTimeout(conectar, espera)
      }
    })

    return sock
  }

  await conectar()
}

// Em queda persistente, sinaliza que a Baileys pode precisar de atualização.
function avaliarAutoUpdate (falhas, cfg) {
  const limite = cfg.atualizacao?.falhasParaUpdate || 5
  if (!cfg.atualizacao?.autoUpdateBaileys) return
  if (falhas < limite) return
  try {
    garantirPastas()
    const flag = path.join(PASTA_DADOS, 'precisa-update.flag')
    fs.writeFileSync(flag, `Quedas consecutivas: ${falhas}. Rode a atualização (update.sh/update.ps1) ou "lcn" > Atualizar.\n`)
    log('⚠️  Muitas quedas seguidas — pode ser mudança de protocolo do WhatsApp. Sinalizado update da Baileys.')
  } catch {}
}
