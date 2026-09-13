// Módulo 4 da Parte C do plano — render.js: materialização de template ->
// documento de automação. Substituição estrutural e tipada (nunca eval,
// nunca interpolação de texto livre) — só o namespace fixo `params.<chave>`
// é reconhecido; qualquer outro `{{namespace.campo}}` no template (ex:
// `{{latencyMs}}`) precisa sair intacto pro avaliador de runtime resolver.
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const templateBase = {
  parameters: [
    { key: 'command', label: 'Comando', type: 'string', default: '/oi' },
    { key: 'vezes', label: 'Vezes', type: 'number', default: 1 },
    { key: 'ativo', label: 'Ativo', type: 'boolean', default: true }
  ],
  documentTemplate: {
    schemaVersion: 1,
    flow: {
      nodes: [
        { id: 'gatilho', type: 'trigger.command', config: { command: '{{params.command}}' } }
      ]
    }
  }
}

try {
  const semParametros = renderizarTemplate(templateBase, {})
  check('sem parâmetros fornecidos, usa o default declarado', semParametros.flow.nodes[0].config.command === '/oi')

  const comParametro = renderizarTemplate(templateBase, { command: '/ping' })
  check('parâmetro fornecido substitui o default', comParametro.flow.nodes[0].config.command === '/ping')
  check('não modifica o template original (clona antes de substituir)', templateBase.documentTemplate.flow.nodes[0].config.command === '{{params.command}}')

  const templateNumero = { parameters: [{ key: 'n', label: 'N', type: 'number' }], documentTemplate: { valor: '{{params.n}}' } }
  const renderNumero = renderizarTemplate(templateNumero, { n: 42 })
  check('placeholder exato de parâmetro number vira number de verdade (nunca string)', renderNumero.valor === 42 && typeof renderNumero.valor === 'number')

  const templateBooleano = { parameters: [{ key: 'b', label: 'B', type: 'boolean' }], documentTemplate: { valor: '{{params.b}}' } }
  check('placeholder exato de parâmetro boolean vira boolean de verdade', renderizarTemplate(templateBooleano, { b: true }).valor === true)

  const templateEmbutido = { parameters: [{ key: 'nome', label: 'Nome', type: 'string' }], documentTemplate: { texto: 'Olá, {{params.nome}}!' } }
  check('placeholder embutido no meio de uma string maior vira substituição textual', renderizarTemplate(templateEmbutido, { nome: 'Fulano' }).texto === 'Olá, Fulano!')

  const templateComLatencia = { parameters: [], documentTemplate: { texto: 'pong ({{latencyMs}}ms)' } }
  check('placeholder de runtime ({{latencyMs}}) nunca é tocado pelo render de template', renderizarTemplate(templateComLatencia, {}).texto === 'pong ({{latencyMs}}ms)')

  const templateAninhado = {
    parameters: [{ key: 'x', label: 'X', type: 'string', default: 'y' }],
    documentTemplate: { lista: [{ a: '{{params.x}}' }, { b: ['{{params.x}}', 'fixo'] }] }
  }
  const renderAninhado = renderizarTemplate(templateAninhado, {})
  check('substitui dentro de arrays e objetos aninhados', renderAninhado.lista[0].a === 'y' && renderAninhado.lista[1].b[0] === 'y' && renderAninhado.lista[1].b[1] === 'fixo')

  let lancouParametroFaltando = false
  try { renderizarTemplate({ parameters: [{ key: 'obrigatorio', label: 'X', type: 'string' }], documentTemplate: {} }, {}) } catch { lancouParametroFaltando = true }
  check('parâmetro obrigatório sem default e não fornecido lança erro claro', lancouParametroFaltando)

  let lancouPlaceholderDesconhecido = false
  try { renderizarTemplate({ parameters: [], documentTemplate: { t: '{{params.naoexiste}}' } }, {}) } catch { lancouPlaceholderDesconhecido = true }
  check('placeholder params.* sem parâmetro declarado correspondente lança erro (nunca vira string vazia)', lancouPlaceholderDesconhecido)
} finally {
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE RENDER DE TEMPLATE PASSARAM')
  process.exit(falhas ? 1 : 0)
}
