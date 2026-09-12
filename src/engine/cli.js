#!/usr/bin/env node
// Dispatcher de `lcn engine <subcomando>` — ciclo de vida do lcn-engine
// (Parte B, Etapa 2 do plano de automação). O motor em si (server/index.js)
// já é auto-suficiente (abre o banco, sobe o transport, grava/limpa seu
// próprio pidfile) — este CLI só sabe start/stop/status/install por fora,
// mesmo padrão de src/runtime.js (iniciarBot/pararBot/statusPeloPid), só
// que apontando pros caminhos do motor (src/engine/paths.js) em vez dos do
// bot por número.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { PASTA_ENGINE, ARQ_PID_ENGINE, SOCKET_PATH, ARQ_LOG_ENGINE } from './paths.js'
import { criarClienteEngine } from './client.js'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARQ_SERVIDOR = path.join(RAIZ, 'src', 'engine', 'server', 'index.js')
const PASTA_UNIT_SYSTEMD = path.join(os.homedir(), '.config', 'systemd', 'user')
const ARQ_UNIT_ENGINE = path.join(PASTA_UNIT_SYSTEMD, 'lcn-engine.service')

function executarCapturando (cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: r.status === 0 && !r.error, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', erro: r.error }
}

function temSystemdUser () {
  // Checagem simples e barata: systemctl existe e responde no modo --user.
  // Não é definitivo (systemd pode existir sem sessão de usuário ativa),
  // mas cobre o caso comum sem custo de spawnar processo pesado.
  const r = executarCapturando('systemctl', ['--user', 'show-environment'])
  return r.ok
}

function pidVivo (pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function pidDoArquivo () {
  try {
    const pid = parseInt(fs.readFileSync(ARQ_PID_ENGINE, 'utf8').trim(), 10)
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

// install: gera a unit systemd --user (comum, NÃO Quadlet — o motor não é
// container, não precisa de fronteira nenhuma, só Node + better-sqlite3).
function comandoInstall () {
  fs.mkdirSync(PASTA_UNIT_SYSTEMD, { recursive: true })
  const unit = `[Unit]
Description=LCNWhatsApp automation engine (lcn-engine)
After=network.target

[Service]
Type=simple
ExecStart=${process.execPath} ${ARQ_SERVIDOR}
Restart=on-failure
RestartSec=3
StandardOutput=append:${ARQ_LOG_ENGINE}
StandardError=append:${ARQ_LOG_ENGINE}

[Install]
WantedBy=default.target
`
  fs.mkdirSync(PASTA_ENGINE, { recursive: true })
  fs.writeFileSync(ARQ_UNIT_ENGINE, unit)
  console.log(`Unit gerada em ${ARQ_UNIT_ENGINE}.`)
  if (!temSystemdUser()) {
    console.log('AVISO: não detectei systemd --user disponível agora. Em Linux com systemd, rode:')
  } else {
    console.log('Próximos passos:')
  }
  console.log('  systemctl --user daemon-reload')
  console.log('  systemctl --user enable --now lcn-engine.service')
  console.log('Fora de Linux+systemd, use "lcn engine start" (processo destacado + pidfile) em vez disso.')
}

function comandoStart () {
  if (temSystemdUser() && fs.existsSync(ARQ_UNIT_ENGINE)) {
    const r = executarCapturando('systemctl', ['--user', 'start', 'lcn-engine.service'])
    if (!r.ok) throw new Error(`Falha ao iniciar via systemctl: ${(r.stderr || r.stdout).trim() || r.erro?.message}`)
    console.log('Motor iniciado via systemd --user.')
    return
  }
  if (statusPidfile() === 'rodando') {
    console.log('Motor já está rodando (pidfile).')
    return
  }
  fs.mkdirSync(PASTA_ENGINE, { recursive: true })
  const logFd = fs.openSync(ARQ_LOG_ENGINE, 'a')
  const filho = spawn(process.execPath, [ARQ_SERVIDOR], { detached: true, stdio: ['ignore', logFd, logFd], cwd: RAIZ })
  filho.unref()
  console.log(`Motor iniciado (pid ${filho.pid}, processo destacado — sem systemd --user disponível).`)
}

function comandoStop () {
  if (temSystemdUser() && fs.existsSync(ARQ_UNIT_ENGINE)) {
    const r = executarCapturando('systemctl', ['--user', 'stop', 'lcn-engine.service'])
    if (!r.ok) throw new Error(`Falha ao parar via systemctl: ${(r.stderr || r.stdout).trim() || r.erro?.message}`)
    console.log('Motor parado via systemd --user.')
    return
  }
  const pid = pidDoArquivo()
  if (!pid || !pidVivo(pid)) {
    console.log('Motor não está rodando (pidfile ausente/obsoleto).')
    return
  }
  process.kill(pid, 'SIGTERM')
  console.log(`Sinal enviado ao motor (pid ${pid}).`)
}

async function comandoStatus () {
  if (temSystemdUser() && fs.existsSync(ARQ_UNIT_ENGINE)) {
    const r = executarCapturando('systemctl', ['--user', 'is-active', 'lcn-engine.service'])
    console.log(`systemd: ${r.stdout.trim() || 'desconhecido'}`)
  } else {
    console.log(`pidfile: ${statusPidfile()}`)
  }
  try {
    const cliente = criarClienteEngine({ socketPath: SOCKET_PATH })
    const saude = await cliente.saude()
    console.log(`socket: respondendo (${JSON.stringify(saude)})`)
  } catch (erro) {
    console.log(`socket: ${erro.message}`)
  }
}

function uso () {
  console.log('Uso: lcn engine <install|start|stop|status>')
}

async function main () {
  const [comando] = process.argv.slice(2)
  switch (comando) {
    case 'install': return comandoInstall()
    case 'start': return comandoStart()
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
  main().catch((erro) => {
    console.error(`Erro: ${erro.message}`)
    process.exitCode = 1
  })
}
