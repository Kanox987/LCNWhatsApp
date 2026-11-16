// TROCAR O NÚMERO CONECTADO pelo painel, sem o número antigo voltar sozinho.
//
// Dois defeitos reais motivam este arquivo: (1) quem usa o painel hospedado não
// tinha como trocar de número (só o menu do terminal fazia isso); (2) apagar a
// sessão com o processo vivo não bastava — o SQLite regravava o zapo.sqlite
// depois da limpeza e o número antigo reconectava na subida seguinte.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  ARQ_LIMPEZA_PENDENTE, ARQ_NUMERO_DESCARTADO, ARQ_PEDIDO_LOGOUT, concluirLimpezaPendente, esquecerNumeroDescartado,
  esvaziarSessao, lembrarNumeroDescartado, marcarLimpezaPendente, numeroFoiDescartado, pedirLogout
} from '../src/sessaoLogout.js'
import { EXIT_RESTART_REQUESTED, codigoDeSaidaParaReinicio } from '../src/exitCodes.js'
import { pidEhDoBot } from '../src/agent/processoDaInstancia.js'
import { criarInstanceService } from '../src/agent/instanceService.js'
import { criarRoteadorWeb } from '../src/web/router.js'

let falhas = 0
const check = (nome, ok, extra = '') => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${ok || !extra ? '' : ` — ${extra}`}`) }
const aqui = path.dirname(fileURLToPath(import.meta.url))
const ler = (rel) => fs.readFileSync(path.join(aqui, rel), 'utf8')
const modo = (arquivo) => fs.statSync(arquivo).mode & 0o777

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-troca-numero-'))

// --- marcador e limpeza ------------------------------------------------------
{
  const dados = path.join(tmp, 'a', 'data')
  const sessao = path.join(tmp, 'a', 'sessao')
  fs.mkdirSync(sessao, { recursive: true })
  fs.writeFileSync(path.join(sessao, 'zapo.sqlite'), 'credenciais')

  check('sem marcador, a subida não mexe na sessão',
    concluirLimpezaPendente({ pastaDados: dados, pastaSessao: sessao }) === false &&
    fs.existsSync(path.join(sessao, 'zapo.sqlite')))

  marcarLimpezaPendente(dados)
  const marcador = path.join(dados, ARQ_LIMPEZA_PENDENTE)
  check('o marcador nasce mesmo sem a pasta de dados existir', fs.existsSync(marcador))
  check('e é privado (0600)', modo(marcador) === 0o600, modo(marcador).toString(8))

  // A corrida real: a pasta é esvaziada com o processo vivo e o SQLite regrava
  // o banco (e o -wal) logo depois. A subida seguinte precisa apagar de novo.
  esvaziarSessao(sessao)
  fs.writeFileSync(path.join(sessao, 'zapo.sqlite'), 'regravado pelo sqlite')
  fs.writeFileSync(path.join(sessao, 'zapo.sqlite-wal'), 'wal')
  fs.mkdirSync(path.join(sessao, 'sub'))
  pedirLogout(dados)

  const mensagens = []
  const limpou = concluirLimpezaPendente({ pastaDados: dados, pastaSessao: sessao, log: (m) => mensagens.push(m) })
  check('com marcador, a subida descarta o que o SQLite regravou', limpou && fs.readdirSync(sessao).length === 0,
    fs.readdirSync(sessao).join(','))
  check('a pasta da sessão continua existindo (é ponto de montagem)', fs.statSync(sessao).isDirectory())
  check('o marcador é consumido', !fs.existsSync(marcador))
  check('o pedido de logout que ficou na fila também sai (não derruba o pareamento novo)',
    !fs.existsSync(path.join(dados, ARQ_PEDIDO_LOGOUT)))
  check('a subida avisa no log', mensagens.length === 1)

  check('sessão inexistente não é erro', (() => { esvaziarSessao(path.join(tmp, 'nao-existe')); return true })())
}

{
  // Arquivo pré-existente com permissão aberta: o mode do writeFileSync não
  // valeria para ele.
  const dados = path.join(tmp, 'perm')
  fs.mkdirSync(dados, { recursive: true })
  fs.writeFileSync(path.join(dados, ARQ_PEDIDO_LOGOUT), 'x', { mode: 0o644 })
  fs.chmodSync(path.join(dados, ARQ_PEDIDO_LOGOUT), 0o644)
  pedirLogout(dados)
  check('pedido de logout regravado volta a ser 0600', modo(path.join(dados, ARQ_PEDIDO_LOGOUT)) === 0o600)
}

// --- o gateway usa isso na ordem certa ----------------------------------------
{
  const fonte = ler('../src/connection.js')
  const inicio = fonte.indexOf('export async function iniciar ()')
  const limpeza = fonte.indexOf('concluirLimpezaPendente(', inicio)
  const store = fonte.indexOf('const store = criarStore()', inicio)
  check('o gateway conclui a limpeza ANTES de abrir o store', inicio >= 0 && limpeza > inicio && limpeza < store)

  const gracioso = fonte.indexOf('function desligarGracioso')
  const marca = fonte.indexOf('marcarLimpezaPendente(PASTA_DADOS)', gracioso)
  const logout = fonte.indexOf('clienteAtual?.logout()', gracioso)
  check('o marcador é gravado ANTES do logout', gracioso >= 0 && marca > gracioso && marca < logout)
  check('o pedido lido pelo gateway é o mesmo nome que o painel grava', fonte.includes('path.join(PASTA_DADOS, ARQ_PEDIDO_LOGOUT)'))

  // A saúde do número antigo (falhas, quarentena) não pode pesar no novo.
  const zeraNaSubida = fonte.indexOf('state.zerarSaude()', limpeza)
  check('a subida que descarta a sessão zera a saúde do número antigo', zeraNaSubida > limpeza && zeraNaSubida < store)
  const esvazia = fonte.indexOf('esvaziarSessao(', gracioso)
  check('o logout também zera a saúde', fonte.indexOf('state.zerarSaude()', esvazia) > esvazia)
  check('o logout anota o número que saiu', fonte.indexOf('lembrarNumeroDescartado(', gracioso) > gracioso)
  check('a subida pareando por código consulta a anotação antes do store',
    (() => { const i = fonte.indexOf('numeroFoiDescartado(', inicio); return i > inicio && i < store })())
  const sucesso = fonte.indexOf('state.registrarSucessoConexao()')
  check('a anotação some na primeira conexão bem-sucedida', sucesso >= 0 && fonte.indexOf('esquecerNumeroDescartado(', sucesso) > sucesso &&
    fonte.indexOf('esquecerNumeroDescartado(', sucesso) - sucesso < 200)
  check('o logout pedido pelo painel sai com o código de reinício (systemd religa)',
    fonte.includes('desligarGracioso({ apagarSessao: true, codigo: codigoDeSaidaParaReinicio() })'))
}

// --- código de saída do reinício pedido -----------------------------------------
{
  check('sob systemd o reinício pedido sai com 75', codigoDeSaidaParaReinicio({ LCN_SUPERVISED: 'systemd' }) === EXIT_RESTART_REQUESTED && EXIT_RESTART_REQUESTED === 75)
  check('fora do systemd continua 0 (container e PM2 religam com qualquer código)', codigoDeSaidaParaReinicio({}) === 0)
  const quadlet = ler('../src/instances/quadlet.js')
  const lista = quadlet.slice(quadlet.indexOf('const CODIGOS_TERMINAIS'), quadlet.indexOf(']', quadlet.indexOf('const CODIGOS_TERMINAIS')))
  check('75 não está entre os códigos que impedem o systemd de religar', !lista.includes('RESTART_REQUESTED') && !lista.includes('75'))
}

// --- o número que saiu não volta pelo ambiente do container ----------------------
{
  const dados = path.join(tmp, 'descartado')
  check('sem anotação, nada foi descartado', numeroFoiDescartado(dados, '5511999999999', 'c1') === false)
  lembrarNumeroDescartado(dados, '5511999999999', 'c1')
  check('a anotação é privada (0600)', modo(path.join(dados, ARQ_NUMERO_DESCARTADO)) === 0o600)
  check('mesmo número no mesmo container: descartado', numeroFoiDescartado(dados, '5511999999999', 'c1'))
  check('container recriado (outro host) pode parear o mesmo número', numeroFoiDescartado(dados, '5511999999999', 'c2') === false)
  check('outro número no mesmo container não é afetado', numeroFoiDescartado(dados, '5511888888888', 'c1') === false)
  check('sem número configurado, nada a comparar', numeroFoiDescartado(dados, '', 'c1') === false)
  fs.writeFileSync(path.join(dados, ARQ_NUMERO_DESCARTADO), '{quebrado')
  check('anotação corrompida não derruba a subida', numeroFoiDescartado(dados, '5511999999999', 'c1') === false)
  esquecerNumeroDescartado(dados)
  check('esquecer apaga a anotação', !fs.existsSync(path.join(dados, ARQ_NUMERO_DESCARTADO)))
  check('esquecer sem anotação não é erro', (() => { esquecerNumeroDescartado(dados); return true })())
}

// --- de quem é o pid ---------------------------------------------------------------
{
  const proc = path.join(tmp, 'proc')
  const processo = (pid, argv, env) => {
    fs.mkdirSync(path.join(proc, String(pid)), { recursive: true })
    fs.writeFileSync(path.join(proc, String(pid), 'cmdline'), argv.join('\0') + '\0')
    fs.writeFileSync(path.join(proc, String(pid), 'environ'), env.join('\0') + '\0')
  }
  fs.mkdirSync(path.join(proc, 'self'), { recursive: true })
  processo(10, ['node', '/app/index.js'], ['PATH=/bin', 'LCN_INSTANCIA=loja'])
  processo(11, ['node', 'index.js'], ['PATH=/bin'])
  processo(12, ['bash', '-c', 'sleep 9'], ['LCN_INSTANCIA=loja'])
  const vivo = () => true
  check('pid do número certo é do bot', pidEhDoBot(10, 'loja', { proc, estaVivo: vivo }))
  check('pid de outro número não é', pidEhDoBot(10, 'outra', { proc, estaVivo: vivo }) === false)
  check('o principal é o index.js sem LCN_INSTANCIA', pidEhDoBot(11, null, { proc, estaVivo: vivo }) && pidEhDoBot(10, null, { proc, estaVivo: vivo }) === false)
  check('pid reaproveitado por outro programa não é do bot', pidEhDoBot(12, 'loja', { proc, estaVivo: vivo }) === false)
  check('pid morto não é do bot', pidEhDoBot(10, 'loja', { proc, estaVivo: () => false }) === false)
  check('pid sem /proc legível não é do bot', pidEhDoBot(99, 'loja', { proc, estaVivo: vivo }) === false)
}

// --- serviço: bot de pé, parado e do modo simples -----------------------------
const chamadasExec = []
function execAtivo (comando, args) {
  chamadasExec.push([comando, ...args].join(' '))
  if (comando === 'systemctl' && args[1] === 'is-active') return { ok: true, status: 0, stdout: 'active\n', stderr: '' }
  return { ok: true, status: 0, stdout: '', stderr: '' }
}

{
  // Instância gerenciada (systemd): o pedido vai para dataDir/data.
  const dataDir = path.join(tmp, 'wa-000001')
  fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true })
  const registro = () => ({ version: 1, nextSeq: 2, instances: { 'wa-000001': { instanceId: 'wa-000001', dataDir, containerName: 'lcn-wa-000001', resources: {} } } })
  const bareArqEstado = path.join(tmp, 'bare-g', 'state.json')
  fs.mkdirSync(path.dirname(bareArqEstado), { recursive: true })
  fs.writeFileSync(bareArqEstado, '{}')
  const service = criarInstanceService({
    exec: execAtivo, obterRegistro: registro, bareArqEstado,
    caminhoInstanciaFn: (id) => path.join(tmp, id), nomeContainerFn: (id) => `lcn-${id}`
  })
  const r = service.desconectar('wa-000001')
  const pedido = path.join(dataDir, 'data', ARQ_PEDIDO_LOGOUT)
  check('gerenciada de pé: pede logout ao próprio bot', r.ok && r.applied === 'running' && fs.existsSync(pedido))
  check('e o pedido é privado (0600)', modo(pedido) === 0o600)
  check('e o marcador de limpeza também vai', fs.existsSync(path.join(dataDir, 'data', ARQ_LIMPEZA_PENDENTE)))
  check('não para nem reinicia a unidade (quem reinicia é o próprio bot)',
    !chamadasExec.some((c) => / (stop|restart|start) /.test(` ${c} `)), chamadasExec.join(' | '))
}

// O relógio do serviço vira uma fila: cada `agendar` empilha, o teste roda.
// `vivos` decide quais pids estão de pé; `doBot` quais são deste painel.
function serviceBare ({ status, agendados = [], iniciados = [], bare = { iniciados: 0, parados: 0 }, vivos = new Set(), doBot = () => true }) {
  const raiz = fs.mkdtempSync(path.join(tmp, 'bare-'))
  const bareArqEstado = path.join(raiz, 'state.json')
  fs.writeFileSync(bareArqEstado, JSON.stringify({ conectado: true, numero: '5511999999999' }))
  const service = criarInstanceService({
    exec: execAtivo,
    obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
    bareArqEstado,
    bareArqConfig: path.join(raiz, 'config.json'),
    bareArqPid: path.join(raiz, 'bot.pid'),
    bareStatusServico: () => status,
    bareIniciarBot: () => { bare.iniciados++; return { ok: true } },
    barePararBot: () => { bare.parados++; return { ok: true } },
    iniciarProcessoSimples: (nome, arqPid) => { iniciados.push({ nome, arqPid }); return { ok: true } },
    verificarPidVivo: (pid) => vivos.has(pid),
    processoEhDoBot: (pid, nome) => vivos.has(pid) && doBot(pid, nome),
    esperaSupervisorMs: 8000,
    agendar: (fn, ms) => agendados.push({ fn, ms })
  })
  return { service, raiz, bareArqEstado }
}
const rodar = (agendados) => agendados.shift().fn()

{
  const { service, raiz } = serviceBare({ status: 'rodando' })
  const r = service.desconectar('bare')
  check('principal de pé: pedido de logout em data/', r.applied === 'running' && fs.existsSync(path.join(raiz, ARQ_PEDIDO_LOGOUT)))
}

{
  const { service, raiz } = serviceBare({ status: 'parado' })
  const r = service.desconectar('bare')
  // O pedido vai mesmo assim: se o status errou e o bot está de pé, ele
  // desloga; se está parado, a subida descarta o pedido junto com a sessão.
  check('principal parado: marcador e pedido, aplicado na próxima subida',
    r.applied === 'next-start' && fs.existsSync(path.join(raiz, ARQ_LIMPEZA_PENDENTE)) && fs.existsSync(path.join(raiz, ARQ_PEDIDO_LOGOUT)))
}

{
  // Principal de pé SEM supervisor: o painel espera o processo sair, dá o
  // tempo de um supervisor religar e só então liga (iniciarBot recusa se já
  // houver um).
  const agendados = []
  const bare = { iniciados: 0, parados: 0 }
  const vivos = new Set([4242])
  const { service, raiz } = serviceBare({ status: 'rodando', agendados, bare, vivos })
  fs.writeFileSync(path.join(raiz, 'bot.pid'), '4242')
  service.desconectar('bare')
  check('principal de pé: agenda religar', agendados.length === 1)
  rodar(agendados)
  check('enquanto o pid vive, só espera', bare.iniciados === 0 && agendados.length === 1)
  vivos.delete(4242)
  rodar(agendados)
  check('quando sai, espera o supervisor antes de ligar', bare.iniciados === 0 && agendados.length === 1 && agendados[0].ms === 8000)
  rodar(agendados)
  check('e liga o principal uma vez', bare.iniciados === 1 && agendados.length === 0)
}

{
  // Parar (ou ligar/reiniciar) depois da troca cancela o religamento.
  const agendados = []
  const bare = { iniciados: 0, parados: 0 }
  const vivos = new Set([4343])
  const { service, raiz } = serviceBare({ status: 'rodando', agendados, bare, vivos })
  fs.writeFileSync(path.join(raiz, 'bot.pid'), '4343')
  service.desconectar('bare')
  service.desconectar('bare')
  check('segundo clique reaproveita o religamento pendente', agendados.length === 1)
  service.parar('bare')
  vivos.delete(4343)
  while (agendados.length) rodar(agendados)
  check('parar depois da troca cancela o religamento', bare.parados === 1 && bare.iniciados === 0)
  vivos.add(4343)
  service.desconectar('bare')
  check('depois de cancelado, uma troca nova agenda de novo', agendados.length === 1)
}

{
  // pid que não é do bot (reaproveitado, ou de outro container): não religa.
  const agendados = []
  const vivos = new Set([4444])
  const { service, raiz } = serviceBare({ status: 'rodando', agendados, vivos, doBot: () => false })
  fs.writeFileSync(path.join(raiz, 'bot.pid'), '4444')
  const r = service.desconectar('bare')
  check('pid estranho: pede logout mas não religa', r.applied === 'running' && agendados.length === 0)
}

{
  // Número do modo simples rodando NESTE painel: ninguém o supervisiona, então
  // o painel espera o processo sair e liga de novo.
  const agendados = []
  const iniciados = []
  const vivos = new Set([process.pid]) // o status lê o pid de verdade: este processo está vivo
  const nomes = []
  const { service, raiz } = serviceBare({ status: 'rodando', agendados, iniciados, vivos, doBot: (pid, nome) => { nomes.push(nome); return true } })
  const pasta = path.join(raiz, 'instancias', 'loja')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'state.json'), JSON.stringify({ conectado: true, atualizadoEm: Date.now() }))
  fs.writeFileSync(path.join(pasta, 'bot.pid'), String(process.pid))

  const r = service.desconectar('simples:loja')
  check('simples de pé: pedido de logout na pasta dele', r.applied === 'running' && fs.existsSync(path.join(pasta, ARQ_PEDIDO_LOGOUT)))
  check('e agenda religar', agendados.length === 1)
  check('conferindo que o pid é DESTE número', nomes[0] === 'loja')

  rodar(agendados)
  check('enquanto o processo vive, só espera', iniciados.length === 0 && agendados.length === 1)

  // Alguém ligou o número no meio: o pid-file mudou. Quem conta é o pid antigo.
  fs.writeFileSync(path.join(pasta, 'bot.pid'), '777777')
  vivos.delete(process.pid)
  rodar(agendados)
  check('quando o pid antigo sai, liga de novo uma vez (iniciar recusa se já houver outro)',
    iniciados.length === 1 && iniciados[0].nome === 'loja' && agendados.length === 0)
}

{
  // Rodando em OUTRO container: só o batimento chega aqui, o pid não. O pedido
  // vai (o bot de lá lê a pasta compartilhada), mas religar não é deste painel.
  const agendados = []
  const { service, raiz } = serviceBare({ status: 'rodando', agendados, vivos: new Set([process.pid]), doBot: () => false })
  const pasta = path.join(raiz, 'instancias', 'remoto')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'state.json'), JSON.stringify({ conectado: true, atualizadoEm: Date.now() }))
  fs.writeFileSync(path.join(pasta, 'bot.pid'), String(process.pid)) // vivo, mas não é um bot deste painel
  const r = service.desconectar('simples:remoto')
  check('simples em outro container: pede logout pela pasta compartilhada', r.applied === 'running' && fs.existsSync(path.join(pasta, ARQ_PEDIDO_LOGOUT)))
  check('e não tenta religar um processo que não é daqui', agendados.length === 0)
}

{
  const agendados = []
  const { service, raiz } = serviceBare({ status: 'rodando', agendados })
  const pasta = path.join(raiz, 'instancias', 'parado')
  fs.mkdirSync(pasta, { recursive: true })
  fs.writeFileSync(path.join(pasta, 'state.json'), JSON.stringify({ conectado: true }))
  const r = service.desconectar('simples:parado')
  check('simples sem bot.pid: processo já saiu, aplicado na próxima subida, sem religar',
    r.applied === 'next-start' && fs.existsSync(path.join(pasta, ARQ_LIMPEZA_PENDENTE)) && agendados.length === 0)

  let recusou = false
  try { service.desconectar('simples:../../etc') } catch { recusou = true }
  check('id inventado não vira caminho', recusou)
}

// --- rota e tela ---------------------------------------------------------------
{
  const chamadas = []
  const aplicacao = { instancias: { desconectar: (id) => { chamadas.push(id); return { ok: true, applied: 'running' } } } }
  const roteador = criarRoteadorWeb(aplicacao, { emContainer: () => false })
  const r = await roteador.resolver('POST', '/api/v1/instances/bare/logout', { body: {} })
  check('POST /api/v1/instances/:id/logout chega ao serviço', chamadas[0] === 'bare' && JSON.stringify(r).includes('running'), JSON.stringify(r))

  check('a aplicação expõe desconectar', ler('../src/agent/application.js').includes('desconectar: (id) => instanceService.desconectar(id)'))

  const tela = ler('../src/web/public/pages/instance.js')
  const bloco = tela.slice(tela.indexOf('function trocaDeNumero'), tela.indexOf('function lifecycleCard'))
  check('a tela tem o botão de trocar o número', bloco.includes("'Trocar número conectado'") && bloco.includes("api.instances.action(id, 'logout')"))
  check('a confirmação não depende de window.confirm', !/window\.confirm/.test(bloco))
  check('o cartão de ciclo de vida mostra a troca', tela.includes('trocaDeNumero(instance, refresh)'))
  check('duplo clique não confirma a troca sozinho', bloco.includes('event.detail') && tela.includes('TROCA_INTERVALO_MINIMO_MS'))
  check('o QR novo é buscado mesmo com o estado antigo ainda "conectado"', tela.includes('pairing.connected !== true || trocaRecente(id)'))
  check('o refresh atrasado não redesenha outra tela', bloco.includes('window.location.pathname'))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DA TROCA DE NÚMERO PASSARAM')
process.exit(falhas ? 1 : 0)
