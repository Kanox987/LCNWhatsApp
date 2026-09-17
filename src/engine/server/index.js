#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { abrirBanco } from './db.js'
import { fecharPendentesAntigos } from './evaluator.js'
import { criarApi } from './api.js'
import { iniciarTransport } from './transport.js'
import { ARQ_DB, ARQ_PID_ENGINE, PASTA_RUN, SOCKET_PATH } from '../paths.js'

function gravarPid () {
  fs.mkdirSync(PASTA_RUN, { recursive: true, mode: 0o700 })
  fs.chmodSync(PASTA_RUN, 0o700)
  const temporario = `${ARQ_PID_ENGINE}.tmp-${process.pid}`
  fs.writeFileSync(temporario, `${process.pid}\n`, { mode: 0o600 })
  fs.renameSync(temporario, ARQ_PID_ENGINE)
}

function removerPidProprio () {
  try {
    if (fs.readFileSync(ARQ_PID_ENGINE, 'utf8').trim() === String(process.pid)) fs.rmSync(ARQ_PID_ENGINE)
  } catch {}
}

async function main () {
  const db = abrirBanco(ARQ_DB)
  // Comando pendente de horas atrás não está em andamento em lugar nenhum.
  // Deixá-lo assim é o motor mentindo que algo ainda está acontecendo.
  const fechados = fecharPendentesAntigos(db)
  if (fechados) console.log(`[engine] ${fechados} comando(s) pendente(s) antigo(s) foram fechados`)
  let transport
  try {
    transport = await iniciarTransport(criarApi(db), { socketPath: SOCKET_PATH })
    gravarPid()
  } catch (erro) {
    db.close()
    throw erro
  }

  console.log(`[engine] motor rodando em ${SOCKET_PATH}`)
  let encerrando = false
  const encerrar = async (sinal) => {
    if (encerrando) return
    encerrando = true
    try {
      await transport.fechar()
      db.close()
      removerPidProprio()
      console.log(`[engine] encerrado por ${sinal}`)
      process.exitCode = 0
    } catch (erro) {
      console.error(`[engine] falha ao encerrar: ${erro.message}`)
      process.exitCode = 1
    }
  }
  process.once('SIGTERM', () => { void encerrar('SIGTERM') })
  process.once('SIGINT', () => { void encerrar('SIGINT') })
}

main().catch((erro) => {
  removerPidProprio()
  console.error(`Erro ao iniciar o motor: ${erro.message}`)
  process.exitCode = 1
})
