import { AsyncLocalStorage } from 'node:async_hooks'
import { criarFila, normalizarPrioridade } from './fila.js'
import { limitesDeMidia } from '../mediaLimits.js'
import { maxPendentesEfetivo } from '../agent/concessoes.js'
import { sinalDoEvento, cancelarTrabalhoExterno } from './cancelamento.js'

// Paralelo ao relógio do envio: o cabeçalho acompanha toda a execução sem
// acrescentar argumentos aos caminhos de álbum, carrossel e futuras ações.
const contextoDoComando = new AsyncLocalStorage()

// A rapidez declarada no cabeçalho vence; sem ela, quem chama deduz pelo tipo
// do comando (o gateway sabe quais são longos).
export function comContextoDeComando (scheduling, filas, tarefa, { lento = false } = {}) {
  const declarado = scheduling?.speed
  return contextoDoComando.run({
    prioridade: normalizarPrioridade(scheduling?.priority),
    lento: declarado ? declarado === 'slow' : lento === true,
    filas
  }, tarefa)
}

export function prioridadeDoComando () {
  return contextoDoComando.getStore()?.prioridade || 'normal'
}

export function lentoDoComando () {
  return contextoDoComando.getStore()?.lento === true
}

export function filasDoComando () {
  return contextoDoComando.getStore()?.filas
}

export function criarFilasDeRecursos (cfg = {}, { aoMudar, agora } = {}) {
  const hardware = cfg?.hardware || {}
  const limites = limitesDeMidia(cfg)
  const opcoes = {
    maxPendentes: maxPendentesEfetivo(cfg), agingMs: hardware.agingMs,
    esperaMaximaMs: hardware.esperaMaximaMs, agora, aoMudar
  }
  // Só o socket tem vaga preferencial: é nele que o envio curto disputa com
  // o upload longo. Rede e CPU servem quase só trabalho lento.
  const filas = Object.fromEntries(Object.entries({
    socket: [hardware.comandosSimultaneos, hardware.vagasRapidas],
    rede: [limites.downloadConcorrencia, 0],
    cpu: [Number.isSafeInteger(hardware.cpuConcorrencia) && hardware.cpuConcorrencia > 0 ? hardware.cpuConcorrencia : 1, 0]
  }).map(([recurso, [limite, vagasRapidas]]) => [recurso, criarFila({ ...opcoes, recurso, limite, vagasRapidas })]))
  const recusasDeComandos = {}
  const avisos = { enviados: 0, recusados: 0, falharam: 0 }
  let politicasInvalidas = 0
  return {
    ...filas,
    executar (recurso, tarefa, { prioridade = prioridadeDoComando(), lento = lentoDoComando() } = {}) {
      if (!Object.hasOwn(filas, recurso)) throw new Error(`Recurso de execução desconhecido: ${recurso}`)
      const signal = recurso === 'rede' ? sinalDoEvento() : undefined
      return filas[recurso].executar(() => {
        // Esperar vaga não autoriza uma leitura nova depois do desligamento.
        // Socket e CPU conservam a drenagem, sem preempção de efeitos em curso.
        signal?.throwIfAborted()
        return tarefa()
      }, { prioridade, lento, signal }).catch((erro) => {
        if (signal?.aborted) throw signal.reason
        if (erro?.code === 'LCN_SEM_VAGA') cancelarTrabalhoExterno('recusa_admissao', erro.recurso || recurso)
        throw erro
      })
    },
    registrarRecusa (erro) {
      const recurso = erro.recurso || 'desconhecido'
      const contagem = recusasDeComandos[recurso] ||= { low: 0, normal: 0, high: 0, very_high: 0 }
      contagem[prioridadeDoComando()]++
    },
    registrarAviso (estado) { avisos[estado]++ },
    registrarPoliticaInvalida () { politicasInvalidas++ },
    get estado () {
      return {
        filas: Object.fromEntries(Object.entries(filas).map(([nome, fila]) => [nome, fila.estado])),
        recusasDeComandos: structuredClone(recusasDeComandos),
        avisos: { ...avisos }, politicasInvalidas
      }
    }
  }
}

// Construtores usados fora do gateway também têm limites. Dentro dele usam
// as filas da instância, compartilhando rede entre download e conexão.
export function executoresDeRecursos (cfg) {
  let locais
  const executar = (recurso, tarefa) => {
    const filas = contextoDoComando.getStore()?.filas || (locais ||= criarFilasDeRecursos(cfg))
    return filas.executar(recurso, tarefa)
  }
  return { rede: (tarefa) => executar('rede', tarefa), cpu: (tarefa) => executar('cpu', tarefa) }
}
