import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { criarFilasDeRecursos, comContextoDeComando } from '../src/engine/filasDeRecursos.js'
import { executarComandos, obterFilasDoGateway } from '../src/engine/gatewayExecutor.js'
import { criarExecutorDeConexao } from '../src/engine/conexaoExecutor.js'
import { criarBaixador } from '../src/downloader.js'
import { criarOrcamentoDeMidia } from '../src/mediaBudget.js'
import { limitesDeMidia } from '../src/mediaLimits.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }
const porta = () => { let abrir; const promessa = new Promise((r) => { abrir = r }); return { promessa, abrir } }
const volta = () => new Promise(setImmediate)
const capturar = (promessa) => promessa.catch((erro) => erro)
async function esperar (condicao) {
  for (let i = 0; i < 500; i++) { if (condicao()) return; await volta() }
  assert.fail('A condição esperada não chegou.')
}
const cfgDe = (hardware = {}) => ({ hardware: { comandosSimultaneos: 1, downloadConcorrencia: 1, cpuConcorrencia: 1, maxPendentes: 0, ...hardware } })
const comando = (tipo = 'whatsapp.reply', payload = {}, id = 'c') => ({ id, commandType: tipo, payload: { chatId: 'conversa', text: id, ...payload } })
const scheduling = (priority = 'normal', kind = 'discard') => ({ priority, onNoSlot: { kind, text: 'Tá cheio agora.' } })
function mocks () {
  const envios = [], confirmacoes = []
  return {
    envios, confirmacoes,
    client: { message: { send: async (...args) => { envios.push(args); return { id: 'enviada' } } } },
    motor: { execucoes: { confirmar: async (id, body) => { confirmacoes.push({ id, ...body }) } } }
  }
}
function ocupar (filas, recurso) {
  const bloqueio = porta()
  const tarefa = filas.executar(recurso, () => bloqueio.promessa)
  return async () => { bloqueio.abrir(); await tarefa }
}
const json = (body) => ({ ok: true, status: 200, json: async () => body })
const declaracao = (resposta = { forma: 'texto', campo: 'texto' }) => ({
  id: 'servico', endereco: 'https://servico.exemplo', autenticacao: { tipo: 'nenhuma' },
  funcoes: [{ nome: 'f', metodo: 'POST', caminho: '/f', entradas: [], resposta }]
})
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-filas-'))
const tokenArquivo = path.join(pasta, 'token')
fs.writeFileSync(tokenArquivo, 'segredo-de-teste')
const cfgDownload = { ...cfgDe({ maxPendentes: 3 }), download: { api: 'https://servico.exemplo', tokenArquivo } }
const avisos = []
const warn = console.warn
console.warn = (...args) => { avisos.push(args.join(' ')) }

try {
  {
    const filas = criarFilasDeRecursos(cfgDe())
    check('todas as filas têm espera limitada e concorrência independente', ['socket', 'rede', 'cpu'].every((r) => filas[r].estado.maxPendentes === 0 && filas[r].estado.limite === 1))
    const liberar = await ocupar(filas, 'rede')
    check('rede cheia não ocupa socket ou CPU', await filas.executar('socket', () => 'socket') === 'socket' && await filas.executar('cpu', () => 'cpu') === 'cpu')
    const erro = await capturar(filas.executar('rede', () => assert.fail('Não deve começar'), { prioridade: 'high' }))
    check('API genérica recusa por recurso e prioridade', erro.code === 'LCN_SEM_VAGA' && filas.estado.filas.rede.recusasPorPrioridade.high === 1)
    await liberar()
    const grandes = criarFilasDeRecursos(cfgDe({ comandosSimultaneos: 8, downloadConcorrencia: 12, cpuConcorrencia: 4, maxPendentes: 9000, agingMs: 75000 }))
    check('todos os knobs aceitam valores acima do padrão', grandes.socket.estado.limite === 8 && grandes.rede.estado.limite === 12 && grandes.cpu.estado.limite === 4 && grandes.cpu.estado.maxPendentes === 9000 && grandes.rede.estado.agingMs === 75000)
    check('downloadConcorrencia vem de limitesDeMidia', limitesDeMidia(cfgDe({ downloadConcorrencia: 12 })).downloadConcorrencia === 12)
    const a = {}, b = {}
    check('cada cliente mantém suas próprias filas', obterFilasDoGateway(a, cfgDe()).socket !== obterFilasDoGateway(b, cfgDe()).socket)
    check('reconfiguração não substitui fila viva', obterFilasDoGateway(a, cfgDe({ comandosSimultaneos: 8 })).socket.estado.limite === 1)
  }

  for (const kind of ['discard', 'notify', 'retry']) {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe())
    const liberar = ocupar(filas, 'socket')
    await executarComandos(m.client, [comando('whatsapp.reply', { scheduling: scheduling('low', kind) })], m.motor, { filas, mediaRefCache: {} })
    const c = m.confirmacoes[0]
    check(`${kind}: recusa chega como failed e registra o motivo original`, c.status === 'failed' && c.detail.code === 'LCN_SEM_VAGA' && c.detail.recurso === 'socket' && c.detail.motivo === 'fila_cheia')
    check(`${kind}: não há envio que burle a fila`, m.envios.length === 0)
    check(`${kind}: métrica do comando registra uma única recusa`, filas.estado.recusasDeComandos.socket.low === 1)
    if (kind === 'notify') {
      check('aviso recusado não esconde a recusa original', c.detail.aviso === 'recusado' && c.detail.codigoDoAviso === 'LCN_SEM_VAGA')
      check('aviso recusado só tenta uma vez e usa a mesma prioridade', filas.socket.estado.recusas === 2 && filas.socket.estado.recusasPorPrioridade.low === 2 && filas.estado.avisos.recusados === 1)
      check('log registra aviso recusado e preserva o erro original', avisos.some((s) => s.includes('Aviso de LCN_SEM_VAGA recusado') && s.includes('erro original preservado')))
    } else {
      check(`${kind}: encerra sem aviso nem segunda admissão`, filas.socket.estado.recusas === 1 && !c.detail.aviso && c.detail.decisao === 'discard')
    }
    if (kind === 'retry') check('retry inválido é registrado como violação do compilador', filas.estado.politicasInvalidas === 1 && avisos.some((s) => s.includes('(retry)') && s.includes('compilador deveria ter barrado')))
    await liberar()
  }

  // Exercita o downloader real: a recusa no HTTP precisa atravessar os catches
  // de tradução e o avisador legado sem virar um segundo aviso.
  for (const falhaDoAviso of [false, true]) {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe())
    if (falhaDoAviso) m.client.message.send = async (...args) => { m.envios.push(args); throw new Error('Socket indisponível') }
    const liberar = ocupar(filas, 'rede')
    let buscou = false
    await executarComandos(m.client, [comando('media.download', { url: 'https://video.exemplo', scheduling: scheduling('high', 'notify'), errorText: 'ERRO LEGADO' })], m.motor, {
      filas, cfg: cfgDownload, mediaRefCache: {},
      criarBaixador: (opcoes) => criarBaixador({ ...opcoes, buscar: async () => { buscou = true; assert.fail('Não deve buscar') } })
    })
    const c = m.confirmacoes[0]
    check(`aviso ${falhaDoAviso ? 'falha' : 'sai'}: recusa HTTP não é traduzida nem vira incerta`, c.status === 'failed' && c.detail.code === 'LCN_SEM_VAGA' && c.detail.recurso === 'rede' && !buscou)
    check(`aviso ${falhaDoAviso ? 'falha' : 'sai'}: apenas o texto de sem vaga foi tentado`, m.envios.length === 1 && m.envios[0][1].text === 'Tá cheio agora.')
    check(`aviso ${falhaDoAviso ? 'falha' : 'sai'}: resultado e métrica são observáveis`, c.detail.aviso === (falhaDoAviso ? 'falhou' : 'enviado') && filas.estado.avisos[falhaDoAviso ? 'falharam' : 'enviados'] === 1)
    await liberar()
  }

  {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe())
    const liberarRede = ocupar(filas, 'rede'), liberarSocket = ocupar(filas, 'socket')
    await executarComandos(m.client, [comando('whatsapp.recover', { mediaRef: 'r', destinationId: 'destino', scheduling: scheduling('very_high', 'notify') })], m.motor, {
      filas, mediaRefCache: { resolver: () => ({ node: {}, tipo: 'image' }) }, baixarBuffer: () => assert.fail('Não deve baixar')
    })
    check('recusa do aviso em outro recurso conserva o recurso da falha original', m.confirmacoes[0].detail.recurso === 'rede' && m.confirmacoes[0].detail.aviso === 'recusado' && filas.socket.estado.recusasPorPrioridade.very_high === 1)
    await liberarRede(); await liberarSocket()
  }

  for (const tipo of ['whatsapp.menu', 'whatsapp.rich', 'whatsapp.webview', 'media.download', 'connection.call']) {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe())
    m.motor.conexoes = { resolvida: async () => ({}) }
    const liberar = ocupar(filas, 'socket')
    await executarComandos(m.client, [comando(tipo, { items: [], fallbackText: 'reserva', ackText: 'começando', url: 'https://exemplo', scheduling: scheduling() })], m.motor, {
      filas, mediaRefCache: {}, clienteEngine: m.motor,
      criarBaixador: () => assert.fail('ACK recusado deve encerrar'), criarExecutorDeConexao: () => assert.fail('ACK recusado deve encerrar')
    })
    check(`${tipo}: recusa não vira fallback nem continua depois do ACK`, m.confirmacoes[0].status === 'failed' && filas.socket.estado.recusas === 1 && m.envios.length === 0)
    await liberar()
  }

  {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe({ maxPendentes: 1 }))
    const bloqueio = porta(), ordem = []
    m.client.message.send = async (_jid, c) => { ordem.push(c.text); if (c.text === 'ativa') await bloqueio.promessa; return { id: c.text } }
    const executar = (id, prioridade) => executarComandos(m.client, [comando('whatsapp.reply', { scheduling: scheduling(prioridade) }, id)], m.motor, { filas, mediaRefCache: {} })
    const ativa = executar('ativa', 'normal')
    await esperar(() => ordem.length === 1)
    const baixa = executar('baixa', 'low')
    await esperar(() => filas.socket.estado.esperando === 1)
    const urgente = executar('urgente', 'very_high')
    await baixa
    check('gateway fecha a vítima deslocada como failed', m.confirmacoes.find((r) => r.id === 'baixa')?.detail.motivo === 'deslocada')
    check('deslocamento mantém send ativo em curso', ordem.join() === 'ativa' && !m.confirmacoes.some((r) => r.id === 'ativa'))
    bloqueio.abrir()
    await Promise.all([ativa, urgente])
    check('gateway executa urgente depois da ativa e nunca executa a vítima', ordem.join() === 'ativa,urgente' && m.confirmacoes.find((r) => r.id === 'urgente').status === 'sent')
  }

  {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe({ maxPendentes: 3 }))
    const liberar = ocupar(filas, 'socket'), uploads = []
    m.client.message.upload = async (buffer) => { uploads.push(buffer.toString()); return { url: 'u', fileLength: 1 } }
    m.motor.conexoes = { resolvida: async () => ({}) }
    const executar = (id, prioridade) => executarComandos(m.client, [comando('connection.call', { conexao: 'c', funcao: 'f', scheduling: scheduling(prioridade) }, id)], m.motor, {
      filas, mediaRefCache: {}, criarExecutorDeConexao: () => ({ executar: async () => ({ forma: 'carrossel', cards: [{ midia: { buffer: Buffer.from(id), mime: 'image/jpeg', tipo: 'image' }, corpo: id }] }) })
    })
    const baixa = executar('baixa', 'low')
    await esperar(() => filas.socket.estado.esperando === 1)
    const alta = executar('alta', 'high')
    await esperar(() => filas.socket.estado.esperando === 2)
    await liberar()
    await Promise.all([baixa, alta])
    check('upload herda a prioridade do comando sem argumento em cada chamada', uploads.join() === 'alta,baixa')
    check('comandos concorrentes preservam contexto e concluem os envios', m.confirmacoes.length === 2 && m.confirmacoes.every((r) => r.status === 'sent'))
  }

  {
    const filas = criarFilasDeRecursos(cfgDe({ maxPendentes: 3 })), bloqueio = porta()
    const chamadas = []
    const executor = criarExecutorDeConexao({ buscar: async (url) => {
      chamadas.push(url)
      return { ok: true, status: 200, json: async () => { if (chamadas.length === 1) await bloqueio.promessa; return { texto: 'pronto' } } }
    } })
    const rodar = () => comContextoDeComando(scheduling(), filas, () => executor.executar(declaracao(), 'f', {}))
    const primeira = rodar()
    await esperar(() => chamadas.length === 1)
    const segunda = rodar()
    await esperar(() => filas.rede.estado.esperando === 1)
    check('rede segura a vaga até terminar de ler o corpo JSON', chamadas.length === 1 && filas.rede.estado.emCurso === 1)
    const m = mocks()
    await executarComandos(m.client, [comando()], m.motor, { filas, mediaRefCache: {} })
    check('rede saturada continua permitindo resposta de texto pelo socket', m.envios.length === 1 && m.confirmacoes[0].status === 'sent')
    bloqueio.abrir()
    await Promise.all([primeira, segunda])
    check('HTTP libera a vaga após o corpo', chamadas.length === 2 && filas.rede.estado.emCurso === 0)
  }

  {
    const filas = criarFilasDeRecursos(cfgDe({ maxPendentes: 2 })), corpo = porta(), pausa = porta()
    const orcamento = criarOrcamentoDeMidia(8)
    let dormindo = false, lendo = false
    const baixador = criarBaixador({ cfg: cfgDownload, orcamento,
      dormir: async () => { dormindo = true; await pausa.promessa },
      buscar: async (url) => {
        if (url.endsWith('/download')) return json({ job: 'j' })
        if (url.endsWith('/jobs/j')) return json({ estado: 'pronto', midias: [{ url: '/arquivo', tipo: 'imagem' }] })
        return { ok: true, status: 200, headers: new Headers({ 'content-length': '4' }), arrayBuffer: async () => { lendo = true; await corpo.promessa; return Buffer.alloc(4) } }
      }
    })
    const download = comContextoDeComando(scheduling('low'), filas, () => baixador.baixar('https://video', 'auto'))
    await esperar(() => dormindo)
    check('pausa de acompanhamento não ocupa rede', filas.rede.estado.emCurso === 0)
    pausa.abrir()
    await esperar(() => lendo)
    check('download segura rede durante arrayBuffer e reserva antes de ler', filas.rede.estado.emCurso === 1 && orcamento.estado().reservados === 4)
    let outraComecou = false
    const outra = filas.executar('rede', () => { outraComecou = true })
    await volta()
    check('outra operação de rede espera a leitura binária terminar', !outraComecou)
    corpo.abrir()
    const midia = await download
    await outra
    midia.liberar()
    check('download libera vaga e contabiliza bytes reservados e liberados', filas.rede.estado.emCurso === 0 && orcamento.estado().totalReservados === 4 && orcamento.estado().totalLiberados === 4 && orcamento.estado().reservados === 0)
  }

  {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe()), orcamento = criarOrcamentoDeMidia(4)
    const liberar = ocupar(filas, 'cpu')
    m.motor.conexoes = { resolvida: async () => declaracao({ forma: 'arquivo', campo: 'arquivo' }) }
    await executarComandos(m.client, [comando('connection.call', { conexao: 'c', funcao: 'f', scheduling: scheduling('high') })], m.motor, {
      filas, orcamento, mediaRefCache: {}, criarExecutorDeConexao: (opcoes) => criarExecutorDeConexao({ ...opcoes, buscar: async () => json({ arquivo: 'YWJj' }) })
    })
    check('decodificação de base64 passa pela fila de CPU', m.confirmacoes[0].detail.recurso === 'cpu' && filas.cpu.estado.recusasPorPrioridade.high === 1)
    check('CPU recusada não aloca nem reserva bytes e devolve rede', orcamento.estado().totalReservados === 0 && filas.rede.estado.emCurso === 0 && m.envios.length === 0)
    await liberar()
  }

  {
    const m = mocks(), filas = criarFilasDeRecursos(cfgDe()), orcamento = criarOrcamentoDeMidia(4)
    orcamento.adquirir(4)
    await executarComandos(m.client, [comando('whatsapp.sendFile', { fileId: 'arquivo', scheduling: scheduling('low') })], m.motor, {
      filas, orcamento, mediaRefCache: {}, acervo: { obter: () => ({ id: 'arquivo', kind: 'image', sizeBytes: 4 }), lerConteudoAsync: () => assert.fail('Não deve alocar') }
    })
    check('recusa de memória também segue a política única de sem vaga', m.confirmacoes[0].detail.recurso === 'memoria' && filas.estado.recusasDeComandos.memoria.low === 1 && m.envios.length === 0)
    orcamento.liberar(4)
    check('orçamento publica pico, recusas e balanço dos bytes', orcamento.estado().picoReservados === 4 && orcamento.estado().recusas === 1 && orcamento.estado().totalReservados === orcamento.estado().totalLiberados)
  }
} finally {
  console.warn = warn
  fs.rmSync(pasta, { recursive: true, force: true })
}
console.log(`\n${checagens} checagens de recursos e gateway, zero falhas.`)
