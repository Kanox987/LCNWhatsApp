// Reconhecer link que é POST DE MÍDIA de rede conhecida.
//
// O download automático reagia a qualquer link. Os três primeiros casos de
// "ignora" abaixo são erros REAIS de produção: um post de comunidade do
// YouTube, um arquivo no MediaFire e um link de loja. Nenhum tem mídia, mas o
// bot já tinha mandado "⏳ Baixando…" antes de descobrir — a pessoa recebia uma
// promessa seguida de um pedido de desculpa.
//
// A regra é: desconhecido se IGNORA, nunca se tenta.
import { ehLinkDeMidia, REDES, redeDoLinkDeMidia } from '../src/engine/linkDeMidia.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// --- o que DEVE baixar ----------------------------------------------------
const aceitos = [
  ['https://www.instagram.com/reel/DbJwx_usquw/?igsh=MTFuY3hl', 'instagram'],
  ['https://www.instagram.com/p/DdUtLK0tLPE/?stkn=MTc5', 'instagram'],
  ['https://www.instagram.com/fulano/reel/ABC123/', 'instagram'],
  ['https://instagram.com/tv/XYZ789/', 'instagram'],
  ['https://youtube.com/shorts/He5KEaJlKfw?is=G7lbqYNf', 'youtube'],
  ['https://www.youtube.com/watch?v=9RcvSKOAhWA', 'youtube'],
  ['https://youtu.be/9RcvSKOAhWA', 'youtube'],
  ['https://m.youtube.com/shorts/abc123', 'youtube'],
  ['https://vt.tiktok.com/ZSqC98CC6/', 'tiktok'],
  ['https://vm.tiktok.com/ZMabc/', 'tiktok'],
  ['https://www.tiktok.com/@j4mily.y/video/7685163876786146581', 'tiktok'],
  ['https://www.tiktok.com/@alguem/photo/123456', 'tiktok'],
  ['https://br.pinterest.com/pin/1234567890/', 'pinterest'],
  ['https://pin.it/abcDEF', 'pinterest'],
  ['https://x.com/fulano/status/1234567890', 'x'],
  ['https://twitter.com/fulano/status/1234567890', 'x'],
  ['https://fb.watch/xyzABC/', 'facebook'],
  ['https://www.facebook.com/reel/1234567890', 'facebook'],
  ['https://www.reddit.com/r/videos/comments/abc123/titulo/', 'reddit'],
  ['https://v.redd.it/abc123', 'reddit'],
  ['https://www.threads.net/@fulano/post/ABC123', 'threads']
]
for (const [url, rede] of aceitos) {
  const achou = redeDoLinkDeMidia(url)
  check(`baixa: ${url.slice(0, 52)}`, achou === rede, `veio ${achou}`)
}

// Sem esquema, que é como o WhatsApp mostra e como as pessoas colam.
check('link colado sem https funciona', redeDoLinkDeMidia('instagram.com/p/DdRTHO') === 'instagram')

// --- o que DEVE ignorar ---------------------------------------------------
const ignorados = [
  // Erros reais de produção.
  'http://youtube.com/post/UgkxFt0fJkrw_yAr9sa2h10kTp8Wkyfgw7qQ?si=7E7Io',
  'https://www.mediafire.com/file/0npdmv51pnttps0/com.termux_1020.apk',
  'https://www.vorake.com.br/search?type=product&options%5Bprefix%5D=last',
  // Perfil e canal não são post.
  'https://www.youtube.com/@canal',
  'https://www.youtube.com/channel/UCabc',
  'https://www.youtube.com/playlist?list=PLabc',
  'https://instagram.com/fulano',
  'https://www.tiktok.com/@fulano',
  'https://www.reddit.com/r/videos/',
  // /watch sem o v= é a home do player, não um vídeo.
  'https://www.youtube.com/watch',
  // Genéricos.
  'https://google.com',
  'https://drive.google.com/file/d/abc/view',
  'https://example.com/foto.jpg'
]
for (const url of ignorados) {
  check(`ignora: ${url.slice(0, 52)}`, redeDoLinkDeMidia(url) === null, `casou como ${redeDoLinkDeMidia(url)}`)
}

// --- domínio parecido NÃO é a rede ---------------------------------------
// `instagram.com.golpe.net` tem "instagram.com" dentro. Casar por "contém"
// transformaria o filtro numa porta aberta para qualquer domínio inventado.
{
  const falsos = [
    'https://instagram.com.golpe.net/p/abc',
    'https://youtube.com.br.falso.io/shorts/abc',
    'https://meu-tiktok.com/@x/video/1',
    'https://naoeinstagram.com/p/abc'
  ]
  for (const url of falsos) {
    check(`domínio parecido não passa: ${url.slice(0, 44)}`, redeDoLinkDeMidia(url) === null,
      `casou como ${redeDoLinkDeMidia(url)}`)
  }
  // Mas subdomínio de verdade passa.
  check('subdomínio real da rede passa', redeDoLinkDeMidia('https://m.facebook.com/reel/123') === 'facebook')
}

// --- entrada estranha não quebra -----------------------------------------
for (const ruim of [null, undefined, '', '   ', 'não é link', 'javascript:alert(1)', 'ftp://x.com/a', {}, 42]) {
  check(`entrada inválida devolve null: ${JSON.stringify(ruim)}`, redeDoLinkDeMidia(ruim) === null)
}
check('ehLinkDeMidia é o mesmo julgamento',
  ehLinkDeMidia('https://youtu.be/9RcvSKOAhWA') === true && ehLinkDeMidia('https://google.com') === false)
// Id do YouTube tem 11 caracteres. O mínimo existe para "youtu.be/" sozinho, ou
// com um resto qualquer, não virar um download prometido.
check('youtu.be sem id de verdade é ignorado',
  ehLinkDeMidia('https://youtu.be/') === false && ehLinkDeMidia('https://youtu.be/ab') === false)

// --- a lista é dado, e precisa continuar sendo ---------------------------
{
  check('toda rede declara domínios', REDES.every((r) => Array.isArray(r.dominios) && r.dominios.length))
  // Uma letra basta: a rede do Twitter se chama "x".
  check('toda rede tem nome', REDES.every((r) => typeof r.rede === 'string' && r.rede.length >= 1))
  check('toda rede sabe reconhecer alguma coisa',
    REDES.every((r) => (r.caminhos?.length || 0) > 0 || typeof r.query === 'function'))
  // Devolver o NOME da rede (e não só sim/não) é o que permite descobrir
  // depois qual rede está faltando.
  check('as redes pedidas estão cobertas',
    ['instagram', 'youtube', 'tiktok', 'pinterest'].every((r) => REDES.some((x) => x.rede === r)))
}

// --- o gatilho realmente usa o filtro ------------------------------------
// O reconhecedor certo ligado no lugar errado não filtra nada.
{
  const { abrirBanco } = await import('../src/engine/server/db.js')
  const { avaliarEvento } = await import('../src/engine/server/evaluator.js')
  const { criarServicoAutomacoes } = await import('../src/engine/server/automationsService.js')
  const db = abrirBanco(':memory:')
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?,?,?,?)').run('p', 'P', agora, agora)

  const doc = {
    schemaVersion: 1,
    enabled: true,
    name: 'Baixa',
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', containsLink: true, mediaLinkOnly: true } },
        { id: 'b', type: 'action.whatsapp.reply', config: { text: 'baixando' } }
      ],
      edges: [{ from: 'g', to: 'b', on: 'matched' }]
    }
  }
  criarServicoAutomacoes(db).criarEPublicar({ id: 'baixa', document: doc })
  db.prepare("UPDATE automations SET deployment_mode='live' WHERE id='baixa'").run()

  let n = 0
  const disparou = (texto) => {
    const r = avaliarEvento(db, {
      provider: 'zapo',
      accountId: 'c',
      eventId: `c:chat:quem:m${++n}`,
      occurredAt: agora,
      replay: false,
      chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
      sender: { id: '5511@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
      message: { kind: 'text', text: texto },
      providerRef: { provider: 'zapo', id: `m${n}` }
    })
    return (r.results || []).some((x) => x.status === 'matched_live')
  }

  check('reel do Instagram dispara', disparou('olha isso https://www.instagram.com/reel/ABC123/'))
  check('Shorts do YouTube dispara', disparou('vê https://youtube.com/shorts/abc123'))
  check('post de comunidade do YouTube NÃO dispara', disparou('http://youtube.com/post/Ugkabc') === false)
  check('link do MediaFire NÃO dispara', disparou('https://www.mediafire.com/file/x/app.apk') === false)
  check('link de loja NÃO dispara', disparou('https://www.vorake.com.br/search?type=product') === false)
  check('mensagem sem link nenhum NÃO dispara', disparou('bom dia') === false)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE LINK DE MÍDIA PASSARAM')
process.exit(falhas ? 1 : 0)
