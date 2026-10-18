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
import { criarInstanceService } from '../src/agent/instanceService.js'
import { iniciarBot } from '../src/runtime.js'
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
// --- O NÚMERO PRINCIPAL ("bare") -----------------------------------------
//
// Este caminho tinha o defeito que mandou o recurso para produção pela metade:
// `executarAcaoCicloDeVida` devolvia o bare ANTES de olhar as opções, e o
// telefone era descartado sem um aviso sequer. O painel mostrava o campo, o
// pedido ia, e o processo subia em modo QR. O log do servidor mostrou o
// resultado: mil e quinhentos QR em quinze horas, nenhum deles pedido.
//
// Os casos acima cobriam só o número DESCOBERTO. Era o buraco exato, e é por
// isso que estes casos existem.
check('iniciarBot do runtime aceita o telefone', /pairNumber/.test(iniciarBot.toString()))
check('e monta --code quando ele vem', /--code/.test(iniciarBot.toString()))
check('e passa LCN_PAIR_NUMBER no ambiente', /LCN_PAIR_NUMBER/.test(iniciarBot.toString()))

// O serviço inteiro, com o runtime do bare injetado.
function servicoBare ({ conectado = false, status = 'parado' } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-bare-'))
  const arqEstado = path.join(pasta, 'state.json')
  fs.writeFileSync(arqEstado, JSON.stringify({ conectado, numero: conectado ? '5511888887777' : null }))
  const feitos = []
  const servico = criarInstanceService({
    bareArqEstado: arqEstado,
    bareStatusServico: () => status,
    bareIniciarBot: (opcoes = {}) => { feitos.push({ acao: 'iniciar', ...opcoes }); return { ok: true, out: 'subiu' } },
    barePararBot: () => { feitos.push({ acao: 'parar' }); return { ok: true, out: 'parou' } },
    bareReiniciarBot: () => { feitos.push({ acao: 'reiniciar' }); return { ok: true, out: 'reiniciou' } }
  })
  return { servico, feitos }
}

// O número principal PARADO, pedindo código.
{
  const { servico, feitos } = servicoBare({ status: 'parado' })
  servico.iniciar('bare', { pairNumber: '+55 22 99999-9999' })
  check('bare parado: o telefone CHEGA ao runtime', feitos[0]?.pairNumber === '5522999999999', JSON.stringify(feitos))
  check('bare parado: não para nada antes', feitos.length === 1, feitos.map((f) => f.acao).join('>'))
}

// O caso REAL do servidor: o bot já estava de pé, em laço de QR há horas.
// "Pedir código" aqui só pode significar trocar aquela tentativa por esta —
// recusar com "já está rodando" é verdade e é inútil, porque é exatamente a
// situação em que a pessoa clica no botão.
{
  const { servico, feitos } = servicoBare({ status: 'rodando', conectado: false })
  servico.iniciar('bare', { pairNumber: '5522999999999' })
  check('bare rodando sem conexão: para e sobe em modo código', feitos.map((f) => f.acao).join('>') === 'parar>iniciar', feitos.map((f) => f.acao).join('>'))
  check('e o telefone chega na subida', feitos[1]?.pairNumber === '5522999999999')
}

// O QUE NÃO SE FAZ: derrubar um número CONECTADO. A sessão dele está viva, e
// reiniciar em modo de código a perderia por causa de um clique.
{
  const { servico, feitos } = servicoBare({ status: 'rodando', conectado: true })
  let recusa = null
  try { servico.iniciar('bare', { pairNumber: '5522999999999' }) } catch (e) { recusa = e.message }
  check('bare CONECTADO: recusa em vez de derrubar a sessão', recusa !== null, recusa || 'não recusou')
  check('e diz por quê', /conectado/i.test(recusa || '') && /sess/i.test(recusa || ''), recusa)
  check('e NADA foi executado', feitos.length === 0, feitos.map((f) => f.acao).join('>'))
}

// Telefone torto não chega a mexer no processo.
{
  const { servico, feitos } = servicoBare({ status: 'rodando' })
  let recusa = null
  try { servico.iniciar('bare', { pairNumber: 'abc' }) } catch (e) { recusa = e.message }
  check('bare: telefone inválido é recusado', /Número inválido/.test(recusa || ''), recusa)
  check('e não para o que estava rodando', feitos.length === 0, feitos.map((f) => f.acao).join('>'))
}

// Ligar o bare SEM telefone continua exatamente como era.
{
  const { servico, feitos } = servicoBare({ status: 'parado' })
  servico.iniciar('bare')
  check('bare sem telefone: liga normal', feitos.length === 1 && feitos[0].acao === 'iniciar')
  check('e sem número de pareamento', feitos[0].pairNumber === undefined)
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nparear por código: tudo certo')
