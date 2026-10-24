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

const filho = process.argv.indexOf('--cenario')
if (filho !== -1) {
  const cenario = cenarios.find((c) => c.id === process.argv[filho + 1])
  assert.ok(cenario, 'Cenário conhecido')
  console.log(`CARGA_FILHO ${JSON.stringify(await executarCenario(cenario))}`)
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
