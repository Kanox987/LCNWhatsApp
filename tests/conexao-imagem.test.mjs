// O serviço de imagem: figurinha, frase, conversão, fundo e melhoria.
//
// O QUE ESTES CASOS GUARDAM. A LCNimg devolve O ARQUIVO na própria resposta,
// em base64 dentro do JSON, e diz o tipo em `mime`. As duas formas que já
// existiam não servem: `mídia` espera uma LISTA de endereços para buscar
// depois, `trabalho` espera protocolo de acompanhamento. Obrigar um serviço que
// converte em dois segundos a qualquer um dos dois complicaria o lado de quem
// escreve a API sem ganhar nada — então a forma `arquivo` existe.
//
// E a frase do erro é do SERVIÇO: "Ficou com 151,5 KB e o limite é 2,9 KB,
// mesmo em qualidade 15 e 8 fps" diz o que fazer. "O serviço respondeu 422"
// não diz nada.
import { criarExecutorDeConexao } from '../src/engine/conexaoExecutor.js'
import { validarConfiguracao, validarFuncao, ErroDeDeclaracao } from '../src/engine/server/conexoes/declaracao.js'
import { CONEXOES_PRONTAS, conexaoProntaPorId } from '../src/engine/server/conexoes/prontas.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// =========================================================================
// 1. A declaração da conexão pronta
// =========================================================================
const pronta = conexaoProntaPorId('imagem')
check('a conexão de imagem vem declarada', !!pronta)
// Loopback: o serviço aceita arquivo arbitrário e gasta CPU convertendo. Em
// endereço de rede viraria conversor aberto — e ele mesmo recusa subir fora do
// loopback, então apontar para fora nem funcionaria.
check('e aponta para o loopback', /^http:\/\/127\.0\.0\.1:/.test(pronta.config.endereco), pronta.config.endereco)
check('com autenticação bearer, que é o que o serviço pede', pronta.config.autenticacao.tipo === 'bearer')

const config = validarConfiguracao(pronta.config)
const porNome = new Map(config.funcoes.map((f) => [f.nome, f]))
for (const nome of ['figurinha', 'figurinha_de_frase', 'converter', 'remover_fundo', 'melhorar']) {
  check(`a função "${nome}" está declarada`, porNome.has(nome))
}

{
  const fig = porNome.get('figurinha')
  const arquivo = fig.entradas.find((e) => e.tipo === 'mídia')
  check('figurinha recebe ARQUIVO, não um link', arquivo?.nome === 'arquivo', JSON.stringify(arquivo))
  // Figurinha é DECLARADA, nunca deduzida: o serviço devolve image/webp, e um
  // webp pode ser figurinha ou foto. Deduzir mandaria a figurinha como foto,
  // com legenda e miniatura.
  check('e a resposta declara que é figurinha', fig.resposta.tipo === 'figurinha', fig.resposta.tipo)
  check('o conteúdo vem em arquivo_base64', fig.resposta.campo === 'arquivo_base64')
  check('o tipo do arquivo vem em mime', fig.resposta.campoDoMime === 'mime')
  check('e o erro vem em mensagem', fig.resposta.campoDoErro === 'mensagem')
}
{
  const frase = porNome.get('figurinha_de_frase')
  check('a frase NÃO recebe arquivo — a entrada é o que a pessoa escreveu',
    !frase.entradas.some((e) => e.tipo === 'mídia'))
  check('e o texto é obrigatório', frase.entradas.find((e) => e.nome === 'texto')?.obrigatoria === true)
}
{
  // A conversão é o caso em que o tipo da saída depende do formato pedido na
  // chamada: mp3 é áudio, png é foto, mp4 é vídeo. Fixar um tipo aqui mandaria
  // áudio como foto.
  const conv = porNome.get('converter')
  check('a conversão NÃO fixa o tipo de envio', conv.resposta.tipo === null, String(conv.resposta.tipo))
  check('e o formato é obrigatório', conv.entradas.find((e) => e.nome === 'formato')?.obrigatoria === true)
  check('com a lista fechada do serviço', (conv.entradas.find((e) => e.nome === 'formato')?.opcoes || []).includes('mp3'))
}
{
  // `resposta=json` é o que faz o arquivo vir em base64 em vez de cru. Lista
  // fechada de um item só: quem editar para outra coisa é recusado na
  // publicação, em vez de descobrir na primeira chamada.
  for (const f of config.funcoes) {
    const r = f.entradas.find((e) => e.nome === 'resposta')
    check(`${f.nome} pede resposta em json, e só json`,
      r?.padrao === 'json' && JSON.stringify(r?.opcoes) === '["json"]', JSON.stringify(r))
  }
}

// =========================================================================
// 2. Os comandos do catálogo batem com as funções declaradas
// =========================================================================
//
// É a mesma família de falha silenciosa da chave do /mute em três arquivos:
// renomear uma função aqui deixaria cinco templates apontando para o vazio. O
// publish pegaria — mas só quando alguém instalasse.
{
  const catalogo = carregarCatalogo()
  let conferidos = 0
  for (const template of catalogo.values()) {
    const padroes = Object.fromEntries((template.parameters || [])
      .map((p) => [p.key, p.default === undefined || p.default === null ? 'x1' : p.default]))
    const doc = renderizarTemplate(template, padroes)
    for (const no of doc.flow.nodes) {
      if (no.type !== 'action.connection.call') continue
      if (no.config.connectionRef !== 'imagem') continue
      conferidos++
      const funcao = porNome.get(no.config.function)
      check(`${template.templateId} chama uma função que existe ("${no.config.function}")`, !!funcao)
      if (!funcao) continue

      const declaradas = new Set(funcao.entradas.map((e) => e.nome))
      for (const nome of Object.keys(no.config.inputs || {})) {
        check(`${template.templateId}: a entrada "${nome}" existe na função`, declaradas.has(nome))
      }
      // A entrada de arquivo é nomeada fora de `inputs`, e os dois lados
      // precisam concordar — senão o arquivo vai num campo que o serviço ignora.
      const deMidia = funcao.entradas.find((e) => e.tipo === 'mídia')
      if (deMidia) {
        check(`${template.templateId}: diz de onde vem o arquivo`, no.config.mediaInput === deMidia.nome,
          `${no.config.mediaInput} / ${deMidia.nome}`)
      } else {
        check(`${template.templateId}: não manda arquivo para função que não recebe`, !no.config.mediaInput)
      }
      // Entrada obrigatória sem valor e sem padrão quebraria na chamada.
      for (const e of funcao.entradas) {
        if (e.obrigatoria === false || e.tipo === 'mídia') continue
        const temValor = Object.hasOwn(no.config.inputs || {}, e.nome)
        const temPadrao = e.padrao !== undefined && e.padrao !== null && e.padrao !== ''
        check(`${template.templateId}: "${e.nome}" tem valor ou padrão`, temValor || temPadrao)
      }
    }
  }
  // O número cresce quando um comando novo entra, e é de propósito: se um dia
  // ele CAIR, é porque um comando parou de apontar para a conexão de imagem —
  // e isso não deve passar despercebido.
  check('todos os comandos do serviço de imagem foram conferidos', conferidos === 9, String(conferidos))
}

// =========================================================================
// 3. O executor: base64 vira arquivo, e o tipo certo
// =========================================================================
function servico (respostas) {
  const chamadas = []
  const buscar = async (url, opcoes = {}) => {
    chamadas.push({ url, metodo: opcoes.method, headers: opcoes.headers || {}, body: opcoes.body })
    const { status = 200, corpo } = respostas.shift() || {}
    return { ok: status >= 200 && status < 300, status, json: async () => corpo }
  }
  return { buscar, chamadas }
}

const DECL = { id: 'imagem', endereco: 'http://127.0.0.1:8767', autenticacao: { tipo: 'bearer' }, chave: 'K', funcoes: config.funcoes }
const WEBP = Buffer.from('conteudo-da-figurinha').toString('base64')
const ARQUIVO = { buffer: Buffer.from('foto'), nome: 'arquivo.jpeg', mime: 'image/jpeg' }

{
  const s = servico([{ corpo: { arquivo_base64: WEBP, mime: 'image/webp', peso: '18,2 KB' } }])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
    .executar(DECL, 'figurinha', { pacote: 'LCN' }, ARQUIVO)
  check('o base64 volta como bytes', r.midias[0].buffer.toString() === 'conteudo-da-figurinha')
  check('uma resposta, um arquivo', r.midias.length === 1)
  check('e vai como FIGURINHA, porque a função declarou', r.midias[0].tipo === 'sticker', r.midias[0].tipo)
  check('o mime do serviço é preservado', r.midias[0].mime === 'image/webp')
  check('e uma única chamada resolveu tudo — sem acompanhamento', s.chamadas.length === 1, String(s.chamadas.length))
}
{
  // A conversão não declara tipo: quem decide é o mime da resposta.
  const casos = [
    ['audio/ogg', 'audio'],
    ['video/mp4', 'video'],
    ['image/png', 'image'],
    ['application/octet-stream', 'document']
  ]
  for (const [mime, esperado] of casos) {
    const s = servico([{ corpo: { arquivo_base64: WEBP, mime } }])
    const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
      .executar(DECL, 'converter', { formato: 'mp3' }, ARQUIVO)
    check(`${mime} vira ${esperado}`, r.midias[0].tipo === esperado, r.midias[0].tipo)
  }
  // Documento sem nome chega como "arquivo" na conversa, sem nem a extensão.
  const s = servico([{ corpo: { arquivo_base64: WEBP, mime: 'audio/ogg' } }])
  const r = await criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
    .executar(DECL, 'converter', { formato: 'ogg' }, ARQUIVO)
  check('o nome do arquivo sai do mime', r.midias[0].nome === 'arquivo.ogg', r.midias[0].nome)
}

// =========================================================================
// 4. A frase do erro é a do serviço
// =========================================================================
const FRASE = 'Ficou com 151,5 KB e o limite é 2,9 KB, mesmo em qualidade 15 e 8 fps. Encurte a mídia.'
{
  const s = servico([{ status: 422, corpo: { erro: 'peso_excedido', mensagem: FRASE } }])
  let erro = null
  try {
    await criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
      .executar(DECL, 'figurinha', {}, ARQUIVO)
  } catch (e) { erro = e }
  check('a frase do serviço chega a quem usou o comando', erro?.paraPessoa === FRASE, erro?.paraPessoa)
  check('e o diagnóstico guarda o status junto', /422/.test(erro?.message || ''), erro?.message)
}
{
  // Credencial recusada é configuração do DONO, e não há nada que quem digitou
  // possa fazer com isso. A frase do serviço não vai para a conversa.
  const s = servico([{ status: 401, corpo: { erro: 'nao_autorizado', mensagem: 'chave ausente ou errada' } }])
  let erro = null
  try {
    await criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
      .executar(DECL, 'figurinha', {}, ARQUIVO)
  } catch (e) { erro = e }
  check('401 não vaza "chave ausente" para a conversa',
    !/chave/.test(erro?.paraPessoa || ''), erro?.paraPessoa)
  check('mas o diagnóstico diz que foi a credencial', /credencial/.test(erro?.message || ''), erro?.message)
}
{
  // Fila cheia é espera, não falha: a frase do serviço serve e vem com
  // Retry-After do lado dele.
  const s = servico([{ status: 429, corpo: { erro: 'fila_cheia', mensagem: 'Tem 8 pedidos esperando. Tente em instantes.' } }])
  let erro = null
  try {
    await criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
      .executar(DECL, 'melhorar', {}, ARQUIVO)
  } catch (e) { erro = e }
  check('fila cheia chega com a frase do serviço', /8 pedidos/.test(erro?.paraPessoa || ''), erro?.paraPessoa)
}
{
  const s = servico([{ corpo: { mime: 'image/webp' } }])
  let erro = null
  try {
    await criarExecutorDeConexao({ buscar: s.buscar, dormir: async () => {} })
      .executar(DECL, 'figurinha', {}, ARQUIVO)
  } catch (e) { erro = e }
  check('resposta sem o arquivo é erro claro, não envio vazio',
    /arquivo_base64/.test(erro?.message || ''), erro?.message)
}

// =========================================================================
// 5. A declaração recusa o que não faz sentido
// =========================================================================
const recusa = (fn) => { try { fn(); return null } catch (e) { return e instanceof ErroDeDeclaracao ? e.message : `OUTRO: ${e.message}` } }
check('forma "arquivo" sem dizer onde o conteúdo vem é recusada',
  !!recusa(() => validarFuncao({ nome: 'f', caminho: '/x', resposta: { forma: 'arquivo' } })))
check('tipo de envio inventado é recusado, listando os válidos',
  /figurinha/.test(recusa(() => validarFuncao({
    nome: 'f', caminho: '/x', resposta: { forma: 'arquivo', campo: 'a', tipo: 'adesivo' }
  })) || ''))

check('as duas conexões prontas continuam válidas', CONEXOES_PRONTAS.every((c) => !!validarConfiguracao(c.config)))

// --- quanto esperar é da FUNÇÃO, não do meu código -----------------------
//
// 20 segundos serve para quase tudo e não serve para nada que pense: a
// melhoria em 4K leva de 2 s a 2 min, e o teto fixo abortava a chamada no
// meio — com o trabalho já feito do outro lado e ninguém sabendo por quê.
check('a melhoria declara uma espera longa', porNome.get('melhorar').esperaSegundos >= 300,
  String(porNome.get('melhorar').esperaSegundos))
check('e a troca de metadados, que é instantânea, não declara nada',
  porNome.get('trocar_metadados').esperaSegundos === undefined)
check('espera fora da faixa é recusada na declaração',
  !!recusa(() => validarFuncao({ nome: 'f', caminho: '/x', esperaSegundos: 5000, resposta: { forma: 'texto' } })))
check('e espera zero também', !!recusa(() => validarFuncao({ nome: 'f', caminho: '/x', esperaSegundos: 0, resposta: { forma: 'texto' } })))

{
  // O que importa é a espera CHEGAR ao fetch: sem isso a declaração seria
  // decorativa e a chamada longa continuaria morrendo aos 20 s.
  let prazoVisto = null
  const buscar = async (_url, opcoes) => {
    prazoVisto = opcoes?.signal ? 'tem signal' : 'sem signal'
    return { ok: true, status: 200, json: async () => ({ arquivo_base64: 'eA==', mime: 'image/jpeg' }) }
  }
  const demorada = { ...DECL, funcoes: [{ ...porNome.get('melhorar') }] }
  const r = await criarExecutorDeConexao({ buscar, dormir: async () => {} })
    .executar(demorada, 'melhorar', {}, ARQUIVO)
  check('a chamada longa acontece e volta com arquivo', r.midias.length === 1 && prazoVisto === 'tem signal')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO SERVIÇO DE IMAGEM PASSARAM')
process.exit(falhas ? 1 : 0)
