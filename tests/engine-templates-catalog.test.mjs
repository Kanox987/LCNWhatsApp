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
  const templateMinimo = (templateId, dependsOn = []) => ({
    templateId,
    templateVersion: 1,
    name: templateId,
    description: 'fixture de teste',
    category: 'utilitarios',
    dependsOn,
    requiredCapabilities: [],
    parameters: [],
    documentTemplate: { schemaVersion: 1 }
  })

  fs.writeFileSync(path.join(pastaFixture, 'raiz.json'), JSON.stringify(templateMinimo('raiz', ['folha'])))
  fs.writeFileSync(path.join(pastaFixture, 'folha.json'), JSON.stringify(templateMinimo('folha')))
  const catalogoFixture = carregarCatalogo({ pastaCatalogo: pastaFixture })
  check('catálogo de fixture carrega os 2 templates', catalogoFixture.size === 2)
  const ordem = resolverOrdemInstalacao(catalogoFixture, 'raiz')
  check('dependência (folha) vem ANTES de quem depende dela (raiz) na ordem de instalação', JSON.stringify(ordem) === JSON.stringify(['folha', 'raiz']))

  let lancouDependenciaInexistente = false
  fs.writeFileSync(path.join(pastaFixture, 'quebrado.json'), JSON.stringify(templateMinimo('quebrado', ['fantasma'])))
  const catalogoComDependenciaQuebrada = carregarCatalogo({ pastaCatalogo: pastaFixture })
  try { resolverOrdemInstalacao(catalogoComDependenciaQuebrada, 'quebrado') } catch { lancouDependenciaInexistente = true }
  check('dependsOn apontando pra template inexistente lança erro (não instala parcial)', lancouDependenciaInexistente)
  fs.rmSync(path.join(pastaFixture, 'quebrado.json'))

  fs.writeFileSync(path.join(pastaFixture, 'a.json'), JSON.stringify(templateMinimo('a', ['b'])))
  fs.writeFileSync(path.join(pastaFixture, 'b.json'), JSON.stringify(templateMinimo('b', ['a'])))
  const catalogoComCiclo = carregarCatalogo({ pastaCatalogo: pastaFixture })
  let lancouCiclo = false
  try { resolverOrdemInstalacao(catalogoComCiclo, 'a') } catch { lancouCiclo = true }
  check('ciclo de dependência (a->b->a) é detectado e lança erro', lancouCiclo)

  fs.writeFileSync(path.join(pastaFixture, 'invalido.json'), JSON.stringify({ templateId: 'invalido' }))
  let lancouTemplateInvalido = false
  try { carregarCatalogo({ pastaCatalogo: pastaFixture }) } catch { lancouTemplateInvalido = true }
  check('template que não bate com o schema (faltam campos obrigatórios) lança erro ao carregar', lancouTemplateInvalido)
  fs.rmSync(path.join(pastaFixture, 'invalido.json'))

  fs.writeFileSync(path.join(pastaFixture, 'duplicado.json'), JSON.stringify(templateMinimo('raiz')))
  let lancouDuplicado = false
  try { carregarCatalogo({ pastaCatalogo: pastaFixture }) } catch { lancouDuplicado = true }
  check('dois arquivos com o mesmo templateId lança erro (nunca sobrescreve em silêncio)', lancouDuplicado)
} finally {
  fs.rmSync(pastaFixture, { recursive: true, force: true })
}

check('pasta de catálogo inexistente devolve mapa vazio (nunca lança)', carregarCatalogo({ pastaCatalogo: '/tmp/lcn-pasta-catalogo-que-nao-existe-nunca' }).size === 0)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO CATÁLOGO DE TEMPLATES PASSARAM')
process.exit(falhas ? 1 : 0)
