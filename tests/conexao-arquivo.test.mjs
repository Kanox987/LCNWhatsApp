// Mandar ARQUIVO para uma função declarada — a peça que faltava para a
// figurinha sair do ffmpeg local e virar serviço.
//
// A DECISÃO QUE ESTES CASOS GUARDAM. A mídia da mensagem é um token opaco: o
// motor nunca vê os bytes (invariante 4). Então o nome da entrada que recebe o
// arquivo vive num campo PRÓPRIO do documento (`mediaInput`), e não no mapa de
// entradas — ali tudo passa pelo interpolador, e token de mídia no
// interpolador é exatamente o que o invariante proíbe. O motor repassa o
// token; quem o troca por bytes e monta o multipart é o gateway.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { criarExecutorDeConexao } from '../src/engine/conexaoExecutor.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { validarFuncao, ErroDeDeclaracao } from '../src/engine/server/conexoes/declaracao.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const recusa = (fn) => { try { fn(); return null } catch (e) { return e instanceof ErroDeDeclaracao ? e.message : `OUTRO ERRO: ${e.message}` } }

// =========================================================================
// 1. A declaração
// =========================================================================
const funcaoBase = {
  nome: 'converter',
  metodo: 'POST',
  caminho: '/figurinha',
  entradas: [{ nome: 'arquivo', tipo: 'mídia' }, { nome: 'tamanho', tipo: 'número' }],
  resposta: { forma: 'mídia', campo: 'arquivos', campoDoErro: 'erro' }
}
{
  const f = validarFuncao(funcaoBase)
  check('"mídia" é um tipo de entrada válido', f.entradas[0].tipo === 'mídia', f.entradas[0].tipo)
  check('e a forma de resposta imediata guarda o campo do erro', f.resposta.campoDoErro === 'erro')
}
// DUAS entradas de arquivo passam, e três não.
//
// Este caso dizia o contrário, com este motivo: "uma mensagem traz UMA mídia".
// Estava errado por um — a mensagem de um comando traz a que ela RESPONDE e a
// que vem ANEXADA, e é disso que a troca de fundo precisa: a foto da pessoa e
// a foto que vira o fundo. Uma terceira não teria de onde sair.
check('duas entradas de mídia são aceitas — é o caso da troca de fundo',
  validarFuncao({ ...funcaoBase, entradas: [{ nome: 'a', tipo: 'mídia' }, { nome: 'b', tipo: 'mídia' }] })
    .entradas.filter((e) => e.tipo === 'mídia').length === 2)
check('três entradas de mídia são recusadas — não há terceira mídia na mensagem',
  !!recusa(() => validarFuncao({
    ...funcaoBase,
    entradas: [{ nome: 'a', tipo: 'mídia' }, { nome: 'b', tipo: 'mídia' }, { nome: 'c', tipo: 'mídia' }]
  })))
// Arquivo viaja no corpo; GET não tem corpo. Recusar aqui evita uma declaração
// que nasce impossível e só falha na primeira chamada.
check('GET com entrada de mídia é recusado',
  !!recusa(() => validarFuncao({ ...funcaoBase, metodo: 'GET', caminho: '/x' })))
check('entrada de mídia com padrão é recusada',
  !!recusa(() => validarFuncao({ ...funcaoBase, entradas: [{ nome: 'arquivo', tipo: 'mídia', padrao: 'x' }] })))

// =========================================================================
// 2. O executor: multipart, e o campo vem da DECLARAÇÃO
// =========================================================================
const DECLARACAO = {
  id: 'figurinha',
  endereco: 'https://conv.exemplo.com',
  autenticacao: { tipo: 'bearer' },
  chave: 'CHAVE-SECRETA',
  funcoes: [{ ...validarFuncao(funcaoBase) }]
}

function servico (respostas) {
  const chamadas = []
  const buscar = async (url, opcoes = {}) => {
    chamadas.push({ url, metodo: opcoes.method, headers: opcoes.headers || {}, body: opcoes.body })
    const proxima = respostas.shift()
    if (proxima && proxima.arquivo !== undefined) {
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(proxima.arquivo) }
    }
    return { ok: true, status: 200, json: async () => proxima, arrayBuffer: async () => Buffer.from('bytes') }
  }
  return { buscar, chamadas }
}

const ARQUIVO = { buffer: Buffer.from('bytes-da-foto'), nome: 'arquivo.jpeg', mime: 'image/jpeg' }

{
  const s = servico([
    { arquivos: [{ url: '/arquivos/a.webp', mime: 'image/webp', bytes: 900, tipo: 'figurinha' }] },
    { arquivo: 'WEBP-CONVERTIDO' }
  ])
  const exec = criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
  const r = await exec.executar(DECLARACAO, 'converter', { tamanho: '512' }, ARQUIVO)

  const pedido = s.chamadas[0]
  check('o corpo vira multipart quando tem arquivo', pedido.body instanceof FormData, typeof pedido.body)
  // O boundary é gerado pelo FormData; fixar o Content-Type à mão faria o
  // serviço receber um corpo que ele não consegue separar.
  check('e o Content-Type NÃO é escrito à mão', !Object.keys(pedido.headers).some((h) => h.toLowerCase() === 'content-type'),
    JSON.stringify(Object.keys(pedido.headers)))
  check('a credencial continua viajando', pedido.headers.Authorization === 'Bearer CHAVE-SECRETA')
  check('o arquivo vai no campo que a FUNÇÃO declarou', pedido.body.get('arquivo') instanceof Blob)
  check('com o nome do arquivo preservado', pedido.body.get('arquivo')?.name === 'arquivo.jpeg', pedido.body.get('arquivo')?.name)
  check('e o tipo real, não octet-stream', pedido.body.get('arquivo')?.type === 'image/jpeg', pedido.body.get('arquivo')?.type)
  check('os campos comuns vão junto, no mesmo corpo', pedido.body.get('tamanho') === '512', pedido.body.get('tamanho'))

  // Este ramo era MORTO: `forma: mídia` era declarável e nunca buscava arquivo,
  // então a chamada terminava sempre em "não devolveu arquivo".
  check('a resposta imediata com arquivos agora é buscada', r.forma === 'mídia' && r.midias.length === 1,
    JSON.stringify({ forma: r.forma, n: r.midias?.length }))
  check('e os bytes chegam', r.midias[0]?.buffer.toString() === 'WEBP-CONVERTIDO')
  // Figurinha não é "imagem com outro nome": é outro tipo de envio, sem
  // legenda. Sem esta tradução o webp chegaria como foto.
  check('"figurinha" vira o tipo sticker do WhatsApp', r.midias[0]?.tipo === 'sticker', r.midias[0]?.tipo)
}
{
  // O nome do campo é da declaração, não do comando. Se a declaração mudou, o
  // erro é de configuração — e mandar num campo que o serviço não espera
  // falharia do outro lado, com uma mensagem que não aponta para cá.
  const semMidia = { ...DECLARACAO, funcoes: [validarFuncao({ ...funcaoBase, entradas: [{ nome: 'tamanho', tipo: 'número' }] })] }
  const s = servico([{ arquivos: [] }])
  const exec = criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
  let erro = null
  try { await exec.executar(semMidia, 'converter', {}, ARQUIVO) } catch (e) { erro = e }
  check('função sem entrada de mídia recusa o arquivo', !!erro && /não declara entrada de mídia/.test(erro.message), erro?.message)
  check('e a frase para a pessoa não fala de campo nem de endereço',
    !!erro?.paraPessoa && !/entrada de mídia/.test(erro.paraPessoa), erro?.paraPessoa)
  check('nada foi enviado ao serviço', s.chamadas.length === 0, String(s.chamadas.length))
}
{
  // Erro declarado na resposta imediata encerra a chamada, e o texto do serviço
  // é o que chega à pessoa.
  const s = servico([{ erro: 'esse vídeo é longo demais para figurinha' }])
  const exec = criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
  let erro = null
  try { await exec.executar(DECLARACAO, 'converter', {}, ARQUIVO) } catch (e) { erro = e }
  check('erro declarado na resposta imediata vira erro da chamada',
    erro?.message === 'esse vídeo é longo demais para figurinha', erro?.message)
}
{
  // Sem arquivo, a mesma função continua mandando JSON: o multipart é
  // consequência do arquivo, não da declaração.
  const s = servico([{ arquivos: [] }])
  const exec = criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
  await exec.executar(DECLARACAO, 'converter', { tamanho: '512' }, null).catch(() => {})
  check('sem arquivo, o corpo volta a ser JSON', typeof s.chamadas[0]?.body === 'string', typeof s.chamadas[0]?.body)
  check('e aí o Content-Type é declarado', s.chamadas[0]?.headers['Content-Type'] === 'application/json')
}

// =========================================================================
// 3. O motor: o token viaja FORA das entradas
// =========================================================================
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
db.prepare('INSERT INTO connections (id, kind, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  .run('figurinha', 'http', JSON.stringify({
    endereco: 'https://conv.exemplo.com',
    autenticacao: { tipo: 'bearer' },
    funcoes: [
      validarFuncao(funcaoBase),
      // Função que recebe SÓ o arquivo. É a forma real de "/toimg" e
      // "/roubar": nada para escrever, só a mídia marcada.
      validarFuncao({ ...funcaoBase, nome: 'so_arquivo', entradas: [{ nome: 'arquivo', tipo: 'mídia' }] })
    ]
  }), agora, agora)

const CHAT = '5511900000001@s.whatsapp.net'
function doc (id, config) {
  return {
    schemaVersion: 1, id, revision: 1, enabled: true, name: id,
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/fig', match: 'exact_or_args', allowFrom: 'any' } },
        { id: 'c', type: 'action.connection.call', config: { connectionRef: 'figurinha', function: 'converter', ...config } }
      ],
      edges: [{ from: 'g', to: 'c', on: 'matched' }]
    }
  }
}

// Pelo caminho normal de publicação, de propósito: é ele que escreve os
// escopos e que impõe o portão do invariante 7.
const automacoes = criarServicoAutomacoes(db)
function publicar (id, config) {
  automacoes.criarEPublicar({ id, document: doc(id, config) })
  db.prepare('UPDATE automations SET deployment_mode = ?, enabled = ? WHERE id = ?').run('live', 0, id)
}

let n = 0
function evento ({ comMidia = true, citada = false } = {}) {
  n++
  const ev = {
    provider: 'zapo', accountId: 'conta', eventId: `conta:c:s:a${n}`, occurredAt: agora, replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredBySelf: false, authoredByBot: false },
    message: { kind: comMidia && !citada ? 'image' : 'text', text: '/fig' },
    providerRef: { provider: 'zapo', id: `a${n}` }
  }
  if (comMidia && !citada) { ev.message.mediaRef = 'TOKEN-DA-PROPRIA'; ev.message.mediaKind = 'image' }
  if (citada) ev.message.quotedMediaRef = { token: 'TOKEN-DA-CITADA', kind: 'media', mediaKind: 'image' }
  return ev
}
function rodar (id, ev) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  return (avaliarEvento(db, ev).results || []).find((x) => x.automationId === id)
}

publicar('fig-api', { mediaInput: 'arquivo', inputs: { tamanho: '512' }, notFoundText: 'Manda uma foto.' })
publicar('fig-mudo', { mediaInput: 'arquivo', inputs: { tamanho: '512' } })

{
  const p = rodar('fig-api', evento()).commands[0].payload
  check('o token da mídia da mensagem viaja no comando', p.mediaRef === 'TOKEN-DA-PROPRIA', p.mediaRef)
  check('e o nome da entrada que o recebe vai junto', p.mediaInput === 'arquivo', p.mediaInput)
  // O ponto central: invariante 4. O token não pode estar no mapa que o
  // interpolador produz.
  check('o token NÃO está no mapa de entradas', !JSON.stringify(p.entradas).includes('TOKEN'), JSON.stringify(p.entradas))
  check('as entradas comuns continuam lá', p.entradas.tamanho === '512')
}
{
  // As duas formas de usar, as mesmas da figurinha: mídia junto com o comando,
  // ou comando respondendo uma mídia.
  const p = rodar('fig-api', evento({ citada: true })).commands[0].payload
  check('respondendo uma mídia, usa o token da citada', p.mediaRef === 'TOKEN-DA-CITADA', p.mediaRef)
}
{
  // Função que recebe SÓ o arquivo: não há entrada de texto nenhuma, e isso
  // não é falta. Com o arquivo na mão, o serviço é chamado.
  publicar('so-arquivo', { function: 'so_arquivo', mediaInput: 'arquivo', notFoundText: 'Manda uma foto.' })
  const r = rodar('so-arquivo', evento())
  check('comando que só manda o arquivo CHAMA o serviço',
    r.commands[0]?.commandType === 'connection.call', JSON.stringify(r.commands.map((c) => c.commandType)))
  check('e o arquivo vai junto', r.commands[0]?.payload.mediaRef === 'TOKEN-DA-PROPRIA')
  const semNada = rodar('so-arquivo', evento({ comMidia: false }))
  check('sem o arquivo, aí sim é falta', semNada.commands[0]?.payload.text === 'Manda uma foto.')
}
{
  const r = rodar('fig-api', evento({ comMidia: false }))
  check('sem mídia, responde o aviso em vez de chamar o serviço',
    r.commands.length === 1 && r.commands[0].commandType === 'whatsapp.reply', JSON.stringify(r.commands.map((c) => c.commandType)))
  check('e o aviso é o texto declarado', r.commands[0].payload.text === 'Manda uma foto.')
}
{
  // Sem texto de falta, NÃO se chama o serviço com o pedido vazio: ele
  // recusaria com uma mensagem que não aponta para cá. Vira erro registrado.
  const r = rodar('fig-mudo', evento({ comMidia: false }))
  check('sem aviso declarado, a falta de arquivo é erro registrado', r.status === 'error', r.status)
  check('e nada é enviado', r.commands.length === 0, JSON.stringify(r.commands))
  // O motivo é o que aparece na aba Execuções — é o único lugar onde isto se
  // explica, então precisa dizer o que faltou.
  const detalhe = db.prepare('SELECT detail_json FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT 1').get('fig-mudo')?.detail_json
  check('o motivo registrado diz que faltou o arquivo', /arquivo/.test(detalhe || ''), detalhe)
}

// =========================================================================
// 4. A publicação confere os dois lados
// =========================================================================
{
  // `validarAutomacao` devolve a LISTA de erros, não um objeto com `.errors` —
  // e ler a chave errada faria todo caso aqui passar por vacuidade.
  const erros = (config) => validarAutomacao(db, doc('v', config))
  check('mediaInput com nome que a função não tem é recusado',
    erros({ mediaInput: 'foto', inputs: { tamanho: '1' } }).some((e) => /se chama "arquivo"/.test(e.message)),
    JSON.stringify(erros({ mediaInput: 'foto', inputs: { tamanho: '1' } })))
  // Função que PEDE arquivo e comando que não diz de onde ele vem: a chamada
  // sairia sem o conteúdo que é o assunto dela.
  check('função que pede arquivo exige o mediaInput',
    erros({ inputs: { tamanho: '1' } }).some((e) => /precisa do arquivo/.test(e.message)),
    JSON.stringify(erros({ inputs: { tamanho: '1' } })))
  check('com os dois lados batendo, publica', erros({ mediaInput: 'arquivo', inputs: { tamanho: '1' } }).length === 0,
    JSON.stringify(erros({ mediaInput: 'arquivo', inputs: { tamanho: '1' } })))
  // A entrada de mídia não aparece em `inputs`, e escrevê-la ali é engano:
  // seria interpolada como texto.
  // Escrever a entrada de arquivo em `inputs` é engano que passaria calado: ali
  // o valor é interpolado como TEXTO, e o serviço receberia a string em vez do
  // arquivo.
  const comArquivoNoMapa = { mediaInput: 'arquivo', inputs: { arquivo: 'x', tamanho: '1' } }
  check('a entrada de arquivo escrita em inputs é recusada, dizendo por quê',
    erros(comArquivoNoMapa).some((e) => /entrada de ARQUIVO/.test(e.message)),
    JSON.stringify(erros(comArquivoNoMapa)))
}

// =========================================================================
// 5. O gateway troca o token por bytes
// =========================================================================
function clienteFake () {
  const enviados = []
  return { enviados, getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }), message: { send: async (jid, c) => { enviados.push({ jid, c }); return { ok: true, id: 'X' } } } }
}

let recebeuArquivo = null
function depsConexao ({ resolve = true, midias = [{ buffer: Buffer.from('WEBP'), nome: 'a.webp', mime: 'image/webp', tipo: 'sticker' }] } = {}) {
  return {
    mediaRefCache: { resolver: () => (resolve ? { node: { mimetype: 'image/jpeg' }, tipo: 'image', interno: {} } : null) },
    baixarBuffer: async () => Buffer.from('bytes-da-foto'),
    limiteBytes: 999999,
    resolverJidProprio: () => '5511900000002@s.whatsapp.net',
    clienteEngine: { conexoes: { resolvida: async () => DECLARACAO }, execucoes: { confirmar: async () => ({ ok: true }) } },
    criarExecutorDeConexao: () => ({
      executar: async (_d, _f, _e, arquivo) => { recebeuArquivo = arquivo; return { forma: 'mídia', midias, foraPorTamanho: 0 } }
    })
  }
}

{
  const deps = depsConexao()
  const c = clienteFake()
  await executarComandos(c, [{
    id: 'k1',
    commandType: 'connection.call',
    payload: { chatId: CHAT, conexao: 'figurinha', funcao: 'converter', entradas: { tamanho: '512' }, mediaInput: 'arquivo', mediaRef: 'TOKEN' }
  }], deps.clienteEngine, deps)

  check('o gateway resolve o token e entrega os BYTES', recebeuArquivo?.buffer?.toString() === 'bytes-da-foto', String(recebeuArquivo?.buffer))
  // O mime vem do nó da mídia — é o que o WhatsApp disse que aquilo é.
  check('com o mime que a mensagem trouxe', recebeuArquivo?.mime === 'image/jpeg', recebeuArquivo?.mime)
  check('e um nome com extensão coerente', recebeuArquivo?.nome === 'arquivo.jpeg', recebeuArquivo?.nome)
  check('a figurinha convertida é enviada como sticker', c.enviados[0]?.c?.type === 'sticker', c.enviados[0]?.c?.type)
  // Figurinha não aceita legenda: mandar uma faria a biblioteca recusar o
  // envio inteiro por causa de um campo decorativo.
  check('e sem legenda', c.enviados[0]?.c?.caption === undefined, JSON.stringify(c.enviados[0]?.c?.caption))
}
{
  // TTL do cache é curto de propósito. Erro CONHECIDO: nada foi enviado.
  let status = null
  const deps = depsConexao({ resolve: false })
  deps.clienteEngine.execucoes = { confirmar: async (_id, r) => { status = r.status } }
  const c = clienteFake()
  await executarComandos(c, [{
    id: 'k2',
    commandType: 'connection.call',
    payload: { chatId: CHAT, conexao: 'figurinha', funcao: 'converter', entradas: {}, mediaInput: 'arquivo', mediaRef: 'EXPIROU', errorText: '{{erro}}' }
  }], deps.clienteEngine, deps)
  check('token expirado vira "failed", não resultado incerto', status === 'failed', String(status))
  check('e a pessoa é avisada, em vez de ficar no vácuo',
    c.enviados.some((e) => /expirou/i.test(e.c?.text || '')), JSON.stringify(c.enviados.map((e) => e.c?.text)))
}

// =========================================================================
// 6. A linguagem: "arquivo: a mídia"
// =========================================================================
{
  const texto = [
    'automação fig-api',
    '  nome: Figurinha pela API',
    '  tipo: comando',
    '  dispara com: /fig',
    '  acessa: texto, foto, vídeo',
    '  casa: exato ou com argumentos',
    '  quem: só externos',
    '  precisa de uma mídia: na mensagem ou na citada',
    '  sem ela: "Manda uma foto ou vídeo curto."',
    '',
    '  chama figurinha.converter',
    '    com',
    '      arquivo: a mídia',
    '      tamanho: 512',
    '    sem dados: "Não consegui converter."',
    ''
  ].join('\n')

  const documento = compilar(texto)
  const no = documento.flow.nodes.find((x) => x.type === 'action.connection.call')
  check('"a mídia" compila para o campo próprio, não para uma entrada',
    no.config.mediaInput === 'arquivo' && !('arquivo' in (no.config.inputs || {})), JSON.stringify(no.config))
  // Sem aspas e parecendo número, o valor MANTÉM o tipo — a entrada declarada
  // na conexão tem tipo, e transformar 512 em "512" fazia a ida e volta deixar
  // de bater. Quem quer a string escreve com aspas, como na condição.
  check('e a entrada comum continua no mapa, como NÚMERO', no.config.inputs.tamanho === 512,
    JSON.stringify(no.config.inputs))

  const volta = descompilar(documento)
  check('a volta escreve "arquivo: a mídia", nunca o campo interno',
    volta.includes('arquivo: a mídia') && !volta.includes('mediaInput'), volta.split('\n').filter((l) => l.includes('arquivo')).join(' | '))
  check('ida e volta dá o MESMO documento',
    JSON.stringify(compilar(volta).flow) === JSON.stringify(documento.flow))
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ARQUIVO EM CONEXÃO PASSARAM')
process.exit(falhas ? 1 : 0)
