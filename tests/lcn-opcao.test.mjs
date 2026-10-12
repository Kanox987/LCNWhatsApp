// O quarto tipo do bloco `configurável`: escolher uma opção da lista.
//
// Ele existia pela METADE, e da pior forma: o compilador aceitava `opção` e
// produzia { type: 'enum', options: [...] }, mas o schema do template só
// conhecia string/number/boolean e tinha additionalProperties:false. Como o
// catálogo valida TODO arquivo na carga, o primeiro .lcn que usasse `opção`
// derrubaria o catálogo INTEIRO — não só ele. Ninguém usava, então estava
// invisível.
//
// Estes casos cobrem as quatro camadas: compilador, schema, render e volta.
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const fonte = `template escolhe v1
  nome: Escolhe
  descrição: Teste do tipo opção.
  categoria: modulos-especializados

automação
  tipo: comando
  dispara com: /teste
  nome: Escolhe
  pool: p
  acessa: texto
  casa: exato
  quem: só externos

  responde "modo {{params.modo}}"

configurável
  modo: opção (auto, video, audio) = "auto"
    rótulo: O que baixar
    ajuda: Escolha uma.

# nós: gatilho-comando, responder
`

// --- compilador ----------------------------------------------------------
const { template, documentTemplate } = compilar(fonte)
const modo = template.parameters.find((p) => p.key === 'modo')
check('compila "opção" para type enum', modo?.type === 'enum')
check('e guarda a lista de escolhas', JSON.stringify(modo?.options) === '["auto","video","audio"]', JSON.stringify(modo?.options))
check('e o padrão continua sendo o valor escolhido', modo?.default === 'auto')

// --- as duas metades andam juntas ---------------------------------------
const erroDe = (texto) => {
  try { compilar(texto); return null } catch (e) { return e }
}
const semLista = erroDe(fonte.replace('modo: opção (auto, video, audio) = "auto"', 'modo: opção = "auto"'))
check('"opção" sem lista é recusado na compilação', semLista instanceof ErroDeSintaxe, semLista?.message)
check('e o erro aponta a linha', typeof semLista?.linha === 'number', String(semLista?.linha))

const listaEmTexto = erroDe(fonte.replace('modo: opção (auto, video, audio) = "auto"', 'modo: texto (auto, video) = "auto"'))
check('lista em tipo que não é opção é recusada (seria ignorada em silêncio)', listaEmTexto instanceof ErroDeSintaxe, listaEmTexto?.message)

// --- ida e volta ---------------------------------------------------------
const devolta = descompilar(documentTemplate, template)
check('o descompilador escreve a lista de volta entre parênteses', devolta.includes('modo: opção (auto, video, audio)'),
  devolta.split('\n').find((l) => l.includes('modo:')))
const recompilado = compilar(devolta).template.parameters.find((p) => p.key === 'modo')
check('e recompilar devolve exatamente o mesmo parâmetro',
  JSON.stringify(recompilado) === JSON.stringify(modo), JSON.stringify(recompilado))

// --- render: valor fora da lista não passa -------------------------------
// Montado como o catálogo monta (catalog.js:41): o compilador devolve o
// cabeçalho e o documento em campos separados.
const pronto = { ...template, documentTemplate }
const doc = renderizarTemplate(pronto, { modo: 'video' })
check('valor da lista é aceito e substituído', JSON.stringify(doc).includes('modo video'))

let recusou = null
try { renderizarTemplate(pronto, { modo: 'gif' }) } catch (e) { recusou = e }
check('valor FORA da lista é recusado na instalação', recusou !== null)
check('e a mensagem diz quais são as opções válidas',
  recusou?.message.includes('auto, video, audio'), recusou?.message)

// --- o catálogo de verdade continua carregando ---------------------------
let catalogo = null
try { catalogo = carregarCatalogo() } catch (e) { check('o catálogo carrega', false, e.message) }
if (catalogo) {
  check('o catálogo inteiro carrega com .lcn usando "opção"', catalogo.size > 0, `${catalogo.size} templates`)
  const autoDownload = catalogo.get('auto-download')
  const modoReal = autoDownload?.parameters.find((p) => p.key === 'modo')
  check('e o auto-download usa opção de verdade, não texto livre', modoReal?.type === 'enum', modoReal?.type)
  check('com as escolhas que a ajuda antes só descrevia',
    JSON.stringify(modoReal?.options) === '["auto","video","audio","thumbnail"]', JSON.stringify(modoReal?.options))
}

// --- `chama`: a conexão e a função na primeira linha ---------------------
//
// O defeito que isto conserta é o que o dono apontou no `baixa`: "baixar o
// quê? para quem?". Aqui a primeira linha já diz de QUEM o comando depende, e
// o bloco `com` diz o que vai — com o nome de cada entrada à vista.
{
  const fonteChama = `automação
  tipo: comando
  dispara com: /dow
  id: t
  revisão: 1
  nome: T
  onde: em qualquer lugar
  pool: p
  acessa: texto
  casa: exato
  quem: só externos

  chama midia.baixar
    com
      url: "{{message.link}}"
      modo: auto
    avisa: "baixando"
`
  const docChama = compilar(fonteChama)
  const no = docChama.flow.nodes.find((n) => n.type === 'action.connection.call')
  check('chama lê a conexão e a função da primeira linha',
    no.config.connectionRef === 'midia' && no.config.function === 'baixar')
  check('o bloco "com" vira as entradas, por nome',
    JSON.stringify(no.config.inputs) === '{"url":"{{message.link}}","modo":"auto"}', JSON.stringify(no.config.inputs))
  check('e os campos de apresentação ficam fora das entradas', no.config.inputs.avisa === undefined)

  const voltaChama = descompilar(docChama)
  check('a volta escreve "chama midia.baixar"', voltaChama.includes('chama midia.baixar'))
  check('e recompila idêntico', JSON.stringify(compilar(voltaChama)) === JSON.stringify(docChama))

  // Um template escreve `chama {{params.conexao}}.baixar`, e o primeiro ponto
  // dali é o de DENTRO do marcador. Separar nele produzia a conexão "{{params"
  // e a função "conexao}}.baixar" — documento errado, sem erro nenhum.
  const comMarcador = compilar(fonteChama.replace('chama midia.baixar', 'chama {{params.conexao}}.baixar'))
  const noMarcador = comMarcador.flow.nodes.find((n) => n.type === 'action.connection.call')
  check('o ponto DENTRO de um marcador não separa a conexão da função',
    noMarcador.config.connectionRef === '{{params.conexao}}' && noMarcador.config.function === 'baixar',
    `${noMarcador.config.connectionRef} | ${noMarcador.config.function}`)

  const semPonto = (() => { try { compilar(fonteChama.replace('chama midia.baixar', 'chama midia')); return null } catch (e) { return e } })()
  check('chama sem "conexão.função" é recusado, com a forma esperada',
    /conexão\.função/.test(semPonto?.message || ''), semPonto?.message)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO TIPO OPÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
