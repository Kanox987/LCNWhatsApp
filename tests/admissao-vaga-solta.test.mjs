// A vaga de admissão não pode ficar presa a um download.
//
// A chave da admissão é a CONVERSA: uma tarefa por conversa, em série. Quando
// `encaminharEventoAoMotor` aguardava `executarComandos` DENTRO da vaga, um
// `/play` esperando a API de download segurava o `/ping` da mesma conversa
// (foi o `/ping` de 32 s do dono), e oito downloads travados esgotavam todas
// as vagas e recusavam as outras conversas.
//
// Aqui tudo roda com a admissão REAL, os listeners REAIS e o encaminhamento
// REAL; só o WhatsApp e o motor são falsos, e a lentidão é uma porta que o
// teste abre — não depende de relógio apertado.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { criarAdmissaoDeEventos, registrarEntradaDeEventos } from '../src/connection.js'
import * as mediaRefCache from '../src/engine/mediaRefCache.js'
import { COMANDOS_CURTOS, COMANDOS_LONGOS, TIPOS_DE_COMANDO } from '../src/engine/gatewayExecutor.js'

let checagens = 0
const check = (nome, ok) => { assert.ok(ok, nome); checagens++; console.log(`✅ ${nome}`) }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const porta = () => {
  let abrir
  const promessa = new Promise((r) => { abrir = r })
  return { promessa, abrir }
}
async function ate (condicao, limiteMs = 1000) {
  const inicio = Date.now()
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) return false
    await esperar(5)
  }
  return true
}

const dono = (n) => `55119000${String(n).padStart(4, '0')}@s.whatsapp.net`
const bruto = (conversa, id, texto) => ({
  key: { id, remoteJid: conversa, fromMe: false },
  message: { conversation: texto },
  timestampSeconds: 1700000000
})

// Cada `/play` vira uma recuperação de mídia cuja leitura pendura numa porta;
// cada `/ping` vira uma resposta de texto.
let cenarios = 0
function ambiente ({ hardware = {} } = {}) {
  const cfg = { hardware: { admissaoConcorrencia: 8, maxPendentes: 512, admissaoLogJanelaMs: 20, ...hardware }, download: {} }
  const enviadas = []
  const confirmados = []
  const leituras = []
  const registros = []
  const client = Object.assign(new EventEmitter(), {
    message: {
      send: async (chatId, conteudo) => { enviadas.push({ chatId, conteudo }); return { key: { id: `S${enviadas.length}` } } },
      downloadBytes: (_, { signal } = {}) => {
        const p = porta()
        const leitura = { ...p, abortada: false, signal }
        leituras.push(leitura)
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => { leitura.abortada = true; reject(signal.reason) }, { once: true })
          p.promessa.then(() => resolve(new Uint8Array([1, 2, 3])))
        })
      }
    },
    getCredentials: () => ({ meJid: '5599:1@s.whatsapp.net' })
  })
  // Único entre cenários: o gateway lembra os comandos que já despachou.
  const prefixo = `c${++cenarios}`
  let seq = 0
  const clienteEngine = {
    eventos: {
      enviar: async (evento) => {
        const texto = evento?.message?.text
        const chatId = evento.chat.id
        const id = `${prefixo}-cmd-${++seq}`
        if (texto === '/play') {
          const mediaRef = mediaRefCache.criar({ node: { fileLength: 3 }, tipo: 'image' })
          return { results: [{ commands: [{ id, status: 'pending', commandType: 'whatsapp.recover', payload: { mediaRef, destination: 'chat', destinationId: chatId } }] }] }
        }
        return { results: [{ commands: [{ id, status: 'pending', commandType: 'whatsapp.reply', payload: { chatId, text: `pong ${evento.eventId}` } }] }] }
      }
    },
    execucoes: { confirmar: async (id, body) => { confirmados.push({ id, body }) } }
  }
  const registrar = (t) => registros.push(String(t))
  const admissao = criarAdmissaoDeEventos(cfg, { registrar })
  registrarEntradaDeEventos(client, clienteEngine, {
    admissao, obterContexto: () => ({ cfg, accountId: 'teste-vaga-solta' }), registrar
  })
  const pongs = () => enviadas.filter((e) => JSON.stringify(e.conteudo || {}).includes('pong'))
  return { client, admissao, enviadas, confirmados, leituras, registros, pongs }
}

// --- a) o /ping da MESMA conversa não espera o download ---------------------
{
  const a = ambiente()
  const chat = dono(1)
  a.client.emit('message', bruto(chat, 'P1', '/play'))
  check('o download começou e está pendurado na leitura', await ate(() => a.leituras.length === 1))
  a.client.emit('message', bruto(chat, 'G1', '/ping'))
  check('o /ping da mesma conversa responde enquanto o /play ainda baixa', await ate(() => a.pongs().length === 1, 500))
  check('o download continua pendente (nada foi cancelado nem concluído)', a.leituras[0].abortada === false && a.confirmados.length === 1)
  a.leituras[0].abrir()
  check('ao liberar a leitura, o /play termina e é confirmado', await ate(() => a.confirmados.length === 2))
  check('as duas confirmações são "sent"', a.confirmados.every((c) => c.body?.status === 'sent'))
  await a.admissao.encerrar()
}

// --- b) oito conversas travadas não derrubam a nona -------------------------
// A fila de rede deixa baixar dois por vez (downloadConcorrencia: 2); os outros
// seis esperam NELA, não na admissão. Antes, os oito seguravam as oito vagas.
{
  const a = ambiente()
  for (let i = 0; i < 8; i++) a.client.emit('message', bruto(dono(10 + i), `P${i}`, '/play'))
  check('dois downloads penduram (o limite da fila de rede) e seis esperam nela', await ate(() => a.leituras.length === 2))
  check('as oito vagas de admissão já foram devolvidas', await ate(() => a.admissao.estado.emCurso === 0))
  a.client.emit('message', bruto(dono(30), 'G9', '/ping'))
  check('a nona conversa é atendida com oito downloads pendentes', await ate(() => a.pongs().length === 1, 500))
  check('nenhuma recusa por sobrecarga foi registrada', a.admissao.estado.recusas === 0)
  let abertas = 0
  while (a.confirmados.length < 9) {
    for (; abertas < a.leituras.length; abertas++) a.leituras[abertas].abrir()
    await esperar(5)
    if (abertas > 8) break
  }
  check('liberados os downloads, todos são confirmados', await ate(() => a.confirmados.length === 9, 2000))
  await a.admissao.encerrar()
}

// --- c) o desligamento continua DRENANDO a cauda ----------------------------
// A vaga solta não pode virar trabalho solto: encerrar tem de esperar o que já
// começou, e `cancelarExternos` tem de continuar alcançando o download.
{
  const a = ambiente()
  a.client.emit('message', bruto(dono(40), 'P40', '/play'))
  check('(drenagem) o download pendurou', await ate(() => a.leituras.length === 1))
  let encerrou = false
  const encerramento = a.admissao.encerrar().then(() => { encerrou = true })
  await esperar(60)
  check('encerrar() não conclui enquanto a cauda do download está viva', encerrou === false)
  a.leituras[0].abrir()
  await encerramento
  check('liberada a leitura, encerrar() conclui', encerrou === true)
  check('e o comando da cauda chegou a ser confirmado antes do fim', a.confirmados.length === 1)
}
{
  const a = ambiente()
  a.client.emit('message', bruto(dono(41), 'P41', '/play'))
  check('(cancelamento) o download pendurou', await ate(() => a.leituras.length === 1))
  const encerramento = a.admissao.encerrar({ cancelarExternos: true })
  check('o desligamento aborta o download que já estava fora da vaga', await ate(() => a.leituras[0].abortada, 500))
  await encerramento
  check('e o encerramento conclui depois do aborto', a.admissao.estado.eventosAtivos === 0)
}

// --- d) erro na cauda segue o mesmo caminho de log --------------------------
{
  const a = ambiente()
  const original = a.client.message.send
  a.client.message.send = async () => { throw new Error('socket caiu') }
  a.client.emit('message', bruto(dono(50), 'G50', '/ping'))
  check('falha de envio não derruba nada e deixa a admissão limpa', await ate(() => a.admissao.estado.eventosAtivos === 0 && a.confirmados.length === 1))
  a.client.message.send = original
  await a.admissao.encerrar()
}

// --- e) toda ação do executor tem classe declarada --------------------------
// Uma ação nova entra na tabela do executor; sem classe, ela herdaria em
// silêncio o comportamento errado (segurar a vaga ou soltá-la cedo demais).
{
  const sem = TIPOS_DE_COMANDO.filter((t) => !COMANDOS_LONGOS.has(t) && !COMANDOS_CURTOS.has(t))
  check(`todo commandType do executor é "longo" ou "curto" (sem classe: ${sem.join(', ') || 'nenhum'})`, sem.length === 0)
  const dupla = TIPOS_DE_COMANDO.filter((t) => COMANDOS_LONGOS.has(t) && COMANDOS_CURTOS.has(t))
  check('nenhum commandType está nas duas classes', dupla.length === 0)
  const fantasma = [...COMANDOS_LONGOS, ...COMANDOS_CURTOS].filter((t) => !TIPOS_DE_COMANDO.includes(t))
  check(`nenhuma classe cita ação que o executor não tem (${fantasma.join(', ') || 'nenhuma'})`, fantasma.length === 0)
}

// --- f) desligar o interruptor devolve o comportamento antigo ---------------
{
  const a = ambiente({ hardware: { liberarVagaEmTrabalhoLongo: false } })
  const chat = dono(60)
  a.client.emit('message', bruto(chat, 'P60', '/play'))
  check('(interruptor desligado) o download pendurou', await ate(() => a.leituras.length === 1))
  a.client.emit('message', bruto(chat, 'G60', '/ping'))
  await esperar(80)
  check('com o interruptor desligado o /ping volta a esperar atrás do /play', a.pongs().length === 0)
  a.leituras[0].abrir()
  check('e responde assim que o /play termina', await ate(() => a.pongs().length === 1))
  await a.admissao.encerrar()
}

mediaRefCache._reiniciarParaTeste()
console.log(`\n${checagens} CHECAGENS PASSARAM`)
process.exit(0)
