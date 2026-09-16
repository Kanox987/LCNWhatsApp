// O caminho entre "o motor decidiu" e "o WhatsApp recebeu".
//
// Existe por causa de uma falha real: `encaminharEventoAoMotor` lia `cfg` como
// variável livre — a configuração é declarada dentro de `iniciar()`, e esta
// função mora fora dela. Toda automação que produz comando estourava
// ReferenceError ANTES de executar, e o `.catch(() => {})` apagava o erro.
//
// O sintoma foi o pior possível: o motor casava e gravava o comando, a aba
// Execuções mostrava `matched_live`, e o WhatsApp não recebia nada. Nenhum log,
// nenhuma falha registrada — o comando ficava `pending` para sempre.
//
// Nada aqui toca a rede: cliente de WhatsApp e cliente do motor são falsos.
import { encaminharEventoAoMotor } from '../src/connection.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const evento = {
  provider: 'zapo',
  accountId: 'conta-1',
  eventId: 'conta-1:5511@s.whatsapp.net:ABC',
  chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
  sender: { id: '5511@s.whatsapp.net', authoredBySelf: true },
  message: { kind: 'text', text: '/ping' }
}

const comandoPendente = {
  id: 'cmd-1',
  status: 'pending',
  commandType: 'whatsapp.reply',
  payload: { chatId: '5511@s.whatsapp.net', text: 'pong' }
}

function cenario (comandos) {
  const enviadas = []
  const confirmados = []
  const client = {
    message: { send: async (chatId, conteudo) => { enviadas.push({ chatId, conteudo }); return { key: { id: 'X' } } } },
    getCredentials: () => ({ meJid: '5599:1@s.whatsapp.net' })
  }
  const clienteEngine = {
    eventos: { enviar: async () => ({ results: [{ commands: comandos }] }) },
    execucoes: { confirmar: async (id, body) => { confirmados.push({ id, body }) } }
  }
  return { client, clienteEngine, enviadas, confirmados }
}

const cfg = { hardware: {}, download: {} }

// --- o caso que quebrou ---------------------------------------------------
{
  const c = cenario([comandoPendente])
  const registros = []
  await encaminharEventoAoMotor(c.client, c.clienteEngine, evento, cfg, (m) => registros.push(String(m)))

  check('o comando decidido pelo motor chega ao WhatsApp', c.enviadas.length === 1,
    `enviadas=${c.enviadas.length} · log=${registros.join(' | ')}`)
  check('vai para a conversa certa', c.enviadas[0]?.chatId === '5511@s.whatsapp.net')
  check('com o texto que o motor mandou', JSON.stringify(c.enviadas[0]?.conteudo || {}).includes('pong'))
  check('e o motor é avisado do resultado, para o comando sair de "pending"', c.confirmados.length === 1,
    JSON.stringify(c.confirmados))
  check('confirmado como enviado, não como falha', c.confirmados[0]?.body?.status === 'sent',
    JSON.stringify(c.confirmados[0]?.body))
  check('nenhuma falha silenciosa no caminho feliz', registros.length === 0, registros.join(' | '))
}

// --- comando já resolvido não é reenviado (at-most-once) ------------------
{
  const c = cenario([{ ...comandoPendente, status: 'sent' }])
  await encaminharEventoAoMotor(c.client, c.clienteEngine, evento, cfg, () => {})
  check('comando que já saiu não é enviado de novo', c.enviadas.length === 0)
}

// --- falhar aberto, mas DIZENDO ------------------------------------------
// Falha aqui não pode derrubar o emissor de eventos da conexão. Mas silêncio
// foi o que custou duas horas de bot mudo: agora o erro tem que aparecer.
{
  const registros = []
  const clienteQuebrado = { eventos: { enviar: async () => { throw new Error('motor fora do ar') } } }
  let estourou = false
  try {
    await encaminharEventoAoMotor({}, clienteQuebrado, evento, cfg, (m) => registros.push(String(m)))
  } catch { estourou = true }
  check('erro no caminho não derruba a conexão', estourou === false)
  // O sink falha ABERTO: devolve `ok: false` em vez de lançar. O motivo tem que
  // chegar ao log mesmo assim — foi por aqui que "o bot parou" ficou sem rastro.
  check('mas aparece no log com o motivo', registros.some((m) => /motor fora do ar/.test(m)), registros.join(' | '))
}

// --- sem `log`, continua sem estourar ------------------------------------
{
  const clienteQuebrado = { eventos: { enviar: async () => { throw new Error('x') } } }
  let estourou = false
  try { await encaminharEventoAoMotor({}, clienteQuebrado, evento, cfg, undefined) } catch { estourou = true }
  check('sem função de log, o erro ainda é engolido em vez de derrubar', estourou === false)
}

// --- esboço antes de decifrar NÃO vai ao motor ---------------------------
// O WhatsApp entrega a mesma mensagem duas vezes: um esboço sem conteúdo
// (`unknown`) e depois ela inteira. Como o eventId sai do id da mensagem, os
// dois são o MESMO evento para o at-most-once — que então devolve o resultado
// da primeira avaliação. A primeira não casa com nada (o tipo dela nem está na
// política de entrada), e a mensagem real morre em silêncio.
//
// Foi exatamente assim que um "/ping" mandado num grupo não respondeu, com 39%
// dos eventos gravados sendo esses esboços.
{
  const esboco = { ...evento, message: { kind: 'unknown' } }
  const c = cenario([comandoPendente])
  let enviouAoMotor = false
  c.clienteEngine.eventos.enviar = async () => { enviouAoMotor = true; return { results: [{ commands: [comandoPendente] }] } }
  await encaminharEventoAoMotor(c.client, c.clienteEngine, esboco, cfg, () => {})
  check('esboço "unknown" não chega ao motor', enviouAoMotor === false)
  check('e nada é enviado no WhatsApp por causa dele', c.enviadas.length === 0)

  // `unavailable` chega antes do reenvio da mensagem real e ocuparia o mesmo id.
  const indisponivel = { ...evento, message: { kind: 'unavailable' } }
  const c2 = cenario([comandoPendente])
  let enviou2 = false
  c2.clienteEngine.eventos.enviar = async () => { enviou2 = true; return { results: [] } }
  await encaminharEventoAoMotor(c2.client, c2.clienteEngine, indisponivel, cfg, () => {})
  check('"unavailable" também não chega ao motor', enviou2 === false)

  // E o que casa continua passando — a correção não pode calar o bot.
  for (const kind of ['text', 'image', 'video', 'audio', 'document', 'view_once']) {
    const c3 = cenario([])
    let passou = false
    c3.clienteEngine.eventos.enviar = async () => { passou = true; return { results: [] } }
    await encaminharEventoAoMotor(c3.client, c3.clienteEngine, { ...evento, message: { kind } }, cfg, () => {})
    check(`"${kind}" continua chegando ao motor`, passou === true)
  }
}

// --- a lista do gateway tem que bater com a do schema --------------------
// Divergir aqui é invisível: a automação salva, valida, publica e nunca
// dispara — ou, do outro lado, o gateway cala uma mensagem que casaria.
{
  const fs = await import('fs')
  const { TIPOS_QUE_CASAM } = await import('../src/engine/canonicalEvent.js')
  const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
  const doSchema = schema.properties.inputPolicy.properties.acceptedMessageKinds.items.enum
  check('os tipos que o gateway deixa passar são exatamente os que o motor aceita',
    JSON.stringify([...TIPOS_QUE_CASAM].sort()) === JSON.stringify([...doSchema].sort()),
    `gateway=${[...TIPOS_QUE_CASAM].sort().join(',')} schema=${[...doSchema].sort().join(',')}`)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO ENCAMINHAMENTO PASSARAM')
process.exit(falhas ? 1 : 0)
