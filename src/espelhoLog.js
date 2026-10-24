// O ESPELHO DE LOG COM ESCRITA ASSÍNCRONA E ROTAÇÃO EM EXECUÇÃO.
//
// O relato do problema no caminho crítico:
// Cada linha de log chamava `fs.appendFileSync` de forma síncrona.
// Em operação calma quase não se nota; mas com depuração ligada ou numa
// enxurrada de erros (quando a conexão cai em laço ou o tráfego acumula),
// cada linha parada esperando o disco trava a volta do event loop.
// Travar o loop justamente no momento em que o sistema está em crise é a
// pior resposta possível — o bot engasga e perde prazos de rede.
// Além disso, o tamanho do arquivo só era conferido na partida do processo.
// Um processo mantido no ar por semanas nunca mais rotacionava e crescia sem teto.
//
// A solução técnica:
//
//   - ESCRITA ASSÍNCRONA: um WriteStream absorve as linhas no fluxo normal.
//     O loop de eventos entrega a linha e segue em frente sem esperar o disco.
//   - ROTAÇÃO EM EXECUÇÃO: medimos o tamanho acumulado. Ao atingir o teto
//     (padrão de 1 MB), o stream é fechado, o arquivo é renomeado para ".1"
//     e um novo stream nasce limpo. O processo não precisa ser reiniciado.
//   - PRESERVAÇÃO NA PARTIDA: ao subir, se o arquivo exceder o teto, ele é
//     rotacionado imediatamente; se estiver abaixo do teto, é aproveitado
//     em modo append sem descartar o histórico recente.
//
// O DILEMA DA ÚLTIMA LINHA (process.exit):
//
// Um stream em buffer guarda dados na memória do Node. Se `process.exit()`
// for disparado de forma síncrona, o runtime do Node aborta o processo
// na hora e descarta o que ainda não desceu pro disco. Se a última linha
// for justamente a mensagem que explica a causa da morte, trocar lentidão
// por cegueira é fatal.
//
// Por que escolhemos ESVAZIAR O BUFFER ANTES DE SAIR + ESCRITA SÍNCRONA NA SAÍDA:
//
//   1. Por que NÃO manter appendFileSync só em console.error:
//      Numa enxurrada de falhas, console.error é o que mais dispara — manter
//      escrita síncrona nele deixaria o event loop congelado no pior momento.
//      Além disso, muitas falhas críticas de conexão são registradas pelo
//      console.log regular, e misturar stream assíncrono com appendFileSync
//      direto inverte a ordem das linhas no arquivo.
//
//   2. Como garantimos a saída graciosa:
//      Nos pontos conhecidos de encerramento (SIGTERM, SIGINT, e a falha de
//      inicialização em index.js: iniciar().catch), a saída aguarda o método
//      `fechar()`. Esse método finaliza o WriteStream e só chama process.exit()
//      depois que o evento 'finish' confirmou a descarga física dos dados.
//
//   3. A comutação e recuperação síncrona na saída:
//      Assim que o encerramento começa (`saindo = true`), qualquer linha nova
//      passa imediatamente para escrita síncrona direta via appendFileSync.
//      Além disso, rastreamos em `pendentesNoStream` cada linha enviada ao
//      stream até o callback confirmar a escrita no SO. No gancho 'exit' de
//      emergência (fecharSincrono), qualquer linha ainda retida em memória
//      (inclusive se process.exit for chamado sem await) é gravada diretamente
//      com appendFileSync e o stream é destruído para evitar duplicidade.
//
// O QUE NÃO É GARANTIDO:
// Não há como proteger dados em memória contra SIGKILL (`kill -9`), queda
// abrupta de energia ou abort/segfault nativo do processo. Nesses casos, o
// sistema operacional mata o processo sem executar qualquer código de saída
// da aplicação.
import fs from 'fs'
import path from 'path'

export const TAMANHO_MAX_LOG = 1048576 // 1 MB (1024 * 1024)

export function formatarArgs (args) {
  return args.map((a) => {
    if (typeof a === 'string') return a
    if (a instanceof Error) return a.stack || a.message || String(a)
    try {
      const json = JSON.stringify(a)
      return json !== undefined ? json : String(a)
    } catch {
      return String(a)
    }
  }).join(' ')
}

export function contemArteAscii (texto) {
  return /[█▄▀]/.test(texto)
}

export function criarEspelhoLog ({
  arquivo,
  tamanhoMaximo = TAMANHO_MAX_LOG,
  aoRotacionar = null
} = {}) {
  if (!arquivo) throw new Error('Caminho do arquivo de log é obrigatório')

  const arquivoRotacionado = `${arquivo}.1`
  let stream = null
  let tamanhoAtual = 0
  let rotacionando = false
  let saindo = false
  const pendentesRotacao = []
  const pendentesNoStream = []

  let consoleLogOrig = null
  let consoleErrorOrig = null
  let ativo = false

  try {
    const dir = path.dirname(arquivo)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch {}

  function rotacionarArquivoSincrono () {
    try {
      if (fs.existsSync(arquivoRotacionado)) fs.rmSync(arquivoRotacionado, { force: true })
      if (fs.existsSync(arquivo)) fs.renameSync(arquivo, arquivoRotacionado)
    } catch {
      try { fs.rmSync(arquivo, { force: true }) } catch {}
    }
  }

  // Verificação inicial no arranque
  if (fs.existsSync(arquivo)) {
    try {
      const tam = fs.statSync(arquivo).size
      if (tam >= tamanhoMaximo) {
        rotacionarArquivoSincrono()
        tamanhoAtual = 0
      } else {
        tamanhoAtual = tam
      }
    } catch {
      tamanhoAtual = 0
    }
  }

  function abrirStream () {
    try {
      stream = fs.createWriteStream(arquivo, { flags: 'a' })
      stream.on('error', () => {})
    } catch {
      stream = null
    }
  }

  abrirStream()

  function rotacionar () {
    if (rotacionando) return
    rotacionando = true

    const velho = stream
    stream = null

    const finalizar = () => {
      rotacionarArquivoSincrono()
      tamanhoAtual = 0
      abrirStream()
      rotacionando = false

      try { aoRotacionar?.({ arquivo, arquivoRotacionado }) } catch {}

      if (pendentesRotacao.length > 0) {
        const lote = pendentesRotacao.splice(0, pendentesRotacao.length)
        for (const l of lote) {
          escreverLinha(l)
        }
      }
    }

    if (velho && !velho.destroyed && !velho.closed && !velho.writableEnded) {
      let callbackChamado = false
      const cbSeguro = () => {
        if (callbackChamado) return
        callbackChamado = true
        finalizar()
      }
      velho.once('error', cbSeguro)
      velho.end(cbSeguro)
    } else {
      finalizar()
    }
  }

  function escreverLinha (linhaComQuebra) {
    const bytes = Buffer.byteLength(linhaComQuebra, 'utf8')

    // Caminho de saída: gravação direta síncrona sem buffer
    if (saindo) {
      try {
        fs.appendFileSync(arquivo, linhaComQuebra)
        tamanhoAtual += bytes
      } catch {}
      return
    }

    // Se estiver no meio da rotação, aguarda na fila temporária em memória
    if (rotacionando) {
      pendentesRotacao.push(linhaComQuebra)
      tamanhoAtual += bytes
      return
    }

    // Verifica se atingiu ou vai atingir o limite de rotação
    if (tamanhoAtual + bytes >= tamanhoMaximo && tamanhoAtual > 0) {
      rotacionar()
      pendentesRotacao.push(linhaComQuebra)
      tamanhoAtual += bytes
      return
    }

    // Caminho quente: escrita assíncrona pelo WriteStream
    if (stream && !stream.destroyed && !stream.closed && !stream.writableEnded) {
      const item = { linha: linhaComQuebra }
      pendentesNoStream.push(item)
      try {
        stream.write(linhaComQuebra, 'utf8', () => {
          const idx = pendentesNoStream.indexOf(item)
          if (idx >= 0) pendentesNoStream.splice(idx, 1)
        })
        tamanhoAtual += bytes
      } catch {
        const idx = pendentesNoStream.indexOf(item)
        if (idx >= 0) pendentesNoStream.splice(idx, 1)
        try { fs.appendFileSync(arquivo, linhaComQuebra) } catch {}
      }
    } else {
      try {
        fs.appendFileSync(arquivo, linhaComQuebra)
        tamanhoAtual += bytes
      } catch {}
    }
  }

  function registrar (...args) {
    try {
      const linha = formatarArgs(args)
      if (!contemArteAscii(linha)) {
        escreverLinha(linha + '\n')
      }
    } catch {}
  }

  function iniciar () {
    if (ativo) return
    consoleLogOrig = console.log.bind(console)
    consoleErrorOrig = console.error.bind(console)

    console.log = (...args) => {
      consoleLogOrig(...args)
      registrar(...args)
    }
    console.error = (...args) => {
      consoleErrorOrig(...args)
      registrar(...args)
    }
    ativo = true
  }

  function restaurar () {
    if (!ativo) return
    if (consoleLogOrig) console.log = consoleLogOrig
    if (consoleErrorOrig) console.error = consoleErrorOrig
    consoleLogOrig = null
    consoleErrorOrig = null
    ativo = false
  }

  function fechar (timeoutMs = 1500) {
    return new Promise((resolve) => {
      let finalizado = false
      const terminar = () => {
        if (finalizado) return
        finalizado = true
        saindo = true
        resolve()
      }

      const timer = setTimeout(() => {
        try {
          if (pendentesNoStream.length > 0) {
            for (const item of pendentesNoStream) fs.appendFileSync(arquivo, item.linha)
            pendentesNoStream.length = 0
          }
          if (stream && !stream.destroyed) {
            try { stream.destroy() } catch {}
          }
        } catch {}
        terminar()
      }, timeoutMs)
      timer.unref?.()

      const aguardarEFechar = () => {
        if (rotacionando) {
          setImmediate(aguardarEFechar)
          return
        }

        if (pendentesRotacao.length > 0) {
          try {
            for (const l of pendentesRotacao) fs.appendFileSync(arquivo, l)
            pendentesRotacao.length = 0
          } catch {}
        }

        if (!stream || stream.destroyed || stream.closed || stream.writableEnded) {
          if (pendentesNoStream.length > 0) {
            try {
              for (const item of pendentesNoStream) fs.appendFileSync(arquivo, item.linha)
              pendentesNoStream.length = 0
            } catch {}
          }
          clearTimeout(timer)
          terminar()
          return
        }

        let cbChamado = false
        const cbSeguro = () => {
          if (cbChamado) return
          cbChamado = true
          clearTimeout(timer)
          terminar()
        }
        stream.once('error', cbSeguro)
        stream.end(cbSeguro)
      }

      aguardarEFechar()
    })
  }

  function fecharSincrono () {
    saindo = true
    try {
      if (pendentesRotacao.length > 0) {
        for (const l of pendentesRotacao) fs.appendFileSync(arquivo, l)
        pendentesRotacao.length = 0
      }
      if (pendentesNoStream.length > 0) {
        for (const item of pendentesNoStream) {
          try { fs.appendFileSync(arquivo, item.linha) } catch {}
        }
        pendentesNoStream.length = 0
      }
      if (stream && !stream.destroyed) {
        try { stream.destroy() } catch {}
      }
      if (stream && typeof stream.fd === 'number' && stream.fd > 0) {
        try { fs.fsyncSync(stream.fd) } catch {}
      }
    } catch {}
  }

  return {
    iniciar,
    restaurar,
    escrever: (str) => {
      if (!contemArteAscii(str)) {
        escreverLinha(str.endsWith('\n') ? str : str + '\n')
      }
    },
    rotacionar,
    fechar,
    fecharSincrono,
    get tamanhoAtual () { return tamanhoAtual },
    get rotacionando () { return rotacionando },
    get stream () { return stream },
    get saindo () { return saindo },
    get arquivo () { return arquivo },
    get arquivoRotacionado () { return arquivoRotacionado }
  }
}

export function iniciarEspelhoLog (opcoes) {
  const espelho = criarEspelhoLog(opcoes)
  espelho.iniciar()
  return espelho
}
