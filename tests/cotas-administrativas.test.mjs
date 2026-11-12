// Cotas do administrador para proteger o hardware: conexões externas, fila de
// ação e automações. O que se guarda aqui é a fronteira dita pelo dono: o
// cliente continua LIVRE para criar comandos LCN; só o teto concedido barra, e
// sem concessão nada muda ("padrão não é teto").
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import {
  CHAVE_DE_AMBIENTE, esquecerConcessoesDoProcesso, valorEfetivo, resolverCampo, validarConcessao
} from '../src/agent/concessoes.js'
import { MAX_PENDENTES_PADRAO, criarFila } from '../src/engine/fila.js'
import { criarFilasDeRecursos } from '../src/engine/filasDeRecursos.js'
import { descreverCota } from '../src/web/public/logic/cotas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
function comConcessoes (concessoes, corpo) {
  const antes = process.env[CHAVE_DE_AMBIENTE]
  if (concessoes) process.env[CHAVE_DE_AMBIENTE] = JSON.stringify(concessoes)
  else delete process.env[CHAVE_DE_AMBIENTE]
  esquecerConcessoesDoProcesso()
  return Promise.resolve(corpo()).finally(() => {
    if (antes === undefined) delete process.env[CHAVE_DE_AMBIENTE]; else process.env[CHAVE_DE_AMBIENTE] = antes
    esquecerConcessoesDoProcesso()
  })
}
async function erroDe (api, method, caminho, body) {
  try { await api.resolver(method, caminho, contexto(body)); return null } catch (e) { return e }
}

const conexao = (id) => ({ id, kind: 'http', config: { endereco: 'https://exemplo.test', funcoes: [] } })
const automacao = (id) => ({
  id, schemaVersion: 1, name: id, trigger: { type: 'trigger.message.received', config: {} }, nodes: [], edges: []
})

try {
  // --- a tabela ---------------------------------------------------------
  check('o padrão da fila no catálogo é o mesmo da fila real',
    resolverCampo('hardware.maxPendentes', undefined, undefined).efetivo === MAX_PENDENTES_PADRAO)
  check('sem concessão, conexões e automações são ilimitadas (0)',
    valorEfetivo('limites.maxConexoes', {}, {}) === 0 && valorEfetivo('limites.maxAutomacoes', {}, {}) === 0)
  check('a concessão de conexões vira o teto', valorEfetivo('limites.maxConexoes', {}, { 'limites.maxConexoes': 3 }) === 3)
  let recusou = false
  try { validarConcessao({ 'limites.maxAutomacoes': -1 }) } catch { recusou = true }
  check('concessão negativa é recusada', recusou)
  check('a mensagem de teto cita a unidade do parâmetro, não B/s',
    /3 conexões/.test(resolverCampo('limites.maxConexoes', 0, 3).motivo || '') &&
    /B\/s/.test(resolverCampo('hardware.bandwidthLimit.uploadBytesPerSecond', 0, 5).motivo || ''))

  // --- conexões ---------------------------------------------------------
  const prontas = (await comConcessoes(null, async () => (await criarApi(abrirBanco(':memory:')).resolver('GET', '/connections', contexto())).length))
  check('o sistema já traz conexões prontas', prontas >= 1)
  await comConcessoes({ 'limites.maxConexoes': prontas + 2 }, async () => {
    const api = criarApi(abrirBanco(':memory:'))
    check('a cota conta o total, prontas incluídas: a primeira do cliente passa', (await erroDe(api, 'POST', '/connections', conexao('a'))) === null)
    check('a segunda do cliente passa', (await erroDe(api, 'POST', '/connections', conexao('b'))) === null)
    const barrada = await erroDe(api, 'POST', '/connections', conexao('c'))
    check('a terceira é recusada com 409 e motivo', barrada?.status === 409 && /Limite de conexões/.test(barrada.message), barrada?.message)
    await api.resolver('DELETE', '/connections/midia', contexto())
    check('apagar uma pronta só abre vaga para UMA, não isenta o id', (await erroDe(api, 'POST', '/connections', conexao('midia'))) === null && (await erroDe(api, 'POST', '/connections', conexao('d'))) !== null)
    const repetida = await erroDe(api, 'POST', '/connections', conexao('a'))
    check('id repetido continua sendo o 409 de sempre', repetida?.status === 409 && /já cadastrada/.test(repetida.message))
    check('editar uma existente segue livre', (await erroDe(api, 'PUT', '/connections/a', { config: { endereco: 'https://outro.test', funcoes: [] } })) === null)
    await api.resolver('DELETE', '/connections/a', contexto())
    check('apagar abre vaga', (await erroDe(api, 'POST', '/connections', conexao('c'))) === null)
  })
  await comConcessoes(null, async () => {
    const api = criarApi(abrirBanco(':memory:'))
    let todas = true
    for (let i = 0; i < 12; i++) todas = todas && (await erroDe(api, 'POST', '/connections', conexao(`x${i}`))) === null
    check('sem concessão nada é barrado', todas)
  })

  // --- automações -------------------------------------------------------
  await comConcessoes({ 'limites.maxAutomacoes': 2 }, async () => {
    const api = criarApi(abrirBanco(':memory:'))
    check('a primeira automação passa', (await erroDe(api, 'POST', '/automations', automacao('um'))) === null)
    check('a segunda passa', (await erroDe(api, 'POST', '/automations', automacao('dois'))) === null)
    const barrada = await erroDe(api, 'POST', '/automations', automacao('tres'))
    check('a terceira é recusada com 409', barrada?.status === 409 && /Limite de automações/.test(barrada.message), barrada?.message)
    const repetida = await erroDe(api, 'POST', '/automations', automacao('um'))
    check('id repetido continua o 409 de sempre', repetida?.status === 409 && /já cadastrada/.test(repetida.message))
    check('editar o rascunho de uma existente segue livre',
      (await erroDe(api, 'PUT', '/automations/um/draft', automacao('um'))) === null)
  })
  await comConcessoes(null, async () => {
    const api = criarApi(abrirBanco(':memory:'))
    let todas = true
    for (let i = 0; i < 12; i++) todas = todas && (await erroDe(api, 'POST', '/automations', automacao(`a${i}`))) === null
    check('sem concessão nenhuma automação é barrada', todas)
  })

  // O catálogo (e o perfil, que usa o mesmo serviço) passa pelo mesmo caminho.
  await comConcessoes({ 'limites.maxAutomacoes': 1 }, async () => {
    const api = criarApi(abrirBanco(':memory:'))
    await api.resolver('POST', '/pools', contexto({ id: 'pool-teste', label: 'Pool de teste' }))
    const instalar = (id) => erroDe(api, 'POST', '/templates/ping/install', {
      automationIds: { ping: id },
      parameters: { ping: { command: `/${id}`, poolId: 'pool-teste' } },
      scope: { include: [{ kind: 'contact', id: '5511999999999@s.whatsapp.net' }] }
    })
    check('o primeiro modelo do catálogo instala', (await instalar('ping-um')) === null)
    const barrado = await instalar('ping-dois')
    check('o segundo modelo é recusado pela mesma cota', barrado?.status === 409 && /Limite de automações/.test(barrado.message), barrado?.message)
    const lista = await api.resolver('GET', '/automations', contexto())
    check('a recusa não deixa meia instalação para trás', (lista.items || lista).length === 1)
  })

  // --- o contador que o cliente vê ---------------------------------------
  await comConcessoes({ 'limites.maxAutomacoes': 3 }, async () => {
    const api = criarApi(abrirBanco(':memory:'))
    await api.resolver('POST', '/automations', contexto(automacao('um')))
    const cotas = await api.resolver('GET', '/meta/cotas', contexto())
    check('o contador conta as automações e lê o mesmo teto da cota', cotas.automacoes.usadas === 1 && cotas.automacoes.maximo === 3, JSON.stringify(cotas.automacoes))
    check('conexões sem teto: maximo 0 e o total, prontas incluídas', cotas.conexoes.maximo === 0 && cotas.conexoes.usadas === prontas, JSON.stringify(cotas.conexoes))
  })
  check('sem teto, a tela não mostra contador', descreverCota({ usadas: 5, maximo: 0 }, { singular: 'automação', plural: 'automações' }) === null)
  const meio = descreverCota({ usadas: 12, maximo: 20 }, { singular: 'automação', plural: 'automações' })
  check('"12 de 20 automações", neutro abaixo de 80%', meio?.texto === '12 de 20 automações' && meio.tom === 'neutral' && meio.aviso === null)
  check('perto do teto avisa em amarelo', descreverCota({ usadas: 16, maximo: 20 }, { singular: 'a', plural: 'as' })?.tom === 'warning')
  const cheio = descreverCota({ usadas: 21, maximo: 20 }, { singular: 'automação', plural: 'automações' })
  check('no teto (ou acima, depois de a cota baixar) diz o que fazer', cheio?.tom === 'danger' && /apague uma das 21/.test(cheio.aviso))
  check('teto 1 usa o singular', descreverCota({ usadas: 0, maximo: 1 }, { singular: 'conexão', plural: 'conexões' })?.texto === '0 de 1 conexão')

  const pendentesAceitos = async (cfg) => {
    const filas = criarFilasDeRecursos(cfg)
    const libera = []
    const segura = () => new Promise((resolver) => libera.push(resolver))
    const resultados = []
    for (let i = 0; i < 12; i++) resultados.push(filas.executar('cpu', segura).then(() => 'ok', (e) => e.code))
    await new Promise((r) => setTimeout(r, 20))
    const recusas = filas.cpu.estado.recusas
    let terminou = false
    Promise.allSettled(resultados).then(() => { terminou = true })
    while (!terminou) {
      while (libera.length) libera.shift()()
      await new Promise((r) => setTimeout(r, 5))
    }
    return { recusas }
  }
  await comConcessoes({ 'hardware.maxPendentes': 3 }, async () => {
    const { recusas } = await pendentesAceitos({ hardware: { maxPendentes: 100, cpuConcorrencia: 1 } })
    check('a fila de ação obedece o teto concedido mesmo se o cliente pediu 100', recusas === 12 - 1 - 3, `recusas=${recusas}`)
  })
  await comConcessoes(null, async () => {
    const { recusas } = await pendentesAceitos({ hardware: { cpuConcorrencia: 1 } })
    check('sem concessão a fila usa o padrão e não recusa nessa carga', recusas === 0, `recusas=${recusas}`)
  })
  check('criarFila continua aceitando 0 como "sem espera"', typeof criarFila({ maxPendentes: 0 }).executar === 'function')
} finally {
  console.log(falhas ? `\n❌ ${falhas} falhas` : '\n✅ tudo certo')
  process.exitCode = falhas ? 1 : 0
}
