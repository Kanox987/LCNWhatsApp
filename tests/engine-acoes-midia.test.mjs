// Ações de mídia no motor: figurinha (vinda dos bots de referência), o
// gatilho de visualização única (o caso do anti-visualizacao-unica) e a
// fronteira que deixa a mídia de visualização única fora de qualquer ação.
//
// A garantia que estes testes protegem: o motor DECIDE sobre mídia sem nunca
// receber mídia. Ele só vê um token opaco — quem troca token por bytes é o
// processo do gateway, e só ele. Por isso metade do arquivo é o motor
// (evaluator) e metade é o gateway (gatewayExecutor com tudo injetado).
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { construirEventoDeMensagem } from '../src/engine/zapoAdapter.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import * as mediaRefCache from '../src/engine/mediaRefCache.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
const CHAT = '5511900000001@s.whatsapp.net'

function publicar (id, nodes, edges, { acceptedMessageKinds = ['text', 'image', 'view_once'] } = {}) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'contact', id: CHAT }], exclude: [] },
    inputPolicy: { acceptedMessageKinds, historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: { nodes, edges }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'contact', CHAT)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function evento (mensagem) {
  n++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${CHAT}:${CHAT}:m${n}`,
    occurredAt: agora, replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredBySelf: false },
    message: mensagem,
    providerRef: { provider: 'zapo', remoteJid: CHAT, id: `m${n}` }
  }
}
const comandosDe = (r, id) => r.results.find((x) => x.automationId === id)?.commands || []

// --- figurinha: os DOIS usos reais, montados pelo adaptador ---------------
//
// Estes casos passam pelo `construirEventoDeMensagem` de propósito. O teste
// anterior montava `{ kind: 'image', text: '/fig' }` na mão — combinação que o
// adaptador NUNCA produzia, porque a legenda da foto era descartada. O teste
// ficava verde e o comando ficava mudo no WhatsApp real. Evento de teste que o
// produtor real não consegue gerar não prova nada.
// A figurinha deixou de ser ação do motor: quem converte é um serviço
// declarado, e a ação é `connection.call` com o arquivo da mensagem. O que
// estes casos guardam continua sendo o mesmo e continua valendo — são as DUAS
// formas reais de usar um comando de mídia.
publicar('fig', [
  { id: 'g', type: 'trigger.command', config: { command: '/fig', match: 'exact_or_args', allowFrom: 'external' } },
  {
    id: 's',
    type: 'action.connection.call',
    config: {
      connectionRef: 'imagem',
      function: 'figurinha',
      mediaInput: 'arquivo',
      notFoundText: 'Manda uma imagem com /fig, ou responda uma.'
    }
  }
], [{ from: 'g', to: 's', on: 'matched' }], { acceptedMessageKinds: ['text', 'image', 'video'] })

let idMsg = 0
const chaveDireta = () => ({
  remoteJid: CHAT, id: `REAL${++idMsg}`, fromMe: false,
  isGroup: false, isBroadcast: false, isNewsletter: false
})
const doAdaptador = (message) => construirEventoDeMensagem(
  { key: chaveDireta(), message }, { accountId: 'acc-1', botId: '5511900000002@s.whatsapp.net' }
)

// USO 1: a foto vem COM o comando escrito na legenda.
const eventoLegenda = doAdaptador({ imageMessage: { url: 'x', mimetype: 'image/jpeg', caption: '/fig' } })
check('adaptador: a legenda da foto vira o texto da mensagem', eventoLegenda.message.text === '/fig', JSON.stringify(eventoLegenda.message.text))
const cmdLegenda = comandosDe(avaliarEvento(db, eventoLegenda), 'fig')[0]
check('figurinha na legenda da foto: gera a chamada ao serviço', cmdLegenda?.commandType === 'connection.call', cmdLegenda?.commandType)
check('figurinha na legenda: o payload leva TOKEN, não a mídia', typeof cmdLegenda?.payload?.mediaRef === 'string' && cmdLegenda.payload.mediaRef.length > 0)
check('figurinha na legenda: nenhum segredo de mídia no payload',
  !JSON.stringify(cmdLegenda?.payload || {}).match(/mediaKey|directPath|fileEncSha|Buffer/))

// USO 2: o comando RESPONDE uma foto já enviada.
const eventoCitando = doAdaptador({
  extendedTextMessage: {
    text: '/fig',
    contextInfo: { stanzaId: 'Q1', participant: CHAT, quotedMessage: { imageMessage: { url: 'y', mimetype: 'image/jpeg' } } }
  }
})
check('adaptador: foto comum citada NÃO é rotulada visualização única', eventoCitando.message.quotedMediaRef?.kind === 'media', eventoCitando.message.quotedMediaRef?.kind)
check('adaptador: e o tipo real da mídia citada é preservado', eventoCitando.message.quotedMediaRef?.mediaKind === 'image')
const cmdCitando = comandosDe(avaliarEvento(db, eventoCitando), 'fig')[0]
check('figurinha respondendo uma foto: gera a chamada ao serviço', cmdCitando?.commandType === 'connection.call', cmdCitando?.commandType)
check('figurinha respondendo: usa o token da mídia CITADA', cmdCitando?.payload?.mediaRef === eventoCitando.message.quotedMediaRef.token)

// USO 3: o comando sozinho, sem foto nenhuma — aí sim é o aviso.
const cmdSozinho = comandosDe(avaliarEvento(db, doAdaptador({ conversation: '/fig' })), 'fig')[0]
check('figurinha sem mídia nenhuma: não chama o serviço', cmdSozinho?.commandType !== 'connection.call')
check('figurinha sem mídia nenhuma: avisa por texto o que faltou', cmdSozinho?.payload?.text === 'Manda uma imagem com /fig, ou responda uma.')

// Legenda sem comando não pode acionar nada — o texto agora existe, então vale
// conferir que ele não casa por acidente.
const cmdLegendaComum = comandosDe(avaliarEvento(db, doAdaptador({ imageMessage: { url: 'z', caption: 'olha que foto linda' } })), 'fig')[0]
check('foto com legenda comum não aciona o comando', cmdLegendaComum === undefined)

// --- o token NÃO é legível como texto -------------------------------------
// Não existe mais lista de campos permitidos no interpolador: o que está no
// contexto é endereçável. Então a fronteira passou a ser o CONTEXTO, e é aqui
// que ela é cobrada — token é capacidade (serve pro gateway buscar bytes), não
// informação, e não pode acabar dentro de uma mensagem.
publicar('vaza', [
  { id: 'g', type: 'trigger.command', config: { command: '/vaza', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'a=[{{message.mediaRef}}] b=[{{message.quotedMediaRef}}] tipo=[{{media.kind}}]' } }
], [{ from: 'g', to: 'r', on: 'matched' }], { acceptedMessageKinds: ['text', 'image', 'video'] })

const tentaVazar = doAdaptador({ imageMessage: { url: 'x', mimetype: 'image/jpeg', caption: '/vaza' } })
const textoVazamento = comandosDe(avaliarEvento(db, tentaVazar), 'vaza')[0]?.payload?.text || ''
check('token da mídia não é legível como texto', textoVazamento.includes('a=[{{message.mediaRef}}]'), textoVazamento)
check('token da mídia citada também não', textoVazamento.includes('b=[{{message.quotedMediaRef}}]'), textoVazamento)
check('mas o TIPO da mídia é legível — é dado, não segredo', textoVazamento.includes('tipo=[image]'), textoVazamento)
check('nenhum token real aparece na mensagem', !textoVazamento.includes(tentaVazar.message.mediaRef))

// --- visualização única: classificada, mas sem token -----------------------
// A recuperação de visualização única saiu: a Meta mudou o tratamento desses
// arquivos. Com ela sai também a recuperação disfarçada — uma figurinha, um
// acervo ou uma conexão respondendo uma visu única. O adaptador continua
// dizendo O QUE chegou (kind, tipo real, legenda), porque o anti-visualizacao-
// unica decide por isso; só não entrega mais token para buscar os bytes.
const tokensAntes = mediaRefCache._tamanho()

const visuChegando = doAdaptador({ viewOnceMessageV2: { message: { imageMessage: { url: 'auto', viewOnce: true, caption: 'segredo' } } } })
check('adaptador: visu única própria continua classificada view_once', visuChegando.message.kind === 'view_once', visuChegando.message.kind)
check('adaptador: visu única própria expõe o tipo real', visuChegando.message.mediaKind === 'image', visuChegando.message.mediaKind)
check('adaptador: e a legenda original da mídia', visuChegando.message.mediaCaption === 'segredo', visuChegando.message.mediaCaption)
check('adaptador: visu única própria NÃO gera mediaRef', visuChegando.message.mediaRef === undefined, visuChegando.message.mediaRef)

// A marcação pode vir só na chave (isViewOnce), com a mídia sem envelope.
const visuPelaChave = construirEventoDeMensagem(
  { key: { ...chaveDireta(), isViewOnce: true }, message: { imageMessage: { url: 'chave', mimetype: 'image/jpeg' } } },
  { accountId: 'acc-1', botId: '5511900000002@s.whatsapp.net' }
)
check('adaptador: visu única marcada na chave também é view_once', visuPelaChave.message.kind === 'view_once', visuPelaChave.message.kind)
check('adaptador: e também não gera mediaRef', visuPelaChave.message.mediaRef === undefined)

const visuCitadaPorFig = doAdaptador({
  extendedTextMessage: {
    text: '/fig',
    contextInfo: { stanzaId: 'Q3', participant: CHAT, quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { url: 'v', viewOnce: true } } } } }
  }
})
check('adaptador: visu única CITADA não gera token', !visuCitadaPorFig.message.quotedMediaRef?.token, JSON.stringify(visuCitadaPorFig.message.quotedMediaRef))
check('adaptador: a citação em si continua conhecida', visuCitadaPorFig.message.quotedRef?.id === 'Q3')
check('adaptador: nenhum token de mídia foi criado para visu única', mediaRefCache._tamanho() === tokensAntes, `${tokensAntes} -> ${mediaRefCache._tamanho()}`)

const figNaVisu = comandosDe(avaliarEvento(db, visuCitadaPorFig), 'fig')[0]
check('figurinha respondendo visu única: não chama o serviço (nada é baixado)', figNaVisu?.commandType !== 'connection.call', figNaVisu?.commandType)
check('figurinha respondendo visu única: nenhum comando leva mediaRef', !figNaVisu?.payload?.mediaRef)
check('figurinha respondendo visu única: avisa como se não houvesse mídia', figNaVisu?.payload?.text === 'Manda uma imagem com /fig, ou responda uma.', figNaVisu?.payload?.text)

// --- comando na PRÓPRIA mensagem (uso pessoal) ---------------------------
// Mandar a mensagem do número onde o bot roda e usar o comando ali mesmo é o
// caso normal de quem só quer o bot para si. Com allowFrom 'external' isso NÃO
// dispara — a regra existe para o bot não reagir a si mesmo. 'any' abre para
// comando digitado, e só para ele: a barreira do gatilho AUTOMÁTICO continua
// não sendo configurável, porque lá reagir à própria mensagem vira laço.
publicar('eco-proprio', [
  { id: 'g', type: 'trigger.command', config: { command: '/eco', match: 'exact_or_args', allowFrom: 'any' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'eco' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

publicar('eco-externo', [
  { id: 'g', type: 'trigger.command', config: { command: '/ecoext', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'eco' } }
], [{ from: 'g', to: 'r', on: 'matched' }])

const meuProprioEvento = (texto) => {
  const e = doAdaptador({ conversation: texto })
  e.sender.authoredBySelf = true
  return e
}

const proprio = comandosDe(avaliarEvento(db, meuProprioEvento('/eco')), 'eco-proprio')[0]
check('comando com allowFrom "any" responde à própria mensagem', proprio?.commandType === 'whatsapp.reply', proprio?.commandType)

const externo = comandosDe(avaliarEvento(db, meuProprioEvento('/ecoext')), 'eco-externo')
check('comando com allowFrom "external" continua ignorando a própria mensagem', externo.length === 0)

// --- gatilho de visualização única: o caso do anti-visualizacao-unica -----
// Sem citação e sem comando: trigger.message filtrando view_once e apagando.
// Ele decide só pelo `kind` — não precisa de token, e é por isso que continua
// valendo com a visu única fora de qualquer ação de mídia.
publicar('anti-visu', [
  { id: 'g', type: 'trigger.message', config: { allowFrom: 'external', messageKinds: ['view_once'] } },
  { id: 'r', type: 'action.whatsapp.delete', config: {} }
], [{ from: 'g', to: 'r', on: 'matched' }], { acceptedMessageKinds: ['view_once'] })

const visuDeTerceiro = doAdaptador({ viewOnceMessageV2: { message: { imageMessage: { url: 'terceiro', viewOnce: true } } } })
const cmdAnti = comandosDe(avaliarEvento(db, visuDeTerceiro), 'anti-visu')
check('visu única de terceiro: gera whatsapp.delete', cmdAnti[0]?.commandType === 'whatsapp.delete', cmdAnti[0]?.commandType)
check('visu única de terceiro: apaga a PRÓPRIA mensagem que chegou', cmdAnti[0]?.payload?.messageRef?.id === visuDeTerceiro.providerRef.id)
check('visu única de terceiro: só o apagar, nada de mídia', cmdAnti.length === 1 && !JSON.stringify(cmdAnti).includes('mediaRef'))

const fotoComum = doAdaptador({ imageMessage: { url: 'comum', mimetype: 'image/jpeg' } })
check('foto comum não aciona o gatilho de visu única', comandosDe(avaliarEvento(db, fotoComum), 'anti-visu').length === 0)

// A barreira do gatilho automático NÃO é configurável: continua absoluta.
const autoProprio = doAdaptador({ viewOnceMessageV2: { message: { imageMessage: { url: 'loop', viewOnce: true } } } })
autoProprio.sender.authoredBySelf = true
check('gatilho automático nunca reage à própria mensagem, aconteça o que acontecer', comandosDe(avaliarEvento(db, autoProprio), 'anti-visu').length === 0)

// --- lado do gateway ------------------------------------------------------
const engineFake = { execucoes: { confirmar: async () => ({ ok: true }) } }

const depsFig = {
  mediaRefCache: { resolver: (t) => (t === 'ok' ? { node: {}, tipo: 'image', interno: {} } : null) },
  baixarBuffer: async () => Buffer.from('imagem-crua'),
  limiteBytes: 1000
}

// O envio COMO figurinha continua existindo — ele virou parte da entrega da
// chamada de conexão, e está coberto em tests/conexao-imagem.test.mjs, onde o
// serviço declara `tipo: figurinha` e o gateway manda `type: 'sticker'`.

function clienteFake () {
  const enviados = []
  return { enviados, message: { send: async (jid, conteudo) => { enviados.push({ jid, conteudo }); return { ok: true } } } }
}

// A recuperação saiu do gateway junto com a ação: um comando antigo que ainda
// esteja na fila não pode virar envio de mídia.
const cAntigo = clienteFake()
let baixou = false
await executarComandos(cAntigo, [{ id: 'r1', commandType: 'whatsapp.recover', payload: { chatId: CHAT, destination: 'same_chat', destinationId: CHAT, mediaRef: 'ok' } }],
  engineFake, { ...depsFig, baixarBuffer: async () => { baixou = true; return Buffer.from('x') } })
check('gateway: comando whatsapp.recover antigo não envia nada', cAntigo.enviados.length === 0)
check('gateway: e não baixa mídia nenhuma', baixou === false)

const c5 = clienteFake()
await executarComandos(c5, [{ id: 'c5', commandType: 'whatsapp.inventado', payload: {} }], engineFake, depsFig)
check('gateway: comando desconhecido continua recusado', c5.enviados.length === 0)

// --- mensagem rica: caminho não oficial, com queda obrigatória para texto --
publicar('rico', [
  { id: 'g', type: 'trigger.command', config: { command: '/codigo', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.rich', config: { text: 'const x = 1', richKind: 'code', language: 'javascript', fallbackText: 'const x = 1' } }
], [{ from: 'g', to: 'r', on: 'matched' }])
const rRico = avaliarEvento(db, evento({ kind: 'text', text: '/codigo' }))
const cmdRico = comandosDe(rRico, 'rico')[0]
check('rich: gera comando whatsapp.rich', cmdRico?.commandType === 'whatsapp.rich')
check('rich: SEMPRE leva texto de reserva (o caminho oficial pode sumir)', typeof cmdRico?.payload?.fallbackText === 'string' && cmdRico.payload.fallbackText.length > 0)

function clienteRico (falhar) {
  const enviados = []
  return { enviados, message: { send: async (jid, c) => { if (c?.botForwardedMessage && falhar) throw new Error('formato recusado'); enviados.push({ jid, conteudo: c }); return { ok: true } } } }
}
const cr1 = clienteRico(false)
await executarComandos(cr1, [{ id: 'x1', commandType: 'whatsapp.rich', payload: { chatId: CHAT, text: 'const x = 1', richKind: 'code', language: 'javascript', fallbackText: 'const x = 1' } }], engineFake, depsFig)
check('gateway: monta a mensagem no envelope de resposta rica', !!cr1.enviados[0]?.conteudo?.botForwardedMessage?.message?.richResponseMessage)
const ctx = cr1.enviados[0]?.conteudo?.botForwardedMessage?.message?.richResponseMessage?.contextInfo
check('gateway: o envelope declara a origem que destrava a formatação', ctx?.forwardedAiBotMessageInfo?.botJid === '867051314767696@bot')

const cr2 = clienteRico(true)
await executarComandos(cr2, [{ id: 'x2', commandType: 'whatsapp.rich', payload: { chatId: CHAT, text: 'const x = 1', fallbackText: 'const x = 1' } }], engineFake, depsFig)
check('gateway: se o WhatsApp recusar o formato, cai para texto comum', cr2.enviados[0]?.conteudo?.type === 'text')
check('gateway: o texto de reserva preserva o conteúdo', cr2.enviados[0]?.conteudo?.text === 'const x = 1')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODAS AS AÇÕES DE MÍDIA PASSARAM')
process.exit(falhas ? 1 : 0)
