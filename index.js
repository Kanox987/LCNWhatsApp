// LCNWhatsApp — entry do bot.
// Captura foto/vídeo/áudio em visualização única recebidos no PV e reenvia como
// mídia NORMAL pro destino configurado (por padrão, a conversa consigo mesmo).
//
// Rodar o bot:      node index.js            (QR)
//                   node index.js --code     (código de pareamento)
// Abrir o painel:   lcn   (ou: node src/dashboard.js)
import fs from 'fs'
import path from 'path'
import { garantirPastas, PASTA_DADOS } from './src/paths.js'
import { garantirConfig } from './src/config.js'
import { iniciarSaida } from './src/api/output.js'
import { iniciar } from './src/connection.js'
import * as state from './src/state.js'

garantirPastas()

// Grava o próprio PID — é como o painel (src/runtime.js: statusServico/
// iniciarBot/pararBot) sabe se o bot está de pé sem depender de PM2 (que por
// sua vez exige Node/npm globais, contradizendo o .exe standalone do
// Windows). Cobre tanto "iniciado pelo painel" quanto o .exe/`node index.js`
// rodado direto. A limpeza aqui no 'exit' é só um reforço pra saída graciosa
// (crash tratado, SIGTERM em Linux/macOS onde é entregue de verdade) — quem
// para o bot pelo painel (runtime.js: pararBot) já remove o arquivo direto,
// porque no Windows um process.kill() não roda handler nenhum no alvo.
const ARQ_PID = path.join(PASTA_DADOS, 'bot.pid')
fs.writeFileSync(ARQ_PID, String(process.pid))
process.on('exit', () => { try { fs.rmSync(ARQ_PID) } catch {} })

// Espelha os logs num arquivo (data/bot.log) pra o painel poder mostrá-los mesmo
// rodando dentro do container (onde não há `docker logs`). Cap de tamanho simples.
const ARQ_LOG = path.join(PASTA_DADOS, 'bot.log')
try { if (fs.existsSync(ARQ_LOG) && fs.statSync(ARQ_LOG).size > 1048576) fs.rmSync(ARQ_LOG) } catch {}
function espelhar (orig) {
  return (...args) => {
    orig(...args)
    try {
      const linha = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      // não espelha os blocos de QR (arte ASCII) pro arquivo
      if (!/[█▄▀]/.test(linha)) fs.appendFileSync(ARQ_LOG, linha + '\n')
    } catch {}
  }
}
console.log = espelhar(console.log.bind(console))
console.error = espelhar(console.error.bind(console))

const cfg = garantirConfig()
iniciarSaida(cfg)        // no-op enquanto outputApi.enabled = false
state.gravar()

iniciar().catch((e) => {
  console.error('Falha ao iniciar:', e)
  process.exit(1)
})

process.on('SIGTERM', () => { state.definirConexao({ conectado: false }); process.exit(0) })
process.on('SIGINT', () => { state.definirConexao({ conectado: false }); process.exit(0) })
