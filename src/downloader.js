// Baixa mídia de um link (YouTube, TikTok, Instagram…) por um serviço externo.
//
// Mora no GATEWAY, não no motor, pela mesma regra de sempre: quem fala com a
// rede e carrega bytes é este lado. O motor decide "baixe esta URL e mande
// aqui" e passa adiante — nunca faz requisição nem toca no arquivo.
//
// Isso é o que permite a função existir HOJE sem o `action.http`, que está
// parado por um motivo real: o gateway desiste de esperar o motor em 1,5 s,
// então uma chamada de 30 s não teria como ser entregue por lá. Aqui o problema
// não existe — o comando já voltou do motor, e o gateway pode demorar o quanto
// o download precisar.
//
// O serviço é assíncrono de propósito (cria um trabalho, você acompanha), então
// o fluxo é: pedir → esperar o trabalho → buscar o arquivo.
import fs from 'fs'
import os from 'os'
import path from 'path'

const ESPERA_ENTRE_CONSULTAS_MS = 1500
const TIMEOUT_REQUISICAO_MS = 20000

// Estados que significam "ainda não acabou". Qualquer outro encerra a espera —
// inclusive um estado que esta versão não conhece, porque ficar girando num
// estado desconhecido é pior que parar e dizer o que veio.
const EM_ANDAMENTO = new Set(['na_fila', 'baixando'])

// O que o serviço chama de tipo, traduzido para o que o WhatsApp aceita.
const TIPO_WHATSAPP = { video: 'video', audio: 'audio', imagem: 'image' }

export class ErroDeDownload extends Error {}

export function traduzirErroDeDownload (erro) {
  const texto = typeof erro === 'string' ? erro : ''

  // O segundo motor pode recusar a URL mesmo quando o primeiro explicou a
  // causa real. No bloqueio do YouTube em produção, priorizar essa recusa
  // faria um vídeo válido parecer um link sem mídia.
  if (/sign in to confirm you['’]re not a bot/i.test(texto)) {
    return 'O YouTube bloqueou o acesso do nosso servidor. Não é um problema com o seu link. Tente novamente mais tarde ou envie o arquivo aqui na conversa.'
  }
  if (/age-restricted|sign in to confirm your age/i.test(texto)) {
    return 'Esse vídeo tem restrição de idade e não pode ser baixado por aqui. Envie outro vídeo sem essa restrição.'
  }
  if (/this live event will begin in/i.test(texto)) {
    return 'Essa transmissão ainda não começou. Tente novamente depois que ela terminar.'
  }
  if (/video unavailable|private video/i.test(texto)) {
    return 'Esse vídeo está indisponível: pode ser privado ou ter sido removido. Confira se ele abre para você e envie um link de vídeo público disponível.'
  }

  const errosDosMotores = texto.split(/\|\s*(?=\[(?:ytdlp|gallerydl)\])/i)
  const ambosRecusaram = ['ytdlp', 'gallerydl'].every((motor) =>
    errosDosMotores.some((parte) => parte.trim().toLowerCase().startsWith(`[${motor}]`) && /unsupported url/i.test(parte))
  )
  if (/does not have a\s+.+?\s+tab/i.test(texto) || ambosRecusaram) {
    return 'Esse link não tem vídeo nem foto para baixar por aqui. Envie um link direto de um vídeo ou de uma foto.'
  }

  // Erros novos precisam continuar visíveis para a pessoa, sem transformar
  // instruções internas de autenticação e diagnóstico em resposta no WhatsApp.
  return 'Não foi possível baixar a mídia desse link agora. Tente novamente mais tarde ou envie outro link.'
}

function expandirTil (caminho) {
  if (typeof caminho !== 'string' || !caminho) return null
  return caminho.startsWith('~') ? path.join(os.homedir(), caminho.slice(1)) : caminho
}

// O token vive num ARQUIVO, não na configuração: assim ele não passa pelo
// painel, não entra em backup de config por acidente, e mantém a permissão que
// o dono deu a ele no disco.
function lerToken (arquivo) {
  const alvo = expandirTil(arquivo)
  if (!alvo) return null
  try {
    const bruto = fs.readFileSync(alvo, 'utf8').trim()
    return bruto || null
  } catch {
    return null
  }
}

export function configuracaoDeDownload (cfg) {
  const d = cfg?.download || {}
  const api = String(d.api || '').trim().replace(/\/+$/, '')
  return {
    api,
    token: lerToken(d.tokenArquivo),
    tokenArquivo: d.tokenArquivo || '',
    modoPadrao: d.modoPadrao || 'auto',
    limiteBytes: (Number(d.limiteMB) > 0 ? Number(d.limiteMB) : 64) * 1024 * 1024,
    // Sem piso: um piso silencioso ignoraria o que a pessoa configurou. Só
    // valor sem sentido (zero, negativo, não-número) cai no padrão.
    esperaMaximaMs: (Number(d.esperaMaximaSegundos) > 0 ? Number(d.esperaMaximaSegundos) : 300) * 1000
  }
}

function formatarMB (bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

export function criarBaixador ({ cfg, buscar = fetch, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), agora = () => Date.now() } = {}) {
  const conf = configuracaoDeDownload(cfg)

  function exigirConfiguracao () {
    if (!conf.api) {
      throw new ErroDeDownload('O serviço de download não está configurado. Defina download.api no config.json.')
    }
    if (!conf.token) {
      throw new ErroDeDownload(
        conf.tokenArquivo
          ? `Não consegui ler o token em ${conf.tokenArquivo}. Confira o caminho e a permissão do arquivo.`
          : 'Falta o token do serviço de download. Aponte download.tokenArquivo para o arquivo que o contém.'
      )
    }
  }

  async function chamar (caminho, opcoes = {}) {
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), TIMEOUT_REQUISICAO_MS)
    try {
      return await buscar(`${conf.api}${caminho}`, {
        ...opcoes,
        signal: controle.signal,
        headers: { Authorization: `Bearer ${conf.token}`, ...(opcoes.headers || {}) }
      })
    } catch (erro) {
      // Serviço fora do ar é a causa mais comum, e o erro cru de rede não diz
      // isso para quem só mandou um link no WhatsApp.
      throw new ErroDeDownload(`Não consegui falar com o serviço de download (${conf.api}).`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function jsonOuErro (resposta, oQue) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDeDownload('O serviço de download recusou o token. Ele pode ter sido trocado.')
    }
    if (!resposta.ok) {
      throw new ErroDeDownload(`O serviço de download respondeu ${resposta.status} ao ${oQue}.`)
    }
    try {
      return await resposta.json()
    } catch {
      throw new ErroDeDownload(`O serviço de download devolveu uma resposta inesperada ao ${oQue}.`)
    }
  }

  async function esperarTrabalho (job) {
    const limite = agora() + conf.esperaMaximaMs
    let estado = null
    while (agora() < limite) {
      await dormir(ESPERA_ENTRE_CONSULTAS_MS)
      estado = await jsonOuErro(await chamar(`/jobs/${encodeURIComponent(job)}`), 'acompanhar o download')
      if (!EM_ANDAMENTO.has(estado?.estado)) return estado
    }
    throw new ErroDeDownload(
      `O download passou de ${Math.round(conf.esperaMaximaMs / 1000)}s e desisti de esperar. O serviço pode ter terminado depois — vale olhar por lá.`
    )
  }

  // Escolhe o que ENVIAR quando o trabalho gerou vários arquivos (carrossel,
  // playlist). Vídeo ganha de imagem, que ganha do resto — é o que a pessoa
  // espera ao pedir "baixa esse link".
  function escolherMidia (midias) {
    const lista = Array.isArray(midias) ? midias.filter((m) => m?.url) : []
    if (!lista.length) return null
    const ordem = { video: 0, imagem: 1, audio: 2 }
    return [...lista].sort((a, b) => (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9))[0]
  }

  async function baixar (url, modo) {
    exigirConfiguracao()

    const pedido = await jsonOuErro(await chamar('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, modo: modo || conf.modoPadrao })
    }), 'pedir o download')

    if (!pedido?.job) throw new ErroDeDownload('O serviço aceitou o pedido mas não devolveu um trabalho para acompanhar.')

    const estado = await esperarTrabalho(pedido.job)
    if (estado?.estado === 'erro') {
      console.warn('[download] Falha informada pelo serviço:', estado.erro || '(sem detalhes)')
      throw new ErroDeDownload(traduzirErroDeDownload(estado.erro))
    }

    const midia = escolherMidia(estado?.midias)
    if (!midia) throw new ErroDeDownload('O download terminou mas não veio arquivo nenhum.')

    // O tamanho vem no próprio registro, ANTES de transferir: recusar aqui
    // evita puxar centenas de MB para descobrir no fim que o WhatsApp não
    // aceita. O serviço aceita arquivo muito maior do que o WhatsApp entrega.
    if (midia.bytes && midia.bytes > conf.limiteBytes) {
      throw new ErroDeDownload(
        `O arquivo tem ${formatarMB(midia.bytes)} e o limite para envio é ${formatarMB(conf.limiteBytes)}.`
      )
    }

    const resposta = await chamar(midia.url)
    if (!resposta.ok) throw new ErroDeDownload(`Não consegui buscar o arquivo baixado (${resposta.status}).`)
    const buffer = Buffer.from(await resposta.arrayBuffer())
    if (!buffer.length) throw new ErroDeDownload('O arquivo baixado veio vazio.')
    if (buffer.length > conf.limiteBytes) {
      throw new ErroDeDownload(`O arquivo tem ${formatarMB(buffer.length)} e o limite para envio é ${formatarMB(conf.limiteBytes)}.`)
    }

    return {
      buffer,
      nome: midia.nome || 'midia',
      mime: midia.mime || 'application/octet-stream',
      // Tipo que o WhatsApp entende. O que o serviço não classifica vai como
      // documento, que é o único formato que aceita qualquer coisa.
      tipo: TIPO_WHATSAPP[midia.tipo] || 'document',
      descricao: typeof estado?.descricao === 'string' ? estado.descricao : null
    }
  }

  return { baixar, configurado: () => Boolean(conf.api && conf.token) }
}
