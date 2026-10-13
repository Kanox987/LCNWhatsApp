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

// Os números da conversão, e por que eles NÃO são constantes minhas.
//
// Eram: 512 px, 6 segundos, qualidade 80/50, 1 MB. Todos escolhidos por mim e
// enterrados aqui, onde o dono do bot não alcança — a mesma crítica que ele fez
// ao download ("aparece no código interno e não como configurável pelo dono").
// Agora cada comando de figurinha declara os seus; isto aqui é só o PADRÃO de
// quem não declarar nada.
//
// 512x512 é o tamanho canônico da figurinha do WhatsApp — por isso é o padrão,
// não por isso é a única opção.
export const PADRAO = Object.freeze({
  tamanho: 512,
  duracaoMaxSegundos: 6,
  qualidadeEstatica: 80,
  qualidadeAnimada: 50,
  limiteBytes: 1024 * 1024,
  timeoutMs: 30000
})

// Os LIMITES existem para o que quebraria a própria máquina, e só para isso:
// um webp animado de 2048 px por 5 minutos come o container inteiro. Dentro da
// faixa, a escolha é de quem monta o comando.
//
// Quem impõe isto de verdade é o schema, na PUBLICAÇÃO — ali o número fora da
// faixa é recusado com a faixa junto, e a pessoa vê. O aperto aqui é rede de
// segurança para documento que tenha entrado por outro caminho, e nunca
// inventa valor: fora da faixa, volta para a borda mais próxima.
export const FAIXAS = Object.freeze({
  tamanho: { min: 96, max: 1024 },
  duracaoMaxSegundos: { min: 1, max: 30 },
  qualidade: { min: 1, max: 100 },
  limiteBytes: { min: 64 * 1024, max: 10 * 1024 * 1024 }
})

function dentroDaFaixa (valor, faixa, padrao) {
  const n = Number(valor)
  if (!Number.isFinite(n)) return padrao
  return Math.min(faixa.max, Math.max(faixa.min, Math.round(n)))
}

// `force_original_aspect_ratio=decrease` + `pad` mantém a proporção original e
// completa o resto com transparência, em vez de esticar a imagem.
function filtroDeEscala (lado) {
  return `scale=${lado}:${lado}:force_original_aspect_ratio=decrease,pad=${lado}:${lado}:(ow-iw)/2:(oh-ih)/2:color=#00000000`
}

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
// O resto (`tamanho`, `duracaoMaxSegundos`, `qualidade`, `limiteBytes`) vem do
// comando que o dono montou; ausente, cai no PADRÃO acima.
export async function converterParaFigurinha (buffer, opcoes = {}) {
  const { animada = false } = opcoes
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new ErroDeFigurinha('Não veio mídia nenhuma para transformar em figurinha.')
  }

  const tamanho = dentroDaFaixa(opcoes.tamanho, FAIXAS.tamanho, PADRAO.tamanho)
  const duracaoMaxSegundos = dentroDaFaixa(opcoes.duracaoMaxSegundos, FAIXAS.duracaoMaxSegundos, PADRAO.duracaoMaxSegundos)
  const qualidade = dentroDaFaixa(opcoes.qualidade, FAIXAS.qualidade,
    animada ? PADRAO.qualidadeAnimada : PADRAO.qualidadeEstatica)
  const limiteBytes = dentroDaFaixa(opcoes.limiteBytes, FAIXAS.limiteBytes, PADRAO.limiteBytes)

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-fig-'))
  const entrada = path.join(pasta, `entrada-${randomUUID()}`)
  const saida = path.join(pasta, 'figurinha.webp')

  try {
    fs.writeFileSync(entrada, buffer)

    const args = ['-y', '-hide_banner', '-loglevel', 'error']
    if (animada) args.push('-t', String(duracaoMaxSegundos))
    args.push('-i', entrada, '-vf', filtroDeEscala(tamanho), '-c:v', 'libwebp', '-an')
    if (animada) {
      args.push('-loop', '0', '-preset', 'default', '-q:v', String(qualidade), '-fps_mode', 'passthrough')
    } else {
      args.push('-frames:v', '1', '-q:v', String(qualidade))
    }
    args.push(saida)

    await rodarFfmpeg(args, { timeoutMs: PADRAO.timeoutMs })

    const resultado = fs.readFileSync(saida)
    if (!resultado.length) throw new ErroDeFigurinha('A conversão terminou sem gerar figurinha nenhuma.')
    if (resultado.length > limiteBytes) {
      // O peso entra na mensagem: sem ele a pessoa não sabe se passou por pouco
      // (baixar a qualidade resolve) ou se o vídeo é longo demais.
      const kb = (n) => `${Math.round(n / 1024)} KB`
      throw new ErroDeFigurinha(
        `A figurinha ficou em ${kb(resultado.length)} e o limite deste comando é ${kb(limiteBytes)} — ` +
        'tente uma mídia menor, mais curta, ou baixe a qualidade do comando.'
      )
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
