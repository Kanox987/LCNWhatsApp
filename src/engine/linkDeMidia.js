// Reconhece link que é POST DE MÍDIA de uma rede conhecida.
//
// O download automático reagia a qualquer link. Na prática isso vira ruído e
// erro: link de loja, de notícia, de arquivo em nuvem, post de comunidade do
// YouTube — nada disso tem vídeo ou foto para baixar, mas o bot já tinha
// mandado "⏳ Baixando…" antes de descobrir.
//
// A lista é FECHADA e o desconhecido é IGNORADO, não tentado. É a diferença
// entre "não reconheci, então não é comigo" e "vou tentar e pedir desculpa" —
// e só a primeira evita prometer o que não vai cumprir.
//
// Isto vale para o automático. O comando manual continua tentando qualquer
// link: ali a pessoa pediu de propósito, e recusar seria decidir por ela.

// Cada rede diz quais domínios são dela e que FORMA de caminho é um post.
// Adicionar uma rede é acrescentar uma entrada — por isso é dado, não código.
export const REDES = Object.freeze([
  {
    rede: 'instagram',
    dominios: ['instagram.com', 'instagr.am', 'ig.me'],
    caminhos: [
      /^\/(reel|reels|p|tv)\/[\w-]+/,
      // Post dentro do perfil: /fulano/p/ABC, /fulano/reel/ABC
      /^\/[\w.]+\/(reel|reels|p|tv)\/[\w-]+/,
      // Stories de um perfil específico têm mídia; o /stories/ solto não.
      /^\/stories\/[\w.]+\/\d+/
    ]
  },
  {
    rede: 'youtube',
    dominios: ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'],
    caminhos: [/^\/shorts\/[\w-]+/, /^\/live\/[\w-]+/, /^\/embed\/[\w-]+/],
    // /watch só é vídeo com o v=; sem ele é a home do player.
    query: (url) => url.pathname === '/watch' && Boolean(url.searchParams.get('v'))
  },
  {
    rede: 'youtube',
    dominios: ['youtu.be'],
    caminhos: [/^\/[\w-]{5,}/]
  },
  {
    rede: 'tiktok',
    dominios: ['tiktok.com', 'm.tiktok.com', 'www.tiktok.com'],
    caminhos: [/^\/@[\w.-]+\/(video|photo)\/\d+/, /^\/v\/\d+/]
  },
  {
    // Encurtador do TikTok: o caminho é opaco, e o domínio já diz que é post.
    rede: 'tiktok',
    dominios: ['vm.tiktok.com', 'vt.tiktok.com'],
    caminhos: [/^\/[\w-]+/]
  },
  {
    rede: 'pinterest',
    dominios: ['pinterest.com', 'pinterest.co.uk', 'pinterest.fr', 'pinterest.de', 'br.pinterest.com'],
    caminhos: [/^\/pin\/[\w-]+/]
  },
  {
    rede: 'pinterest',
    dominios: ['pin.it'],
    caminhos: [/^\/[\w-]+/]
  },
  {
    rede: 'facebook',
    dominios: ['facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com'],
    caminhos: [
      /^\/reel\/\d+/,
      /^\/share\/[rv]\/[\w-]+/,
      /^\/[\w.]+\/videos\/\d+/,
      /^\/photo/
    ],
    query: (url) => url.pathname === '/watch' && Boolean(url.searchParams.get('v'))
  },
  {
    rede: 'facebook',
    dominios: ['fb.watch'],
    caminhos: [/^\/[\w-]+/]
  },
  {
    rede: 'x',
    dominios: ['twitter.com', 'x.com', 'mobile.twitter.com', 'fxtwitter.com', 'vxtwitter.com'],
    caminhos: [/^\/[\w]+\/status\/\d+/]
  },
  {
    rede: 'reddit',
    dominios: ['reddit.com', 'old.reddit.com', 'www.reddit.com'],
    caminhos: [/^\/r\/[\w]+\/comments\/[\w]+/, /^\/r\/[\w]+\/s\/[\w]+/]
  },
  {
    rede: 'reddit',
    dominios: ['v.redd.it', 'redd.it'],
    caminhos: [/^\/[\w-]+/]
  },
  {
    rede: 'kwai',
    dominios: ['kwai.com', 'kwai-video.com', 'k.kwai.com', 'm.kwai.com'],
    caminhos: [/^\/[\w@/-]+/]
  },
  {
    rede: 'threads',
    dominios: ['threads.net', 'threads.com'],
    caminhos: [/^\/@[\w.]+\/post\/[\w-]+/, /^\/t\/[\w-]+/]
  }
])

// `www.` é ruído para esta decisão, e um subdomínio de outra coisa NÃO é a
// rede: `instagram.com.golpe.net` não pode casar com instagram.
function hostCasa (host, dominio) {
  const limpo = host.replace(/^www\./, '')
  return limpo === dominio || limpo.endsWith(`.${dominio}`)
}

// A entrada pode vir sem esquema ("instagram.com/p/x"), que é como o WhatsApp
// mostra e como as pessoas colam.
function comEsquema (bruto) {
  const texto = String(bruto || '').trim()
  if (!texto) return null
  try {
    return new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`)
  } catch {
    return null
  }
}

// Devolve o nome da rede quando o link é um post de mídia, ou null.
// Devolver o nome (e não só true) é de propósito: quem chama pode registrar
// QUAL rede casou, e isso é o que permite descobrir depois qual rede está
// faltando na lista.
export function redeDoLinkDeMidia (bruto) {
  const url = comEsquema(bruto)
  if (!url) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  for (const entrada of REDES) {
    if (!entrada.dominios.some((d) => hostCasa(url.hostname, d))) continue
    if (entrada.caminhos?.some((re) => re.test(url.pathname))) return entrada.rede
    if (entrada.query?.(url)) return entrada.rede
  }
  return null
}

export function ehLinkDeMidia (bruto) {
  return redeDoLinkDeMidia(bruto) !== null
}
