import { enviarEventoAoMotor } from '../src/engine/gatewaySink.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const evento = { eventId: 'evt-1' }
const results = [{ automationId: 'ping', status: 'matched_live', commands: [] }]

const sucesso = await enviarEventoAoMotor({
  eventos: { enviar: async (recebido) => ({ eventId: recebido.eventId, results }) }
}, evento)
check('sucesso devolve ok=true', sucesso.ok === true)
check('sucesso devolve os results do motor', sucesso.results === results)

let lancouErroRede = false
let erroRede
try {
  erroRede = await enviarEventoAoMotor({
    eventos: { enviar: async () => { throw new Error('ECONNREFUSED') } }
  }, evento)
} catch { lancouErroRede = true }
check('erro de rede nunca lança', lancouErroRede === false)
check('erro de rede devolve ok=false e motivo', erroRede?.ok === false && erroRede.motivo.includes('ECONNREFUSED'))

let lancouTimeout = false
let timeout
try {
  timeout = await enviarEventoAoMotor({
    eventos: { enviar: () => new Promise(() => {}) }
  }, evento, { timeoutMs: 15 })
} catch { lancouTimeout = true }
check('timeout nunca lança', lancouTimeout === false)
check('timeout devolve ok=false e motivo', timeout?.ok === false && timeout.motivo.includes('timeout'))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nGATEWAY SINK OK')
process.exit(falhas ? 1 : 0)
