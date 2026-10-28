// A carga entra pelos mesmos listeners da conexão, sem rede nem conta real.
// Portas controladas tornam a lentidão determinística: não dependemos de a
// máquina conseguir completar uma tarefa dentro de um intervalo apertado.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHook } from 'node:async_hooks'
import http from 'node:http'
import fs from 'node:fs'
import { criarFila } from '../src/engine/fila.js'
import { criarAdmissaoDeEventos, registrarEntradaDeEventos } from '../src/connection.js'
import { chatIdDoEvento, construirEventoDeMensagem, construirEventoDeGrupo, construirEventoDeIndisponivel } from '../src/engine/zapoAdapter.js'
import * as groupInfo from '../src/engine/groupInfo.js'
import { criarClienteEngine } from '../src/engine/client.js'
import { enviarEventoAoMotor } from '../src/engine/gatewaySink.js'
import * as state from '../src/state.js'
import { ARQ_ESTADO } from '../src/paths.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }
const volta = () => new Promise((r) => setImmediate(r))
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const porta = () => {
  let abrir
  const promessa = new Promise((r) => { abrir = r })
  return { promessa, abrir }
}
const mensagem = (grupo, numero) => ({
  key: { id: String(numero), remoteJid: grupo, isGroup: true, fromMe: true },
  message: { conversation: String(numero) }, timestampSeconds: 1700000000
})
function entrada ({ hardware = {}, encaminhar, invalidarGrupo, clienteEngine = {}, client = new EventEmitter() } = {}) {
  const cfg = { hardware: { admissaoConcorrencia: 8, maxPendentes: 512, admissaoLogJanelaMs: 20, ...hardware } }
  const logs = []
  const registrar = (texto) => logs.push({ texto, instante: performance.now() })
  const admissao = criarAdmissaoDeEventos(cfg, { registrar })
  registrarEntradaDeEventos(client, clienteEngine, {
    admissao, obterContexto: () => ({ cfg, accountId: 'teste-admissao' }),
    registrar, encaminhar, invalidarGrupo
  })
  return { client, admissao, logs }
}

{
  let violou = false
  const fila = criarFila({ limite: 4, maxPendentes: 32, aoMudar: (e) => { violou ||= e.emCurso > 4 || e.esperando > 32 } })
  let executadas = 0
  let promessasRecusadas = 0
  let recusadas = 0
  let contandoRecusa = false
  const hook = createHook({ init: (_, tipo) => { if (contandoRecusa && tipo === 'PROMISE') promessasRecusadas++ } }).enable()
  const admitidas = []
  try {
    for (let i = 0; i < 10000; i++) {
      contandoRecusa = i >= 36
      const trabalho = fila.tentarExecutar(() => ++executadas, { chave: `grupo-${i % 50}` })
      if (trabalho) admitidas.push(trabalho)
      else recusadas++
    }
  } finally { hook.disable() }
  check('10 mil tarefas instantâneas reservam no máximo 4 vagas e 32 pendências', !violou && fila.estado.picoPendentes === 32 && fila.estado.emCurso === 4)
  check('9.964 recusas não criam promessas nem executam tarefas', recusadas === 9964 && promessasRecusadas === 0 && executadas === 0)
  await Promise.all(admitidas)
  check('as 36 admitidas terminam e removem todas as chaves', executadas === 36 && fila.estado.chavesAtivas === 0)
}

{
  let contador = 0
  const saida = []
  const { client, admissao } = entrada({ encaminhar: async (_c, _m, evento) => {
    const anterior = contador
    await volta()
    contador = anterior + 1
    saida.push(Number(evento.message.text))
  } })
  for (let i = 0; i < 500; i++) client.emit('message', mensagem('mesmo@g.us', i))
  check('500 eventos no mesmo grupo ocupam uma vaga, sem iniciar o motor no listener', admissao.estado.emCurso === 1 && admissao.estado.esperando === 499 && contador === 0)
  await admissao.encerrar()
  check('500 incrementos com leitura assíncrona preservam ordem e não perdem atualização', contador === 500 && saida.every((valor, i) => valor === i))
  check('a esteira do grupo é removida ao esvaziar', admissao.estado.chavesAtivas === 0 && admissao.estado.esperando === 0)
}

{
  const bloqueio = porta()
  const emCurso = new Set()
  const ordens = new Map()
  let pico = 0
  let cruzou = false
  const { client, admissao } = entrada({ encaminhar: async (_c, _m, evento) => {
    const chave = evento.chat.id
    cruzou ||= emCurso.has(chave)
    emCurso.add(chave)
    pico = Math.max(pico, emCurso.size)
    await bloqueio.promessa
    await volta()
    const valores = ordens.get(chave) || []
    valores.push(Number(evento.message.text))
    ordens.set(chave, valores)
    emCurso.delete(chave)
  } })
  // Dez eventos consecutivos por grupo revelam a fila que ocupa vagas globais
  // esperando uma chave: o segundo grupo precisa começar antes de liberar o primeiro.
  for (let g = 0; g < 50; g++) {
    for (let i = 0; i < 10; i++) client.emit('message', mensagem(`${g}@g.us`, i))
  }
  await volta()
  check('500 eventos em 50 grupos usam as oito vagas sem bloquear atrás de um grupo', pico === 8 && emCurso.size === 8 && admissao.estado.esperando === 492)
  bloqueio.abrir()
  await admissao.encerrar()
  check('os 50 grupos avançam em paralelo, com ordem estrita dentro de cada um', !cruzou && ordens.size === 50 && [...ordens.values()].every((v) => v.length === 10 && v.every((n, i) => n === i)))
  check('o mapa dos 50 grupos volta a zero', admissao.estado.chavesAtivas === 0)
}

{
  const fila = criarFila({ limite: 16, maxPendentes: 64 })
  let maiorMapa = 0
  for (let lote = 0; lote < 100; lote++) {
    const trabalhos = Array.from({ length: 64 }, (_, i) => fila.executar(() => i, { chave: `conversa-${lote}-${i}` }))
    maiorMapa = Math.max(maiorMapa, fila.estado.chavesAtivas)
    await Promise.all(trabalhos)
    assert.equal(fila.estado.chavesAtivas, 0)
  }
  check('6.400 conversas distintas não acumulam esteiras entre lotes', maiorMapa === 64 && fila.estado.chavesAtivas === 0)
}

{
  const bloqueio = porta()
  let chamadas = 0
  let leuConteudo = 0
  const { client, admissao, logs } = entrada({
    hardware: { admissaoConcorrencia: 3, maxPendentes: 7 },
    clienteEngine: { eventos: { enviar: async () => { chamadas++; await bloqueio.promessa; return { results: [] } } } }
  })
  for (let i = 0; i < 10000; i++) {
    const event = mensagem(`${i}@g.us`, i)
    Object.defineProperty(event, 'message', { get () { leuConteudo++; return { conversation: String(i) } } })
    client.emit('message', event)
    assert.ok(admissao.estado.esperando <= 7)
  }
  await volta()
  check('motor lento limita 10 mil entradas a três chamadas e sete eventos esperando', chamadas === 3 && admissao.estado.emCurso === 3 && admissao.estado.esperando === 7 && admissao.estado.recusas === 9990)
  // DUAS leituras por evento ADMITIDO, e nenhuma pelos outros 9.997.
  //
  // O que esta linha guarda é que recusado e pendente não são tocados — e são
  // 9.997 contra 6. As duas leituras do admitido são deliberadas: a primeira
  // procura uma enquete recém-criada (é só na criação que os nomes das opções
  // passam em claro), a segunda monta o evento canônico. Se este número subir
  // de novo, alguém pôs trabalho no caminho de entrada; se ele passar a
  // crescer com o total de eventos, a admissão deixou de proteger.
  check('recusadas e pendentes ainda não tiveram conteúdo canônico construído', leuConteudo === 6, String(leuConteudo))
  const drenagem = admissao.encerrar()
  let drenou = false
  drenagem.then(() => { drenou = true })
  client.emit('message', mensagem('depois-do-fim@g.us', 10000))
  await volta()
  check('desligamento recusa novo trabalho enquanto espera os admitidos', !drenou && admissao.estado.encerrada && admissao.estado.recusas === 9991)
  check('encerrar é idempotente', admissao.encerrar() === drenagem)
  bloqueio.abrir()
  await drenagem
  check('drenagem termina todas as dez cadeias e limpa vagas, espera e mapa', chamadas === 10 && leuConteudo === 20 && admissao.estado.emCurso === 0 && admissao.estado.esperando === 0 && admissao.estado.chavesAtivas === 0)
  check('a última rajada publica resumos com quantidade, fila e janela', logs.reduce((soma, l) => soma + Number(l.texto.match(/recusados=(\d+)/)?.[1]), 0) === 9991 && logs.every((l) => /fila admissao: recusados=\d+, expirados=0, totalRecusados=\d+, janela=.+\.\..+/.test(l.texto)))
}

{
  const bloqueio = porta()
  const ordem = []
  const { client, admissao } = entrada({
    invalidarGrupo: (chave) => ordem.push(`invalidou:${chave}`),
    encaminhar: async (_c, _m, evento) => {
      const tipo = evento.group?.action || evento.message.text
      ordem.push(`inicio:${tipo}`)
      if (tipo === 'primeira') await bloqueio.promessa
      ordem.push(`fim:${tipo}`)
    }
  })
  client.emit('message', { ...mensagem('misto@g.us', 0), message: { conversation: 'primeira' } })
  await volta()
  const retorno = client.listeners('group')[0]({ chatJid: 'misto@g.us', action: 'promote', participants: [] })
  client.emit('message', { ...mensagem('misto@g.us', 1), message: { conversation: 'segunda' } })
  check('o listener retorna sem promessa e invalida antes de admitir o evento de grupo', retorno === undefined && ordem.join(',') === 'inicio:primeira,invalidou:misto@g.us' && admissao.estado.esperando === 2)
  bloqueio.abrir()
  await admissao.encerrar()
  check('mensagens e eventos de grupo compartilham a mesma esteira', ordem.join(',') === 'inicio:primeira,invalidou:misto@g.us,fim:primeira,inicio:promote,fim:promote,inicio:segunda,fim:segunda')
}

{
  groupInfo.limparTudo()
  const client = new EventEmitter()
  let consultas = 0
  client.group = { queryGroupMetadata: async () => ({ subject: `versao-${++consultas}`, participants: [] }) }
  client.message = { send: () => assert.fail('Recusa nunca envia aviso na conversa') }
  const grupo = 'cache@g.us'
  await groupInfo.obter(client, grupo)
  const bloqueio = porta()
  const { admissao, logs } = entrada({ client, hardware: { admissaoConcorrencia: 1, maxPendentes: 0 }, encaminhar: () => bloqueio.promessa })
  client.emit('message', mensagem('ocupado@g.us', 0))
  client.emit('group', { groupJid: grupo, action: 'demote', participants: [] })
  const atualizado = await groupInfo.obter(client, grupo)
  check('evento de grupo recusado ainda invalida imediatamente o cache real', consultas === 2 && atualizado.name === 'versao-2' && admissao.estado.recusas === 1)
  client.emit('message_unavailable', { key: { remoteJid: 'indisponivel@g.us', isGroup: true } })
  check('indisponíveis também obedecem à admissão, sem abrir caminho paralelo', admissao.estado.recusas === 2 && admissao.estado.esperando === 0)
  bloqueio.abrir()
  await admissao.encerrar()
  check('recusa não responde no WhatsApp e registra mesmo com debug desligado', logs.length === 1 && /recusados=2/.test(logs[0].texto))
  groupInfo.limparTudo()
}

{
  const bloqueio = porta()
  const enviados = []
  const client = new EventEmitter()
  client.message = { send: async (_jid, conteudo) => { enviados.push(conteudo.text); await bloqueio.promessa; return { key: { id: 'resposta' } } } }
  let chamadas = 0
  let confirmacoes = 0
  const { admissao } = entrada({ client, clienteEngine: {
    eventos: { enviar: async (evento) => {
      chamadas++
      return { results: [{ commands: [{ id: evento.eventId, status: 'pending', commandType: 'whatsapp.reply', payload: { chatId: evento.chat.id, text: evento.message.text } }] }] }
    } },
    execucoes: { confirmar: async () => { confirmacoes++ } }
  } })
  client.emit('message', mensagem('envio@g.us', 0))
  client.emit('message', mensagem('envio@g.us', 1))
  await volta()
  check('a vaga cobre também a execução do comando depois da resposta do motor', chamadas === 1 && enviados.join(',') === '0' && confirmacoes === 0)
  bloqueio.abrir()
  await admissao.encerrar()
  check('segundo evento só avança depois do envio e da confirmação do primeiro', chamadas === 2 && enviados.join(',') === '0,1' && confirmacoes === 2)
}

{
  const evento = { key: { remoteJid: 'alias@lid', remoteJidAlt: '5511@s.whatsapp.net', fromMe: true }, message: { conversation: 'teste' } }
  check('a chave de admissão usa o chat canônico com preferência pelo telefone', chatIdDoEvento(evento) === construirEventoDeMensagem(evento, { accountId: 'teste' }).chat.id && chatIdDoEvento(evento) === '5511@s.whatsapp.net')
  const recebidoEmMs = 1700000000000
  const contexto = { accountId: 'teste', recebidoEmMs }
  const grupo = construirEventoDeGrupo({ groupJid: 'tempo@g.us', action: 'add', participants: [] }, contexto)
  const comHorario = construirEventoDeGrupo({ groupJid: 'tempo@g.us', action: 'add', participants: [], timestampSeconds: recebidoEmMs / 1000 }, contexto)
  check('espera não muda horário nem identidade de eventos sem timestamp do provedor', [construirEventoDeMensagem(evento, contexto), construirEventoDeIndisponivel(evento, contexto), grupo].every((e) => e.receivedAtMs === recebidoEmMs && e.occurredAt === new Date(recebidoEmMs).toISOString()) && grupo.eventId === comHorario.eventId)
  const fila = criarFila({ limite: 3, maxPendentes: 3 })
  const bloqueio = porta()
  const ordem = []
  const primeira = fila.executar(() => bloqueio.promessa, { chave: 'a' })
  const segunda = fila.executar(() => ordem.push('segunda'), { chave: 'a', prioridade: 'low' })
  const terceira = fila.executar(() => ordem.push('terceira'), { chave: 'a', prioridade: 'very_high' })
  const outra = fila.executar(() => ordem.push('outra'), { chave: 'b' })
  await outra
  check('chave ocupada não consome outra vaga global', ordem.join(',') === 'outra')
  bloqueio.abrir()
  await Promise.all([primeira, segunda, terceira])
  check('urgência não permite ultrapassar antecessor admitido da mesma chave', ordem.join(',') === 'outra,segunda,terceira')
  const falhou = fila.executar(() => { throw new Error('falha isolada') }, { chave: 'a' }).catch((e) => e)
  const seguinte = fila.executar(() => 'continuou', { chave: 'a' })
  check('falha síncrona devolve a esteira e a vaga', (await falhou).message === 'falha isolada' && await seguinte === 'continuou' && fila.estado.chavesAtivas === 0)
  const drenagem = fila.encerrar()
  const erro = await fila.executar(() => assert.fail('Não inicia'), { chave: 'nova' }).catch((e) => e)
  await drenagem
  check('fila encerrada recusa com código determinístico e sem guardar chave', erro.code === 'LCN_SEM_VAGA' && erro.motivo === 'encerrada' && fila.estado.chavesAtivas === 0)
}

{
  const fila = criarFila({ limite: 1, maxPendentes: 1, esperaMaximaMs: 20 })
  const bloqueio = porta()
  const primeira = fila.executar(() => bloqueio.promessa, { chave: 'ativa' })
  const baixa = fila.executar(() => assert.fail('Deslocada não começa'), { chave: 'deslocada', prioridade: 'low' }).catch((e) => e)
  const alta = fila.executar(() => assert.fail('Expirada não começa'), { chave: 'expirada', prioridade: 'high' }).catch((e) => e)
  check('deslocamento remove a esteira que perdeu sua última pendência', (await baixa).motivo === 'deslocada' && fila.estado.chavesAtivas === 2)
  await esperar(40)
  check('expiração remove a esteira que nunca chegou a executar', (await alta).code === 'LCN_TIMEOUT' && fila.estado.chavesAtivas === 1 && fila.estado.esperando === 0)
  bloqueio.abrir()
  await primeira
  await fila.encerrar()
  check('drenagem após deslocamento e expiração termina com mapa vazio', fila.estado.chavesAtivas === 0)
}

{
  const bloqueio = porta()
  const { client, admissao, logs } = entrada({ hardware: { admissaoConcorrencia: 1, maxPendentes: 0, admissaoLogJanelaMs: 30 }, encaminhar: () => bloqueio.promessa })
  client.emit('message', mensagem('ativa@g.us', 0))
  for (let i = 0; i < 30; i++) client.emit('message', mensagem('recusada@g.us', i))
  check('trinta recusas não geram trinta linhas de log', logs.length === 0)
  await esperar(50)
  check('rajada isolada publica o resumo mesmo sem chegadas posteriores', logs.length === 1 && /recusados=30/.test(logs[0].texto))
  for (let i = 0; i < 20; i++) client.emit('message', mensagem('recusada@g.us', i))
  check('nova rajada aguarda a próxima janela', logs.length === 1)
  bloqueio.abrir()
  await admissao.encerrar()
  check('desligamento conserva intervalo e contagens exatas das duas janelas', logs.length === 2 && /recusados=20, expirados=0, totalRecusados=50/.test(logs[1].texto) && logs[1].instante - logs[0].instante >= 30)
}

{
  const original = http.request
  const abertas = new Set()
  let pico = 0
  let iniciadas = 0
  try {
    // Transporte que só termina quando abortado. Testa o cliente HTTP real
    // sem listen: timeout precisa chegar ao transporte, não só vencer a corrida.
    http.request = (opcoes) => {
      const req = new EventEmitter()
      abertas.add(req)
      pico = Math.max(pico, abertas.size)
      iniciadas++
      req.end = () => {
        assert.ok(opcoes.signal)
        opcoes.signal.addEventListener('abort', () => {
          abertas.delete(req)
          req.emit('error', new Error('transporte abortado'))
        }, { once: true })
      }
      return req
    }
    const cliente = criarClienteEngine()
    const fila = criarFila({ limite: 2, maxPendentes: 18 })
    const resultados = await Promise.all(Array.from({ length: 20 }, (_, i) => fila.executar(() => enviarEventoAoMotor(cliente, { eventId: String(i) }, { timeoutMs: 5 }))))
    await fila.encerrar()
    check('vinte timeouts não acumulam HTTP fora das duas vagas de admissão', iniciadas === 20 && pico === 2 && abertas.size === 0)
    check('cancelar transporte conserva o resultado observável de timeout', resultados.every((r) => !r.ok && /timeout/.test(r.motivo)))

    const falha = new Error('corpo interrompido')
    http.request = (_opcoes, responder) => {
      const req = new EventEmitter()
      req.end = () => queueMicrotask(() => {
        const resposta = new EventEmitter()
        responder(resposta)
        resposta.emit('error', falha)
      })
      return req
    }
    check('corpo HTTP interrompido também libera a promessa do cliente', await cliente.eventos.enviar({}).catch((e) => e) === falha)
  } finally { http.request = original }
}

{
  const backup = fs.existsSync(ARQ_ESTADO) ? fs.readFileSync(ARQ_ESTADO) : null
  const admissao = criarAdmissaoDeEventos()
  const bloqueio = porta()
  try {
    state.registrarFonteDeAdmissao(() => admissao.estado)
    const trabalho = admissao.admitir('telemetria@g.us', () => bloqueio.promessa)
    state.gravar()
    const ativo = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8')).admissao
    bloqueio.abrir()
    await trabalho
    await admissao.encerrar()
    state.gravar()
    const final = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8')).admissao
    check('batimento publica admissão antes do primeiro comando e depois da drenagem', ativo.emCurso === 1 && ativo.chavesAtivas === 1 && final.emCurso === 0 && final.chavesAtivas === 0 && final.encerrada)
    check('telemetria publica contadores sem guardar endereços das conversas', !JSON.stringify({ ativo, final }).includes('telemetria@g.us'))
  } finally {
    bloqueio.abrir()
    await admissao.encerrar()
    state.registrarFonteDeAdmissao(null)
    if (backup) fs.writeFileSync(ARQ_ESTADO, backup)
    else fs.rmSync(ARQ_ESTADO, { force: true })
  }
}

{
  const padrao = criarAdmissaoDeEventos()
  check('padrões finitos: oito cadeias, 256 pendências e log a cada cinco segundos', padrao.estado.limite === 8 && padrao.estado.maxPendentes === 256 && padrao.estado.logJanelaMs === 5000)
  const grande = criarAdmissaoDeEventos({ hardware: { admissaoConcorrencia: 64, maxPendentes: 9000, admissaoLogJanelaMs: 15000 } })
  check('concorrência, capacidade e janela aceitam valores acima dos padrões', grande.estado.limite === 64 && grande.estado.maxPendentes === 9000 && grande.estado.logJanelaMs === 15000)
  const invalida = criarAdmissaoDeEventos({ hardware: { admissaoConcorrencia: 0, maxPendentes: -1, admissaoLogJanelaMs: NaN } })
  check('configuração inválida volta a padrões seguros', invalida.estado.limite === 8 && invalida.estado.maxPendentes === 256 && invalida.estado.logJanelaMs === 5000)
  await Promise.all([padrao.encerrar(), grande.encerrar(), invalida.encerrar()])
}

console.log(`\n${checagens} checagens de admissão, zero falhas.`)
