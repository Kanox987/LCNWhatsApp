// Estado compartilhado entre o bot e o dashboard (data/state.json).
// O bot escreve; o dashboard lê. Comunicação simples via arquivo, funciona igual
// em container (volume) ou seco.
import fs from 'fs'
import { ARQ_ESTADO, garantirPastas } from './paths.js'

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
  }
}

let estado = { ...INICIAL, metricas: { ...INICIAL.metricas } }
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

export function ler () {
  try {
    return JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'))
  } catch {
    return null
  }
}
