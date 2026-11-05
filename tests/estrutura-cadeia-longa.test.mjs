// `inferirEstrutura` roda no painel (descompilar) e no motor (validar). Ela
// guardava, para cada passo, o conjunto de TODOS os passos posteriores: numa
// cadeia de ações isso é O(n²) de memória (93 MB com 2 mil passos), e a
// recursão estourava a pilha perto de 5 mil. Aqui a cadeia longa tem de
// passar, em tempo e memória limitados, e os pontos de junção das condições
// têm de continuar exatamente onde estavam.
import assert from 'node:assert/strict'
import { inferirEstrutura } from '../src/lcn/estrutura.js'
import { descompilar } from '../src/lcn/descompilar.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }
const igual = (nome, a, b) => { assert.deepStrictEqual(a, b, nome); checagens++; console.log(`✅ ${nome}`) }

const gatilho = { id: 't', type: 'trigger.message', config: { command: 't', acceptedMessageKinds: ['text'] } }
const acao = (id) => ({ id, type: 'action.whatsapp.reply', config: { text: id } })
const cond = (id) => ({ id, type: 'condition.compare', config: { left: 'a', operator: 'eq', right: 'b' } })
const fluxo = (nodes, edges) => ({ nodes: [gatilho, ...nodes], edges })
const ligar = (from, on, to) => ({ from, on, to })
const erroDe = (fn) => { try { fn(); return null } catch (e) { return e.message } }

function cadeia (n) {
  const nodes = []
  const edges = []
  for (let k = 0; k < n; k++) {
    nodes.push(acao('n' + k))
    edges.push(ligar(k ? 'n' + (k - 1) : 't', k ? 'success' : 'matched', 'n' + k))
  }
  return fluxo(nodes, edges)
}

// --- a) cadeia longa: sem estourar a pilha e sem memória quadrática ----------
{
  const n = 20000
  const antes = process.memoryUsage().heapUsed
  const inicio = Date.now()
  const estrutura = inferirEstrutura(cadeia(n), 't')
  const ms = Date.now() - inicio
  const mb = (process.memoryUsage().heapUsed - antes) / 1e6
  check(`${n} passos em sequência viram ${n} itens na ordem`, estrutura.length === n && estrutura[0] === 'n0' && estrutura[n - 1] === 'n' + (n - 1))
  check(`o tempo é limitado (${ms} ms)`, ms < 5000)
  check(`a memória é linear (${mb.toFixed(0)} MB; o conjunto de posteriores passava de 1 GB)`, mb < 300)
}
{
  const doc = { schemaVersion: 1, name: 't', flow: cadeia(8000) }
  const texto = descompilar(doc)
  check('descompilar também aguenta 8000 passos', typeof texto === 'string' && texto.includes('p0') === false && texto.length > 8000)
}

// --- b) pontos de junção --------------------------------------------------
// t → c1 ─true→ a1 ─┐
//        └false→ a2 ─┴→ fim (a3)
{
  const f = fluxo(
    [cond('c1'), acao('a1'), acao('a2'), acao('a3')],
    [ligar('t', 'matched', 'c1'), ligar('c1', 'true', 'a1'), ligar('c1', 'false', 'a2'),
      ligar('a1', 'success', 'a3'), ligar('a2', 'success', 'a3')]
  )
  igual('losango: a ação comum fica DEPOIS da condição', inferirEstrutura(f, 't'),
    [{ nodeId: 'c1', true: ['a1'], false: ['a2'] }, 'a3'])
}
{
  // sem senão: o ramo falso vai direto à continuação
  const f = fluxo(
    [cond('c1'), acao('a1'), acao('a2')],
    [ligar('t', 'matched', 'c1'), ligar('c1', 'true', 'a1'), ligar('a1', 'success', 'a2'), ligar('c1', 'false', 'a2')]
  )
  igual('se sem senão: a continuação sai do bloco', inferirEstrutura(f, 't'),
    [{ nodeId: 'c1', true: ['a1'] }, 'a2'])
}
{
  // aninhada: a junção interna não puxa para fora o que só acontece em parte
  const f = fluxo(
    [cond('c1'), cond('c2'), acao('a1'), acao('a2'), acao('a3'), acao('a4')],
    [ligar('t', 'matched', 'c1'),
      ligar('c1', 'true', 'c2'), ligar('c1', 'false', 'a3'),
      ligar('c2', 'true', 'a1'), ligar('c2', 'false', 'a2'),
      ligar('a1', 'success', 'a4'), ligar('a2', 'success', 'a4'), ligar('a3', 'success', 'a4')]
  )
  igual('condição dentro de condição junta tudo no mesmo passo final', inferirEstrutura(f, 't'),
    [{ nodeId: 'c1', true: [{ nodeId: 'c2', true: ['a1'], false: ['a2'] }], false: ['a3'] }, 'a4'])
}
{
  // ramos que terminam sem se reencontrar
  const f = fluxo(
    [cond('c1'), acao('a1'), acao('a2')],
    [ligar('t', 'matched', 'c1'), ligar('c1', 'true', 'a1'), ligar('c1', 'false', 'a2')]
  )
  igual('ramos que nunca se reencontram ficam cada um no seu bloco', inferirEstrutura(f, 't'),
    [{ nodeId: 'c1', true: ['a1'], false: ['a2'] }])
}
{
  // 3 condições encadeadas em sequência, cada uma com junção própria
  const nodes = []
  const edges = [ligar('t', 'matched', 'c0')]
  for (let k = 0; k < 3; k++) {
    nodes.push(cond('c' + k), acao('x' + k), acao('y' + k))
    edges.push(ligar('c' + k, 'true', 'x' + k), ligar('c' + k, 'false', 'y' + k))
    const prox = k < 2 ? 'c' + (k + 1) : 'fim'
    edges.push(ligar('x' + k, 'success', prox), ligar('y' + k, 'success', prox))
  }
  nodes.push(acao('fim'))
  igual('condições em fila reencontram o passo seguinte, uma a uma', inferirEstrutura(fluxo(nodes, edges), 't'),
    [{ nodeId: 'c0', true: ['x0'], false: ['y0'] }, { nodeId: 'c1', true: ['x1'], false: ['y1'] },
      { nodeId: 'c2', true: ['x2'], false: ['y2'] }, 'fim'])
}

// --- c) recusas preservadas ----------------------------------------------
{
  const f = fluxo([acao('a1'), acao('a2')],
    [ligar('t', 'matched', 'a1'), ligar('a1', 'success', 'a2'), ligar('a2', 'success', 'a1')])
  check('ciclo continua recusado', /ciclo/.test(erroDe(() => inferirEstrutura(f, 't')) || ''))
}
{
  const f = fluxo([acao('a1')], [ligar('t', 'matched', 'a1'), ligar('a1', 'success', 'fantasma')])
  check('nó inexistente continua recusado', /inexistente/.test(erroDe(() => inferirEstrutura(f, 't')) || ''))
}
{
  const f = fluxo([acao('a1'), acao('a2')],
    [ligar('t', 'matched', 'a1'), ligar('a1', 'success', 'a2'), ligar('a1', 'success', 'a1')])
  check('duas saídas com o mesmo resultado continuam recusadas', /mais de uma saída/.test(erroDe(() => inferirEstrutura(f, 't')) || ''))
}

console.log(`\n${checagens} CHECAGENS PASSARAM`)
