// Executar uma função declarada — lado do gateway.
//
// É o outro lado do `connection.call` que o motor emite. O que estes casos
// guardam é que TUDO vem da declaração: endereço, método, onde a credencial
// entra, e como acompanhar uma resposta que não vem na hora. Era isso que
// estava fixo dentro de src/downloader.js e que o dono queria ver e poder
// trocar — "baixar aí aparece no código interno e não como configurável".
import { criarExecutorDeConexao, ErroDeConexao } from '../src/engine/conexaoExecutor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const semDormir = async () => {}
function servico (respostas) {
  const chamadas = []
  const buscar = async (url, opcoes = {}) => {
    chamadas.push({ url, metodo: opcoes.method, headers: opcoes.headers || {}, body: opcoes.body })
    const proxima = respostas.shift()
    if (typeof proxima === 'function') return proxima()
    // O dublê serve JSON e ARQUIVO: depois que o trabalho termina, o executor
    // busca cada mídia apontada. `arquivo:` diz "esta resposta são bytes".
    if (proxima && proxima.arquivo !== undefined) {
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(proxima.arquivo) }
    }
    return { ok: true, status: 200, json: async () => proxima, arrayBuffer: async () => Buffer.from('bytes') }
  }
  return { buscar, chamadas }
}

const DECLARACAO = {
  id: 'midia',
  endereco: 'https://api.exemplo.com',
  autenticacao: { tipo: 'bearer' },
  chave: 'CHAVE-SECRETA',
  funcoes: [{
    nome: 'baixar',
    metodo: 'POST',
    caminho: '/download',
    enderecoProprio: false,
    entradas: [
      { nome: 'url', tipo: 'texto', obrigatoria: true },
      { nome: 'modo', tipo: 'opção', opcoes: ['auto', 'video'], padrao: 'auto' }
    ],
    resposta: {
      forma: 'trabalho',
      campoDoTrabalho: 'job',
      caminhoDeAcompanhamento: '/jobs/{job}',
      campoDoEstado: 'estado',
      estadosEmAndamento: ['na_fila', 'baixando'],
      campoDoResultado: 'midias',
      campoDoErro: 'erro'
    }
  }]
}

// --- o caminho completo: pedido, acompanhamento, resultado ---------------
{
  const s = servico([
    { job: 'j1' },
    { estado: 'na_fila' },
    { estado: 'baixando' },
    { estado: 'pronto', midias: [{ url: '/m/1', tipo: 'imagem', mime: 'image/jpeg', nome: 'a.jpg' }, { url: '/m/2', tipo: 'imagem', mime: 'image/jpeg', nome: 'b.jpg' }] },
    { arquivo: 'foto-1' },
    { arquivo: 'foto-2' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(DECLARACAO, 'baixar', { url: 'https://x/y' })

  check('chama o endereço da conexão com o caminho da função',
    s.chamadas[0].url === 'https://api.exemplo.com/download', s.chamadas[0].url)
  check('com o método declarado', s.chamadas[0].metodo === 'POST')
  check('as entradas viram o corpo', JSON.parse(s.chamadas[0].body).url === 'https://x/y')
  // O padrão declarado entra no que a automação não informou.
  check('e o padrão declarado preenche o que faltou', JSON.parse(s.chamadas[0].body).modo === 'auto')

  check('acompanha até um estado que NÃO é de andamento', s.chamadas.length === 6, String(s.chamadas.length))
  check('pelo caminho declarado, com o identificador no lugar do marcador',
    s.chamadas[1].url === 'https://api.exemplo.com/jobs/j1', s.chamadas[1].url)

  // O executor já traz os bytes: ele tem o endereço e a credencial, e quem
  // entrega (o gateway) não precisa saber nada do serviço.
  check('busca TODOS os arquivos apontados', r.midias.length === 2, JSON.stringify(r.midias.map((m) => m.nome)))
  check('resolvendo o caminho relativo contra o endereço da conexão',
    s.chamadas[4].url === 'https://api.exemplo.com/m/1', s.chamadas[4].url)
  check('com os bytes de cada um', r.midias[0].buffer.toString() === 'foto-1' && r.midias[1].buffer.toString() === 'foto-2')
  check('e o tipo traduzido para o que o WhatsApp entende', r.midias[0].tipo === 'image', r.midias[0].tipo)
}

// --- arquivo grande demais não leva os outros junto ----------------------
//
// Num post de várias fotos, recusar tudo por causa de um vídeo entregaria zero
// foto. E entregar 2 de 3 calado faria a pessoa achar que o post tinha 2.
{
  const s = servico([
    { job: 'j' },
    { estado: 'pronto', midias: [
      { url: '/m/1', tipo: 'imagem', mime: 'image/jpeg', bytes: 10 },
      { url: '/m/2', tipo: 'video', mime: 'video/mp4', bytes: 900 * 1024 * 1024 },
      { url: '/m/3', tipo: 'imagem', mime: 'image/jpeg', bytes: 12 }
    ] },
    { arquivo: 'f1' },
    { arquivo: 'f3' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir, limiteBytes: 64 * 1024 * 1024 })
    .executar(DECLARACAO, 'baixar', { url: 'x' })
  check('o grande fica de fora e os outros seguem', r.midias.length === 2, String(r.midias.length))
  check('e quem entrega sabe quantos ficaram de fora', r.foraPorTamanho === 1, String(r.foraPorTamanho))
  // O grande nem é transferido: o tamanho vem no registro, antes de puxar.
  check('o arquivo grande nem chega a ser buscado',
    !s.chamadas.some((c) => c.url.endsWith('/m/2')), JSON.stringify(s.chamadas.map((c) => c.url)))
}
{
  const s = servico([
    { job: 'j' },
    { estado: 'pronto', midias: [{ url: '/m/1', bytes: 900 * 1024 * 1024 }] }
  ])
  const erro = await (async () => {
    try { await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(DECLARACAO, 'baixar', { url: 'x' }); return null } catch (e) { return e }
  })()
  check('se NENHUM couber, aí sim é erro, com o tamanho', /MB/.test(erro?.message || ''), erro?.message)
}

// --- a credencial entra do jeito declarado -------------------------------
{
  const s = servico([{ job: 'j' }, { estado: 'pronto', midias: [] }])
  await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(DECLARACAO, 'baixar', { url: 'x' })
  check('bearer vira Authorization', s.chamadas[0].headers.Authorization === 'Bearer CHAVE-SECRETA', JSON.stringify(s.chamadas[0].headers))
  check('e acompanha o acompanhamento também', s.chamadas[1].headers.Authorization === 'Bearer CHAVE-SECRETA')
}
{
  const decl = { ...DECLARACAO, autenticacao: { tipo: 'cabeçalho', nome: 'X-API-Key' } }
  const s = servico([{ job: 'j' }, { estado: 'pronto', midias: [] }])
  await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(decl, 'baixar', { url: 'x' })
  check('cabeçalho próprio entra com o nome declarado', s.chamadas[0].headers['X-API-Key'] === 'CHAVE-SECRETA')
  check('e NÃO vira Authorization', s.chamadas[0].headers.Authorization === undefined)
}
{
  const decl = { ...DECLARACAO, autenticacao: { tipo: 'parâmetro', nome: 'api_key' } }
  const s = servico([{ job: 'j' }, { estado: 'pronto', midias: [] }])
  await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(decl, 'baixar', { url: 'x' })
  check('parâmetro entra na URL', s.chamadas[0].url.includes('api_key=CHAVE-SECRETA'), s.chamadas[0].url)
}
{
  const decl = { ...DECLARACAO, autenticacao: { tipo: 'nenhuma' } }
  const s = servico([{ job: 'j' }, { estado: 'pronto', midias: [] }])
  await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(decl, 'baixar', { url: 'x' })
  check('sem autenticação, nada de credencial na chamada',
    !JSON.stringify(s.chamadas[0]).includes('CHAVE-SECRETA'))
}

// --- função apontando para OUTRO servidor não leva a chave ---------------
//
// Bastaria alguém editar um campo de caminho sem perceber para a credencial de
// um serviço ser entregue a outro.
{
  const decl = {
    ...DECLARACAO,
    funcoes: [{ ...DECLARACAO.funcoes[0], caminho: 'https://outra.com/x', enderecoProprio: true, resposta: { forma: 'texto' } }]
  }
  const s = servico([{ ok: true }])
  await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(decl, 'baixar', { url: 'x' })
  check('a chamada vai para o outro servidor', s.chamadas[0].url === 'https://outra.com/x')
  check('mas SEM a credencial desta conexão', !JSON.stringify(s.chamadas[0].headers).includes('CHAVE-SECRETA'),
    JSON.stringify(s.chamadas[0].headers))
}

// --- GET não leva corpo ---------------------------------------------------
{
  const decl = {
    ...DECLARACAO,
    funcoes: [{ ...DECLARACAO.funcoes[0], metodo: 'GET', resposta: { forma: 'texto', campo: 'resposta' } }]
  }
  const s = servico([{ resposta: 'oi' }])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(decl, 'baixar', { url: 'https://x/y' })
  check('GET manda as entradas na query, não no corpo', s.chamadas[0].body === undefined && s.chamadas[0].url.includes('url='), s.chamadas[0].url)
  check('e a resposta simples sai pelo campo declarado', r.dados === 'oi')
}

// --- erros: diagnóstico no log, frase limpa na conversa -----------------
const recusa = async (fn) => { try { await fn(); return null } catch (e) { return e } }
{
  const s = servico([() => ({ ok: false, status: 500, json: async () => ({}) })])
  const erro = await recusa(() => criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(DECLARACAO, 'baixar', { url: 'x' }))
  check('500 vira erro', erro instanceof ErroDeConexao)
  check('o diagnóstico guarda o status', /500/.test(erro.message))
  check('e a frase para a pessoa NÃO tem status nem endereço',
    !/500|api\.exemplo/.test(erro.paraPessoa), erro.paraPessoa)
}
{
  const s = servico([() => ({ ok: false, status: 401, json: async () => ({}) })])
  const erro = await recusa(() => criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(DECLARACAO, 'baixar', { url: 'x' }))
  check('credencial recusada não manda a pessoa conferir token nenhum',
    !/token|credencial|401/i.test(erro.paraPessoa), erro.paraPessoa)
}
{
  const s = servico([{ job: 'j' }, { estado: 'erro', erro: 'link não suportado' }])
  const erro = await recusa(() => criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(DECLARACAO, 'baixar', { url: 'x' }))
  check('o erro que o SERVIÇO reportou chega inteiro — esse é acionável', /link não suportado/.test(erro.message))
}
{
  const erro = await recusa(() => criarExecutorDeConexao({ buscar: servico([]).buscar, dormir: semDormir }).executar(DECLARACAO, 'inventada', {}))
  check('função que não existe na declaração é erro', erro instanceof ErroDeConexao)
  check('e a pessoa não recebe nome de função interna',
    !/inventada/.test(erro.paraPessoa), erro.paraPessoa)
}

// --- estado desconhecido encerra, não gira para sempre -------------------
{
  const s = servico([{ job: 'j' }, { estado: 'estado_que_nao_conheco', midias: [] }])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir }).executar(DECLARACAO, 'baixar', { url: 'x' })
  check('estado desconhecido encerra a espera em vez de girar', s.chamadas.length === 2, String(s.chamadas.length))
  check('e devolve o que veio, sem arquivo nenhum para buscar', Array.isArray(r.midias) && r.midias.length === 0,
    JSON.stringify(r.midias))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO EXECUTOR DE CONEXÃO PASSARAM')
process.exit(falhas ? 1 : 0)
