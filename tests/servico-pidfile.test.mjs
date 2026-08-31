// Testes do mecanismo de status/start/stop via pid-file (data/bot.pid) —
// substitui a dependência de PM2 no cenário do .exe standalone (Windows,
// Node SEA), que não pode contar com PM2/Node globais instalados. Cobre só
// o caminho determinístico (com pid-file); o fallback pra PM2 (sem
// pid-file) já não era coberto por teste nenhum antes desta mudança —
// depende de PM2 estar ou não instalado na máquina, então não é asserido
// aqui.
import fs from 'fs'
import { spawn } from 'child_process'
import { statusServico, iniciarBot, pararBot } from '../src/runtime.js'
import { ARQ_RUNTIME, PASTA_DADOS, garantirPastas } from '../src/paths.js'

garantirPastas()
const ARQ_PID = `${PASTA_DADOS}/bot.pid`

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const backupRuntime = fs.existsSync(ARQ_RUNTIME) ? fs.readFileSync(ARQ_RUNTIME, 'utf8') : null
const backupPid = fs.existsSync(ARQ_PID) ? fs.readFileSync(ARQ_PID, 'utf8') : null

// statusServico só entra no branch de pid-file em modo "bare" (docker e
// dentroDeContainer têm prioridade) — força isso pro teste, independente do
// runtime.json real deste checkout.
fs.writeFileSync(ARQ_RUNTIME, JSON.stringify({ mode: 'bare', engine: null }))

async function pegarPidJaMorto () {
  // spawnSync (síncrono) já esperaria o filho terminar, mas nem sempre
  // libera o pid rápido o bastante pro SO reciclar durante o teste — spawn
  // assíncrono + esperar o 'exit' garante que o processo já não existe mais
  // quando seguimos.
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', '1'])
    p.on('exit', () => resolve(p.pid))
  })
}

async function main () {
  try {
    // --- statusServico via pid-file ---
    fs.writeFileSync(ARQ_PID, String(process.pid))
    check('pid vivo (o próprio processo de teste) -> status "rodando"', statusServico() === 'rodando')

    const pidMorto = await pegarPidJaMorto()
    fs.writeFileSync(ARQ_PID, String(pidMorto))
    check('pid gravado mas processo já encerrado -> status "parado"', statusServico() === 'parado')

    // --- iniciarBot: guarda contra iniciar duas vezes ---
    fs.writeFileSync(ARQ_PID, String(process.pid))
    const r1 = iniciarBot()
    check('iniciarBot recusa quando já há um pid vivo', r1.ok === false && /já está rodando/.test(r1.out))

    // --- pararBot: mata de verdade um processo descartável e limpa o pid-file ---
    const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await new Promise((resolve) => filho.once('spawn', resolve))
    fs.writeFileSync(ARQ_PID, String(filho.pid))
    const r2 = pararBot()
    check('pararBot retorna ok', r2.ok === true)
    check('pararBot remove o pid-file', !fs.existsSync(ARQ_PID))

    await new Promise((resolve) => {
      filho.once('exit', resolve)
      setTimeout(resolve, 2000) // segurança: não trava o teste se o SO demorar a entregar o exit
    })
    let aindaVivo = true
    try { process.kill(filho.pid, 0); aindaVivo = true } catch { aindaVivo = false }
    check('processo alvo do pararBot está mesmo encerrado', !aindaVivo)
  } finally {
    if (backupRuntime !== null) fs.writeFileSync(ARQ_RUNTIME, backupRuntime); else { try { fs.rmSync(ARQ_RUNTIME) } catch {} }
    if (backupPid !== null) fs.writeFileSync(ARQ_PID, backupPid); else { try { fs.rmSync(ARQ_PID) } catch {} }
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nSERVIÇO/PID-FILE OK')
  process.exit(falhas ? 1 : 0)
}

main()
