// Os números da figurinha são do DONO, não meus — e o ffmpeg vira estado
// observável em vez de surpresa.
//
// O QUE ISTO CONSERTA. 512 px, 6 segundos, qualidade 80/50 e 1 MB eram
// constantes em `src/sticker.js`, escolhidas por mim e fora do alcance de quem
// monta o comando. É a mesma crítica que o dono fez ao download: "aparece no
// código interno e não como configurável pelo dono". E o ffmpeg, que é
// programa de FORA, só existia como uma linha de aviso no template: se ele
// sumisse da máquina, a descoberta vinha por reclamação.
//
// A faixa é imposta na PUBLICAÇÃO (schema), onde a recusa é visível e diz a
// faixa. O aperto dentro do conversor é rede de segurança, não o portão.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'
import { PADRAO, FAIXAS } from '../src/sticker.js'
import { extrairVersao, verificarDependencias, _limparCacheParaTeste } from '../src/dependencias.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const CHAT = '5511900000001@s.whatsapp.net'
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)

function doc (id, config) {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    enabled: true,
    name: id,
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/fig', match: 'exact_or_args', allowFrom: 'any' } },
        { id: 's', type: 'action.whatsapp.sticker', config }
      ],
      edges: [{ from: 'g', to: 's', on: 'matched' }]
    }
  }
}

function publicar (id, config) {
  servico.criarEPublicar({ id, document: doc(id, config) })
  db.prepare('UPDATE automations SET deployment_mode = ?, enabled = ? WHERE id = ?').run('live', 0, id)
  return id
}

let seq = 0
function recusa (config) {
  const id = `rec-${++seq}`
  try { servico.criarEPublicar({ id, document: doc(id, config) }); return null }
  catch (e) { return e.message }
}

// --- a faixa é imposta na publicação, com a faixa na mensagem ------------
check('tamanho acima da faixa é RECUSADO na publicação', !!recusa({ size: 4096 }))
check('tamanho abaixo da faixa também', !!recusa({ size: 16 }))
check('e o tamanho dentro da faixa passa', recusa({ size: 256 }) === null)
check('segundos acima da faixa é recusado', !!recusa({ maxSeconds: 600 }))
check('qualidade fora de 1..100 é recusada', !!recusa({ quality: 0 }) && !!recusa({ quality: 101 }))
check('peso em KB fora da faixa é recusado', !!recusa({ maxKilobytes: 1 }))
// Campo inventado continua barrado: o schema é lista fechada, e um "tamanho"
// escrito errado precisa falhar na publicação, não virar campo ignorado.
check('campo que não existe continua recusado', !!recusa({ tamanhoDaFigurinha: 512 }))

// --- o motor leva o que foi DECLARADO, e só isso -------------------------
let n = 0
function evento (texto = '/fig') {
  n++
  return {
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:c:s:f${n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredBySelf: false, authoredByBot: false },
    message: { kind: 'image', text: texto, mediaRef: 'TOKEN', mediaKind: 'image' },
    providerRef: { provider: 'zapo', id: `f${n}` }
  }
}
function rodar (id) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  const r = avaliarEvento(db, evento())
  return (r.results || []).find((x) => x.automationId === id)?.commands[0]
}

publicar('fig-cheio', { size: 256, maxSeconds: 3, quality: 40, maxKilobytes: 300 })
publicar('fig-vazio', { notFoundText: 'manda uma foto' })

{
  const p = rodar('fig-cheio').payload
  check('os quatro números viajam no comando',
    p.size === 256 && p.maxSeconds === 3 && p.quality === 40 && p.maxKilobytes === 300, JSON.stringify(p))
}
{
  // Campo ausente NÃO vira número inventado pelo motor: quem decide o padrão é
  // o conversor, num lugar só. Dois padrões em dois arquivos divergem no
  // primeiro ajuste.
  const p = rodar('fig-vazio').payload
  check('o que não foi declarado não viaja',
    !('size' in p) && !('maxSeconds' in p) && !('quality' in p) && !('maxKilobytes' in p), JSON.stringify(p))
}

// --- o gateway aplica, e KB vira bytes -----------------------------------
function clienteFake () {
  const enviados = []
  return { enviados, getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }), message: { send: async (jid, c) => { enviados.push({ jid, c }); return { ok: true } } } }
}
const engineFake = { execucoes: { confirmar: async () => ({ ok: true }) } }

let recebido = null
const deps = {
  mediaRefCache: { resolver: () => ({ node: {}, tipo: 'image', interno: {} }) },
  baixarBuffer: async () => Buffer.from('crua'),
  converterParaFigurinha: async (_buf, opcoes) => { recebido = opcoes; return Buffer.from('WEBP') },
  podeVirarFigurinha: () => true,
  ehAnimada: (t) => t === 'video',
  limiteBytes: 999999,
  resolverJidProprio: () => '5511900000002@s.whatsapp.net'
}

await executarComandos(clienteFake(), [{
  id: 'c1',
  commandType: 'whatsapp.sticker',
  payload: { chatId: CHAT, mediaRef: 'ok', size: 256, maxSeconds: 3, quality: 40, maxKilobytes: 300 }
}], engineFake, deps)
check('o gateway repassa tamanho, segundos e qualidade',
  recebido?.tamanho === 256 && recebido?.duracaoMaxSegundos === 3 && recebido?.qualidade === 40, JSON.stringify(recebido))
// O limite do comando é em KB porque é número que gente escreve; o conversor
// pensa em bytes. A conversão tem que acontecer em UM lugar só.
check('e converte KB para bytes', recebido?.limiteBytes === 300 * 1024, String(recebido?.limiteBytes))

recebido = null
await executarComandos(clienteFake(), [{
  id: 'c2', commandType: 'whatsapp.sticker', payload: { chatId: CHAT, mediaRef: 'ok' }
}], engineFake, deps)
check('sem nada declarado, o gateway não inventa número',
  recebido?.tamanho === undefined && recebido?.limiteBytes === undefined, JSON.stringify(recebido))

// --- o padrão continua sendo o que era -----------------------------------
//
// Mexer nisto muda a aparência de toda figurinha já instalada. O caso existe
// para a mudança ser deliberada, nunca de passagem.
check('o padrão segue 512 px', PADRAO.tamanho === 512)
check('o padrão segue 6 segundos de vídeo', PADRAO.duracaoMaxSegundos === 6)
check('o padrão segue 1 MB', PADRAO.limiteBytes === 1024 * 1024)
check('a faixa do schema e a do conversor são a MESMA',
  FAIXAS.tamanho.min === 96 && FAIXAS.tamanho.max === 1024 &&
  FAIXAS.duracaoMaxSegundos.max === 30 && FAIXAS.limiteBytes.max === 10 * 1024 * 1024)

// --- o template entrega isso a quem instala ------------------------------
{
  const catalogo = carregarCatalogo()
  const fig = catalogo.get('figurinha')
  const chaves = (fig.parameters || []).map((p) => p.key)
  for (const k of ['tamanho', 'segundos', 'qualidade', 'pesoMaximoKB']) {
    check(`o template da figurinha pergunta "${k}"`, chaves.includes(k), chaves.join(', '))
  }
  const numericos = (fig.parameters || []).filter((p) => ['tamanho', 'segundos', 'qualidade', 'pesoMaximoKB'].includes(p.key))
  check('e pergunta como NÚMERO, não como texto livre', numericos.every((p) => p.type === 'number'),
    numericos.map((p) => `${p.key}:${p.type}`).join(' '))

  // O caminho inteiro: quem instala escolhe 256, e o documento publicado sai
  // com 256 — não com a string "{{params.tamanho}}" nem com NaN. O NaN era
  // real: `Number('{{params.tamanho}}')` vira NaN, que no JSON é null, e o
  // campo sumiria do documento sem erro nenhum.
  const documento = renderizarTemplate(fig, { command: '/fig', allowFrom: 'external', notFoundText: 'x', poolId: 'p', tamanho: 256, segundos: 4, qualidade: 60, pesoMaximoKB: 500 })
  const no = documento.flow.nodes.find((x) => x.type === 'action.whatsapp.sticker')
  check('instalando com 256, o documento sai com 256 (número, não texto)', no.config.size === 256, JSON.stringify(no.config))
  check('e o peso escolhido chega inteiro', no.config.maxKilobytes === 500, JSON.stringify(no.config.maxKilobytes))
}

// =========================================================================
// O ffmpeg como estado observável
// =========================================================================
check('a versão sai da primeira linha do "-version"',
  extrairVersao('ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2024\nbuilt with gcc') === '7.1.5-0+deb13u1')
check('saída sem a palavra "version" não inventa número',
  extrairVersao('qualquer coisa') === 'qualquer coisa')
check('saída vazia vira nada, nunca string vazia disfarçada', extrairVersao('') === null)

{
  _limparCacheParaTeste()
  const lista = await verificarDependencias({ forcar: true })
  const ffmpeg = lista.find((d) => d.nome === 'ffmpeg')
  check('o ffmpeg é listado como dependência externa', !!ffmpeg)
  check('e diz por quem é usado', ffmpeg.usadoPor.includes('Figurinha'))
  // Presente ou não depende da máquina — o que o caso exige é COERÊNCIA entre
  // os campos. "Instalado sem versão" ou "ausente sem motivo" seriam telas que
  // não explicam nada.
  check('presente vem com versão e sem motivo; ausente, o contrário',
    ffmpeg.presente ? (!!ffmpeg.versao && !ffmpeg.motivo) : (!ffmpeg.versao && !!ffmpeg.motivo),
    JSON.stringify({ presente: ffmpeg.presente, versao: ffmpeg.versao, motivo: ffmpeg.motivo }))
  check('e sempre diz o que para de funcionar sem ela', !!ffmpeg.semEla)
  // Nada de caminho de binário nem ambiente na resposta: é tela de painel.
  check('a resposta não carrega caminho de binário nem ambiente',
    !JSON.stringify(lista).match(/\/usr\/|PATH|HOME=/), JSON.stringify(lista).slice(0, 200))
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DA FIGURINHA CONFIGURÁVEL PASSARAM')
process.exit(falhas ? 1 : 0)
