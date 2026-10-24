// Testes do espelho de log assíncrono com WriteStream, rotação em execução
// e garantia de não-perda da última linha no encerramento (process.exit e SIGTERM).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import {
  criarEspelhoLog,
  iniciarEspelhoLog,
  formatarArgs,
  contemArteAscii,
  TAMANHO_MAX_LOG
} from '../src/espelhoLog.js'

let falhas = 0
const check = (nome, ok, extra) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`)
}

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-log-stream-test-'))

async function aguardar (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main () {
  try {
    // --- 1. Formatação e filtragem ---
    check(
      'formatarArgs preserva strings intactas',
      formatarArgs(['olá', 'mundo']) === 'olá mundo'
    )
    check(
      'formatarArgs formata números e booleanos',
      formatarArgs([42, true, null]) === '42 true null'
    )
    check(
      'formatarArgs serializa objetos em JSON',
      formatarArgs([{ teste: 1 }, [1, 2]]) === '{"teste":1} [1,2]'
    )
    const errExemplo = new Error('falha de conexão')
    check(
      'formatarArgs inclui stack ou mensagem de Error',
      formatarArgs([errExemplo]).includes('falha de conexão')
    )
    check(
      'contemArteAscii detecta blocos do QR code',
      contemArteAscii('bloco █') && contemArteAscii('bloco ▄') && contemArteAscii('bloco ▀')
    )
    check(
      'contemArteAscii ignora texto comum',
      !contemArteAscii('mensagem normal sem blocos 123 !@#')
    )

    // --- 2. Escrita assíncrona normal e ordem preservada ---
    const arqNormal = path.join(pastaTeste, 'normal.log')
    const espelhoNormal = criarEspelhoLog({ arquivo: arqNormal })
    espelhoNormal.iniciar()

    console.log('linha um log')
    console.error('linha dois error')
    console.log('bloco de qr █▄▀ ignorado')
    console.log('linha tres log')

    await espelhoNormal.fechar()
    espelhoNormal.restaurar()

    const conteudoNormal = fs.existsSync(arqNormal) ? fs.readFileSync(arqNormal, 'utf8') : ''
    const linhasNormais = conteudoNormal.trim().split('\n')

    check(
      'escrita assíncrona gravou 3 linhas no arquivo',
      linhasNormais.length === 3,
      `linhas=${linhasNormais.length}`
    )
    check(
      'ordem das linhas foi preservada',
      linhasNormais[0] === 'linha um log' &&
      linhasNormais[1] === 'linha dois error' &&
      linhasNormais[2] === 'linha tres log'
    )
    check(
      'não espelhou os blocos de QR no arquivo',
      !conteudoNormal.includes('█▄▀')
    )

    // --- 3. Rotação em execução ao ultrapassar o teto ---
    const arqRotacao = path.join(pastaTeste, 'rotacao.log')
    const arqRotacionado1 = `${arqRotacao}.1`
    let rotacionouAviso = false

    const tetoPequeno = 120
    const espelhoRot = criarEspelhoLog({
      arquivo: arqRotacao,
      tamanhoMaximo: tetoPequeno,
      aoRotacionar: () => { rotacionouAviso = true }
    })

    const bloco1 = 'A'.repeat(80)
    const bloco2 = 'B'.repeat(80) // 80 + 80 = 160 > 120, força rotação

    espelhoRot.escrever(bloco1)
    espelhoRot.escrever(bloco2)

    await aguardar(50)
    await espelhoRot.fechar()

    check('evento aoRotacionar disparou na rotação em execução', rotacionouAviso)
    check('arquivo rotacionado (.1) foi criado no disco', fs.existsSync(arqRotacionado1))

    const contRot1 = fs.existsSync(arqRotacionado1) ? fs.readFileSync(arqRotacionado1, 'utf8') : ''
    const contAtivo = fs.existsSync(arqRotacao) ? fs.readFileSync(arqRotacao, 'utf8') : ''

    check(
      'primeiro bloco foi preservado no arquivo rotacionado (.1)',
      contRot1.includes(bloco1)
    )
    check(
      'segundo bloco foi gravado no arquivo novo e ativo',
      contAtivo.includes(bloco2)
    )

    // --- 4. Rotação no arranque (arquivo já excede o teto) ---
    const arqArranqueGrande = path.join(pastaTeste, 'arranque-grande.log')
    const arqArranqueGrande1 = `${arqArranqueGrande}.1`
    const conteudoVelho = 'X'.repeat(300) + '\n'
    fs.writeFileSync(arqArranqueGrande, conteudoVelho)

    const espelhoArranque = criarEspelhoLog({
      arquivo: arqArranqueGrande,
      tamanhoMaximo: 200
    })

    check(
      'arquivo grande preexistente é rotacionado logo no arranque',
      fs.existsSync(arqArranqueGrande1) && fs.readFileSync(arqArranqueGrande1, 'utf8') === conteudoVelho
    )

    espelhoArranque.escrever('nova linha pós arranque')
    await espelhoArranque.fechar()

    const contArranqueAtivo = fs.readFileSync(arqArranqueGrande, 'utf8')
    check(
      'arquivo ativo contém apenas as novas linhas após rotação no arranque',
      contArranqueAtivo.trim() === 'nova linha pós arranque'
    )

    // --- 5. Preservação no arranque abaixo do teto (modo append) ---
    const arqArranquePequeno = path.join(pastaTeste, 'arranque-pequeno.log')
    fs.writeFileSync(arqArranquePequeno, 'linha anterior existente\n')

    const espelhoAppend = criarEspelhoLog({
      arquivo: arqArranquePequeno,
      tamanhoMaximo: 500
    })

    espelhoAppend.escrever('linha nova subsequente')
    await espelhoAppend.fechar()

    const contAppend = fs.readFileSync(arqArranquePequeno, 'utf8')
    check(
      'arquivo abaixo do teto preserva histórico anterior e faz append',
      contAppend.includes('linha anterior existente') && contAppend.includes('linha nova subsequente')
    )

    // --- 6. Não-perda da última linha na saída fatal (process.exit) ---
    // Simula um processo Node independente que escreve no log e morre com erro fatal
    const arqLogFatal = path.join(pastaTeste, 'filho-fatal.log')
    const scriptFatal = path.join(pastaTeste, 'filho-fatal.mjs')
    const moduloEspelho = path.resolve('src/espelhoLog.js')

    fs.writeFileSync(scriptFatal, `
      import { iniciarEspelhoLog } from ${JSON.stringify(moduloEspelho)}
      const espelho = iniciarEspelhoLog({ arquivo: ${JSON.stringify(arqLogFatal)} })

      console.log('processo filho iniciando')
      console.error('FATAL: conexão perdida e processo abortando com falha')

      async function encerrar (codigo) {
        await espelho.fechar()
        process.exit(codigo)
      }

      await encerrar(1)
    `)

    const filhoFatal = spawn(process.execPath, [scriptFatal])
    const codigoFatal = await new Promise((resolve) => filhoFatal.on('exit', resolve))

    check('processo filho saiu com código 1', codigoFatal === 1)
    const logFatalConteudo = fs.existsSync(arqLogFatal) ? fs.readFileSync(arqLogFatal, 'utf8') : ''
    check(
      'última linha de erro fatal foi gravada no arquivo antes do process.exit',
      logFatalConteudo.includes('FATAL: conexão perdida e processo abortando com falha')
    )
    check(
      'todas as linhas anteriores ao erro também foram salvas',
      logFatalConteudo.includes('processo filho iniciando')
    )

    // --- 7. Não-perda da última linha no sinal SIGTERM ---
    const arqLogSigterm = path.join(pastaTeste, 'filho-sigterm.log')
    const scriptSigterm = path.join(pastaTeste, 'filho-sigterm.mjs')

    fs.writeFileSync(scriptSigterm, `
      import { iniciarEspelhoLog } from ${JSON.stringify(moduloEspelho)}
      const espelho = iniciarEspelhoLog({ arquivo: ${JSON.stringify(arqLogSigterm)} })

      console.log('filho em execucao continua')

      process.on('SIGTERM', async () => {
        console.log('MSG_SIGTERM: recebido sinal de parada, encerrando...')
        await espelho.fechar()
        process.exit(0)
      })

      process.stdout.write('PRONTO\\n')
      setInterval(() => {}, 1000)
    `)

    const filhoSigterm = spawn(process.execPath, [scriptSigterm])
    await new Promise((resolve) => {
      filhoSigterm.stdout.on('data', (d) => {
        if (d.toString().includes('PRONTO')) resolve()
      })
    })

    filhoSigterm.kill('SIGTERM')
    const codigoSigterm = await new Promise((resolve) => filhoSigterm.on('exit', resolve))

    check('filho terminou graciosamente com código 0 sob SIGTERM', codigoSigterm === 0)
    const logSigtermConteudo = fs.existsSync(arqLogSigterm) ? fs.readFileSync(arqLogSigterm, 'utf8') : ''
    check(
      'mensagem de log disparada dentro do handler de SIGTERM foi persistida',
      logSigtermConteudo.includes('MSG_SIGTERM: recebido sinal de parada, encerrando...')
    )
    check(
      'mensagens anteriores ao SIGTERM também foram salvas',
      logSigtermConteudo.includes('filho em execucao continua')
    )

    // --- 8. fecharSincrono esvazia pendências mesmo em queda não-graciosa ---
    const arqSincrono = path.join(pastaTeste, 'sincrono.log')
    const espelhoSinc = criarEspelhoLog({ arquivo: arqSincrono, tamanhoMaximo: 200 })
    espelhoSinc.escrever('linha para sincronizar')
    espelhoSinc.fecharSincrono()

    check('fecharSincrono marca estado saindo', espelhoSinc.saindo)
    const contSincrono = fs.existsSync(arqSincrono) ? fs.readFileSync(arqSincrono, 'utf8') : ''
    check(
      'fecharSincrono grava os dados no arquivo',
      contSincrono.includes('linha para sincronizar')
    )

    // --- 9. Não-perda da última linha mesmo se process.exit(1) for chamado sem await ---
    const arqLogExitDireto = path.join(pastaTeste, 'filho-exit-direto.log')
    const scriptExitDireto = path.join(pastaTeste, 'filho-exit-direto.mjs')

    fs.writeFileSync(scriptExitDireto, `
      import { iniciarEspelhoLog } from ${JSON.stringify(moduloEspelho)}
      const espelho = iniciarEspelhoLog({ arquivo: ${JSON.stringify(arqLogExitDireto)} })
      process.on('exit', () => {
        espelho.fecharSincrono()
      })

      console.error('ERRO FATAL SEM AWAIT: morrendo imediatamente')
      process.exit(1)
    `)

    const filhoExitDireto = spawn(process.execPath, [scriptExitDireto])
    const codigoExitDireto = await new Promise((resolve) => filhoExitDireto.on('exit', resolve))

    check('processo filho exit direto saiu com código 1', codigoExitDireto === 1)
    const logExitDiretoConteudo = fs.existsSync(arqLogExitDireto) ? fs.readFileSync(arqLogExitDireto, 'utf8') : ''
    check(
      'fecharSincrono no hook exit salvou o erro fatal mesmo sem await no process.exit',
      logExitDiretoConteudo.includes('ERRO FATAL SEM AWAIT: morrendo imediatamente')
    )
  } finally {
    try { fs.rmSync(pastaTeste, { recursive: true, force: true }) } catch {}
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nLOG STREAM OK')
  process.exit(falhas ? 1 : 0)
}

main()
