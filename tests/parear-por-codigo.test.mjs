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
import { iniciarBot, ambienteDoBot } from '../src/runtime.js'
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
// Esta linha varria o texto de `iniciarBot` à procura de LCN_PAIR_NUMBER,
// porque o ambiente era montado dentro dela e `iniciarBot` nasce um processo
// solto — não havia o que perguntar. Agora quem decide o ambiente é
// `ambienteDoBot`, então a pergunta é direta: o número CHEGA ao ambiente. O
// texto de `iniciarBot` continua sendo varrido para provar que ele usa essa
// decisão em vez de montar outra por conta.
check('e passa LCN_PAIR_NUMBER no ambiente',
  ambienteDoBot({ pairNumber: '5522999999999', registro: { grants: {} } }).LCN_PAIR_NUMBER === '5522999999999')
check('e iniciarBot usa esse ambiente, não um próprio', /ambienteDoBot\(/.test(iniciarBot.toString()))

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

// --- a credencial não mora no log ---------------------------------------------
// QR e código de pareamento são credencial: enquanto valem, quem os lê entra na
// conta. Os dois iam para o stdout, e `src/espelhoLog.js` espelha o stdout em
// `data/bot.log` — arquivo que fica no disco, roda rotação e é SERVIDO pelo
// painel (`logsServico`, exposto por instanceService). O código dura minutos; o
// log dura semanas, e o painel não tem autenticação.
//
// A entrega continua existindo: o estado (`state.json`, modo 0600) guarda os
// dois e a tela os mostra. O que sai do log é a cópia.
//
// A pergunta é sobre o TEXTO do módulo porque o `auth_qr`/`requestPairingCode`
// vivem dentro de `conectar()`, numa closure sobre um cliente real — acordar
// isso num teste exigiria subir a conexão com o WhatsApp.
{
  const fonte = fs.readFileSync(new URL('../src/connection.js', import.meta.url), 'utf8')
  const { PADRAO } = await import('../src/config.js')

  check('credencial no log vem DESLIGADA de fábrica', PADRAO.hardware.credencialNoLog === false)
  // Padrão não é teto: quem só tem `docker logs -f` perdia a única porta de
  // entrada se a capacidade fosse removida em vez de ficar configurável.
  check('e é um campo de config, não uma restrição no código',
    'credencialNoLog' in PADRAO.hardware)

  // O desenho do QR e os dígitos do código ficam os DOIS atrás do mesmo knob.
  // Indentação não prova nada: o que prova é o knob estar ENTRE o `auth_qr` e
  // o desenho, sem nada fechando o bloco no meio.
  const antesDoDesenho = fonte.slice(fonte.indexOf("client.on('auth_qr'"), fonte.indexOf('qrcode.generate('))
  check('o desenho do QR fica atrás do knob', /if \(cfg\.hardware\?\.credencialNoLog\) \{\s*$/.test(antesDoDesenho),
    antesDoDesenho.trim().split('\n').pop())
  check('os dígitos do código também não',
    /credencialNoLog\) log\('Código de pareamento:'/.test(fonte))
  check('e os dois saem do mesmo knob',
    (fonte.match(/credencialNoLog/g) || []).length >= 2)

  // Mesmo sem os dígitos, a linha continua existindo: quem acompanha o log
  // precisa distinguir "pediram e chegou" de "travou antes de pedir".
  check('com o knob desligado o log ainda DIZ que o código saiu',
    /Código de pareamento gerado/.test(fonte))
  check('e que o QR saiu', /QR gerado — escaneie pelo painel \(lcn > Serviço > Conectar\)\.'/.test(fonte))
}

// --- intervalo mínimo entre dois pedidos de código ---------------------------
// Não é precaução contra banimento (que é plausível e NÃO está provado). É
// correção: `requestPairingCode` da zapo-js reatribui `pairingSession` sem
// guarda, `handlePrimaryHello` deriva a chave de decifração da chave efêmera
// substituída, e o `ref` do celular deixa de casar. Pedir outro código
// INVALIDA o que a pessoa está digitando. O piso é o próprio
// PAIRING_CODE_MAX_AGE_SECONDS (180 s) da biblioteca.
function servicoComCodigoEm ({ ha, intervalo } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-espera-'))
  const arqEstado = path.join(pasta, 'state.json')
  const arqConfig = path.join(pasta, 'config.json')
  const estado = { conectado: false, numero: null }
  if (ha !== undefined) estado.codigoPareamentoEm = Date.now() - ha
  fs.writeFileSync(arqEstado, JSON.stringify(estado))
  if (intervalo !== undefined) {
    fs.writeFileSync(arqConfig, JSON.stringify({ hardware: { pareamentoIntervaloSegundos: intervalo } }))
  }
  const feitos = []
  const servico = criarInstanceService({
    bareArqEstado: arqEstado,
    bareArqConfig: arqConfig,
    bareStatusServico: () => 'rodando',
    bareIniciarBot: (opcoes = {}) => { feitos.push({ acao: 'iniciar', ...opcoes }); return { ok: true, out: 'subiu' } },
    barePararBot: () => { feitos.push({ acao: 'parar' }); return { ok: true, out: 'parou' } },
    bareReiniciarBot: () => { feitos.push({ acao: 'reiniciar' }); return { ok: true, out: 'reiniciou' } }
  })
  return { servico, feitos }
}

function pedir (servico) {
  try { servico.iniciar('bare', { pairNumber: '5522999999999' }); return null } catch (e) { return e.message }
}

// FRONTEIRA, lado de dentro: código pedido há 10 s, intervalo padrão de 180 s.
{
  const { servico, feitos } = servicoComCodigoEm({ ha: 10000 })
  const recusa = pedir(servico)
  check('código pedido há 10 s: recusa', recusa !== null, recusa || 'não recusou')
  check('e DIZ quanto falta, em segundos', /\b1[0-9]{2}s\b/.test(recusa || ''), recusa)
  check('e NÃO derruba o processo que guarda a chave efêmera', feitos.length === 0, feitos.map((f) => f.acao).join('>'))
}

// FRONTEIRA, lado de fora: 181 s > 180 s. O código já expirou na biblioteca,
// então não há nada para invalidar.
{
  const { servico, feitos } = servicoComCodigoEm({ ha: 181000 })
  const recusa = pedir(servico)
  check('código pedido há 181 s: passa', recusa === null, recusa || '')
  check('e o processo é trocado pelo modo código', feitos.map((f) => f.acao).join('>') === 'parar>iniciar')
}

// A FRONTEIRA EXATA: 180 s cravados não podem recusar — o código acabou de
// deixar de valer, e um limite que recusa no instante do vencimento tranca
// por mais um ciclo sem proteger nada.
{
  const recusa = pedir(servicoComCodigoEm({ ha: 180000 }).servico)
  check('exatamente 180 s: passa', recusa === null, recusa || '')
}

// Nunca pediram código: a guarda não existe para o primeiro pedido.
{
  const { servico, feitos } = servicoComCodigoEm({})
  check('sem código anterior: passa', pedir(servico) === null)
  check('e o pedido chega ao runtime', feitos.some((f) => f.pairNumber === '5522999999999'))
}

// Padrão não é teto, e também não é piso: quem configura 30 s recebe 30 s.
{
  const recusa = pedir(servicoComCodigoEm({ ha: 40000, intervalo: 30 }).servico)
  check('intervalo configurado em 30 s libera depois de 40 s', recusa === null, recusa || '')
}
{
  const recusa = pedir(servicoComCodigoEm({ ha: 40000, intervalo: 600 }).servico)
  check('intervalo configurado em 600 s ainda recusa depois de 40 s', recusa !== null, recusa || 'não recusou')
}

// 0 desliga a guarda, assumindo o efeito. É a regra do projeto: padrão
// sensato sim, teto no código não.
{
  const recusa = pedir(servicoComCodigoEm({ ha: 1000, intervalo: 0 }).servico)
  check('intervalo 0 desliga a guarda', recusa === null, recusa || '')
}

// Relógio para trás (ajuste de hora, estado copiado de outra máquina) não
// pode trancar o pareamento para sempre.
{
  const recusa = pedir(servicoComCodigoEm({ ha: -86400000 }).servico)
  check('codigoPareamentoEm no futuro não tranca', recusa === null, recusa || '')
}

// Número CONECTADO continua sendo recusado pela razão dele, não por espera:
// a ordem das guardas importa, e derrubar sessão viva é o pior dos dois.
{
  const { servico } = servicoComCodigoEm({ ha: 10000 })
  check('a recusa por espera fala da espera, não da sessão',
    /INVALIDA/.test(pedir(servico) || ''))
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nparear por código: tudo certo')
