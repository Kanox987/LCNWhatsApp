// Módulo 3 da Etapa 4.5 (painel web): serviço de ciclo de vida/otimização
// de instância no agente. `exec`/`obterRegistro` são injetados — nunca
// toca em systemctl/podman real nem no registry.json real do usuário.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { criarInstanceService, InstanciaNaoEncontradaError, validarAlvoGerenciado, lerRssDoPid, lerMemoriaContainer } from '../src/agent/instanceService.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const pastaTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-agent-instance-'))
const dataDir = path.join(pastaTmp, 'wa-000001')
fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true })

const instanciaFixture = {
  instanceId: 'wa-000001',
  label: 'Teste',
  expectedPhoneE164: '+5511999999999',
  dataDir,
  containerName: 'lcn-wa-000001',
  resources: { memory: '512m', cpus: '1.0' },
  createdAt: '2026-01-01T00:00:00.000Z'
}

function registroFixture () {
  return { version: 1, nextSeq: 2, instances: { 'wa-000001': instanciaFixture } }
}

// validarAlvoGerenciado() (achado de segurança) exige que dataDir/containerName
// batam com o caminho canônico derivado do id — injeta os resolvers pra
// apontar pro diretório de teste isolado em vez do caminho XDG real.
const caminhoInstanciaFn = (id) => path.join(pastaTmp, id)
const nomeContainerFn = (id) => `lcn-${id}`

function escreverEstado (estado) {
  fs.writeFileSync(path.join(dataDir, 'data', 'state.json'), JSON.stringify(estado))
}

function escreverConfig (config) {
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(config))
}

// --- exec fake que grava as chamadas em vez de tocar systemctl de verdade ---
function criarExecFake ({ falharAcao = null } = {}) {
  const chamadas = []
  const exec = (comando, args) => {
    chamadas.push({ comando, args })
    if (comando === 'systemctl' && args[1] === 'is-active') {
      return { ok: true, status: 0, stdout: 'active\n', stderr: '' }
    }
    if (comando === 'podman' && args[0] === 'logs') {
      return { ok: true, status: 0, stdout: 'log do container linha 1\nlog do container linha 2', stderr: '' }
    }
    if (falharAcao && args.includes(falharAcao)) {
      return { ok: false, status: 1, stdout: '', stderr: 'falha simulada' }
    }
    return { ok: true, status: 0, stdout: '', stderr: '' }
  }
  return { exec, chamadas }
}

escreverEstado({
  conectado: true, numero: '5511999999999',
  metricas: { reconexoes: 0, quedas: 0, processadas: 0 },
  saude: { status: 'ok', falhasConsecutivas: 0 }
})
escreverConfig({ hardware: { bandwidthLimit: { downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 } }, confiabilidade: { falhasConsecutivasParaQuarentena: 15 } })

const { exec, chamadas } = criarExecFake()
// `bareArqEstado` isolado de propósito: sem ele este serviço leria o
// data/state.json REAL do checkout e varreria o data/instancias/ real — um teste
// que muda de resultado conforme o que o dono tem instalado na máquina.
const estadoBareIsolado = path.join(pastaTmp, 'bare-isolado', 'state.json')
fs.mkdirSync(path.dirname(estadoBareIsolado), { recursive: true })
fs.writeFileSync(estadoBareIsolado, JSON.stringify({ conectado: false }))
const service = criarInstanceService({
  exec, obterRegistro: registroFixture, caminhoInstanciaFn, nomeContainerFn,
  bareArqEstado: estadoBareIsolado
})

// --- listar/obter ---
// listar() sempre inclui a instância virtual "bare" (modo simples) além
// das registradas — pedido explícito do usuário: a aba de pareamento
// precisa cobrir os dois cenários, não só quem já usa `lcn instances create`.
const lista = service.listar()
check('listar: devolve a instância registrada + a virtual "bare"', lista.length === 2)
check('listar: inclui a instância "bare" sempre, mesmo sem nenhum registro', lista.some((i) => i.instanceId === 'bare' && i.isBare === true))
const linhaRegistrada = lista.find((i) => i.instanceId === 'wa-000001')
check('listar: campos básicos corretos da instância registrada', linhaRegistrada?.connected === true && linhaRegistrada?.unitStatus === 'active' && linhaRegistrada?.isBare === false)

const detalhe = service.obter('wa-000001')
check('obter: inclui resources', detalhe.resources.memory === '512m')
check('obter: inclui métricas do state.json', detalhe.metrics.reconexoes === 0)

let lancouNaoEncontrada = false
try { service.obter('wa-999999') } catch (e) { lancouNaoEncontrada = e instanceof InstanciaNaoEncontradaError }
check('obter: instância inexistente lança InstanciaNaoEncontradaError', lancouNaoEncontrada)

// --- achado de segurança: "__proto__" não pode resolver pra Object.prototype ---
for (const idPerigoso of ['__proto__', 'constructor', 'toString', '../wa-000001', '']) {
  let lancouParaIdPerigoso = false
  try { service.obter(idPerigoso) } catch (e) { lancouParaIdPerigoso = e instanceof InstanciaNaoEncontradaError }
  check(`obter: id perigoso "${idPerigoso}" nunca resolve pra um objeto herdado, sempre 404`, lancouParaIdPerigoso)
}

// --- achado de segurança confirmado na revisão: registro adulterado
// (dataDir/containerName não batem com o esperado pro id) tem que ser
// recusado, não silenciosamente aceito — senão um PUT .../optimization
// escreveria no diretório de outro app, ou start/stop atingiria a unit
// errada. ---
check('validarAlvoGerenciado: aceita registro consistente', (() => {
  try { validarAlvoGerenciado(instanciaFixture, { caminhoInstanciaFn, nomeContainerFn }); return true } catch { return false }
})())
check('validarAlvoGerenciado: recusa dataDir divergente do esperado', (() => {
  try { validarAlvoGerenciado({ ...instanciaFixture, dataDir: '/tmp/outro-app-qualquer' }, { caminhoInstanciaFn, nomeContainerFn }); return false } catch { return true }
})())
check('validarAlvoGerenciado: recusa containerName divergente do esperado', (() => {
  try { validarAlvoGerenciado({ ...instanciaFixture, containerName: 'lcn-engine' }, { caminhoInstanciaFn, nomeContainerFn }); return false } catch { return true }
})())
let lancouRegistroAdulterado = false
try {
  const registroAdulterado = () => ({ version: 1, nextSeq: 2, instances: { 'wa-000001': { ...instanciaFixture, dataDir: '/tmp/outro-app-qualquer' } } })
  criarInstanceService({ exec, obterRegistro: registroAdulterado, caminhoInstanciaFn, nomeContainerFn }).obter('wa-000001')
} catch { lancouRegistroAdulterado = true }
check('obter: registro adulterado (dataDir divergente) é recusado de ponta a ponta', lancouRegistroAdulterado)

// --- ciclo de vida ---
const resultadoStart = service.iniciar('wa-000001')
check('iniciar: chama systemctl start com a unit certa', chamadas.some((c) => c.comando === 'systemctl' && c.args.includes('start') && c.args.includes('lcn-wa-000001.service')))
check('iniciar: retorno confirma ok', resultadoStart.ok === true)

const { exec: execFalha } = criarExecFake({ falharAcao: 'stop' })
const serviceFalha = criarInstanceService({ exec: execFalha, obterRegistro: registroFixture, caminhoInstanciaFn, nomeContainerFn })
let lancouFalhaParar = false
try { serviceFalha.parar('wa-000001') } catch { lancouFalhaParar = true }
check('parar: propaga erro quando systemctl falha', lancouFalhaParar)

// --- pareamento (só leitura do state.json; agora assíncrono por causa da
// conversão do QR cru pra imagem PNG, ver gerarQrDataUrl) ---
escreverEstado({ conectado: false, numero: null, qr: 'QR-BASE64-FAKE', qrEm: 1000, codigoPareamento: '1234-5678', codigoPareamentoEm: 2000 })
const pareamento = await service.pareamento('wa-000001')
check('pareamento: expõe qr persistido', pareamento.qr === 'QR-BASE64-FAKE')
check('pareamento: expõe código de pareamento persistido', pareamento.pairingCode === '1234-5678')
check('pareamento: gera qrDataUrl (imagem PNG escaneável, não só o texto cru)', typeof pareamento.qrDataUrl === 'string' && pareamento.qrDataUrl.startsWith('data:image/png;base64,'))

// --- pareamento: instância sem QR não tenta gerar imagem (evita chamada à toa) ---
escreverEstado({ conectado: true, numero: '5511999999999' })
let gerarQrChamado = false
const serviceConectado = criarInstanceService({
  exec, obterRegistro: registroFixture, caminhoInstanciaFn, nomeContainerFn,
  gerarQrDataUrl: async (texto) => { gerarQrChamado = true; return `data:image/png;base64,FAKE-${texto}` }
})
const pareamentoConectado = await serviceConectado.pareamento('wa-000001')
check('pareamento: sem QR persistido, não chama gerarQrDataUrl à toa', gerarQrChamado === false)
check('pareamento: sem QR persistido, qrDataUrl é null', pareamentoConectado.qrDataUrl === null)

// --- pareamento: falha ao gerar a imagem nunca quebra a resposta (mantém o texto cru) ---
escreverEstado({ conectado: false, numero: null, qr: 'QR-BASE64-FAKE', qrEm: 1000 })
const serviceFalhaQr = criarInstanceService({
  exec, obterRegistro: registroFixture, caminhoInstanciaFn, nomeContainerFn,
  gerarQrDataUrl: async () => { throw new Error('falha simulada na geração da imagem') }
})
const pareamentoFalhaQr = await serviceFalhaQr.pareamento('wa-000001')
check('pareamento: falha ao gerar imagem não lança, cai pra qrDataUrl null', pareamentoFalhaQr.qrDataUrl === null && pareamentoFalhaQr.qr === 'QR-BASE64-FAKE')

// --- otimização: leitura ---
const otim = service.obterOtimizacao('wa-000001')
check('otimização: lê bandwidthLimit do config.json da instância', otim.bandwidthLimit.downloadBytesPerSecond === 0)
check('otimização: lê quarantineThreshold do config.json da instância', otim.quarantineThreshold === 15)
check('otimização: resources vem do registro (só leitura)', otim.resources.cpus === '1.0')

// --- otimização: escrita válida ---
const atualizado = service.definirOtimizacao('wa-000001', { bandwidthLimit: { downloadBytesPerSecond: 500000 }, quarantineThreshold: 20 })
check('otimização: grava downloadBytesPerSecond novo', atualizado.bandwidthLimit.downloadBytesPerSecond === 500000)
check('otimização: preserva uploadBytesPerSecond não tocado', atualizado.bandwidthLimit.uploadBytesPerSecond === 0)
check('otimização: grava quarantineThreshold novo', atualizado.quarantineThreshold === 20)
const configEmDisco = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'))
check('otimização: persistiu de verdade no config.json (não só em memória)', configEmDisco.hardware.bandwidthLimit.downloadBytesPerSecond === 500000)

// --- achado de segurança: config.json pode ter chave de API — nunca 0644/0664 ---
const modoConfig = fs.statSync(path.join(dataDir, 'config.json')).mode & 0o777
check('otimização: config.json fica 0600 depois de gravado (nunca legível por outros)', modoConfig === 0o600)

// --- otimização: validação rejeita valores inválidos, sem gravar nada ---
let lancouBandaInvalida = false
try { service.definirOtimizacao('wa-000001', { bandwidthLimit: { downloadBytesPerSecond: -5 } }) } catch { lancouBandaInvalida = true }
check('otimização: rejeita bandwidthLimit negativo', lancouBandaInvalida)

let lancouQuarentenaInvalida = false
try { service.definirOtimizacao('wa-000001', { quarantineThreshold: 0 }) } catch { lancouQuarentenaInvalida = true }
check('otimização: rejeita quarantineThreshold < 1', lancouQuarentenaInvalida)

const configAposRejeicao = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'))
check('otimização: rejeição não altera o config.json em disco', configAposRejeicao.confiabilidade.falhasConsecutivasParaQuarentena === 20)

fs.rmSync(pastaTmp, { recursive: true, force: true })

// --- instância virtual "bare" (modo simples, sem registro nenhum) ---
// bareArqEstado/bareArqConfig/bareStatusServico/etc. são injetados pra
// nunca tocar data/state.json, config.json ou runtime.js REAIS deste
// checkout durante o teste.
const pastaTmpBare = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-agent-bare-'))
const bareArqEstado = path.join(pastaTmpBare, 'state.json')
const bareArqConfig = path.join(pastaTmpBare, 'config.json')
fs.writeFileSync(bareArqEstado, JSON.stringify({
  conectado: false, numero: null, qr: 'QR-BARE-FAKE', qrEm: 5000,
  iniciadoEm: Date.now() - 120000, memoriaMB: 47,
  metricas: { reconexoes: 0, bytesBaixados: 2048, bytesEnviados: 1024 }, saude: { status: 'ok' }
}))
fs.writeFileSync(bareArqConfig, JSON.stringify({ hardware: { bandwidthLimit: { downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 } } }))

const bareServicoFake = { chamadas: [] }
const serviceBare = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: path.join(pastaTmpBare, 'engine.pid'),
  arqCgroupV2Usage: path.join(pastaTmpBare, 'cgroup-ausente-v2-usage'),
  arqCgroupV2Limit: path.join(pastaTmpBare, 'cgroup-ausente-v2-limit'),
  arqCgroupV1Usage: path.join(pastaTmpBare, 'cgroup-ausente-v1-usage'),
  arqCgroupV1Limit: path.join(pastaTmpBare, 'cgroup-ausente-v1-limit'),
  bareStatusServico: () => { bareServicoFake.chamadas.push('status'); return 'rodando' },
  bareIniciarBot: () => { bareServicoFake.chamadas.push('iniciar'); return { ok: true, out: 'Bot iniciado (pid 123).' } },
  barePararBot: () => { bareServicoFake.chamadas.push('parar'); return { ok: true, out: 'parado' } },
  bareReiniciarBot: () => { bareServicoFake.chamadas.push('reiniciar'); return { ok: true, out: 'reiniciado' } },
  bareLogsServico: (n) => { bareServicoFake.chamadas.push(`logs:${n}`); return { ok: true, out: 'linha 1\nlinha 2' } },
  gerarQrDataUrl: async (texto) => `data:image/png;base64,FAKE-${texto}`
})

check('listar: "bare" aparece mesmo com registro totalmente vazio', serviceBare.listar().some((i) => i.instanceId === 'bare'))

const bareDetalhe = serviceBare.obter('bare')
check('obter("bare"): não exige registro nenhum', bareDetalhe.instanceId === 'bare')
check('obter("bare"): status vem de runtime.js (injetado), não de systemctl', bareDetalhe.unitStatus === 'rodando')

const barePareamento = await serviceBare.pareamento('bare')
check('pareamento("bare"): lê o state.json do modo simples (injetado)', barePareamento.qr === 'QR-BARE-FAKE')
check('pareamento("bare"): também gera qrDataUrl', barePareamento.qrDataUrl === 'data:image/png;base64,FAKE-QR-BARE-FAKE')

// Ligar pelo painel PASSOU a funcionar no modo simples: iniciarBot() antes
// reexecutava o processo atual (inseguro a partir do painel, que não é o
// binário do bot) e hoje executa index.js destacado. É o que permite conectar
// um número sem abrir terminal — a ação principal de quem acabou de instalar.
// --- segundo número no modo simples aparece na lista ---------------------
// `LCN_INSTANCIA=pessoal node index.js` cria uma pasta e passa a rodar outro
// número ali. Nada registra isso: a PASTA é a verdade. Sem a varredura, o
// painel mostrava só o principal — e o dono perguntou, com razão, cadê o outro.
const fsDesc = await import('fs')
const pathDesc = await import('path')
const raizDesc = pathDesc.dirname(bareArqEstado)
const pastaOutro = pathDesc.join(raizDesc, 'instancias', 'outro')
fsDesc.mkdirSync(pastaOutro, { recursive: true })
fsDesc.writeFileSync(pathDesc.join(pastaOutro, 'state.json'),
  JSON.stringify({ conectado: true, numero: '5599999999999', saude: { status: 'saudavel' } }))

const comDescoberta = serviceBare.listar()
const descoberta = comDescoberta.find((i) => i.instanceId === 'simples:outro')
check('o segundo número do modo simples aparece na lista', !!descoberta)
check('e traz o número dele, lido da própria pasta', descoberta?.phoneNumber === '5599999999999', descoberta?.phoneNumber)
check('sem pid próprio, aparece como parado', descoberta?.unitStatus === 'parado', descoberta?.unitStatus)

// "CONECTADO" CRUZA COM O PROCESSO ESTAR VIVO.
//
// O state.json acima diz `conectado: true` e o serviço está PARADO — é
// exatamente o estado que sobra depois de um `kill -9`, de uma queda ou de um
// container removido, porque nada invalida esse campo. O painel dizia
// "Conectado" para um número que não estava rodando, e foi assim que ele
// marcou como conectado justamente o número que nem pareia.
check('serviço parado NUNCA aparece como conectado', descoberta?.connected === false,
  String(descoberta?.connected))
// Serviço parado é ausência de sessão, não dúvida. O mesmo vale para a saúde:
// o registro ficou do jeito que estava quando o processo caiu.
check('e a saúde dele não é afirmada a partir de registro velho',
  descoberta?.health === 'desconhecida', descoberta?.health)
// O número continua saindo — ele é desta instância. O que muda é o que ele
// significa, e a tela diz isso com a data do registro.
check('o número continua disponível, como último visto', descoberta?.phoneNumber === '5599999999999')

// --- O BATIMENTO ATRAVESSA O QUE O PID NÃO ATRAVESSA --------------------
//
// Quando o número roda em outro container, o pid dele não existe aqui — e,
// pior, pode casar por acaso com um processo daqui. O `state.json` fica num
// volume compartilhado e é reescrito a cada 30s mesmo parado, então ele é o
// sinal que vale de qualquer lugar.
fsDesc.writeFileSync(pathDesc.join(pastaOutro, 'state.json'),
  JSON.stringify({ conectado: true, numero: '5599999999999', atualizadoEm: Date.now(), saude: { status: 'saudavel' } }))
{
  const comBatimento = serviceBare.listar().find((i) => i.instanceId === 'simples:outro')
  check('estado escrito agora há pouco conta como rodando', comBatimento?.unitStatus === 'rodando',
    comBatimento?.unitStatus)
  check('e aí "conectado" volta a valer', comBatimento?.connected === true, String(comBatimento?.connected))
}
{
  // Batimento velho e nenhum processo vivo: morreu. É o estado que sobra
  // depois de um kill -9, e é exatamente o que dizia "Conectado" para sempre.
  fsDesc.writeFileSync(pathDesc.join(pastaOutro, 'state.json'),
    JSON.stringify({ conectado: true, numero: '5599999999999', atualizadoEm: Date.now() - 3600000 }))
  const parada = serviceBare.listar().find((i) => i.instanceId === 'simples:outro')
  check('batimento velho e sem processo: parado', parada?.unitStatus === 'parado', parada?.unitStatus)
  check('e NÃO conectado', parada?.connected === false, String(parada?.connected))
}

// --- PASTA SOZINHA NÃO É INSTÂNCIA --------------------------------------
//
// `LCN_INSTANCIA=suite npm test` cria `data/instancias/suite/` vazia, e ela
// aparecia como um número real em três telas. O sinal de que um bot rodou ali
// é o state.json, não o diretório.
fsDesc.mkdirSync(pathDesc.join(raizDesc, 'instancias', 'pasta-vazia'), { recursive: true })
const comVazia = serviceBare.listar()
check('pasta sem state.json não vira instância',
  !comVazia.some((i) => i.instanceId === 'simples:pasta-vazia'),
  JSON.stringify(comVazia.map((i) => i.instanceId)))
check('e a que tem state.json continua aparecendo',
  comVazia.some((i) => i.instanceId === 'simples:outro'))
check('o principal continua na lista, separado', comDescoberta.some((i) => i.instanceId === 'bare'))

check('obter() resolve a instância descoberta', serviceBare.obter('simples:outro')?.instanceId === 'simples:outro')

// Id inventado não pode virar leitura de arquivo: a lista é fechada pela
// varredura, então nada é montado a partir do texto recebido.
let erroInventado
try { serviceBare.obter('simples:nao-existe') } catch (e) { erroInventado = e }
check('id de instância inexistente é recusado', !!erroInventado)

let erroTravessia
try { serviceBare.obter('simples:../../etc') } catch (e) { erroTravessia = e }
check('id com travessia de caminho é recusado', !!erroTravessia)

fsDesc.rmSync(pathDesc.join(raizDesc, 'instancias'), { recursive: true, force: true })

const iniciouBare = serviceBare.iniciar('bare')
check('iniciar("bare"): liga o bot pelo painel, sem exigir terminal', iniciouBare.ok === true && iniciouBare.action === 'start')
check('iniciar("bare"): usa o iniciarBot do runtime, não systemctl', bareServicoFake.chamadas.includes('iniciar'))
check('iniciar("bare"): nunca chama runtime.js por engano', !bareServicoFake.chamadas.includes('start'))

const paradaBare = serviceBare.parar('bare')
check('parar("bare"): chama pararBot() injetado, não systemctl', bareServicoFake.chamadas.includes('parar') && paradaBare.ok === true)

const reinicioBare = serviceBare.reiniciar('bare')
check('reiniciar("bare"): chama reiniciarBot() injetado, não systemctl', bareServicoFake.chamadas.includes('reiniciar') && reinicioBare.ok === true)

const otimBare = serviceBare.obterOtimizacao('bare')
check('otimização("bare"): lê o config.json do modo simples (injetado)', otimBare.bandwidthLimit.downloadBytesPerSecond === 0)

// --- Painel de recursos (Parte C, Módulo 6): uso e logs ---
const usoBare = serviceBare.obterUso('bare')
check('obterUso("bare"): lê memoriaMB de state.json (o painel roda num processo separado do bot)', usoBare.memoryMB === 47)
check('obterUso("bare"): calcula uptime a partir de iniciadoEm', usoBare.uptimeMs >= 119000 && usoBare.uptimeMs < 200000)
check('obterUso("bare"): lê os contadores acumulados de banda de state.json', usoBare.bandwidth.downloadBytesTotal === 2048 && usoBare.bandwidth.uploadBytesTotal === 1024)
check('obterUso("bare"): lê o limite configurado de config.json', usoBare.bandwidth.downloadLimitBytesPerSecond === 0)

// --- Soma de memória dos processos do container (gateway, motor, painel) ---
// Quando o motor não tem pid-file (arquivo ausente), soma honesta dos processos lidos:
check('obterUso("bare"): traz soma parcial honesta quando motor não tem pid-file', typeof usoBare.memoryTotal.totalMB === 'number' && usoBare.memoryTotal.totalMB >= 47)
check('obterUso("bare"): contagem indica 2 processos lidos (gateway e painel)', usoBare.memoryTotal.processCount === 2)
check('obterUso("bare"): indica que a soma é parcial (isPartial === true)', usoBare.memoryTotal.isPartial === true)
check('obterUso("bare"): não inventa zero para o motor ausente', usoBare.memoryTotal?.processes?.engine === null)

// Caso 1: Três processos legíveis
const arqPidEngineTres = path.join(pastaTmpBare, 'engine-tres.pid')
fs.writeFileSync(arqPidEngineTres, String(process.pid))
const serviceTres = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25
})
const usoTres = serviceTres.obterUso('bare')
check('obterUso três legíveis: soma dos 3 processos (47 + 35 + 25 = 107)', usoTres.memoryTotal.totalMB === 107)
check('obterUso três legíveis: contagem de processos é 3', usoTres.memoryTotal.processCount === 3)
check('obterUso três legíveis: soma completa não é parcial (isPartial === false)', usoTres.memoryTotal.isPartial === false)
check('obterUso três legíveis: memoryMB existente permanece inalterado (47)', usoTres.memoryMB === 47)
check('obterUso três legíveis: processos detalhados no bloco memoryTotal',
  usoTres.memoryTotal?.processes?.gateway === 47 &&
  usoTres.memoryTotal?.processes?.engine === 35 &&
  usoTres.memoryTotal?.processes?.panel === 25)

// Caso 2: Um processo ilegível (motor morto)
const arqPidEngineMorto = path.join(pastaTmpBare, 'engine-morto.pid')
fs.writeFileSync(arqPidEngineMorto, '99999999')
const serviceMotorMorto = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: arqPidEngineMorto,
  obterMemoriaPainel: () => 25
})
const usoMotorMorto = serviceMotorMorto.obterUso('bare')
check('obterUso um ilegível (motor morto): soma parcial honesta (47 + 25 = 72)', usoMotorMorto.memoryTotal.totalMB === 72)
check('obterUso um ilegível (motor morto): contagem de processos é 2', usoMotorMorto.memoryTotal.processCount === 2)
check('obterUso um ilegível (motor morto): marca isPartial === true', usoMotorMorto.memoryTotal.isPartial === true)
check('obterUso um ilegível (motor morto): não inventa zero nem derruba resposta', usoMotorMorto.memoryTotal?.processes?.engine === null)

// Caso 3: Gateway usando bloco memoria de state.js (linhas 85-99)
const bareArqEstadoBloco = path.join(pastaTmpBare, 'state-bloco.json')
fs.writeFileSync(bareArqEstadoBloco, JSON.stringify({
  memoriaMB: 50,
  memoria: { rssMB: 50, heapUsadoMB: 20, externaMB: 5, buffersMB: 2, processo: 'gateway' }
}))
const serviceComBloco = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado: bareArqEstadoBloco,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25
})
const usoComBloco = serviceComBloco.obterUso('bare')
check('obterUso com bloco memoria: lê rssMB do bloco gateway', usoComBloco.memoryTotal?.processes?.gateway === 50)
check('obterUso com bloco memoria: soma 50 + 35 + 25 = 110', usoComBloco.memoryTotal.totalMB === 110)

// Caso 4: Gateway ilegível (sem bloco memoria nem memoriaMB)
const bareArqEstadoSemMem = path.join(pastaTmpBare, 'state-sem-mem.json')
fs.writeFileSync(bareArqEstadoSemMem, JSON.stringify({ conectado: true }))
const serviceGatewayIlegivel = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado: bareArqEstadoSemMem,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25
})
const usoGatewayIlegivel = serviceGatewayIlegivel.obterUso('bare')
check('obterUso gateway ilegível: soma parcial honesta (35 + 25 = 60)', usoGatewayIlegivel.memoryTotal.totalMB === 60)
check('obterUso gateway ilegível: contagem de processos é 2', usoGatewayIlegivel.memoryTotal.processCount === 2)
check('obterUso gateway ilegível: marca isPartial === true', usoGatewayIlegivel.memoryTotal.isPartial === true)
check('obterUso gateway ilegível: gateway é null e memoryMB é null',
  usoGatewayIlegivel.memoryTotal?.processes?.gateway === null && usoGatewayIlegivel.memoryMB === null)

// --- Contabilidade honesta de memória do container via cgroup (v2 e v1) ---
// Caso 1: cgroup v2 com teto definido (usageMB e limitMB preenchidos)
const arqV2UsageComTeto = path.join(pastaTmpBare, 'cgroup-v2-usage-com-teto')
const arqV2LimitComTeto = path.join(pastaTmpBare, 'cgroup-v2-limit-com-teto')
fs.writeFileSync(arqV2UsageComTeto, '149213184\n') // 142 MiB
fs.writeFileSync(arqV2LimitComTeto, '536870912\n') // 512 MiB
const serviceV2ComTeto = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25,
  arqCgroupV2Usage: arqV2UsageComTeto,
  arqCgroupV2Limit: arqV2LimitComTeto,
  arqCgroupV1Usage: path.join(pastaTmpBare, 'cgroup-v1-ausente-usage'),
  arqCgroupV1Limit: path.join(pastaTmpBare, 'cgroup-v1-ausente-limit')
})
const usoV2ComTeto = serviceV2ComTeto.obterUso('bare')
check('obterUso cgroup v2 com teto: usageMB e limitMB preenchidos',
  usoV2ComTeto.containerMemory?.usageMB === 142 &&
  usoV2ComTeto.containerMemory?.limitMB === 512 &&
  usoV2ComTeto.containerMemory?.source === arqV2UsageComTeto)
check('obterUso cgroup v2 com teto: memoryTotal permanece idêntico',
  usoV2ComTeto.memoryTotal.totalMB === 107 &&
  usoV2ComTeto.memoryTotal.processCount === 3 &&
  usoV2ComTeto.memoryTotal.isPartial === false)

// Caso 2: cgroup v2 sem teto ("max": limitMB null, usageMB preenchido)
const arqV2LimitSemTeto = path.join(pastaTmpBare, 'cgroup-v2-limit-sem-teto')
fs.writeFileSync(arqV2LimitSemTeto, 'max\n')
const serviceV2SemTeto = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25,
  arqCgroupV2Usage: arqV2UsageComTeto,
  arqCgroupV2Limit: arqV2LimitSemTeto,
  arqCgroupV1Usage: path.join(pastaTmpBare, 'cgroup-v1-ausente-usage'),
  arqCgroupV1Limit: path.join(pastaTmpBare, 'cgroup-v1-ausente-limit')
})
const usoV2SemTeto = serviceV2SemTeto.obterUso('bare')
check('obterUso cgroup v2 sem teto ("max"): limitMB null e usageMB preenchido',
  usoV2SemTeto.containerMemory?.usageMB === 142 &&
  usoV2SemTeto.containerMemory?.limitMB === null &&
  usoV2SemTeto.containerMemory?.source === arqV2UsageComTeto)

// Caso 3: cgroup v1 com valor gigante de "sem teto" (>= 2^53: limitMB null)
const arqV1Usage = path.join(pastaTmpBare, 'cgroup-v1-usage')
const arqV1LimitSemTeto = path.join(pastaTmpBare, 'cgroup-v1-limit-sem-teto')
fs.writeFileSync(arqV1Usage, '149213184\n') // 142 MiB
fs.writeFileSync(arqV1LimitSemTeto, '9223372036854771712\n') // valor gigante da ordem de 2^63
const serviceV1SemTeto = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25,
  arqCgroupV2Usage: path.join(pastaTmpBare, 'cgroup-v2-ausente-usage'),
  arqCgroupV2Limit: path.join(pastaTmpBare, 'cgroup-v2-ausente-limit'),
  arqCgroupV1Usage: arqV1Usage,
  arqCgroupV1Limit: arqV1LimitSemTeto
})
const usoV1SemTeto = serviceV1SemTeto.obterUso('bare')
check('obterUso cgroup v1 com valor gigante de "sem teto": limitMB null e usageMB preenchido',
  usoV1SemTeto.containerMemory?.usageMB === 142 &&
  usoV1SemTeto.containerMemory?.limitMB === null &&
  usoV1SemTeto.containerMemory?.source === arqV1Usage)

// Caso 4: cgroup v1 com teto normal preenchido
const arqV1LimitComTeto = path.join(pastaTmpBare, 'cgroup-v1-limit-com-teto')
fs.writeFileSync(arqV1LimitComTeto, '536870912\n') // 512 MiB
const serviceV1ComTeto = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25,
  arqCgroupV2Usage: path.join(pastaTmpBare, 'cgroup-v2-ausente-usage'),
  arqCgroupV2Limit: path.join(pastaTmpBare, 'cgroup-v2-ausente-limit'),
  arqCgroupV1Usage: arqV1Usage,
  arqCgroupV1Limit: arqV1LimitComTeto
})
const usoV1ComTeto = serviceV1ComTeto.obterUso('bare')
check('obterUso cgroup v1 com teto normal: usageMB e limitMB preenchidos',
  usoV1ComTeto.containerMemory?.usageMB === 142 &&
  usoV1ComTeto.containerMemory?.limitMB === 512 &&
  usoV1ComTeto.containerMemory?.source === arqV1Usage)

// Caso 5: Arquivos ausentes: os três campos null, sem derrubar a resposta
const serviceAusente = criarInstanceService({
  exec,
  obterRegistro: () => ({ version: 1, nextSeq: 1, instances: {} }),
  bareArqEstado,
  bareArqConfig,
  arqPidEngine: arqPidEngineTres,
  lerRssPid: () => 35,
  obterMemoriaPainel: () => 25,
  arqCgroupV2Usage: path.join(pastaTmpBare, 'cgroup-v2-ausente-usage'),
  arqCgroupV2Limit: path.join(pastaTmpBare, 'cgroup-v2-ausente-limit'),
  arqCgroupV1Usage: path.join(pastaTmpBare, 'cgroup-v1-ausente-usage'),
  arqCgroupV1Limit: path.join(pastaTmpBare, 'cgroup-v1-ausente-limit')
})
const usoAusente = serviceAusente.obterUso('bare')
check('obterUso arquivos ausentes: os três null em containerMemory, sem derrubar a resposta',
  usoAusente.containerMemory?.usageMB === null &&
  usoAusente.containerMemory?.limitMB === null &&
  usoAusente.containerMemory?.source === null &&
  usoAusente.memoryTotal.totalMB === 107)

// Teste direto de lerMemoriaContainer
const diretoV2 = lerMemoriaContainer({
  caminhoV2Usage: arqV2UsageComTeto,
  caminhoV2Limit: arqV2LimitComTeto
})
check('lerMemoriaContainer: lê diretamente cgroup v2 com teto',
  diretoV2.usageMB === 142 && diretoV2.limitMB === 512 && diretoV2.source === arqV2UsageComTeto)

// Teste unitário de lerRssDoPid com o processo Node atual via /proc
const rssAtual = lerRssDoPid(process.pid)
check('lerRssDoPid: lê com sucesso RSS do processo atual via /proc/<pid>/statm ou status', typeof rssAtual === 'number' && rssAtual > 0)
check('lerRssDoPid: retorna null para pid inválido ou morto', lerRssDoPid(99999999) === null && lerRssDoPid(-1) === null)

let lancouUsoInstanciaParteA = false
try { service.obterUso('wa-000001') } catch { lancouUsoInstanciaParteA = true }
check('obterUso(instância Parte A): recusa com mensagem clara em vez de inventar número (podman stats não implementado/validado)', lancouUsoInstanciaParteA)

const logsBare = serviceBare.obterLogs('bare', 50)
check('obterLogs("bare"): chama bareLogsServico(n) injetado, não podman', bareServicoFake.chamadas.includes('logs:50'))
check('obterLogs("bare"): quebra a saída em linhas', JSON.stringify(logsBare.lines) === JSON.stringify(['linha 1', 'linha 2']))

const logsParteA = service.obterLogs('wa-000001', 30)
check('obterLogs(instância Parte A): chama "podman logs --tail N <container>"', chamadas.some((c) => c.comando === 'podman' && c.args.join(' ') === 'logs --tail 30 lcn-wa-000001'))
check('obterLogs(instância Parte A): quebra a saída em linhas', logsParteA.lines.length === 2 && logsParteA.lines[0] === 'log do container linha 1')

const logsSemLimite = service.obterLogs('wa-000001')
check('obterLogs sem "linhas" informado usa o default (100)', chamadas.some((c) => c.comando === 'podman' && c.args.includes('100')))
check('obterLogs com "linhas" absurdo é limitado a 1000 (nunca o arquivo inteiro)', (() => {
  service.obterLogs('wa-000001', 999999)
  return chamadas.some((c) => c.comando === 'podman' && c.args.includes('1000'))
})())

fs.rmSync(pastaTmpBare, { recursive: true, force: true })

// --- O CACHE DENTRO DO memory.current, com os números da produção ----------
//
// `memory.current` INCLUI cache de página, então ele é maior que o que o
// `docker stats` mostra, e sem dizer isso o número parece alto sem motivo.
// Medido no container de produção em 25/10 — são estes valores exatos:
//
//     memory.current  216035328 B = 206 MiB
//     inactive_file    65716224 B =  63 MiB
//     a diferença                   143 MiB
//     docker stats mostrava         142,3 MiB
//
// A checagem fixa a conta com os números medidos, não com números inventados:
// se alguém trocar a linha lida do memory.stat, isto quebra.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-cgroup-prod-'))
  fs.writeFileSync(path.join(dir, 'memory.current'), '216035328')
  fs.writeFileSync(path.join(dir, 'memory.max'), 'max')
  fs.writeFileSync(path.join(dir, 'memory.stat'),
    'anon 132608000\nfile 66998272\ninactive_file 65716224\nactive_file 1282048\nslab 11879272\n')
  const lido = lerMemoriaContainer({
    caminhoV2Usage: path.join(dir, 'memory.current'),
    caminhoV2Limit: path.join(dir, 'memory.max'),
    caminhoV2Stat: path.join(dir, 'memory.stat'),
    caminhoV1Usage: path.join(dir, 'nao-existe'),
    caminhoV1Limit: path.join(dir, 'nao-existe'),
    caminhoV1Stat: path.join(dir, 'nao-existe')
  })
  check('cgroup da produção: usageMB é o memory.current inteiro (206)', lido.usageMB === 206, JSON.stringify(lido))
  check('cgroup da produção: reclaimableCacheMB é o inactive_file (63)', lido.reclaimableCacheMB === 63)
  check('cgroup da produção: a diferença dá o conjunto de trabalho do docker stats (143)',
    lido.usageMB - lido.reclaimableCacheMB === 143)
  check('cgroup da produção: "max" vira limitMB null, não zero', lido.limitMB === null)
  fs.rmSync(dir, { recursive: true, force: true })
}


console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO INSTANCE SERVICE PASSARAM')
process.exit(falhas ? 1 : 0)
