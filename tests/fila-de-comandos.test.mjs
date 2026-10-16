// A FILA DE EXECUÇÃO DE COMANDO.
//
// O relato do dono: "quando foi solicitado várias requisições o bot ficou
// extremamente lento e não processou corretamente, teve até msg fora do
// carrossel como resposta do buscar".
//
// O log do número dele mostrou a causa, e não era o motor:
//
//   query node timeout { id: '56314.47116-46', timeoutMs: 15000 }
//
// É o socket do WhatsApp engasgado. Cada mensagem abria a sua própria cadeia e
// executava na hora: cinco buscas ao mesmo tempo são vinte e cinco capas
// subindo pela mesma conexão. O carrossel estourava o tempo e a queda mandava
// a lista em texto — foi a "msg fora do carrossel".
import { criarFila, LIMITE_PADRAO } from '../src/engine/fila.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const adiar = (ms) => new Promise((r) => setTimeout(r, ms))

// --- o limite é respeitado -----------------------------------------------
{
  const fila = criarFila({ limite: 2 })
  let emCurso = 0
  let maximo = 0
  const tarefa = async () => {
    emCurso++
    maximo = Math.max(maximo, emCurso)
    await adiar(10)
    emCurso--
  }
  await Promise.all(Array.from({ length: 8 }, () => fila.executar(tarefa)))
  check('nunca passa do limite', maximo === 2, `máximo simultâneo: ${maximo}`)
  check('e todas acabam', emCurso === 0)
  check('a fila fica vazia no fim', fila.estado.esperando === 0 && fila.estado.emCurso === 0)
}

// --- quem chegou primeiro sai primeiro -----------------------------------
{
  const fila = criarFila({ limite: 1 })
  const ordem = []
  await Promise.all(['a', 'b', 'c', 'd'].map((nome) => fila.executar(async () => {
    await adiar(5)
    ordem.push(nome)
  })))
  check('a ordem de chegada é a ordem de saída', ordem.join('') === 'abcd', ordem.join(''))
}

// --- o resultado e o erro atravessam a fila ------------------------------
{
  const fila = criarFila({ limite: 1 })
  check('o valor da tarefa volta para quem chamou', (await fila.executar(async () => 42)) === 42)

  let erro = null
  try { await fila.executar(async () => { throw new Error('estourou') }) } catch (e) { erro = e }
  check('o erro também volta, em vez de sumir', erro?.message === 'estourou', erro?.message)

  // UMA TAREFA QUE ESTOURA NÃO PODE SEGURAR A VAGA: sem o finally, a fila
  // trancaria para sempre depois do primeiro erro — e o bot ficaria mudo sem
  // nada no log.
  const depois = []
  await Promise.all([
    fila.executar(async () => { throw new Error('de novo') }).catch(() => depois.push('erro')),
    fila.executar(async () => { depois.push('seguinte') })
  ])
  check('a vaga é devolvida mesmo quando a tarefa falha', depois.includes('seguinte'), depois.join(','))
  check('e a fila termina limpa', fila.estado.emCurso === 0 && fila.estado.esperando === 0)
}

// --- o aviso de espera só sai quando houve espera ------------------------
{
  const avisos = []
  const fila = criarFila({ limite: 2, aoMudar: (estado) => { if (estado.esperando) avisos.push(estado) } })
  await fila.executar(async () => {})
  check('uma tarefa sozinha não anuncia fila nenhuma', avisos.length === 0, JSON.stringify(avisos))

  await Promise.all(Array.from({ length: 5 }, () => fila.executar(() => adiar(5))))
  check('com rajada, a espera é anunciada', avisos.length > 0)
  check('e o aviso diz quantas esperam e qual o limite',
    avisos[0].esperando >= 1 && avisos[0].limite === 2, JSON.stringify(avisos[0]))
}

// --- o padrão é dois, e é padrão, não teto -------------------------------
{
  check('o padrão é dois', LIMITE_PADRAO === 2, String(LIMITE_PADRAO))
  const folgada = criarFila({ limite: 8 })
  check('quem tem máquina folgada sobe', folgada.estado.limite === 8)
  // Limite inválido não pode virar fila de zero — isso trancaria tudo.
  for (const ruim of [0, -3, 'muitos', null, undefined, NaN]) {
    check(`limite inválido (${JSON.stringify(ruim)}) cai no padrão`, criarFila({ limite: ruim }).estado.limite === LIMITE_PADRAO)
  }
}

// --- A FILA ESTÁ NO SOCKET, NÃO NO COMANDO -------------------------------
//
// Este caso guarda uma correção de rumo. A primeira versão enfileirava o
// COMANDO INTEIRO, e o dono sentiu na hora: "sequer está respondendo ao ping
// agora direito". Um `/play` passa minutos esperando a API de download sem
// tocar na conexão, e segurando a vaga ele fazia um `/ping` esperar atrás de
// um download — o remédio ficou pior que a doença.
//
// O recurso disputado é o socket: enviar e subir mídia. Um comando longo tem
// que ocupar a conexão só nos instantes em que fala com ela.
{
  const { executarComandos } = await import('../src/engine/gatewayExecutor.js')
  const ordem = []
  const client = {
    getCredentials: () => ({ meJid: '5511900000002@s.whatsapp.net' }),
    message: {
      send: async (jid, c) => { ordem.push(`envio:${c?.text || 'midia'}`); return { ok: true, id: 'X' } },
      upload: async () => ({ url: 'u', directPath: '/u', mediaKey: 'k', fileSha256: 's', fileEncSha256: 'e', fileLength: 1, mediaKeyTimestamp: 1, mimetype: 'image/jpeg' })
    }
  }
  const clienteEngine = {
    execucoes: { confirmar: async () => ({ ok: true }) },
    conexoes: { resolvida: async () => ({ id: 'midia', endereco: 'http://x', autenticacao: { tipo: 'nenhuma' }, funcoes: [] }) }
  }

  // O comando LONGO: fica 150ms no serviço externo (sem tocar a conexão) e só
  // então envia. É o /play.
  const longo = executarComandos(client, [{
    id: 'longo',
    commandType: 'connection.call',
    payload: { chatId: 'c', conexao: 'midia', funcao: 'musica', entradas: {} }
  }], clienteEngine, {
    mediaRefCache: { resolver: () => null },
    baixarBuffer: async () => Buffer.from('x'),
    limiteBytes: 999,
    resolverJidProprio: () => '5511900000002@s.whatsapp.net',
    clienteEngine,
    criarExecutorDeConexao: () => ({
      executar: async () => {
        ordem.push('api:começou')
        await adiar(150)
        ordem.push('api:acabou')
        return { forma: 'texto', dados: 'pronto' }
      }
    })
  })

  // O comando CURTO chega logo depois: um /ping.
  await adiar(20)
  await executarComandos(client, [{ id: 'curto', commandType: 'whatsapp.reply', payload: { chatId: 'c', text: 'pong' } }], clienteEngine, {})
  await longo
  // A ordem completa conta a história: a API começou, o /ping respondeu no
  // meio, e só depois o download acabou e mandou o dele.
  check('o /ping responde sem esperar o download terminar',
    ordem.indexOf('envio:pong') < ordem.indexOf('api:acabou'), ordem.join(' · '))
  check('e o comando longo termina normalmente', ordem.includes('envio:pronto'), ordem.join(' · '))
}

// --- a espera na fila não conta para o relógio do envio ------------------
//
// "Por que as músicas que estou pedindo não estão sendo entregues?" A API
// entregou todas — o `/jobs` mostrava `pronto` —, e o comando terminava em
// `outcome_unknown` do nosso lado.
//
// Uma das causas: quem envia envolve o envio num relógio de 15 s, e com a fila
// no meio o tempo PARADO NA FILA entrava nessa conta. Numa rajada, a mensagem
// era dada como perdida sem o socket ter sido nem tocado. Trocar lentidão por
// mensagem perdida é pior que a lentidão.
{
  const { comTimeout, semContarAEspera } = await import('../src/engine/gatewayExecutor.js')
  const fila = criarFila({ limite: 1 })

  // Ocupa a única vaga por 80 ms.
  const ocupando = fila.executar(() => adiar(80))

  // O relógio é de 40 ms e a tarefa só começa depois dos 80 ms de espera. Com
  // a espera contando, isto estouraria; com o relógio rearmado na hora em que
  // a vez chega, passa.
  let resultado = null
  let erro = null
  try {
    resultado = await comTimeout(
      () => semContarAEspera((sinal) => fila.executar(async () => {
        sinal()
        await adiar(5)
        return 'enviado'
      })),
      40,
      'estourou'
    )
  } catch (e) { erro = e }
  await ocupando

  check('o tempo parado na fila não estoura o relógio do envio', resultado === 'enviado', erro?.message)

  // E o relógio continua valendo para o que demora DE VERDADE depois de
  // começar: a proteção não pode virar espera infinita.
  let estourou = null
  try {
    await comTimeout(
      () => semContarAEspera((sinal) => fila.executar(async () => {
        sinal()
        await adiar(200)
        return 'tarde demais'
      })),
      40,
      'estourou de verdade'
    )
  } catch (e) { estourou = e }
  check('mas o envio lento DEPOIS de começar ainda estoura', estourou?.code === 'LCN_TIMEOUT', estourou?.message)
}

// --- esperar para sempre é pior que esperar demais -----------------------
//
// O relógio de quem chamou fica PAUSADO enquanto a tarefa espera vez. Um item
// esquecido na fila deixaria a resposta pendurada para sempre — então a espera
// tem teto, e estourá-lo é um erro como outro qualquer.
{
  const fila = criarFila({ limite: 1, esperaMaximaMs: 30 })
  const segurando = fila.executar(() => adiar(120))
  let erro = null
  try { await fila.executar(async () => 'nunca chego') } catch (e) { erro = e }
  check('quem espera demais recebe erro em vez de ficar pendurado', erro?.code === 'LCN_TIMEOUT', erro?.message)
  check('e o erro diz quanto esperou', /esperou \d+s na fila/.test(erro?.message || ''), erro?.message)
  await segurando
  check('a fila continua funcionando depois disso', (await fila.executar(async () => 'ok')) === 'ok')
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nfila de comandos: tudo certo')
