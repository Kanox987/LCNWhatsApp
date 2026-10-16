// DUAS FOTOS NUMA CHAMADA SÓ.
//
// A troca de fundo recebe a foto da pessoa e a foto que vira o fundo. Até
// aqui, uma função podia declarar UMA entrada de mídia, com este motivo
// escrito na declaração: "uma mensagem traz UMA mídia". Estava errado por um —
// a mensagem de um comando traz a que ela RESPONDE e a que vem ANEXADA.
//
// O que estes casos guardam é o desempate. Com as duas vindo do mesmo lugar,
// os dois campos receberiam a mesma foto e o serviço devolveria a pessoa
// colada nela mesma — sem erro nenhum, que é a pior forma de errar.
import { validarFuncao } from '../src/engine/server/conexoes/declaracao.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { criarExecutorDeConexao } from '../src/engine/conexaoExecutor.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const FUNCAO = validarFuncao({
  nome: 'fundo',
  metodo: 'POST',
  caminho: '/fundo',
  entradas: [
    { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
    { nome: 'imagem_fundo', tipo: 'mídia', obrigatoria: false },
    { nome: 'acao', tipo: 'opção', opcoes: ['trocar', 'desfocar'], obrigatoria: false, padrao: 'desfocar' }
  ],
  resposta: { forma: 'arquivo', campo: 'arquivo_base64', campoDoMime: 'mime', tipo: 'foto' }
})

// --- a linguagem diz qual foto é qual -------------------------------------
{
  const texto = [
    'automação trocar-fundo',
    '  nome: Trocar o fundo',
    '  tipo: comando',
    '  dispara com: /trocarfundo',
    '  pool: p',
    '  acessa: texto, foto',
    '  casa: exato ou com argumentos',
    '  quem: só externos',
    '',
    '  chama imagem.fundo',
    '    com',
    '      arquivo: a mídia citada',
    '      imagem_fundo: a mídia anexada',
    '      acao: "trocar"',
    ''
  ].join('\n')
  const doc = compilar(texto)
  const cfg = doc.flow.nodes.find((n) => n.type === 'action.connection.call').config
  check('"a mídia citada" vira o primeiro arquivo, vindo da citada',
    cfg.mediaInput === 'arquivo' && cfg.mediaFrom === 'citada', `${cfg.mediaInput}/${cfg.mediaFrom}`)
  check('"a mídia anexada" vira o segundo, vindo da mensagem',
    cfg.mediaInput2 === 'imagem_fundo' && cfg.mediaFrom2 === 'mensagem', `${cfg.mediaInput2}/${cfg.mediaFrom2}`)
  check('e nenhuma das duas entra no mapa de entradas, onde o token seria interpolado',
    !Object.hasOwn(cfg.inputs || {}, 'arquivo') && !Object.hasOwn(cfg.inputs || {}, 'imagem_fundo'))

  const volta = descompilar(doc)
  check('a ida e volta devolve as duas palavras',
    volta.includes('arquivo: a mídia citada') && volta.includes('imagem_fundo: a mídia anexada'))
}

// --- a publicação recusa os enganos que passariam calados ------------------
{
  const db = abrirBanco(':memory:')
  const agora = new Date().toISOString()
  db.prepare(`INSERT INTO connections (id, kind, config_json, secret_json, created_at, updated_at)
    VALUES ('imagem', 'http', ?, NULL, ?, ?)`)
    .run(JSON.stringify({ endereco: 'http://127.0.0.1:8767', autenticacao: { tipo: 'nenhuma' }, funcoes: [FUNCAO] }), agora, agora)

  db.prepare("INSERT INTO pools (id, label, created_at, updated_at) VALUES ('p', 'Pool', ?, ?)").run(agora, agora)

  const documento = (config) => ({
    id: 'x',
    revision: 1,
    schemaVersion: 1,
    enabled: true,
    name: 'X',
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/t', match: 'exact_or_args', allowFrom: 'external' } },
        { id: 'c', type: 'action.connection.call', config: { connectionRef: 'imagem', function: 'fundo', ...config } }
      ],
      edges: [{ from: 'g', to: 'c', on: 'matched' }]
    }
  })
  // Só o que este caso guarda: os erros DE ARQUIVO. O resto do documento é
  // cenário, e misturá-lo faria a verificação falhar por outro motivo.
  const erros = (config) => validarAutomacao(db, documento(config))
    .filter((e) => /media(Input|From)/.test(e.path || ''))
  const caminhoDoErro = (config) => JSON.stringify(erros(config))

  const certo = erros({ mediaInput: 'arquivo', mediaFrom: 'citada', mediaInput2: 'imagem_fundo', mediaFrom2: 'mensagem', inputs: { acao: 'trocar' } })
  check('duas fotos, de lugares diferentes: publica', certo.length === 0, JSON.stringify(certo))

  const mesmaOrigem = caminhoDoErro({ mediaInput: 'arquivo', mediaFrom: 'mensagem', mediaInput2: 'imagem_fundo', mediaFrom2: 'mensagem', inputs: {} })
  check('as duas da mesma origem são recusadas — receberiam a mesma foto',
    /mesma foto/.test(mesmaOrigem), mesmaOrigem.slice(0, 160))

  const mesmaEntrada = caminhoDoErro({ mediaInput: 'arquivo', mediaFrom: 'citada', mediaInput2: 'arquivo', mediaFrom2: 'mensagem', inputs: {} })
  check('as duas na mesma entrada são recusadas — a segunda entraria por cima',
    /mesma entrada/.test(mesmaEntrada), mesmaEntrada.slice(0, 160))

  const inventada = caminhoDoErro({ mediaInput: 'arquivo', mediaFrom: 'citada', mediaInput2: 'nao_existe', mediaFrom2: 'mensagem', inputs: {} })
  check('entrada de arquivo que a função não declara é recusada',
    /não recebe arquivo em \\"nao_existe\\"/.test(inventada), inventada.slice(0, 160))

  const sozinho = caminhoDoErro({ mediaInput2: 'imagem_fundo', mediaFrom2: 'mensagem', inputs: {} })
  check('segundo arquivo sem o primeiro é recusado', /só existe junto do primeiro/.test(sozinho), sozinho.slice(0, 160))

  // E o caso de sempre continua passando: uma foto só, na mesma função.
  const umaFoto = erros({ mediaInput: 'arquivo', inputs: { acao: 'desfocar' } })
  check('uma foto só, na função que aceita duas: publica', umaFoto.length === 0, JSON.stringify(umaFoto))
  db.close()
}

// --- o motor escolhe QUAL foto vai em qual campo --------------------------
//
// É aqui que o desempate acontece de verdade: o comando diz "a citada é o
// assunto, a anexada é o fundo", e o motor traduz isso em dois tokens.
{
  const db = abrirBanco(':memory:')
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
  db.prepare(`INSERT INTO connections (id, kind, config_json, secret_json, created_at, updated_at)
    VALUES ('imagem', 'http', ?, NULL, ?, ?)`)
    .run(JSON.stringify({ endereco: 'http://127.0.0.1:8767', autenticacao: { tipo: 'nenhuma' }, funcoes: [FUNCAO] }), agora, agora)

  const servico = criarServicoAutomacoes(db)
  servico.criarEPublicar({
    id: 'trocar',
    document: {
      schemaVersion: 1,
      enabled: true,
      name: 'Trocar o fundo',
      scope: { include: [{ kind: 'everywhere' }], exclude: [] },
      inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
      responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
      flow: {
        nodes: [
          { id: 'g', type: 'trigger.command', config: { command: '/trocarfundo', match: 'exact_or_args', allowFrom: 'any' } },
          {
            id: 'c',
            type: 'action.connection.call',
            config: {
              connectionRef: 'imagem',
              function: 'fundo',
              mediaInput: 'arquivo',
              mediaFrom: 'citada',
              mediaInput2: 'imagem_fundo',
              mediaFrom2: 'mensagem',
              inputs: { acao: 'trocar' },
              notFoundText: 'Precisa de duas fotos.'
            }
          }
        ],
        edges: [{ from: 'g', to: 'c', on: 'matched' }]
      }
    }
  })
  db.prepare("UPDATE automations SET deployment_mode = 'live' WHERE id = 'trocar'").run()

  let n = 0
  const evento = ({ comAnexada, comCitada }) => ({
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:c:s:m${++n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
    sender: { id: '5511@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
    message: {
      kind: comAnexada ? 'image' : 'text',
      text: '/trocarfundo',
      ...(comAnexada ? { mediaRef: 'TOKEN-ANEXADA', mediaKind: 'image' } : {}),
      ...(comCitada ? { quotedMediaRef: { token: 'TOKEN-CITADA', mediaKind: 'image' } } : {})
    },
    providerRef: { provider: 'zapo', id: `m${n}` }
  })
  const comandoDe = (ev) => (avaliarEvento(db, ev).results || []).flatMap((x) => x.commands || [])[0]

  const cmd = comandoDe(evento({ comAnexada: true, comCitada: true }))
  check('com as duas fotos, o motor chama o serviço', cmd?.commandType === 'connection.call', JSON.stringify(cmd)?.slice(0, 120))
  check('a foto RESPONDIDA é o assunto', cmd?.payload.mediaRef === 'TOKEN-CITADA', cmd?.payload.mediaRef)
  check('a foto ANEXADA é o fundo', cmd?.payload.mediaRef2 === 'TOKEN-ANEXADA', cmd?.payload.mediaRef2)
  check('e cada uma leva o nome do campo que a recebe',
    cmd?.payload.mediaInput === 'arquivo' && cmd?.payload.mediaInput2 === 'imagem_fundo')
  // O motor nunca viu os bytes: o que atravessa é token (invariante 4).
  check('o comando leva tokens, não arquivo', !JSON.stringify(cmd).includes('base64'))

  // Com uma foto só, o serviço receberia um pedido de troca sem o fundo e
  // recusaria com uma mensagem que não aponta para cá.
  const soUma = comandoDe(evento({ comAnexada: true, comCitada: false }))
  check('faltando a foto respondida, não chama o serviço', soUma?.commandType === 'whatsapp.reply', soUma?.commandType)
  check('e diz o que faltou', soUma?.payload.text === 'Precisa de duas fotos.', soUma?.payload.text)

  const soCitada = comandoDe(evento({ comAnexada: false, comCitada: true }))
  check('faltando a foto anexada, também não chama', soCitada?.commandType === 'whatsapp.reply', soCitada?.commandType)
  db.close()
}

// --- o multipart leva os dois campos --------------------------------------
{
  const enviados = []
  const buscar = async (url, opcoes = {}) => {
    enviados.push({ url, body: opcoes.body })
    return { ok: true, status: 200, json: async () => ({ arquivo_base64: Buffer.from('pronta').toString('base64'), mime: 'image/jpeg' }) }
  }
  const declaracao = {
    id: 'imagem', endereco: 'http://127.0.0.1:8767', autenticacao: { tipo: 'nenhuma' }, chave: null, funcoes: [FUNCAO]
  }
  const r = await criarExecutorDeConexao({ buscar, dormir: async () => {} }).executar(
    declaracao,
    'fundo',
    { acao: 'trocar' },
    { buffer: Buffer.from('a-pessoa'), nome: 'pessoa.jpg', mime: 'image/jpeg' },
    { buffer: Buffer.from('a-praia'), nome: 'praia.jpg', mime: 'image/jpeg', campo: 'imagem_fundo' }
  )
  const forma = enviados[0].body
  check('o corpo vira multipart', forma instanceof FormData)
  check('com a foto da pessoa no campo da função', forma.get('arquivo') instanceof Blob)
  check('e a foto do fundo no campo que o comando nomeou', forma.get('imagem_fundo') instanceof Blob)
  check('os dois arquivos são diferentes',
    (await forma.get('arquivo').text()) === 'a-pessoa' && (await forma.get('imagem_fundo').text()) === 'a-praia')
  check('as entradas de texto continuam no mesmo corpo', forma.get('acao') === 'trocar')
  check('e a resposta volta como foto', r.midias[0].tipo === 'image', r.midias[0].tipo)
}

// --- uma foto só continua indo num campo só -------------------------------
{
  const enviados = []
  const buscar = async (url, opcoes = {}) => {
    enviados.push(opcoes.body)
    return { ok: true, status: 200, json: async () => ({ arquivo_base64: Buffer.from('ok').toString('base64'), mime: 'image/jpeg' }) }
  }
  const declaracao = { id: 'imagem', endereco: 'http://127.0.0.1:8767', autenticacao: { tipo: 'nenhuma' }, funcoes: [FUNCAO] }
  await criarExecutorDeConexao({ buscar, dormir: async () => {} })
    .executar(declaracao, 'fundo', { acao: 'desfocar' }, { buffer: Buffer.from('foto'), nome: 'f.jpg', mime: 'image/jpeg' })
  check('sem a segunda foto, o campo dela nem aparece', enviados[0].get('imagem_fundo') === null)
  check('e a primeira vai no campo declarado pela função', enviados[0].get('arquivo') instanceof Blob)
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nduas fotos: tudo certo')
