#!/usr/bin/env node
// Dispatcher de `lcn web <subcomando>` — ciclo de vida do painel local
// (Etapa 4.5, Módulo 4/5). Mesmo padrão de src/engine/cli.js (processo
// destacado + pidfile) — sem unit systemd por enquanto (o painel é a peça
// mais nova; instalar como serviço fica pra quando o fluxo se estabilizar).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PASTA_LCN } from '../instances/paths.js'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARQ_SERVIDOR = path.join(RAIZ, 'src', 'web', 'runServer.js')
const PASTA_WEB = path.join(PASTA_LCN, 'web')
const ARQ_PID_WEB = path.join(PASTA_WEB, 'web.pid')
const ARQ_LOG_WEB = path.join(PASTA_WEB, 'web.log')
const PORTA_PADRAO = 4780

function pidVivo (pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function pidDoArquivo () {
  try {
    const pid = parseInt(fs.readFileSync(ARQ_PID_WEB, 'utf8').trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function statusPidfile () {
  const pid = pidDoArquivo()
  if (!pid) return 'parado'
  return pidVivo(pid) ? 'rodando' : 'parado'
}

function comandoStart ({ port } = {}) {
  if (statusPidfile() === 'rodando') {
    console.log(`Painel já está rodando (pidfile). Veja ${ARQ_LOG_WEB} pra saber a porta.`)
    return
  }
  fs.mkdirSync(PASTA_WEB, { recursive: true })
  const logFd = fs.openSync(ARQ_LOG_WEB, 'a')
  const filho = spawn(process.execPath, [ARQ_SERVIDOR], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: RAIZ,
    env: { ...process.env, LCN_WEB_PORT: String(port || PORTA_PADRAO) }
  })
  filho.unref()
  fs.writeFileSync(ARQ_PID_WEB, String(filho.pid))
  console.log(`Painel iniciado (pid ${filho.pid}). http://127.0.0.1:${port || PORTA_PADRAO}`)
  console.log(`Logs em ${ARQ_LOG_WEB}.`)
}

function comandoStop () {
  const pid = pidDoArquivo()
  if (!pid || !pidVivo(pid)) {
    console.log('Painel não está rodando (pidfile ausente/obsoleto).')
    return
  }
  process.kill(pid, 'SIGTERM')
  fs.rmSync(ARQ_PID_WEB, { force: true })
  console.log(`Sinal enviado ao painel (pid ${pid}).`)
}

function comandoStatus () {
  console.log(`pidfile: ${statusPidfile()}`)
}

function uso () {
  console.log('Uso: lcn web <start|stop|status> [--port 4780]')
}

function main () {
  const [comando, ...resto] = process.argv.slice(2)
  const portaArg = resto.indexOf('--port')
  const port = portaArg !== -1 ? Number(resto[portaArg + 1]) : undefined
  switch (comando) {
    case 'start': return comandoStart({ port })
    case 'stop': return comandoStop()
    case 'status': return comandoStatus()
    case 'help':
    case '--help':
    case '-h': return uso()
    default:
      uso()
      throw new Error(comando ? `Comando desconhecido: ${comando}` : 'Informe um comando.')
  }
}

const ehCliDireta = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (ehCliDireta) {
  try {
    main()
  } catch (erro) {
    console.error(`Erro: ${erro.message}`)
    process.exitCode = 1
  }
}
