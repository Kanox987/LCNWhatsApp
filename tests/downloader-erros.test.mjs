import fs from 'fs'
import os from 'os'
import path from 'path'
import { criarBaixador, traduzirErroDeDownload } from '../src/downloader.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// Estes dois relatos de produção combinam erros dos motores: testar só uma
// palavra isolada não detectaria a recusa secundária escondendo a causa real.
const bloqueio = `[ytdlp] ERROR: [youtube] He5KEaJlKfw: Sign in
to confirm you're not a bot. Use --cookies-from-browser or --cookies for the
authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp
for how to manually pass cookies. Also see
https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies for
tips on effectively exporting YouTube cookies | [gallerydl] gallery-dl:
Unsupported URL 'https://youtube.com/shorts/He5KEaJlKfw?is=G7lbqYNfghPcGV9D'`
const comunidade = `[ytdlp] ERROR: [youtube:tab] post: This channel
does not have a UgkxFt0fJkrw_yAr9sa2h10kTp8Wkyfgw7qQ tab | [gallerydl]
gallery-dl: Unsupported URL 'http://youtube.com/post/Ugk...?si=7E7IoqJnbf2khemG'`

const generico = 'Não foi possível baixar a mídia desse link agora. Tente novamente mais tarde ou envie outro link.'
const casos = [
  ['bloqueio real do YouTube', bloqueio, /YouTube.*bloqueando.*servidor.*Não é problema do seu link.*tente de novo/s],
  ['post real de comunidade', comunidade, /não tem vídeo nem foto.*Envie um link direto/s],
  ['URL recusada pelos dois motores', "[ytdlp] ERROR: Unsupported URL: https://example.com/ | [gallerydl] gallery-dl: Unsupported URL 'https://example.com/'", /não tem vídeo nem foto.*Envie um link direto/s],
  ['vídeo removido', '[ytdlp] ERROR: [youtube] He5KEaJlKfw: Video unavailable. This video has been removed by the uploader', /privado.*removido.*link de vídeo público/s],
  ['vídeo privado', "[ytdlp] ERROR: [youtube] He5KEaJlKfw: Private video. Sign in if you've been granted access to this video", /privado.*removido.*link de vídeo público/s],
  ['restrição de idade', '[ytdlp] ERROR: [youtube] He5KEaJlKfw: This video is age-restricted; some formats may be missing without authentication. | [gallerydl] gallery-dl: Unsupported URL', /restrição de idade.*Envie outro vídeo/s],
  ['idade prevalece sobre indisponibilidade', '[ytdlp] ERROR: [youtube] He5KEaJlKfw: Video unavailable. Sign in to confirm your age. This video may be inappropriate for some users. | [gallerydl] gallery-dl: Unsupported URL', /restrição de idade.*Envie outro vídeo/s],
  ['transmissão futura', '[ytdlp] ERROR: [youtube] He5KEaJlKfw: Video unavailable. This live event will begin in 2 hours. | [gallerydl] gallery-dl: Unsupported URL', /transmissão ainda não começou.*depois que ela terminar/s],
  ['erro inesperado com diagnóstico interno', '[ytdlp] ERROR: unable to download video data: HTTP Error 503: Service Unavailable | [gallerydl] gallery-dl: Unsupported URL', generico],
  ['apenas um motor não comprova ausência de mídia', "[gallerydl] gallery-dl: Unsupported URL 'https://youtube.com/shorts/He5KEaJlKfw'", generico],
  ['erro vazio', '', generico],
  ['erro ausente', undefined, generico],
  ['erro nulo', null, generico]
]

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-download-erros-'))
const tokenArquivo = path.join(pasta, 'token')
fs.writeFileSync(tokenArquivo, 'token-do-teste')
const cfg = { download: { api: 'http://servico.test', tokenArquivo } }
const warnOriginal = console.warn

try {
  for (const [nome, bruto, esperado] of casos) {
    const frase = traduzirErroDeDownload(bruto)
    check(`${nome}: motivo e orientação para a pessoa`, typeof esperado === 'string' ? frase === esperado : esperado.test(frase), frase)
    check(`${nome}: sem ferramentas, flags ou documentação`, !/ytdlp|yt-dlp|gallerydl|gallery-dl|--cookies|https?:|ERROR:|Unsupported URL/i.test(frase))

    // Exercita o caminho serviço → baixador → gateway → WhatsApp. Assim uma
    // função correta, mas esquecida no fluxo real, também reprova o contrato.
    for (const errorText of [undefined, 'Resposta: {{erro}} / {{erro}}']) {
      const envios = []
      const confirmacoes = []
      const logs = []
      const chamadas = []
      console.warn = (...args) => logs.push(args)
      try {
        await executarComandos({ message: { send: async (...args) => envios.push(args) } }, [{
          id: 'download-com-erro',
          commandType: 'media.download',
          payload: { chatId: 'pessoa@s.whatsapp.net', url: 'https://youtube.com/shorts/He5KEaJlKfw', ackText: 'Baixando…', errorText }
        }], { execucoes: { confirmar: async (...args) => confirmacoes.push(args) } }, {
          cfg,
          mediaRefCache: {},
          criarBaixador: (opcoes) => criarBaixador({
            ...opcoes,
            dormir: async () => {},
            buscar: async (url) => {
              chamadas.push(url)
              if (url === 'http://servico.test/download') return { ok: true, json: async () => ({ job: 'j1' }) }
              if (url === 'http://servico.test/jobs/j1') return { ok: true, json: async () => ({ estado: 'erro', erro: bruto }) }
              throw new Error('Não deveria buscar mídia depois do erro')
            }
          })
        })
      } finally {
        console.warn = warnOriginal
      }
      const variante = errorText ? 'personalizada' : 'padrão'
      check(`${nome} (${variante}): aviso inicial seguido de resposta humana`, envios.length === 2 && envios[0][1].text === 'Baixando…' && envios[1][1].text === (errorText ? `Resposta: ${frase} / ${frase}` : frase))
      check(`${nome} (${variante}): diagnóstico original preservado no log`, logs.some((args) => args[0] === '[download] Falha informada pelo serviço:' && args[1] === (bruto || '(sem detalhes)')))
      check(`${nome} (${variante}): encerra sem buscar arquivo e registra falha`, chamadas.length === 2 && confirmacoes.length === 1 && confirmacoes[0][1].status === 'failed')
    }
  }
} finally {
  console.warn = warnOriginal
  fs.rmSync(pasta, { recursive: true, force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nMENSAGENS DE DOWNLOAD OK')
process.exit(falhas ? 1 : 0)

