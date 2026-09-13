import { executarComandos } from '../src/engine/gatewayExecutor.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }
const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function criarMocks ({ erroEnvio = null } = {}) {
  const envios = []
  const confirmacoes = []
  return {
    envios,
    confirmacoes,
    client: {
      message: {
        send: async (...args) => {
          envios.push(args)
          if (erroEnvio) throw erroEnvio
        }
      }
    },
    clienteEngine: {
      execucoes: {
        confirmar: async (...args) => { confirmacoes.push(args) }
      }
    }
  }
}

const comandoReply = {
  id: 'cmd-1',
  commandType: 'whatsapp.reply',
  payload: { chatId: '5511999@s.whatsapp.net', text: 'pong' }
}

const sucesso = criarMocks()
await executarComandos(sucesso.client, [comandoReply], sucesso.clienteEngine)
check('whatsapp.reply chama send com chat e payload de texto corretos', iguais(sucesso.envios, [[
  '5511999@s.whatsapp.net', { type: 'text', text: 'pong' }
]]))
check('envio bem-sucedido confirma sent', iguais(sucesso.confirmacoes, [['cmd-1', { status: 'sent' }]]))

const desconhecido = criarMocks()
await executarComandos(desconhecido.client, [{ id: 'cmd-2', commandType: 'email.send', payload: {} }], desconhecido.clienteEngine)
check('tipo desconhecido não chama send', desconhecido.envios.length === 0)
check('tipo desconhecido confirma outcome_unknown', iguais(desconhecido.confirmacoes, [['cmd-2', { status: 'outcome_unknown' }]]))

const falhaEnvio = criarMocks({ erroEnvio: new Error('falha do Zapo') })
await executarComandos(falhaEnvio.client, [{ ...comandoReply, id: 'cmd-3' }], falhaEnvio.clienteEngine)
check('falha no send confirma failed', iguais(falhaEnvio.confirmacoes, [['cmd-3', { status: 'failed' }]]))

const comLatencia = criarMocks()
const receivedAtMs = Date.now() - 137
await executarComandos(comLatencia.client, [{
  id: 'cmd-lat', commandType: 'whatsapp.reply',
  payload: { chatId: '5511999@s.whatsapp.net', text: 'pong ({{latencyMs}}ms)', receivedAtMs }
}], comLatencia.clienteEngine)
const [, conteudoEnviado] = comLatencia.envios[0]
check('latência: placeholder vira número, não sobra "{{latencyMs}}"', !conteudoEnviado.text.includes('{{latencyMs}}'))
check('latência: texto final tem o formato "pong (<n>ms)"', /^pong \(\d+ms\)$/.test(conteudoEnviado.text))
check('latência: número condiz com o tempo decorrido (não é zero nem absurdo)', (() => {
  const n = Number(conteudoEnviado.text.match(/\((\d+)ms\)/)[1])
  return n >= 130 && n < 5000
})())

const semReceivedAtMs = criarMocks()
await executarComandos(semReceivedAtMs.client, [{
  id: 'cmd-sem-lat', commandType: 'whatsapp.reply',
  payload: { chatId: '5511999@s.whatsapp.net', text: 'pong ({{latencyMs}}ms)' }
}], semReceivedAtMs.clienteEngine)
check('sem receivedAtMs: placeholder fica intacto (não inventa número)', semReceivedAtMs.envios[0][1].text === 'pong ({{latencyMs}}ms)')

const falhaConfirmacao = criarMocks()
falhaConfirmacao.clienteEngine.execucoes.confirmar = async () => { throw new Error('motor indisponível') }
let lancouConfirmacao = false
try {
  await executarComandos(falhaConfirmacao.client, [{ ...comandoReply, id: 'cmd-4' }], falhaConfirmacao.clienteEngine)
} catch { lancouConfirmacao = true }
check('falha ao confirmar no motor nunca lança', lancouConfirmacao === false)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nGATEWAY EXECUTOR OK')
process.exit(falhas ? 1 : 0)
