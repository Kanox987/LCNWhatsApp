// Transcrição via API da OpenAI. Usa fetch nativo (Node 18+) e multipart manual
// pra não depender de libs externas. Precisa de openaiApiKey no config.
import fs from 'fs'
import path from 'path'

export async function transcreverOpenAI (arquivo, cfg) {
  const chave = cfg.openaiApiKey || process.env.OPENAI_API_KEY
  if (!chave) throw new Error('openaiApiKey não configurada')
  const modelo = cfg.openaiModelo || 'whisper-1'

  const dados = fs.readFileSync(arquivo)
  const form = new FormData()
  form.append('model', modelo)
  if (cfg.idioma) form.append('language', cfg.idioma)
  form.append('file', new Blob([dados]), path.basename(arquivo))

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}` },
    body: form
  })
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`)
  const json = await resp.json()
  return json.text || null
}
