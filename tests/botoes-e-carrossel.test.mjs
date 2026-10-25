// Testes para botões de resposta rápida e carrossel de valores próprios.
//
// Cobre o contrato completo nas quatro camadas:
//   1. Linguagem (.lcn): compilar e descompilar preservando botões e carrossel.
//   2. Capacidades e Schema: validação no schema e catalogação em acoes.js.
//   3. Motor (evaluator): geração dos comandos whatsapp.buttons e whatsapp.carousel.
//   4. Gateway (gatewayExecutor):
//      - botões como quick_reply e fallback para texto em caso de recusa.
//      - carrossel de valores próprios e pasta do acervo com contrato de
//        carregador tardio ({ id, nome, mime, tipo, bytes, carregar() }) e
//        orçamento de bytes (reserva antes de alocar, liberação por card).
//      - fallback para texto quando envio interativo falha.
//   5. Catálogo de templates: compilação dos templates botoes-escolha e carrossel-fotos.

import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { ACOES } from '../src/lcn/vocabulario.js'
import { ACOES_SUPORTADAS } from '../src/engine/server/runtimeCapabilities.js'
import { ACOES as ACOES_TELA, acharDefinicao, todosOsTipos } from '../src/web/public/logic/acoes.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import fs from 'fs'

let falhas = 0
const check = (nome, ok, extra) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`)
}

const canon = (v) => Array.isArray(v)
  ? v.map(canon)
  : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v
const mesmo = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

const CHAT = '5511999990000@s.whatsapp.net'
const POOL = 'pool-teste'

// --- 1. Vocabulário e Capacidades --------------------------------------------
check('ACOES_SUPORTADAS inclui action.whatsapp.buttons', ACOES_SUPORTADAS.includes('action.whatsapp.buttons'))
check('ACOES_SUPORTADAS inclui action.whatsapp.carousel', ACOES_SUPORTADAS.includes('action.whatsapp.carousel'))

const defBotoes = ACOES.find((a) => a.tipo === 'action.whatsapp.buttons')
check('vocabulario define "responde com botões"', defBotoes?.palavra === 'responde com botões')

const defCarrossel = ACOES.find((a) => a.tipo === 'action.whatsapp.carousel')
check('vocabulario define "mostra carrossel"', defCarrossel?.palavra === 'mostra carrossel')

// --- 2. Schema e Tela (acoes.js) ---------------------------------------------
const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const defSchemaBotoes = acharDefinicao(schema, 'action.whatsapp.buttons')
check('schema define actionWhatsappButtons', !!defSchemaBotoes)
check('schema actionWhatsappButtons requer text e buttons',
  defSchemaBotoes?.properties?.config?.required?.includes('text') &&
  defSchemaBotoes?.properties?.config?.required?.includes('buttons'))

const defSchemaCarrossel = acharDefinicao(schema, 'action.whatsapp.carousel')
check('schema define actionWhatsappCarousel', !!defSchemaCarrossel)

const telaBotoes = ACOES_TELA.find((a) => a.tipo === 'action.whatsapp.buttons')
check('acoes.js da tela documenta action.whatsapp.buttons', !!telaBotoes && telaBotoes.familia === 'resposta')

const telaCarrossel = ACOES_TELA.find((a) => a.tipo === 'action.whatsapp.carousel')
check('acoes.js da tela documenta action.whatsapp.carousel', !!telaCarrossel && telaCarrossel.familia === 'midia')

// --- 3. Compilação e Descompilação (Ida e Volta) ------------------------------
// Caso 3.1: Botões de resposta rápida
const lcnBotoes = `automação
  tipo: comando
  dispara com: /opcoes
  nome: opcoes
  onde: em qualquer lugar
  pool: p1
  acessa: texto
  casa: exato
  quem: só externos

  responde com botões "Escolha uma cor:"
    botão "Vermelho": "/cor vermelho"
    botão "Verde": "/cor verde"
    botão "Azul": "/cor azul"
    rodapé: "Cores primárias"
    senão: "Opções: 1. Vermelho, 2. Verde, 3. Azul"
`

const docBotoes = compilar(lcnBotoes)
const noBotoes = docBotoes?.flow?.nodes?.find((n) => n.type === 'action.whatsapp.buttons')
check('compilar "responde com botões" extrai o texto', noBotoes?.config?.text === 'Escolha uma cor:')
check('compilar "responde com botões" extrai 3 botões', noBotoes?.config?.buttons?.length === 3)
check('botão 1 tem rótulo e comando corretos', noBotoes?.config?.buttons?.[0]?.text === 'Vermelho' && noBotoes?.config?.buttons?.[0]?.command === '/cor vermelho')
check('botão 2 tem rótulo e comando corretos', noBotoes?.config?.buttons?.[1]?.text === 'Verde' && noBotoes?.config?.buttons?.[1]?.command === '/cor verde')
check('extrai rodapé e fallbackText', noBotoes?.config?.footer === 'Cores primárias' && noBotoes?.config?.fallbackText === 'Opções: 1. Vermelho, 2. Verde, 3. Azul')

// Limite de 3 botões
let erroLimite = null
try {
  compilar(`automação
  tipo: comando
  dispara com: /quatro
  nome: quatro
  pool: p
  acessa: texto
  casa: exato
  quem: qualquer um
  responde com botões "Escolha:"
    botão "1": /1
    botão "2": /2
    botão "3": /3
    botão "4": /4
`)
} catch (e) {
  erroLimite = e.message
}
check('rejeita mais de 3 botões no WhatsApp', erroLimite && erroLimite.includes('no máximo 3 botões'))

// Ida e volta de botões
const textoDescompiladoBotoes = descompilar(docBotoes)
check('descompilador inclui "responde com botões"', textoDescompiladoBotoes.includes('responde com botões "Escolha uma cor:"'))
check('descompilador inclui os botões', textoDescompiladoBotoes.includes('botão "Vermelho": "/cor vermelho"'))
const docRecompiladoBotoes = compilar(textoDescompiladoBotoes)
check('ida e volta de botões preserva o documento', mesmo(docBotoes, docRecompiladoBotoes))

// Caso 3.2: Carrossel com cards declarados
const lcnCarrosselCards = `automação
  tipo: comando
  dispara com: /produtos
  nome: produtos
  onde: em qualquer lugar
  pool: p1
  acessa: texto
  casa: exato
  quem: só externos

  mostra carrossel "Nossos Destaques:"
    card
      arquivo: "fotos/tenis.jpg"
      título: "Tênis Runner"
      corpo: "R$ 299,00"
      rodapé: "Pronta entrega"
      botão: "Comprar": "/comprar tenis"
    card
      arquivo: "fotos/camisa.jpg"
      título: "Camisa Dry"
      corpo: "R$ 89,00"
      botão: "Ver": "/ver camisa"
    rodapé: "Deslize para ver os itens"
    estilo: bizNoStanza
    senão: "Veja nossos produtos no site"
`

const docCarrossel = compilar(lcnCarrosselCards)
const noCarrossel = docCarrossel?.flow?.nodes?.find((n) => n.type === 'action.whatsapp.carousel')
check('compilar "mostra carrossel" extrai o texto de abertura', noCarrossel?.config?.text === 'Nossos Destaques:')
check('extrai 2 cards declarados', noCarrossel?.config?.cards?.length === 2)
check('card 1 tem arquivo, título, corpo, rodapé e botão',
  noCarrossel?.config?.cards?.[0]?.path === 'fotos/tenis.jpg' &&
  noCarrossel?.config?.cards?.[0]?.title === 'Tênis Runner' &&
  noCarrossel?.config?.cards?.[0]?.body === 'R$ 299,00' &&
  noCarrossel?.config?.cards?.[0]?.footer === 'Pronta entrega' &&
  noCarrossel?.config?.cards?.[0]?.buttonText === 'Comprar' &&
  noCarrossel?.config?.cards?.[0]?.buttonCommand === '/comprar tenis')
check('extrai estilo bizNoStanza e rodapé',
  noCarrossel?.config?.estilo === 'bizNoStanza' &&
  noCarrossel?.config?.footer === 'Deslize para ver os itens')

const textoDescompiladoCarrossel = descompilar(docCarrossel)
check('descompilador inclui "mostra carrossel"', textoDescompiladoCarrossel.includes('mostra carrossel "Nossos Destaques:"'))
check('descompilador inclui cards', textoDescompiladoCarrossel.includes('arquivo: "fotos/tenis.jpg"'))
const docRecompiladoCarrossel = compilar(textoDescompiladoCarrossel)
check('ida e volta de carrossel com cards preserva o documento', mesmo(docCarrossel, docRecompiladoCarrossel))

// Caso 3.3: Carrossel a partir de pasta do acervo
const lcnCarrosselPasta = `automação
  tipo: comando
  dispara com: /galeria
  nome: galeria
  onde: em qualquer lugar
  pool: p1
  acessa: texto
  casa: exato
  quem: só externos

  mostra carrossel "Galeria de Fotos"
    pasta: "eventos/fotos"
    botão: "Ampliar"
    comando: "/ampliar {{nome}}"
    rodapé: "Eventos 2026"
    estilo: completo
    sem arquivo: "Nenhuma foto disponível no momento"
    senão: "Veja as fotos no nosso portal"
`

const docPasta = compilar(lcnCarrosselPasta)
const noPasta = docPasta?.flow?.nodes?.find((n) => n.type === 'action.whatsapp.carousel')
check('compilar carrossel de pasta extrai pasta', noPasta?.config?.folder === 'eventos/fotos')
check('extrai botão e comando com placeholder', noPasta?.config?.buttonText === 'Ampliar' && noPasta?.config?.buttonCommand === '/ampliar {{nome}}')
check('extrai sem arquivo e senão', noPasta?.config?.notFoundText === 'Nenhuma foto disponível no momento' && noPasta?.config?.fallbackText === 'Veja as fotos no nosso portal')

const textoDescompiladoPasta = descompilar(docPasta)
check('descompilador preserva pasta e botão', textoDescompiladoPasta.includes('pasta: "eventos/fotos"') && textoDescompiladoPasta.includes('botão: "Ampliar"'))
const docRecompiladoPasta = compilar(textoDescompiladoPasta)
check('ida e volta de carrossel de pasta preserva o documento', mesmo(docPasta, docRecompiladoPasta))

// --- 4. Avaliador (evaluator.js) ---------------------------------------------
const agora = new Date().toISOString()
const db = abrirBanco(':memory:')
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run(POOL, 'Pool Principal', agora, agora)

function instalarNoBanco (documento, id) {
  const doc = {
    ...documento,
    id,
    schemaVersion: 1,
    revision: 1,
    name: id,
    enabled: true,
    scope: { include: [{ kind: 'contact', id: CHAT }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: POOL }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'contact', CHAT)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

instalarNoBanco(docBotoes, 'auto-botoes')
instalarNoBanco(docCarrossel, 'auto-carrossel')

let seqMsg = 0
function criarEvento (texto) {
  seqMsg++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${CHAT}:${CHAT}:m${seqMsg}`,
    occurredAt: agora, replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredByBot: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: CHAT, id: `m${seqMsg}` }
  }
}

// Avaliação de botões
const resBotoes = avaliarEvento(db, criarEvento('/opcoes'))
const cmdBotoes = resBotoes.results.find((r) => r.automationId === 'auto-botoes')?.commands?.[0]
check('evaluator gera commandType "whatsapp.buttons"', cmdBotoes?.commandType === 'whatsapp.buttons')
check('payload contém text interpolado', cmdBotoes?.payload?.text === 'Escolha uma cor:')
check('payload contém lista de botões com text e id', cmdBotoes?.payload?.buttons?.length === 3 && cmdBotoes?.payload?.buttons?.[0]?.id === '/cor vermelho')
check('payload contém footer e fallbackText', cmdBotoes?.payload?.footer === 'Cores primárias' && cmdBotoes?.payload?.fallbackText === 'Opções: 1. Vermelho, 2. Verde, 3. Azul')

// Avaliação de carrossel
const resCarrossel = avaliarEvento(db, criarEvento('/produtos'))
const cmdCarrossel = resCarrossel.results.find((r) => r.automationId === 'auto-carrossel')?.commands?.[0]
check('evaluator gera commandType "whatsapp.carousel"', cmdCarrossel?.commandType === 'whatsapp.carousel')
check('payload contém text e estilo', cmdCarrossel?.payload?.text === 'Nossos Destaques:' && cmdCarrossel?.payload?.estilo === 'bizNoStanza')
check('payload contém cards', cmdCarrossel?.payload?.cards?.length === 2 && cmdCarrossel?.payload?.cards?.[0]?.title === 'Tênis Runner')

// --- 5. Gateway Executor (gatewayExecutor.js) --------------------------------
function mockGatewayClient (falharSend = false) {
  const envios = []
  const uploads = []
  return {
    envios,
    uploads,
    message: {
      send: async (chatId, conteudo, opcoes) => {
        if (falharSend && conteudo?.type !== 'text') {
          throw new Error('falha simulada ao enviar mensagem interativa')
        }
        envios.push({ chatId, conteudo, opcoes })
        return { id: `msg-${Math.random().toString(36).slice(2)}` }
      },
      upload: async (buffer, opcoes) => {
        uploads.push({ buffer, opcoes })
        return {
          url: 'https://cdn/mock',
          directPath: '/mock/path',
          mediaKey: 'chave-mock',
          fileSha256: 'sha-mock',
          fileEncSha256: 'enc-sha-mock',
          fileLength: buffer.length,
          mediaKeyTimestamp: 123456,
          mimetype: opcoes?.mimetype || 'image/jpeg'
        }
      }
    }
  }
}

function mockAcervo (arquivosMap) {
  const leituras = []
  return {
    leituras,
    obter: (id) => arquivosMap.get(id) || null,
    porCaminho: (caminho) => {
      for (const arq of arquivosMap.values()) {
        if (arq.path === caminho || arq.name === caminho) return arq
      }
      return null
    },
    listarDaPasta: (pasta) => {
      const achados = []
      for (const arq of arquivosMap.values()) {
        if (arq.folder === pasta || arq.path?.startsWith(pasta + '/')) achados.push(arq)
      }
      return achados
    },
    lerConteudoAsync: async (id, maxBytes) => {
      leituras.push({ id, maxBytes })
      const reg = arquivosMap.get(id)
      return reg?.buffer || Buffer.from('conteudo-padrao')
    }
  }
}

function mockOrcamento () {
  const chamadas = []
  let saldo = 0
  return {
    chamadas,
    saldo: () => saldo,
    adquirir: (bytes) => {
      chamadas.push({ tipo: 'adquirir', bytes })
      saldo += bytes
    },
    liberar: (bytes) => {
      chamadas.push({ tipo: 'liberar', bytes })
      saldo -= bytes
    }
  }
}

function mockEngineConfirm () {
  const confirmacoes = []
  return {
    confirmacoes,
    execucoes: {
      confirmar: async (id, dados) => confirmacoes.push({ id, dados })
    }
  }
}

// 5.1: Execução de botões com sucesso
{
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()
  const comando = {
    id: 'cmd-botoes-1',
    commandType: 'whatsapp.buttons',
    payload: {
      chatId: CHAT,
      text: 'Escolha uma fruta:',
      buttons: [
        { text: 'Maçã', id: '/maca' },
        { text: 'Banana', id: '/banana' }
      ],
      footer: 'Frutas frescas',
      fallbackText: '1. Maçã (/maca), 2. Banana (/banana)'
    }
  }

  await executarComandos(client, [comando], engine)
  check('executou envio de botões', client.envios.length === 1)
  const interativa = client.envios[0]?.conteudo?.viewOnceMessageV2?.message?.interactiveMessage
  check('enviou como interactiveMessage', !!interativa)
  check('texto no body', interativa?.body?.text === 'Escolha uma fruta:')
  check('rodapé no footer', interativa?.footer?.text === 'Frutas frescas')
  const bts = interativa?.nativeFlowMessage?.buttons || []
  check('contém 2 botões quick_reply', bts.length === 2 && bts[0].name === 'quick_reply')
  const p0 = JSON.parse(bts[0].buttonParamsJson)
  check('botão 1 tem display_text "Maçã" e id "/maca"', p0.display_text === 'Maçã' && p0.id === '/maca')
}

// 5.2: Fallback de botões para texto quando o envio interativo falha
{
  const clientFalha = mockGatewayClient(true) // simula recusa do envio interativo
  const engine = mockEngineConfirm()
  const comando = {
    id: 'cmd-botoes-fallback',
    commandType: 'whatsapp.buttons',
    payload: {
      chatId: CHAT,
      text: 'Escolha:',
      buttons: [{ text: 'Sim', id: '/sim' }],
      fallbackText: 'Opções em texto: Sim (/sim)'
    }
  }

  await executarComandos(clientFalha, [comando], engine)
  check('caiu para mensagem de texto no fallback', clientFalha.envios.length === 1 && clientFalha.envios[0]?.conteudo?.type === 'text')
  check('enviou o fallbackText configurado', clientFalha.envios[0]?.conteudo?.text === 'Opções em texto: Sim (/sim)')
}

// 5.3: Execução de carrossel de pasta do acervo com Carregador Tardio e Orçamento de Bytes
{
  const id1 = '507f1f77bcf86cd799439001'
  const id2 = '507f1f77bcf86cd799439002'
  const arq1 = {
    id: id1, name: 'foto1.jpg', path: 'viagem/foto1.jpg', folder: 'viagem',
    mimetype: 'image/jpeg', kind: 'image', sizeBytes: 1000, buffer: Buffer.from('foto-1-bytes')
  }
  const arq2 = {
    id: id2, name: 'foto2.jpg', path: 'viagem/foto2.jpg', folder: 'viagem',
    mimetype: 'image/jpeg', kind: 'image', sizeBytes: 2000, buffer: Buffer.from('foto-2-bytes')
  }

  const acervo = mockAcervo(new Map([[id1, arq1], [id2, arq2]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-carrossel-pasta',
    commandType: 'whatsapp.carousel',
    payload: {
      chatId: CHAT,
      text: 'Fotos das férias',
      folder: 'viagem',
      buttonText: 'Ver foto',
      buttonCommand: '/ver {{nome}}',
      footer: 'Álbum de viagem',
      estilo: 'completo'
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 5 * 1024 * 1024 })

  check('fez upload das 2 fotos para o servidor do WhatsApp', client.uploads.length === 2)
  check('enviou o carrossel interativo', client.envios.length === 1)
  const carouselMsg = client.envios[0]?.conteudo?.viewOnceMessageV2?.message?.interactiveMessage?.carouselMessage
  check('carrossel possui 2 cards', carouselMsg?.cards?.length === 2)
  check('card 1 tem título "foto1.jpg"', carouselMsg?.cards?.[0]?.header?.title === 'foto1.jpg')
  const btnCard1 = carouselMsg?.cards?.[0]?.nativeFlowMessage?.buttons?.[0]
  check('card 1 tem botão quick_reply', btnCard1?.name === 'quick_reply')
  const pCard1 = JSON.parse(btnCard1?.buttonParamsJson || '{}')
  check('botão do card substituiu {{nome}} pelo nome do arquivo', pCard1.display_text === 'Ver foto' && pCard1.id === '/ver foto1.jpg')

  // Verificação rigorosa do carregador tardio e do orçamento de bytes:
  // Cada card deve ter sido adquirido e liberado individualmente!
  check('carregador tardio leu foto1 sob demanda', acervo.leituras[0]?.id === id1)
  check('carregador tardio leu foto2 sob demanda', acervo.leituras[1]?.id === id2)
  check('orçamento adquiriu bytes da foto 1', orcamento.chamadas[0]?.tipo === 'adquirir' && orcamento.chamadas[0]?.bytes === 1000)
  check('orçamento liberou bytes da foto 1 antes da foto 2', orcamento.chamadas[1]?.tipo === 'liberar' && orcamento.chamadas[1]?.bytes === 1000)
  check('orçamento adquiriu bytes da foto 2', orcamento.chamadas[2]?.tipo === 'adquirir' && orcamento.chamadas[2]?.bytes === 2000)
  check('orçamento liberou bytes da foto 2 após upload', orcamento.chamadas[3]?.tipo === 'liberar' && orcamento.chamadas[3]?.bytes === 2000)
  check('saldo do orçamento zerado após o término', orcamento.saldo() === 0)
}

// 5.4: Fallback de carrossel para texto quando o envio interativo falha
{
  const id1 = '507f1f77bcf86cd799439003'
  const arq1 = {
    id: id1, name: 'foto1.jpg', path: 'fotos/foto1.jpg', folder: 'fotos',
    mimetype: 'image/jpeg', kind: 'image', sizeBytes: 1000, buffer: Buffer.from('foto-bytes')
  }
  const acervo = mockAcervo(new Map([[id1, arq1]]))
  const orcamento = mockOrcamento()
  const clientFalha = mockGatewayClient(true) // falha envio interativo
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-carrossel-fallback',
    commandType: 'whatsapp.carousel',
    payload: {
      chatId: CHAT,
      text: 'Catálogo',
      folder: 'fotos',
      fallbackText: 'Catálogo em texto: foto 1'
    }
  }

  await executarComandos(clientFalha, [comando], engine, { acervo, orcamento, limiteBytes: 5 * 1024 * 1024 })
  check('carrossel recusado caiu para envio em texto', clientFalha.envios.length === 1 && clientFalha.envios[0]?.conteudo?.type === 'text')
  check('enviou o texto de reserva', clientFalha.envios[0]?.conteudo?.text === 'Catálogo em texto: foto 1')
  check('saldo do orçamento continua zerado após fallback', orcamento.saldo() === 0)
}

// --- 6. Catálogo de Templates ------------------------------------------------
const catalogo = carregarCatalogo()
check('catálogo inclui template botoes-escolha', catalogo.has('botoes-escolha'))
check('catálogo inclui template carrossel-fotos', catalogo.has('carrossel-fotos'))

const tBotoes = catalogo.get('botoes-escolha')
check('template botoes-escolha tem categoria utilitarios', tBotoes?.category === 'utilitarios')
check('template botoes-escolha usa action.whatsapp.buttons',
  tBotoes?.documentTemplate?.flow?.nodes?.some((n) => n.type === 'action.whatsapp.buttons'))

const tCarrossel = catalogo.get('carrossel-fotos')
check('template carrossel-fotos tem categoria utilitarios', tCarrossel?.category === 'utilitarios')
check('template carrossel-fotos usa action.whatsapp.carousel',
  tCarrossel?.documentTemplate?.flow?.nodes?.some((n) => n.type === 'action.whatsapp.carousel'))

// Honestidade sobre o que não desenha e botão voltando como mensagem nos avisos
const avisosBotoes = (tBotoes?.warnings || []).map((w) => w.text).join(' ')
check('template de botões avisa honestamente sobre o que não desenha', /HONESTIDADE SOBRE O QUE NÃO DESENHA/.test(avisosBotoes))
check('template de botões avisa que o botão volta como mensagem de texto comum', /O BOTÃO VOLTA COMO MENSAGEM DE TEXTO COMUM/.test(avisosBotoes))

const avisosCarrossel = (tCarrossel?.warnings || []).map((w) => w.text).join(' ')
check('template de carrossel avisa sobre carregador tardio e orçamento', /CARREGAMENTO TARDIO E ORÇAMENTO DE BYTES/.test(avisosCarrossel))
check('template de carrossel avisa honestamente sobre o que não desenha', /HONESTIDADE SOBRE O QUE NÃO DESENHA/.test(avisosCarrossel))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE BOTÕES E CARROSSEL PASSARAM COM SUCESSO')
process.exit(falhas ? 1 : 0)
