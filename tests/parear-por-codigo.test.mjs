// PAREAR POR CÓDIGO, SEM TERMINAL.
//
// O bot sabia fazer isto desde sempre — `LCN_PAIR_NUMBER=55… node index.js
// --code` — e só o terminal sabia pedir. A tela do painel admitia a lacuna em
// letras: "a geração de um novo código por telefone ainda depende do fluxo de
// terminal".
//
// Para quem aluga o sistema, isso não era um incômodo: era a porta de entrada
// inteira fechada. Sem terminal, sem conectar número nenhum.
import { iniciar, numeroParaParear } from '../src/agent/processoDaInstancia.js'
import fs from 'fs'
import os from 'os'
import path from 'path'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-parear-'))
fs.writeFileSync(path.join(raiz, 'index.js'), '// bot de mentira\n')
const arqPid = path.join(raiz, 'instancia.pid')

function espiar () {
  const chamadas = []
  const spawnFn = (exec, args, opcoes) => {
    chamadas.push({ exec, args, env: opcoes.env })
    return { pid: 4242, unref () {} }
  }
  return { chamadas, spawnFn }
}

// --- o número, conferido antes de virar argumento de processo ------------
check('número com DDI passa', numeroParaParear('5522999999999') === '5522999999999')
check('pontuação é limpa', numeroParaParear('+55 (22) 99999-9999') === '5522999999999')
check('número curto demais é recusado', numeroParaParear('123') === null)
// Este valor vira ARGUMENTO DE PROCESSO. A lista fechada de dígitos é o que
// impede qualquer outra coisa de entrar junto.
check('texto com letra é recusado', numeroParaParear('55; rm -rf /') === null, String(numeroParaParear('55; rm -rf /')))
check('vazio é recusado', numeroParaParear('') === null)

// --- sem telefone, nada muda ---------------------------------------------
{
  const { chamadas, spawnFn } = espiar()
  const r = iniciar('pessoal', arqPid, { spawnFn, raiz })
  check('ligar sem telefone continua ligando normal', r.ok === true, r.out)
  check('sem --code', !chamadas[0].args.includes('--code'), JSON.stringify(chamadas[0].args))
  check('e sem número no ambiente', chamadas[0].env.LCN_PAIR_NUMBER === undefined)
  check('com a instância certa', chamadas[0].env.LCN_INSTANCIA === 'pessoal')
}

// --- com telefone, modo código -------------------------------------------
{
  const { chamadas, spawnFn } = espiar()
  const r = iniciar('pessoal', arqPid, { spawnFn, raiz, pairNumber: '+55 22 99999-9999' })
  check('ligar com telefone liga em modo código', r.ok === true, r.out)
  check('com --code nos argumentos', chamadas[0].args.includes('--code'), JSON.stringify(chamadas[0].args))
  check('e o número limpo no ambiente', chamadas[0].env.LCN_PAIR_NUMBER === '5522999999999', chamadas[0].env.LCN_PAIR_NUMBER)
  check('a resposta diz que o código vem aí', /código/i.test(r.out), r.out)
}

// --- telefone torto não sobe processo nenhum -----------------------------
{
  const { chamadas, spawnFn } = espiar()
  const r = iniciar('pessoal', arqPid, { spawnFn, raiz, pairNumber: 'não é número' })
  check('telefone inválido é recusado', r.ok === false, r.out)
  check('e nada é executado', chamadas.length === 0, String(chamadas.length))
  check('com recado que diz o formato', /DDI/.test(r.out), r.out)
}

fs.rmSync(raiz, { recursive: true, force: true })
if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nparear por código: tudo certo')
