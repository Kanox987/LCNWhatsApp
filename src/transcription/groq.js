// Transcrição via API da Groq — endpoint compatível com o da OpenAI
// (multipart/form-data, mesmo formato de resposta), só muda o host e o
// catálogo de modelos (whisper-large-v3, whisper-large-v3-turbo, ...).
// Free tier com limite diário generoso, mas é por conta — não tem SLA.
import fs from 'fs'
import path from 'path'

export async function transcreverGroq (arquivo, cfg) {
  const chave = cfg.groqApiKey || process.env.GROQ_API_KEY
  if (!chave) throw new Error('groqApiKey não configurada')
  const modelo = cfg.groqModelo || 'whisper-large-v3-turbo'

  const dados = fs.readFileSync(arquivo)
  const form = new FormData()
  form.append('model', modelo)
  if (cfg.idioma) form.append('language', cfg.idioma)
  form.append('file', new Blob([dados]), path.basename(arquivo))

  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}` },
    body: form
  })
  if (!resp.ok) throw new Error(`Groq ${resp.status}: ${await resp.text()}`)
  const json = await resp.json()
  return json.text || null
}
