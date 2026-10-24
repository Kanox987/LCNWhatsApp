import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { criarFila, AGING_MS_PADRAO, MAX_PENDENTES_PADRAO } from '../src/engine/fila.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }
const porta = () => { let abrir; const promessa = new Promise((r) => { abrir = r }); return { promessa, abrir } }
const capturar = (promessa) => promessa.catch((erro) => erro)
const volta = () => new Promise(setImmediate)

{
  const fila = criarFila({ limite: 1 })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa)
  const ordem = []
  const tarefas = ['low', 'normal', 'high', 'very_high', 'normal', 'high'].map((prioridade, i) =>
    fila.executar(() => ordem.push(i), { prioridade }))
  bloqueio.abrir()
  await Promise.all([primeira, ...tarefas])
  check('quatro prioridades ordenam, com FIFO dentro de cada nível', ordem.join() === '3,2,5,1,4,0')
  check('conclusão devolve todas as vagas antes de resolver a promessa', fila.estado.emCurso === 0 && fila.estado.esperando === 0)
}

{
  let agora = 0
  const fila = criarFila({ limite: 1, agingMs: 10, agora: () => agora })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa)
  const ordem = []
  const antiga = fila.executar(() => ordem.push('antiga'), { prioridade: 'low' })
  agora = 30
  const nova = fila.executar(() => ordem.push('nova'), { prioridade: 'very_high' })
  bloqueio.abrir()
  await Promise.all([primeira, antiga, nova])
  check('envelhecimento empata baixa antiga com muito alta nova e preserva a antiga', ordem.join() === 'antiga,nova')
  check('espera é medida no mesmo relógio do envelhecimento', fila.estado.esperaTotalMs === 30 && fila.estado.esperaMaximaMs === 30)
}

{
  let agora = 0
  const fila = criarFila({ limite: 1, maxPendentes: 2, agingMs: 10, agora: () => agora })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa)
  const ordem = []
  const antiga = fila.executar(() => ordem.push('antiga'), { prioridade: 'low' })
  let anterior = bloqueio
  const urgentes = []
  // Sempre há outra urgente esperando ANTES de liberar a que está ativa.
  // Sem envelhecimento, a baixa não passa enquanto essas chegadas continuam.
  for (let i = 0; i < 4; i++) {
    agora = i * 10
    const proxima = porta()
    urgentes.push(fila.executar(async () => { ordem.push(`urgente-${i}`); await proxima.promessa }, { prioridade: 'very_high' }))
    anterior.abrir()
    await volta()
    anterior = proxima
  }
  anterior.abrir()
  await Promise.all([primeira, antiga, ...urgentes])
  check('baixa antiga termina apesar de chegadas urgentes contínuas', ordem.join() === 'urgente-0,urgente-1,urgente-2,antiga,urgente-3')
}

{
  const fila = criarFila({ limite: 1, maxPendentes: 3 })
  const bloqueio = porta()
  let terminou = false
  const primeira = fila.executar(async () => { await bloqueio.promessa; terminou = true })
  const ordem = []
  const alta = fila.executar(() => ordem.push('alta'), { prioridade: 'high' })
  const baixaAntiga = fila.executar(() => ordem.push('baixa-antiga'), { prioridade: 'low' })
  const baixaNova = capturar(fila.executar(() => ordem.push('baixa-nova'), { prioridade: 'low' }))
  const urgente = fila.executar(() => ordem.push('urgente'), { prioridade: 'very_high' })
  const recusada = await baixaNova
  check('desloca a pior pendente, usando a mais nova no empate', recusada.code === 'LCN_SEM_VAGA' && recusada.motivo === 'deslocada')
  check('recusa carrega recurso e prioridade da vítima', recusada.recurso === 'execucao' && recusada.prioridade === 'low')
  check('nenhuma tarefa em curso é interrompida pela urgência', !terminou && fila.estado.emCurso === 1 && ordem.length === 0)
  check('deslocamento não excede maxPendentes nem por uma admissão', fila.estado.esperando === 3 && fila.estado.picoPendentes === 3)
  bloqueio.abrir()
  await Promise.all([primeira, alta, baixaAntiga, urgente])
  check('vítima nunca começa e as restantes preservam a ordem de urgência', terminou && ordem.join() === 'urgente,alta,baixa-antiga')
  check('métrica atribui a recusa à vítima', fila.estado.recusasPorPrioridade.low === 1 && fila.estado.deslocadas === 1)
}

{
  let agora = 0
  const fila = criarFila({ limite: 1, maxPendentes: 1, agingMs: 10, agora: () => agora })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa)
  const antiga = fila.executar(() => 'antiga', { prioridade: 'low' })
  agora = 30
  const empate = await capturar(fila.executar(() => assert.fail('Não deve começar'), { prioridade: 'very_high' }))
  agora = 40
  const envelhecida = await capturar(fila.executar(() => assert.fail('Não deve começar'), { prioridade: 'very_high' }))
  check('fila cheia não desloca a antiga em empate efetivo', empate.code === 'LCN_SEM_VAGA' && empate.motivo === 'fila_cheia')
  check('envelhecimento acima da escala protege a antiga de deslocamento', envelhecida.code === 'LCN_SEM_VAGA')
  bloqueio.abrir()
  await Promise.all([primeira, antiga])
}

{
  const fila = criarFila({ limite: 1, maxPendentes: 0 })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa)
  const erro = await capturar(fila.executar(() => assert.fail('Não deve começar'), { prioridade: 'very_high' }))
  check('sem espera configurada recusa antes do início sem preemptar a vaga ativa', erro.code === 'LCN_SEM_VAGA' && fila.estado.emCurso === 1 && fila.estado.esperando === 0)
  bloqueio.abrir()
  await primeira
  check('zero pendentes ainda permite executar quando existe vaga ativa livre', await fila.executar(() => 7) === 7)
}

{
  const fila = criarFila({ limite: 2, maxPendentes: 32 })
  let executadas = 0
  let timers = 0
  const timerOriginal = globalThis.setTimeout
  let resultados
  try {
    globalThis.setTimeout = (...args) => { timers++; return timerOriginal(...args) }
    resultados = Promise.allSettled(Array.from({ length: 10000 }, () => fila.executar(() => ++executadas)))
  } finally { globalThis.setTimeout = timerOriginal }
  const fim = await resultados
  check('10 mil tarefas instantâneas nunca passam de 32 pendentes nem de duas ativas', fila.estado.picoPendentes === 32 && fila.estado.picoEmCurso === 2)
  check('rajada admite 34 e recusa 9966 de forma determinística', executadas === 34 && fim.filter((r) => r.status === 'rejected' && r.reason.code === 'LCN_SEM_VAGA').length === 9966)
  check('recusadas não criam timers: somente as 32 pendentes criam um', timers === 32)
  check('rajada termina limpa e com métricas fechadas', fila.estado.emCurso === 0 && fila.estado.esperando === 0 && fila.estado.recusas === 9966)
}

{
  const contexto = new AsyncLocalStorage()
  const fila = criarFila({ limite: 1 })
  const bloqueio = porta()
  const primeira = contexto.run('primeira', () => fila.executar(() => bloqueio.promessa))
  const segunda = contexto.run('segunda', () => fila.executar(async () => { await volta(); return contexto.getStore() }))
  bloqueio.abrir()
  await primeira
  check('tarefa pendente conserva seu contexto, sem herdar o da tarefa que soltou a vaga', await segunda === 'segunda')
}

{
  const fila = criarFila({ limite: 1, maxPendentes: 1, esperaMaximaMs: 10 })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa)
  const expirada = capturar(fila.executar(() => assert.fail('Expirada não executa')))
  await new Promise((r) => setTimeout(r, 20))
  check('expiração retira pendente e publica estado atualizado', (await expirada).code === 'LCN_TIMEOUT' && fila.estado.esperando === 0 && fila.estado.expiradas === 1)
  const nova = fila.executar(() => 'nova')
  bloqueio.abrir()
  await primeira
  check('vaga da expirada pode ser reutilizada', await nova === 'nova')
}

{
  const fila = criarFila({ limite: 1, maxPendentes: 1, esperaMaximaMs: 10 })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa)
  const velha = capturar(fila.executar(() => {}, { prioridade: 'low' }))
  const urgente = fila.executar(() => {}, { prioridade: 'high' })
  await velha
  bloqueio.abrir()
  await Promise.all([primeira, urgente])
  await new Promise((r) => setTimeout(r, 20))
  check('deslocamento e início limpam os timers de espera', fila.estado.expiradas === 0 && fila.estado.recusas === 1)
}

{
  const fila = criarFila({ limite: 9, maxPendentes: 10000, agingMs: 1000000 })
  check('padrões não são tetos de configuração', fila.estado.limite === 9 && fila.estado.maxPendentes === 10000 && fila.estado.agingMs === 1000000)
  for (const valor of [-1, NaN, Infinity, 'muitas', null]) {
    const invalida = criarFila({ maxPendentes: valor, agingMs: valor })
    check(`configuração inválida ${String(valor)} usa padrões finitos`, invalida.estado.maxPendentes === MAX_PENDENTES_PADRAO && invalida.estado.agingMs === AGING_MS_PADRAO)
  }
  const erro = new Error('Falha original')
  check('falha síncrona conserva o mesmo erro', await capturar(fila.executar(() => { throw erro })) === erro)
  check('fila continua após falha síncrona', await fila.executar(() => 42) === 42)
}

console.log(`\n${checagens} checagens da fila com prioridade, zero falhas.`)
