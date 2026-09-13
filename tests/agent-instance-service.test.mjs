// Módulo 3 da Etapa 4.5 (painel web): serviço de ciclo de vida/otimização
// de instância no agente. `exec`/`obterRegistro` são injetados — nunca
// toca em systemctl/podman real nem no registry.json real do usuário.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { criarInstanceService, InstanciaNaoEncontradaError, validarAlvoGerenciado } from '../src/agent/instanceService.js'

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
const service = criarInstanceService({ exec, obterRegistro: registroFixture, caminhoInstanciaFn, nomeContainerFn })

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
  bareStatusServico: () => { bareServicoFake.chamadas.push('status'); return 'rodando' },
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

let lancouStartBare = false
try { serviceBare.iniciar('bare') } catch { lancouStartBare = true }
check('iniciar("bare"): recusado com mensagem clara (exige terminal pra ligar do zero)', lancouStartBare)
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

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO INSTANCE SERVICE PASSARAM')
process.exit(falhas ? 1 : 0)
