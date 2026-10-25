// MEDIÇÃO DESTA MÁQUINA, COM ESTE NODE, SEM WHATSAPP REAL.
// Isto é um arnês comparativo, NÃO uma promessa de RAM para o produto. Não
// inclui outros processos, criptografia, cópias do transporte, HTTP real nem
// conteúdo de produção. Os corpos são sintéticos, com páginas preenchidas:
// reservar endereço virtual sem tocar nos bytes esconderia o custo no RSS.
//
// npm test: seis cenários, álbum limitado a 40 MiB (--leve).
// npm run carga: acrescenta orçamentos de 80 e 200 MiB, com --expose-gc;
// rodar ao alterar filas, admissão ou retenção de mídia e comparar os JSONs.
// node tests/carga-consumo.test.mjs: a mesma carga completa, sem exigir GC.
// npm run soak: teste de soak contínuo de 30-60 min (--minutos=N), variando
// milhares de conversas, medindo high-water mark, série temporal periódica
// de tendência e vereditos explícitos (esteiras, saldo de bytes, GC).
// Redirecionar stdout permite guardar a medição fora da documentação.
//
// Cada variante roda num processo novo: o alocador de um álbum anterior não
// pode virar a linha de base do seguinte. A base vem DEPOIS dos imports e da
// montagem do cenário; portanto não mede arranque. Usamos process.memoryUsage,
// a mesma fonte de src/state.js, sem arredondar bytes nem gravar state.json.
// Os picos de memória são OBSERVADOS: timer de 5 ms, transições amostradas e
// pontos explícitos de alocação. Um pico entre amostras ainda pode escapar.
// Os picos das filas e das reservas vêm dos próprios contadores internos.
//
// RSS final alto não prova vazamento: V8/alocador podem reter páginas. Com
// --expose-gc, coletamos antes e depois, nunca durante a carga; heapUsado e
// arrayBuffers após GC ajudam a comparar retenção, mas uma rodada não prova
// ausência de vazamento. Sem a flag, mostramos final natural e pós-GC nulo.
// O custo do observador e das pequenas listas de esperas faz parte da medida.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const MiB = 1024 * 1024
const mb = (bytes) => (bytes / MiB).toFixed(2)
const ms = (n) => n === null || n === undefined ? 'n/a' : n.toFixed(2)
const volta = () => new Promise((resolve) => setImmediate(resolve))
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const porta = () => {
  let abrir
  const promessa = new Promise((resolve) => { abrir = resolve })
  return { promessa, abrir }
}
const memoria = () => {
  const m = process.memoryUsage()
  return { rss: m.rss, arrayBuffers: m.arrayBuffers, heapUsado: m.heapUsed, externa: m.external }
}
const mensagem = (grupo, numero) => ({
  key: { id: String(numero), remoteJid: grupo, isGroup: true, fromMe: true },
  message: { conversation: String(numero) }, timestampSeconds: 1700000000
})
const cenarios = [
  { id: 'instantaneas', nome: '10 mil tarefas instantâneas', pendentes: 64 },
  { id: 'mesmo-grupo', nome: '500 eventos no mesmo grupo', pendentes: 512 },
  { id: '50-grupos', nome: '500 eventos em 50 grupos', pendentes: 512 },
  ...[40, 80, 200].map((orcamentoMiB) => ({
    id: `album-${orcamentoMiB}`, nome: `Álbum 20 × 10 MiB; orçamento ${orcamentoMiB} MiB`,
    pendentes: 64, orcamentoMiB
  })),
  { id: 'motor-lento', nome: 'Motor lento sob dez rajadas de mil eventos', pendentes: 64 },
  { id: 'desligamento', nome: 'Desligamento durante execução', pendentes: 16 }
]

async function coletar () {
  if (typeof global.gc !== 'function') return null
  // A volta desfaz referências da pilha anterior; a segunda coleta dá ao
  // runtime a oportunidade de concluir a liberação dos backing stores.
  await volta()
  global.gc()
  await volta()
  global.gc()
  return memoria()
}

function observador () {
  const estados = {}
  const esperas = Object.fromEntries(['admissao', 'socket', 'rede', 'cpu'].map((nome) => [nome, []]))
  const encerradas = { admissao: 0, socket: 0, rede: 0, cpu: 0 }
  let inicial, pico, timer, amostras = 0, transicoes = 0, inicio
  function amostrar () {
    if (!inicial) return
    const atual = memoria()
    for (const campo of Object.keys(pico)) pico[campo] = Math.max(pico[campo], atual[campo])
    amostras++
  }
  return {
    estados, encerradas, amostrar,
    aoMudar (estado) {
      const anterior = estados[estado.recurso]
      estados[estado.recurso] = estado
      // Não fazemos I/O nem guardamos snapshots por entrada. Na rajada
      // síncrona o timer não roda: amostrar transições cobre esse intervalo.
      if (++transicoes % 32 === 0 || estado.picoPendentes > (anterior?.picoPendentes || 0)) amostrar()
    },
    medir (fila, tarefa) {
      const entrou = performance.now()
      return () => {
        // Entrada até invocação, incluindo o despacho por microtarefa.
        // Recusas não entram no percentil: zeros delas esconderiam a espera.
        esperas[fila].push(performance.now() - entrou)
        return tarefa()
      }
    },
    async iniciar () {
      await coletar()
      inicial = memoria()
      pico = { ...inicial }
      inicio = performance.now()
      timer = setInterval(amostrar, 5)
      amostrar()
    },
    async finalizar () {
      clearInterval(timer)
      amostrar()
      const finalNatural = memoria()
      const duracaoMs = performance.now() - inicio
      const aposGC = await coletar()
      const final = aposGC || finalNatural
      // A própria coleta pode ajustar páginas do runtime. Incluir os pontos
      // finais evita apresentar um "pico" menor que o RSS final observado.
      for (const campo of Object.keys(pico)) pico[campo] = Math.max(pico[campo], finalNatural[campo], final[campo])
      // Calcular percentis e serializar só DEPOIS da última leitura evita
      // atribuir ao trabalho a cópia de arrays e o JSON do próprio relatório.
      const filas = Object.fromEntries(Object.entries(estados).map(([nome, e]) => {
        const valores = esperas[nome].sort((a, b) => a - b)
        const percentil = (p) => valores.length ? valores[Math.ceil(valores.length * p) - 1] : null
        assert.equal(valores.length, e.iniciadas, `Esperas cobrem todas as iniciadas de ${nome}`)
        assert.equal(e.emCurso + e.esperando + e.chavesAtivas, 0, `${nome} drenou`)
        assert.equal(e.expiradas, 0, `${nome} não perdeu trabalho por timeout`)
        return [nome, {
          limite: e.limite, maxPendentes: e.maxPendentes,
          picoPendentes: e.picoPendentes, picoEmCurso: e.picoEmCurso,
          iniciadas: e.iniciadas, concluidas: e.concluidas,
          recusasSobrecarga: e.recusas - encerradas[nome], recusasEncerramento: encerradas[nome],
          deslocadas: e.deslocadas, expiradas: e.expiradas,
          esperaMs: { amostras: valores.length, p50: percentil(0.5), p95: percentil(0.95) },
          final: { emCurso: e.emCurso, pendentes: e.esperando, chaves: e.chavesAtivas }
        }]
      }))
      return { duracaoMs, amostrasMemoria: amostras, memoriaBytes: { inicial, pico, finalNatural, aposGC, final }, filas }
    }
  }
}

async function executarCenario (cenario) {
  // Imports iguais em todos os filhos deixam comparável a base do processo.
  const { criarAdmissaoDeEventos, registrarEntradaDeEventos } = await import('../src/connection.js')
  const { criarFilasDeRecursos } = await import('../src/engine/filasDeRecursos.js')
  const { criarOrcamentoDeMidia } = await import('../src/mediaBudget.js')
  const { criarBaixador } = await import('../src/downloader.js')
  const { executarComandos } = await import('../src/engine/gatewayExecutor.js')
  const o = observador()
  const cfg = { hardware: {
    admissaoConcorrencia: 8, maxPendentes: cenario.pendentes,
    comandosSimultaneos: 2, downloadConcorrencia: 2, cpuConcorrencia: 1,
    maxMidiaMB: 10, orcamentoMidiaMB: cenario.orcamentoMiB || 40,
    admissaoLogJanelaMs: 20, esperaMaximaMs: 10000
  } }
  const erros = []
  const registrar = (texto) => {
    if (/evento admitido falhou|evento não avaliado/.test(texto)) erros.push(texto)
  }
  const admissao = criarAdmissaoDeEventos(cfg, { registrar, aoMudar: o.aoMudar })
  const admitir = admissao.admitir.bind(admissao)
  admissao.admitir = (chave, tarefa) => {
    const resultado = admitir(chave, o.medir('admissao', tarefa))
    if (!resultado && admissao.estado.encerrada) o.encerradas.admissao++
    return resultado
  }
  const filas = criarFilasDeRecursos(cfg, { aoMudar: o.aoMudar })
  for (const nome of ['socket', 'rede', 'cpu']) {
    const fila = filas[nome]
    const executar = fila.executar.bind(fila)
    fila.executar = (tarefa, opcoes) => executar(o.medir(nome, tarefa), opcoes)
    o.aoMudar(fila.estado)
  }
  o.aoMudar(admissao.estado)
  const orcamento = criarOrcamentoDeMidia(cfg.hardware.orcamentoMidiaMB * MiB)
  const client = new EventEmitter()
  const ligar = (encaminhar, clienteEngine = {}) => registrarEntradaDeEventos(client, clienteEngine, {
    admissao, obterContexto: () => ({ cfg, accountId: 'carga-sintetica' }), registrar, encaminhar
  })
  const detalhes = {}
  let pasta
  try {
    if (cenario.orcamentoMiB) {
      pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-carga-'))
      const tokenArquivo = path.join(pasta, 'token')
      fs.writeFileSync(tokenArquivo, 'token-sintetico')
      cfg.download = { api: 'https://carga.invalid', tokenArquivo, limiteMB: 10 }
      const arquivos = Array.from({ length: 20 }, (_, i) => ({
        url: `/arquivo-${i}`, nome: `${i}.jpg`, mime: 'image/jpeg', tipo: 'imagem', bytes: 10 * MiB
      }))
      let lidos = 0, enviados = 0, subidos = 0
      const json = (corpo) => ({ ok: true, status: 200, json: async () => corpo })
      const buscar = async (url) => {
        if (url.endsWith('/download')) return json({ job: 'sintetico' })
        if (url.endsWith('/jobs/sintetico')) return json({ estado: 'pronto', midias: arquivos })
        assert.match(url, /\/arquivo-\d+$/)
        return {
          ok: true, status: 200,
          headers: { get: (nome) => nome === 'content-length' ? String(10 * MiB) : null },
          body: { cancel: async () => {} },
          arrayBuffer: async () => {
            lidos++
            assert.equal(orcamento.estado().reservados, lidos * 10 * MiB, 'Reserva antes do corpo')
            const corpo = new ArrayBuffer(10 * MiB)
            new Uint8Array(corpo).fill(0x5a)
            o.amostrar()
            await volta()
            return corpo
          }
        }
      }
      client.message = {
        send: async () => { enviados++; await volta(); return { id: `envio-${enviados}` } },
        upload: async (buffer) => {
          assert.equal(buffer.length, 10 * MiB)
          subidos++
          o.amostrar()
          await volta()
          return { url: 'https://carga.invalid/upload', fileLength: buffer.length }
        }
      }
      const confirmacoes = []
      const motor = { execucoes: { confirmar: async (_id, resultado) => { confirmacoes.push(resultado) } } }
      ligar(() => executarComandos(client, [{
        id: 'album-sintetico', commandType: 'media.download', payload: {
          chatId: 'album@g.us', url: 'https://carga.invalid/post', entrega: 'album',
          scheduling: { priority: 'normal', onNoSlot: { kind: 'discard' } }
        }
      }], motor, {
        cfg, filas, orcamento, mediaRefCache: {},
        criarBaixador: (opcoes) => criarBaixador({ ...opcoes, buscar, dormir: async () => {} })
      }))
      await o.iniciar()
      client.emit('message', mensagem('album@g.us', 0))
      await admissao.encerrar()
      const cabe = cenario.orcamentoMiB >= 200
      assert.equal(confirmacoes.length, 1)
      assert.equal(confirmacoes[0].status, cabe ? 'sent' : 'failed')
      if (!cabe) assert.equal(confirmacoes[0].detail?.code, 'LCN_SEM_VAGA')
      assert.equal(lidos, Math.min(20, cenario.orcamentoMiB / 10))
      assert.equal(subidos, cabe ? 20 : 0)
      assert.equal(enviados, cabe ? 21 : 0)
      assert.equal(orcamento.estado().picoReservados, lidos * 10 * MiB)
      Object.assign(detalhes, { arquivosOferecidos: 20, bytesPorArquivo: 10 * MiB, lidos, subidos, enviados, resultado: confirmacoes[0].status })
    } else if (cenario.id === 'instantaneas') {
      let executadas = 0
      await o.iniciar()
      for (let i = 0; i < 10000; i++) admissao.admitir(`${i % 50}@g.us`, () => { executadas++ })
      o.amostrar()
      assert.equal(executadas, 0, 'A rajada precede as microtarefas')
      await admissao.encerrar()
      assert.equal(executadas, 72)
      assert.equal(admissao.estado.recusas, 9928)
      detalhes.executadas = executadas
    } else if (cenario.id === 'mesmo-grupo' || cenario.id === '50-grupos') {
      const grupos = cenario.id === 'mesmo-grupo' ? 1 : 50
      const porGrupo = 500 / grupos
      const bloqueio = porta()
      const ativos = new Set(), ordens = new Map()
      let picoParalelo = 0, cruzou = false
      ligar(async (_client, _motor, evento) => {
        const chave = evento.chat.id
        cruzou ||= ativos.has(chave)
        ativos.add(chave)
        picoParalelo = Math.max(picoParalelo, ativos.size)
        await bloqueio.promessa
        await volta()
        const numeros = ordens.get(chave) || []
        numeros.push(Number(evento.message.text))
        ordens.set(chave, numeros)
        ativos.delete(chave)
      })
      await o.iniciar()
      // Grupos contíguos expõem uma esteira que ocuparia vagas só para esperar
      // a conversa anterior, ocultando o paralelismo entre conversas.
      for (let g = 0; g < grupos; g++) {
        for (let i = 0; i < porGrupo; i++) client.emit('message', mensagem(`${g}@g.us`, i))
      }
      await volta()
      assert.equal(picoParalelo, Math.min(8, grupos))
      bloqueio.abrir()
      await admissao.encerrar()
      assert.equal(cruzou, false)
      assert.equal(ordens.size, grupos)
      for (const ordem of ordens.values()) assert.deepEqual(ordem, Array.from({ length: porGrupo }, (_, i) => i))
      assert.equal(admissao.estado.recusas, 0)
      Object.assign(detalhes, { grupos, eventos: 500, picoGruposEmParalelo: picoParalelo, ordemConferida: true })
    } else if (cenario.id === 'motor-lento') {
      const bloqueio = porta()
      let iniciadas = 0, concluidas = 0, ativos = 0, picoAtivos = 0
      ligar(undefined, { eventos: { enviar: async () => {
        iniciadas++; ativos++; picoAtivos = Math.max(picoAtivos, ativos)
        await bloqueio.promessa
        await esperar(15)
        ativos--; concluidas++
        return { results: [] }
      } } })
      const pendentesPorRajada = []
      await o.iniciar()
      for (let lote = 0; lote < 10; lote++) {
        for (let i = 0; i < 1000; i++) client.emit('message', mensagem(`${lote * 1000 + i}@g.us`, i))
        await esperar(5)
        pendentesPorRajada.push(admissao.estado.esperando)
        assert.equal(iniciadas, 8, 'Só oito chamadas ao motor enquanto ele está bloqueado')
      }
      assert.deepEqual(pendentesPorRajada, Array(10).fill(64))
      bloqueio.abrir()
      await admissao.encerrar()
      assert.equal(concluidas, 72)
      assert.equal(admissao.estado.recusas, 9928)
      Object.assign(detalhes, { iniciadas, concluidas, picoChamadasAoMotor: picoAtivos, atrasoPorRespostaMs: 15, pendentesPorRajada })
    } else {
      const bloqueio = porta()
      let iniciadas = 0, concluidas = 0
      ligar(async () => { iniciadas++; await bloqueio.promessa; await volta(); concluidas++ })
      await o.iniciar()
      for (let i = 0; i < 24; i++) client.emit('message', mensagem(`${i}@g.us`, i))
      await volta()
      assert.equal(iniciadas, 8)
      const drenagem = admissao.encerrar()
      let drenou = false
      drenagem.then(() => { drenou = true })
      for (let i = 0; i < 500; i++) client.emit('message', mensagem(`novo-${i}@g.us`, i))
      await volta()
      assert.equal(drenou, false, 'Desligamento aguarda trabalho em curso')
      assert.equal(iniciadas, 8)
      assert.equal(o.encerradas.admissao, 500)
      bloqueio.abrir()
      await drenagem
      assert.equal(concluidas, 24)
      Object.assign(detalhes, { concluidas, recusasDepoisDoFim: 500, drenagemConferida: true })
    }
    for (const nome of ['socket', 'rede', 'cpu']) await filas[nome].encerrar()
    client.removeAllListeners()
    assert.deepEqual(erros, [])
    assert.equal(orcamento.estado().reservados, 0, 'Toda reserva foi devolvida')
    assert.ok(admissao.estado.picoPendentes <= cenario.pendentes)
    const resultado = await o.finalizar()
    return { cenario: cenario.id, nome: cenario.nome, ...resultado, midia: orcamento.estado(), detalhes }
  } finally {
    if (pasta) fs.rmSync(pasta, { recursive: true, force: true })
  }
}

function imprimir (r) {
  const mb = (bytes) => (bytes / MiB).toFixed(2)
  const ms = (n) => n === null ? 'n/a' : n.toFixed(2)
  console.log(`\n${r.nome} (${r.duracaoMs.toFixed(0)} ms; ${r.amostrasMemoria} amostras)`)
  for (const campo of ['rss', 'arrayBuffers', 'heapUsado', 'externa']) {
    const m = r.memoriaBytes
    console.log(`  ${campo} inicial / pico / final: ${mb(m.inicial[campo])} / ${mb(m.pico[campo])} / ${mb(m.final[campo])} MiB`)
  }
  console.log(`  Final: ${r.memoriaBytes.aposGC ? 'após GC explícito (final natural também no JSON)' : 'natural, SEM GC explícito; retenção menos comparável'}`)
  for (const [nome, f] of Object.entries(r.filas)) {
    console.log(`  ${nome}: pendentes pico=${f.picoPendentes}; em curso pico=${f.picoEmCurso}; recusas sobrecarga=${f.recusasSobrecarga}, encerramento=${f.recusasEncerramento}; espera p50/p95=${ms(f.esperaMs.p50)}/${ms(f.esperaMs.p95)} ms (n=${f.esperaMs.amostras})`)
  }
  console.log(`  Mídia reservada pico=${r.midia.picoReservados} bytes (${mb(r.midia.picoReservados)} MiB); recusas orçamento=${r.midia.recusas}`)
  // Uma linha por cenário permite comparar execuções sem depender do texto
  // arredondado. Null significa ausência de amostra, nunca espera zero.
  console.log(`CARGA_JSON ${JSON.stringify(r)}`)
}

function formatarTempo (ms) {
  const totalSegundos = Math.floor(ms / 1000)
  const minutos = Math.floor(totalSegundos / 60)
  const segundos = totalSegundos % 60
  const horas = Math.floor(minutos / 60)
  if (horas > 0) {
    const minRestantes = minutos % 60
    return `${horas}h${String(minRestantes).padStart(2, '0')}m${String(segundos).padStart(2, '0')}s`
  }
  return `${String(minutos).padStart(2, '0')}m${String(segundos).padStart(2, '0')}s`
}

function extrairParametro (nome) {
  const prefixo = `--${nome}=`
  const igual = process.argv.find((a) => a.startsWith(prefixo))
  if (igual) return igual.slice(prefixo.length)
  const idx = process.argv.indexOf(`--${nome}`)
  if (idx !== -1 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1]
  }
  return null
}

function criarReservatorio (tamanhoMax = 10000) {
  const amostras = []
  let total = 0
  return {
    adicionar (valor) {
      total++
      if (amostras.length < tamanhoMax) {
        amostras.push(valor)
      } else {
        const idx = Math.floor(Math.random() * total)
        if (idx < tamanhoMax) amostras[idx] = valor
      }
    },
    obter () { return amostras },
    get total () { return total }
  }
}

function observadorSoak () {
  const estados = {}
  const reservatorios = Object.fromEntries(['admissao', 'socket', 'rede', 'cpu'].map((nome) => [nome, criarReservatorio(10000)]))
  const encerradas = { admissao: 0, socket: 0, rede: 0, cpu: 0 }
  const serie = []
  let inicial, pico, timerAmostragem, amostras = 0, transicoes = 0, inicio

  function amostrar () {
    if (!inicial) return
    const atual = memoria()
    for (const campo of Object.keys(pico)) pico[campo] = Math.max(pico[campo], atual[campo])
    amostras++
  }

  return {
    estados, encerradas, amostrar, serie,
    aoMudar (estado) {
      const anterior = estados[estado.recurso]
      estados[estado.recurso] = estado
      if (++transicoes % 32 === 0 || estado.picoPendentes > (anterior?.picoPendentes || 0)) amostrar()
    },
    medir (fila, tarefa) {
      const entrou = performance.now()
      return () => {
        reservatorios[fila].adicionar(performance.now() - entrou)
        return tarefa()
      }
    },
    registrarSerie (ciclo, cenarioId, orcamento) {
      if (!inicial) return
      const agora = performance.now()
      const decorridoMs = agora - inicio
      const m = memoria()
      serie.push({
        tempoMs: decorridoMs,
        tempoFormatado: formatarTempo(decorridoMs),
        ciclo,
        cenarioId,
        memoria: m,
        chavesAtivas: estados.admissao?.chavesAtivas || 0,
        reservadosOrcamento: orcamento.estado().reservados,
        recusasAdmissao: (estados.admissao?.recusas || 0) - encerradas.admissao
      })
    },
    async iniciar () {
      await coletar()
      inicial = memoria()
      pico = { ...inicial }
      inicio = performance.now()
      timerAmostragem = setInterval(amostrar, 10)
      timerAmostragem.unref?.()
      amostrar()
    },
    async finalizar () {
      if (timerAmostragem) clearInterval(timerAmostragem)
      amostrar()
      const finalNatural = memoria()
      const duracaoEfetivaMs = performance.now() - inicio
      const aposGC = await coletar()
      const final = aposGC || finalNatural
      for (const campo of Object.keys(pico)) pico[campo] = Math.max(pico[campo], finalNatural[campo], final[campo])
      const filas = Object.fromEntries(Object.entries(estados).map(([nome, e]) => {
        const valores = reservatorios[nome].obter().slice().sort((a, b) => a - b)
        const percentil = (p) => valores.length ? valores[Math.ceil(valores.length * p) - 1] : null
        return [nome, {
          limite: e.limite, maxPendentes: e.maxPendentes,
          picoPendentes: e.picoPendentes, picoEmCurso: e.picoEmCurso,
          iniciadas: e.iniciadas, concluidas: e.concluidas,
          recusasSobrecarga: e.recusas - encerradas[nome], recusasEncerramento: encerradas[nome],
          deslocadas: e.deslocadas, expiradas: e.expiradas,
          esperaMs: { amostras: reservatorios[nome].total, p50: percentil(0.5), p95: percentil(0.95) },
          final: { emCurso: e.emCurso, pendentes: e.esperando, chaves: e.chavesAtivas }
        }]
      }))
      return { duracaoMs: duracaoEfetivaMs, amostrasMemoria: amostras, memoriaBytes: { inicial, pico, finalNatural, aposGC, final }, filas, serie }
    }
  }
}

async function executarSoak () {
  const argMinutos = extrairParametro('minutos')
  const argSegundos = extrairParametro('segundos')
  const duracaoMinutos = argSegundos
    ? parseFloat(argSegundos) / 60
    : (argMinutos ? parseFloat(argMinutos) : 30)
  const duracaoMs = Math.round(duracaoMinutos * 60 * 1000)
  const gcExposto = typeof global.gc === 'function'

  console.log('='.repeat(80))
  console.log('TESTE DE SOAK — ALTA PRESSÃO E RESISTÊNCIA DE LONGA DURAÇÃO')
  console.log('MEDIÇÃO DESTA MÁQUINA, COM ESTE NODE, SEM WHATSAPP REAL.')
  console.log('Isto é um arnês comparativo interno, NÃO uma promessa de RAM para o produto.')
  console.log('Não inclui rede externa, criptografia do WhatsApp nem outros processos.')
  console.log('Medir primeiro, prometer depois: nenhum valor aqui deve ser fixado em docs/painel.')
  console.log('='.repeat(80))
  console.log(`Duração planejada: ${duracaoMinutos.toFixed(2)} min (${(duracaoMs / 1000).toFixed(0)} s)`)
  console.log(`Node: ${process.version} | V8: ${process.versions.v8} | SO: ${process.platform} (${process.arch})`)
  console.log(`Coleta explícita global.gc(): ${gcExposto ? 'DISPONÍVEL (--expose-gc ativo)' : 'INDISPONÍVEL (medição degradada sem forçar GC)'}`)
  if (!gcExposto) {
    console.log('[AVISO] Para medição comparável precisa com GC forçado antes e depois, rode via: npm run soak\n')
  } else {
    console.log()
  }

  const { criarAdmissaoDeEventos, registrarEntradaDeEventos } = await import('../src/connection.js')
  const { criarFilasDeRecursos } = await import('../src/engine/filasDeRecursos.js')
  const { criarOrcamentoDeMidia } = await import('../src/mediaBudget.js')
  const { criarBaixador } = await import('../src/downloader.js')
  const { executarComandos } = await import('../src/engine/gatewayExecutor.js')

  let pastaTmp
  let interrompido = false
  const aoInterromper = () => {
    if (interrompido) process.exit(130)
    interrompido = true
    console.log('\n[soak] SIGINT recebido. Concluindo ciclo atual para drenar e emitir vereditos parciais...')
  }
  process.on('SIGINT', aoInterromper)

  try {
    pastaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-soak-'))
    const tokenArquivo = path.join(pastaTmp, 'token')
    fs.writeFileSync(tokenArquivo, 'token-soak-sintetico')

    const cfg = {
      download: { api: 'https://soak.invalid', tokenArquivo, limiteMB: 10 },
      hardware: {
        admissaoConcorrencia: 8,
        maxPendentes: 512,
        comandosSimultaneos: 2,
        downloadConcorrencia: 2,
        cpuConcorrencia: 1,
        maxMidiaMB: 10,
        orcamentoMidiaMB: 200,
        admissaoLogJanelaMs: 1000,
        esperaMaximaMs: 10000
      }
    }

    const erros = []
    const registrar = (texto) => {
      if (/evento admitido falhou|evento não avaliado/.test(texto)) erros.push(texto)
    }

    const o = observadorSoak()

    const admissao = criarAdmissaoDeEventos(cfg, { registrar, aoMudar: o.aoMudar })
    const admitirOriginal = admissao.admitir.bind(admissao)
    admissao.admitir = (chave, tarefa) => {
      const resultado = admitirOriginal(chave, o.medir('admissao', tarefa))
      if (!resultado && admissao.estado.encerrada) o.encerradas.admissao++
      return resultado
    }

    const filas = criarFilasDeRecursos(cfg, { aoMudar: o.aoMudar })
    for (const nome of ['socket', 'rede', 'cpu']) {
      const fila = filas[nome]
      const executarOriginal = fila.executar.bind(fila)
      fila.executar = (tarefa, opcoes) => executarOriginal(o.medir(nome, tarefa), opcoes)
      o.aoMudar(fila.estado)
    }
    o.aoMudar(admissao.estado)

    const orcamento = criarOrcamentoDeMidia(cfg.hardware.orcamentoMidiaMB * MiB)
    const client = new EventEmitter()

    let despachante = null
    registrarEntradaDeEventos(client, {}, {
      admissao,
      obterContexto: () => ({ cfg, accountId: 'soak-sintetico' }),
      registrar,
      encaminhar: (cl, eng, ev, c, r) => despachante ? despachante(cl, eng, ev, c, r) : Promise.resolve()
    })

    const arquivosAlbum = Array.from({ length: 20 }, (_, i) => ({
      url: `/arquivo-${i}`, nome: `${i}.jpg`, mime: 'image/jpeg', tipo: 'imagem', bytes: 10 * MiB
    }))

    let conversasTotal = 0
    let tarefasIniciadasTotal = 0
    let reservasTotal = 0
    let totalBytesReservados = 0

    async function rodarInstantaneas (rodada) {
      let executadas = 0
      const prefixo = `soak-inst-${rodada}`
      for (let i = 0; i < 10000; i++) {
        conversasTotal++
        admissao.admitir(`${prefixo}-${i}@g.us`, () => { executadas++ })
      }
      o.amostrar()
      while (admissao.estado.emCurso > 0 || admissao.estado.esperando > 0) {
        await volta()
      }
      assert.equal(executadas, 520, '520 tarefas executadas na rajada instantânea')
      assert.equal(admissao.estado.chavesAtivas, 0, 'Chaves limpas após instantâneas')
      tarefasIniciadasTotal += executadas
    }

    async function rodarGrupos (rodada, numGrupos) {
      const porGrupo = 500 / numGrupos
      const bloqueio = porta()
      const ativos = new Set(), ordens = new Map()
      let picoParalelo = 0, cruzou = false
      let concluidas = 0

      despachante = async (_client, _motor, evento) => {
        const chave = evento.chat.id
        cruzou ||= ativos.has(chave)
        ativos.add(chave)
        picoParalelo = Math.max(picoParalelo, ativos.size)
        await bloqueio.promessa
        await volta()
        const numeros = ordens.get(chave) || []
        numeros.push(Number(evento.message.text))
        ordens.set(chave, numeros)
        ativos.delete(chave)
        concluidas++
      }

      for (let g = 0; g < numGrupos; g++) {
        conversasTotal++
        const gId = `soak-grp-${rodada}-${g}@g.us`
        for (let i = 0; i < porGrupo; i++) {
          client.emit('message', mensagem(gId, i))
        }
      }
      await volta()
      assert.equal(picoParalelo, Math.min(8, numGrupos))
      bloqueio.abrir()

      while (concluidas < 500 || admissao.estado.emCurso > 0 || admissao.estado.esperando > 0) {
        await volta()
      }

      assert.equal(cruzou, false, 'Sem cruzamento de eventos na mesma esteira')
      assert.equal(ordens.size, numGrupos)
      for (const ordem of ordens.values()) {
        assert.deepEqual(ordem, Array.from({ length: porGrupo }, (_, i) => i))
      }
      assert.equal(admissao.estado.chavesAtivas, 0, 'Chaves limpas após grupos')
      despachante = null
      tarefasIniciadasTotal += concluidas
    }

    async function rodarAlbum (rodada, orcamentoMiB) {
      reservasTotal++
      totalBytesReservados += orcamentoMiB * MiB
      orcamento.ajustarLimite(orcamentoMiB * MiB)
      const chatId = `soak-album-${rodada}@g.us`
      conversasTotal++
      let lidos = 0, enviados = 0, subidos = 0
      const json = (corpo) => ({ ok: true, status: 200, json: async () => corpo })
      const buscar = async (url) => {
        if (url.endsWith('/download')) return json({ job: 'sintetico' })
        if (url.endsWith('/jobs/sintetico')) return json({ estado: 'pronto', midias: arquivosAlbum })
        assert.match(url, /\/arquivo-\d+$/)
        return {
          ok: true, status: 200,
          headers: { get: (nome) => nome === 'content-length' ? String(10 * MiB) : null },
          body: { cancel: async () => {} },
          arrayBuffer: async () => {
            lidos++
            assert.equal(orcamento.estado().reservados, lidos * 10 * MiB, 'Reserva antes do corpo')
            const corpo = new ArrayBuffer(10 * MiB)
            new Uint8Array(corpo).fill(0x5a)
            o.amostrar()
            await volta()
            return corpo
          }
        }
      }
      client.message = {
        send: async () => { enviados++; await volta(); return { id: `envio-${enviados}` } },
        upload: async (buffer) => {
          assert.equal(buffer.length, 10 * MiB)
          subidos++
          o.amostrar()
          await volta()
          return { url: 'https://soak.invalid/upload', fileLength: buffer.length }
        }
      }
      const confirmacoes = []
      const motor = { execucoes: { confirmar: async (_id, resultado) => { confirmacoes.push(resultado) } } }
      despachante = () => executarComandos(client, [{
        id: `album-${rodada}`, commandType: 'media.download', payload: {
          chatId, url: 'https://soak.invalid/post', entrega: 'album',
          scheduling: { priority: 'normal', onNoSlot: { kind: 'discard' } }
        }
      }], motor, {
        cfg, filas, orcamento, mediaRefCache: {},
        criarBaixador: (opcoes) => criarBaixador({ ...opcoes, buscar, dormir: async () => {} })
      })

      client.emit('message', mensagem(chatId, 0))

      while (confirmacoes.length === 0 || admissao.estado.emCurso > 0 || admissao.estado.esperando > 0) {
        await volta()
      }
      while (filas.socket.estado.emCurso > 0 || filas.rede.estado.emCurso > 0 || filas.cpu.estado.emCurso > 0) {
        await volta()
      }

      const cabe = orcamentoMiB >= 200
      assert.equal(confirmacoes.length, 1)
      assert.equal(confirmacoes[0].status, cabe ? 'sent' : 'failed')
      if (!cabe) assert.equal(confirmacoes[0].detail?.code, 'LCN_SEM_VAGA')
      assert.equal(lidos, Math.min(20, Math.floor(orcamentoMiB / 10)))
      assert.equal(subidos, cabe ? 20 : 0)
      assert.equal(enviados, cabe ? 21 : 0)
      assert.equal(orcamento.estado().reservados, 0, 'Reserva devolvida após álbum')
      assert.equal(admissao.estado.chavesAtivas, 0, 'Chaves limpas após álbum')
      despachante = null
      tarefasIniciadasTotal += 1
    }

    async function rodarMotorLento (rodada) {
      const bloqueio = porta()
      let iniciadas = 0, concluidas = 0, ativos = 0
      despachante = async () => {
        iniciadas++; ativos++
        await bloqueio.promessa
        await esperar(1)
        ativos--; concluidas++
        return { results: [] }
      }

      for (let lote = 0; lote < 5; lote++) {
        for (let i = 0; i < 500; i++) {
          conversasTotal++
          client.emit('message', mensagem(`soak-lento-${rodada}-${lote * 500 + i}@g.us`, i))
        }
        await esperar(2)
      }
      bloqueio.abrir()

      while (concluidas < 520 || admissao.estado.emCurso > 0 || admissao.estado.esperando > 0) {
        await volta()
      }

      assert.equal(concluidas, 520)
      assert.equal(admissao.estado.chavesAtivas, 0, 'Chaves limpas após motor lento')
      despachante = null
      tarefasIniciadasTotal += concluidas
    }

    const listaCenariosSoak = [
      { id: 'instantaneas', rodar: (r) => rodarInstantaneas(r) },
      { id: 'album-40', rodar: (r) => rodarAlbum(r, 40) },
      { id: '50-grupos', rodar: (r) => rodarGrupos(r, 50) },
      { id: 'album-200', rodar: (r) => rodarAlbum(r, 200) },
      { id: 'mesmo-grupo', rodar: (r) => rodarGrupos(r, 1) },
      { id: 'album-80', rodar: (r) => rodarAlbum(r, 80) },
      { id: 'motor-lento', rodar: (r) => rodarMotorLento(r) }
    ]

    const instanteInicio = new Date().toISOString()
    const inicioEmMs = Date.now()
    const fimEmMs = inicioEmMs + duracaoMs
    const intervaloSerieMs = duracaoMs >= 60000 ? 15000 : Math.max(1000, Math.floor(duracaoMs / 10))
    const intervaloLogMs = duracaoMs >= 600000 ? 60000 : (duracaoMs >= 60000 ? 30000 : Math.max(2000, Math.floor(duracaoMs / 5)))
    let proximaAmostraSerie = inicioEmMs + intervaloSerieMs
    let proximoLog = inicioEmMs + intervaloLogMs

    let ciclo = 0
    let rodada = 0

    await o.iniciar()
    o.registrarSerie(ciclo, 'inicio', orcamento)

    while ((Date.now() < fimEmMs || ciclo === 0) && !interrompido) {
      ciclo++
      for (const cenario of listaCenariosSoak) {
        if (interrompido) break
        rodada++
        await cenario.rodar(rodada)
        o.amostrar()

        const agora = Date.now()
        if (agora >= proximaAmostraSerie) {
          o.registrarSerie(ciclo, cenario.id, orcamento)
          proximaAmostraSerie = agora + intervaloSerieMs
        }

        if (agora >= proximoLog) {
          const decorrido = agora - inicioEmMs
          const pct = Math.min(100, (decorrido / duracaoMs) * 100).toFixed(1)
          const m = memoria()
          console.log(`[soak ${formatarTempo(decorrido)} / ${formatarTempo(duracaoMs)} (${pct}%)] ciclo=${ciclo} conversas=${conversasTotal.toLocaleString('pt-BR')} | rss=${mb(m.rss)} MiB heap=${mb(m.heapUsado)} MiB ab=${mb(m.arrayBuffers)} MiB | chaves=${admissao.estado.chavesAtivas} | orcamento=${orcamento.estado().reservados} B | recusas=${(admissao.estado.recusas - o.encerradas.admissao).toLocaleString('pt-BR')}`)
          proximoLog = agora + intervaloLogMs
        }
      }
    }

    o.registrarSerie(ciclo, 'pre-desligamento', orcamento)

    // Encerramento gracioso final sob carga
    const bloqueioFim = porta()
    let iniciadasFim = 0, concluidasFim = 0
    despachante = async () => {
      iniciadasFim++
      await bloqueioFim.promessa
      await volta()
      concluidasFim++
    }
    for (let i = 0; i < 24; i++) {
      client.emit('message', mensagem(`soak-desligar-${i}@g.us`, i))
    }
    await volta()
    assert.equal(iniciadasFim, 8, '8 em curso na admissão no momento do desligamento')
    const drenagemAdmissao = admissao.encerrar()
    let drenouAntesDaHora = false
    drenagemAdmissao.then(() => { drenouAntesDaHora = true })

    for (let i = 0; i < 500; i++) {
      client.emit('message', mensagem(`soak-recusa-pos-fim-${i}@g.us`, i))
    }
    await volta()
    assert.equal(drenouAntesDaHora, false, 'Desligamento aguarda trabalho em curso')
    assert.equal(iniciadasFim, 8)
    assert.equal(o.encerradas.admissao, 500)

    bloqueioFim.abrir()
    await drenagemAdmissao
    assert.equal(concluidasFim, 24)

    for (const nome of ['socket', 'rede', 'cpu']) {
      await filas[nome].encerrar()
    }
    client.removeAllListeners()

    const resultado = await o.finalizar()
    o.registrarSerie(ciclo, 'final-pos-gc', orcamento)

    const estadoOrcamento = orcamento.estado()
    const orcamentoOk = estadoOrcamento.reservados === 0 && estadoOrcamento.totalReservados === estadoOrcamento.totalLiberados
    const chavesAdmissao = admissao.estado.chavesAtivas
    // Só as TRÊS filas: `criarFilasDeRecursos` devolve também funções
    // auxiliares e um `estado` próprio no mesmo objeto, e varrer tudo com
    // Object.values topava numa função e lia `.estado` de undefined.
    const chavesRecursos = ['socket', 'rede', 'cpu'].reduce((s, nome) => s + filas[nome].estado.chavesAtivas, 0)
    const esteirasOk = chavesAdmissao === 0 && chavesRecursos === 0

    const inicialAB = resultado.memoriaBytes.inicial.arrayBuffers
    const picoAB = resultado.memoriaBytes.pico.arrayBuffers
    const finalAB = resultado.memoriaBytes.aposGC?.arrayBuffers ?? resultado.memoriaBytes.finalNatural.arrayBuffers
    const deltaAB = finalAB - inicialAB
    const margemAB = 1 * MiB
    let abOk = true
    if (gcExposto && deltaAB > margemAB) abOk = false

    const inicialHeap = resultado.memoriaBytes.inicial.heapUsado
    const picoHeap = resultado.memoriaBytes.pico.heapUsado
    const finalHeap = resultado.memoriaBytes.aposGC?.heapUsado ?? resultado.memoriaBytes.finalNatural.heapUsado
    const deltaHeap = finalHeap - inicialHeap
    const margemHeap = 15 * MiB
    let heapOk = true
    if (gcExposto && deltaHeap > margemHeap) heapOk = false

    let filasOk = true
    for (const [nome, f] of Object.entries(resultado.filas)) {
      if (f.final.emCurso !== 0 || f.final.pendentes !== 0 || f.expiradas !== 0) filasOk = false
    }

    console.log('\n' + '='.repeat(80))
    console.log('RELATÓRIO DO TESTE DE SOAK (HIGH-WATER MARK E RESISTÊNCIA)')
    console.log('='.repeat(80))
    console.log(`Duração efetiva: ${formatarTempo(resultado.duracaoMs)} (${ciclo} ciclos completos, ${rodada} cenários executados)`)
    console.log(`Conversas distintas avaliadas: ${conversasTotal.toLocaleString('pt-BR')}`)
    console.log(`Tarefas admitidas/executadas: ${tarefasIniciadasTotal.toLocaleString('pt-BR')}`)
    console.log(`Total de mídias sintetizadas: ${reservasTotal.toLocaleString('pt-BR')} (${mb(totalBytesReservados)} MiB movimentados)`)
    console.log(`Recusas por sobrecarga (backpressure): ${resultado.filas.admissao.recusasSobrecarga.toLocaleString('pt-BR')}`)

    console.log('\n--- HIGH-WATER MARK E MÉTRICAS DO PLANO ---')
    console.log(`  RSS: inicial = ${mb(resultado.memoriaBytes.inicial.rss)} MiB | pico (HWM) = ${mb(resultado.memoriaBytes.pico.rss)} MiB | final natural = ${mb(resultado.memoriaBytes.finalNatural.rss)} MiB${resultado.memoriaBytes.aposGC ? ` | pós-GC = ${mb(resultado.memoriaBytes.aposGC.rss)} MiB` : ''}`)
    console.log(`  ArrayBuffers: inicial = ${mb(inicialAB)} MiB | pico = ${mb(picoAB)} MiB | final natural = ${mb(resultado.memoriaBytes.finalNatural.arrayBuffers)} MiB${resultado.memoriaBytes.aposGC ? ` | pós-GC = ${mb(finalAB)} MiB` : ''}`)
    console.log(`  Heap Usado: inicial = ${mb(inicialHeap)} MiB | pico = ${mb(picoHeap)} MiB | final natural = ${mb(resultado.memoriaBytes.finalNatural.heapUsado)} MiB${resultado.memoriaBytes.aposGC ? ` | pós-GC = ${mb(finalHeap)} MiB` : ''}`)
    console.log(`  Fila máxima (pendentes pico): admissão=${resultado.filas.admissao.picoPendentes}; socket=${resultado.filas.socket.picoPendentes}; rede=${resultado.filas.rede.picoPendentes}; cpu=${resultado.filas.cpu.picoPendentes}`)
    console.log(`  Fila máxima (em curso pico):  admissão=${resultado.filas.admissao.picoEmCurso}; socket=${resultado.filas.socket.picoEmCurso}; rede=${resultado.filas.rede.picoEmCurso}; cpu=${resultado.filas.cpu.picoEmCurso}`)
    console.log(`  Espera p95 (latência): admissão=${ms(resultado.filas.admissao.esperaMs.p95)} ms; socket=${ms(resultado.filas.socket.esperaMs.p95)} ms; rede=${ms(resultado.filas.rede.esperaMs.p95)} ms; cpu=${ms(resultado.filas.cpu.esperaMs.p95)} ms`)
    console.log(`  Recusas sobrecarga: admissão=${resultado.filas.admissao.recusasSobrecarga.toLocaleString('pt-BR')}; orçamento de mídia=${estadoOrcamento.recusas.toLocaleString('pt-BR')}`)

    console.log('\n--- SÉRIE TEMPORAL DE TENDÊNCIA (AMOSTRAS PERIÓDICAS) ---')
    console.log('Tempo       | Ciclo  | Cenário         | RSS (MiB) | Heap (MiB) | AB (MiB) | Chaves | Orçamento (B) | Recusas')
    console.log('-'.repeat(105))
    const passo = Math.max(1, Math.floor(resultado.serie.length / 25))
    const amostrasExibidas = resultado.serie.filter((_, idx) => idx % passo === 0 || idx === resultado.serie.length - 1)
    for (const s of amostrasExibidas) {
      const m = s.memoria
      console.log(
        `${s.tempoFormatado.padEnd(11)} | ` +
        `${String(s.ciclo).padEnd(6)} | ` +
        `${s.cenarioId.padEnd(15)} | ` +
        `${mb(m.rss).padStart(9)} | ` +
        `${mb(m.heapUsado).padStart(10)} | ` +
        `${mb(m.arrayBuffers).padStart(8)} | ` +
        `${String(s.chavesAtivas).padStart(6)} | ` +
        `${String(s.reservadosOrcamento).padStart(13)} | ` +
        `${String(s.recusasAdmissao).padStart(7)}`
      )
    }

    let inclinacaoTexto = 'n/a'
    if (resultado.serie.length >= 4) {
      const idxInicio = Math.floor(resultado.serie.length * 0.25)
      const idxFim = resultado.serie.length - 2
      const amostraInicio = resultado.serie[idxInicio]
      const amostraFim = resultado.serie[idxFim]
      const deltaMin = (amostraFim.tempoMs - amostraInicio.tempoMs) / 60000
      if (deltaMin > 0) {
        const deltaHeapMiB = (amostraFim.memoria.heapUsado - amostraInicio.memoria.heapUsado) / MiB
        const taxaMin = deltaHeapMiB / deltaMin
        const statusTaxa = Math.abs(taxaMin) < 0.2 ? 'ESTÁVEL (sem vazamento linear)' : (taxaMin >= 0.5 ? 'ALERTA (crescimento contínuo)' : 'MODERADO')
        inclinacaoTexto = `${taxaMin >= 0 ? '+' : ''}${taxaMin.toFixed(3)} MiB/min [${statusTaxa}]`
      }
    }
    console.log(`\nTendência linear de Heap (após aquecimento): ${inclinacaoTexto}`)

    console.log('\n' + '='.repeat(80))
    console.log('VEREDITOS EXPLÍCITOS DO TESTE DE SOAK')
    console.log('='.repeat(80))

    if (orcamentoOk) {
      console.log(`[PASSOU] Saldo do orçamento de mídia: 0 bytes retidos (total reservado = ${mb(estadoOrcamento.totalReservados)} MiB, total liberado = ${mb(estadoOrcamento.totalLiberados)} MiB em ${reservasTotal} operações; saldo fechou perfeitamente).`)
    } else {
      console.log(`[NÃO PASSOU] Saldo do orçamento de mídia: ${estadoOrcamento.reservados} bytes não devolvidos (deriva de ${estadoOrcamento.totalReservados - estadoOrcamento.totalLiberados} bytes)!`)
    }

    if (esteirasOk) {
      console.log(`[PASSOU] Mapa de esteiras por conversa: 0 chaves retidas após ${conversasTotal.toLocaleString('pt-BR')} conversas distintas (chaves.delete removeu todas as entradas).`)
    } else {
      console.log(`[NÃO PASSOU] Mapa de esteiras por conversa: ${chavesAdmissao} chaves retidas na admissão e ${chavesRecursos} nas filas de recursos!`)
    }

    if (!gcExposto) {
      console.log(`[AVISO] ArrayBuffers pós-GC: medição degradada (sem --expose-gc). Inicial = ${mb(inicialAB)} MiB | Pico = ${mb(picoAB)} MiB | Final natural = ${mb(finalAB)} MiB.`)
    } else if (abOk) {
      console.log(`[PASSOU] ArrayBuffers pós-GC: inicial = ${mb(inicialAB)} MiB, pico = ${mb(picoAB)} MiB, pós-GC = ${mb(finalAB)} MiB (delta = ${(deltaAB / 1024).toFixed(1)} KiB <= margem de 1.0 MiB). Memória binária desalocada.`)
    } else {
      console.log(`[NÃO PASSOU] ArrayBuffers pós-GC: retenção excessiva pós-GC! Inicial = ${mb(inicialAB)} MiB, pós-GC = ${mb(finalAB)} MiB (delta = ${mb(deltaAB)} MiB excede margem de 1.0 MiB).`)
    }

    if (!gcExposto) {
      console.log(`[AVISO] Heap usado pós-GC: medição degradada (sem --expose-gc). Inicial = ${mb(inicialHeap)} MiB | Pico = ${mb(picoHeap)} MiB | Final natural = ${mb(finalHeap)} MiB.`)
    } else if (heapOk) {
      console.log(`[PASSOU] Heap usado pós-GC: inicial = ${mb(inicialHeap)} MiB, pico = ${mb(picoHeap)} MiB, pós-GC = ${mb(finalHeap)} MiB (delta = ${mb(deltaHeap)} MiB <= margem de 15.0 MiB). Sem retenção progressiva de objetos.`)
    } else {
      console.log(`[NÃO PASSOU] Heap usado pós-GC: retenção excessiva no heap! Inicial = ${mb(inicialHeap)} MiB, pós-GC = ${mb(finalHeap)} MiB (delta = ${mb(deltaHeap)} MiB excede margem de 15.0 MiB).`)
    }

    if (filasOk) {
      console.log(`[PASSOU] Drenagem das filas: 0 pendentes, 0 em curso, 0 expiradas em todas as filas (admissão, socket, rede, cpu).`)
    } else {
      console.log(`[NÃO PASSOU] Filas não drenaram adequadamente no desligamento!`)
    }

    if (erros.length === 0) {
      console.log(`[PASSOU] Integridade de execução: nenhum erro interno no motor ou gateway durante o soak.`)
    } else {
      console.log(`[NÃO PASSOU] Integridade de execução: ${erros.length} erros detectados:\n  ${erros.slice(0, 5).join('\n  ')}`)
    }

    console.log('='.repeat(80))

    console.log('\n--- O QUE ESTA MEDIÇÃO PROVA E O QUE ELA NÃO PROVA ---')
    console.log('PROVA:')
    console.log('  1. Que o Mapa de conversas de cada fila (chaves.delete em src/engine/fila.js)')
    console.log('     não acumula entradas-zumbi ao longo do tempo sob milhares de conversas distintas.')
    console.log('  2. Que o orçamento de bytes de mídia (criarOrcamentoDeMidia) não sofre deriva contábil')
    console.log('     nem vazamento de reservas após milhares de ciclos de aquisição e liberação.')
    console.log('  3. Que o runtime Node.js desaloca os backing stores de ArrayBuffer após o GC.')
    console.log('  4. Que o desligamento gracioso drena o trabalho em curso e recusa novas entradas.')
    console.log('NÃO PROVA:')
    console.log('  1. NÃO mede o gateway real falando com o WhatsApp nem tráfego de rede TCP/TLS de produção.')
    console.log('  2. NÃO inclui outros processos (SQLite em disco, transcrição Whisper, SO) nem criptografia real.')
    console.log('  3. NÃO garante devolução imediata de páginas de RSS pelo alocador C ao sistema operacional.')
    console.log('  4. NÃO constitui promessa de RAM de produto: medir primeiro na máquina real, prometer depois.')

    const passouTudo = orcamentoOk && esteirasOk && abOk && heapOk && filasOk && erros.length === 0
    if (passouTudo) {
      console.log('\n>>> VEREDITO GERAL: PASSOU EM TODOS OS REQUISITOS DE SOAK <<<\n')
    } else {
      console.log('\n>>> VEREDITO GERAL: NÃO PASSOU (HOUVE FALHAS ACIMA) <<<\n')
      process.exitCode = 1
    }

    const relatorioSoak = {
      tipo: 'soak',
      ambiente: {
        instanteInicio, instanteFim: new Date().toISOString(), duracaoMs: resultado.duracaoMs,
        node: process.version, v8: process.versions.v8, plataforma: process.platform, arch: process.arch,
        gcExposto, cpu: os.cpus()[0]?.model
      },
      metricasPlano: {
        rss: { inicial: resultado.memoriaBytes.inicial.rss, pico: resultado.memoriaBytes.pico.rss, finalNatural: resultado.memoriaBytes.finalNatural.rss, aposGC: resultado.memoriaBytes.aposGC?.rss ?? null },
        arrayBuffers: { inicial: inicialAB, pico: picoAB, finalNatural: resultado.memoriaBytes.finalNatural.arrayBuffers, aposGC: resultado.memoriaBytes.aposGC?.arrayBuffers ?? null },
        heapUsado: { inicial: inicialHeap, pico: picoHeap, finalNatural: resultado.memoriaBytes.finalNatural.heapUsado, aposGC: resultado.memoriaBytes.aposGC?.heapUsado ?? null },
        filaMaxima: {
          admissao: { picoPendentes: resultado.filas.admissao.picoPendentes, picoEmCurso: resultado.filas.admissao.picoEmCurso },
          socket: { picoPendentes: resultado.filas.socket.picoPendentes, picoEmCurso: resultado.filas.socket.picoEmCurso },
          rede: { picoPendentes: resultado.filas.rede.picoPendentes, picoEmCurso: resultado.filas.rede.picoEmCurso },
          cpu: { picoPendentes: resultado.filas.cpu.picoPendentes, picoEmCurso: resultado.filas.cpu.picoEmCurso }
        },
        esperaMs: {
          admissao: resultado.filas.admissao.esperaMs,
          socket: resultado.filas.socket.esperaMs,
          rede: resultado.filas.rede.esperaMs,
          cpu: resultado.filas.cpu.esperaMs
        },
        recusasSobrecarga: {
          admissao: resultado.filas.admissao.recusasSobrecarga,
          orcamentoMidia: estadoOrcamento.recusas
        }
      },
      totais: {
        ciclos: ciclo,
        conversasDistintas: conversasTotal,
        tarefasIniciadas: tarefasIniciadasTotal,
        reservasMidia: reservasTotal,
        bytesReservados: totalBytesReservados
      },
      vereditos: {
        orcamentoSaldoFechou: orcamentoOk,
        mapaEsteirasVazio: esteirasOk,
        arrayBuffersPosGcOk: abOk,
        heapUsadoPosGcOk: heapOk,
        filasDrenadasOk: filasOk,
        semErrosInternos: erros.length === 0,
        aprovado: passouTudo
      },
      serie: resultado.serie
    }
    console.log(`SOAK_JSON ${JSON.stringify(relatorioSoak)}`)
  } finally {
    process.off('SIGINT', aoInterromper)
    if (pastaTmp) fs.rmSync(pastaTmp, { recursive: true, force: true })
  }
}

const filho = process.argv.indexOf('--cenario')
if (filho !== -1) {
  const cenario = cenarios.find((c) => c.id === process.argv[filho + 1])
  assert.ok(cenario, 'Cenário conhecido')
  console.log(`CARGA_FILHO ${JSON.stringify(await executarCenario(cenario))}`)
} else if (process.argv.includes('--soak')) {
  await executarSoak()
} else {
  const ambiente = {
    instante: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    plataforma: process.platform, arquitetura: process.arch, kernel: os.release(),
    cpu: os.cpus()[0]?.model, cpusDisponiveis: os.availableParallelism(),
    gcExposto: typeof global.gc === 'function', flags: process.execArgv,
    modo: process.argv.includes('--leve') ? 'leve' : 'completo',
    intervaloAmostragemMs: 5, espera: 'entrada até invocação; apenas tarefas iniciadas; percentil por posto mais próximo',
    memoria: 'bytes; MiB = 1048576 bytes; picos observados no processo filho após imports; sem transporte real'
  }
  console.log('CARGA SINTÉTICA LOCAL — comparação, sem promessa de RAM de produto.')
  console.log(`CARGA_AMBIENTE ${JSON.stringify(ambiente)}`)
  if (!ambiente.gcExposto) console.log('Sem --expose-gc: final natural. Para comparar retenção após coleta: npm run carga.')
  const escolhidos = cenarios.filter((c) => ambiente.modo !== 'leve' || !c.orcamentoMiB || c.orcamentoMiB === 40)
  const resultados = []
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-relatorio-carga-'))
  try {
    for (const cenario of escolhidos) {
      // Arquivo temporário evita depender de pipes de subprocesso, que podem
      // dar EPERM em ambiente restrito. O filho escreve após medir a memória.
      const arquivo = path.join(pasta, `${cenario.id}.log`)
      const fd = fs.openSync(arquivo, 'w', 0o600)
      let filho
      try {
        // Timeout também cobre regressão que deixa uma porta ou fila sem drenar.
        filho = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--cenario', cenario.id], {
          stdio: ['ignore', fd, fd], timeout: 20000, killSignal: 'SIGKILL'
        })
      } finally { fs.closeSync(fd) }
      const saida = fs.readFileSync(arquivo, 'utf8')
      assert.ok(!filho.error && filho.status === 0, `${cenario.id}: ${filho.error?.message || filho.signal || filho.status}\n${saida}`)
      const linha = saida.split('\n').find((l) => l.startsWith('CARGA_FILHO '))
      assert.ok(linha, `${cenario.id} devolveu relatório\n${saida}`)
      const resultado = JSON.parse(linha.slice('CARGA_FILHO '.length))
      resultados.push(resultado)
      imprimir(resultado)
    }
  } finally { fs.rmSync(pasta, { recursive: true, force: true }) }
  for (const r of resultados.filter((r) => r.midia.picoReservados)) {
    // O corpo sintético não copia bytes no transporte. Esta folga detecta
    // retenção/alocação duplicada neste caminho, sem impor teto de RSS.
    const delta = r.memoriaBytes.pico.arrayBuffers - r.memoriaBytes.inicial.arrayBuffers
    assert.ok(delta >= r.midia.picoReservados - MiB, 'Amostragem viu os buffers efetivamente vivos')
    assert.ok(delta <= r.midia.picoReservados + 2 * MiB, 'Buffers sintéticos acompanham a reserva, sem cópia de um arquivo inteiro')
  }
  console.log(`\n${escolhidos.length} medições concluídas; ordem, paralelismo, recusa e drenagem conferidos.`)
  if (ambiente.modo === 'leve') console.log('Para comparar também os orçamentos de 80 e 200 MiB: npm run carga.')
}
