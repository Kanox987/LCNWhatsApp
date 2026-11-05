// TRAVA DO ACERVO ENTRE PROCESSOS.
//
// O painel e o gateway são processos diferentes e os dois mudam o mesmo índice
// e os mesmos arquivos. Aqui seis processos acrescentam item ao MESMO JSON ao
// mesmo tempo: sem a trava, o último a gravar apagaria os outros e a conta não
// fecharia.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-acervo-trava-'))
let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const acervo = await import('../src/mediaLibrary.js')
acervo._usarPastaParaTeste(pasta)

const arq = acervo.guardar(Buffer.from('[]'), { mimetype: 'application/json', name: 'fila.json' })

const filho = (prefixo) => new Promise((resolve) => {
  const codigo = `
    const a = await import(${JSON.stringify(path.join(raiz, 'src/mediaLibrary.js'))})
    a._usarPastaParaTeste(${JSON.stringify(pasta)})
    for (let i = 0; i < 12; i++) {
      a.modificarConteudo(${JSON.stringify(arq.id)}, (b) => Buffer.from(JSON.stringify([...JSON.parse(b.toString('utf8')), '${prefixo}-' + i])))
    }`
  const p = spawn(process.execPath, ['--input-type=module', '-e', codigo], { stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  p.stderr.on('data', (d) => { err += d })
  p.on('close', (c) => resolve({ c, err }))
})

const resultados = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(filho))
check('os seis processos terminam sem erro', resultados.every((r) => r.c === 0), resultados.map((r) => r.err).filter(Boolean).join(' | ').slice(0, 200))

const lista = JSON.parse(acervo.lerConteudo(arq.id).toString('utf8'))
check('nenhum item se perdeu (6 x 12 = 72)', lista.length === 72, `tem ${lista.length}`)
check('nenhum item duplicou', new Set(lista).size === 72)
check('o índice continua íntegro e com o arquivo', acervo.listar().length === 1 && acervo.obter(arq.id).sizeBytes === acervo.lerConteudo(arq.id).length)
check('a trava não fica para trás', !fs.existsSync(path.join(pasta, '.lock')) && !fs.readdirSync(pasta).some((n) => n.endsWith('.tmp')))

// Trava abandonada por processo morto é vencida.
fs.mkdirSync(path.join(pasta, '.lock'))
const velho = new Date(Date.now() - 60000)
fs.utimesSync(path.join(pasta, '.lock'), velho, velho)
check('trava abandonada não prende o acervo', (() => { try { acervo.modificarConteudo(arq.id, (b) => b); return true } catch { return false } })())

// Quem perdeu a trava por demora não apaga a trava de quem a pegou depois.
{
  const trava = path.join(pasta, '.lock')
  let intacta = false
  acervo.modificarConteudo(arq.id, (b) => {
    // Enquanto este "processo" trabalha, a trava é retomada por outro dono.
    fs.rmSync(trava, { recursive: true, force: true })
    fs.mkdirSync(trava)
    fs.writeFileSync(path.join(trava, 'dono'), 'outro-processo')
    return null
  })
  intacta = fs.existsSync(trava) && fs.readFileSync(path.join(trava, 'dono'), 'utf8') === 'outro-processo'
  check('quem perdeu a trava não apaga a de quem a pegou depois', intacta)
  fs.rmSync(trava, { recursive: true, force: true })
}

// Devolver null não grava nada.
const antes = acervo.obter(arq.id).updatedAt
acervo.modificarConteudo(arq.id, () => null)
check('mudar que devolve null não grava', acervo.obter(arq.id).updatedAt === antes)

// A mudança que viola o JSON é recusada e o arquivo fica como estava.
const bom = acervo.lerConteudo(arq.id).toString('utf8')
let recusou = false
try { acervo.modificarConteudo(arq.id, () => Buffer.from('{quebrado')) } catch { recusou = true }
check('mudança que quebra o JSON é recusada e o arquivo não muda', recusou && acervo.lerConteudo(arq.id).toString('utf8') === bom)

fs.rmSync(pasta, { recursive: true, force: true })
if (falhas) process.exit(1)
