// Núcleo da captura: recebe uma mensagem já descriptografada, confirma que é visu
// única, aplica as regras do config, baixa (com limite de tamanho e concorrência),
// salva, arquiva, transcreve (se áudio) e reenvia como MÍDIA NORMAL pro destino.
import fs from 'fs'
import path from 'path'
import {
  downloadMediaMessage,
  jidNormalizedUser
} from '@whiskeysockets/baileys'
import {
  acharAudioDireto,
  acharComandoRecover,
  acharComandoTranscrever,
  acharVisuUnica,
  baixarBuffer,
  extensaoDe
} from './visu.js'
import { PASTA_MIDIA, garantirPastas } from './paths.js'
import * as archive from './archive.js'
import * as state from './state.js'
import { transcrever } from './transcription/index.js'
import { emitirCaptura } from './api/output.js'
import { soDigitos } from './util.js'

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a)

// Limitador de concorrência bem simples, pra um burst não estourar CPU/RAM.
function criarLimite (max) {
  let ativos = 0
  const fila = []
  const proximo = () => {
    if (ativos >= max || fila.length === 0) return
    ativos++
    const { fn, resolve, reject } = fila.shift()
    Promise.resolve().then(fn).then(resolve, reject).finally(() => {
      ativos--
      proximo()
    })
  }
  return (fn) => new Promise((resolve, reject) => {
    fila.push({ fn, resolve, reject })
    proximo()
  })
}

// Monta o payload de saída DO ZERO — só buffer/mimetype/caption. Nunca reaproveita
// o node original (que traz viewOnce/mediaKey). É o que garante que a mídia sai
// como normal, não como visualização única. Exportado pra ser testável.
export function montarConteudo (tipo, buffer, legenda, node = {}) {
  if (tipo === 'image') return { image: buffer, caption: legenda, mimetype: node.mimetype || 'image/jpeg' }
  if (tipo === 'video') return { video: buffer, caption: legenda, mimetype: node.mimetype || 'video/mp4' }
  return { audio: buffer, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: !!node.ptt }
}

// Resolve o JID de destino conforme o config. Contatos em
// captura.destinoProprioContatos furam o destino global: a mídia volta na
// própria conversa (`from`) em vez de ir pro self-chat/número/grupo configurado.
export function resolverDestino (cfg, sock, from, numero) {
  const proprios = (cfg.captura?.destinoProprioContatos || []).map(soDigitos)
  if (numero && from && proprios.includes(soDigitos(numero))) return from

  const d = cfg.destino || {}
  if (d.tipo === 'numero' && d.jid) return `${soDigitos(d.jid)}@s.whatsapp.net`
  if (d.tipo === 'grupo' && d.jid) return d.jid
  return jidNormalizedUser(sock.user.id) // self-chat (padrão)
}

// Uma conversa pode sobrepor o padrão geral de transcricao.comandoTerceiros
// (transcricao.conversas[].comandoTerceiros: true/false) — null/ausente usa
// o padrão geral. Mesma ideia pra transcrição automática (conversas[].auto).
function buscarConversa (cfg, jid) {
  const num = soDigitos(jid)
  const conversas = cfg.transcricao?.conversas || []
  return conversas.find((c) => soDigitos(c.id) === num) || null
}

export function podeComandoTerceiros (cfg, jid) {
  const entrada = buscarConversa(cfg, jid)
  if (entrada && typeof entrada.comandoTerceiros === 'boolean') return entrada.comandoTerceiros
  return cfg.transcricao?.comandoTerceiros === true
}

export function estaAutoTranscricao (cfg, jid) {
  return !!buscarConversa(cfg, jid)?.auto
}

// Segundo filtro (pós-crypto), com o número real de telefone já disponível.
// Única linha de defesa pra "não quero capturar disso" (grupo desligado, contato
// fora da allowlist, grupo fora da allowlist de grupos, contato bloqueado) — roda
// DEPOIS da Baileys decriptar. Ver src/ignore.js sobre por que isso não vive mais
// na camada pré-crypto (shouldIgnoreJid).
export function passaFiltro (cfg, numero, ehGrupo, from) {
  const c = cfg.captura || {}
  if (ehGrupo) {
    if (!c.grupos?.ativo) return false
    const allowGrupos = c.grupos?.allowlist || []
    if (allowGrupos.length > 0 && !allowGrupos.includes(from)) return false
    return true
  }
  const block = new Set((c.blocklist || []).map(soDigitos))
  if (block.has(numero)) return false
  if (Array.isArray(c.contatos)) {
    const allow = new Set(c.contatos.map(soDigitos))
    if (!allow.has(numero)) return false
  }
  return true
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

// Tenta pedir o conteúdo da visu única de novo, algumas vezes, espaçado — a
// Baileys já dá timeout sozinha em 8s por tentativa; aqui só repetimos o pedido
// caso a primeira (ou segunda) não seja respondida a tempo. Roda em background,
// não bloqueia o processamento de outras mensagens.
async function tentarPlaceholderResend (sock, key, log, tentativas = 4, esperaMs = 20000) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await sock.requestPlaceholderResend(key)
      log?.(`   visu única indisponível — solicitado reenvio ao telefone (tentativa ${i}/${tentativas})`)
    } catch (e) {
      log?.(`   falha ao solicitar reenvio (tentativa ${i}/${tentativas}):`, e.message)
    }
    if (i < tentativas) await sleepMs(esperaMs)
  }
}

export function criarHandler ({ sock, getConfig }) {
  let cfg = getConfig()
  const limite = criarLimite(Math.max(1, cfg.hardware?.downloadConcorrencia || 2))

  // Baixa, salva, arquiva, transcreve (se áudio) e reenvia como mídia normal.
  // Compartilhado pelos dois caminhos de captura: mensagem recebida normalmente
  // e mídia recuperada via comando /recover (ver acharComandoRecover em visu.js).
  async function processarAchado ({ achado, from, ehGrupo, numero, nome, origemKey }) {
    const { node, tipo, interno } = achado

    if (!passaFiltro(cfg, numero, ehGrupo, from)) {
      state.incr('ignoradas')
      return
    }

    // Teto de tamanho, quando o nó informa o tamanho.
    // fileLength pode vir como Long (protobuf); toString() normaliza.
    const maxBytes = (cfg.hardware?.maxMidiaMB || 60) * 1048576
    const tam = node.fileLength ? Number(node.fileLength.toString()) || 0 : 0
    if (tam && tam > maxBytes) {
      log(`Visu única (${tipo}) de ${nome} ignorada: ${Math.round(tam / 1048576)}MB > limite`)
      state.incr('ignoradas')
      return
    }

    await limite(async () => {
      log(`Visu única (${tipo}) de ${nome} (${numero}) — baixando...`)
      let buffer
      try {
        buffer = await baixarBuffer(node, tipo)
      } catch (e) {
        log('Download direto falhou, tentando reupload:', e.message)
        buffer = await downloadMediaMessage(
          { key: origemKey, message: interno },
          'buffer',
          {},
          { reuploadRequest: sock.updateMediaMessage }
        )
      }

      garantirPastas()
      const arquivo = path.join(PASTA_MIDIA, `${Date.now()}_${numero}${extensaoDe(tipo, node.mimetype)}`)
      fs.writeFileSync(arquivo, buffer)

      // Transcrição é extra: se falhar/estiver off, segue sem ela.
      let texto = null
      if (tipo === 'audio') texto = await transcrever(arquivo, cfg.transcricao || {})

      const item = archive.registrar({ tipo, numero, nome, caption: node.caption, arquivo, transcricao: texto })
      emitirCaptura({ ...item, arquivoAbs: arquivo })

      const legenda = [
        '👁 *VISUALIZAÇÃO ÚNICA CAPTURADA*',
        '',
        `👤 Nome: ${nome}`,
        `📱 Número: wa.me/${numero}`,
        `🗂 Tipo: ${tipo}`,
        ehGrupo ? '👥 Origem: grupo' : null,
        node.caption ? `💬 Legenda: ${node.caption}` : null,
        texto ? `📝 Transcrição: ${texto}` : null,
        `🕒 ${new Date().toLocaleString('pt-BR')}`
      ].filter(Boolean).join('\n')

      // Payload montado do zero: SEM viewOnce. Sai como mídia normal.
      const destino = resolverDestino(cfg, sock, from, numero)
      const conteudo = montarConteudo(tipo, buffer, legenda, node)

      await sock.sendMessage(destino, conteudo)
      if (tipo === 'audio') await sock.sendMessage(destino, { text: legenda })

      state.marcarCaptura()
      log(`Enviado como mídia normal ✅  (arquivado: ${path.basename(arquivo)})`)
    }).catch((e) => console.error('Erro ao capturar visu única:', e))
  }

  // Baixa um áudio comum (não precisa ser visualização única), transcreve e
  // responde o texto na própria conversa — usado pelo comando /transcrever
  // e pela transcrição automática por conversa (transcricao.conversas[].auto).
  // O arquivo de áudio é temporário: some depois da transcrição (não é uma
  // "captura" arquivada, é só um passo intermediário).
  async function processarTranscricao ({ node, from, mensagemCitada }) {
    await limite(async () => {
      let arquivoTmp = null
      try {
        const buffer = await baixarBuffer(node, 'audio')
        garantirPastas()
        arquivoTmp = path.join(PASTA_MIDIA, `.tmp-transcricao-${Date.now()}${extensaoDe('audio', node.mimetype)}`)
        fs.writeFileSync(arquivoTmp, buffer)
        const texto = await transcrever(arquivoTmp, cfg.transcricao || {})
        const resposta = texto ? `📝 ${texto}` : '⚠️ Não consegui transcrever esse áudio.'
        await sock.sendMessage(from, { text: resposta }, { quoted: mensagemCitada })
      } finally {
        if (arquivoTmp) { try { fs.unlinkSync(arquivoTmp) } catch {} }
      }
    }).catch((e) => console.error('Erro ao transcrever áudio:', e))
  }

  return async function aoReceber (info) {
    cfg = getConfig()
    const debug = cfg.hardware?.debug === true

    if (debug) {
      const t = info.message ? Object.keys(info.message).filter((k) => k !== 'messageContextInfo')[0] : 'null'
      log(`↳ msg de=${info.key.remoteJid} fromMe=${info.key.fromMe} tipo=${t} isViewOnce=${info.key.isViewOnce} stub=${info.messageStubType}`)
      if (!info.message || info.key.isViewOnce) {
        log('   DUMP:', JSON.stringify(info, (k, v) => (v && v.type === 'Buffer' ? '<buffer>' : v)).slice(0, 1500))
      }
    }

    if (info.key.fromMe) {
      // Mensagens próprias só interessam pra dois comandos, respondidos pelo
      // dono da conta a uma mensagem citada: /recover (visu única ainda não
      // aberta) e /transcrever (áudio). O /recover é o caminho que de fato
      // recupera visu única — a entrega automática (placeholder resend
      // abaixo) não é confiável; o WhatsApp "vaza" uma cópia decriptável da
      // mídia original em contextInfo.quotedMessage da própria citação.
      if (!info.message) return
      const from = info.key.remoteJid
      if (!from) return

      const comandoRecover = acharComandoRecover(info.message)
      if (comandoRecover) {
        const ehGrupo = from.endsWith('@g.us')
        const achado = acharVisuUnica(comandoRecover.quotedMessage, true)
        if (!achado) {
          if (debug) log('   /recover: mensagem citada não contém mídia de visualização única')
          return
        }

        const jidReal = comandoRecover.participant || from
        const numero = soDigitos(jidReal)
        const origemKey = {
          remoteJid: from,
          fromMe: false,
          id: comandoRecover.stanzaId,
          isViewOnce: true,
          ...(comandoRecover.participant ? { participant: comandoRecover.participant } : {})
        }

        log(`/recover recebido — recuperando visu única de ${numero}...`)
        await processarAchado({
          achado,
          from,
          ehGrupo,
          numero,
          nome: 'recuperado via /recover',
          origemKey
        })
        return
      }

      const comandoTranscrever = acharComandoTranscrever(info.message)
      if (comandoTranscrever) {
        const audio = acharAudioDireto(comandoTranscrever.quotedMessage)
        if (!audio) {
          if (debug) log('   /transcrever: mensagem citada não é áudio')
          return
        }
        log('/transcrever recebido — transcrevendo áudio...')
        await processarTranscricao({ node: audio, from, mensagemCitada: info })
        return
      }

      return
    }

    // Visu única chega pra dispositivos vinculados como "view_once_unavailable_fanout":
    // o conteúdo NÃO vem inline e a Baileys oficial (rc) pula a requisição dele. Aqui
    // fazemos o que o fork faz: pedir o conteúdo ao telefone (placeholder resend). Ele
    // volta decifrado num próximo upsert (type:'notify') e aí a captura acontece normal.
    //
    // Uma única tentativa costuma dar timeout em 8s (visto em testes ao vivo, com PV e
    // grupo, remetentes diferentes, sessão/LID saudáveis) — o app do remetente parece só
    // responder quando está em primeiro plano no momento exato do pedido. Por isso
    // repetimos o pedido algumas vezes, espaçado, em background (sem travar o handler).
    // Best-effort apenas, e desligado por padrão (evidência real: 0 sucessos
    // em produção) — ligue captura.hardware.placeholderResend se quiser
    // reativar. Quando isso não recuperar a mídia, use o comando /recover.
    if (info.key.isViewOnce && !info.message) {
      if (cfg.hardware?.placeholderResend === true) {
        tentarPlaceholderResend(sock, info.key, debug ? log : null)
      } else if (debug) {
        log('   visu única indisponível — placeholder resend desligado (use /recover)')
      }
      return
    }

    if (!info.message) return

    const from = info.key.remoteJid
    if (!from || from === 'status@broadcast' || from.endsWith('@broadcast') || from.endsWith('@newsletter')) return
    const ehGrupo = from.endsWith('@g.us')

    // Comando /transcrever de terceiros — só roda se a conversa (ou o padrão
    // geral) autorizar (podeComandoTerceiros). O do dono já foi tratado acima.
    const comandoTranscrever = acharComandoTranscrever(info.message)
    if (comandoTranscrever) {
      if (!podeComandoTerceiros(cfg, from)) {
        if (debug) log('   /transcrever ignorado (terceiros não autorizados nesta conversa)')
        return
      }
      const audio = acharAudioDireto(comandoTranscrever.quotedMessage)
      if (!audio) {
        if (debug) log('   /transcrever: mensagem citada não é áudio')
        return
      }
      log(`/transcrever recebido de ${soDigitos(info.key.participant || from)} — transcrevendo áudio...`)
      await processarTranscricao({ node: audio, from, mensagemCitada: info })
      return
    }

    // Detecção barata (só leitura de objeto) antes de qualquer I/O.
    const achado = acharVisuUnica(info.message, info.key.isViewOnce === true)
    if (!achado) {
      // Não é visu única — ainda pode ser áudio normal de uma conversa com
      // transcrição automática ligada (transcricao.conversas[].auto).
      const audioAuto = acharAudioDireto(info.message)
      if (audioAuto && estaAutoTranscricao(cfg, from)) {
        log(`Áudio de ${soDigitos(info.key.participant || from)} — transcrição automática...`)
        await processarTranscricao({ node: audioAuto, from, mensagemCitada: info })
        return
      }
      if (debug) log(`   (não é visu única — ignorado)`)
      return
    }

    const jidReal = info.key.participantAlt || info.key.remoteJidAlt || info.key.participant || from
    const numero = soDigitos(jidReal)
    const nome = info.pushName || 'sem nome'

    await processarAchado({ achado, from, ehGrupo, numero, nome, origemKey: info.key })
  }
}
