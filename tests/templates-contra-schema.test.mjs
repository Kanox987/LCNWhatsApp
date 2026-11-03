// Guarda do portão que o template NÃO atravessava: o JSON Schema.
//
// `tests/lcn-ida-e-volta.test.mjs` prova que todo template do catálogo
// compila e volta igual. Isso é sobre a LINGUAGEM, não sobre a instalação.
// Quem instala passa por outro caminho (`routes/templates.js`, a transação
// `instalar`), e lá o documento renderizado encara três recusas que a ida e
// volta nunca exercita:
//
//   1. `normalizarDocumento` — schemaVersion 1, id e revision;
//   2. `validarAutomacao` — o Ajv contra `schema/automation.v1.schema.json`,
//      mais as checagens de fluxo (nó órfão, ciclo, referência quebrada);
//   3. a conferência de que todo `type` de nó é executável pelo runtime
//      (`ACOES_SUPORTADAS` / `GATILHOS_SUPORTADOS` / `CONDICOES_SUPORTADAS`).
//
// Qualquer uma das três devolve **422** na hora em que o dono clica em
// instalar — num template que está no catálogo, verde na bateria, e portanto
// anunciado como pronto. É o pior formato de defeito deste projeto: a vitrine
// promete e a instalação recusa.
//
// Este arquivo fecha isso renderizando CADA template do catálogo com os
// mesmos padrões da ida e volta e submetendo o documento exatamente como o
// instalador o monta, inclusive o `scope`, que a instalação sobrescreve.
import { renderizarTemplate } from '../src/engine/templates/render.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { ACOES_SUPORTADAS, CONDICOES_SUPORTADAS, GATILHOS_SUPORTADOS } from '../src/engine/server/runtimeCapabilities.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const catalogo = [...carregarCatalogo().values()]
check('o catálogo tem templates para exercitar', catalogo.length >= 20, String(catalogo.length))

// O MESMO preenchimento da ida e volta: parâmetro sem padrão recebe um valor
// qualquer, parâmetro com padrão fica com o dele. É o estado em que um
// template chega à instalação quando a pessoa aceita tudo como está.
const padroes = (template) => Object.fromEntries(
  (template.parameters || [])
    .filter((p) => p.default === undefined || p.default === null)
    .map((p) => [p.key, 'x1'])
)

for (const template of catalogo) {
  let documento
  try {
    documento = renderizarTemplate(template, padroes(template))
  } catch (erro) {
    check(`${template.templateId}: renderiza`, false, erro.message)
    continue
  }

  // O que `instalar` faz antes de chamar `criarEPublicar`: o id da automação
  // (que por padrão é o próprio templateId), a revisão 1 e o escopo escolhido
  // na tela. O escopo do documento renderizado é IGNORADO pelo instalador, e
  // por isso um escopo real entra aqui — senão a guarda validaria uma forma
  // que a instalação nunca submete.
  documento.id = template.templateId
  documento.revision = 1
  documento.scope = { include: [{ kind: 'group', id: '120363000000000000@g.us' }], exclude: [] }

  // Portão 1 — o que `normalizarDocumento` exige.
  check(`${template.templateId}: schemaVersion 1`, documento.schemaVersion === 1, String(documento.schemaVersion))

  // Portão 2 — o Ajv e as checagens de fluxo. Sem banco: `validarAutomacao`
  // aceita ser chamado só com o documento e pula a conferência de pool, que é
  // sobre dado instalado e não sobre o template.
  let erros
  try {
    erros = validarAutomacao(documento)
  } catch (erro) {
    check(`${template.templateId}: a validação roda`, false, erro.message)
    continue
  }
  check(`${template.templateId}: passa no JSON Schema e nas checagens de fluxo`, erros.length === 0,
    erros.length ? erros.slice(0, 3).map((e) => `${e.path} ${e.message}`).join(' | ') : '')

  // Portão 3 — todo nó é executável pelo motor. É a recusa que derruba a
  // publicação DEPOIS de o schema aprovar: ação escrita certo, e que o
  // runtime desta versão não executa.
  const nos = Array.isArray(documento.flow?.nodes) ? documento.flow.nodes : []
  const naoExecutaveis = nos.filter((node) => {
    if (typeof node?.type !== 'string') return true
    if (node.type.startsWith('action.')) return !ACOES_SUPORTADAS.includes(node.type)
    if (node.type.startsWith('trigger.')) return !GATILHOS_SUPORTADOS.includes(node.type)
    if (node.type.startsWith('condition.')) return !CONDICOES_SUPORTADAS.includes(node.type)
    return true
  }).map((n) => n.type)
  check(`${template.templateId}: todo nó é executável pelo runtime`, naoExecutaveis.length === 0,
    naoExecutaveis.join(', '))
}

// A guarda tem que FALHAR quando o documento está torto — senão ela passaria
// verde num catálogo vazio ou numa validação que silenciosamente não roda.
const tortoSemGatilho = {
  schemaVersion: 1,
  id: 'teste-torto',
  revision: 1,
  enabled: true,
  name: 'torto',
  scope: { include: [{ kind: 'everywhere' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'] },
  responder: { mode: 'reply' },
  flow: { nodes: [], edges: [] }
}
const errosTorto = validarAutomacao(tortoSemGatilho)
check('a validação REPROVA um documento sem gatilho', errosTorto.length > 0, String(errosTorto.length))

const tortoCampoInventado = { ...tortoSemGatilho, campoQueNaoExiste: 1 }
check('a validação REPROVA campo que o schema não conhece',
  validarAutomacao(tortoCampoInventado).length > 0)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODO TEMPLATE DO CATÁLOGO PASSA NOS PORTÕES DA INSTALAÇÃO')
process.exit(falhas ? 1 : 0)
