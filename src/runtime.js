// Lê o runtime.json (gravado pelo instalador) e provê ações de serviço que
// funcionam nos dois modos: container (docker/podman) ou seco (nativo/PM2).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, spawnSync } from 'child_process'
import { ARQ_RUNTIME, RAIZ, PASTA_DADOS } from './paths.js'

const ARQ_PID_BOT = path.join(PASTA_DADOS, 'bot.pid')

function pidVivo (pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

// Lê data/bot.pid (escrito pelo próprio index.js ao iniciar — ver lá) e
// confere se o processo ainda existe. Só passa a existir depois que o bot
// roda pelo menos uma vez com essa gravação — em qualquer outro caso (Linux
// de antes desta mudança, Docker, PM2) o arquivo simplesmente não existe e
// os caminhos abaixo caem no comportamento de sempre.
function statusPeloPid () {
  if (!fs.existsSync(ARQ_PID_BOT)) return null
  const pid = parseInt(fs.readFileSync(ARQ_PID_BOT, 'utf8').trim(), 10)
  if (!pid) return null
  return pidVivo(pid) ? 'rodando' : 'parado'
}

export const NOME_CONTAINER = 'LCNWhatsApp'

// Config padrão de runtime.json quando o campo (ou o arquivo inteiro) não
// existe ainda — "econômico" (512m/1 CPU), transcrição local desligada.
// memory/cpus === null (explícito, não ausente) significa "sem limites".
export const PADRAO_RUNTIME = {
  mode: 'bare',
  engine: null,
  container: { memory: '512m', cpus: '1.0' },
  transcricaoLocal: { instalada: false, modelo: 'base' }
}

// Detecta se estamos rodando dentro de um container.
export function dentroDeContainer () {
  return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv') || process.env.LCN_INCONTAINER === '1'
}

// Migra/normaliza um runtime.json cru: preenche campos novos (container,
// transcricaoLocal) que faltarem num arquivo antigo, sem nunca resetar um
// valor já presente — inclusive `null` explícito (memory/cpus "sem limites").
export function normalizarRuntime (bruto) {
  const rt = bruto && typeof bruto === 'object' ? bruto : {}
  const container = rt.container && typeof rt.container === 'object' ? rt.container : {}
  const transcricaoLocal = rt.transcricaoLocal && typeof rt.transcricaoLocal === 'object' ? rt.transcricaoLocal : {}
  return {
    mode: rt.mode || PADRAO_RUNTIME.mode,
    engine: rt.engine ?? null,
    container: {
      memory: 'memory' in container ? container.memory : PADRAO_RUNTIME.container.memory,
      cpus: 'cpus' in container ? container.cpus : PADRAO_RUNTIME.container.cpus
    },
    transcricaoLocal: {
      instalada: typeof transcricaoLocal.instalada === 'boolean' ? transcricaoLocal.instalada : PADRAO_RUNTIME.transcricaoLocal.instalada,
      modelo: transcricaoLocal.modelo || PADRAO_RUNTIME.transcricaoLocal.modelo
    }
  }
}

export function lerRuntime () {
  try {
    return normalizarRuntime(JSON.parse(fs.readFileSync(ARQ_RUNTIME, 'utf8')))
  } catch {
    // Dentro do container o runtime.json não é montado; o launcher passa o modo
    // por variável de ambiente no `docker exec`.
    if (process.env.LCN_MODE) return normalizarRuntime({ mode: process.env.LCN_MODE, engine: process.env.LCN_ENGINE || null })
    if (dentroDeContainer()) return normalizarRuntime({ mode: 'docker' })
    return normalizarRuntime({ mode: 'bare' })
  }
}

export function salvarRuntime (rt) {
  const normalizado = normalizarRuntime(rt)
  fs.writeFileSync(ARQ_RUNTIME, JSON.stringify(normalizado, null, 2) + '\n')
  return normalizado
}

// Qual Dockerfile usar, conforme a transcrição local estar instalada ou não.
export function dockerfileEscolhido (rt) {
  return rt?.transcricaoLocal?.instalada ? 'Dockerfile.whisper' : 'Dockerfile'
}

// Argumentos --memory/--cpus pro `docker run`/`podman run`. "Sem limites"
// (memory/cpus null) omite ambos — nunca passa 0.
export function argsRecursos (container) {
  const args = []
  if (container?.memory) args.push('--memory', String(container.memory))
  if (container?.cpus) args.push('--cpus', String(container.cpus))
  return args
}

// Bind mount do diretório de modelos persistente, só quando a transcrição
// local está instalada (evita montar/criar a pasta à toa).
export function argMontagemModelos (transcricaoLocal, raizAbs = RAIZ) {
  if (!transcricaoLocal?.instalada) return []
  return ['-v', `${raizAbs}/modelos:/opt/lcn-modelos`]
}

// Conteúdo do docker-compose.override.yml gerado a partir do runtime.json —
// limites de recurso e volume de modelos só aparecem quando definidos.
export function composeOverride (rt) {
  const linhas = [
    '# Gerado automaticamente a partir de runtime.json pelo install.sh/update.sh.',
    '# Não editar à mão — rode o instalador/atualizador de novo pra mudar.',
    'services:',
    '  lcnwhatsapp:',
    '    build:',
    `      dockerfile: ${dockerfileEscolhido(rt)}`
  ]
  const limites = []
  if (rt.container?.memory) limites.push(`          memory: ${rt.container.memory}`)
  if (rt.container?.cpus) limites.push(`          cpus: "${rt.container.cpus}"`)
  if (limites.length) {
    linhas.push('    deploy:', '      resources:', '        limits:', ...limites)
  }
  if (rt.transcricaoLocal?.instalada) {
    linhas.push('    volumes:', '      - ./modelos:/opt/lcn-modelos')
  }
  return linhas.join('\n') + '\n'
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
  // Modo seco: primeiro tenta o pid-file próprio (gravado pelo index.js —
  // cobre o .exe standalone do Windows, sem depender de PM2/Node globais).
  // Sem esse arquivo, tenta PM2; sem os dois, desconhecido (pode estar
  // rodando via node direto, sem nenhum dos dois mecanismos).
  const peloPid = statusPeloPid()
  if (peloPid) return peloPid
  const r = roda('pm2', ['jlist'])
  if (r.ok) return r.out.includes('LCNWhatsApp') ? 'rodando' : 'parado'
  return 'desconhecido'
}

// Inicia o bot re-executando o próprio processo atual (process.execPath) com
// a flag --bot — dentro do .exe standalone (SEA) isso É o próprio lcn.exe;
// rodando via `node`, é o binário do node instalado (equivalente a `node
// index.js`, já que bin/lcn-sea.js despacha por essa mesma flag).
export function iniciarBot () {
  if (statusServico() === 'rodando') return { ok: false, out: 'Bot já está rodando.' }
  const filho = spawn(process.execPath, ['--bot'], { detached: true, stdio: 'ignore', cwd: RAIZ })
  filho.unref()
  return { ok: true, out: `Bot iniciado (pid ${filho.pid}).` }
}

// Encerra o bot pelo pid gravado em data/bot.pid. Só funciona quando esse
// arquivo existe (ver statusPeloPid) — outros modos (Docker/PM2) continuam
// usando reiniciarBot()/o restart.request de sempre.
//
// Remove o pid-file aqui mesmo, não só no `process.on('exit', ...)` do
// index.js: process.kill() manda SIGTERM (no Windows, TerminateProcess) sem
// handler algum instalado no alvo, então o encerramento é imediato e NENHUM
// código do processo morto roda depois — o exit handler dele é só um reforço
// pra saída graciosa (crash tratado, process.exit() interno), não pra este
// caminho. Sem remover aqui, um reiniciarBot() logo em seguida veria o
// pid-file antigo e poderia achar (por uma corrida) que o bot ainda está de
// pé.
export function pararBot () {
  try {
    const pid = parseInt(fs.readFileSync(ARQ_PID_BOT, 'utf8').trim(), 10)
    if (!pid) return { ok: false, out: 'Nenhum bot rodando (pid-file ausente/inválido).' }
    process.kill(pid)
    try { fs.rmSync(ARQ_PID_BOT) } catch {}
    return { ok: true, out: 'Bot parado.' }
  } catch (e) {
    return { ok: false, out: e.message }
  }
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

// Pede ao bot pra reiniciar (sem apagar sessão). Com pid-file (.exe
// standalone), para e reinicia direto, já que não há PM2/restart policy de
// container pra recolocar o processo de pé sozinho. Nos outros modos, só
// grava o flag: o bot detecta, sai, e o restart policy do container / PM2
// recolocam de pé.
export function reiniciarBot () {
  if (fs.existsSync(ARQ_PID_BOT)) {
    const r = pararBot()
    if (!r.ok) return r
    return iniciarBot()
  }
  try {
    if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true })
    fs.writeFileSync(path.join(PASTA_DADOS, 'restart.request'), String(Date.now()))
    return { ok: true, out: 'Reinício solicitado. O bot volta em alguns segundos.' }
  } catch (e) {
    return { ok: false, out: e.message }
  }
}

// ————— CLI (uso por install.sh/update.sh/run.sh — shell não tem parser
// JSON confiável embutido, e este projeto já assume Node no fluxo docker) —————
function cliPrincipal () {
  const sub = process.argv[2]

  if (sub === 'docker-args') {
    const rt = lerRuntime()
    const linhas = [dockerfileEscolhido(rt), ...argsRecursos(rt.container), ...argMontagemModelos(rt.transcricaoLocal)]
    process.stdout.write(linhas.join('\n') + '\n')
    return
  }

  if (sub === 'compose-override') {
    process.stdout.write(composeOverride(lerRuntime()))
    return
  }

  if (sub === 'save') {
    const args = process.argv.slice(3)
    const valor = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined }
    const rt = lerRuntime()
    const mode = valor('--mode'); if (mode) rt.mode = mode
    const engine = valor('--engine'); if (engine !== undefined) rt.engine = engine || null
    const memory = valor('--memory'); if (memory !== undefined) rt.container.memory = memory === '' ? null : memory
    const cpus = valor('--cpus'); if (cpus !== undefined) rt.container.cpus = cpus === '' ? null : cpus
    const instalada = valor('--instalada'); if (instalada !== undefined) rt.transcricaoLocal.instalada = instalada === 'true'
    const modelo = valor('--modelo'); if (modelo) rt.transcricaoLocal.modelo = modelo
    salvarRuntime(rt)
    process.stdout.write('OK\n')
    return
  }

  if (sub === 'show') {
    process.stdout.write(JSON.stringify(lerRuntime(), null, 2) + '\n')
    return
  }

  if (sub === 'modelo') {
    process.stdout.write((lerRuntime().transcricaoLocal.modelo || 'base') + '\n')
    return
  }

  process.stderr.write('uso: node src/runtime.js <docker-args|compose-override|save|show|modelo>\n')
  process.exitCode = 1
}

const ehCliDireta = process.argv[1] && (() => {
  try { return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) } catch { return false }
})()
if (ehCliDireta) cliPrincipal()
