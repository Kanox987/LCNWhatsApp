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
// A espera entre consultas cresce com o tempo: um download longo não precisa
// ser perguntado a cada 1,5s do começo ao fim, e ir de 40 consultas por minuto
// para 12 tira ruído do log sem atrasar a resposta de um download curto.
const ESPERA_MAXIMA_ENTRE_CONSULTAS_MS = 5000
const TIMEOUT_REQUISICAO_MS = 20000

// Estados que significam "ainda não acabou". Qualquer outro encerra a espera —
// inclusive um estado que esta versão não conhece, porque ficar girando num
// estado desconhecido é pior que parar e dizer o que veio.
const EM_ANDAMENTO = new Set(['na_fila', 'baixando'])

// O que o serviço chama de tipo, traduzido para o que o WhatsApp aceita.
const TIPO_WHATSAPP = { video: 'video', audio: 'audio', imagem: 'image' }

// Duas faces, de propósito.
//
// `message` é para o LOG: detalhada, com endereço, caminho de arquivo e nome de
// campo de configuração — é o que o dono precisa para consertar.
//
// `paraPessoa` é o que chega ao WhatsApp. Sem essa separação, quem mandou um
// link recebia "Defina download.api no config.json" ou o caminho do arquivo de
// token — instrução que ela não pode seguir, sobre um sistema que ela não
// administra, com detalhe interno que ela não deveria ver.
//
// Quando não é dito, a mensagem já era para a pessoa.
export class ErroDeDownload extends Error {
  constructor (mensagem, { paraPessoa } = {}) {
    super(mensagem)
    this.paraPessoa = paraPessoa || mensagem
  }
}

// O que a pessoa ouve quando o problema é do lado de cá. Ela não tem o que
// fazer além de tentar de novo, e fingir que tem seria pior.
// O que dizer quando o problema é do NOSSO lado. Uma frase só, de propósito.
//
// Aqui havia duas — "fora do ar" e "precisa de ajuste" —, e a distinção não
// servia para nada: para quem mandou um link, "o token está errado", "o serviço
// não responde" e "o serviço devolveu 500" são a mesma coisa. Não deu, e não é
// culpa do link. O diagnóstico que separa esses casos continua inteiro no
// `message`, que é onde o dono vai olhar.
const FALHA_NOSSA = 'O serviço que baixa os links está com problema agora. Tente de novo daqui a pouco — se continuar, avise o dono do bot.'

export function traduzirErroDeDownload (erro) {
  const texto = typeof erro === 'string' ? erro.replace(/\s+/g, ' ').trim() : ''

  // O segundo motor pode recusar a URL mesmo quando o primeiro explicou a
  // causa real. No bloqueio do YouTube em produção, priorizar essa recusa
  // faria um vídeo válido parecer um link sem mídia.
  if (/sign in to confirm you['’]re not a bot/i.test(texto)) {
    // Não peça o arquivo a quem pediu o arquivo: se a pessoa tivesse o vídeo,
    // ela não teria mandado o link. Dizer o que ELA pode fazer, e quando nada
    // pode ser feito por ela, dizer isso também — em vez de inventar uma
    // tarefa impossível para parecer prestativo.
    return 'O YouTube está bloqueando os downloads deste servidor agora. Não é problema do seu link — tente de novo mais tarde.'
  }
  if (/age-restricted|sign in to confirm your age/i.test(texto)) {
    return 'Esse vídeo tem restrição de idade e não pode ser baixado por aqui. Envie outro vídeo sem essa restrição.'
  }
  if (/this live event will begin in/i.test(texto)) {
    return 'Essa transmissão ainda não começou. Tente novamente depois que ela terminar.'
  }
  // Falha da SAÍDA de internet (o serviço tenta o YouTube por proxy quando o IP
  // daqui está bloqueado). O texto cru do yt-dlp traz o endereço da proxy —
  // "Cannot connect to proxy http://1.2.3.4:8080" —, e esse endereço não pode
  // chegar a quem mandou o link: é infraestrutura nossa, não informação útil.
  if (/cannot connect to proxy|proxyerror|tunnel connection failed|unable to connect to proxy/i.test(texto)) {
    return 'A saída de internet que usei para buscar esse link falhou. Tente de novo em instantes.'
  }
  // Download travado tem nome próprio no serviço ("travou: 90s sem baixar
  // nada"). Dizer isso com todas as letras evita a pergunta que sempre vinha
  // depois do erro genérico: "mas travou onde?".
  if (/travou|passou de \d+s|sem baixar nada|interrompido/i.test(texto)) {
    return 'O download travou no meio e foi cancelado. Tente de novo — se repetir, o link pode estar com problema do lado do site.'
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
      throw new ErroDeDownload('O serviço de download não está configurado. Defina download.api no config.json.', { paraPessoa: FALHA_NOSSA })
    }
    if (!conf.token) {
      throw new ErroDeDownload(
        conf.tokenArquivo
          ? `Não consegui ler o token em ${conf.tokenArquivo}. Confira o caminho e a permissão do arquivo.`
          : 'Falta o token do serviço de download. Aponte download.tokenArquivo para o arquivo que o contém.',
        { paraPessoa: FALHA_NOSSA }
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
      throw new ErroDeDownload(`Não consegui falar com o serviço de download (${conf.api}).`, { paraPessoa: FALHA_NOSSA })
    } finally {
      clearTimeout(timer)
    }
  }

  async function jsonOuErro (resposta, oQue) {
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDeDownload('O serviço de download recusou o token. Ele pode ter sido trocado.', { paraPessoa: FALHA_NOSSA })
    }
    // Fila cheia não é defeito, é o serviço se protegendo. A pessoa precisa
    // ouvir "tente daqui a pouco", não um número de status.
    if (resposta.status === 429) {
      throw new ErroDeDownload('Tem muita coisa na fila de download agora. Tente de novo daqui a pouco.')
    }
    if (!resposta.ok) {
      throw new ErroDeDownload(`O serviço de download respondeu ${resposta.status} ao ${oQue}.`, { paraPessoa: FALHA_NOSSA })
    }
    try {
      return await resposta.json()
    } catch {
      throw new ErroDeDownload(`O serviço de download devolveu uma resposta inesperada ao ${oQue}.`, { paraPessoa: FALHA_NOSSA })
    }
  }

  // Desistir sem cancelar era meio serviço: aqui a espera acabava, mas do outro
  // lado o download continuava ocupando uma das duas vagas do serviço para
  // entregar um arquivo que ninguém mais ia buscar. Dois links travados
  // paravam a fila inteira para todo mundo — este POST é o que solta a vaga.
  //
  // Falhar ao cancelar não pode virar o erro que a pessoa vê: ela já vai
  // receber o aviso do tempo esgotado, e "não consegui cancelar" é problema
  // nosso, para o log.
  async function desistirDoTrabalho (job) {
    try {
      await chamar(`/jobs/${encodeURIComponent(job)}/cancelar`, { method: 'POST' })
    } catch (erro) {
      console.warn(`[download] Não consegui cancelar o trabalho ${job}: ${erro?.message || erro}`)
    }
  }

  async function esperarTrabalho (job) {
    const comeco = agora()
    const limite = comeco + conf.esperaMaximaMs
    let estado = null
    while (agora() < limite) {
      // Passados 30s, perguntar de 5 em 5 segundos em vez de 1,5 — o download
      // curto continua respondendo rápido, e o longo para de encher o log.
      await dormir(agora() - comeco > 30000 ? ESPERA_MAXIMA_ENTRE_CONSULTAS_MS : ESPERA_ENTRE_CONSULTAS_MS)
      estado = await jsonOuErro(await chamar(`/jobs/${encodeURIComponent(job)}`), 'acompanhar o download')
      if (!EM_ANDAMENTO.has(estado?.estado)) return estado
    }
    // "vale olhar por lá" era instrução interna vazando: quem está no WhatsApp
    // não tem onde olhar. O prazo continua explícito porque é informação útil
    // (diz que houve espera, não recusa imediata), mas a orientação agora é
    // algo que a pessoa consegue mesmo fazer.
    await desistirDoTrabalho(job)
    throw new ErroDeDownload(
      `O download passou de ${Math.round(conf.esperaMaximaMs / 1000)}s sem terminar, então cancelei. Tente de novo ou envie outro link.`
    )
  }

  // TODAS as mídias do trabalho, na ordem em que o serviço as devolveu.
  //
  // Aqui morava `escolherMidia`, que ordenava e devolvia UMA. O comentário dela
  // dizia "carrossel" — o carrossel nunca existiu, só a escolha de qual
  // sobrevivia. O efeito: um post de 10 fotos do Instagram baixava as 10 e
  // entregava 1, e num post misto o vídeo ganhava da imagem, então as fotos
  // sumiam sem uma linha de aviso. Isso vinha sendo confundido com bloqueio de
  // IP; não era.
  //
  // A ordem do serviço é preservada de propósito: num post de várias fotos ela
  // é a ordem em que a pessoa publicou, e reordenar por tipo embaralharia o
  // álbum.
  function midiasDoTrabalho (midias) {
    return Array.isArray(midias) ? midias.filter((m) => m?.url) : []
  }

  async function baixar (url, modo) {
    exigirConfiguracao()

    const pedido = await jsonOuErro(await chamar('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, modo: modo || conf.modoPadrao })
    }), 'pedir o download')

    if (!pedido?.job) throw new ErroDeDownload('O serviço aceitou o pedido mas não devolveu um trabalho para acompanhar.', { paraPessoa: FALHA_NOSSA })

    const estado = await esperarTrabalho(pedido.job)
    // O serviço cancela sozinho o que travou. Sem este caso, um trabalho
    // cancelado caía no "terminou mas não veio arquivo nenhum", que manda a
    // pessoa procurar defeito no link errado.
    if (estado?.estado === 'cancelado') {
      throw new ErroDeDownload(traduzirErroDeDownload(estado.erro || 'travou'))
    }
    if (estado?.estado === 'erro') {
      console.warn('[download] Falha informada pelo serviço:', estado.erro || '(sem detalhes)')
      throw new ErroDeDownload(traduzirErroDeDownload(estado.erro))
    }

    const pendentes = midiasDoTrabalho(estado?.midias)
    if (!pendentes.length) throw new ErroDeDownload('O download terminou mas não veio arquivo nenhum.')

    // Uma única mídia grande demais é ERRO — a pessoa pediu aquilo e não
    // recebeu nada. Mas num post de várias, recusar tudo porque um vídeo passou
    // do limite entregaria zero foto por causa de um arquivo. Então: acima do
    // limite, aquela mídia fica de fora e as outras seguem; se NENHUMA couber,
    // aí sim é erro, com o tamanho da maior para a pessoa entender por quê.
    const baixadas = []
    const grandesDemais = []
    for (const midia of pendentes) {
      // O tamanho vem no próprio registro, ANTES de transferir: recusar aqui
      // evita puxar centenas de MB para descobrir no fim que o WhatsApp não
      // aceita. O serviço aceita arquivo muito maior do que o WhatsApp entrega.
      if (midia.bytes && midia.bytes > conf.limiteBytes) {
        grandesDemais.push(midia.bytes)
        continue
      }

      const resposta = await chamar(midia.url)
      if (!resposta.ok) throw new ErroDeDownload(`Não consegui buscar o arquivo baixado (${resposta.status}).`)
      const buffer = Buffer.from(await resposta.arrayBuffer())
      if (!buffer.length) throw new ErroDeDownload('O arquivo baixado veio vazio.')
      if (buffer.length > conf.limiteBytes) {
        grandesDemais.push(buffer.length)
        continue
      }

      baixadas.push({
        buffer,
        nome: midia.nome || 'midia',
        mime: midia.mime || 'application/octet-stream',
        // Tipo que o WhatsApp entende. O que o serviço não classifica vai como
        // documento, que é o único formato que aceita qualquer coisa.
        tipo: TIPO_WHATSAPP[midia.tipo] || 'document'
      })
    }

    if (!baixadas.length) {
      const maior = Math.max(...grandesDemais)
      throw new ErroDeDownload(
        `O arquivo tem ${formatarMB(maior)} e o limite para envio é ${formatarMB(conf.limiteBytes)}.`
      )
    }

    return {
      midias: baixadas,
      // Quantas ficaram de fora por tamanho. Quem entrega usa isto para avisar
      // — entregar 8 de 10 fotos calado faria a pessoa achar que o post tinha 8.
      foraPorTamanho: grandesDemais.length,
      descricao: typeof estado?.descricao === 'string' ? estado.descricao : null
    }
  }

  return { baixar, configurado: () => Boolean(conf.api && conf.token) }
}
