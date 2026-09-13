// Bug real encontrado em revisão de código: state.js sempre partia de um
// estado zerado, e index.js chamava gravar() logo no boot — juntos,
// sobrescreviam saude.falhasConsecutivas persistido com zero antes mesmo do
// bot tentar conectar. Isso quebrava a promessa central da quarentena:
// contar falhas consecutivas MESMO entre reinícios de processo (um ciclo
// crash-restart-crash nunca acumularia rumo ao limiar).
//
// Testa via subprocesso (não import direto) porque state.js lê o arquivo
// UMA VEZ, no momento do import do módulo — precisa de um processo Node
// novo pra simular "o bot reiniciou" de verdade.
import fs from 'fs'
import { spawnSync } from 'child_process'
import { ARQ_ESTADO, garantirPastas } from '../src/paths.js'

garantirPastas()

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const backup = fs.existsSync(ARQ_ESTADO) ? fs.readFileSync(ARQ_ESTADO, 'utf8') : null

function rodarNoProcessoFilho (codigo) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigo], { encoding: 'utf8' })
  if (r.status !== 0) console.error('stderr do filho:', r.stderr)
  return r
}

try {
  // "Processo 1": grava saude com 12 falhas consecutivas (ex: caiu no meio
  // de um ciclo de retry, antes de bater o limiar de quarentena).
  const r1 = rodarNoProcessoFilho(`
    import * as state from '${new URL('../src/state.js', import.meta.url).href}'
    for (let i = 0; i < 12; i++) state.registrarFalhaConexao()
    state.gravar()
  `)
  check('processo 1 (grava 12 falhas) rodou sem erro', r1.status === 0)

  const lidoEntreProcessos = JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8'))
  check('12 falhas persistidas em disco pelo processo 1', lidoEntreProcessos.saude?.falhasConsecutivas === 12)

  // "Processo 2" (simula reinício): importa state.js de novo, do zero, como
  // um bot reiniciando faria — e também simula o que index.js faz no boot
  // (chama gravar() logo de cara). Antes do fix, isso zerava o contador.
  const r2 = rodarNoProcessoFilho(`
    import * as state from '${new URL('../src/state.js', import.meta.url).href}'
    state.gravar()   // igual a index.js:49 — não pode zerar saude persistida
    console.log(JSON.stringify(state.ler()?.saude))
  `)
  check('processo 2 (simula reinício + boot) rodou sem erro', r2.status === 0)
  const saudeAposReinicio = JSON.parse(r2.stdout.trim().split('\n').pop())
  check('falhasConsecutivas sobrevive ao "reinício" (não zera)', saudeAposReinicio?.falhasConsecutivas === 12)

  // registrarSucessoConexao no processo novo deve zerar normalmente (um
  // sucesso real É o fim do ciclo de falhas, isso continua certo).
  const r3 = rodarNoProcessoFilho(`
    import * as state from '${new URL('../src/state.js', import.meta.url).href}'
    state.registrarSucessoConexao()
    console.log(JSON.stringify(state.ler()?.saude))
  `)
  const saudeAposSucesso = JSON.parse(r3.stdout.trim().split('\n').pop())
  check('sucesso real ainda zera falhasConsecutivas', saudeAposSucesso?.falhasConsecutivas === 0)

  // Achado de revisão de segurança: state.json carrega QR e código de
  // pareamento — não pode ficar legível por outros usuários locais.
  const modoEstado = fs.statSync(ARQ_ESTADO).mode & 0o777
  check('state.json fica 0600 depois de gravado (nunca legível por outros)', modoEstado === 0o600)
} finally {
  if (backup !== null) fs.writeFileSync(ARQ_ESTADO, backup)
  else { try { fs.unlinkSync(ARQ_ESTADO) } catch {} }
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE PERSISTÊNCIA DE SAÚDE PASSARAM')
process.exit(falhas ? 1 : 0)
