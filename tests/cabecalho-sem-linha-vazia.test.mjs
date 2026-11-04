// LINHA DE CABEÇALHO VAZIA — por que ela não pode ser escrita.
//
// O descompilador emitia três linhas sem condição nenhuma: `nome: `, `pool: ` e
// `acessa: `. Quando o documento não tinha aqueles valores, saíam vazias — e aí
// uma delas não era só feia:
//
//   recompilar `  acessa: ` QUEBRAVA com
//   `tipo de mensagem desconhecido: ""`, um erro que nem nomeia o campo.
//
// Isso é o oposto do que o descompilador existe para fazer. O princípio já
// estava escrito no próprio arquivo, vinte linhas abaixo, para a política de
// fila: linha de cabeçalho que não decide nada não se escreve, porque o
// compilador repõe o padrão na volta e nada se perde. `nome:` e `pool:` vazios
// compilavam em silêncio para "", que é o mesmo que a linha ausente produz —
// então omitir não muda documento nenhum, e é o que esta guarda fixa.
//
// Ela não existia porque nenhum template do catálogo alcança o caminho: os
// quatro sem `acessa:` são todos `tipo: porteiro`, e o porteiro já era a única
// classe em que a linha era pulada. O caminho alcançável é um `comando` ou
// `vigia` escrito à mão, que o compilador aceita sem `acessa:`.
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const mesmo = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Uma linha de cabeçalho é `  campo: valor`. Vazia é a que não tem valor algum
// depois dos dois pontos. O título da automação não tem dois pontos, e as linhas
// do fluxo não têm a identação de cabeçalho, então o recorte é só este.
const linhasVazias = (texto) => texto
  .split('\n')
  .filter((l) => /^\s+[^:\n]+:\s*$/.test(l))
  .map((l) => l.trim())

// O mínimo que cada classe EXIGE. `casa:` e `quem:` são obrigatórios no comando
// e no vigia (o compilador recusa sem eles, nomeando a linha), então entram aqui:
// o que está sob teste são as três linhas OPCIONAIS, não a validação do cabeçalho.
const CLASSES = {
  comando: '  dispara com: /x\n  casa: exato\n  quem: qualquer um',
  vigia: '  dispara com: qualquer mensagem\n  quem: qualquer um',
  porteiro: '  quando for: entrou'
}

const monte = (classe, extra) => `automação teste
  tipo: ${classe}
${CLASSES[classe]}
${extra}
  responde "oi"
`

// --- 1. sem os três campos: nenhuma linha vazia, e a volta fecha -----------
for (const classe of Object.keys(CLASSES)) {
  const ida = compilar(monte(classe, ''))
  const texto = descompilar(ida)
  const vazias = linhasVazias(texto)
  check(`[${classe}] sem nome/pool/acessa não sai linha de cabeçalho vazia`, vazias.length === 0, vazias.join(' | '))

  let volta = null
  let erro = null
  try { volta = compilar(texto) } catch (e) { erro = e }
  check(`[${classe}] o texto descompilado RECOMPILA`, erro === null, erro?.message)
  check(`[${classe}] e devolve o mesmo documento`, volta !== null && mesmo(ida, volta))
}

// --- 2. com os três campos: as linhas aparecem e a volta continua fechando --
const COM_TUDO = `  nome: Automação de teste
  acessa: texto, foto
  pool: pool-local`

const idaCheia = compilar(monte('comando', COM_TUDO))
const textoCheio = descompilar(idaCheia)
check('com valor, a linha `nome:` é escrita', /^\s+nome: Automação de teste$/m.test(textoCheio))
check('com valor, a linha `pool:` é escrita', /^\s+pool: pool-local$/m.test(textoCheio))
check('com valor, a linha `acessa:` é escrita', /^\s+acessa: texto, foto$/m.test(textoCheio))
check('com valor, nenhuma linha sai vazia', linhasVazias(textoCheio).length === 0, linhasVazias(textoCheio).join(' | '))
check('com valor, a ida e volta fecha', mesmo(idaCheia, compilar(textoCheio)))

// --- 3. omitir a linha e escrevê-la vazia produzem o MESMO documento --------
//
// É o que autoriza o conserto: para `nome:` e `pool:` o compilador lê a linha
// vazia como "", exatamente o que a ausência produz. Se um dia essa equivalência
// deixar de valer, omitir a linha passaria a MUDAR o documento — e é aqui que
// isso apareceria, em vez de aparecer num documento salvo torto.
const semNada = compilar(monte('comando', ''))
for (const [campo, linha] of [['nome', '  nome: '], ['pool', '  pool: ']]) {
  const comVazia = compilar(monte('comando', linha))
  check(`\`${campo}:\` vazio ainda é igual à linha ausente`, mesmo(semNada, comVazia))
}

// --- 4. e `acessa:` vazio continua sendo RECUSADO --------------------------
//
// Não se conserta isso aceitando o vazio: um comando que aceita "nenhum tipo de
// mensagem" nunca dispararia. A recusa está certa; o que estava errado era o
// descompilador PRODUZIR o texto que ela recusa.
let erroAcessa = null
try { compilar(monte('comando', '  acessa: ')) } catch (e) { erroAcessa = e }
check('`acessa:` vazio é recusado na compilação', erroAcessa instanceof ErroDeSintaxe, erroAcessa?.message)

// --- 5. a MESMA classe em `precisa de um link:` / `precisa de uma mídia:` ----
//
// Achada procurando o resto do defeito, não a esmo. O bloco `requires` era
// emitido sempre que existisse, e o local vinha de `(exige.from || [])`: com a
// lista vazia o join dá "" e saía `precisa de um link: ` — que recompilado
// QUEBRA com `não sei procurar ""`. Pior que o `acessa:`, porque nem dá para
// emitir só o `sem ele:` no lugar: o compilador exige que ele venha DEPOIS de um
// `precisa de ...`. Então o bloco inteiro passou a ser condicional.
//
// O schema já proíbe esse documento (`from` é required, `minItems: 1`), então
// esta é a rede embaixo da rede — mas é barata, e o `acessa:` também era
// proibido pelo schema e ainda assim quebrava o editor antes do publish.
const comExigencia = compilar(monte('comando', '  precisa de um link: na mensagem\n  sem ele: "manda um link"'))
check('com local, a linha `precisa de` é escrita', /^\s+precisa de um link: na mensagem$/m.test(descompilar(comExigencia)))
check('com local, o `sem ele:` acompanha', /^\s+sem ele: "manda um link"$/m.test(descompilar(comExigencia)))

for (const from of [[], undefined]) {
  const doc = JSON.parse(JSON.stringify(comExigencia))
  if (from === undefined) delete doc.inputPolicy.requires.from
  else doc.inputPolicy.requires.from = from
  const texto = descompilar(doc)
  const rotulo = from === undefined ? 'ausente' : 'vazio'
  check(`\`from\` ${rotulo}: nenhuma linha de cabeçalho vazia`, linhasVazias(texto).length === 0, linhasVazias(texto).join(' | '))
  check(`\`from\` ${rotulo}: a exigência inteira é omitida`, !/precisa de |sem ele:/.test(texto))
  let erro = null
  try { compilar(texto) } catch (e) { erro = e }
  check(`\`from\` ${rotulo}: o texto RECOMPILA`, erro === null, erro?.message)
}

// E a recusa do vazio na ida continua valendo, como no `acessa:`.
for (const linha of ['  precisa de um link: ', '  precisa de uma mídia: ']) {
  let erro = null
  try { compilar(monte('comando', linha)) } catch (e) { erro = e }
  check(`\`${linha.trim()}\` vazio é recusado na compilação`, erro instanceof ErroDeSintaxe, erro?.message)
}

console.log(falhas === 0 ? '\nNENHUMA LINHA DE CABEÇALHO SAI VAZIA' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
