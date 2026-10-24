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
import { iniciar, desligar } from './src/connection.js'
import * as state from './src/state.js'
import { iniciarEspelhoLog } from './src/espelhoLog.js'

garantirPastas()

// Grava o próprio PID — é como o painel (src/runtime.js: statusServico/
// iniciarBot/pararBot) sabe se o bot está de pé sem depender de PM2 (que por
// sua vez exige Node/npm globais). Cobre tanto "iniciado pelo painel" quanto
// o `node index.js` direto
// rodado direto. A limpeza aqui no 'exit' é só um reforço pra saída graciosa
// (crash tratado, SIGTERM em Linux/macOS onde é entregue de verdade) — quem
// para o bot pelo painel (runtime.js: pararBot) já remove o arquivo direto,
// porque no Windows um process.kill() não roda handler nenhum no alvo.
const ARQ_PID = path.join(PASTA_DADOS, 'bot.pid')
fs.writeFileSync(ARQ_PID, String(process.pid))
// Espelha os logs num arquivo (data/bot.log) pra o painel poder mostrá-los mesmo
// rodando dentro do container (onde não há `docker logs`). Usa um WriteStream
// com rotação em execução para não travar o event loop com I/O síncrono a cada linha.
const ARQ_LOG = path.join(PASTA_DADOS, 'bot.log')
const espelho = iniciarEspelhoLog({ arquivo: ARQ_LOG })

process.on('exit', () => {
  try { fs.rmSync(ARQ_PID) } catch {}
  try { espelho.fecharSincrono() } catch {}
})

const cfg = garantirConfig()
iniciarSaida(cfg)        // no-op enquanto outputApi.enabled = false
state.gravar()
// Batimento: o estado é reescrito de tempos em tempos mesmo parado. É o que
// permite a outro processo (o painel, inclusive de outro container) saber que
// ESTE aqui continua vivo — sem isso, `conectado: true` fica gravado para
// sempre quando o processo morre de queda.
state.iniciarBatimento()

let encerrando = false
async function encerrar (codigo = 0) {
  if (encerrando) return
  encerrando = true
  await desligar()
  try {
    await espelho.fechar()
  } catch {}
  process.exit(codigo)
}

iniciar().catch(async (e) => {
  console.error('Falha ao iniciar:', e)
  await encerrar(1)
})

process.on('SIGTERM', async () => {
  state.definirConexao({ conectado: false })
  await encerrar(0)
})

process.on('SIGINT', async () => {
  state.definirConexao({ conectado: false })
  await encerrar(0)
})
