// Lê o runtime.json (gravado pelo instalador) e provê ações de serviço que
// funcionam nos dois modos: container (docker/podman) ou seco (nativo/PM2).
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { ARQ_RUNTIME, RAIZ, PASTA_DADOS } from './paths.js'

export const NOME_CONTAINER = 'LCNWhatsApp'

// Detecta se estamos rodando dentro de um container.
export function dentroDeContainer () {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv') || process.env.LCN_INCONTAINER === '1'
}

export function lerRuntime () {
  try {
    return JSON.parse(fs.readFileSync(ARQ_RUNTIME, 'utf8'))
  } catch {
    // Dentro do container o runtime.json não é montado; o launcher passa o modo
    // por variável de ambiente no `docker exec`.
    if (process.env.LCN_MODE) return { mode: process.env.LCN_MODE, engine: process.env.LCN_ENGINE || null }
    if (dentroDeContainer()) return { mode: 'docker', engine: null }
    return { mode: 'bare', engine: null }
  }
}

function roda (cmd, args) {
  const r = spawnSync(cmd, args, { cwd: RAIZ, encoding: 'utf8' })
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || ''), status: r.status }
}

// Estado do serviço: 'rodando' | 'parado' | 'desconhecido'.
export function statusServico () {
  const rt = lerRuntime()
  // Se o próprio painel está rodando dentro do container, o bot (PID 1) está de pé.
  if (dentroDeContainer()) return 'rodando'
  if (rt.mode === 'docker') {
    const eng = rt.engine || 'docker'
    const r = roda(eng, ['ps', '--filter', `name=${NOME_CONTAINER}`, '--format', '{{.Names}}'])
    if (!r.ok) return 'desconhecido'
    return r.out.includes(NOME_CONTAINER) ? 'rodando' : 'parado'
  }
  // Modo seco: tenta PM2, senão desconhecido (pode estar rodando via node direto).
  const r = roda('pm2', ['jlist'])
  if (r.ok) return r.out.includes('LCNWhatsApp') ? 'rodando' : 'parado'
  return 'desconhecido'
}

// Últimas linhas de log. Lê data/bot.log (disponível nos dois modos, inclusive
// dentro do container). Se não existir, cai pro docker/pm2.
export function logsServico (linhas = 40) {
  const arq = path.join(PASTA_DADOS, 'bot.log')
  try {
    const txt = fs.readFileSync(arq, 'utf8').trimEnd().split('\n')
    return { ok: true, out: txt.slice(-linhas).join('\n') }
  } catch {}
  const rt = lerRuntime()
  if (rt.mode === 'docker' && !dentroDeContainer()) return roda(rt.engine || 'docker', ['logs', '--tail', String(linhas), NOME_CONTAINER])
  return roda('pm2', ['logs', 'LCNWhatsApp', '--lines', String(linhas), '--nostream'])
}

// Pede ao bot pra reiniciar (sem apagar sessão). O bot detecta o flag, sai, e o
// restart policy do container / PM2 recolocam de pé. Funciona nos dois modos.
export function reiniciarBot () {
  try {
    if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true })
    fs.writeFileSync(path.join(PASTA_DADOS, 'restart.request'), String(Date.now()))
    return { ok: true, out: 'Reinício solicitado. O bot volta em alguns segundos.' }
  } catch (e) {
    return { ok: false, out: e.message }
  }
}
