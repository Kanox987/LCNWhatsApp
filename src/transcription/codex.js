// Transcrição via Codex CLI (OpenAI) já instalado/logado na máquina do
// usuário. Não usa API key — autentica com a sessão do `codex login`
// (ChatGPT). O Codex CLI não tem entrada nativa de áudio (só texto/imagem):
// pedimos pro próprio agente produzir o texto, então vale testar com um
// áudio curto conhecido antes de confiar em produção (ver docs/TRANSCRICAO.md).
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'

export async function transcreverCodex (arquivo, cfg) {
  const idioma = cfg.idioma || 'pt'
  const absArquivo = path.resolve(arquivo)
  const tmpSaida = path.join(os.tmpdir(), `lcn-codex-${crypto.randomBytes(6).toString('hex')}.txt`)

  const prompt = `Transcreva o áudio no caminho "${absArquivo}" para texto em ${idioma}. ` +
    'Responda só com o texto transcrito, sem comentários, sem markdown, sem aspas.'

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--add-dir', path.dirname(absArquivo),
    '--output-last-message', tmpSaida
  ]
  if (cfg.codexModelo) args.push('-m', cfg.codexModelo)
  args.push(prompt)

  await new Promise((resolve, reject) => {
    const p = spawn('codex', args)
    let err = ''
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => {
      if (e.code === 'ENOENT') {
        reject(new Error('Codex CLI não encontrado nesta máquina. Instale com `npm install -g @openai/codex` e faça `codex login`.'))
      } else {
        reject(e)
      }
    })
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(err || `exit ${code}`)))
  })

  try {
    const texto = fs.readFileSync(tmpSaida, 'utf8').trim()
    return texto || null
  } finally {
    fs.rm(tmpSaida, { force: true }, () => {})
  }
}
