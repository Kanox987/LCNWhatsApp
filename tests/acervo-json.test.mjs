// JSON NO ACERVO.
//
// O acervo só aceitava mídia, texto e HTML; quem queria guardar uma tabela de
// preços ou uma lista tinha de fingir que era .txt. JSON entra como DOCUMENTO e
// só se PARSEIA, com limite próprio (é lido e reescrito inteiro).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-acervo-json-'))
let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const acervo = await import('../src/mediaLibrary.js')
acervo._usarPastaParaTeste(pastaTeste)
const tenta = (fn) => { try { fn(); return null } catch (e) { return e.message } }

const ok = acervo.guardar(Buffer.from('["a","b"]'), { mimetype: 'application/json', name: 'lista.json' })
check('JSON válido entra', !!ok.id && ok.mimetype === 'application/json')
check('JSON é enviado como documento, não despejado em texto', ok.kind === 'document')

check('JSON inválido é recusado com o motivo', /JSON inválido/.test(tenta(() => acervo.guardar(Buffer.from('{quebrado'), { mimetype: 'application/json', name: 'x.json' })) || ''))
check('"null" e números são JSON válido', tenta(() => acervo.guardar(Buffer.from('42'), { mimetype: 'application/json', name: 'n.json' })) === null)

process.env.LCN_ACERVO_JSON_MAX_BYTES = '20'
check('acima do limite próprio é recusado', /JSON grande demais/.test(tenta(() => acervo.guardar(Buffer.from(JSON.stringify(['x'.repeat(30)])), { mimetype: 'application/json', name: 'g.json' })) || ''))
check('o limite é configurável, não teto', acervo.limiteDeJson() === 20)
delete process.env.LCN_ACERVO_JSON_MAX_BYTES
check('sem variável, o padrão é 1 MiB', acervo.limiteDeJson() === 1024 * 1024)

// Reescrever também valida, e mantém o id.
const depois = acervo.reescrever(ok.id, Buffer.from('["a","b","c"]'))
check('reescrever mantém o id', depois.id === ok.id)
check('reescrever com JSON quebrado é recusado', /JSON inválido/.test(tenta(() => acervo.reescrever(ok.id, Buffer.from('["a",'))) || ''))
check('e o arquivo continua com o conteúdo anterior', acervo.lerConteudo(ok.id).toString('utf8') === '["a","b","c"]')
const sobras = fs.readdirSync(path.join(pastaTeste, 'arquivos')).filter((n) => n.endsWith('.tmp'))
check('a escrita atômica não deixa provisório para trás', sobras.length === 0, sobras.join(','))

// Texto comum não é afetado pela validação de JSON.
check('texto que não é JSON segue entrando como text/plain', tenta(() => acervo.guardar(Buffer.from('{quebrado'), { mimetype: 'text/plain', name: 't.txt' })) === null)

fs.rmSync(pastaTeste, { recursive: true, force: true })
console.log(falhas === 0 ? '\nacervo json: tudo certo' : `\nacervo json: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
