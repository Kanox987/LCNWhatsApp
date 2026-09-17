// Módulo 4 da Parte C do plano — catalog.js: carregamento/validação do
// catálogo real e resolução de `dependsOn` numa ordem de instalação segura
// (dependência sempre antes de quem depende dela), com detecção de ciclo —
// mesmo algoritmo já usado em server/validate.js pro grafo de fluxo.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { carregarCatalogo, resolverOrdemInstalacao, obterTemplate } from '../src/engine/templates/catalog.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// --- catálogo real do repositório ---
const catalogoReal = carregarCatalogo()
check('catálogo real carrega sem erro e não é vazio', catalogoReal.size >= 3)
check('catálogo real inclui o template "ping"', catalogoReal.has('ping'))
check('catálogo real inclui o template "ajuda"', catalogoReal.has('ajuda'))
check('catálogo real inclui o template "marcar-variavel"', catalogoReal.has('marcar-variavel'))
for (const [id, template] of catalogoReal) {
  check(`template "${id}" do catálogo real tem categoria válida`, typeof template.category === 'string')
}
check('resolverOrdemInstalacao de um template sem dependência devolve só ele mesmo', JSON.stringify(resolverOrdemInstalacao(catalogoReal, 'ping')) === JSON.stringify(['ping']))

let lancouTemplateInexistente = false
try { obterTemplate(catalogoReal, 'nao-existe') } catch { lancouTemplateInexistente = true }
check('obterTemplate de id inexistente lança erro claro', lancouTemplateInexistente)

// --- catálogo de fixture isolado, pra testar dependsOn/ciclo sem tocar no catálogo real ---
const pastaFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-catalog-fixture-'))
try {
  // O catálogo é escrito em .lcn, então o fixture também. Antes ele montava um
  // `documentTemplate` sem gatilho — algo que o carregador real nunca aceitaria
  // e que a linguagem nem representa. Fixture que não é o formato de verdade
  // testa o fixture, não o sistema.
  const templateMinimo = (templateId, dependeDe = []) => [
    `template ${templateId} v1`,
    `  nome: ${templateId}`,
    '  descrição: fixture de teste',
    '  categoria: utilitarios',
    ...dependeDe.map((d) => `  depende de: ${d}`),
    '',
    `comando /${templateId}`,
    `  nome: ${templateId}`,
    '  onde: em qualquer lugar',
    '  pool: p1',
    '  tipos: texto',
    '  casa: exato',
    '  de: externo',
    '',
    '  responde "oi"',
    ''
  ].join('\n')

  fs.writeFileSync(path.join(pastaFixture, 'raiz.lcn'), templateMinimo('raiz', ['folha']))
  fs.writeFileSync(path.join(pastaFixture, 'folha.lcn'), templateMinimo('folha'))
  const catalogoFixture = carregarCatalogo({ pastaCatalogo: pastaFixture })
  check('catálogo de fixture carrega os 2 templates', catalogoFixture.size === 2)
  const ordem = resolverOrdemInstalacao(catalogoFixture, 'raiz')
  check('dependência (folha) vem ANTES de quem depende dela (raiz) na ordem de instalação', JSON.stringify(ordem) === JSON.stringify(['folha', 'raiz']))

  let lancouDependenciaInexistente = false
  fs.writeFileSync(path.join(pastaFixture, 'quebrado.lcn'), templateMinimo('quebrado', ['fantasma']))
  const catalogoComDependenciaQuebrada = carregarCatalogo({ pastaCatalogo: pastaFixture })
  try { resolverOrdemInstalacao(catalogoComDependenciaQuebrada, 'quebrado') } catch { lancouDependenciaInexistente = true }
  check('dependsOn apontando pra template inexistente lança erro (não instala parcial)', lancouDependenciaInexistente)
  fs.rmSync(path.join(pastaFixture, 'quebrado.lcn'))

  fs.writeFileSync(path.join(pastaFixture, 'a.lcn'), templateMinimo('a', ['b']))
  fs.writeFileSync(path.join(pastaFixture, 'b.lcn'), templateMinimo('b', ['a']))
  const catalogoComCiclo = carregarCatalogo({ pastaCatalogo: pastaFixture })
  let lancouCiclo = false
  try { resolverOrdemInstalacao(catalogoComCiclo, 'a') } catch { lancouCiclo = true }
  check('ciclo de dependência (a->b->a) é detectado e lança erro', lancouCiclo)

  // Arquivo que não compila: o carregador tem que recusar, não carregar meio
  // template. E a mensagem precisa dizer QUAL arquivo — num catálogo de vinte,
  // "template inválido" sozinho não ajuda ninguém.
  fs.writeFileSync(path.join(pastaFixture, 'invalido.lcn'), 'isto não é uma automação\n')
  let erroInvalido = null
  try { carregarCatalogo({ pastaCatalogo: pastaFixture }) } catch (e) { erroInvalido = e }
  check('arquivo que não compila lança erro ao carregar', erroInvalido !== null)
  check('e o erro nomeia o arquivo', /invalido\.lcn/.test(erroInvalido?.message || ''), erroInvalido?.message)
  fs.rmSync(path.join(pastaFixture, 'invalido.lcn'))

  // Compila, mas não é template: falta o cabeçalho. Sem esta checagem viraria
  // um objeto sem templateId no catálogo.
  fs.writeFileSync(path.join(pastaFixture, 'sem-cabecalho.lcn'),
    'comando /x\n  nome: X\n  onde: em qualquer lugar\n  pool: p\n  tipos: texto\n  casa: exato\n  de: externo\n\n  responde "oi"\n')
  let erroSemCabecalho = null
  try { carregarCatalogo({ pastaCatalogo: pastaFixture }) } catch (e) { erroSemCabecalho = e }
  check('automação sem cabeçalho de template é recusada', erroSemCabecalho !== null,
    erroSemCabecalho?.message)
  fs.rmSync(path.join(pastaFixture, 'sem-cabecalho.lcn'))

  fs.writeFileSync(path.join(pastaFixture, 'duplicado.lcn'), templateMinimo('raiz'))
  let lancouDuplicado = false
  try { carregarCatalogo({ pastaCatalogo: pastaFixture }) } catch { lancouDuplicado = true }
  check('dois arquivos com o mesmo templateId lança erro (nunca sobrescreve em silêncio)', lancouDuplicado)
} finally {
  fs.rmSync(pastaFixture, { recursive: true, force: true })
}

check('pasta de catálogo inexistente devolve mapa vazio (nunca lança)', carregarCatalogo({ pastaCatalogo: '/tmp/lcn-pasta-catalogo-que-nao-existe-nunca' }).size === 0)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO CATÁLOGO DE TEMPLATES PASSARAM')
process.exit(falhas ? 1 : 0)
