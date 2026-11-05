// `acervo.read` COM CONTEÚDO, no lado do gateway.
//
// O motor só enxerga metadado; o texto atravessa apenas para texto simples e
// JSON, até o teto de leitura, inteiro ou nada. Aqui o executor roda de verdade
// contra um acervo temporário e o que o motor receberia é capturado na
// confirmação.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { criarOrcamentoDeMidia } from '../src/mediaBudget.js'

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-acervo-ler-'))
let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const acervo = await import('../src/mediaLibrary.js')
acervo._usarPastaParaTeste(pasta)

const json = acervo.guardar(Buffer.from('["a","b"]'), { mimetype: 'application/json', name: 'precos.json', folder: 'loja' })
const txt = acervo.guardar(Buffer.from('olá, mundo ✓'), { mimetype: 'text/plain', name: 'aviso.txt' })
const html = acervo.guardar(Buffer.from('<p>oi</p>'), { mimetype: 'text/html', name: 'pagina.html' })
const grande = acervo.guardar(Buffer.from('x'.repeat(200)), { mimetype: 'text/plain', name: 'grande.txt' })
const binario = acervo.guardar(Buffer.from([0xff, 0xfe, 0xfd, 0x41]), { mimetype: 'text/plain', name: 'quebrado.txt' })

const orcamento = criarOrcamentoDeMidia(1024 * 1024)
let n = 0
async function ler (caminho, extra = {}) {
  const confirmacoes = []
  const engine = { execucoes: { confirmar: async (id, corpo) => { confirmacoes.push(corpo); return { ok: true } } } }
  const comando = { id: `c${++n}`, commandType: 'acervo.read', payload: { chatId: '5511900000001@s.whatsapp.net', caminho, ...extra } }
  await executarComandos({}, [comando], engine, { acervo, orcamento, limiteBytes: 1024 * 1024 })
  return confirmacoes[0]
}

const origWarn = console.warn
console.warn = () => {}

let r = await ler('loja/precos.json')
check('sem content, só metadado (nada de conteudo)', r?.status === 'sent' && r.resultado.dados.conteudo === undefined)
check('o tipo e os bytes agora vêm preenchidos', r.resultado.dados.tipo === 'application/json' && r.resultado.dados.bytes === 9, JSON.stringify(r.resultado.dados))

r = await ler('loja/precos.json', { conteudo: true })
check('JSON volta como o texto exato do arquivo', r?.resultado?.dados?.conteudo === '["a","b"]', JSON.stringify(r?.resultado?.dados))

r = await ler('aviso.txt', { conteudo: true })
check('texto simples volta inteiro, com acento', r?.resultado?.dados?.conteudo === 'olá, mundo ✓')

r = await ler('pagina.html', { conteudo: true })
check('HTML é recusado (só texto simples e JSON)', r?.status === 'failed' && !r.resultado)

process.env.LCN_ACERVO_LER_MAX_BYTES = '100'
r = await ler('grande.txt', { conteudo: true })
check('acima do teto de leitura é recusado inteiro, não cortado', r?.status === 'failed' && !r.resultado)
check('o teto é configurável, não fixo', acervo.limiteDeLeitura() === 100)
delete process.env.LCN_ACERVO_LER_MAX_BYTES
check('padrão do teto: 64 KiB', acervo.limiteDeLeitura() === 64 * 1024)
r = await ler('grande.txt', { conteudo: true })
check('com o padrão, o mesmo arquivo cabe', r?.resultado?.dados?.conteudo === 'x'.repeat(200))

r = await ler('quebrado.txt', { conteudo: true })
check('bytes que não são UTF-8 são recusados', r?.status === 'failed')

check('a reserva de memória é devolvida em todos os casos', orcamento.estado().reservados === 0, JSON.stringify(orcamento.estado()))

console.warn = origWarn
fs.rmSync(pasta, { recursive: true, force: true })
if (falhas) process.exit(1)
