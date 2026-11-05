// O mapa LID <-> telefone não pode crescer sem fim nem custar um laço de
// eventos parado a cada gravação. Aqui o limite, a ordem de saída e o formato
// do arquivo — com o arquivo num diretório temporário, nunca no data/ real.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-lid-limite-'))
const arquivoTeste = path.join(pastaTeste, 'lid-map.json')
const lidMap = await import('../src/lidMap.js')
lidMap._reiniciarParaTeste(arquivoTeste)

const lid = (n) => `${100000000000000 + n}@lid`
const fone = (n) => `55119${String(n).padStart(8, '0')}@s.whatsapp.net`

// --- a) o mapa para de crescer no limite ------------------------------------
lidMap.definirLimite(100)
for (let i = 0; i < 1000; i++) lidMap.registrarPar(lid(i), fone(i))
check('1000 pares aprendidos com limite 100 deixam no máximo 100', lidMap.tamanho() === 100)
check('os mais antigos saíram: o primeiro volta como veio', lidMap.paraTelefone(lid(0)) === lid(0))
check('os mais recentes ficam: o último traduz', lidMap.paraTelefone(lid(999)) === fone(999))

// --- b) quem continua falando não é expulso ---------------------------------
lidMap._reiniciarParaTeste(arquivoTeste)
lidMap.definirLimite(10)
for (let i = 0; i < 10; i++) lidMap.registrarPar(lid(i), fone(i))
lidMap.registrarPar(lid(0), fone(0)) // o mais antigo fala de novo
for (let i = 10; i < 19; i++) lidMap.registrarPar(lid(i), fone(i)) // nove novos empurram nove antigos
check('quem falou de novo sobreviveu à rotação', lidMap.paraTelefone(lid(0)) === fone(0))
check('quem ficou quieto foi o primeiro a sair', lidMap.paraTelefone(lid(1)) === lid(1))
check('o tamanho segue no limite', lidMap.tamanho() === 10)

// --- c) trocar o telefone de um LID não duplica nem estoura -----------------
lidMap.registrarPar(lid(0), fone(500))
check('o mesmo LID com outro telefone substitui, não soma', lidMap.tamanho() === 10 && lidMap.paraTelefone(lid(0)) === fone(500))

// --- d) baixar o limite apara na hora, e o arquivo reflete ------------------
lidMap.definirLimite(3)
check('baixar o limite apara o excedente', lidMap.tamanho() === 3)
check('limite inválido é ignorado', lidMap.definirLimite(0) === 3 && lidMap.definirLimite(-5) === 3 && lidMap.definirLimite(1.5) === 3 && lidMap.definirLimite('x') === 3)
lidMap.gravarAgora()
const salvo = JSON.parse(fs.readFileSync(arquivoTeste, 'utf8'))
check('o arquivo grava só o que sobrou', Object.keys(salvo.lidParaTelefone).length === 3)

// --- e) o arquivo é compacto (sem indentação) -------------------------------
const texto = fs.readFileSync(arquivoTeste, 'utf8')
check('o arquivo é gravado sem indentação', !/\n {2}"/.test(texto))

// --- f) arquivo antigo maior que o limite é aparado na leitura --------------
const grande = {}
for (let i = 0; i < 500; i++) grande[lid(i)] = fone(i)
fs.writeFileSync(arquivoTeste, JSON.stringify({ versao: 1, lidParaTelefone: grande }))
lidMap._reiniciarParaTeste(arquivoTeste)
lidMap.definirLimite(50)
check('ao ler um arquivo maior que o limite, mantém os 50 últimos', lidMap.tamanho() === 50 && lidMap.paraTelefone(lid(499)) === fone(499) && lidMap.paraTelefone(lid(0)) === lid(0))

// --- g) o limite padrão é folgado, não um teto apertado ---------------------
lidMap._reiniciarParaTeste(arquivoTeste)
lidMap.definirLimite(50000)
for (let i = 0; i < 20000; i++) lidMap.registrarPar(lid(i), fone(i))
check('20 mil pares cabem sem perda no padrão', lidMap.tamanho() === 20000)

fs.rmSync(pastaTeste, { recursive: true, force: true })
console.log(`\n${checagens} CHECAGENS PASSARAM`)
process.exit(0)
