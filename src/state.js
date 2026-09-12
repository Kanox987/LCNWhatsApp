// Estado compartilhado entre o bot e o dashboard (data/state.json).
// O bot escreve; o dashboard lê. Comunicação simples via arquivo, funciona igual
// em container (volume) ou seco.
import fs from 'fs'
import { ARQ_ESTADO, garantirPastas } from './paths.js'

const SAUDE_INICIAL = { falhasConsecutivas: 0, ultimoSucessoEm: null, status: 'ok', motivo: null, desde: null }

const INICIAL = {
  conectado: false,
  numero: null,
  nome: null,
  desde: null,
  pid: process.pid,
  iniciadoEm: Date.now(),
  metricas: {
    reconexoes: 0,
    quedas: 0,
    processadas: 0,   // visu única capturada e reenviada
    ignoradas: 0,     // (aprox.) mensagens que chegaram ao handler e foram descartadas
    ultimaCaptura: null
  },
  // saude.falhasConsecutivas é persistido (não só uma variável em memória em
  // connection.js) de propósito: precisa sobreviver a reinícios de processo
  // pra "N falhas seguidas sem sucesso" contar direito mesmo num ciclo
  // crash-restart-crash, não só dentro de uma única execução.
  saude: { ...SAUDE_INICIAL }
}

// Carrega saude.* do state.json existente, se houver — o resto de INICIAL
// (pid, iniciadoEm, métricas) reseta a cada boot de propósito, mas
// falhasConsecutivas PRECISA sobreviver a reinícios de processo (é o que dá
// sentido a "N falhas seguidas sem sucesso" cobrir um ciclo
// crash-restart-crash, não só uma execução). Sem isso, index.js chamando
// gravar() logo no boot sobrescreveria qualquer saude.* persistido com zero
// antes mesmo de iniciar() rodar — bug real encontrado em revisão de código.
function carregarSaudePersistida () {
  try {
    const bruto = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'))
    if (bruto?.saude && typeof bruto.saude === 'object') return { ...SAUDE_INICIAL, ...bruto.saude }
  } catch {}
  return { ...SAUDE_INICIAL }
}

let estado = { ...INICIAL, metricas: { ...INICIAL.metricas }, saude: carregarSaudePersistida() }
let timer = null

function agendarFlush () {
  clearTimeout(timer)
  timer = setTimeout(gravar, 250)
}

export function gravar () {
  try {
    garantirPastas()
    estado.memoriaMB = Math.round(process.memoryUsage().rss / 1048576)
    estado.atualizadoEm = Date.now()
    fs.writeFileSync(ARQ_ESTADO, JSON.stringify(estado, null, 2) + '\n')
  } catch {}
}

export function definirConexao (info) {
  estado = { ...estado, ...info }
  agendarFlush()
}

// QR atual (string) pro painel renderizar. Limpo ao conectar.
export function definirQR (qr) {
  estado.qr = qr
  estado.qrEm = Date.now()
  gravar()
}

export function limparQR () {
  estado.qr = null
  estado.qrEm = null
  agendarFlush()
}

export function incr (chave, n = 1) {
  if (estado.metricas[chave] === undefined) estado.metricas[chave] = 0
  estado.metricas[chave] += n
  agendarFlush()
}

export function marcarCaptura () {
  estado.metricas.processadas += 1
  estado.metricas.ultimaCaptura = Date.now()
  agendarFlush()
}

// Zera o contador de falhas consecutivas — só em conexão de verdade
// (status:'open'), nunca só por "o processo começou". É o que fecha o
// contador entre reinícios: sem sucesso real no meio, falhas de processos
// diferentes continuam somando rumo à quarentena.
export function registrarSucessoConexao () {
  estado.saude = { falhasConsecutivas: 0, ultimoSucessoEm: Date.now(), status: 'ok', motivo: null, desde: null }
  gravar()
}

// Retorna o contador atualizado (não só grava) de propósito: agendarFlush()
// é debounced (250ms) — quem chama isto e precisa decidir algo com o valor
// NA HORA (ex: já bateu o limiar de quarentena?) não pode confiar em
// state.ler() logo em seguida, porque o arquivo em disco ainda não foi
// atualizado (bug real encontrado em revisão de código — state.ler() sempre
// via ver o valor anterior nesse caso).
export function registrarFalhaConexao () {
  estado.saude = { ...estado.saude, falhasConsecutivas: (estado.saude?.falhasConsecutivas || 0) + 1 }
  agendarFlush()
  return estado.saude.falhasConsecutivas
}

// status: 'ok' | 'logout' | 'conflito' | 'fatal_account' | 'quarentena'.
export function definirSaude ({ status, motivo, desde }) {
  estado.saude = { ...estado.saude, status, motivo, desde }
  gravar()
}

export function ler () {
  try {
    return JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'))
  } catch {
    return null
  }
}
