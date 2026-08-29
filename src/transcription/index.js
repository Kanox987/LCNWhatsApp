// Transcrição de áudio plugável. Escolhe o provedor conforme o config e devolve
// texto (ou null se desligado/falhar). É um extra: nunca derruba a captura.
//
// Provedores:
//   off            -> não transcreve
//   faster-whisper -> sidecar Python local (venv), modelo tiny/base (leve)
//   openai         -> API de transcrição da OpenAI (whisper-1 / gpt-4o-transcribe)
//   custom         -> comando shell configurável (encaixa qualquer CLI)
//
// Nota: Claude/Anthropic NÃO transcreve áudio direto; só entra via "custom" se o
// usuário montar um wrapper que receba o arquivo e devolva texto no stdout.
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { transcreverOpenAI } from './openai.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function rodar (cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`)))
  })
}

async function viaFasterWhisper (arquivo, cfg) {
  const py = process.env.LCN_PYTHON || 'python3'
  const script = path.join(__dirname, 'faster_whisper.py')
  return rodar(py, [script, arquivo, cfg.modelo || 'base', cfg.idioma || 'pt'])
}

async function viaCustom (arquivo, cfg) {
  if (!cfg.comando) throw new Error('comando de transcrição custom não configurado')
  // Substitui {file} pelo caminho; roda via shell pra aceitar pipes/flags.
  const linha = cfg.comando.replaceAll('{file}', JSON.stringify(arquivo))
  const shell = process.platform === 'win32' ? 'cmd' : 'sh'
  const flag = process.platform === 'win32' ? '/c' : '-c'
  return rodar(shell, [flag, linha])
}

export async function transcrever (arquivo, cfg) {
  const provedor = cfg?.provedor || 'off'
  if (provedor === 'off') return null
  if (!fs.existsSync(arquivo)) return null
  try {
    if (provedor === 'faster-whisper') return await viaFasterWhisper(arquivo, cfg)
    if (provedor === 'openai') return await transcreverOpenAI(arquivo, cfg)
    if (provedor === 'custom') return await viaCustom(arquivo, cfg)
  } catch (e) {
    console.error(`transcrição (${provedor}) falhou:`, e.message)
    return null
  }
  return null
}
