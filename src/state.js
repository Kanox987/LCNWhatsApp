// Estado compartilhado entre o bot e o dashboard (data/state.json).
// O bot escreve; o dashboard lê. Comunicação simples via arquivo, funciona igual
// em container (volume) ou seco.
import fs from 'fs'
import { ARQ_ESTADO, garantirPastas } from './paths.js'
import { criarMaquinaDeEstados, ESTADOS } from './connectionStateMachine.js'

const SAUDE_INICIAL = { falhasConsecutivas: 0, ultimoSucessoEm: null, status: 'ok', motivo: null, desde: null }

const INICIAL = {
  conectado: false,
  numero: null,
  nome: null,
  desde: null,
  pid: process.pid,
  iniciadoEm: Date.now(),
  metricas: {
    reconexoes: 0,
    quedas: 0,
    processadas: 0,   // visu única capturada e reenviada
    ignoradas: 0,     // (aprox.) mensagens que chegaram ao handler e foram descartadas
    ultimaCaptura: null,
    bytesBaixados: 0, // total baixado (mídia), acumulado desde este boot — painel de recursos (Parte C, Módulo 6)
    bytesEnviados: 0  // total reenviado (mídia), acumulado desde este boot
  },
  // saude.falhasConsecutivas é persistido (não só uma variável em memória em
  // connection.js) de propósito: precisa sobreviver a reinícios de processo
  // pra "N falhas seguidas sem sucesso" contar direito mesmo num ciclo
  // crash-restart-crash, não só dentro de uma única execução.
  saude: { ...SAUDE_INICIAL },
  // Máquina de estados formal da conexão — substitui o booleano `conectado`
  // como fonte primária de verdade. O campo `conectado` continua sendo escrito
  // para compatibilidade com consumidores antigos (dashboard terminal, etc.),
  // mas o ETag e as transições de estado vêm daqui.
  estadoConexao: null
}

// Instância singleton da máquina de estados — criada uma vez, reutilizada por
// todas as chamadas de definirQR/definirConexao/etc. O snapshot é gravado no
// state.json a cada transição, e restaurado no boot para que o contador de
// transições (e portanto o ETag) sobreviva a reinícios do processo.
const maquinaDeEstados = criarMaquinaDeEstados()

// Carrega saude.* do state.json existente, se houver — o resto de INICIAL
// (pid, iniciadoEm, métricas) reseta a cada boot de propósito, mas
// falhasConsecutivas PRECISA sobreviver a reinícios de processo (é o que dá
// sentido a "N falhas seguidas sem sucesso" cobrir um ciclo
// crash-restart-crash, não só uma execução). Sem isso, index.js chamando
// gravar() logo no boot sobrescreveria qualquer saude.* persistido com zero
// antes mesmo de iniciar() rodar — bug real encontrado em revisão de código.
function carregarSaudePersistida () {
  try {
    const bruto = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'))
    if (bruto?.saude && typeof bruto.saude === 'object') return { ...SAUDE_INICIAL, ...bruto.saude }
  } catch {}
  return { ...SAUDE_INICIAL }
}

// Restaura o snapshot da máquina de estados do disco (se existir) para que o
// contador de transições e o ETag sobrevivam a reinícios do processo. Sem
// isto, cada restart zeraria o contador e o frontend veria um ETag "novo"
// mesmo sem nenhuma mudança real de estado, invalidando o cache à toa.
const estadoConexaoPersistido = (() => {
  try {
    const bruto = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'))
    if (bruto?.estadoConexao && typeof bruto.estadoConexao === 'object') return bruto.estadoConexao
  } catch {}
  return null
})()
if (estadoConexaoPersistido) maquinaDeEstados.restaurar(estadoConexaoPersistido)

let estado = { ...INICIAL, metricas: { ...INICIAL.metricas }, saude: carregarSaudePersistida(), estadoConexao: maquinaDeEstados.snapshot() }
let timer = null

function agendarFlush () {
  clearTimeout(timer)
  timer = setTimeout(gravar, 250)
}

export function gravar () {
  try {
    garantirPastas()
    estado.memoriaMB = Math.round(process.memoryUsage().rss / 1048576)
    estado.atualizadoEm = Date.now()
    // Achado de revisão de segurança: state.json carrega o QR e o código de
    // pareamento (ambos permitem sequestrar o pareamento da conta enquanto
    // válidos) — sem modo explícito o arquivo herda o umask do processo
    // (visto 0664 nesta máquina), legível por outros usuários locais.
    // `mode` no writeFileSync só pega na CRIAÇÃO (open(2) só aplica o modo
    // quando O_CREAT cria o arquivo de fato) — como este arquivo já pode
    // existir de uma execução anterior com permissão mais aberta, o
    // chmodSync explícito é necessário pra corrigir isso de verdade.
    fs.writeFileSync(ARQ_ESTADO, JSON.stringify(estado, null, 2) + '\n', { mode: 0o600 })
    fs.chmodSync(ARQ_ESTADO, 0o600)
  } catch {}
}

// BATIMENTO: o arquivo é reescrito de tempos em tempos mesmo sem nada mudar.
//
// Sem isto, `atualizadoEm` só avança quando algo acontece — e um processo
// morto deixa um arquivo que parece atual por horas. Era a raiz do painel
// dizer "Conectado" sobre um número que não estava rodando: `conectado: true`
// ficava gravado e NADA o invalidava. Checagem de pid não resolve sozinha
// quando o número roda em outro container, porque o pid de lá não existe
// aqui; o arquivo, num volume compartilhado, atravessa.
//
// 30 segundos é curto o bastante para a tela não mentir por muito tempo e
// longo o bastante para ser I/O irrelevante. `unref` para o batimento nunca
// segurar o processo vivo sozinho.
export const BATIMENTO_MS = 30000
let batimento = null

export function iniciarBatimento (ms = BATIMENTO_MS) {
  if (batimento) return batimento
  batimento = setInterval(gravar, ms)
  if (typeof batimento.unref === 'function') batimento.unref()
  return batimento
}

export function pararBatimento () {
  if (batimento) clearInterval(batimento)
  batimento = null
}

export function definirConexao (info) {
  estado = { ...estado, ...info }
  // Transições da máquina de estados a partir do campo `conectado`:
  // true -> connected; false com saude terminal/quarentena -> terminal/quarantined;
  // false genérica -> reconnecting. O campo `conectado` continua sendo escrito
  // para compatibilidade retroativa, mas a fonte primária agora é a máquina.
  if (info.conectado === true) {
    maquinaDeEstados.marcarConectado()
  } else if (info.conectado === false) {
    const saudeStatus = info.saude?.status || estado.saude?.status
    if (saudeStatus === 'quarentena') {
      maquinaDeEstados.marcarQuarentena(info.saude?.motivo || estado.saude?.motivo)
    } else if (['logout', 'conflito', 'fatal_account'].includes(saudeStatus)) {
      maquinaDeEstados.marcarTerminal(info.saude?.motivo || estado.saude?.motivo)
    } else {
      maquinaDeEstados.marcarReconectando(info.saude?.motivo || estado.saude?.motivo)
    }
  }
  estado.estadoConexao = maquinaDeEstados.snapshot()
  agendarFlush()
}

// QR atual (string) pro painel renderizar. Limpo ao conectar.
// A máquina de estados transiciona para qr_ready SOMENTE se o hash do QR
// mudou — renovações periódicas do WhatsApp com o MESMO conteúdo não geram
// ETag novo e não invalidam o cache do frontend à toa.
export function definirQR (qr) {
  const mudou = maquinaDeEstados.definirQR(qr)
  estado.qr = qr
  estado.qrEm = Date.now()
  estado.estadoConexao = maquinaDeEstados.snapshot()
  // Só força flush imediato quando houve transição real de estado.
  if (mudou) gravar()
  else agendarFlush()
}

export function limparQR () {
  estado.qr = null
  estado.qrEm = null
  maquinaDeEstados.limparCredenciaisPareamento()
  estado.estadoConexao = maquinaDeEstados.snapshot()
  agendarFlush()
}

// Código de pareamento (modo --code) — mesmo espírito do QR: hoje só ia pro
// log do processo, sem jeito de um painel (terminal remoto ou web) ler sem
// depender de stdout. Persistido igual ao QR pro agente conseguir expor via
// API sem precisar acompanhar logs.
export function definirCodigoPareamento (codigo) {
  const mudou = maquinaDeEstados.definirCodigoPareamento(codigo)
  estado.codigoPareamento = codigo
  estado.codigoPareamentoEm = Date.now()
  estado.estadoConexao = maquinaDeEstados.snapshot()
  if (mudou) gravar()
  else agendarFlush()
}

export function limparCodigoPareamento () {
  estado.codigoPareamento = null
  estado.codigoPareamentoEm = null
  maquinaDeEstados.limparCredenciaisPareamento()
  estado.estadoConexao = maquinaDeEstados.snapshot()
  agendarFlush()
}

// Expõe o snapshot atual da máquina de estados para consumidores externos
// (instanceService.pareamento usa isto para derivar o ETag da resposta).
export function lerEstadoConexao () {
  return maquinaDeEstados.snapshot()
}

export function incr (chave, n = 1) {
  if (estado.metricas[chave] === undefined) estado.metricas[chave] = 0
  estado.metricas[chave] += n
  agendarFlush()
}

export function marcarCaptura () {
  estado.metricas.processadas += 1
  estado.metricas.ultimaCaptura = Date.now()
  agendarFlush()
}

// Zera o contador de falhas consecutivas — só em conexão de verdade
// (status:'open'), nunca só por "o processo começou". É o que fecha o
// contador entre reinícios: sem sucesso real no meio, falhas de processos
// diferentes continuam somando rumo à quarentena.
export function registrarSucessoConexao () {
  estado.saude = { falhasConsecutivas: 0, ultimoSucessoEm: Date.now(), status: 'ok', motivo: null, desde: null }
  gravar()
}

// Retorna o contador atualizado (não só grava) de propósito: agendarFlush()
// é debounced (250ms) — quem chama isto e precisa decidir algo com o valor
// NA HORA (ex: já bateu o limiar de quarentena?) não pode confiar em
// state.ler() logo em seguida, porque o arquivo em disco ainda não foi
// atualizado (bug real encontrado em revisão de código — state.ler() sempre
// via ver o valor anterior nesse caso).
export function registrarFalhaConexao () {
  estado.saude = { ...estado.saude, falhasConsecutivas: (estado.saude?.falhasConsecutivas || 0) + 1 }
  agendarFlush()
  return estado.saude.falhasConsecutivas
}

// status: 'ok' | 'logout' | 'conflito' | 'fatal_account' | 'quarentena'.
export function definirSaude ({ status, motivo, desde }) {
  estado.saude = { ...estado.saude, status, motivo, desde }
  gravar()
}

export function ler () {
  try {
    return JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'))
  } catch {
    return null
  }
}
