// Enviar mídia como visualização única: do .lcn até o gateway.
//
// Este arquivo testa a capacidade COMPLETA nas quatro camadas:
//   1. Linguagem (.lcn): palavra "visualização única: sim" no vocabulário,
//      compilando para { viewOnce: true } e descompilando de volta intacto.
//   2. Schema e Catálogo: validação no schema da automação e documentação
//      na tela (com o aviso honesto de que é pedido ao cliente, não garantia).
//   3. Motor (evaluator): geração do comando whatsapp.sendFile com viewOnce.
//   4. Gateway (gatewayExecutor): entrega com o contrato de carregador tardio
//      e orçamento de bytes preservados, passando options.viewOnce ao cliente.

import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { ACOES } from '../src/lcn/vocabulario.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { ACOES as ACOES_TELA } from '../src/web/public/logic/acoes.js'
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

// --- 1. Vocabulário da linguagem .lcn -----------------------------------------
const defSendFile = ACOES.find((a) => a.tipo === 'action.whatsapp.sendFile')
check('action.whatsapp.sendFile existe no vocabulário', !!defSendFile)
const campoViewOnceVocab = defSendFile?.campos.find((c) => c.chave === 'viewOnce')
check('campo viewOnce declarado com rótulo "visualização única"', campoViewOnceVocab?.rotulo === 'visualização única')
check('campo viewOnce é do tipo booleano', campoViewOnceVocab?.tipo === 'booleano')

// --- 2. Compilação e Ida e Volta (.lcn <-> documento) ------------------------
const lcnComVisuSim = `automação
  tipo: comando
  dispara com: /foto
  nome: foto
  onde: em qualquer lugar
  pool: p1
  acessa: texto
  casa: exato
  quem: só externos

  envia arquivo "fotos/segredo.jpg"
    visualização única: sim
`

const lcnComVisuNao = `automação
  tipo: comando
  dispara com: /foto
  nome: foto
  onde: em qualquer lugar
  pool: p1
  acessa: texto
  casa: exato
  quem: só externos

  envia arquivo "fotos/publica.jpg"
    visualização única: não
`

const lcnSemVisu = `automação
  tipo: comando
  dispara com: /foto
  nome: foto
  onde: em qualquer lugar
  pool: p1
  acessa: texto
  casa: exato
  quem: só externos

  envia arquivo "fotos/comum.jpg"
`

const docVisuSim = compilar(lcnComVisuSim)
const noVisuSim = docVisuSim?.flow?.nodes?.find((n) => n.type === 'action.whatsapp.sendFile')
check('compilar "visualização única: sim" grava viewOnce: true no config', noVisuSim?.config?.viewOnce === true)
check('preserva o caminho do arquivo', noVisuSim?.config?.path === 'fotos/segredo.jpg')

const docVisuNao = compilar(lcnComVisuNao)
const noVisuNao = docVisuNao?.flow?.nodes?.find((n) => n.type === 'action.whatsapp.sendFile')
check('compilar "visualização única: não" grava viewOnce: false', noVisuNao?.config?.viewOnce === false)

const docSemVisu = compilar(lcnSemVisu)
const noSemVisu = docSemVisu?.flow?.nodes?.find((n) => n.type === 'action.whatsapp.sendFile')
check('compilar sem visualização única deixa viewOnce ausente', noSemVisu?.config?.viewOnce === undefined)

// Ida e volta: descompilar -> compilar -> o documento volta idêntico
const textoDescompilado = descompilar(docVisuSim)
check('descompilador inclui o campo de visualização única no texto', textoDescompilado.includes('visualização única: true'))
const docRecompilado = compilar(textoDescompilado)
check('ida e volta preserva o documento inteiro sem perda', mesmo(docVisuSim, docRecompilado))

// --- 3. Schema e Catálogo da Tela -------------------------------------------
const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const schemaPropViewOnce = schema.definitions.actionWhatsappSendFile.properties.config.properties.viewOnce
check('schema define viewOnce como boolean em actionWhatsappSendFile', schemaPropViewOnce?.type === 'boolean')
check('schema descreve o limite honesto (pedido ao aplicativo, não garantia)',
  typeof schemaPropViewOnce?.description === 'string' &&
  schemaPropViewOnce.description.includes('pedido ao aplicativo') &&
  schemaPropViewOnce.description.includes('/x9'))

const acaoTela = ACOES_TELA.find((a) => a.tipo === 'action.whatsapp.sendFile')
const campoTela = acaoTela?.campos.find((c) => c.chave === 'viewOnce')
check('catálogo da tela inclui viewOnce em action.whatsapp.sendFile', !!campoTela)
check('catálogo da tela traz texto de ajuda com limite honesto',
  typeof campoTela?.ajuda === 'string' &&
  campoTela.ajuda.includes('pedido') &&
  campoTela.ajuda.includes('/x9'))

// --- 4. Avaliador (evaluator.js) --------------------------------------------
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
const CHAT = '5511900000001@s.whatsapp.net'

function publicarAutomacao (id, configAcao) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'contact', id: CHAT }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: `/${id}`, match: 'exact_or_args', allowFrom: 'external' } },
        { id: 'a', type: 'action.whatsapp.sendFile', config: configAcao }
      ],
      edges: [{ from: 'g', to: 'a', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'contact', CHAT)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

publicarAutomacao('teste-visu-on', { path: 'segredos/foto.jpg', viewOnce: true })
publicarAutomacao('teste-visu-off', { path: 'publico/foto.jpg', viewOnce: false })

let seqMsg = 0
function criarEvento (texto) {
  seqMsg++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${CHAT}:${CHAT}:m${seqMsg}`,
    occurredAt: agora, replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredBySelf: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: CHAT, id: `m${seqMsg}` }
  }
}

const resultadoOn = avaliarEvento(db, criarEvento('/teste-visu-on'))
const cmdOn = resultadoOn.results.find((r) => r.automationId === 'teste-visu-on')?.commands?.[0]
check('evaluator emite commandType "whatsapp.sendFile"', cmdOn?.commandType === 'whatsapp.sendFile')
check('evaluator passa viewOnce: true no payload', cmdOn?.payload?.viewOnce === true)

const resultadoOff = avaliarEvento(db, criarEvento('/teste-visu-off'))
const cmdOff = resultadoOff.results.find((r) => r.automationId === 'teste-visu-off')?.commands?.[0]
check('evaluator com viewOnce: false não coloca viewOnce no payload', cmdOff?.payload?.viewOnce === undefined)

// --- 5. Gateway Executor (gatewayExecutor.js) --------------------------------
// Verifica:
//   - Contrato de carregador tardio ({ id, nome, mime, tipo, bytes, carregar() })
//   - Orçamento adquirido antes da leitura e liberado após o envio
//   - viewOnce marcado tanto no conteúdo quanto nas opções para imagem/vídeo/áudio
//   - Texto do acervo nunca marcado como visualização única

function mockGatewayClient () {
  const envios = []
  return {
    envios,
    message: {
      send: async (chatId, conteudo, opcoes) => {
        envios.push({ chatId, conteudo, opcoes })
        return { id: `send-${Math.random().toString(36).slice(2)}` }
      }
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

// Caso 5.1: Envio de IMAGEM como visualização única
{
  const idImg = '507f1f77bcf86cd799439011'
  const arqImg = {
    id: idImg,
    name: 'segredo.jpg',
    path: 'segredos/segredo.jpg',
    mimetype: 'image/jpeg',
    kind: 'image',
    sizeBytes: 1024,
    buffer: Buffer.from('bytes-da-imagem-secreta')
  }
  const acervo = mockAcervo(new Map([[idImg, arqImg]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-img-1',
    commandType: 'whatsapp.sendFile',
    payload: {
      chatId: CHAT,
      fileId: idImg,
      viewOnce: true,
      caption: 'olhe rápido'
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 10 * 1024 * 1024 })

  check('gateway executou o envio de imagem', client.envios.length === 1)
  const envio = client.envios[0]
  check('conteudo tem type "image"', envio?.conteudo?.type === 'image')
  check('conteudo tem viewOnce: true', envio?.conteudo?.viewOnce === true)
  check('conteudo preserva legenda', envio?.conteudo?.caption === 'olhe rápido')
  check('opcoesDeEnvio passa viewOnce: true no terceiro argumento do send', envio?.opcoes?.viewOnce === true)

  // Conferir carregador tardio e orçamento
  check('carregador tardio chamou lerConteudoAsync no momento do envio', acervo.leituras.length === 1 && acervo.leituras[0].id === idImg)
  check('orçamento adquiriu os bytes antes da leitura', orcamento.chamadas[0]?.tipo === 'adquirir' && orcamento.chamadas[0]?.bytes === 1024)
  check('orçamento liberou os bytes após o envio', orcamento.chamadas[1]?.tipo === 'liberar' && orcamento.chamadas[1]?.bytes === 1024)
  check('saldo do orçamento retornou a zero', orcamento.saldo() === 0)
}

// Caso 5.2: Envio de VÍDEO como visualização única
{
  const idVid = '507f1f77bcf86cd799439022'
  const arqVid = {
    id: idVid,
    name: 'video.mp4',
    path: 'videos/video.mp4',
    mimetype: 'video/mp4',
    kind: 'video',
    sizeBytes: 2048,
    buffer: Buffer.from('bytes-do-video')
  }
  const acervo = mockAcervo(new Map([[idVid, arqVid]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-vid-1',
    commandType: 'whatsapp.sendFile',
    payload: {
      chatId: CHAT,
      fileId: idVid,
      viewOnce: true
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 10 * 1024 * 1024 })

  const envio = client.envios[0]
  check('conteudo de vídeo tem viewOnce: true', envio?.conteudo?.type === 'video' && envio?.conteudo?.viewOnce === true)
  check('opcoesDeEnvio de vídeo passa viewOnce: true', envio?.opcoes?.viewOnce === true)
  check('orçamento de vídeo foi liberado', orcamento.saldo() === 0)
}

// Caso 5.3: Envio de ÁUDIO como visualização única
{
  const idAud = '507f1f77bcf86cd799439033'
  const arqAud = {
    id: idAud,
    name: 'voz.ogg',
    path: 'audios/voz.ogg',
    mimetype: 'audio/ogg',
    kind: 'audio',
    sizeBytes: 512,
    buffer: Buffer.from('bytes-do-audio')
  }
  const acervo = mockAcervo(new Map([[idAud, arqAud]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-aud-1',
    commandType: 'whatsapp.sendFile',
    payload: {
      chatId: CHAT,
      fileId: idAud,
      viewOnce: true
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 10 * 1024 * 1024 })

  const envio = client.envios[0]
  check('conteudo de áudio tem viewOnce: true', envio?.conteudo?.type === 'audio' && envio?.conteudo?.viewOnce === true)
  check('opcoesDeEnvio de áudio passa viewOnce: true', envio?.opcoes?.viewOnce === true)
  check('orçamento de áudio foi liberado', orcamento.saldo() === 0)
}

// Caso 5.4: Envio de TEXTO com viewOnce solicitado não vira visualização única
{
  const idTxt = '507f1f77bcf86cd799439044'
  const arqTxt = {
    id: idTxt,
    name: 'nota.txt',
    path: 'textos/nota.txt',
    mimetype: 'text/plain',
    kind: 'text',
    sizeBytes: 64,
    buffer: Buffer.from('texto comum')
  }
  const acervo = mockAcervo(new Map([[idTxt, arqTxt]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-txt-1',
    commandType: 'whatsapp.sendFile',
    payload: {
      chatId: CHAT,
      fileId: idTxt,
      viewOnce: true
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 10 * 1024 * 1024 })

  const envio = client.envios[0]
  check('texto enviado tem type "text"', envio?.conteudo?.type === 'text')
  check('texto não ganha viewOnce: true no conteudo (protocolo só aceita em mídia)', envio?.conteudo?.viewOnce === undefined)
  check('orçamento de texto foi liberado', orcamento.saldo() === 0)
}

// Caso 5.5: Envio sem visualização única não marca flags
{
  const idComum = '507f1f77bcf86cd799439055'
  const arqComum = {
    id: idComum,
    name: 'comum.jpg',
    path: 'fotos/comum.jpg',
    mimetype: 'image/jpeg',
    kind: 'image',
    sizeBytes: 500,
    buffer: Buffer.from('bytes-comuns')
  }
  const acervo = mockAcervo(new Map([[idComum, arqComum]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-comum-1',
    commandType: 'whatsapp.sendFile',
    payload: {
      chatId: CHAT,
      fileId: idComum
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 10 * 1024 * 1024 })

  const envio = client.envios[0]
  check('envio comum não tem viewOnce no conteudo', envio?.conteudo?.viewOnce === undefined)
  check('envio comum não tem viewOnce nas opcoes', envio?.opcoes?.viewOnce === undefined)
  check('orçamento foi liberado', orcamento.saldo() === 0)
}

// Caso 5.6: Falha no envio libera o orçamento sem vazamento
{
  const idErro = '507f1f77bcf86cd799439066'
  const arqErro = {
    id: idErro,
    name: 'falha.jpg',
    path: 'fotos/falha.jpg',
    mimetype: 'image/jpeg',
    kind: 'image',
    sizeBytes: 800,
    buffer: Buffer.from('bytes-erro')
  }
  const acervo = mockAcervo(new Map([[idErro, arqErro]]))
  const orcamento = mockOrcamento()
  const client = {
    message: {
      send: async () => { throw new Error('Falha de rede simulada') }
    }
  }
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-erro-1',
    commandType: 'whatsapp.sendFile',
    payload: {
      chatId: CHAT,
      fileId: idErro,
      viewOnce: true
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 10 * 1024 * 1024 })

  check('comando registra falha', engine.confirmacoes[0]?.dados?.status === 'failed')
  check('orçamento liberou os bytes mesmo com erro no envio', orcamento.saldo() === 0)
}

db.close()

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE ENVIO DE VISUALIZAÇÃO ÚNICA PASSARAM')
process.exit(falhas ? 1 : 0)
