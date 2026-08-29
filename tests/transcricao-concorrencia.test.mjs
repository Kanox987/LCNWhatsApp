// Testes: sidecar faster-whisper não tem mais o nome que colide com o
// pacote pip (bug real encontrado testando de verdade — ver
// src/transcription/whisper_sidecar.py), e a fila de transcrição nunca roda
// duas transcrições ao mesmo tempo (concorrência = 1).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { transcrever } from '../src/transcription/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

// --- sidecar não tem mais o nome que colide com o pacote "faster_whisper" ---
const pastaTranscricao = path.join(__dirname, '..', 'src', 'transcription')
check(
  'whisper_sidecar.py existe (sem colidir com o pacote pip faster_whisper)',
  fs.existsSync(path.join(pastaTranscricao, 'whisper_sidecar.py'))
)
check(
  'não existe mais src/transcription/faster_whisper.py (o nome que causava o bug de import)',
  !fs.existsSync(path.join(pastaTranscricao, 'faster_whisper.py'))
)

// --- concorrência de transcrição = 1 (nunca duas ao mesmo tempo) ---
const tmp = os.tmpdir()
const log = path.join(tmp, `lcn-teste-concorrencia-${Date.now()}.log`)
fs.writeFileSync(log, '')

const arquivos = [1, 2, 3].map((n) => {
  const p = path.join(tmp, `lcn-teste-audio-${Date.now()}-${n}.ogg`)
  fs.writeFileSync(p, 'fake')
  return p
})

const shell = process.platform === 'win32' ? null : 'sh'
if (shell) {
  const comando = `sh -c 'printf "INICIO %s\\n" {file} >> "${log}"; sleep 0.2; printf "FIM %s\\n" {file} >> "${log}"'`
  const cfg = { provedor: 'custom', comando }

  await Promise.all(arquivos.map((a) => transcrever(a, cfg)))

  const linhas = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  check('fila rodou as 3 chamadas (6 linhas de log: início+fim de cada)', linhas.length === 6)

  // Serializado de verdade = pra cada INICIO, o FIM correspondente aparece
  // antes do próximo INICIO (nunca dois INICIO seguidos sem FIM no meio).
  let serializado = true
  let abertos = 0
  for (const linha of linhas) {
    if (linha.startsWith('INICIO')) {
      if (abertos > 0) serializado = false
      abertos++
    } else if (linha.startsWith('FIM')) {
      abertos--
    }
  }
  check('nenhuma transcrição começou antes da anterior terminar (concorrência = 1)', serializado)

  for (const a of arquivos) fs.rmSync(a, { force: true })
  fs.rmSync(log, { force: true })
} else {
  console.log('⏭️  pulando teste de concorrência (precisa de sh, Windows não tem)')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTRANSCRIÇÃO/CONCORRÊNCIA OK')
process.exit(falhas ? 1 : 0)
