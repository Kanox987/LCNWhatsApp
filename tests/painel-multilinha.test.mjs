// Campo de texto com QUEBRA DE LINHA, e o controle que as apagava.
//
// O DEFEITO, medido no ar e não suposto. `criarControleParametro` devolvia
// `<input type="text">` para todo parâmetro de texto, e o navegador APAGA
// quebra de linha de um input — em silêncio, ao receber o valor. A legenda do
// `auto-recover` que estava na VPS:
//
//     servida pelo motor:           142 caracteres, 5 quebras
//     depois de passar pelo input:  137 caracteres, 0 quebras
//
// E salvar publicaria isso. Não era cosmético: era perda de dados a um clique,
// nos DOIS formulários — instalação e reconfiguração usam o mesmo controle.
//
// A decisão de qual controle usar vive separada numa função pura, de propósito:
// o resto do módulo precisa de `document`, e é por isso que ele nunca teve
// teste. O apagamento em si é comportamento do NAVEGADOR — não se finge aqui,
// porque mock que não é o contrato já produziu dois falsos positivos nesta base.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ehCampoDeVariasLinhas, poolsOferecidos } from '../src/web/public/logic/parametros.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const texto = (extra = {}) => ({ key: 'legenda', type: 'string', label: 'Legenda', ...extra })

// --- o valor que já tem quebra decide sozinho ----------------------------
//
// Exigir a declaração deixaria sem proteção todo template já escrito —
// inclusive os de fora deste repositório, que eu não tenho como converter.
check('valor com quebra pede área de texto', ehCampoDeVariasLinhas(texto(), 'linha 1\nlinha 2'))
check('valor de uma linha segue na caixa simples', ehCampoDeVariasLinhas(texto(), 'só uma linha') === false)
check('a legenda real do /recover pede área de texto',
  ehCampoDeVariasLinhas(texto(), '👁 *VISUALIZAÇÃO ÚNICA CAPTURADA*\n\n📱 De: wa.me/5511\n🗂 Tipo: foto'))

// --- e o template pode DECLARAR -----------------------------------------
//
// É o caso do campo que nasce com uma linha e ainda assim precisa aceitar
// várias. Sem isso, um campo de uma linha nunca poderia receber uma segunda, e
// isso seria teto no meu código — a coisa que a pessoa não consegue contornar.
check('declarado, pede área de texto mesmo com padrão de uma linha',
  ehCampoDeVariasLinhas(texto({ multiline: true }), 'uma linha'))
check('declarado, pede área de texto mesmo sem valor nenhum',
  ehCampoDeVariasLinhas(texto({ multiline: true }), undefined))

// --- o que NÃO é texto não vira área de texto ---------------------------
//
// Número e liga/desliga não são digitados como texto; devolver área ali daria
// um campo onde a pessoa escreveria algo que o controle não sabe ler.
check('número nunca', ehCampoDeVariasLinhas({ key: 'n', type: 'number', multiline: true }, '1\n2') === false)
check('liga/desliga nunca', ehCampoDeVariasLinhas({ key: 'b', type: 'boolean', multiline: true }, 'a\nb') === false)
check('escolha da lista nunca', ehCampoDeVariasLinhas({ key: 'o', type: 'enum', options: ['a'] }, 'a\nb') === false)
check('definição ausente não quebra', ehCampoDeVariasLinhas(undefined, 'a\nb') === false)
check('valor ausente não quebra', ehCampoDeVariasLinhas(texto(), undefined) === false)
check('valor nulo não quebra', ehCampoDeVariasLinhas(texto(), null) === false)

// --- o pool reservado não é oferecido -----------------------------------
//
// `__native__` existe para as automações do sistema (o /menu). Escolhê-lo numa
// instalação colocaria um comando do usuário no pool reservado — mesma família
// do `__owner__`, que o motor recusa escrever. Lá a escrita foi bloqueada;
// aqui a tela oferecia de bandeja.
{
  const pools = [{ id: '__native__' }, { id: 'pool-local' }, { id: 'outro' }]
  const oferecidos = poolsOferecidos(pools).map((p) => p.id)
  check('o pool do sistema fica fora da lista', !oferecidos.includes('__native__'), JSON.stringify(oferecidos))
  check('e os do usuário continuam todos', JSON.stringify(oferecidos) === '["pool-local","outro"]', JSON.stringify(oferecidos))
  check('lista vazia não quebra', JSON.stringify(poolsOferecidos([])) === '[]')
  check('entrada inválida não quebra', JSON.stringify(poolsOferecidos(null)) === '[]')
}

// --- a palavra na linguagem, ida e volta --------------------------------
{
  const fonte = [
    'template t-multi v1',
    '  nome: Teste',
    '  descrição: Teste de campo com várias linhas.',
    '  categoria: utilitarios',
    '',
    'automação',
    '  nome: Teste',
    '  tipo: comando',
    '  dispara com: /t',
    '  pool: {{params.poolId}}',
    '  acessa: texto',
    '  casa: exato',
    '  quem: só externos',
    '',
    '  responde "{{params.aviso}}"',
    '',
    'configurável',
    '  aviso: texto = "uma linha só"',
    '    rótulo: Aviso',
    '    várias linhas: sim',
    '  poolId: texto',
    '    rótulo: Pool que responde',
    ''
  ].join('\n')

  const r = compilar(fonte)
  const param = r.template.parameters.find((p) => p.key === 'aviso')
  check('"várias linhas: sim" compila para o campo do template', param.multiline === true, JSON.stringify(param))
  check('e o padrão de uma linha é preservado', param.default === 'uma linha só')

  const volta = descompilar({ ...r.documentTemplate, id: 't', revision: 1 }, r.template)
  check('a volta escreve "várias linhas: sim"', volta.includes('várias linhas: sim'),
    volta.split('\n').filter((l) => l.includes('linhas')).join(' | '))
  const r2 = compilar(volta)
  check('ida e volta dá o MESMO template', JSON.stringify(r2.template) === JSON.stringify(r.template))
}

// --- declaração em tipo que não é texto é RECUSADA ----------------------
//
// Numa configuração de número o campo nem é digitado, então a declaração seria
// ignorada — e declaração ignorada é promessa quebrada. Quem a valida é o
// schema do template, na carga do catálogo.
{
  const fonte = [
    'template t-ruim v1',
    '  nome: Ruim',
    '  descrição: Declara várias linhas num número.',
    '  categoria: utilitarios',
    '',
    'automação',
    '  nome: Ruim',
    '  tipo: comando',
    '  dispara com: /r',
    '  pool: {{params.poolId}}',
    '  acessa: texto',
    '  casa: exato',
    '  quem: só externos',
    '',
    '  soma chat n = 1',
    '',
    'configurável',
    '  quanto: número = 3',
    '    rótulo: Quanto',
    '    várias linhas: sim',
    '  poolId: texto',
    '    rótulo: Pool que responde',
    ''
  ].join('\n')
  const r = compilar(fonte)
  check('o compilador aceita escrever (ele não é o portão)', r.template.parameters.find((p) => p.key === 'quanto')?.multiline === true)

  // O PORTÃO é o schema, na carga do catálogo — e é assim que ele age de
  // verdade: `carregarArquivo` valida cada .lcn ao carregar, então um arquivo
  // inválido derruba a carga em vez de virar um campo que não funciona.
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-cat-'))
  fs.writeFileSync(path.join(pasta, 't-ruim.lcn'), fonte)
  let erro = null
  try { carregarCatalogo({ pastaCatalogo: pasta }) } catch (e) { erro = e }
  check('e o catálogo RECUSA "várias linhas" em número', !!erro, erro?.message?.slice(0, 120))
  check('a recusa nomeia o arquivo, para achar onde consertar',
    /t-ruim/.test(erro?.message || ''), erro?.message?.slice(0, 120))

  // O mesmo arquivo, com o tipo certo, carrega — senão o caso acima provaria
  // só que algo ali está quebrado, não o quê.
  fs.writeFileSync(path.join(pasta, 't-ruim.lcn'), fonte.replace('quanto: número = 3', 'quanto: texto = "3"'))
  let ok = null
  try { ok = carregarCatalogo({ pastaCatalogo: pasta }) } catch (e) { ok = e }
  check('com o tipo texto, o mesmo arquivo carrega', ok?.size === 1, ok?.message || String(ok?.size))
  fs.rmSync(pasta, { recursive: true, force: true })
}

// --- o caso que motivou tudo, no template de verdade --------------------
{
  const catalogo = carregarCatalogo()
  const alvo = catalogo.get('auto-recover')
  const legenda = (alvo.parameters || []).find((p) => p.key === 'caption')
  check('o padrão da legenda do auto-recover tem quebra de linha de verdade',
    typeof legenda.default === 'string' && legenda.default.includes('\n'),
    JSON.stringify(legenda.default?.slice(0, 40)))
  check('então o formulário dele pede área de texto', ehCampoDeVariasLinhas(legenda, legenda.default))

  // E o documento publicado carrega as quebras — é o que o input destruiria.
  const doc = renderizarTemplate(alvo, { caption: legenda.default, poolId: 'p' })
  const no = doc.flow.nodes.find((n) => n.config?.caption)
  check('e o documento publicado preserva as quebras',
    (no.config.caption.match(/\n/g) || []).length >= 3,
    String((no.config.caption.match(/\n/g) || []).length))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CAMPO MULTILINHA PASSARAM')
process.exit(falhas ? 1 : 0)
