// Máquina de estados formal da conexão WhatsApp.
//
// Substitui o booleano `conectado` como fonte primária de verdade sobre o
// vínculo com o WhatsApp. O campo `conectado` continua sendo escrito em
// state.json para compatibilidade com consumidores antigos (dashboard
// terminal, health checks), mas as transições, o ETag e a lógica de
// "precisa re-renderizar?" vêm daqui.
//
// Os estados são explícitos e as transições validadas: não existe caminho
// de `terminal` para `connected` sem passar por uma nova sessão, nem de
// `qr_ready` direto para `reconnecting` sem perder o QR antes. Isto evita
// o ciclo de re-render agressivo que invalidava a tela a cada poll de 4s
// mesmo sem mudança real — o ETag só avança quando há transição genuína.
//
// O contador de transições (`versao`) é o núcleo do ETag. Ele sobrevive a
// reinícios do processo porque é persistido junto com o snapshot em
// state.json e restaurado no boot. Sem isto, cada restart zeraria o
// contador e o frontend veria um ETag "novo" sem nenhuma mudança real,
// invalidando o cache à toa.

import { createHash } from 'crypto'

export const ESTADOS = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  QR_READY: 'qr_ready',
  PAIRING_CODE_READY: 'pairing_code_ready',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  QUARANTINED: 'quarantined',
  TERMINAL: 'terminal'
})

// Estados terminais: exigem intervenção manual (novo pareamento,
// reconfiguração). O frontend para de fazer poll assim que vê um destes.
const ESTADOS_TERMINAIS = new Set([ESTADOS.TERMINAL, ESTADOS.QUARANTINED])

// Transições permitidas. Chave = estado atual; valor = conjunto de estados
// alcançáveis. Qualquer transição fora desta tabela é ignorada (não lança
// erro) porque o bot pode receber eventos fora de ordem durante shutdown
// ou reconexão rápida — logar e seguir é mais seguro que travar.
const TRANSICOES = Object.freeze({
  [ESTADOS.IDLE]: new Set([ESTADOS.CONNECTING, ESTADOS.QR_READY, ESTADOS.PAIRING_CODE_READY, ESTADOS.TERMINAL]),
  [ESTADOS.CONNECTING]: new Set([ESTADOS.QR_READY, ESTADOS.PAIRING_CODE_READY, ESTADOS.CONNECTED, ESTADOS.RECONNECTING, ESTADOS.TERMINAL]),
  [ESTADOS.QR_READY]: new Set([ESTADOS.CONNECTED, ESTADOS.RECONNECTING, ESTADOS.QR_READY, ESTADOS.TERMINAL]),
  [ESTADOS.PAIRING_CODE_READY]: new Set([ESTADOS.CONNECTED, ESTADOS.RECONNECTING, ESTADOS.PAIRING_CODE_READY, ESTADOS.TERMINAL]),
  [ESTADOS.CONNECTED]: new Set([ESTADOS.RECONNECTING, ESTADOS.TERMINAL, ESTADOS.QUARANTINED]),
  [ESTADOS.RECONNECTING]: new Set([ESTADOS.CONNECTING, ESTADOS.QR_READY, ESTADOS.PAIRING_CODE_READY, ESTADOS.CONNECTED, ESTADOS.QUARANTINED, ESTADOS.TERMINAL]),
  [ESTADOS.QUARANTINED]: new Set(), // sink — só reset manual
  [ESTADOS.TERMINAL]: new Set()     // sink — só novo pareamento
})

function hashQr (qr) {
  if (!qr) return null
  return createHash('sha256').update(String(qr)).digest('hex').slice(0, 16)
}

export function criarMaquinaDeEstados () {
  let estado = ESTADOS.IDLE
  let versao = 0
  let desde = Date.now()
  let motivo = null
  let qrHash = null
  let codigoHash = null
  let falhasConsecutivas = 0

  function snapshot () {
    return {
      estado,
      versao,
      desde,
      motivo,
      qrHash,
      codigoHash,
      falhasConsecutivas,
      etag: `"v${versao}-${estado}"`,
      terminal: ESTADOS_TERMINAIS.has(estado)
    }
  }

  function transicionarPara (proximo, novoMotivo = null) {
    if (proximo === estado && novoMotivo === motivo) return false
    const permitidos = TRANSICOES[estado]
    if (permitidos && !permitidos.has(proximo)) {
      // Transição inválida: ignora silenciosamente. O bot pode receber
      // eventos fora de ordem durante shutdown/reconexão rápida; lançar
      // erro aqui quebraria o fluxo de conexão por causa de um race.
      if (process.env.LCN_DEBUG_TRANSITIONS || process.env.DEBUG?.includes('transitions')) {
        console.debug(
          `[stateMachine] transição inválida ignorada: ${estado} -> ${proximo} ` +
          `(válidas: ${[...permitidos].join(', ') || 'nenhuma'})`
        )
      }
      return false
    }
    estado = proximo
    versao += 1
    desde = Date.now()
    motivo = novoMotivo ?? null
    if (ESTADOS_TERMINAIS.has(proximo)) {
      // Terminal/quarantined limpa credenciais de pareamento — elas não
      // valem mais e deixá-las no snapshot faria o frontend mostrar um
      // QR/code stale num estado que exige ação manual.
      qrHash = null
      codigoHash = null
    }
    return true
  }

  function definirQR (qr) {
    const novo = hashQr(qr)
    if (novo === qrHash && estado === ESTADOS.QR_READY) return false
    qrHash = novo
    return transicionarPara(ESTADOS.QR_READY, 'qr_recebido')
  }

  function definirCodigoPareamento (codigo) {
    const novo = codigo ? hashQr(codigo) : null
    if (novo === codigoHash && estado === ESTADOS.PAIRING_CODE_READY) return false
    codigoHash = novo
    return transicionarPara(ESTADOS.PAIRING_CODE_READY, 'codigo_pareamento_recebido')
  }

  function marcarConectado () {
    falhasConsecutivas = 0
    qrHash = null
    codigoHash = null
    return transicionarPara(ESTADOS.CONNECTED, 'conexao_aberta')
  }

  function marcarReconectando (motivoReconexao = null) {
    falhasConsecutivas += 1
    return transicionarPara(ESTADOS.RECONNECTING, motivoReconexao || 'conexao_fechada')
  }

  function marcarQuarentena (motivoQuarentena = null) {
    return transicionarPara(ESTADOS.QUARANTINED, motivoQuarentena || 'falhas_consecutivas')
  }

  function marcarTerminal (motivoTerminal = null) {
    return transicionarPara(ESTADOS.TERMINAL, motivoTerminal || 'erro_terminal')
  }

  function limparCredenciaisPareamento () {
    const mudou = qrHash !== null || codigoHash !== null
    qrHash = null
    codigoHash = null
    return mudou
  }

  // Restaura o snapshot persistido em state.json no boot. O contador de
  // transições (versao) e o ETag sobrevivem a reinícios do processo —
  // sem isto, cada restart geraria um ETag "novo" sem mudança real e o
  // frontend invalidaria o cache à toa.
  function restaurar (snapshotPersistido) {
    if (!snapshotPersistido || typeof snapshotPersistido !== 'object') return
    if (typeof snapshotPersistido.estado === 'string' && Object.values(ESTADOS).includes(snapshotPersistido.estado)) {
      estado = snapshotPersistido.estado
    }
    if (Number.isInteger(snapshotPersistido.versao) && snapshotPersistido.versao >= 0) {
      versao = snapshotPersistido.versao
    }
    if (Number.isFinite(snapshotPersistido.desde)) {
      desde = snapshotPersistido.desde
    }
    motivo = snapshotPersistido.motivo ?? null
    qrHash = snapshotPersistido.qrHash ?? null
    codigoHash = snapshotPersistido.codigoHash ?? null
    if (Number.isInteger(snapshotPersistido.falhasConsecutivas) && snapshotPersistido.falhasConsecutivas >= 0) {
      falhasConsecutivas = snapshotPersistido.falhasConsecutivas
    }
  }

  return {
    snapshot,
    restaurar,
    definirQR,
    definirCodigoPareamento,
    marcarConectado,
    marcarReconectando,
    marcarQuarentena,
    marcarTerminal,
    limparCredenciaisPareamento
  }
}