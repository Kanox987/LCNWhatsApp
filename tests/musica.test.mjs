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
  // NOME ou LINK, e nenhum dos dois obrigatório: o serviço recusa os dois
  // juntos, e quem decide qual mandar é o comando — o /play manda o nome, o
  // botão do carrossel manda o link da música que a pessoa apertou.
  check('musica aceita o nome', musica.entradas.some((e) => e.nome === 'busca' && e.obrigatoria === false))
  check('e aceita o link, que é o que o botão do carrossel manda',
    musica.entradas.some((e) => e.nome === 'url' && e.obrigatoria === false))
  check('musica pede modo musica por padrão', musica.entradas.find((e) => e.nome === 'modo').padrao === 'musica')
  // A capa antes do áudio: o serviço entrega na ordem do disco (01 áudio, 02
  // capa) e a conversa quer o contrário.
  // Guardado COMO SE DECLARA, não como o WhatsApp chama: validar de novo tem
  // que dar o mesmo resultado, e guardar o traduzido fazia a gravação seguinte
  // da conexão ser recusada com "tipo desconhecido: image".
  check('a capa sai antes do áudio', JSON.stringify(musica.resposta.ordemDosTipos) === '["foto","áudio"]',
    JSON.stringify(musica.resposta.ordemDosTipos))
  check('e a legenda traz faixa, artista e duração',
    /faixa/.test(musica.resposta.modeloDaDescricao) && /artista/.test(musica.resposta.modeloDaDescricao) &&
    /duracao\|tempo/.test(musica.resposta.modeloDaDescricao), musica.resposta.modeloDaDescricao)
  // A legenda de música NÃO é a descrição: lá vem "Provided to YouTube by",
  // produtor, compositor. O nome da faixa está em `titulo`.
  check('musica tira a legenda do título', musica.resposta.campoDaDescricao === 'titulo')
  check('o download de post continua tirando a legenda da descrição',
    DECLARACAO.funcoes.find((f) => f.nome === 'baixar').resposta.campoDaDescricao === 'descricao')
  check('musica espera mais que os 20s padrão', musica.esperaSegundos === 120)

  const buscarFn = DECLARACAO.funcoes.find((f) => f.nome === 'buscar')
  check('buscar responde em carrossel', buscarFn.resposta.forma === 'carrossel')
  check('buscar aponta onde está a lista', buscarFn.resposta.campo === 'achados')
  // A capa pelo próprio serviço primeiro (ele a devolve em jpeg), e o endereço
  // do YouTube como queda — aquele vem em webp, e a mensagem de imagem do
  // WhatsApp espera jpeg.
  check('a capa do card vem do serviço, com o endereço de fora como queda',
    buscarFn.resposta.imagem[0] === 'capa' && buscarFn.resposta.imagem[1] === 'capa_youtube',
    JSON.stringify(buscarFn.resposta.imagem))
  check('cada card tem botão, e o botão manda um comando com o link daquele',
    /^\/\w+ \{\{url\}\}$/.test(buscarFn.resposta.botao.comando), buscarFn.resposta.botao?.comando)
  check('no máximo dez cards, que é o teto do WhatsApp', buscarFn.resposta.limite <= 10, String(buscarFn.resposta.limite))
  check('buscar lê o erro do campo do FastAPI', buscarFn.resposta.campoDoErro === 'detail')
}

// --- validar duas vezes tem que dar o mesmo resultado ---------------------
//
// Aconteceu em produção: a ordem de envio era guardada TRADUZIDA ("image"), e
// a gravação seguinte da conexão — qualquer uma, por qualquer motivo — era
// recusada com "tipo desconhecido: image". A tela ficava sem saída para uma
// conexão que o próprio sistema tinha escrito.
{
  const umaVez = validarConfiguracao(MIDIA.config)
  const duasVezes = validarConfiguracao(umaVez)
  check('validar a declaração de novo não muda nada',
    JSON.stringify(umaVez) === JSON.stringify(duasVezes))
  // E a forma traduzida, que ficou gravada antes da correção, ainda entra.
  const comTraduzido = validarConfiguracao({
    ...MIDIA.config,
    funcoes: MIDIA.config.funcoes.map((f) => f.nome !== 'musica'
      ? f
      : { ...f, resposta: { ...f.resposta, ordemDosTipos: ['image', 'audio'] } })
  })
  check('o que já estava gravado traduzido volta ao nome de declaração',
    JSON.stringify(comTraduzido.funcoes.find((f) => f.nome === 'musica').resposta.ordemDosTipos) === '["foto","áudio"]')
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

// --- a busca, de ponta a ponta: cards com capa e botão --------------------
{
  const s = servico([
    {
      busca: 'evidencias',
      achados: [
        { id: 'a', url: 'https://y/a', titulo: 'Evidências', autor: 'Chitãozinho & Xororó', duracao_texto: '4:59', visualizacoes: 3056971, capa: '/capa/a', capa_youtube: 'https://i.ytimg.com/a.webp' },
        { id: 'b', url: 'https://y/b', titulo: 'Evidências (Ao Vivo)', autor: 'Bruno & Marrone', duracao_texto: '4:23', visualizacoes: 52258297, capa: '/capa/b', capa_youtube: 'https://i.ytimg.com/b.webp' }
      ]
    },
    { arquivo: 'capa-a' },
    { arquivo: 'capa-b' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(DECLARACAO, 'buscar', { busca: 'evidencias' })

  check('a busca responde em cards', r.forma === 'carrossel', r.forma)
  check('um card por resultado', r.cards.length === 2, String(r.cards?.length))
  check('o cabeçalho diz o que foi buscado', r.cabecalho === '🔎 Achei isto para "evidencias":', r.cabecalho)
  check('cada card traz a capa de verdade, em bytes', r.cards[0].midia.buffer.toString() === 'capa-a')
  // O nome no TÍTULO (cabeçalho do card, acima da imagem) e o autor no corpo:
  // é a divisão que o bot de referência em zapo-js usa, e evita o nome
  // aparecer duas vezes no mesmo card.
  check('o título do card é o nome da música', r.cards[0].titulo.includes('Evidências'), r.cards[0].titulo)
  check('e o corpo traz o autor', r.cards[0].corpo.includes('Chitãozinho'), r.cards[0].corpo)
  check('o rodapé tem a duração', r.cards[0].rodape.includes('4:59'), r.cards[0].rodape)
  // O BOTÃO É O PULO DO GATO: o id dele é o comando que a pessoa teria
  // digitado, com o link DAQUELE card. Sem isso, "baixar o terceiro" exigiria
  // guardar estado entre as duas mensagens.
  check('o botão manda o comando com o link daquele card',
    r.cards[0].botao.comando === '/musica https://y/a', r.cards[0].botao?.comando)
  check('e o segundo card aponta para o outro link',
    r.cards[1].botao.comando === '/musica https://y/b', r.cards[1].botao?.comando)
  check('o rótulo do botão é o que a pessoa lê', r.cards[0].botao.texto === '⬇️ Baixar esta', r.cards[0].botao?.texto)
  check('a busca não vira download', s.chamadas[0].url.endsWith('/buscar'))
  // Caminho relativo: a capa é buscada no PRÓPRIO serviço, e com a credencial
  // dele — é arquivo do serviço como qualquer outro.
  check('a capa é buscada no próprio serviço',
    s.chamadas[1].url === 'http://127.0.0.1:8765/capa/a', s.chamadas[1]?.url)
}

// --- o que nem deve entrar na escolha ------------------------------------
//
// Pedido do dono: "músicas com mais de 15 min nem devem entrar na escolha".
// Uma busca de música traz live de duas horas e álbum inteiro no meio, e cada
// um desses ocupa um card que podia ser de uma música de verdade.
{
  const s = servico([
    {
      busca: 'x',
      achados: [
        { id: 'a', url: 'https://y/a', capa: '/capa/a', titulo: 'Música normal', autor: 'A', duracao: 240 },
        { id: 'b', url: 'https://y/b', capa: '/capa/b', titulo: 'Live de duas horas', autor: 'B', duracao: 7200 },
        { id: 'c', url: 'https://y/c', capa: '/capa/c', titulo: 'No limite', autor: 'C', duracao: 900 },
        { id: 'd', url: 'https://y/d', capa: '/capa/d', titulo: 'Sem duração informada', autor: 'D' }
      ]
    },
    { arquivo: 'capa-a' }, { arquivo: 'capa-c' }, { arquivo: 'capa-d' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(DECLARACAO, 'buscar', { busca: 'x' })

  const titulos = r.cards.map((c) => c.titulo).join(' | ')
  check('a live de duas horas não vira card', !/Live de duas horas/.test(titulos), titulos)
  check('a música normal fica', /Música normal/.test(titulos))
  check('o que está exatamente no limite fica', /No limite/.test(titulos), titulos)
  // Item sem o campo FICA: o filtro corta o que sabidamente não serve, não o
  // que não deu para medir.
  check('o que não informou duração fica', /Sem duração informada/.test(titulos), titulos)
  // E o descarte vem ANTES do limite: cortar depois faria a live ocupar uma
  // das vagas e sair, deixando a busca com menos cards do que cabia.
  check('a capa da descartada nem é buscada', s.chamadas.length === 4, String(s.chamadas.length))
}

// --- cards do mesmo tamanho ----------------------------------------------
//
// O card cresce com o texto, e nome de música tem comprimento qualquer: um de
// uma linha ao lado de um de três deixa o carrossel torto. O pedido do dono:
// linhas vazias nos menores, alinhando com o maior.
{
  const s = servico([
    {
      busca: 'x',
      achados: [
        { id: 'a', url: 'https://y/a', capa: '/capa/a', autor: 'Fulano', titulo: 'Nome curto' },
        {
          id: 'b',
          url: 'https://y/b',
          capa: '/capa/b',
          autor: 'Beltrano',
          titulo: 'Um nome de música bem comprido que ocupa uma porção de linhas no card'
        }
      ]
    },
    { arquivo: 'capa-a' },
    { arquivo: 'capa-b' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(DECLARACAO, 'buscar', { busca: 'x' })

  const linhas = (c) => `${c.titulo}\n${c.corpo}`.split('\n').length
  check('o card menor ganha linhas para empatar com o maior',
    linhas(r.cards[0]) > 2, String(linhas(r.cards[0])))
  check('e o maior não ganha nenhuma', !r.cards[1].corpo.includes('\u200b'), JSON.stringify(r.cards[1].corpo))
  // Espaço de largura zero, e não espaço comum: o WhatsApp apara linha com
  // espaço comum, e a linha somia justamente onde ela devia aparecer.
  check('a linha vazia é invisível, não um espaço qualquer', r.cards[0].corpo.includes('\u200b'))
  check('o texto de verdade continua lá', r.cards[0].corpo.startsWith('👤 Fulano'), r.cards[0].corpo)
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
      duracao: 299,
      metadados: { faixa: 'Evidências (Remastered 2020)', artista: 'Chitãozinho & Xororó' },
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
  // A CAPA PRIMEIRO. O serviço entrega na ordem do disco — 01 áudio, 02 capa —
  // e a conversa quer o contrário: a capa com a legenda e a música logo
  // abaixo. Quem decide a ordem é a declaração, não o nome do arquivo.
  check('a capa vem primeiro e o áudio depois',
    r.midias[0].tipo === 'image' && r.midias[1].tipo === 'audio',
    r.midias.map((m) => m.tipo).join(','))
  check('a legenda tem o nome da faixa', /Evidências/.test(r.descricao || ''), r.descricao)
  check('o artista', /Chitãozinho/.test(r.descricao || ''), r.descricao)
  // 299 segundos não é duração de música para ninguém.
  check('e a duração em minutos', /4:59/.test(r.descricao || ''), r.descricao)
  check('o texto que o YouTube gera sozinho NÃO vira legenda',
    !/Provided to YouTube/.test(r.descricao || ''), r.descricao)
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

// --- o gateway manda UMA mensagem com os cards e os botões ---------------
{
  const enviados = []
  const subidos = []
  const client = {
    getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }),
    message: {
      send: async (jid, c) => { enviados.push({ jid, c }); return { ok: true, id: 'X' } },
      upload: async (buffer, opcoes) => {
        subidos.push({ buffer, opcoes })
        return { url: 'https://mmg/u', directPath: '/u', mediaKey: 'k', fileSha256: 's', fileEncSha256: 'e', fileLength: buffer.length, mediaKeyTimestamp: 1, mimetype: opcoes.mimetype }
      }
    }
  }
  const cards = [
    { midia: { buffer: Buffer.from('capa-a'), mime: 'image/jpeg', tipo: 'image', nome: 'a.jpg' }, titulo: '🎵 Evidências', corpo: '👤 Chitãozinho', rodape: '4:59', botao: { texto: '⬇️ Baixar esta', comando: '/musica https://y/a' } },
    { midia: { buffer: Buffer.from('capa-b'), mime: 'image/jpeg', tipo: 'image', nome: 'b.jpg' }, titulo: '🎵 Ao Vivo', corpo: '👤 Bruno', rodape: '4:23', botao: { texto: '⬇️ Baixar esta', comando: '/musica https://y/b' } }
  ]
  const deps = {
    mediaRefCache: { resolver: () => null },
    baixarBuffer: async () => Buffer.from('x'),
    limiteBytes: 999999,
    resolverJidProprio: () => '5511900000002@s.whatsapp.net',
    clienteEngine: { conexoes: { resolvida: async () => DECLARACAO }, execucoes: { confirmar: async () => ({ ok: true }) } },
    criarExecutorDeConexao: () => ({
      executar: async () => ({ forma: 'carrossel', cards, cabecalho: '🔎 Achei isto para "evidencias":' })
    })
  }
  await executarComandos(client, [{
    id: 'busca-1',
    commandType: 'connection.call',
    payload: { chatId: '5511999@s.whatsapp.net', conexao: 'midia', funcao: 'buscar', entradas: { busca: 'evidencias' } }
  }], deps.clienteEngine, deps)

  check('as duas capas sobem antes', subidos.length === 2 && subidos[0].opcoes.type === 'image')
  // UMA mensagem, na forma que outro bot em zapo-js manda em produção: texto
  // dentro, header junto do body, e tudo embrulhado em viewOnce.
  check('sai uma mensagem só', enviados.length === 1, String(enviados.length))
  const embrulho = enviados[0].c
  check('embrulhada em viewOnce, que é o caminho usual do carrossel', !!embrulho?.viewOnceMessageV2)
  const interativa = embrulho.viewOnceMessageV2.message.interactiveMessage
  const carrossel = interativa?.carouselMessage
  check('com o carrossel dentro', !!carrossel, JSON.stringify(Object.keys(interativa || {})))
  check('o texto da busca vai no corpo', interativa.body?.text === '🔎 Achei isto para "evidencias":')
  // O `body` sozinho foi a primeira tentativa, e a mensagem não apareceu. O
  // que faltava era o header ao lado dele.
  check('e o corpo vem acompanhado de header, que era o que faltava',
    interativa.header?.hasMediaAttachment === false, JSON.stringify(interativa.header))
  check('com um card por resultado', carrossel.cards.length === 2)
  check('e a versão de mensagem que o bot de referência manda', carrossel.messageVersion === 1)
  check('o título do card fica no cabeçalho dele', carrossel.cards[0].header?.title === '🎵 Evidências', carrossel.cards[0].header?.title)
  check('cada card tem a imagem no cabeçalho', carrossel.cards[0].header?.hasMediaAttachment === true && !!carrossel.cards[0].header?.imageMessage)
  check('e o autor no corpo do card', carrossel.cards[0].body?.text === '👤 Chitãozinho')
  const botao = carrossel.cards[0].nativeFlowMessage?.buttons?.[0]
  check('e um botão de resposta rápida', botao?.name === 'quick_reply', JSON.stringify(botao))
  const params = JSON.parse(botao.buttonParamsJson)
  check('com o rótulo que a pessoa lê', params.display_text === '⬇️ Baixar esta')
  check('e o comando daquele card no id', params.id === '/musica https://y/a', params.id)
  check('o segundo botão aponta para o outro', JSON.parse(carrossel.cards[1].nativeFlowMessage.buttons[0].buttonParamsJson).id === '/musica https://y/b')
}

// --- a forma da mensagem é declarada, e o diagnóstico manda todas ---------
//
// Mensagem interativa é aceita pelo servidor e desenhada (ou não) pelo
// aplicativo de quem recebe. Quando ele não desenha, NÃO há erro em lugar
// nenhum: o envio é confirmado e a conversa fica vazia. Sem a forma
// declarada, a única saída seria eu editar arquivo a cada palpite.
{
  const opcoesVistas = []
  const porEstilo = async (estilo) => {
    const enviados = []
    opcoesVistas.length = 0
    const client = {
      getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }),
      message: {
        send: async (jid, c, o) => { enviados.push(c); opcoesVistas.push(o); return { ok: true, id: 'X' } },
        upload: async (buffer, opcoes) => ({ url: 'u', directPath: '/u', mediaKey: 'k', fileSha256: 's', fileEncSha256: 'e', fileLength: buffer.length, mediaKeyTimestamp: 1, mimetype: opcoes.mimetype })
      }
    }
    const deps = {
      mediaRefCache: { resolver: () => null },
      baixarBuffer: async () => Buffer.from('x'),
      limiteBytes: 999999,
      resolverJidProprio: () => '5511900000002@s.whatsapp.net',
      clienteEngine: { conexoes: { resolvida: async () => DECLARACAO }, execucoes: { confirmar: async () => ({ ok: true }) } },
      criarExecutorDeConexao: () => ({
        executar: async () => ({
          forma: 'carrossel',
          estilo,
          cards: [{ midia: { buffer: Buffer.from('c'), mime: 'image/jpeg', tipo: 'image' }, titulo: 'T', corpo: 'C', rodape: 'R', botao: { texto: 'b', comando: '/musica x' } }],
          cabecalho: '🔎 Achei:'
        })
      })
    }
    await executarComandos(client, [{
      id: `e-${estilo}`,
      commandType: 'connection.call',
      payload: { chatId: '5511999@s.whatsapp.net', conexao: 'midia', funcao: 'buscar', entradas: {} }
    }], deps.clienteEngine, deps)
    return enviados
  }
  const porEstiloEOpcoes = async (estilo) => ({ enviados: await porEstilo(estilo), opcoes: [...opcoesVistas] })

  const completo = await porEstilo('completo')
  check('"completo" embrulha em viewOnce', !!completo[0]?.viewOnceMessageV2)

  const simples = await porEstilo('simples')
  check('"simples" manda o texto antes, em mensagem própria', simples[0]?.type === 'text', JSON.stringify(simples[0]))
  const cru = simples[1]?.interactiveMessage
  check('e o carrossel sem embrulho nenhum', !!cru?.carouselMessage && !simples[1]?.viewOnceMessageV2)
  // É a forma que o carrossel de fotos do /dow usa há semanas: nada de body,
  // nada de messageVersion. Não se mexe no que está provado.
  check('sem body e sem messageVersion, como o do /dow',
    cru.body === undefined && cru.carouselMessage.messageVersion === undefined, JSON.stringify(Object.keys(cru)))

  const semEmbrulho = await porEstilo('semEmbrulho')
  check('"semEmbrulho" tem o texto dentro e nenhum viewOnce',
    !semEmbrulho[0]?.viewOnceMessageV2 && semEmbrulho[0]?.interactiveMessage?.body?.text?.includes('Achei'))

  // BOTÃO FORA DO CARD: o carrossel vai sem botão (forma desenhada aqui há
  // semanas) e a escolha vem na mensagem seguinte.
  const botoes = await porEstilo('botoes')
  check('"botoes" manda os cards e depois os botões', botoes.length === 2, String(botoes.length))
  const flow = botoes[1]?.viewOnceMessageV2?.message?.interactiveMessage?.nativeFlowMessage
  check('os botões são de resposta rápida', flow?.buttons?.[0]?.name === 'quick_reply', JSON.stringify(flow?.buttons?.[0]))
  check('e o id do botão é o comando daquela opção',
    JSON.parse(flow.buttons[0].buttonParamsJson).id === '/musica x')
  check('os cards vão SEM botão, que é o que o aplicativo recusa',
    (botoes[0]?.interactiveMessage?.carouselMessage?.cards || []).every((c) => (c.nativeFlowMessage?.buttons || []).length === 0))

  const menu = await porEstilo('menu')
  const lista = menu[1]?.interactiveMessage?.nativeFlowMessage?.buttons?.[0]
  check('"menu" manda uma lista de escolha', lista?.name === 'single_select', JSON.stringify(lista))
  check('com o comando de cada opção na linha dela',
    JSON.parse(lista.buttonParamsJson).sections[0].rows[0].id === '/musica x')

  // O NÓ QUE DIZ "ISTO É NATIVE FLOW".
  //
  // Conferido na zapo-js instalada: `resolveButtonAddonKindFrom` olha o
  // `nativeFlowMessage` do NÍVEL PRINCIPAL e não percorre os cards. Com os
  // botões só dentro deles, o nó <biz> não é anexado ao stanza e o aplicativo
  // recebe um carrossel que não se anuncia como interativo.
  const comBiz = await porEstiloEOpcoes('bizNoStanza')
  check('"bizNoStanza" manda o nó <biz> nas opções de envio',
    comBiz.opcoes[0]?.customNodes?.[0]?.tag === 'biz', JSON.stringify(comBiz.opcoes[0]))
  check('e o nó é o native_flow "mixed", como o que a biblioteca monta sozinha',
    comBiz.opcoes[0].customNodes[0].content[0].content[0].attrs.name === 'mixed')

  const noTopo = await porEstiloEOpcoes('fluxoNoTopo')
  const interativa = noTopo.enviados[0]?.interactiveMessage
  check('"fluxoNoTopo" põe um nativeFlowMessage vazio no nível principal',
    Array.isArray(interativa?.nativeFlowMessage?.buttons) && interativa.nativeFlowMessage.buttons.length === 0,
    JSON.stringify(interativa?.nativeFlowMessage))
  check('e os botões de verdade continuam dentro dos cards',
    interativa.carouselMessage.cards[0].nativeFlowMessage.buttons.length === 1)
  check('sem mandar nó nenhum na mão — quem monta é a biblioteca',
    noTopo.opcoes[0] === undefined, JSON.stringify(noTopo.opcoes[0]))

  const diagnostico = await porEstilo('diagnóstico')
  const formas = diagnostico.filter((c) => c.viewOnceMessageV2 || c.interactiveMessage).length
  // Cinco de carrossel + duas de escolha, e as de escolha mandam dois envios
  // cada (os cards e a escolha).
  check('"diagnóstico" manda todas as formas de uma vez', formas === 9, String(formas))
  check('e cada uma diz o nome dela, para a pessoa poder apontar qual apareceu',
    ['[completo]', '[simples]', '[botoes]', '[menu]'].every((n) => JSON.stringify(diagnostico).includes(n)))
}

// --- carrossel recusado cai para texto, e nada se perde -------------------
{
  const enviados = []
  const client = {
    getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }),
    message: {
      send: async (jid, c) => {
        // O aplicativo que recusa interativo recusa também a embrulhada em
        // viewOnce — é o mesmo tipo de mensagem por dentro.
        if (c?.interactiveMessage || c?.viewOnceMessageV2) throw new Error('mensagem interativa recusada')
        enviados.push({ jid, c })
        return { ok: true, id: 'X' }
      },
      upload: async (buffer, opcoes) => ({ url: 'u', directPath: '/u', mediaKey: 'k', fileSha256: 's', fileEncSha256: 'e', fileLength: buffer.length, mediaKeyTimestamp: 1, mimetype: opcoes.mimetype })
    }
  }
  const deps = {
    mediaRefCache: { resolver: () => null },
    baixarBuffer: async () => Buffer.from('x'),
    limiteBytes: 999999,
    resolverJidProprio: () => '5511900000002@s.whatsapp.net',
    clienteEngine: { conexoes: { resolvida: async () => DECLARACAO }, execucoes: { confirmar: async () => ({ ok: true }) } },
    criarExecutorDeConexao: () => ({
      executar: async () => ({
        forma: 'carrossel',
        cards: [{ midia: { buffer: Buffer.from('c'), mime: 'image/jpeg', tipo: 'image' }, titulo: 'Evidências', corpo: '👤 Chitãozinho', rodape: '4:59', botao: { texto: 'x', comando: '/musica https://y/a' } }],
        cabecalho: '🔎 Achei isto:'
      })
    })
  }
  await executarComandos(client, [{
    id: 'busca-2',
    commandType: 'connection.call',
    payload: { chatId: '5511999@s.whatsapp.net', conexao: 'midia', funcao: 'buscar', entradas: {} }
  }], deps.clienteEngine, deps)

  // O texto de abertura já saiu antes; recusado o carrossel, o que falta é a
  // lista escrita — e ela vai.
  check('aplicativo que recusa o interativo ainda recebe a lista',
    enviados.length === 1 && enviados[0].c.type === 'text', JSON.stringify(enviados.map((e) => e.c.type)))
  check('com o texto de abertura e o resultado dentro',
    /Achei isto/.test(enviados[0].c.text) && /Evidências/.test(enviados[0].c.text), enviados[0]?.c?.text)
}

// --- o vídeo que não é do YouTube Music ----------------------------------
//
// Aconteceu em produção, com "coração de pedra": faixa e artista vêm nulos
// quando o vídeo não é do YouTube Music, e a legenda chegou à conversa com
// "{{metadados.faixa}}" e "{{metadados.artista}}" escritos. Marcador literal é
// o sinal de erro CERTO para quem escreve um comando, e o errado para quem
// está ouvindo música.
{
  const s = servico([
    { job: 'j2' },
    {
      estado: 'pronto',
      titulo: 'Coração de Pedra (clipe oficial)',
      duracao: 212,
      // Sem faixa e sem artista: é o que o serviço devolve, e não é erro dele.
      metadados: { autor: 'Canal do Fulano', duracao: 212 },
      midias: [
        { url: '/media/1', tipo: 'audio', mime: 'audio/mp4', nome: '01 c.m4a' },
        { url: '/media/2', tipo: 'imagem', mime: 'image/jpeg', nome: '02 c.jpg' }
      ]
    },
    { arquivo: 'audio' },
    { arquivo: 'capa' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(DECLARACAO, 'musica', { busca: 'coração de pedra' })

  check('sem faixa, a legenda usa o título do vídeo',
    /Coração de Pedra/.test(r.descricao || ''), r.descricao)
  check('sem artista, usa o canal', /Canal do Fulano/.test(r.descricao || ''), r.descricao)
  check('a duração continua escrita em minutos', /3:32/.test(r.descricao || ''), r.descricao)
  check('e NENHUM marcador cru chega à conversa', !/\{\{/.test(r.descricao || ''), r.descricao)
}

// --- quando nem a alternativa existe, a linha some -----------------------
{
  const declaracaoTorta = {
    ...DECLARACAO,
    funcoes: [validarFuncao({
      nome: 'musica',
      caminho: '/download',
      entradas: [{ nome: 'busca', tipo: 'texto', obrigatoria: false }],
      resposta: {
        forma: 'trabalho',
        campoDoTrabalho: 'job',
        caminhoDeAcompanhamento: '/jobs/{job}',
        campoDoEstado: 'estado',
        estadosEmAndamento: ['baixando'],
        campoDoResultado: 'midias',
        modeloDaDescricao: '🎵 {{titulo}}\n👤 {{nao_existe}}\n⏱️ {{duracao|tempo}}'
      }
    })]
  }
  const s = servico([
    { job: 'j3' },
    { estado: 'pronto', titulo: 'Uma música', duracao: 65, midias: [{ url: '/m/1', tipo: 'audio', mime: 'audio/mp4' }] },
    { arquivo: 'audio' }
  ])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: semDormir })
    .executar(declaracaoTorta, 'musica', {})
  check('a linha sem valor nenhum desaparece da legenda',
    r.descricao === '🎵 Uma música\n⏱️ 1:05', JSON.stringify(r.descricao))
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

  // A RESPOSTA MARCA QUEM PEDIU. A mensagem do toque no botão carrega um
  // `quotedRef` apontando para o carrossel; sem isto, a música sairia
  // pendurada no card em vez do pedido de quem a pediu.
  check('o /play marca a mensagem de quem pediu', chamada.config.quoteFrom === 'mensagem', chamada.config.quoteFrom)
  const porLink = catalogo.get('musica-do-link').documentTemplate.flow.nodes
    .find((n) => n.type === 'action.connection.call')
  check('e o comando do botão também', porLink.config.quoteFrom === 'mensagem', porLink.config.quoteFrom)
  // O download de link NÃO muda: lá o assunto é a mensagem que trouxe o link.
  const dow = catalogo.get('baixar-midia').documentTemplate.flow.nodes
    .find((n) => n.type === 'action.connection.call' || n.type === 'action.media.download')
  check('o download de link continua marcando a citada', !dow.config.quoteFrom, String(dow.config.quoteFrom))
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nmúsica: tudo certo')
