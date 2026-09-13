// Conversão de mídia para figurinha do WhatsApp.
//
// Figurinha no WhatsApp é WebP e nada mais — não existe caminho alternativo.
// A `jimp` que já está no package.json NÃO encoda WebP (só bmp/gif/jpeg/png/
// tiff), então a conversão sai pelo ffmpeg, que praticamente toda máquina que
// roda este bot já tem e traz o encoder libwebp. É dependência EXTERNA, então
// a ausência dele precisa virar mensagem clara, nunca uma falha silenciosa no
// meio de um comando.
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

// 512x512 é o tamanho canônico da figurinha. `force_original_aspect_ratio=
// decrease` + `pad` mantém a proporção original e completa o resto com
// transparência, em vez de esticar a imagem.
const FILTRO = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000'

const LIMITE_FIGURINHA_BYTES = 1024 * 1024
const TIMEOUT_MS = 30000

export class ErroDeFigurinha extends Error {}

function rodarFfmpeg (args, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let processo
    try {
      processo = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch {
      return reject(new ErroDeFigurinha('O ffmpeg não está instalado nesta máquina — sem ele não dá pra gerar figurinha.'))
    }

    let erro = ''
    processo.stderr?.on('data', (parte) => { erro += parte.toString() })

    const relogio = setTimeout(() => {
      processo.kill('SIGKILL')
      reject(new ErroDeFigurinha('A conversão da figurinha demorou demais e foi cancelada.'))
    }, timeoutMs)

    processo.on('error', (e) => {
      clearTimeout(relogio)
      reject(new ErroDeFigurinha(
        e?.code === 'ENOENT'
          ? 'O ffmpeg não está instalado nesta máquina — sem ele não dá pra gerar figurinha.'
          : `Não foi possível rodar o ffmpeg: ${e.message}`
      ))
    })

    processo.on('close', (codigo) => {
      clearTimeout(relogio)
      if (codigo === 0) return resolve()
      // A saída do ffmpeg é longa; só a última linha costuma dizer o motivo.
      const ultimaLinha = erro.trim().split('\n').pop() || `código ${codigo}`
      reject(new ErroDeFigurinha(`O ffmpeg não conseguiu converter esta mídia (${ultimaLinha}).`))
    })
  })
}

// Converte um buffer de imagem ou vídeo curto em WebP de figurinha.
// `animada` decide entre figurinha estática e animada — vídeo/gif viram
// animadas, limitadas em duração porque o WhatsApp recusa figurinha grande.
export async function converterParaFigurinha (buffer, { animada = false, duracaoMaxSegundos = 6 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ErroDeFigurinha('Não veio mídia nenhuma para transformar em figurinha.')
  }

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-fig-'))
  const entrada = path.join(pasta, `entrada-${randomUUID()}`)
  const saida = path.join(pasta, 'figurinha.webp')

  try {
    fs.writeFileSync(entrada, buffer)

    const args = ['-y', '-hide_banner', '-loglevel', 'error']
    if (animada) args.push('-t', String(duracaoMaxSegundos))
    args.push('-i', entrada, '-vf', FILTRO, '-c:v', 'libwebp', '-an')
    if (animada) {
      args.push('-loop', '0', '-preset', 'default', '-q:v', '50', '-fps_mode', 'passthrough')
    } else {
      args.push('-frames:v', '1', '-q:v', '80')
    }
    args.push(saida)

    await rodarFfmpeg(args)

    const resultado = fs.readFileSync(saida)
    if (!resultado.length) throw new ErroDeFigurinha('A conversão terminou sem gerar figurinha nenhuma.')
    if (resultado.length > LIMITE_FIGURINHA_BYTES) {
      throw new ErroDeFigurinha('A figurinha ficou grande demais para o WhatsApp aceitar — tente uma mídia menor ou mais curta.')
    }
    return resultado
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true })
  }
}

// Tipos de mídia que fazem sentido virar figurinha. Áudio e documento não têm
// imagem para converter, e falhar cedo com motivo é melhor que deixar o
// ffmpeg reclamar de um formato que nunca ia dar certo.
export function podeVirarFigurinha (tipo) {
  return tipo === 'image' || tipo === 'video' || tipo === 'sticker'
}

export function ehAnimada (tipo) {
  return tipo === 'video'
}
