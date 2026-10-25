// Testes para pacotes de figurinhas (.wastickers e pacote nativo).
//
// Cobre o contrato completo nas quatro camadas:
//   1. Linguagem (.lcn): compilar e descompilar preservando "envia pacote".
//   2. Capacidades e Schema: validação no schema e catalogação em acoes.js.
//   3. Motor (evaluator): geração do comando whatsapp.stickerPack com os campos corretos.
//   4. Gateway (gatewayExecutor):
//      - envio na forma "pacote" (nativo via stickerPackMessage no protocolo).
//      - envio na forma "arquivo" (documento .wastickers para app terceiro).
//      - envio na forma "diagnóstico" (as duas formas numeradas para medição).
//      - fallback de pacote nativo recusado para documento .wastickers e texto de reserva.
//      - carregador tardio e orçamento de bytes (reserva antes de alocar, liberação no finally).
//   5. Catálogo de templates: compilação do template pacote-figurinhas e avisos sobre o que não foi medido.

import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { ACOES } from '../src/lcn/vocabulario.js'
import { ACOES_SUPORTADAS } from '../src/engine/server/runtimeCapabilities.js'
import { ACOES as ACOES_TELA, acharDefinicao } from '../src/web/public/logic/acoes.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { montarWastickersZip, calcularCrc32 } from '../src/engine/wastickers.js'
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
check('ACOES_SUPORTADAS inclui action.whatsapp.stickerPack', ACOES_SUPORTADAS.includes('action.whatsapp.stickerPack'))

const defPacote = ACOES.find((a) => a.tipo === 'action.whatsapp.stickerPack')
check('vocabulario define "envia pacote"', defPacote?.palavra === 'envia pacote')

// --- 2. Schema e Tela (acoes.js) ---------------------------------------------
const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const defSchemaPacote = acharDefinicao(schema, 'action.whatsapp.stickerPack')
check('schema define actionWhatsappStickerPack', !!defSchemaPacote)
check('schema actionWhatsappStickerPack aceita pasta, forma, nome, autor',
  defSchemaPacote?.properties?.config?.properties?.folder &&
  defSchemaPacote?.properties?.config?.properties?.forma &&
  defSchemaPacote?.properties?.config?.properties?.name &&
  defSchemaPacote?.properties?.config?.properties?.author)

const telaPacote = ACOES_TELA.find((a) => a.tipo === 'action.whatsapp.stickerPack')
check('acoes.js da tela documenta action.whatsapp.stickerPack', !!telaPacote && telaPacote.familia === 'midia')

// --- 3. Geração Binária de .wastickers (ZIP puro sem biblioteca externa) ------
{
  const fig1 = Buffer.from('RIFF....WEBPVP8 ...fake sticker 1...')
  const fig2 = Buffer.from('RIFF....WEBPVP8 ...fake sticker 2...')
  const zip = montarWastickersZip({
    titulo: 'Meu Pacote',
    autor: 'Autor Teste',
    figurinhas: [
      { nome: 'fig1.webp', buffer: fig1 },
      { nome: 'fig2.webp', buffer: fig2 }
    ]
  })

  check('gera buffer de ZIP válido', Buffer.isBuffer(zip) && zip.length > 0)
  // Assinatura do primeiro local header ZIP: PK\x03\x04
  check('começa com assinatura PK (0x04034b50)', zip.readUInt32LE(0) === 0x04034b50)
  const zipTexto = zip.toString('latin1')
  check('contém title.txt', zipTexto.includes('title.txt') && zipTexto.includes('Meu Pacote'))
  check('contém author.txt', zipTexto.includes('author.txt') && zipTexto.includes('Autor Teste'))
  check('contém arquivos de figurinhas', zipTexto.includes('fig1.webp') && zipTexto.includes('fig2.webp'))
}

// --- 4. Compilação e Descompilação (Ida e Volta) ------------------------------
const lcnPacote = `automação
  tipo: comando
  dispara com: /pacote
  nome: pacote
  onde: em qualquer lugar
  pool: p1
  acessa: texto
  casa: exato
  quem: só externos

  envia pacote "Figurinhas Engraçadas"
    pasta: "stickers/memes"
    autor: "Bot Criador"
    forma: pacote
    legenda: "Confira nosso novo pacote!"
    sem arquivo: "Nenhuma figurinha disponível"
    senão: "Não foi possível enviar o pacote"
`

const docPacote = compilar(lcnPacote)
const noPacote = docPacote?.flow?.nodes?.find((n) => n.type === 'action.whatsapp.stickerPack')
check('compilar "envia pacote" extrai o nome do pacote', noPacote?.config?.name === 'Figurinhas Engraçadas')
check('extrai pasta, autor e forma',
  noPacote?.config?.folder === 'stickers/memes' &&
  noPacote?.config?.author === 'Bot Criador' &&
  noPacote?.config?.forma === 'pacote')
check('extrai legenda, sem arquivo e senão',
  noPacote?.config?.caption === 'Confira nosso novo pacote!' &&
  noPacote?.config?.notFoundText === 'Nenhuma figurinha disponível' &&
  noPacote?.config?.fallbackText === 'Não foi possível enviar o pacote')

// Ida e volta
const textoDescompilado = descompilar(docPacote)
check('descompilador inclui "envia pacote"', textoDescompilado.includes('envia pacote "Figurinhas Engraçadas"'))
check('descompilador inclui pasta e autor', textoDescompilado.includes('pasta: "stickers/memes"') && textoDescompilado.includes('autor: "Bot Criador"'))
const docRecompilado = compilar(textoDescompilado)
check('ida e volta de pacote preserva o documento', mesmo(docPacote, docRecompilado))

// --- 5. Avaliador (evaluator.js) ---------------------------------------------
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
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
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

instalarNoBanco(docPacote, 'auto-pacote')

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

const resPacote = avaliarEvento(db, criarEvento('/pacote'))
const cmdPacote = resPacote.results.find((r) => r.automationId === 'auto-pacote')?.commands?.[0]
check('evaluator gera commandType "whatsapp.stickerPack"', cmdPacote?.commandType === 'whatsapp.stickerPack')
check('payload contém name, folder, author e forma',
  cmdPacote?.payload?.name === 'Figurinhas Engraçadas' &&
  cmdPacote?.payload?.folder === 'stickers/memes' &&
  cmdPacote?.payload?.author === 'Bot Criador' &&
  cmdPacote?.payload?.forma === 'pacote')
check('payload contém caption, notFoundText e fallbackText',
  cmdPacote?.payload?.caption === 'Confira nosso novo pacote!' &&
  cmdPacote?.payload?.notFoundText === 'Nenhuma figurinha disponível' &&
  cmdPacote?.payload?.fallbackText === 'Não foi possível enviar o pacote')

// --- 6. Gateway Executor (gatewayExecutor.js) --------------------------------
function mockGatewayClient (falharNativo = false, falharTudo = false) {
  const envios = []
  return {
    envios,
    message: {
      send: async (chatId, conteudo, opcoes) => {
        if (falharTudo) {
          throw new Error('falha total na rede')
        }
        if (falharNativo && conteudo?.type === 'sticker-pack') {
          throw new Error('servidor recusou o stickerPackMessage nativo')
        }
        envios.push({ chatId, conteudo, opcoes })
        return { id: `msg-${Math.random().toString(36).slice(2)}` }
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

// 6.1: Envio de pacote na forma "pacote" (nativo via protocolo)
{
  const id1 = 'id-fig-1'
  const id2 = 'id-fig-2'
  const arq1 = { id: id1, name: 'f1.webp', path: 'stickers/f1.webp', folder: 'stickers', mimetype: 'image/webp', kind: 'sticker', sizeBytes: 1500, buffer: Buffer.from('webp1') }
  const arq2 = { id: id2, name: 'f2.webp', path: 'stickers/f2.webp', folder: 'stickers', mimetype: 'image/webp', kind: 'sticker', sizeBytes: 2500, buffer: Buffer.from('webp2') }

  const acervo = mockAcervo(new Map([[id1, arq1], [id2, arq2]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-pacote-nativo',
    commandType: 'whatsapp.stickerPack',
    payload: {
      chatId: CHAT,
      name: 'Memes 2026',
      folder: 'stickers',
      author: 'Criador LCN',
      forma: 'pacote',
      caption: 'Pacote fresquinho'
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 5 * 1024 * 1024 })
  check('executou envio do pacote nativo', client.envios.length === 1)
  const envioNativo = client.envios[0]?.conteudo
  check('conteúdo tem type "sticker-pack"', envioNativo?.type === 'sticker-pack')
  check('name e publisher preenchidos', envioNativo?.name === 'Memes 2026' && envioNativo?.publisher === 'Criador LCN')
  check('contém 2 stickers', envioNativo?.stickers?.length === 2)
  check('contém trayIcon e coverThumbnail', !!envioNativo?.trayIcon?.media && !!envioNativo?.coverThumbnail)
  check('legenda acompanhou', envioNativo?.caption === 'Pacote fresquinho')

  // Orçamento de bytes e carregamento tardio
  check('orçamento adquiriu o total de bytes (4000)', orcamento.chamadas.some((c) => c.tipo === 'adquirir' && c.bytes === 4000))
  check('orçamento liberou os bytes no término', orcamento.chamadas.some((c) => c.tipo === 'liberar' && c.bytes === 4000))
  check('saldo do orçamento continua zerado', orcamento.saldo() === 0)
}

// 6.2: Envio de pacote na forma "arquivo" (.wastickers como documento)
{
  const id1 = 'id-fig-3'
  const arq1 = { id: id1, name: 'f3.webp', path: 'memes/f3.webp', folder: 'memes', mimetype: 'image/webp', kind: 'sticker', sizeBytes: 3000, buffer: Buffer.from('webp3') }

  const acervo = mockAcervo(new Map([[id1, arq1]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-pacote-arquivo',
    commandType: 'whatsapp.stickerPack',
    payload: {
      chatId: CHAT,
      name: 'Pacote Documento',
      folder: 'memes',
      author: 'LCN Team',
      forma: 'arquivo',
      caption: 'Instale no Sticker Maker'
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 5 * 1024 * 1024 })
  check('executou envio do documento .wastickers', client.envios.length === 1)
  const envioDoc = client.envios[0]?.conteudo
  check('conteúdo tem type "document"', envioDoc?.type === 'document')
  check('fileName termina com .wastickers', envioDoc?.fileName === 'Pacote_Documento.wastickers')
  check('media é um Buffer de ZIP válido', Buffer.isBuffer(envioDoc?.media) && envioDoc.media.readUInt32LE(0) === 0x04034b50)
  check('legenda preservada', envioDoc?.caption === 'Instale no Sticker Maker')
  check('saldo do orçamento zerado após envio de documento', orcamento.saldo() === 0)
}

// 6.3: Envio de pacote na forma "diagnóstico" (manda as duas formas numeradas)
{
  const id1 = 'id-fig-4'
  const arq1 = { id: id1, name: 'f4.webp', path: 'diag/f4.webp', folder: 'diag', mimetype: 'image/webp', kind: 'sticker', sizeBytes: 2000, buffer: Buffer.from('webp4') }

  const acervo = mockAcervo(new Map([[id1, arq1]]))
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-pacote-diag',
    commandType: 'whatsapp.stickerPack',
    payload: {
      chatId: CHAT,
      name: 'Pacote Diagnóstico',
      folder: 'diag',
      forma: 'diagnóstico'
    }
  }

  await executarComandos(client, [comando], engine, { acervo, orcamento, limiteBytes: 5 * 1024 * 1024 })
  check('diagnóstico enviou 3 mensagens (nativo, arquivo e fechamento)', client.envios.length === 3)
  check('mensagem 1 é pacote nativo numerado [1/2]', client.envios[0]?.conteudo?.type === 'sticker-pack' && client.envios[0]?.conteudo?.caption?.includes('[1/2]'))
  check('mensagem 2 é documento .wastickers numerado [2/2]', client.envios[1]?.conteudo?.type === 'document' && client.envios[1]?.conteudo?.caption?.includes('[2/2]'))
  check('mensagem 3 é texto explicativo de medição', client.envios[2]?.conteudo?.type === 'text' && client.envios[2]?.conteudo?.text?.includes('Foram enviadas as 2 variações'))
  check('saldo do orçamento zerado após diagnóstico', orcamento.saldo() === 0)
}

// 6.4: Fallback de envio nativo recusado para documento .wastickers
{
  const id1 = 'id-fig-5'
  const arq1 = { id: id1, name: 'f5.webp', path: 'stickers/f5.webp', folder: 'stickers', mimetype: 'image/webp', kind: 'sticker', sizeBytes: 1800, buffer: Buffer.from('webp5') }

  const acervo = mockAcervo(new Map([[id1, arq1]]))
  const orcamento = mockOrcamento()
  // Simula servidor recusando sticker-pack
  const clientFalha = mockGatewayClient(true, false)
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-pacote-fallback-doc',
    commandType: 'whatsapp.stickerPack',
    payload: {
      chatId: CHAT,
      name: 'Pacote com Queda',
      folder: 'stickers',
      forma: 'pacote'
    }
  }

  await executarComandos(clientFalha, [comando], engine, { acervo, orcamento, limiteBytes: 5 * 1024 * 1024 })
  check('recusa de pacote nativo caiu para documento .wastickers', clientFalha.envios.length === 1 && clientFalha.envios[0]?.conteudo?.type === 'document')
  check('documento gerado tem extensão .wastickers', clientFalha.envios[0]?.conteudo?.fileName === 'Pacote_com_Queda.wastickers')
  check('saldo do orçamento zerado após queda', orcamento.saldo() === 0)
}

// 6.5: Fallback para texto de reserva quando ambas as tentativas falham
{
  const id1 = 'id-fig-6'
  const arq1 = { id: id1, name: 'f6.webp', path: 'stickers/f6.webp', folder: 'stickers', mimetype: 'image/webp', kind: 'sticker', sizeBytes: 1200, buffer: Buffer.from('webp6') }

  const acervo = mockAcervo(new Map([[id1, arq1]]))
  const orcamento = mockOrcamento()
  // Falha tanto nativo quanto documento
  const clientFalhaTudo = {
    envios: [],
    message: {
      send: async (chatId, conteudo) => {
        if (conteudo?.type === 'text') {
          clientFalhaTudo.envios.push({ chatId, conteudo })
          return { id: 'msg-texto' }
        }
        throw new Error('falha em mídia e documento')
      }
    }
  }
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-pacote-fallback-texto',
    commandType: 'whatsapp.stickerPack',
    payload: {
      chatId: CHAT,
      name: 'Pacote Falha',
      folder: 'stickers',
      forma: 'pacote',
      fallbackText: 'Não conseguimos enviar as figurinhas agora.'
    }
  }

  await executarComandos(clientFalhaTudo, [comando], engine, { acervo, orcamento, limiteBytes: 5 * 1024 * 1024 })
  check('falha de documento caiu para texto de reserva', clientFalhaTudo.envios.length === 1 && clientFalhaTudo.envios[0]?.conteudo?.type === 'text')
  check('enviou o fallbackText configurado', clientFalhaTudo.envios[0]?.conteudo?.text === 'Não conseguimos enviar as figurinhas agora.')
  check('saldo do orçamento zerado após fallback para texto', orcamento.saldo() === 0)
}

// 6.6: Pasta vazia aciona notFoundText
{
  const acervoVazio = mockAcervo(new Map())
  const orcamento = mockOrcamento()
  const client = mockGatewayClient()
  const engine = mockEngineConfirm()

  const comando = {
    id: 'cmd-pacote-vazio',
    commandType: 'whatsapp.stickerPack',
    payload: {
      chatId: CHAT,
      name: 'Pacote Vazio',
      folder: 'pasta-inexistente',
      notFoundText: 'Essa pasta não tem figurinhas.'
    }
  }

  let erroLancado = null
  try {
    await executarComandos(client, [comando], engine, { acervo: acervoVazio, orcamento, limiteBytes: 5 * 1024 * 1024 })
  } catch (e) {
    erroLancado = e
  }
  check('enviou mensagem de pasta vazia', client.envios.length === 1 && client.envios[0]?.conteudo?.text === 'Essa pasta não tem figurinhas.')
  check('saldo do orçamento continua zerado', orcamento.saldo() === 0)
}

// --- 7. Catálogo de Templates ------------------------------------------------
const catalogo = carregarCatalogo()
check('catálogo inclui template pacote-figurinhas', catalogo.has('pacote-figurinhas'))

const tPacote = catalogo.get('pacote-figurinhas')
check('template pacote-figurinhas tem categoria utilitarios', tPacote?.category === 'utilitarios')
check('template pacote-figurinhas usa action.whatsapp.stickerPack',
  tPacote?.documentTemplate?.flow?.nodes?.some((n) => n.type === 'action.whatsapp.stickerPack'))

// Honestidade obrigatória nos avisos do template
const avisosPacote = (tPacote?.warnings || []).map((w) => w.text).join(' ')
check('template avisa que envio nativo NÃO foi medido num aparelho', /NÃO FOI MEDIDO/i.test(avisosPacote))
check('template avisa honestamente que formato .wastickers é de terceiros', /apps de terceiros/i.test(avisosPacote) || /Sticker Maker/i.test(avisosPacote))
check('template avisa sobre as duas formas e diagnóstico', /duas alternativas|duas variações|diagnóstico/i.test(avisosPacote))
check('template avisa sobre limite de 30 figurinhas e orçamento', /30 figurinhas/i.test(avisosPacote))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES DE PACOTE DE FIGURINHAS PASSARAM COM SUCESSO')
process.exit(falhas ? 1 : 0)
