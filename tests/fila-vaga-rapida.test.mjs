// A VAGA QUE PREFERE O RÁPIDO.
//
// O relato: um `/ping` preso atrás de um `/dow`. Os dois são "normal"; o que
// muda é quanto tempo cada envio segura a vaga do socket. O pedido do dono:
// das vagas simultâneas, uma prefere comando rápido, e um lento só entra nela
// se nenhum rápido estiver esperando. Rápido/lento e a importância se escrevem
// em número no cabeçalho do comando.
import assert from 'node:assert/strict'
import { criarFila, PRIORIDADES as NIVEIS_DA_FILA, VAGAS_RAPIDAS_PADRAO } from '../src/engine/fila.js'
import { criarFilasDeRecursos, comContextoDeComando, lentoDoComando } from '../src/engine/filasDeRecursos.js'
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { PRIORIDADE_EM_NUMERO, CAMPOS_DO_CABECALHO } from '../src/lcn/vocabulario.js'
import { validarAutomacao } from '../src/engine/server/validate.js'

let checagens = 0
const check = (nome, ok, extra) => { assert.ok(ok, `${nome}${extra ? ` (${extra})` : ''}`); checagens++; console.log(`✅ ${nome}`) }
const porta = () => { let abrir; const promessa = new Promise((r) => { abrir = r }); return { promessa, abrir } }

// --- a fila ----------------------------------------------------------------
check('o padrão é uma vaga preferencial', VAGAS_RAPIDAS_PADRAO === 1)

{
  // Três vagas, uma preferencial. Dois lentos ocupam as comuns; o terceiro
  // lento espera enquanto houver rápido, e o rápido pega a vaga que sobrou.
  const fila = criarFila({ limite: 3, vagasRapidas: 1 })
  const portas = [porta(), porta(), porta()]
  const ordem = []
  const l1 = fila.executar(async () => { ordem.push('l1'); await portas[0].promessa }, { lento: true })
  const l2 = fila.executar(async () => { ordem.push('l2'); await portas[1].promessa }, { lento: true })
  check('dois lentos ocupam as duas vagas comuns', fila.estado.emCurso === 2 && fila.estado.lentosEmCurso === 2)
  // Sem rápido esperando, o terceiro lento entra na preferencial.
  const l3 = fila.executar(async () => { ordem.push('l3'); await portas[2].promessa }, { lento: true })
  check('sem rápido esperando, o lento toma a preferencial', fila.estado.emCurso === 3 && fila.estado.lentosEmCurso === 3)
  // Agora tudo cheio: chega um lento e depois um rápido.
  const l4 = fila.executar(() => ordem.push('l4'), { lento: true })
  const r1 = fila.executar(() => ordem.push('r1'))
  portas[0].abrir()
  await l1
  await new Promise(setImmediate)
  // O rápido é instantâneo e devolve a vaga na hora; o lento entra em seguida.
  check('a vaga que abre com três lentos em curso vai para o rápido, mesmo chegando depois', ordem.indexOf('r1') === 3 && ordem.indexOf('l4') === 4, ordem.join())
  portas[1].abrir(); portas[2].abrir()
  await Promise.all([l2, l3, l4, r1])
  check('o lento que esperou ainda sai', ordem.includes('l4') && fila.estado.lentosEmCurso === 0)
}

{
  // Com vaga COMUM livre, o lento não espera o rápido: a preferência só vale
  // para a vaga preferencial.
  const fila = criarFila({ limite: 3, vagasRapidas: 1 })
  const bloqueio = porta()
  const ordem = []
  const l1 = fila.executar(async () => { ordem.push('l1'); await bloqueio.promessa }, { lento: true })
  const r1 = fila.executar(async () => { ordem.push('r1'); await bloqueio.promessa })
  const r2 = fila.executar(async () => { ordem.push('r2'); await bloqueio.promessa })
  const l2 = fila.executar(() => ordem.push('l2'), { lento: true })
  check('com três ocupadas o lento espera', fila.estado.esperando === 1)
  bloqueio.abrir()
  await Promise.all([l1, r1, r2, l2])
  check('e sai quando abre vaga, sem rápido na disputa', ordem.at(-1) === 'l2')
}

{
  // A preferência não passa por cima da conversa: rápido cuja conversa está
  // ocupada não conta como "esperando", senão travaria a vaga à toa.
  const fila = criarFila({ limite: 2, vagasRapidas: 1 })
  const conversa = porta()
  const comum = porta()
  const ordem = []
  const r1 = fila.executar(async () => { ordem.push('r1'); await conversa.promessa }, { chave: 'A' })
  const l1 = fila.executar(async () => { ordem.push('l1'); await comum.promessa }, { lento: true })
  const r2 = fila.executar(() => ordem.push('r2'), { chave: 'A' })
  const l2 = fila.executar(() => ordem.push('l2'), { lento: true })
  comum.abrir()
  await l1
  await new Promise(setImmediate)
  check('rápido preso na própria conversa não segura a vaga do lento', ordem.includes('l2') && !ordem.includes('r2'), ordem.join())
  conversa.abrir()
  await Promise.all([r1, r2, l2])
}

{
  // Dentro da mesma classe a urgência continua mandando.
  const fila = criarFila({ limite: 2, vagasRapidas: 1 })
  const bloqueio = porta()
  const ordem = []
  const l1 = fila.executar(async () => { await bloqueio.promessa }, { lento: true })
  const r0 = fila.executar(async () => { await bloqueio.promessa })
  const rBaixa = fila.executar(() => ordem.push('baixa'), { prioridade: 'low' })
  const lAlta = fila.executar(() => ordem.push('lento-alto'), { prioridade: 'very_high', lento: true })
  const rAlta = fila.executar(() => ordem.push('alta'), { prioridade: 'high' })
  bloqueio.abrir()
  await Promise.all([l1, r0, rBaixa, lAlta, rAlta])
  check('entre rápidos, a urgência ordena', ordem.indexOf('alta') < ordem.indexOf('baixa'), ordem.join())
}

{
  const zero = criarFila({ limite: 1, vagasRapidas: 0 })
  check('0 desliga a preferência', zero.estado.vagasRapidas === 0)
  const demais = criarFila({ limite: 2, vagasRapidas: 9 })
  check('nunca acima do limite', demais.estado.vagasRapidas === 2)
  const invalida = criarFila({ limite: 3, vagasRapidas: -1 })
  check('valor inválido cai no padrão', invalida.estado.vagasRapidas === VAGAS_RAPIDAS_PADRAO)
}

// --- as filas da instância ---------------------------------------------------
{
  const filas = criarFilasDeRecursos({ hardware: { comandosSimultaneos: 3, vagasRapidas: 2 } })
  const estado = filas.estado.filas
  check('o socket lê hardware.vagasRapidas', estado.socket.vagasRapidas === 2 && estado.socket.limite === 3)
  check('rede e CPU não têm vaga preferencial', estado.rede.vagasRapidas === 0 && estado.cpu.vagasRapidas === 0)
  const padrao = criarFilasDeRecursos({})
  check('sem configuração, uma vaga preferencial no socket', padrao.estado.filas.socket.vagasRapidas === 1)

  const deduzido = await comContextoDeComando({ priority: 'normal' }, filas, () => lentoDoComando(), { lento: true })
  check('sem rapidez declarada vale a dedução pelo tipo do comando', deduzido === true)
  const declarado = await comContextoDeComando({ priority: 'normal', speed: 'fast' }, filas, () => lentoDoComando(), { lento: true })
  check('rapidez declarada vence a dedução', declarado === false)
  const lentoDeclarado = await comContextoDeComando({ speed: 'slow' }, filas, () => lentoDoComando())
  check('"slow" declarado é lento mesmo num envio curto', lentoDeclarado === true)

  let lento = null
  await comContextoDeComando({ speed: 'slow' }, filas, () => filas.executar('socket', () => { lento = filas.estado.filas.socket.lentosEmCurso }))
  check('o envio dentro do contexto entra no socket como lento', lento === 1)
}

// --- a linguagem -------------------------------------------------------------
check('os números da prioridade batem com os níveis da fila', JSON.stringify(PRIORIDADE_EM_NUMERO) === JSON.stringify(NIVEIS_DA_FILA))
check('"rapidez" tem ajuda no cabeçalho', CAMPOS_DO_CABECALHO.some((c) => c.chave === 'rapidez' && c.ajuda))

const doc = (extra) => `automação t1
  nome: Teste
  tipo: comando
  dispara com: /t
  casa: exato
  quem: qualquer um
  acessa: texto
  pool: p1${extra}

  responde "oi"
`
const recusa = (texto) => { try { compilar(texto); return null } catch (e) { return e } }

for (const [numero, codigo] of [['0', 'low'], ['1', 'normal'], ['2', 'high'], ['3', 'very_high']]) {
  check(`prioridade: ${numero} vira ${codigo}`, compilar(doc(`\n  prioridade: ${numero}`)).scheduling.priority === codigo)
}
check('prioridade: 4 é recusada', recusa(doc('\n  prioridade: 4')) instanceof ErroDeSintaxe)

const rapido = compilar(doc('\n  rapidez: 1'))
const lentoDoc = compilar(doc('\n  rapidez: 0'))
check('rapidez: 1 vira fast', rapido.scheduling.speed === 'fast')
check('rapidez: 0 vira slow', lentoDoc.scheduling.speed === 'slow')
check('as palavras também valem', compilar(doc('\n  rapidez: lento')).scheduling.speed === 'slow' && compilar(doc('\n  rapidez: rápido')).scheduling.speed === 'fast')
const erro = recusa(doc('\n  rapidez: 2'))
check('rapidez: 2 é recusada dizendo o que aceita', erro instanceof ErroDeSintaxe && /rápido, lento/.test(erro.message), erro?.message)
check('sem a linha, nada é declarado (o gateway deduz)', compilar(doc('')).scheduling.speed === undefined)
const errosDoSchema = validarAutomacao({ ...lentoDoc, revision: 1 })
check('o documento com rapidez passa no schema', errosDoSchema.length === 0, JSON.stringify(errosDoSchema))
const texto = descompilar(lentoDoc)
check('volta como "rapidez: lento"', texto.includes('  rapidez: lento'))
check('ida e volta preserva a rapidez', compilar(texto).scheduling.speed === 'slow')
check('sem declarar, a volta não inventa a linha', !descompilar(compilar(doc(''))).includes('rapidez'))

console.log(`\n${checagens} checagens da vaga preferencial, zero falhas.`)
