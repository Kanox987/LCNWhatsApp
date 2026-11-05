// `action.acervo.edit`: acrescentar/tirar item de um JSON e acrescentar linha a
// um texto, SEM apagar o que já estava no arquivo.
//
// Cobre as três pontas: o template compila para o nó certo, o motor emite o
// comando com o que o gateway precisa, e o gateway executa de verdade contra
// um acervo temporário (inclusive vários pedidos ao mesmo tempo).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { criarOrcamentoDeMidia } from '../src/mediaBudget.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// --- o catálogo traz os três modelos ---------------------------------------
const catalogo = carregarCatalogo()
const tipos = (id) => JSON.stringify(catalogo.get?.(id) ?? catalogo.templates?.find?.((t) => t.id === id) ?? catalogo[id] ?? null)
for (const id of ['acervo-adicionar-item', 'acervo-tirar-item', 'acervo-acrescentar-linha']) {
  const t = tipos(id)
  check(`o modelo ${id} existe e usa action.acervo.edit`, t.includes('action.acervo.edit'))
  check(`${id} nasce só para o dono`, /"acesso"[^}]*"default":"dono"|"default":"dono"/.test(t) || t.includes('dono'))
}

// --- o gateway, contra um acervo de verdade --------------------------------
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-acervo-editar-'))
const acervo = await import('../src/mediaLibrary.js')
acervo._usarPastaParaTeste(pasta)

const lista = acervo.guardar(Buffer.from('["a"]'), { mimetype: 'application/json', name: 'itens.json', folder: 'listas' })
const nums = acervo.guardar(Buffer.from('[1,2]'), { mimetype: 'application/json', name: 'nums.json' })
const objeto = acervo.guardar(Buffer.from('{"a":1}'), { mimetype: 'application/json', name: 'objeto.json' })
const caderno = acervo.guardar(Buffer.from('linha 1'), { mimetype: 'text/plain', name: 'caderno.txt' })
const html = acervo.guardar(Buffer.from('<p>x</p>'), { mimetype: 'text/html', name: 'p.html' })

const CHAT = '5511900000001@s.whatsapp.net'
const orcamento = criarOrcamentoDeMidia(1024 * 1024)
const respostas = []
const client = { message: { send: async () => ({ id: 'M1' }) } }
let n = 0
async function editar (caminho, modo, valor, extra = {}) {
  const confirmacoes = []
  const engine = { execucoes: { confirmar: async (id, corpo) => { confirmacoes.push(corpo); return { ok: true } } } }
  const enviados = []
  const c = { ...client, __enviados: enviados }
  const comando = { id: `e${++n}`, commandType: 'acervo.edit', payload: { chatId: CHAT, caminho, modo, valor, okText: 'ok {{total}}', unchangedText: 'igual {{total}}', ...extra } }
  await executarComandos(c, [comando], engine, { acervo, orcamento, limiteBytes: 1024 * 1024, enviarTexto: undefined })
  return { status: confirmacoes[0]?.status, resultado: confirmacoes[0]?.resultado }
}
const conteudo = (r) => acervo.lerConteudo(r.id).toString('utf8')
const origWarn = console.warn
console.warn = (...a) => { if (process.env.DBG) origWarn(...a) }

let r = await editar('listas/itens.json', 'jsonAdd', 'b')
check('jsonAdd acrescenta e mantém o que havia', r.status === 'sent' && conteudo(lista) === '["a","b"]', conteudo(lista))
r = await editar('listas/itens.json', 'jsonAdd', 'b')
check('item repetido não entra duas vezes', conteudo(lista) === '["a","b"]')
r = await editar('listas/itens.json', 'jsonRemove', 'a')
check('jsonRemove tira só aquele item', conteudo(lista) === '["b"]', conteudo(lista))
r = await editar('listas/itens.json', 'jsonRemove', 'nao-tem')
check('tirar o que não está não muda nada', conteudo(lista) === '["b"]')

r = await editar('nums.json', 'jsonAdd', '3', { comoNumero: true })
check('como número entra número, não texto', conteudo(nums) === '[1,2,3]', conteudo(nums))
r = await editar('nums.json', 'jsonAdd', '3')
check('texto "3" e número 3 são itens diferentes', conteudo(nums) === '[1,2,3,"3"]', conteudo(nums))
r = await editar('nums.json', 'jsonRemove', '3', { comoNumero: true })
check('e tirar como número só tira o número', conteudo(nums) === '[1,2,"3"]', conteudo(nums))
r = await editar('nums.json', 'jsonAdd', 'abc', { comoNumero: true })
check('"abc" não vira número', r.status === 'failed' && conteudo(nums) === '[1,2,"3"]')

r = await editar('objeto.json', 'jsonAdd', 'x')
check('JSON que não é lista é recusado e fica como estava', r.status === 'failed' && conteudo(objeto) === '{"a":1}')
r = await editar('listas/itens.json', 'jsonAdd', '__proto__')
check('"__proto__" é só um texto qualquer na lista', conteudo(lista) === '["b","__proto__"]' && ({}).polluted === undefined)

r = await editar('caderno.txt', 'appendLine', 'linha 2')
check('appendLine acrescenta numa linha nova', conteudo(caderno) === 'linha 1\nlinha 2\n', JSON.stringify(conteudo(caderno)))
r = await editar('caderno.txt', 'appendLine', 'linha 3')
check('e a seguinte vem depois, sem linha em branco', conteudo(caderno) === 'linha 1\nlinha 2\nlinha 3\n')
r = await editar('caderno.txt', 'appendLine', 'duas\nlinhas')
check('quebra de linha no valor é recusada', r.status === 'failed' && conteudo(caderno) === 'linha 1\nlinha 2\nlinha 3\n')

r = await editar('p.html', 'appendLine', 'x')
check('tipo errado (HTML) é recusado', r.status === 'failed')
r = await editar('caderno.txt', 'jsonAdd', 'x')
check('modo de JSON em arquivo de texto é recusado', r.status === 'failed')
r = await editar('nao-existe.json', 'jsonAdd', 'x')
check('arquivo inexistente falha', r.status === 'failed')
r = await editar('listas/itens.json', 'jsonAdd', '  ')
check('valor vazio é recusado', r.status === 'failed')
r = await editar('listas/itens.json', 'jsonAdd', 'x'.repeat(5000))
check('valor enorme é recusado', r.status === 'failed')

// vários pedidos ao mesmo tempo somam
const fila = acervo.guardar(Buffer.from('[]'), { mimetype: 'application/json', name: 'fila.json' })
await Promise.all(Array.from({ length: 20 }, (_, i) => editar('fila.json', 'jsonAdd', `p${i}`)))
check('20 pedidos juntos viram 20 itens', JSON.parse(conteudo(fila)).length === 20, String(JSON.parse(conteudo(fila)).length))

check('a reserva de memória é devolvida', orcamento.estado().reservados === 0)

console.warn = origWarn
fs.rmSync(pasta, { recursive: true, force: true })
if (falhas) process.exit(1)
