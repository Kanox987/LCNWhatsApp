#!/usr/bin/env node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline/promises'
import {
  adicionarInstancia,
  buscarPorId,
  lerRegistro,
  listarInstancias,
  reconstruirDeInstanceJsons,
  removerInstancia,
  salvarRegistro
} from './registry.js'
import {
  ARQ_REGISTRO,
  PASTA_INSTANCIAS,
  PASTA_MODELOS_COMPARTILHADA,
  PASTA_UNITS_QUADLET,
  caminhoInstancia,
  caminhoUnit,
  nomeContainer
} from './paths.js'
import { gerarQuadlet } from './quadlet.js'
import { normalizarRuntime } from '../runtime.js'

const RAIZ_PROJETO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARQ_CONFIG_EXEMPLO = path.join(RAIZ_PROJETO, 'config.example.json')
const NOME_LEGADO = 'LCNWhatsApp'
const SAUDE_LIMPA = { falhasConsecutivas: 0, ultimoSucessoEm: null, status: 'ok', motivo: null, desde: null }

function uso () {
  console.log(`Uso: lcn instances <comando> [opções]

Comandos:
  create --label X [--phone +55...] [--memory 512m] [--cpus 1.0]
         [--whisper] [--model base]
  list
  start <id>
  stop <id>
  status <id>
  shell <id>
  quarantine-list
  retry <id>
  wipe <id>
  remove <id> [--keep-data]
  reconcile
  rebuild-registry
  build-image [--whisper]
  import [--path .] [--id wa-000001] [--label X] [--phone +55...]
         [--timeout 120]`)
}

function parsearOpcoes (args, esquema = {}) {
  const opcoes = {}
  const posicionais = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) {
      posicionais.push(arg)
      continue
    }
    const nome = arg.slice(2)
    const tipo = esquema[nome]
    if (!tipo) throw new Error(`Opção desconhecida: ${arg}`)
    if (tipo === 'boolean') {
      opcoes[nome] = true
      continue
    }
    const valor = args[++i]
    if (valor === undefined || valor.startsWith('--')) throw new Error(`Falta o valor de ${arg}`)
    opcoes[nome] = valor
  }
  return { opcoes, posicionais }
}

function semPosicionais (posicionais) {
  if (posicionais.length) throw new Error(`Argumento inesperado: ${posicionais[0]}`)
}

function idUnico (posicionais) {
  if (posicionais.length !== 1) throw new Error('Informe exatamente um id de instância (ex.: wa-000001).')
  return posicionais[0]
}

function lerJson (arquivo) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'))
  } catch {
    return null
  }
}

function escreverJsonAtomico (arquivo, dados) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true })
  const temporario = `${arquivo}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(temporario, JSON.stringify(dados, null, 2) + '\n')
  fs.renameSync(temporario, arquivo)
}

function executarCapturando (comando, args, { cwd = RAIZ_PROJETO } = {}) {
  const resultado = spawnSync(comando, args, { cwd, encoding: 'utf8' })
  if (resultado.error) {
    const detalhe = resultado.error.code === 'ENOENT' ? 'comando não encontrado' : resultado.error.message
    throw new Error(`Não foi possível executar ${comando}: ${detalhe}`)
  }
  return {
    ok: resultado.status === 0,
    status: resultado.status,
    stdout: resultado.stdout || '',
    stderr: resultado.stderr || ''
  }
}

function executarObrigatorio (comando, args, opcoes) {
  const resultado = executarCapturando(comando, args, opcoes)
  if (!resultado.ok) {
    const detalhe = (resultado.stderr || resultado.stdout).trim()
    throw new Error(`${comando} ${args.join(' ')} falhou${detalhe ? `: ${detalhe}` : ` (código ${resultado.status})`}`)
  }
  return resultado
}

function executarInterativo (comando, args, { cwd = RAIZ_PROJETO, env = process.env } = {}) {
  const resultado = spawnSync(comando, args, { cwd, env, stdio: 'inherit' })
  if (resultado.error) {
    const detalhe = resultado.error.code === 'ENOENT' ? 'comando não encontrado' : resultado.error.message
    throw new Error(`Não foi possível executar ${comando}: ${detalhe}`)
  }
  if (resultado.status !== 0) throw new Error(`${comando} terminou com código ${resultado.status}`)
}

function unidadeDa (instancia) {
  return `${instancia.containerName}.service`
}

function exigirInstancia (id) {
  const registro = lerRegistro()
  const instancia = buscarPorId(registro, id)
  if (!instancia) throw new Error(`Instância não encontrada: ${id}`)
  return { registro, instancia }
}

function validarAlvosGerenciados (instancia) {
  if (!/^wa-\d{6,}$/.test(instancia.instanceId)) {
    throw new Error(`Registro inconsistente: ID de instância inválido (${instancia.instanceId}).`)
  }
  const esperados = {
    dataDir: caminhoInstancia(instancia.instanceId),
    unitFile: caminhoUnit(instancia.instanceId),
    containerName: nomeContainer(instancia.instanceId)
  }
  for (const [campo, esperado] of Object.entries(esperados)) {
    const atual = instancia[campo]
    const igual = campo === 'containerName'
      ? atual === esperado
      : typeof atual === 'string' && path.resolve(atual) === path.resolve(esperado)
    if (!igual) {
      throw new Error(`Registro inconsistente para ${instancia.instanceId}: ${campo} não aponta para o alvo gerenciado esperado.`)
    }
  }
}

function exigirDiretorioReal (diretorio, descricao) {
  let stat
  try {
    stat = fs.lstatSync(diretorio)
  } catch (erro) {
    if (erro.code === 'ENOENT') throw new Error(`${descricao} não existe: ${diretorio}`)
    throw erro
  }
  if (stat.isSymbolicLink()) throw new Error(`${descricao} não pode ser um link simbólico: ${diretorio}`)
  if (!stat.isDirectory()) throw new Error(`${descricao} não é um diretório: ${diretorio}`)
}

function estadoDa (instancia) {
  return lerJson(path.join(instancia.dataDir, 'data', 'state.json'))
}

function limparSaude (instancia) {
  const arquivo = path.join(instancia.dataDir, 'data', 'state.json')
  const estado = lerJson(arquivo) || {}
  estado.saude = {
    ...SAUDE_LIMPA,
    ultimoSucessoEm: estado.saude?.ultimoSucessoEm ?? null
  }
  escreverJsonAtomico(arquivo, estado)
}

function validarTelefone (telefone) {
  if (telefone && !/^\+[1-9]\d{6,14}$/.test(telefone)) {
    throw new Error(`Telefone inválido: ${telefone}. Use o formato E.164, por exemplo +5511999999999.`)
  }
}

function validarRecursos (memory, cpus) {
  if (memory !== undefined && !memory.trim()) throw new Error('--memory não pode ser vazio.')
  if (cpus !== undefined && (!Number.isFinite(Number(cpus)) || Number(cpus) <= 0)) {
    throw new Error('--cpus deve ser um número maior que zero.')
  }
}

function checarSetupQuadlet () {
  fs.mkdirSync(PASTA_UNITS_QUADLET, { recursive: true })

  const usuario = process.env.USER || os.userInfo().username
  try {
    const linger = executarCapturando('loginctl', ['show-user', usuario, '--property=Linger'])
    if (!linger.ok || !/^Linger=yes$/m.test(linger.stdout.trim())) {
      console.warn(`AVISO: linger não está ativo para ${usuario}. Para sobreviver ao logout, rode: loginctl enable-linger ${usuario}`)
    }
  } catch (erro) {
    console.warn(`AVISO: não foi possível verificar linger (${erro.message}). Quando disponível, confira com: loginctl show-user "${usuario}" --property=Linger`)
  }

  const versao = executarCapturando('podman', ['--version'])
  if (!versao.ok) throw new Error(`Falha ao consultar a versão do Podman: ${(versao.stderr || versao.stdout).trim()}`)
  const achou = versao.stdout.match(/podman\s+version\s+(\d+)\.(\d+)/i)
  if (!achou) throw new Error(`Não foi possível reconhecer a versão do Podman em: ${versao.stdout.trim()}`)
  const major = Number(achou[1])
  const minor = Number(achou[2])
  if (major < 4 || (major === 4 && minor < 4)) {
    throw new Error(`Podman ${major}.${minor} não oferece o suporte Quadlet exigido. Atualize para Podman 4.4 ou superior.`)
  }
}

function adicionarComIdOpcional (registro, dados, idDesejado) {
  if (!idDesejado) return adicionarInstancia(registro, dados)
  const match = /^wa-(\d{6,})$/.exec(idDesejado)
  if (!match) throw new Error(`ID inválido: ${idDesejado}. Use o formato wa-000001.`)
  if (buscarPorId(registro, idDesejado)) throw new Error(`O ID ${idDesejado} já está registrado.`)
  const seq = Number(match[1])
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`ID inválido: ${idDesejado}`)

  const temporario = { ...registro, nextSeq: seq }
  const adicionado = adicionarInstancia(temporario, dados)
  return {
    instancia: adicionado.instancia,
    registro: { ...adicionado.registro, nextSeq: Math.max(registro.nextSeq, adicionado.registro.nextSeq) }
  }
}

function prepararArquivosInstancia (instancia, configOrigem = ARQ_CONFIG_EXEMPLO) {
  if (fs.existsSync(instancia.dataDir)) throw new Error(`O diretório de destino já existe: ${instancia.dataDir}`)
  if (fs.existsSync(instancia.unitFile)) throw new Error(`A unit Quadlet já existe: ${instancia.unitFile}`)
  if (!fs.existsSync(configOrigem)) throw new Error(`Configuração de origem não encontrada: ${configOrigem}`)

  fs.mkdirSync(instancia.dataDir, { recursive: true })
  for (const nome of ['sessao', 'midia', 'data']) fs.mkdirSync(path.join(instancia.dataDir, nome))
  fs.copyFileSync(configOrigem, path.join(instancia.dataDir, 'config.json'))
  escreverJsonAtomico(path.join(instancia.dataDir, 'instance.json'), instancia)
  if (instancia.transcricaoLocal.instalada) fs.mkdirSync(PASTA_MODELOS_COMPARTILHADA, { recursive: true })
  fs.writeFileSync(instancia.unitFile, gerarQuadlet(instancia))
}

function imprimirProximosPassos (instancia) {
  console.log(`Instância ${instancia.instanceId} criada em ${instancia.dataDir}.`)
  console.log('Próximos passos:')
  console.log('  systemctl --user daemon-reload')
  console.log(`  systemctl --user enable --now ${unidadeDa(instancia)}`)
  console.log(`  lcn instances shell ${instancia.instanceId}`)
}

function comandoCreate (args) {
  const { opcoes, posicionais } = parsearOpcoes(args, {
    label: 'valor', phone: 'valor', memory: 'valor', cpus: 'valor', whisper: 'boolean', model: 'valor'
  })
  semPosicionais(posicionais)
  if (!opcoes.label) throw new Error('create exige --label X.')
  validarTelefone(opcoes.phone)
  validarRecursos(opcoes.memory, opcoes.cpus)
  checarSetupQuadlet()

  const registro = lerRegistro()
  const adicionado = adicionarInstancia(registro, {
    label: opcoes.label,
    expectedPhoneE164: opcoes.phone,
    resources: { memory: opcoes.memory ?? null, cpus: opcoes.cpus ?? null },
    transcricaoLocal: { instalada: !!opcoes.whisper, modelo: opcoes.model || 'base' }
  })
  prepararArquivosInstancia(adicionado.instancia)
  salvarRegistro(adicionado.registro)
  imprimirProximosPassos(adicionado.instancia)
}

function statusUnit (instancia) {
  try {
    const resultado = executarCapturando('systemctl', ['--user', 'is-active', unidadeDa(instancia)])
    return resultado.stdout.trim() || (resultado.ok ? 'active' : 'inactive')
  } catch {
    return 'indisponível'
  }
}

function formatarTabela (linhas) {
  const cabecalho = ['ID', 'LABEL', 'TELEFONE', 'MEM', 'CPUS', 'UNIT', 'CONEXÃO', 'SAÚDE']
  const matriz = [cabecalho, ...linhas]
  const larguras = cabecalho.map((_, i) => Math.max(...matriz.map((linha) => String(linha[i] ?? '').length)))
  return matriz.map((linha, indice) => {
    const texto = linha.map((valor, i) => String(valor ?? '').padEnd(larguras[i])).join('  ').trimEnd()
    if (indice !== 0) return texto
    return `${texto}\n${larguras.map((n) => '-'.repeat(n)).join('  ')}`
  }).join('\n')
}

function linhasDasInstancias ({ somenteQuarentena = false } = {}) {
  const instancias = listarInstancias(lerRegistro()).sort((a, b) => a.instanceId.localeCompare(b.instanceId))
  return instancias.flatMap((instancia) => {
    const estado = estadoDa(instancia)
    const saude = estado?.saude?.status || 'desconhecida'
    if (somenteQuarentena && (!estado?.saude?.status || estado.saude.status === 'ok')) return []
    const conexao = estado?.conectado === true ? 'conectado' : estado?.conectado === false ? 'desconectado' : 'desconhecida'
    return [[
      instancia.instanceId,
      instancia.label,
      instancia.expectedPhoneE164 || '-',
      instancia.resources?.memory ?? '-',
      instancia.resources?.cpus ?? '-',
      statusUnit(instancia),
      conexao,
      saude
    ]]
  })
}

function comandoList ({ somenteQuarentena = false } = {}) {
  const linhas = linhasDasInstancias({ somenteQuarentena })
  if (!linhas.length) {
    console.log(somenteQuarentena ? 'Nenhuma instância em estado de erro/quarentena.' : 'Nenhuma instância registrada.')
    return
  }
  console.log(formatarTabela(linhas))
}

function comandoSystemctlSimples (acao, args) {
  const { posicionais } = parsearOpcoes(args)
  const { instancia } = exigirInstancia(idUnico(posicionais))
  executarObrigatorio('systemctl', ['--user', acao, unidadeDa(instancia)])
  console.log(`${instancia.instanceId}: ${acao} concluído.`)
}

function comandoStatus (args) {
  const { posicionais } = parsearOpcoes(args)
  const { instancia } = exigirInstancia(idUnico(posicionais))
  const resultado = executarCapturando('systemctl', ['--user', 'status', '--no-pager', unidadeDa(instancia)])
  const texto = `${resultado.stdout}${resultado.stderr}`.trimEnd()
  if (texto) console.log(texto)
  const estado = estadoDa(instancia)
  console.log('\nEstado da instância:')
  console.log(JSON.stringify({
    conectado: estado?.conectado ?? null,
    numero: estado?.numero ?? null,
    nome: estado?.nome ?? null,
    desde: estado?.desde ?? null,
    atualizadoEm: estado?.atualizadoEm ?? null,
    saude: estado?.saude ?? null
  }, null, 2))
}

function comandoShell (args) {
  const { posicionais } = parsearOpcoes(args)
  const { instancia } = exigirInstancia(idUnico(posicionais))
  executarInterativo('podman', ['exec', '-it', instancia.containerName, 'node', 'src/dashboard.js'])
}

function comandoRetry (args) {
  const { posicionais } = parsearOpcoes(args)
  const { instancia } = exigirInstancia(idUnico(posicionais))
  limparSaude(instancia)
  executarObrigatorio('systemctl', ['--user', 'restart', unidadeDa(instancia)])
  console.log(`${instancia.instanceId}: saúde limpa e unit reiniciada.`)
}

async function confirmar (pergunta) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const resposta = (await rl.question(`${pergunta} [sim/N] `)).trim().toLowerCase()
    return resposta === 'sim' || resposta === 's'
  } finally {
    rl.close()
  }
}

async function comandoWipe (args) {
  const { posicionais } = parsearOpcoes(args)
  const { instancia } = exigirInstancia(idUnico(posicionais))
  validarAlvosGerenciados(instancia)
  exigirDiretorioReal(instancia.dataDir, 'Diretório da instância')
  const pastaSessao = path.join(instancia.dataDir, 'sessao')
  exigirDiretorioReal(pastaSessao, 'Diretório de sessão')
  const aceitou = await confirmar(`Apagar TODO o conteúdo de ${path.join(instancia.dataDir, 'sessao')}? Mídias e dados serão preservados.`)
  if (!aceitou) {
    console.log('Operação cancelada.')
    return
  }

  executarObrigatorio('systemctl', ['--user', 'stop', unidadeDa(instancia)])
  for (const entrada of fs.readdirSync(pastaSessao)) {
    fs.rmSync(path.join(pastaSessao, entrada), { recursive: true, force: true })
  }
  limparSaude(instancia)
  executarObrigatorio('systemctl', ['--user', 'start', unidadeDa(instancia)])
  console.log(`${instancia.instanceId}: sessão apagada; midia/ e data/ foram preservados. Abra o shell para parear novamente.`)
}

function comandoRemove (args) {
  const { opcoes, posicionais } = parsearOpcoes(args, { 'keep-data': 'boolean' })
  const id = idUnico(posicionais)
  const { registro, instancia } = exigirInstancia(id)
  if (opcoes['keep-data']) {
    salvarRegistro(removerInstancia(registro, id))
    console.log(`${id}: removida apenas do registro; unit e dados foram preservados.`)
    return
  }

  validarAlvosGerenciados(instancia)
  executarObrigatorio('systemctl', ['--user', 'stop', unidadeDa(instancia)])
  executarObrigatorio('systemctl', ['--user', 'disable', unidadeDa(instancia)])
  fs.rmSync(instancia.unitFile, { force: true })
  fs.rmSync(instancia.dataDir, { recursive: true, force: true })
  salvarRegistro(removerInstancia(registro, id))
  const reload = executarCapturando('systemctl', ['--user', 'daemon-reload'])
  if (!reload.ok) console.warn(`AVISO: daemon-reload falhou: ${(reload.stderr || reload.stdout).trim()}`)
  console.log(`${id}: unit, dados e entrada do registro removidos.`)
}

function comandoReconcile (args) {
  const { posicionais } = parsearOpcoes(args)
  semPosicionais(posicionais)
  const registro = lerRegistro()
  const instancias = listarInstancias(registro)
  const resultado = executarObrigatorio('podman', ['ps', '-a', '--format', '{{.Names}}'])
  const containers = resultado.stdout.split(/\r?\n/).map((nome) => nome.trim()).filter(Boolean)
  const gerenciados = new Set(instancias.map((instancia) => instancia.containerName))
  const orfaos = containers.filter((nome) => (nome.startsWith('lcn-') || nome === NOME_LEGADO) && !gerenciados.has(nome))
  const inconsistencias = instancias.flatMap((instancia) => {
    const faltas = []
    if (!containers.includes(instancia.containerName)) faltas.push('container')
    if (!fs.existsSync(instancia.unitFile)) faltas.push('unit')
    return faltas.length ? [`${instancia.instanceId}: sem ${faltas.join(' e ')}`] : []
  })

  console.log('Containers órfãos:')
  if (orfaos.length) orfaos.forEach((nome) => console.log(`  - ${nome}`)); else console.log('  nenhum')
  console.log('Entradas inconsistentes no registro:')
  if (inconsistencias.length) inconsistencias.forEach((linha) => console.log(`  - ${linha}`)); else console.log('  nenhuma')
}

function comandoRebuildRegistry (args) {
  const { posicionais } = parsearOpcoes(args)
  semPosicionais(posicionais)
  const registro = reconstruirDeInstanceJsons(PASTA_INSTANCIAS)
  salvarRegistro(registro)
  console.log(`Registro reconstruído em ${ARQ_REGISTRO}: ${listarInstancias(registro).length} instância(s).`)
}

function comandoBuildImage (args) {
  const { opcoes, posicionais } = parsearOpcoes(args, { whisper: 'boolean' })
  semPosicionais(posicionais)
  const dockerfile = opcoes.whisper ? 'Dockerfile.whisper' : 'Dockerfile'
  executarInterativo('sh', [path.join(RAIZ_PROJETO, 'build-image.sh'), dockerfile], {
    env: { ...process.env, LCN_CONTAINER_ENGINE: 'podman' }
  })
}

function detectarInstalacao (pasta) {
  const caminhos = {
    config: path.join(pasta, 'config.json'),
    runtime: path.join(pasta, 'runtime.json'),
    sessao: path.join(pasta, 'sessao'),
    midia: path.join(pasta, 'midia'),
    data: path.join(pasta, 'data')
  }
  for (const [nome, arquivo] of Object.entries(caminhos)) {
    if (nome === 'midia') continue
    if (!fs.existsSync(arquivo)) throw new Error(`Instalação inválida em ${pasta}: falta ${path.basename(arquivo)}.`)
  }
  const config = lerJson(caminhos.config)
  const runtimeBruto = lerJson(caminhos.runtime)
  if (!config) throw new Error(`config.json inválido em ${pasta}.`)
  if (!runtimeBruto) throw new Error(`runtime.json inválido em ${pasta}.`)
  const sqlite = path.join(caminhos.sessao, 'zapo.sqlite')
  if (!fs.existsSync(sqlite) || fs.statSync(sqlite).size === 0) {
    throw new Error(`Sessão não migrável: ${sqlite} não existe ou está vazio.`)
  }
  return { caminhos, config, runtime: normalizarRuntime(runtimeBruto), sqlite }
}

function telefoneDoEstado (arquivoEstado) {
  const numero = lerJson(arquivoEstado)?.numero
  if (numero === null || numero === undefined || String(numero).trim() === '') return null
  const limpo = String(numero).trim().replace(/[^\d+]/g, '')
  return limpo.startsWith('+') ? limpo : `+${limpo}`
}

function pidVivo (pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function exigirPidDaInstalacao (pid, pastaOrigem) {
  const caminhoCwd = `/proc/${pid}/cwd`
  let cwdProcesso
  try {
    cwdProcesso = fs.realpathSync(caminhoCwd)
  } catch (erro) {
    throw new Error(`Não foi possível confirmar que o PID ${pid} pertence à instalação (${erro.message}); ele não será encerrado.`)
  }
  const origemReal = fs.realpathSync(pastaOrigem)
  if (cwdProcesso !== origemReal) {
    throw new Error(`O PID ${pid} registrado pela instalação está executando em ${cwdProcesso}, não em ${origemReal}; ele não será encerrado.`)
  }
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pararInstalacaoAntiga (instalacao) {
  if (instalacao.runtime.mode === 'docker') {
    const engine = instalacao.runtime.engine || 'docker'
    const existe = executarCapturando(engine, ['ps', '-a', '--filter', `name=${NOME_LEGADO}`, '--format', '{{.Names}}'])
    if (!existe.ok) throw new Error(`Não foi possível verificar o container antigo: ${(existe.stderr || existe.stdout).trim()}`)
    if (!existe.stdout.split(/\r?\n/).includes(NOME_LEGADO)) {
      console.log(`Container ${NOME_LEGADO} já está parado/ausente.`)
      return
    }
    executarObrigatorio(engine, ['stop', NOME_LEGADO])
    console.log(`Container antigo ${NOME_LEGADO} parado via ${engine}.`)
    return
  }

  const arquivoPid = path.join(instalacao.caminhos.data, 'bot.pid')
  const estado = lerJson(path.join(instalacao.caminhos.data, 'state.json'))
  const pid = Number.parseInt(fs.existsSync(arquivoPid) ? fs.readFileSync(arquivoPid, 'utf8') : estado?.pid, 10)
  if (!pid || !pidVivo(pid)) {
    console.log('Processo nativo antigo já está parado (nenhum PID vivo encontrado).')
    return
  }
  exigirPidDaInstalacao(pid, instalacao.pasta)
  try {
    process.kill(pid, 'SIGTERM')
  } catch (erro) {
    throw new Error(`Não foi possível parar o processo nativo ${pid}: ${erro.message}`)
  }
  for (let i = 0; i < 40 && pidVivo(pid); i++) await esperar(250)
  if (pidVivo(pid)) throw new Error(`O processo nativo ${pid} não encerrou em 10 segundos.`)
  console.log(`Processo nativo antigo ${pid} parado.`)
}

function copiarInstalacao (instalacao, instancia) {
  fs.mkdirSync(instancia.dataDir, { recursive: true })
  fs.copyFileSync(instalacao.caminhos.config, path.join(instancia.dataDir, 'config.json'))
  for (const nome of ['sessao', 'midia', 'data']) {
    const origem = instalacao.caminhos[nome]
    const destino = path.join(instancia.dataDir, nome)
    if (fs.existsSync(origem)) fs.cpSync(origem, destino, { recursive: true, force: false, errorOnExist: true })
    else fs.mkdirSync(destino)
  }
  // O PID antigo pertence à instalação de origem. Ela deve permanecer intacta,
  // mas a cópia nova não pode nascer apontando para um processo já encerrado.
  fs.rmSync(path.join(instancia.dataDir, 'data', 'bot.pid'), { force: true })
}

function validarCopia (instancia) {
  const sqlite = path.join(instancia.dataDir, 'sessao', 'zapo.sqlite')
  if (!fs.existsSync(sqlite) || fs.statSync(sqlite).size === 0) {
    throw new Error(`Validação da cópia falhou: ${sqlite} não existe ou está vazio.`)
  }
  const config = lerJson(path.join(instancia.dataDir, 'config.json'))
  if (!config) throw new Error('Validação da cópia falhou: config.json não é JSON válido.')
}

async function esperarConexao (instancia, timeoutSegundos, inicio, mtimeAnterior) {
  const arquivoEstado = path.join(instancia.dataDir, 'data', 'state.json')
  const limite = Date.now() + timeoutSegundos * 1000
  let proximoAviso = Date.now()
  while (Date.now() < limite) {
    const estado = lerJson(arquivoEstado)
    let mtime = 0
    try { mtime = fs.statSync(arquivoEstado).mtimeMs } catch {}
    const estadoNovo = mtime > mtimeAnterior && Number(estado?.atualizadoEm || 0) >= inicio - 1000
    if (estadoNovo && estado?.conectado === true) return estado
    if (Date.now() >= proximoAviso) {
      const decorrido = Math.round((Date.now() - inicio) / 1000)
      console.log(`Aguardando conexão de ${instancia.instanceId}... ${decorrido}s/${timeoutSegundos}s`)
      proximoAviso = Date.now() + 10000
    }
    await esperar(1000)
  }
  throw new Error(`Timeout de ${timeoutSegundos}s aguardando conectado:true atualizado pela nova instância. Os originais continuam intactos e não foram renomeados.`)
}

function originaisParaBackup (instalacao) {
  return [
    instalacao.caminhos.sessao,
    ...(fs.existsSync(instalacao.caminhos.midia) ? [instalacao.caminhos.midia] : []),
    instalacao.caminhos.data,
    instalacao.caminhos.config,
    instalacao.caminhos.runtime
  ]
}

function validarDestinosBackup (originais) {
  for (const origem of originais) {
    const backup = `${origem}.pre-instances.bak`
    if (fs.existsSync(backup)) throw new Error(`Backup anterior já existe: ${backup}. Resolva-o antes de importar.`)
  }
}

function renomearOriginais (originais) {
  const renomeados = []
  try {
    for (const origem of originais) {
      const backup = `${origem}.pre-instances.bak`
      fs.renameSync(origem, backup)
      renomeados.push({ origem, backup })
    }
  } catch (erro) {
    const falhasRollback = []
    for (const { origem, backup } of renomeados.reverse()) {
      try {
        fs.renameSync(backup, origem)
      } catch (erroRollback) {
        falhasRollback.push(`${backup}: ${erroRollback.message}`)
      }
    }
    const detalheRollback = falhasRollback.length
      ? ` Rollback incompleto: ${falhasRollback.join('; ')}`
      : ' Os itens já renomeados foram restaurados.'
    throw new Error(`Falha ao preservar os originais como backup: ${erro.message}.${detalheRollback}`)
  }
}

function desativarNovaInstanciaAposFalha (instancia) {
  const falhas = []
  for (const acao of ['stop', 'disable']) {
    try {
      const resultado = executarCapturando('systemctl', ['--user', acao, unidadeDa(instancia)])
      if (!resultado.ok) falhas.push(`${acao}: ${(resultado.stderr || resultado.stdout).trim() || `código ${resultado.status}`}`)
    } catch (erro) {
      falhas.push(`${acao}: ${erro.message}`)
    }
  }
  return falhas
}

async function comandoImport (args) {
  const { opcoes, posicionais } = parsearOpcoes(args, {
    path: 'valor', id: 'valor', label: 'valor', phone: 'valor', memory: 'valor', cpus: 'valor',
    whisper: 'boolean', model: 'valor', timeout: 'valor'
  })
  semPosicionais(posicionais)
  checarSetupQuadlet()

  const pastaOrigem = path.resolve(opcoes.path || '.')
  const instalacao = detectarInstalacao(pastaOrigem)
  instalacao.pasta = fs.realpathSync(pastaOrigem)
  const telefoneInferido = telefoneDoEstado(path.join(instalacao.caminhos.data, 'state.json'))
  const telefone = opcoes.phone || telefoneInferido
  if (!opcoes.phone && telefoneInferido) console.log(`Telefone detectado em state.json: ${telefoneInferido}`)
  validarTelefone(telefone)
  validarRecursos(opcoes.memory, opcoes.cpus)
  const timeout = Number(opcoes.timeout || 120)
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('--timeout deve ser um número de segundos maior que zero.')

  const registro = lerRegistro()
  const adicionado = adicionarComIdOpcional(registro, {
    label: opcoes.label || path.basename(pastaOrigem),
    expectedPhoneE164: telefone,
    resources: {
      memory: opcoes.memory ?? instalacao.runtime.container.memory,
      cpus: opcoes.cpus ?? instalacao.runtime.container.cpus
    },
    transcricaoLocal: {
      instalada: opcoes.whisper || instalacao.runtime.transcricaoLocal.instalada,
      modelo: opcoes.model || instalacao.runtime.transcricaoLocal.modelo
    }
  }, opcoes.id)
  const instancia = adicionado.instancia
  if (fs.existsSync(instancia.dataDir)) throw new Error(`O diretório de destino já existe: ${instancia.dataDir}`)
  if (fs.existsSync(instancia.unitFile)) throw new Error(`A unit Quadlet já existe: ${instancia.unitFile}`)
  if (path.resolve(instancia.dataDir).startsWith(`${pastaOrigem}${path.sep}`)) {
    throw new Error('A instalação de origem não pode conter o diretório de destino da nova instância.')
  }

  const originais = originaisParaBackup(instalacao)
  validarDestinosBackup(originais)
  await pararInstalacaoAntiga(instalacao)
  copiarInstalacao(instalacao, instancia)
  validarCopia(instancia)
  escreverJsonAtomico(path.join(instancia.dataDir, 'instance.json'), instancia)
  if (instancia.transcricaoLocal.instalada) fs.mkdirSync(PASTA_MODELOS_COMPARTILHADA, { recursive: true })
  fs.writeFileSync(instancia.unitFile, gerarQuadlet(instancia))
  salvarRegistro(adicionado.registro)

  executarObrigatorio('systemctl', ['--user', 'daemon-reload'])
  const arquivoEstado = path.join(instancia.dataDir, 'data', 'state.json')
  let mtimeAnterior = 0
  try { mtimeAnterior = fs.statSync(arquivoEstado).mtimeMs } catch {}
  const inicio = Date.now()
  let estado
  try {
    executarObrigatorio('systemctl', ['--user', 'enable', '--now', unidadeDa(instancia)])
    estado = await esperarConexao(instancia, timeout, inicio, mtimeAnterior)
    renomearOriginais(originais)
  } catch (erro) {
    const falhasDesativacao = desativarNovaInstanciaAposFalha(instancia)
    const detalhe = falhasDesativacao.length
      ? ` Não foi possível desativar completamente a nova unit (${falhasDesativacao.join('; ')}).`
      : ' A nova unit foi parada e desabilitada.'
    throw new Error(`${erro.message}${detalhe} Os originais permanecem preservados.`)
  }
  console.log(`Importação concluída: ${instancia.instanceId} conectada como ${estado.numero || telefone || 'número não informado'}.`)
  console.log('A instalação antiga foi tornada inerte; os originais estão preservados com o sufixo .pre-instances.bak.')
  console.log(`Gerencie a nova instância com: lcn instances status ${instancia.instanceId}`)
}

async function main () {
  const [comando, ...args] = process.argv.slice(2)
  switch (comando) {
    case 'create': return comandoCreate(args)
    case 'list': {
      const { posicionais } = parsearOpcoes(args); semPosicionais(posicionais); return comandoList()
    }
    case 'start': return comandoSystemctlSimples('start', args)
    case 'stop': return comandoSystemctlSimples('stop', args)
    case 'status': return comandoStatus(args)
    case 'shell': return comandoShell(args)
    case 'quarantine-list': {
      const { posicionais } = parsearOpcoes(args); semPosicionais(posicionais); return comandoList({ somenteQuarentena: true })
    }
    case 'retry': return comandoRetry(args)
    case 'wipe': return comandoWipe(args)
    case 'remove': return comandoRemove(args)
    case 'reconcile': return comandoReconcile(args)
    case 'rebuild-registry': return comandoRebuildRegistry(args)
    case 'build-image': return comandoBuildImage(args)
    case 'import': return comandoImport(args)
    case 'help':
    case '--help':
    case '-h': return uso()
    default:
      uso()
      throw new Error(comando ? `Comando desconhecido: ${comando}` : 'Informe um comando.')
  }
}

const ehCliDireta = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (ehCliDireta) {
  main().catch((erro) => {
    console.error(`Erro: ${erro.message}`)
    process.exitCode = 1
  })
}
