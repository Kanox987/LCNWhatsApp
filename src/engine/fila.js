// A FILA DE EXECUÇÃO DE COMANDO.
//
// O relato do dono: "quando foi solicitado várias requisições o bot ficou
// extremamente lento e não processou corretamente, teve até msg fora do
// carrossel como resposta do buscar".
//
// O log do número dele mostra a causa, e ela não é o motor:
//
//   query node timeout { id: '56314.47116-46', timeoutMs: 15000 }
//   [engine] Falha ao executar o comando ... (connection.call):
//            Error: query timeout (56314.47116-46) after 15000ms
//
// É o SOCKET DO WHATSAPP engasgado. Cada mensagem que chega abre a sua própria
// cadeia de promessas e executa os comandos dela na hora, sem ninguém contando
// quantas estão em curso. Cinco `/buscar` ao mesmo tempo são vinte e cinco
// capas baixadas e vinte e cinco enviadas ao servidor de mídia — tudo pela
// mesma conexão, ao mesmo tempo. O que sobra é timeout: o carrossel não sai, a
// queda manda a lista em texto (foi a "msg fora do carrossel"), e o que estava
// atrás espera.
//
// O recurso disputado é a CONEXÃO, que é uma só. Então existe uma fila, e ela
// tem três propriedades que importam:
//
//   - LIMITE, não serialização. Serializar tudo faria um "/ping" esperar dois
//     minutos atrás de uma melhoria de foto em 4K. O limite deixa os rápidos
//     passarem e impede a enxurrada.
//   - JUSTIÇA. A urgência escolhe a próxima tarefa; envelhecer a espera
//     impede que chegadas urgentes adiem as antigas para sempre. Empates
//     preservam a ordem de entrada, inclusive na escolha de quem sai.
//   - FALHA ISOLADA. Um comando que estoura não pode derrubar a fila nem
//     segurar a vaga: tanto sucesso quanto falha devolvem a vaga.
//
// O número do limite é configurável e o padrão é dois. Padrão sensato sim,
// teto no código não — quem rodar numa máquina folgada sobe, quem estiver em
// 3,8 GB de RAM com IA do lado desce.
import { AsyncResource } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'

export const LIMITE_PADRAO = 2
export const MAX_PENDENTES_PADRAO = 256
export const AGING_MS_PADRAO = 10000
export const ESPERA_MAXIMA_MS = 180000
export const PRIORIDADES = Object.freeze({ low: 0, normal: 1, high: 2, very_high: 3 })

export function normalizarPrioridade (prioridade) {
  return Object.hasOwn(PRIORIDADES, prioridade) ? prioridade : 'normal'
}

function inteiro (valor, padrao, minimo = 1) {
  return Number.isSafeInteger(valor) && valor >= minimo ? valor : padrao
}

export function criarFila ({
  limite = LIMITE_PADRAO, maxPendentes = MAX_PENDENTES_PADRAO,
  agingMs = AGING_MS_PADRAO, esperaMaximaMs = ESPERA_MAXIMA_MS,
  recurso = 'execucao', aoMudar = null, agora = () => performance.now()
} = {}) {
  const teto = inteiro(limite, LIMITE_PADRAO)
  const capacidade = inteiro(maxPendentes, MAX_PENDENTES_PADRAO, 0)
  const envelhecimento = inteiro(agingMs, AGING_MS_PADRAO)
  const prazo = inteiro(esperaMaximaMs, ESPERA_MAXIMA_MS)
  const esperando = []
  let emCurso = 0
  let sequencia = 0
  const metricas = {
    picoEmCurso: 0, picoPendentes: 0, iniciadas: 0, concluidas: 0,
    recusas: 0, deslocadas: 0, expiradas: 0,
    recusasPorPrioridade: { low: 0, normal: 0, high: 0, very_high: 0 },
    esperaTotalMs: 0, esperaMaximaMs: 0, esperasMedidas: 0
  }
  const estado = () => ({
    recurso, emCurso, esperando: esperando.length, limite: teto,
    maxPendentes: capacidade, agingMs: envelhecimento,
    ...metricas, recusasPorPrioridade: { ...metricas.recusasPorPrioridade }
  })
  const avisar = () => {
    // Observação não pode tirar a vaga nem esconder o resultado da operação.
    try { aoMudar?.(estado()) } catch (erro) { console.warn(`[fila] Falha ao observar ${recurso}: ${erro?.message || erro}`) }
  }
  const efetiva = (item, instante) => item.prioridadeBase + Math.floor(Math.max(0, instante - item.entrouEmMs) / envelhecimento)
  const medirEspera = (item, instante) => {
    const ms = Math.max(0, instante - item.entrouEmMs)
    metricas.esperaTotalMs += ms
    metricas.esperaMaximaMs = Math.max(metricas.esperaMaximaMs, ms)
    metricas.esperasMedidas++
  }
  const comparar = (a, b, instante) => efetiva(a, instante) - efetiva(b, instante) || b.sequencia - a.sequencia

  function recusar (item, motivo, instante) {
    clearTimeout(item.relogio)
    metricas.recusas++
    metricas.recusasPorPrioridade[item.prioridade]++
    if (motivo === 'deslocada') metricas.deslocadas++
    medirEspera(item, instante)
    const erro = new Error(`Sem vaga na fila ${recurso}: ${motivo}; ${esperando.length}/${capacidade} pendentes.`)
    Object.assign(erro, { code: 'LCN_SEM_VAGA', recurso, prioridade: item.prioridade, motivo })
    item.rejeitar(erro)
  }

  function iniciar (item, instante) {
    clearTimeout(item.relogio)
    medirEspera(item, instante)
    emCurso++
    metricas.iniciadas++
    metricas.picoEmCurso = Math.max(metricas.picoEmCurso, emCurso)
    // A admissão ocupa a vaga antes da microtarefa: 10 mil tarefas instantâneas
    // na mesma volta não podem passar pela verificação vendo a mesma vaga livre.
    Promise.resolve().then(item.tarefa).then(
      (valor) => terminar(item, null, valor),
      (erro) => terminar(item, erro, undefined, true)
    )
  }

  function terminar (item, erro, valor, falhou = false) {
    emCurso--
    metricas.concluidas++
    seguir()
    avisar()
    if (falhou) item.rejeitar(erro)
    else item.resolver(valor)
  }

  function seguir () {
    while (emCurso < teto && esperando.length) {
      const instante = agora()
      let melhor = 0
      for (let i = 1; i < esperando.length; i++) {
        if (comparar(esperando[i], esperando[melhor], instante) > 0) melhor = i
      }
      iniciar(esperando.splice(melhor, 1)[0], instante)
    }
  }

  return {
    executar (tarefa, { prioridade = 'normal' } = {}) {
      return new Promise((resolver, rejeitar) => {
        if (typeof tarefa !== 'function') throw new TypeError('A fila recebe uma função para iniciar somente depois da admissão.')
        const instante = agora()
        prioridade = normalizarPrioridade(prioridade)
        const item = { tarefa, prioridade, prioridadeBase: PRIORIDADES[prioridade], entrouEmMs: instante, sequencia: sequencia++, resolver, rejeitar, relogio: null }
        if (emCurso >= teto && esperando.length >= capacidade) {
          let pior = 0
          for (let i = 1; i < esperando.length; i++) {
            if (comparar(esperando[i], esperando[pior], instante) < 0) pior = i
          }
          // Só urgência MAIOR desloca; empatar não rouba a vez da antiga.
          // Entre as piores empatadas sai a mais nova, preservando as antigas.
          if (!esperando.length || efetiva(item, instante) <= efetiva(esperando[pior], instante)) {
            recusar(item, 'fila_cheia', instante)
            avisar()
            return
          }
          recusar(esperando.splice(pior, 1)[0], 'deslocada', instante)
        }
        // A próxima tarefa é iniciada pela conclusão de OUTRO comando. Sem
        // capturar o contexto aqui, ela herdaria a prioridade e o relógio dele.
        item.tarefa = AsyncResource.bind(tarefa)
        if (emCurso < teto) iniciar(item, instante)
        else {
          item.relogio = setTimeout(() => {
            const posicao = esperando.indexOf(item)
            if (posicao === -1) return
            esperando.splice(posicao, 1)
            metricas.expiradas++
            medirEspera(item, agora())
            const erro = new Error(`esperou ${Math.round(prazo / 1000)}s na fila ${recurso} e desisti`)
            Object.assign(erro, { code: 'LCN_TIMEOUT', recurso })
            rejeitar(erro)
            avisar()
          }, prazo)
          item.relogio.unref?.()
          esperando.push(item)
          metricas.picoPendentes = Math.max(metricas.picoPendentes, esperando.length)
        }
        avisar()
      })
    },
    get estado () { return estado() }
  }
}
