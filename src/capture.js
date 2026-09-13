// Núcleo da captura: recebe uma mensagem já descriptografada, confirma que é visu
// única, aplica as regras do config, baixa (com limite de tamanho e concorrência),
// salva, arquiva, transcreve (se áudio) e reenvia como MÍDIA NORMAL pro destino.
import fs from 'fs'
import path from 'path'
import {
  acharAudioDireto,
  acharCitacaoGenerica,
  acharComandoRecover,
  acharComandoTranscrever,
  acharVisuUnica,
  baixarBuffer,
  extensaoDe
} from './visu.js'
import { PASTA_MIDIA, garantirPastas } from './paths.js'
import * as archive from './archive.js'
import * as directoryMod from './directory.js'
import * as state from './state.js'
import { transcrever } from './transcription/index.js'
import { emitirCaptura } from './api/output.js'
import { soDigitos } from './util.js'
import { deveIgnorarJid } from './ignore.js'
import * as bandwidth from './bandwidth.js'

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a)

// jid do próprio dispositivo conectado, sem o sufixo de device (":N") — o
// jidNormalizedUser da Baileys fazia isso; o Zapo não documenta um helper
// dedicado pra credentials.meJid, então normaliza aqui mesmo.
function jidProprio (client) {
  const meJid = client.getCredentials?.()?.meJid
  return meJid ? meJid.replace(/:\d+@/, '@') : null
}

// Resolve um nome de exibição pro contato a partir do diretório conhecido
// (data/contatos.json). Usado no /recover, que não tem pushName disponível
// (a mensagem citada recuperada não carrega esse metadado — só o comando em
// si) — sem isso, o arquivado ficava com o nome do comando em vez do contato.
export function resolverNomeContato (numero) {
  const contato = directoryMod.listarContatos().find((c) => c.numero === numero)
  return contato?.nome || 'sem nome'
}

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

// Monta o payload de saída DO ZERO — só buffer/mimetype/caption, no formato de
// união discriminada do Zapo (client.message.send). Nunca reaproveita o node
// original (que traz viewOnce/mediaKey). É o que garante que a mídia sai como
// normal, não como visualização única. Exportado pra ser testável.
export function montarConteudo (tipo, buffer, legenda, node = {}) {
  if (tipo === 'image') return { type: 'image', media: buffer, caption: legenda, mimetype: node.mimetype || 'image/jpeg' }
  if (tipo === 'video') return { type: 'video', media: buffer, caption: legenda, mimetype: node.mimetype || 'video/mp4' }
  return { type: 'audio', media: buffer, mimetype: node.mimetype || 'audio/ogg; codecs=opus', ptt: !!node.ptt }
}

// Resolve o JID de destino conforme o config. Contatos em
// captura.destinoProprioContatos furam o destino global: a mídia volta na
// própria conversa (`from`) em vez de ir pro self-chat/número/grupo configurado.
export function resolverDestino (cfg, client, from, numero) {
  const proprios = (cfg.captura?.destinoProprioContatos || []).map(soDigitos)
  if (numero && from && proprios.includes(soDigitos(numero))) return from

  const d = cfg.destino || {}
  if (d.tipo === 'numero' && d.jid) return `${soDigitos(d.jid)}@s.whatsapp.net`
  if (d.tipo === 'grupo' && d.jid) return d.jid
  return jidProprio(client) // self-chat (padrão)
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

// Conversas marcadas em captura.downloadAutomatico.conversas: quando a visu
// única chega travada (sem conteúdo), o bot aguarda a próxima resposta do
// dono nessa conversa (qualquer citação, sem precisar de /recover) — ver
// criarRegistroPendentes. soDigitos cobre contatos (número); a comparação
// crua (id === jid) cobre grupo, caso a normalização por dígitos misture os
// dois pedaços do JID legado.
export function estaDownloadAutomatico (cfg, jid) {
  const num = soDigitos(jid)
  const lista = cfg.captura?.downloadAutomatico?.conversas || []
  return lista.some((id) => soDigitos(id) === num || id === jid)
}

// Resolve o identificador usado por estaDownloadAutomatico: em grupo é o
// próprio JID do grupo; em PV é o número de telefone real — participantAlt/
// remoteJidAlt têm prioridade sobre o LID cru (key.remoteJid/participant),
// que com addressingMode "lid" nunca bate com o número salvo em conversas[].
export function resolverAlvoDownloadAutomatico (key, from, ehGrupo) {
  const jidReal = key.participantAlt || key.remoteJidAlt || key.participant || from
  return ehGrupo ? from : jidReal
}

// TTL de uma pendência "visu única travada, aguardando resposta do dono".
// Passado esse tempo, uma citação nova nessa conversa não conta mais como
// recuperação implícita — evita que uma resposta não relacionada, muito
// depois, dispare um /recover implícito indesejado.
const TTL_PENDENTE_MS = 15 * 60 * 1000

// Registra conversas com visu única travada esperando que o dono responda
// citando qualquer coisa — ver recuperarCitacao, dentro de criarHandler.
// Exportada (função pura, sem I/O) pra ser testável isoladamente. `agora` é
// injetável só pra teste simular passagem de tempo sem sleep real.
export function criarRegistroPendentes (ttlMs = TTL_PENDENTE_MS, agora = Date.now) {
  const pendentes = new Map() // jid -> timestamp de quando foi marcado

  function expirou (jid) {
    const ts = pendentes.get(jid)
    if (ts === undefined) return true
    if (agora() - ts > ttlMs) { pendentes.delete(jid); return true }
    return false
  }

  return {
    marcar (jid) { pendentes.set(jid, agora()) },
    temPendente (jid) { return !expirou(jid) },
    // Só remove (e retorna true) se ainda havia pendência válida — uma
    // citação que não bate com a visu única não deve consumir a pendência.
    consumir (jid) {
      if (expirou(jid)) return false
      pendentes.delete(jid)
      return true
    }
  }
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

export function criarHandler ({ client, getConfig }) {
  let cfg = getConfig()
  const limite = criarLimite(Math.max(1, cfg.hardware?.downloadConcorrencia || 2))
  const pendentes = criarRegistroPendentes()

  // Baixa, salva, arquiva, transcreve (se áudio) e reenvia como mídia normal.
  // Compartilhado pelos dois caminhos de captura: mensagem recebida normalmente
  // e mídia recuperada via comando /recover (ver acharComandoRecover em visu.js).
  async function processarAchado ({ achado, from, ehGrupo, numero, nome, origemKey }) {
    const { node, tipo, interno } = achado

    if (!passaFiltro(cfg, numero, ehGrupo, from)) {
      state.incr('ignoradas')
      return
    }

    // Teto de tamanho — passado direto pro downloadBytes (obrigatório na API do
    // Zapo), além de servir de corte antecipado quando o nó já informa o tamanho.
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
        buffer = await baixarBuffer(client, node, tipo, maxBytes)
      } catch (e) {
        // requestMediaReupload resolve o caso de blob de CDN expirado — NÃO
        // resolve o fan-out pra dispositivo vinculado (esse é tratado antes,
        // via /recover). Fallback mantido pro caso "download normal falhou
        // por mídia expirada", equivalente ao reuploadRequest da Baileys.
        // result !== 'success' (not_found/decryption_error/general_error) é
        // resposta normal da API, não exceção — precisa ser checado (doc de
        // requestMediaReupload). Só o directPath muda; media key/hash/length
        // do node original continuam válidos, por isso o retry usa
        // { ...node, directPath } em vez do node cru.
        log('Download direto falhou, tentando reupload:', e.message)
        const retry = await client.message.requestMediaReupload({ key: origemKey, message: interno })
        // directPath é opcional no tipo mesmo com result 'success' — sem ele
        // não há o que aplicar, então trata como falha de reupload também.
        if (retry.result !== 'success' || !retry.directPath) throw new Error(`reupload ${retry.result}`)
        buffer = await baixarBuffer(client, { ...node, directPath: retry.directPath }, tipo, maxBytes)
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
      const destino = resolverDestino(cfg, client, from, numero)
      const conteudo = montarConteudo(tipo, buffer, legenda, node)

      await bandwidth.aguardarUpload(buffer.length)
      await client.message.send(destino, conteudo)
      if (tipo === 'audio') await client.message.send(destino, legenda)
      state.incr('bytesEnviados', buffer.length)

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
        const maxBytes = (cfg.hardware?.maxMidiaMB || 60) * 1048576
        const buffer = await baixarBuffer(client, node, 'audio', maxBytes)
        garantirPastas()
        arquivoTmp = path.join(PASTA_MIDIA, `.tmp-transcricao-${Date.now()}${extensaoDe('audio', node.mimetype)}`)
        fs.writeFileSync(arquivoTmp, buffer)
        const texto = await transcrever(arquivoTmp, cfg.transcricao || {})
        const resposta = texto ? `📝 ${texto}` : '⚠️ Não consegui transcrever esse áudio.'
        await client.message.send(from, resposta, { quote: mensagemCitada })
      } finally {
        if (arquivoTmp) { try { fs.unlinkSync(arquivoTmp) } catch {} }
      }
    }).catch((e) => console.error('Erro ao transcrever áudio:', e))
  }

  // Compartilhada pelo /recover explícito e pela recuperação implícita
  // (qualquer citação do dono enquanto a conversa está em `pendentes`). Extrai
  // a visu única da mensagem citada; se achar, processa como uma captura
  // normal e libera a pendência dessa conversa (se houver). Retorna
  // true/false conforme achou ou não visu única na citação.
  async function recuperarCitacao ({ quotedMessage, stanzaId, participant, from, origem }) {
    const achado = acharVisuUnica(quotedMessage, true)
    if (!achado) return false

    const ehGrupo = from.endsWith('@g.us')
    const jidReal = participant || from
    const numero = soDigitos(jidReal)
    const nome = resolverNomeContato(numero)
    const origemKey = {
      remoteJid: from,
      fromMe: false,
      id: stanzaId,
      isViewOnce: true,
      ...(participant ? { participant } : {})
    }

    log(`${origem} — recuperando visu única de ${numero}...`)
    await processarAchado({ achado, from, ehGrupo, numero, nome, origemKey })
    pendentes.consumir(from)
    return true
  }

  // Evento 'message' — mensagem já descriptografada (texto, mídia inline,
  // visu única inline, comandos citados). O caso de visu única indisponível
  // por fan-out pra dispositivo vinculado NÃO chega mais aqui — o Zapo tem
  // um evento dedicado pra isso (ver aoIndisponivel, abaixo).
  async function aoReceber (event) {
    cfg = getConfig()
    const debug = cfg.hardware?.debug === true

    if (debug) {
      const t = event.message ? Object.keys(event.message).filter((k) => k !== 'messageContextInfo')[0] : 'null'
      log(`↳ msg de=${event.key.remoteJid} fromMe=${event.key.fromMe} tipo=${t}`)
      if (!event.message) log('   DUMP:', JSON.stringify(event, (k, v) => (v && v.type === 'Buffer' ? '<buffer>' : v)).slice(0, 1500))
    }

    if (event.key.fromMe) {
      // Mensagens próprias só interessam pra dois comandos, respondidos pelo
      // dono da conta a uma mensagem citada: /recover (visu única ainda não
      // aberta) e /transcrever (áudio). O /recover é o único caminho manual
      // que de fato recupera visu única indisponível — o WhatsApp "vaza" uma
      // cópia decriptável da mídia original em contextInfo.quotedMessage da
      // própria citação.
      if (!event.message) return
      const from = event.key.remoteJid
      if (!from) return

      const comandoRecover = acharComandoRecover(event.message)
      if (comandoRecover) {
        const ok = await recuperarCitacao({ ...comandoRecover, from, origem: '/recover recebido' })
        if (!ok && debug) log('   /recover: mensagem citada não contém mídia de visualização única')
        return
      }

      const comandoTranscrever = acharComandoTranscrever(event.message)
      if (comandoTranscrever) {
        const audio = acharAudioDireto(comandoTranscrever.quotedMessage)
        if (!audio) {
          if (debug) log('   /transcrever: mensagem citada não é áudio')
          return
        }
        log('/transcrever recebido — transcrevendo áudio...')
        await processarTranscricao({ node: audio, from, mensagemCitada: event })
        return
      }

      // Recuperação implícita do download automático: só entra se a conversa
      // tem pendência marcada (visu única chegou travada com a conversa
      // marcada em downloadAutomatico) e o texto não bateu com /recover nem
      // /transcrever acima — não exige nenhum comando, só uma citação
      // qualquer (texto ou mídia respondendo a algo).
      if (pendentes.temPendente(from)) {
        const citacao = acharCitacaoGenerica(event.message)
        if (citacao) {
          const ok = await recuperarCitacao({ ...citacao, from, origem: 'Download automático: citação do dono' })
          if (!ok && debug) log('   citação do dono não é a visu única pendente — aguardando outra')
        }
      }

      return
    }

    if (!event.message) return

    const from = event.key.remoteJid
    if (!from || deveIgnorarJid(from)) return
    const ehGrupo = from.endsWith('@g.us')

    // Comando /transcrever de terceiros — só roda se a conversa (ou o padrão
    // geral) autorizar (podeComandoTerceiros). O do dono já foi tratado acima.
    const comandoTranscrever = acharComandoTranscrever(event.message)
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
      log(`/transcrever recebido de ${soDigitos(event.key.participant || from)} — transcrevendo áudio...`)
      await processarTranscricao({ node: audio, from, mensagemCitada: event })
      return
    }

    // Detecção barata (só leitura de objeto) antes de qualquer I/O.
    const achado = acharVisuUnica(event.message, event.key.isViewOnce === true)
    if (!achado) {
      // Não é visu única — ainda pode ser áudio normal de uma conversa com
      // transcrição automática ligada (transcricao.conversas[].auto).
      const audioAuto = acharAudioDireto(event.message)
      if (audioAuto && estaAutoTranscricao(cfg, from)) {
        log(`Áudio de ${soDigitos(event.key.participant || from)} — transcrição automática...`)
        await processarTranscricao({ node: audioAuto, from, mensagemCitada: event })
        return
      }
      if (debug) log(`   (não é visu única — ignorado)`)
      return
    }

    const jidReal = event.key.participantAlt || event.key.remoteJidAlt || event.key.participant || from
    const numero = soDigitos(jidReal)
    const nome = event.pushName || 'sem nome'

    await processarAchado({ achado, from, ehGrupo, numero, nome, origemKey: event.key })
  }

  // Evento 'message_unavailable' — placeholder <unavailable/> no lugar do
  // corpo criptografado. kind:'view_once' é o caso que sustenta o download
  // automático: visu única consumida/indisponível pro dispositivo vinculado.
  // Confirmado na doc do Zapo: NÃO é recuperável via resend automático (só
  // kind:'other' é) — por isso a lógica de pendências continua necessária,
  // só troca o gatilho (antes: info.key.isViewOnce && !info.message).
  async function aoIndisponivel (event) {
    cfg = getConfig()
    const debug = cfg.hardware?.debug === true
    if (event.kind !== 'view_once') return

    const from = event.key?.remoteJid
    if (!from) return
    const ehGrupo = from.endsWith('@g.us')
    const alvo = resolverAlvoDownloadAutomatico(event.key, from, ehGrupo)
    if (estaDownloadAutomatico(cfg, alvo)) {
      pendentes.marcar(from)
      if (debug) log('   visu única indisponível — download automático ativo, aguardando resposta do dono')
      return
    }
    if (debug) log('   visu única indisponível — use /recover')
  }

  return { aoReceber, aoIndisponivel }
}
