// O /play e o /buscar: a música pelo nome e a lista de opções.
//
// O pedido do dono: "criei uma download de música pelo youtube tipo o antigo
// play do asta, recrie o comando play pra baixar musica pela api" e "crie o
// comando buscar que busca opções de músicas pra download, já tem essa opção
// na api".
//
// O que estes casos guardam é o que custou a existir: a resposta em LISTA (uma
// busca devolve cinco objetos, e sem esta forma o JSON cru ia para a conversa),
// a legenda saindo do campo DECLARADO (em música, `descricao` traz o texto que
// o YouTube gera sozinho, e o nome da faixa está em `titulo`) e a legenda que
// se perdia quando a primeira mídia era áudio.
import { criarExecutorDeConexao } from '../src/engine/conexaoExecutor.js'
import { validarConfiguracao, validarFuncao, ErroDeDeclaracao } from '../src/engine/server/conexoes/declaracao.js'
import { conexaoProntaPorId } from '../src/engine/server/conexoes/prontas.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const semDormir = async () => {}
function servico (respostas) {
  const chamadas = []
  const buscar = async (url, opcoes = {}) => {
    chamadas.push({ url, metodo: opcoes.method, body: opcoes.body })
    const proxima = respostas.shift()
    if (proxima && proxima.arquivo !== undefined) {
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(proxima.arquivo) }
    }
    if (proxima && proxima.status && !proxima.ok) {
      return { ok: false, status: proxima.status, json: async () => proxima.corpo }
    }
    return { ok: true, status: 200, json: async () => proxima }
  }
  return { buscar, chamadas }
}

const MIDIA = conexaoProntaPorId('midia')
const DECLARACAO = { id: 'midia', chave: 'CHAVE', ...validarConfiguracao(MIDIA.config) }

// --- a conexão pronta declara as duas funções novas ----------------------
{
  const nomes = DECLARACAO.funcoes.map((f) => f.nome)
  check('a conexão de mídia declara baixar, musica e buscar',
    nomes.includes('baixar') && nomes.includes('musica') && nomes.includes('buscar'), nomes.join(', '))

  const musica = DECLARACAO.funcoes.find((f) => f.nome === 'musica')
  check('musica recebe o NOME, não o link', musica.entradas.some((e) => e.nome === 'busca' && e.obrigatoria))
  check('musica não pede link nenhum', !musica.entradas.some((e) => e.nome === 'url'))
  check('musica pede modo musica por padrão', musica.entradas.find((e) => e.nome === 'modo').padrao === 'musica')
  // A legenda de música NÃO é a descrição: lá vem "Provided to YouTube by",
  // produtor, compositor. O nome da faixa está em `titulo`.
  check('musica tira a legenda do título', musica.resposta.campoDaDescricao === 'titulo')
  check('o download de post continua tirando a legenda da descrição',
    DECLARACAO.funcoes.find((f) => f.nome === 'baixar').resposta.campoDaDescricao === 'descricao')
  check('musica espera mais que os 20s padrão', musica.esperaSegundos === 120)

  const buscarFn = DECLARACAO.funcoes.find((f) => f.nome === 'buscar')
  check('buscar responde em lista', buscarFn.resposta.forma === 'lista')
  check('buscar aponta onde está a lista', buscarFn.resposta.campo === 'achados')
  check('buscar lê o erro do campo do FastAPI', buscarFn.resposta.campoDoErro === 'detail')
}

// --- a forma "lista", validada --------------------------------------------
{
  const base = { nome: 'f', caminho: '/x', entradas: [] }
  let erro = null
  try { validarFuncao({ ...base, resposta: { forma: 'lista', linha: '{{n}}' } }) } catch (e) { erro = e }
  check('lista sem o campo da lista é recusada', erro instanceof ErroDeDeclaracao)

  erro = null
  try { validarFuncao({ ...base, resposta: { forma: 'lista', campo: 'itens' } }) } catch (e) { erro = e }
  check('lista sem a linha é recusada', erro instanceof ErroDeDeclaracao)

  erro = null
  try { validarFuncao({ ...base, resposta: { forma: 'lista', campo: 'itens', linha: '{{n}}', limite: 0 } }) } catch (e) { erro = e }
  check('limite 0 é recusado — lista de zero item não é lista', erro instanceof ErroDeDeclaracao)

  const ok = validarFuncao({ ...base, resposta: { forma: 'lista', campo: 'itens', linha: '{{n}}. {{titulo}}', limite: 3 } })
  check('lista válida atravessa com limite', ok.resposta.limite === 3)
}

// --- a busca, de ponta a ponta -------------------------------------------
{
  const s = servico([{
    busca: 'evidencias',
    achados: [
      { id: 'a', url: 'https://y/a', titulo: 'Evidências', autor: 'Chitãozinho & Xororó', duracao_texto: '4:59' },
      { id: 'b', url: 'https://y/b', titulo: 'Evidências (Ao Vivo)', autor: 'Bruno & Marrone', duracao_texto: '4:23' }
    ]
  }])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(DECLARACAO, 'buscar', { busca: 'evidencias' })

  check('a busca responde como texto', r.forma === 'texto')
  const linhas = String(r.dados).split('\n')
  check('a primeira linha é o cabeçalho com o termo buscado',
    linhas[0] === '🔎 Achei isto para "evidencias":', linhas[0])
  check('cada item é numerado', linhas[1].startsWith('*1.*') && linhas[4].startsWith('*2.*'), linhas[1])
  check('o item traz título, autor e duração', linhas[1].includes('Evidências') && linhas[2].includes('Chitãozinho') && linhas[2].includes('4:59'))
  check('o item traz o link, que é como pedir a versão certa', linhas[3] === 'https://y/a', linhas[3])
  check('a busca não vira download', s.chamadas.length === 1 && s.chamadas[0].url.endsWith('/buscar'))
}

// --- busca sem resultado, e busca recusada -------------------------------
{
  const s = servico([{ busca: 'asdfghjkl', achados: [] }])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(DECLARACAO, 'buscar', { busca: 'asdfghjkl' })
  check('lista vazia responde a frase declarada, não uma lista vazia',
    r.dados === 'Não achei nada com esse nome no YouTube.', r.dados)

  const ruim = servico([{ ok: false, status: 400, corpo: { detail: 'Termo longo demais (máximo 200).' } }])
  let paraPessoa = null
  try {
    await criarExecutorDeConexao({ buscar: ruim.buscar, dormir: semDormir })
      .executar(DECLARACAO, 'buscar', { busca: 'x'.repeat(300) })
  } catch (erro) { paraPessoa = erro.paraPessoa }
  check('a recusa do serviço chega à pessoa com a frase dele',
    paraPessoa === 'Termo longo demais (máximo 200).', paraPessoa)
}

// --- campo que não existe no item fica literal ---------------------------
{
  const declaracaoTorta = {
    ...DECLARACAO,
    funcoes: [validarFuncao({
      nome: 'buscar', caminho: '/buscar', entradas: [],
      resposta: { forma: 'lista', campo: 'achados', linha: '{{n}}. {{titulo}} — {{preco}}' }
    })]
  }
  const s = servico([{ achados: [{ titulo: 'Uma música' }] }])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(declaracaoTorta, 'buscar', {})
  // Ausente fica literal: quem declarou vê qual campo errou, em vez de uma
  // linha que parece certa com um pedaço faltando.
  check('marcador sem valor no item fica literal', r.dados === '1. Uma música — {{preco}}', r.dados)
}

// --- a música, de ponta a ponta ------------------------------------------
{
  const s = servico([
    { job: 'j1', escolhido: { titulo: 'Evidências (Remastered 2020)' } },
    { estado: 'baixando' },
    {
      estado: 'pronto',
      titulo: 'Evidências (Remastered 2020)',
      // A descrição que o YouTube gera sozinho, que é exatamente o que NÃO
      // deve virar legenda.
      descricao: 'Provided to YouTube by Universal Music Group\n\nProducer: Jose Homero',
      midias: [
        { url: '/media/1', tipo: 'audio', mime: 'audio/mp4', nome: '01 Evidencias.m4a' },
        { url: '/media/2', tipo: 'imagem', mime: 'image/jpeg', nome: '02 Evidencias.jpg' }
      ]
    },
    { arquivo: 'o-audio' },
    { arquivo: 'a-capa' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(DECLARACAO, 'musica', { busca: 'evidencias remastered' })

  check('a música volta com os dois arquivos', r.midias.length === 2)
  check('o áudio vem primeiro', r.midias[0].tipo === 'audio' && r.midias[1].tipo === 'image')
  check('a legenda é o nome da faixa, não o texto gerado pelo YouTube',
    r.descricao === 'Evidências (Remastered 2020)', r.descricao)
  const corpo = JSON.parse(s.chamadas[0].body)
  check('o pedido leva o nome em "busca"', corpo.busca === 'evidencias remastered')
  check('o pedido leva o modo musica por padrão da declaração', corpo.modo === 'musica')
  check('o pedido não leva url', corpo.url === undefined)
}

// --- a entrega: áudio, capa, e a legenda que se perdia -------------------
//
// O defeito era real e silencioso: a legenda ia só na PRIMEIRA mídia, e áudio
// não aceita legenda no WhatsApp. Com áudio em primeiro lugar — que é a ordem
// que o serviço entrega, de propósito — o nome da faixa não era enviado por
// lugar nenhum.
{
  const enviados = []
  const client = {
    getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }),
    message: { send: async (jid, c) => { enviados.push({ jid, c }); return { ok: true, id: 'X' } } }
  }
  const midias = [
    { buffer: Buffer.from('audio'), nome: '01 m.m4a', mime: 'audio/mp4', tipo: 'audio' },
    { buffer: Buffer.from('capa'), nome: '02 m.jpg', mime: 'image/jpeg', tipo: 'image' }
  ]
  const deps = {
    mediaRefCache: { resolver: () => null },
    baixarBuffer: async () => Buffer.from('x'),
    limiteBytes: 999999,
    resolverJidProprio: () => '5511900000002@s.whatsapp.net',
    clienteEngine: {
      conexoes: { resolvida: async () => DECLARACAO },
      execucoes: { confirmar: async () => ({ ok: true }) }
    },
    criarExecutorDeConexao: () => ({
      executar: async () => ({ forma: 'mídia', midias, foraPorTamanho: 0, descricao: 'Evidências (Remastered 2020)' })
    })
  }
  await executarComandos(client, [{
    id: 'play-1',
    commandType: 'connection.call',
    payload: {
      chatId: '5511999@s.whatsapp.net',
      conexao: 'midia',
      funcao: 'musica',
      entradas: { busca: 'evidencias' },
      entrega: 'separate'
    }
  }], deps.clienteEngine, deps)

  const tipos = enviados.map((e) => e.c?.type)
  check('o áudio e a capa saem um depois do outro', tipos.join(',') === 'audio,image', tipos.join(','))
  check('o áudio sai sem legenda, que o WhatsApp não aceita', enviados[0].c.caption === undefined)
  check('a legenda vai na capa, em vez de desaparecer',
    enviados[1].c.caption === 'Evidências (Remastered 2020)', String(enviados[1].c.caption))
}

// --- áudio sozinho: a legenda vira mensagem ------------------------------
{
  const enviados = []
  const client = {
    getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }),
    message: { send: async (jid, c) => { enviados.push({ jid, c }); return { ok: true, id: 'X' } } }
  }
  const deps = {
    mediaRefCache: { resolver: () => null },
    baixarBuffer: async () => Buffer.from('x'),
    limiteBytes: 999999,
    resolverJidProprio: () => '5511900000002@s.whatsapp.net',
    clienteEngine: {
      conexoes: { resolvida: async () => DECLARACAO },
      execucoes: { confirmar: async () => ({ ok: true }) }
    },
    criarExecutorDeConexao: () => ({
      executar: async () => ({
        forma: 'mídia',
        midias: [{ buffer: Buffer.from('audio'), nome: 'm.m4a', mime: 'audio/mp4', tipo: 'audio' }],
        foraPorTamanho: 0,
        descricao: 'Só o áudio'
      })
    })
  }
  await executarComandos(client, [{
    id: 'play-2',
    commandType: 'connection.call',
    payload: { chatId: '5511999@s.whatsapp.net', conexao: 'midia', funcao: 'musica', entradas: {}, entrega: 'separate' }
  }], deps.clienteEngine, deps)

  check('sem nenhuma mídia que aceite legenda, ela sai como mensagem',
    enviados.map((e) => e.c?.type).join(',') === 'audio,text', enviados.map((e) => e.c?.type).join(','))
  check('e com o texto certo', enviados[1]?.c?.text === 'Só o áudio', String(enviados[1]?.c?.text))
}

// --- os comandos no catálogo ---------------------------------------------
{
  const catalogo = carregarCatalogo()
  const play = catalogo.get('tocar-musica')
  const busca = catalogo.get('buscar-musica')
  check('o catálogo traz o comando de tocar música', !!play)
  check('o catálogo traz o comando de buscar música', !!busca)

  const nos = play.documentTemplate.flow.nodes
  const chamada = nos.find((n) => n.type === 'action.connection.call')
  check('o play chama a função de música', chamada.config.function === 'musica')
  check('o play manda o que a pessoa escreveu como busca', chamada.config.inputs.busca === '{{message.args}}')
  // Áudio e capa juntos não são álbum nem carrossel: o carrossel recusaria o
  // áudio e cairia para sequência depois de tentar.
  check('o play entrega um depois do outro', chamada.config.delivery === 'separate')
  check('o play pede o nome quando vem sozinho', nos.some((n) => n.type === 'action.whatsapp.reply'))
  check('o play nasce como /play', play.parameters.find((p) => p.key === 'command').default === '/play')

  const chamadaBusca = busca.documentTemplate.flow.nodes.find((n) => n.type === 'action.connection.call')
  check('o buscar chama a função de busca', chamadaBusca.config.function === 'buscar')
  check('o buscar nasce como /buscar', busca.parameters.find((p) => p.key === 'command').default === '/buscar')
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nmúsica: tudo certo')
