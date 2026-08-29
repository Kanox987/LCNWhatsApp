// Teste do provedor "codex": nunca deve derrubar a captura, mesmo se o
// binário `codex` não estiver instalado na máquina.
import fs from 'fs'
import path from 'path'
import os from 'os'
import { transcrever } from '../src/transcription/index.js'

let falhas = 0

const arquivo = path.join(os.tmpdir(), `lcn-teste-codex-${Date.now()}.ogg`)
fs.writeFileSync(arquivo, 'conteúdo fake de áudio')

const pathOriginal = process.env.PATH
process.env.PATH = ''
try {
  const resultado = await transcrever(arquivo, { provedor: 'codex', idioma: 'pt' })
  const ok = resultado === null
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} codex sem binário instalado retorna null (não derruba a captura)`)
} finally {
  process.env.PATH = pathOriginal
  fs.rmSync(arquivo, { force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\n/TRANSCREVER-CODEX OK')
process.exit(falhas ? 1 : 0)
