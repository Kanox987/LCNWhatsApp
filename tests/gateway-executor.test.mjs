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
// Sem `replyTo` não há citação, e a opção vai `undefined` — a mensagem sai
// solta de propósito.
check('whatsapp.reply chama send com chat e payload de texto corretos', iguais(sucesso.envios, [[
  '5511999@s.whatsapp.net', { type: 'text', text: 'pong' }, undefined
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

// --- MARCAR a mensagem: contrato da biblioteca, não o nosso palpite --------
// A citação é OPÇÃO DE ENVIO (3º argumento do send), nunca campo do conteúdo.
// A versão anterior mandava `contextInfo: { quoted: { key } }` DENTRO do
// conteúdo; `quoted` não existe no contrato, campo desconhecido é descartado
// sem erro, e toda citação deste bot saía silenciosamente sem marcar nada.
//
// Por isso os casos abaixo olham o TERCEIRO argumento, e um deles proíbe
// explicitamente a forma antiga: um teste que só olhasse "tem contextInfo"
// passaria com o bug de volta.
{
  const replyTo = { remoteJid: '5511999@s.whatsapp.net', id: 'MSG123', fromMe: false, participant: '5511888@s.whatsapp.net' }
  const m = criarMocks()
  await executarComandos(m.client, [{ ...comandoReply, id: 'cmd-cit', payload: { ...comandoReply.payload, replyTo } }], m.clienteEngine)

  const [destino, conteudo, opcoes] = m.envios[0]
  check('a citação vai nas OPÇÕES do envio, não no conteúdo', !!opcoes?.quote, JSON.stringify(opcoes))
  check('e o conteúdo não carrega contextInfo inventado', !('contextInfo' in conteudo), JSON.stringify(conteudo))
  check('a citação traz o id da mensagem marcada', opcoes.quote.id === 'MSG123')
  check('e a conversa onde ela está', opcoes.quote.remoteJid === '5511999@s.whatsapp.net')
  check('e quem a enviou, que é o que identifica o autor em grupo', opcoes.quote.participant === '5511888@s.whatsapp.net')
  check('fromMe vem explícito, nunca ausente', opcoes.quote.fromMe === false)
  check('o destino continua sendo o chat do comando', destino === '5511999@s.whatsapp.net')

  // A forma antiga, agora proibida por teste.
  check('NÃO usa a chave "quoted", que a biblioteca ignora em silêncio',
    !JSON.stringify([conteudo, opcoes]).includes('"quoted"'))
}

{
  // Mensagem do próprio número marcada: `fromMe` precisa chegar true, senão o
  // WhatsApp não acha a mensagem citada.
  const replyTo = { remoteJid: '5511999@s.whatsapp.net', id: 'MEU1', fromMe: true }
  const m = criarMocks()
  await executarComandos(m.client, [{ ...comandoReply, id: 'cmd-eu', payload: { ...comandoReply.payload, replyTo } }], m.clienteEngine)
  const opcoes = m.envios[0][2]
  check('citar a própria mensagem preserva fromMe', opcoes.quote.fromMe === true)
  check('sem participant, a chave não inventa um', !('participant' in opcoes.quote), JSON.stringify(opcoes.quote))
}

// --- download: prometeu, então precisa dizer o que aconteceu ---------------
// O sintoma real: o bot mandou "⏳ Baixando…" e nunca mais falou. O arquivo
// tinha vindo inteiro — quem falhou foi o ENVIO ao WhatsApp — e esse caminho
// não avisava ninguém.
{
  const comandoDow = {
    id: 'cmd-dow',
    commandType: 'media.download',
    payload: {
      chatId: '5511999@s.whatsapp.net',
      url: 'https://exemplo/video',
      ackText: '⏳ Baixando…',
      errorText: 'Não consegui: {{erro}}',
      replyTo: { remoteJid: '5511999@s.whatsapp.net', id: 'LINK1', fromMe: false }
    }
  }
  const midiaFalsa = { tipo: 'video', mime: 'video/mp4', nome: 'v.mp4', descricao: null, buffer: Buffer.alloc(3 * 1024 * 1024) }
  const deps = { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => midiaFalsa }) }

  // Envio da mídia falha; o aviso inicial (texto) passa.
  const envios = []
  const client = {
    message: {
      send: async (chat, conteudo, opcoes) => {
        envios.push({ chat, conteudo, opcoes })
        if (conteudo.type === 'video') throw new Error('The operation was aborted')
      }
    }
  }
  const confirmacoes = []
  const clienteEngine = { execucoes: { confirmar: async (id, body) => confirmacoes.push([id, body]) } }

  await executarComandos(client, [comandoDow], clienteEngine, deps)

  const textos = envios.filter((e) => e.conteudo.type === 'text').map((e) => e.conteudo.text)
  check('avisa que começou', textos.some((t) => t.includes('Baixando')))
  check('e AVISA que não conseguiu entregar, em vez de sumir', textos.length === 2, JSON.stringify(textos))
  check('o aviso diz o tamanho do que foi baixado', /3,0 MB/.test(textos[1] || ''), textos[1])
  check('e repassa o motivo cru para dar o que investigar', /aborted/.test(textos[1] || ''), textos[1])
  check('o aviso de falha também marca a mensagem do link',
    envios[envios.length - 1].opcoes?.quote?.id === 'LINK1')
  check('a mídia é enviada marcando a mensagem do link',
    envios.find((e) => e.conteudo.type === 'video')?.opcoes?.quote?.id === 'LINK1')
  check('e o comando fica como falha, nunca como enviado',
    confirmacoes[0]?.[1]?.status === 'failed', JSON.stringify(confirmacoes))
}

{
  // Caminho feliz: a mídia sai uma vez só, e nenhum aviso de erro aparece.
  const envios = []
  const client = { message: { send: async (chat, conteudo, opcoes) => envios.push({ conteudo, opcoes }) } }
  const confirmacoes = []
  const deps = {
    mediaRefCache: {},
    criarBaixador: () => ({ baixar: async () => ({ tipo: 'video', mime: 'video/mp4', nome: 'v.mp4', descricao: 'Título', buffer: Buffer.alloc(10) }) })
  }
  await executarComandos(client, [{
    id: 'cmd-ok',
    commandType: 'media.download',
    payload: { chatId: 'c@s.whatsapp.net', url: 'https://x/y', ackText: '⏳', errorText: 'erro: {{erro}}' }
  }], { execucoes: { confirmar: async (id, body) => confirmacoes.push([id, body]) } }, deps)

  check('no caminho feliz saem duas mensagens: o aviso e a mídia', envios.length === 2, String(envios.length))
  check('e a última é a mídia', envios[1].conteudo.type === 'video')
  check('a descrição do serviço vira legenda quando não há legenda própria', envios[1].conteudo.caption === 'Título')
  check('o mimetype acompanha a mídia, senão a biblioteca recusa vídeo', envios[1].conteudo.mimetype === 'video/mp4')
  check('e o comando é confirmado como enviado', confirmacoes[0]?.[1]?.status === 'sent')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nGATEWAY EXECUTOR OK')
process.exit(falhas ? 1 : 0)
