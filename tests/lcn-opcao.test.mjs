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

comando /teste
  nome: Escolhe
  pool: p
  tipos: texto
  casa: exato
  de: externo

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

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO TIPO OPÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
