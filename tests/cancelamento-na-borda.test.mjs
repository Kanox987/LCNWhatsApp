import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { getEventListeners } from 'node:events'
import { criarAdmissaoDeEventos, registrarEntradaDeEventos } from '../src/connection.js'
import { criarFilasDeRecursos, comContextoDeComando, prioridadeDoComando } from '../src/engine/filasDeRecursos.js'
import { sinalDoEvento } from '../src/engine/cancelamento.js'
import { criarExecutorDeConexao } from '../src/engine/conexaoExecutor.js'
import { criarBaixador } from '../src/downloader.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'
import { enviarEventoAoMotor } from '../src/engine/gatewaySink.js'
import { criarClienteEngine } from '../src/engine/client.js'
import { criarOrcamentoDeMidia } from '../src/mediaBudget.js'
import { baixarBuffer } from '../src/visu.js'
import * as bandwidth from '../src/bandwidth.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }
const porta = () => { let abrir; const promessa = new Promise((r) => { abrir = r }); return { promessa, abrir } }
const volta = () => new Promise(setImmediate)
async function ate (condicao) {
  for (let i = 0; i < 1000; i++) { if (condicao()) return; await volta() }
  assert.fail('A condição esperada não chegou.')
}
const capturar = (p) => p.catch((erro) => erro)
const json = (valor) => ({ ok: true, status: 200, json: async () => valor })
function abortavel (signal) {
  return new Promise((_, rejeitar) => {
    const abortar = () => rejeitar(new DOMException('The operation was aborted', 'AbortError'))
    if (signal.aborted) abortar()
    else signal.addEventListener('abort', abortar, { once: true })
  })
}
const cfgDe = (hardware = {}) => ({ hardware: { admissaoConcorrencia: 4, admissaoLogJanelaMs: 1, maxPendentes: 4, comandosSimultaneos: 2, downloadConcorrencia: 2, ...hardware } })
const declaracao = (resposta = { forma: 'texto', campo: 'texto' }, esperaSegundos = 30) => ({
  id: 'servico', endereco: 'https://servico.test', autenticacao: { tipo: 'nenhuma' },
  funcoes: [{ nome: 'consultar', metodo: 'POST', caminho: '/consulta', entradas: [], esperaSegundos, resposta }]
})
const formaTrabalho = {
  forma: 'trabalho', campoDoTrabalho: 'job', caminhoDeAcompanhamento: '/jobs/{job}',
  campoDoEstado: 'estado', estadosEmAndamento: ['baixando'], campoDoResultado: 'midias'
}
const comando = (id, commandType = 'connection.call', payload = {}) => ({
  id, commandType, payload: { chatId: `${id}@g.us`, conexao: 'servico', funcao: 'consultar', text: id, ...payload }
})
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-aborto-'))
const tokenArquivo = path.join(pasta, 'token')
fs.writeFileSync(tokenArquivo, 'token-de-teste')
const cfgDownload = { ...cfgDe(), download: { api: 'https://download.test', tokenArquivo } }

// O histórico passa pela rota e pelo banco reais: capturar só o argumento de
// confirmar deixaria passar um diagnóstico descartado antes de persistir.
const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const instante = new Date().toISOString()
db.prepare("INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES ('teste', 1, 1, 'live', ?, ?)").run(instante, instante)
const revisao = db.prepare("INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES ('teste', 1, 'active', '{}', ?)").run(instante).lastInsertRowid
function registrarComando (c) {
  db.prepare("INSERT INTO inbound_events (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at) VALUES (?, 'conta', 'chat', 'direct', 'pessoa', 'text', 'teste', 0, '{}', ?)").run(c.id, instante)
  const run = db.prepare("INSERT INTO automation_runs (event_id, automation_id, automation_revision_id, deployment_mode, status, created_at) VALUES (?, 'teste', ?, 'live', 'matched_live', ?)").run(c.id, revisao, instante).lastInsertRowid
  db.prepare("INSERT INTO outbound_commands (id, run_id, target_account_id, command_type, payload_json, status, created_at) VALUES (?, ?, 'conta', ?, ?, 'pending', ?)").run(c.id, run, c.commandType, JSON.stringify(c.payload), instante)
  return async () => api.resolver('GET', `/executions/${run}`, contexto())
}
const motor = {
  conexoes: { resolvida: async () => declaracao() },
  execucoes: { confirmar: (id, body) => api.resolver('POST', `/commands/${id}/result`, contexto(body)) }
}
const semEnvio = { message: { send: () => assert.fail('O cancelamento externo não inicia aviso nem envio.') } }

try {
  {
    const admissao = criarAdmissaoDeEventos(cfgDe({ admissaoConcorrencia: 1, maxPendentes: 0 }), { registrar: () => {} })
    const c = comando('recusa')
    const historico = registrarComando(c)
    let signal
    let recusado
    await admissao.admitir('original', async () => {
      const externo = executarComandos(semEnvio, [c], motor, {
        cfg: cfgDe(), mediaRefCache: {}, criarExecutorDeConexao: () => criarExecutorDeConexao({ buscar: (_url, opcoes) => {
          signal = opcoes.signal
          return abortavel(signal)
        } })
      })
      await ate(() => signal)
      // A borda já reserva antes de disparar. Reentrada recusada dentro do
      // evento reproduz a desistência com trabalho externo já em andamento.
      recusado = admissao.admitir('sem-vaga', () => assert.fail('Recusada não inicia'))
      await externo
    })
    await admissao.encerrar()
    check('recusa na admissão aborta HTTP já disparado pelo mesmo evento', recusado === null && signal.aborted)
    const h = await historico()
    check('histórico persiste recusa legível e falha conhecida, sem resultado incerto', h.detail?.motivo === 'recusa_admissao' && /recusa na admissão/.test(h.detail.mensagem) && h.commands.items[0].status === 'failed')
    check('evento encerrado não deixa sinal nem chave retidos', admissao.estado.eventosAtivos === 0 && admissao.estado.chavesAtivas === 0)
  }

  {
    const cfg = cfgDe({ admissaoConcorrencia: 1, maxPendentes: 0 })
    const admissao = criarAdmissaoDeEventos(cfg, { registrar: () => {} })
    const bloqueio = porta()
    let signal
    const ativo = admissao.admitir('ativo', async () => { signal = sinalDoEvento(); await bloqueio.promessa })
    await ate(() => signal)
    for (let i = 0; i < 10000; i++) assert.equal(admissao.admitir(`recusado-${i}`, () => assert.fail()), null)
    check('dez mil entradas novas recusadas não cancelam o evento aceito nem guardam sinais', !signal.aborted && admissao.estado.eventosAtivos === 1)
    bloqueio.abrir()
    await ativo
    await admissao.encerrar()
  }

  {
    const cfg = cfgDe({ admissaoConcorrencia: 2, maxPendentes: 0, downloadConcorrencia: 1 })
    const admissao = criarAdmissaoDeEventos(cfg, { registrar: () => {} })
    const filas = criarFilasDeRecursos(cfg)
    let signal
    let erro
    await admissao.admitir('recusa-de-rede', () => comContextoDeComando({ priority: 'high' }, filas, async () => {
      const executor = criarExecutorDeConexao({ buscar: (_url, o) => { signal = o.signal; return abortavel(signal) } })
      const externo = capturar(executor.executar(declaracao(), 'consultar', {}))
      await ate(() => signal)
      const recusa = await capturar(filas.executar('rede', () => assert.fail('Sem vaga')))
      erro = await externo
      check('recusa de recurso interrompe a leitura irmã do evento com motivo da fila', recusa.code === 'LCN_SEM_VAGA' && erro.code === 'LCN_CANCELADO' && erro.recurso === 'rede')
    }))
    await admissao.encerrar()
  }

  {
    const cfg = cfgDe()
    const admissao = criarAdmissaoDeEventos(cfg, { registrar: () => {} })
    const filas = criarFilasDeRecursos(cfg)
    const client = new EventEmitter()
    const envio = porta(), upload = porta()
    const operacoes = []
    let signal
    const externo = comando('desligamento')
    const enviar = comando('envio', 'whatsapp.reply')
    const subir = comando('upload')
    const pendente = comando('pendente', 'whatsapp.reply')
    const historicos = new Map([externo, enviar, subir, pendente].map((c) => [c.id, registrarComando(c)]))
    client.message = {
      send: async (_jid, conteudo, opcoes) => {
        assert.equal(opcoes?.signal, undefined)
        operacoes.push(`send:${conteudo.text || 'carrossel'}`)
        if (conteudo.text === 'envio') await envio.promessa
        return { id: 'enviado' }
      },
      upload: async (_buffer, opcoes) => {
        assert.equal(opcoes?.signal, undefined)
        operacoes.push('upload')
        await upload.promessa
        return { url: 'https://midia.test', fileLength: 1 }
      }
    }
    registrarEntradaDeEventos(client, motor, {
      admissao, obterContexto: () => ({ cfg, accountId: 'teste' }), registrar: () => {},
      encaminhar: (_c, _m, evento) => {
        const c = [externo, enviar, subir, pendente].find((c) => c.id === evento.message.text)
        return executarComandos(client, [c], motor, {
          cfg, filas, mediaRefCache: {}, criarExecutorDeConexao: () => c.id === 'upload'
            ? { executar: async () => ({ forma: 'carrossel', cards: [{ midia: { buffer: Buffer.from('x'), tipo: 'image', mime: 'image/jpeg' }, corpo: 'teste' }] }) }
            : criarExecutorDeConexao({ buscar: (_url, o) => { signal = o.signal; return abortavel(signal) } })
        })
      }
    })
    const emitir = (id, chat = id) => client.emit('message', { key: { id, remoteJid: `${chat}@g.us`, fromMe: true }, message: { conversation: id } })
    emitir('desligamento'); emitir('envio'); emitir('upload'); emitir('pendente', 'envio')
    await ate(() => signal && operacoes.includes('upload') && operacoes.includes('send:envio'))
    let reentrada
    signal.addEventListener('abort', () => { reentrada = admissao.admitir('reentrada', () => assert.fail('Desligamento já fechou a borda')) }, { once: true })
    let drenou = false
    const drenagem = admissao.encerrar({ cancelarExternos: true })
    drenagem.then(() => { drenou = true })
    await ate(() => signal.aborted)
    await volta()
    check('desligamento aborta externo e mantém send e upload em curso', !drenou && filas.socket.estado.emCurso === 2)
    check('a borda fecha antes de notificar o aborto aos trabalhos externos', reentrada === null)
    check('desligamento é idempotente e ainda recusa novas entradas', admissao.encerrar({ cancelarExternos: true }) === drenagem && admissao.admitir('novo', () => assert.fail()) === null)
    const h = await historicos.get('desligamento')()
    check('histórico registra desligamento legível sem AbortError cego', h.detail?.motivo === 'desligamento' && /desligamento/.test(h.detail.mensagem) && h.commands.failed === 1)
    envio.abrir(); upload.abrir()
    await drenagem
    for (const id of ['envio', 'upload', 'pendente']) {
      const h = await historicos.get(id)()
      check(`${id} drena e confirma sent depois do cancelamento externo`, h.commands.items[0].status === 'sent')
    }
    check('drenagem esvazia todas as filas, sinais e chaves', admissao.estado.eventosAtivos === 0 && admissao.estado.chavesAtivas === 0 && Object.values(filas.estado.filas).every((e) => e.emCurso === 0 && e.esperando === 0 && e.expiradas === 0))
  }

  for (const fase of ['consulta', 'espera', 'corpo']) {
    const admissao = criarAdmissaoDeEventos(cfgDownload, { registrar: () => {} })
    const orcamento = criarOrcamentoDeMidia(1024)
    const chamadas = []
    let chegou = false
    let cancelamentoRemoto, metodoRemoto
    let signalDoPedido
    let resultado
    const baixador = criarBaixador({
      cfg: cfgDownload, orcamento,
      dormir: fase === 'espera' ? async () => { chegou = true; await new Promise(() => {}) } : async () => {},
      buscar: (url, o) => {
        chamadas.push(url)
        if (url.endsWith('/download')) { signalDoPedido = o.signal; return json({ job: 'job/com espaço' }) }
        if (url.endsWith('/cancelar')) { cancelamentoRemoto = o.signal; metodoRemoto = o.method; return json({}) }
        if (url.includes('/jobs/')) {
          if (fase === 'consulta') { chegou = true; return abortavel(o.signal) }
          return json({ estado: 'pronto', midias: [{ url: '/arquivo', tipo: 'video' }] })
        }
        return { ok: true, headers: new Headers({ 'content-length': '128' }), arrayBuffer: () => { chegou = true; return abortavel(o.signal) } }
      }
    })
    const tarefa = admissao.admitir(`download-${fase}`, async () => { resultado = await capturar(baixador.baixar('https://video.test')) })
    await ate(() => chegou)
    if (fase === 'corpo') check('corpo reserva bytes antes do aborto', orcamento.estado().reservados === 128)
    await admissao.encerrar({ cancelarExternos: true })
    await tarefa
    check(`download em ${fase} aborta com motivo da borda`, signalDoPedido.aborted && resultado.code === 'LCN_CANCELADO' && resultado.motivo === 'desligamento')
    check(`download em ${fase} faz um POST remoto com sinal independente e job codificado`, chamadas.filter((u) => u.endsWith('/jobs/job%2Fcom%20espa%C3%A7o/cancelar')).length === 1 && metodoRemoto === 'POST' && cancelamentoRemoto && !cancelamentoRemoto.aborted)
    check(`download em ${fase} libera a reserva e o contexto`, orcamento.estado().reservados === 0 && admissao.estado.eventosAtivos === 0)
  }

  {
    const admissao = criarAdmissaoDeEventos(cfgDownload, { registrar: () => {} })
    const orcamento = criarOrcamentoDeMidia(1024)
    const liberarCancelamento = porta()
    let lendo = false, limpando = false, erro
    const tarefa = admissao.admitir('album-parcial', async () => {
      erro = await capturar(criarBaixador({ cfg: cfgDownload, orcamento, dormir: async () => {}, buscar: async (url, o) => {
        if (url.endsWith('/download')) return json({ job: 'album' })
        if (url.endsWith('/cancelar')) { limpando = true; await liberarCancelamento.promessa; return json({}) }
        if (url.includes('/jobs/')) return json({ estado: 'pronto', midias: [{ url: '/primeira' }, { url: '/segunda' }] })
        return { ok: true, headers: new Headers({ 'content-length': '128' }), arrayBuffer: () => {
          if (url.endsWith('/primeira')) return Buffer.alloc(128)
          lendo = true
          return abortavel(o.signal)
        } }
      } }).baixar('https://album.test'))
    })
    await ate(() => lendo)
    check('álbum parcial mantém a primeira mídia e a reserva da segunda', orcamento.estado().reservados === 256)
    let drenou = false
    const drenagem = admissao.encerrar({ cancelarExternos: true })
    drenagem.then(() => { drenou = true })
    await ate(() => limpando)
    check('aborto devolve o álbum parcial antes de esperar a limpeza remota', orcamento.estado().reservados === 0 && !drenou)
    liberarCancelamento.abrir()
    await Promise.all([tarefa, drenagem])
    check('desligamento aguarda também o POST remoto e preserva seu motivo', erro.motivo === 'desligamento' && orcamento.estado().totalReservados === orcamento.estado().totalLiberados)
  }

  for (const motivo of ['recusa', 'timeout', 'falha-remota']) {
    const admissao = criarAdmissaoDeEventos(cfgDe({ admissaoConcorrencia: 1, maxPendentes: 0 }), { registrar: () => {} })
    const setTimeoutOriginal = globalThis.setTimeout
    const warnOriginal = console.warn
    const logs = []
    let iniciou = false, cancelou = 0, erro, sinalExterno
    try {
      // Encurta só o relógio HTTP existente para exercitar o timeout real sem
      // vinte segundos de espera por caso; o código de produção não muda.
      if (motivo === 'timeout') globalThis.setTimeout = (fn, ms, ...args) => setTimeoutOriginal(fn, ms === 20000 ? 5 : ms, ...args)
      console.warn = (...args) => logs.push(args.join(' '))
      const tarefa = admissao.admitir(`remoto-${motivo}`, async () => {
        sinalExterno = sinalDoEvento()
        const download = capturar(criarBaixador({ cfg: cfgDownload, dormir: async () => {}, buscar: (url, o) => {
          if (url.endsWith('/download')) return json({ job: 'j' })
          if (url.endsWith('/cancelar')) {
            assert.equal(o.signal.aborted, false)
            assert.equal(o.method, 'POST')
            cancelou++
            return motivo === 'falha-remota' ? { ok: false, status: 503 } : json({})
          }
          iniciou = true
          return abortavel(o.signal)
        } }).baixar('https://video.test'))
        await ate(() => iniciou)
        if (motivo === 'recusa') admissao.admitir('recusada', () => assert.fail())
        erro = await download
      })
      await ate(() => iniciou)
      if (motivo === 'falha-remota') await admissao.encerrar({ cancelarExternos: true })
      await tarefa
      await admissao.encerrar()
      check(`${motivo} aciona exatamente um cancelamento remoto`, cancelou === 1)
      if (motivo === 'timeout') check('timeout HTTP do downloader preserva motivo e não aborta o evento inteiro', erro.code === 'LCN_TIMEOUT_EXTERNO' && /timeout após 20000ms/.test(erro.message) && !sinalExterno.aborted)
      else if (motivo === 'recusa') check('recusa da borda chega também ao downloader com diagnóstico legível', erro.motivo === 'recusa_admissao' && /recusa na admissão/.test(erro.message))
      else check('falha do POST remoto fica no log sem substituir motivo original', erro.motivo === 'desligamento' && logs.some((l) => /cancelamento remoto.*503/.test(l)))
    } finally {
      globalThis.setTimeout = setTimeoutOriginal
      console.warn = warnOriginal
    }
  }

  {
    const admissao = criarAdmissaoDeEventos(cfgDe(), { registrar: () => {} })
    let signal, erro
    const tarefa = admissao.admitir('espera-real', async () => {
      signal = sinalDoEvento()
      erro = await capturar(criarExecutorDeConexao({ buscar: async () => json({ job: 'j' }) }).executar(declaracao(formaTrabalho), 'consultar', {}))
    })
    await ate(() => signal && getEventListeners(signal, 'abort').length > 0)
    await admissao.encerrar({ cancelarExternos: true })
    await tarefa
    check('espera real de polling cancela seu timer e remove os listeners', erro.motivo === 'desligamento' && getEventListeners(signal, 'abort').length === 0)
  }

  {
    const admissao = criarAdmissaoDeEventos(cfgDe(), { registrar: () => {} })
    let dormindo = false, chamadas = 0, resultado, signal
    const tarefa = admissao.admitir('job-conexao', async () => {
      signal = sinalDoEvento()
      resultado = await capturar(criarExecutorDeConexao({ buscar: async () => { chamadas++; return json({ job: 'j' }) }, dormir: async () => { dormindo = true; await new Promise(() => {}) } }).executar(declaracao(formaTrabalho), 'consultar', {}))
    })
    await ate(() => dormindo)
    await admissao.encerrar({ cancelarExternos: true })
    await tarefa
    check('espera por job da conexão termina sem outra consulta após desligamento', chamadas === 1 && resultado.motivo === 'desligamento')
    check('espera interrompida retira listener do evento', getEventListeners(signal, 'abort').length === 0)
  }

  {
    const admissao = criarAdmissaoDeEventos(cfgDe(), { registrar: () => {} })
    const c = comando('timeout')
    const historico = registrarComando(c)
    let signalDoEventoAtivo
    const m = { ...motor, conexoes: { resolvida: async () => declaracao(undefined, 0.005) } }
    await admissao.admitir('timeout', async () => {
      signalDoEventoAtivo = sinalDoEvento()
      await executarComandos({ message: { send: async () => ({ id: 'aviso' }) } }, [c], m, {
        mediaRefCache: {}, criarExecutorDeConexao: () => criarExecutorDeConexao({ buscar: (_url, o) => abortavel(o.signal) })
      })
    })
    await admissao.encerrar()
    const h = await historico()
    check('timeout próprio continua funcionando junto do sinal externo', !signalDoEventoAtivo.aborted && h.detail?.motivo === 'timeout' && /timeout após 5ms/.test(h.detail.mensagem))
    check('timeout externo fica failed no histórico, preservando outcome_unknown para envio', h.commands.failed === 1 && h.commands.outcomeUnknown === 0)
  }

  {
    const original = http.request
    const admissao = criarAdmissaoDeEventos(cfgDe(), { registrar: () => {} })
    let iniciou = false, abortou = false, resultado
    try {
      http.request = (o) => {
        const req = new EventEmitter()
        req.end = () => { iniciou = true; o.signal.addEventListener('abort', () => { abortou = true; req.emit('error', new DOMException('The operation was aborted', 'AbortError')) }, { once: true }) }
        return req
      }
      const tarefa = admissao.admitir('motor', async () => { resultado = await enviarEventoAoMotor(criarClienteEngine(), { eventId: 'motor' }) })
      await ate(() => iniciou)
      await admissao.encerrar({ cancelarExternos: true })
      await tarefa
      check('sinal da borda aborta transporte HTTP real do cliente do motor', abortou && !resultado.ok && /desligamento/.test(resultado.motivo))
    } finally { http.request = original }
  }

  {
    const admissao = criarAdmissaoDeEventos(cfgDe(), { registrar: () => {} })
    const filas = criarFilasDeRecursos(cfgDe({ downloadConcorrencia: 1 }))
    const barreira = porta()
    let signal, erro, leituras = 0
    const ocupada = filas.executar('rede', () => barreira.promessa)
    const tarefa = admissao.admitir('esperando-rede', () => comContextoDeComando({ priority: 'high' }, filas, async () => {
      signal = sinalDoEvento()
      erro = await capturar(criarExecutorDeConexao({ buscar: () => { leituras++; return json({ texto: 'ok' }) } }).executar(declaracao(), 'consultar', {}))
    }))
    await ate(() => filas.rede.estado.esperando === 1)
    const drenagem = admissao.encerrar({ cancelarExternos: true })
    await tarefa
    check('cancelar leitura pendente não espera o ocupante de outra conversa', filas.rede.estado.emCurso === 1 && filas.rede.estado.canceladas === 1 && getEventListeners(signal, 'abort').length === 0)
    barreira.abrir()
    await Promise.all([ocupada, tarefa, drenagem])
    check('leitura pendente não começa depois do aborto e devolve sua vaga', signal.aborted && leituras === 0 && erro.code === 'LCN_CANCELADO' && filas.rede.estado.esperando === 0)
  }

  for (const fase of ['rede', 'banda']) {
    const admissao = criarAdmissaoDeEventos(cfgDe(), { registrar: () => {} })
    let signal, erro, leituras = 0
    if (fase === 'banda') bandwidth.configurar({ downloadBytesPerSecond: 1 })
    const tarefa = admissao.admitir(`midia-${fase}`, async () => {
      signal = sinalDoEvento()
      erro = await capturar(baixarBuffer({ message: { downloadBytes: (_node, o) => { leituras++; assert.equal(o.signal, signal); return abortavel(o.signal) } } }, { fileLength: 100 }, 'image', 1024))
    })
    await ate(() => signal && (fase === 'banda' || leituras === 1))
    await admissao.encerrar({ cancelarExternos: true })
    await tarefa
    bandwidth.configurar({ downloadBytesPerSecond: 0 })
    check(`download de mídia interrompe ${fase} com motivo legível`, erro.motivo === 'desligamento' && (fase !== 'banda' || leituras === 0))
  }

  {
    const admissao = criarAdmissaoDeEventos(cfgDe(), { registrar: () => {} })
    const filas = criarFilasDeRecursos(cfgDe({ downloadConcorrencia: 1 }))
    const portaA = porta()
    const sinais = [], prioridades = []
    const a = admissao.admitir('a', () => comContextoDeComando({ priority: 'low' }, filas, () => filas.executar('rede', async () => { sinais.push(sinalDoEvento()); prioridades.push(prioridadeDoComando()); await portaA.promessa })))
    const b = admissao.admitir('b', () => comContextoDeComando({ priority: 'high' }, filas, () => filas.executar('rede', () => { sinais.push(sinalDoEvento()); prioridades.push(prioridadeDoComando()) })))
    await ate(() => filas.rede.estado.esperando === 1)
    portaA.abrir()
    await Promise.all([a, b])
    await admissao.encerrar()
    check('fila preserva sinal e prioridade próprios quando outro evento libera a vaga', sinais.length === 2 && sinais[0] !== sinais[1] && prioridades.join() === 'low,high')
    check('drenagem simples preserva eventos admitidos e remove todos os controles', sinais.every((s) => !s.aborted) && admissao.estado.eventosAtivos === 0)
  }
} finally {
  db.close()
  bandwidth.configurar({ downloadBytesPerSecond: 0 })
  fs.rmSync(pasta, { recursive: true, force: true })
}
console.log(`\n${checagens} checagens de cancelamento na borda, zero falhas.`)
