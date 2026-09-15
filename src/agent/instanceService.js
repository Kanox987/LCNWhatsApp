// Módulo 3 da Etapa 4.5 (painel web) do plano — lado do AGENTE/data plane:
// ciclo de vida operacional de instância (status real, start/stop/restart,
// pareamento, controles de otimização) que o CRUD do motor (`/instances`)
// não sabe fazer — aquele só guarda metadado, nunca sabe se o container
// está de pé. Extraído do que `src/instances/cli.js` já faz na prática, mas
// como funções importáveis (sem dispatcher de CLI, sem I/O interativo) —
// pensado pra ser consumido por `src/web/server.js` (Módulo 4) e,
// futuramente, pelo mesmo caminho atrás de um WSS hospedado.
//
// `exec` é injetável de propósito: os testes nunca tocam em systemctl/podman
// de verdade, só verificam os comandos que seriam executados.
//
// Além das instâncias registradas (Parte A, `lcn instances create`), este
// serviço também expõe uma instância VIRTUAL "bare" — representa o número
// único rodando no modo simples (`node index.js`/`npm start`, sem registro
// nenhum), que é como o projeto funciona antes de alguém migrar pra
// multi-instância. Pedido explícito do usuário: a aba de pareamento do
// painel web precisa cobrir os dois cenários, não só instâncias da Parte A.
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import QRCode from 'qrcode'
import { lerRegistro, buscarPorId, listarInstancias as listarInstanciasRegistro } from '../instances/registry.js'
import { caminhoInstancia, nomeContainer } from '../instances/paths.js'
import { ARQ_ESTADO as ARQ_ESTADO_BARE, ARQ_CONFIG as ARQ_CONFIG_BARE } from '../paths.js'
import { statusServico as statusServicoBare, iniciarBot as iniciarBotBare, pararBot as pararBotBare, reiniciarBot as reiniciarBotBare, logsServico as logsServicoBare } from '../runtime.js'

export const ID_BARE = 'bare'

export function executarCapturando (comando, args, { cwd } = {}) {
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
  // Achado de revisão de segurança: config.json pode conter chave de API
  // (transcricao.openaiApiKey, etc.) — sem modo explícito, o arquivo final
  // herda o umask do processo (visto 0664 nesta máquina), legível por
  // outros usuários locais num host compartilhado. mode na criação +
  // chmod depois do rename (rename não garante herdar o modo em todo FS).
  fs.writeFileSync(temporario, JSON.stringify(dados, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temporario, arquivo)
  fs.chmodSync(arquivo, 0o600)
}

function unidadeDa (instancia) {
  return `${instancia.containerName}.service`
}

const BANDWIDTH_PADRAO = { downloadBytesPerSecond: 0, uploadBytesPerSecond: 0 }
const QUARENTENA_PADRAO = 15
const FORMATO_ID = /^wa-\d{6,}$/

// `buscarPorId` (registry.js) faz `registro.instances[id]` — um objeto
// literal `{}` ainda herda de Object.prototype, então id="__proto__"
// resolveria pra Object.prototype (verdadeiro!) em vez de undefined. Isso
// já existia em src/instances/cli.js, mas só era alcançável via argumento
// de CLI local; agora está exposto por HTTP (mesmo que só em 127.0.0.1),
// então valida o formato ANTES de qualquer lookup — acha real desta
// revisão, corrigido aqui e não em registry.js pra não mexer no
// comportamento já em uso pela CLI de terminal sem necessidade.
export function idValido (id) {
  if (typeof id === 'string' && id.startsWith('simples:')) {
    // Só o formato aqui; quem confirma que existe é a varredura em obter().
    return /^simples:[\w.-]+$/.test(id)
  }
  return id === ID_BARE || (typeof id === 'string' && FORMATO_ID.test(id))
}

// Achado de revisão de segurança (2ª rodada): validar só o FORMATO do id
// não basta — depois do lookup, `instancia.dataDir`/`containerName` vêm do
// registro como estão, sem checagem nenhuma. Um registro adulterado (ou
// corrompido por acidente) sob a chave válida "wa-000001" poderia apontar
// `dataDir` pra outro diretório qualquer (um PUT .../optimization
// sobrescreveria o config.json de lá) ou `containerName` pra outra unit
// (start/stop/restart afetaria o serviço errado). Mesmo princípio de
// `validarAlvosGerenciados()` em src/instances/cli.js, reaplicado aqui pro
// caminho HTTP. Também recusa symlink em dataDir (mesmo motivo de
// `exigirDiretorioReal()` em cli.js: path.resolve() sozinho não detecta um
// diretório gerenciado substituído por link simbólico).
export function validarAlvoGerenciado (instancia, { caminhoInstanciaFn = caminhoInstancia, nomeContainerFn = nomeContainer } = {}) {
  const dataDirEsperado = caminhoInstanciaFn(instancia.instanceId)
  const containerEsperado = nomeContainerFn(instancia.instanceId)
  if (typeof instancia.dataDir !== 'string' || path.resolve(instancia.dataDir) !== path.resolve(dataDirEsperado)) {
    throw new Error(`Registro inconsistente para ${instancia.instanceId}: dataDir não aponta pro alvo gerenciado esperado.`)
  }
  if (instancia.containerName !== containerEsperado) {
    throw new Error(`Registro inconsistente para ${instancia.instanceId}: containerName não é o esperado.`)
  }
  try {
    if (fs.lstatSync(instancia.dataDir).isSymbolicLink()) {
      throw new Error(`Registro inconsistente para ${instancia.instanceId}: dataDir não pode ser um link simbólico.`)
    }
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro
  }
}

export class InstanciaNaoEncontradaError extends Error {
  constructor (id) {
    super(`Instância não encontrada: ${id}`)
    this.name = 'InstanciaNaoEncontradaError'
    this.instanceId = id
  }
}

// Instâncias do modo simples descobertas PELA PASTA.
//
// `LCN_INSTANCIA=pessoal node index.js` cria `data/instancias/pessoal/` e passa
// a rodar um segundo número ali. Nada registra isso em lugar nenhum — a pasta é
// a verdade. Sem esta varredura o painel mostrava só o número principal e o
// dono perguntava, com razão, por que o segundo não aparecia.
//
// O nome vem do NOME DA PASTA, nunca de entrada de usuário, e a lista é fechada:
// `obter()` só aceita um id que apareça aqui, então não existe caminho para
// montar diretório a partir de texto recebido.
const PREFIXO_SIMPLES = 'simples:'

function instanciasSimplesDescobertas (raizDados) {
  const pasta = path.join(raizDados, 'instancias')
  let nomes = []
  try {
    nomes = fs.readdirSync(pasta, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[\w.-]+$/.test(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
  return nomes.map((nome) => ({
    instanceId: `${PREFIXO_SIMPLES}${nome}`,
    label: `Número "${nome}" (modo simples)`,
    isBare: true,
    nomeSimples: nome,
    arqEstado: path.join(pasta, nome, 'state.json'),
    arqPid: path.join(pasta, nome, 'bot.pid'),
    expectedPhoneE164: null,
    resources: { memory: null, cpus: null },
    createdAt: null
  }))
}

// Um processo com este pid está vivo? É como o modo simples sabe se o bot está
// de pé — cada instância grava o próprio bot.pid na própria pasta.
function pidVivoDe (arquivo) {
  try {
    const pid = parseInt(fs.readFileSync(arquivo, 'utf8').trim(), 10)
    if (!pid) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function instanciaBareVirtual () {
  return {
    instanceId: ID_BARE,
    label: 'Instância local (modo simples)',
    isBare: true,
    expectedPhoneE164: null,
    resources: { memory: null, cpus: null },
    createdAt: null
  }
}

// `obterRegistro` é injetável de propósito: sem isso, todo teste desta
// função tocaria o registry.json REAL do usuário (~/.local/share/lcnwhatsapp) —
// perigoso e errado num teste automatizado. Produção usa o default (arquivo
// real); testes passam uma função que devolve um registro fixture em memória.
// `caminhoInstanciaFn`/`nomeContainerFn` injetáveis pelo mesmo motivo de
// `obterRegistro`: em teste, o dataDir do fixture é um diretório temporário
// isolado, não o caminho XDG real (~/.local/share/lcnwhatsapp/instances/...)
// — sem essa injeção, validarAlvoGerenciado() rejeitaria todo fixture de
// teste por "não apontar pro alvo gerenciado esperado". `bare*` seguem o
// mesmo motivo: nunca tocar data/state.json ou config.json REAIS deste
// checkout, nem chamar runtime.js de verdade, durante um teste automatizado.
export function criarInstanceService ({
  exec = executarCapturando,
  obterRegistro = lerRegistro,
  caminhoInstanciaFn = caminhoInstancia,
  nomeContainerFn = nomeContainer,
  bareArqEstado = ARQ_ESTADO_BARE,
  bareArqConfig = ARQ_CONFIG_BARE,
  bareStatusServico = statusServicoBare,
  bareIniciarBot = iniciarBotBare,
  barePararBot = pararBotBare,
  bareReiniciarBot = reiniciarBotBare,
  bareLogsServico = logsServicoBare,
  gerarQrDataUrl = (texto) => QRCode.toDataURL(texto)
} = {}) {
  function caminhoEstado (instancia) {
    // Instância descoberta traz o próprio arquivo; o bare clássico usa o fixo.
    if (instancia.arqEstado) return instancia.arqEstado
    return instancia.isBare ? bareArqEstado : path.join(instancia.dataDir, 'data', 'state.json')
  }

  function caminhoConfig (instancia) {
    return instancia.isBare ? bareArqConfig : path.join(instancia.dataDir, 'config.json')
  }

  function estadoDa (instancia) {
    return lerJson(caminhoEstado(instancia))
  }

  function statusUnit (instancia) {
    // Descoberta: o estado vem do pid dela, não do bot principal.
    if (instancia.arqPid) return pidVivoDe(instancia.arqPid) ? 'rodando' : 'parado'
    if (instancia.isBare) {
      try { return bareStatusServico() } catch { return 'indisponivel' }
    }
    try {
      const resultado = exec('systemctl', ['--user', 'is-active', unidadeDa(instancia)])
      return resultado.stdout.trim() || (resultado.ok ? 'active' : 'inactive')
    } catch {
      return 'indisponivel'
    }
  }

  function exigir (id) {
    if (id === ID_BARE) return instanciaBareVirtual()
    // Lista FECHADA: o id só resolve se aparecer na varredura. Nunca se monta
    // caminho a partir do texto recebido — é o que impede um id inventado
    // ("simples:../../etc") de virar leitura de arquivo.
    if (typeof id === 'string' && id.startsWith(PREFIXO_SIMPLES)) {
      const achada = instanciasSimplesDescobertas(raizDeDados()).find((i) => i.instanceId === id)
      if (achada) return achada
    }
    if (!idValido(id)) throw new InstanciaNaoEncontradaError(id)
    const registro = obterRegistro()
    const instancia = buscarPorId(registro, id)
    if (!instancia) throw new InstanciaNaoEncontradaError(id)
    validarAlvoGerenciado(instancia, { caminhoInstanciaFn, nomeContainerFn })
    return instancia
  }

  function resumir (instancia) {
    const estado = estadoDa(instancia)
    return {
      instanceId: instancia.instanceId,
      label: instancia.label,
      expectedPhoneE164: instancia.expectedPhoneE164 || null,
      unitStatus: statusUnit(instancia),
      connected: estado?.conectado ?? null,
      phoneNumber: estado?.numero ?? null,
      health: estado?.saude?.status ?? 'desconhecida',
      isBare: instancia.isBare === true
    }
  }

  // A raiz de dados sai do próprio caminho do state.json do bare — assim o
  // teste injeta um diretório temporário e nunca varre o data/ real.
  const raizDeDados = () => path.dirname(bareArqEstado)

  function listar () {
    // A instância "bare" sempre aparece — representa o número único do
    // modo simples, que é como o projeto roda antes de alguém migrar pra
    // multi-instância (Parte A). Não depende de nenhum registro existir.
    return [
      resumir(instanciaBareVirtual()),
      ...instanciasSimplesDescobertas(raizDeDados()).map(resumir),
      ...listarInstanciasRegistro(obterRegistro()).map(resumir)
    ]
  }

  function obter (id) {
    const instancia = exigir(id)
    const estado = estadoDa(instancia)
    return {
      ...resumir(instancia),
      resources: instancia.resources ?? { memory: null, cpus: null },
      createdAt: instancia.createdAt ?? null,
      metrics: estado?.metricas ?? null,
      health: estado?.saude ?? null
    }
  }

  // Ciclo de vida do modo "bare": reaproveita src/runtime.js (mesmas
  // funções que dashboard.js/terminal já usam). Iniciar um bot do ZERO
  // nesse modo JÁ funciona: `iniciarBot()` (runtime.js) antes reexecutava o
  // processo atual — o que de fato não era seguro a partir do painel, porque
  // o painel não é o mesmo binário do bot. Hoje ele executa `index.js`
  // explicitamente, destacado, então ligar pelo painel é bem-definido. É o
  // que permite conectar um número sem abrir terminal.
  function executarAcaoCicloDeVidaBare (acao) {
    const resultado = acao === 'start'
      ? bareIniciarBot()
      : (acao === 'stop' ? barePararBot() : bareReiniciarBot())
    if (!resultado.ok) throw new Error(resultado.out)
    return { instanceId: ID_BARE, action: acao, ok: true }
  }

  function executarAcaoCicloDeVida (id, acao) {
    if (id === ID_BARE) return executarAcaoCicloDeVidaBare(acao)
    const instancia = exigir(id)
    const resultado = exec('systemctl', ['--user', acao, unidadeDa(instancia)])
    if (!resultado.ok) {
      const detalhe = (resultado.stderr || resultado.stdout).trim()
      throw new Error(`${acao} falhou para ${id}${detalhe ? `: ${detalhe}` : ` (código ${resultado.status})`}`)
    }
    return { instanceId: id, action: acao, ok: true }
  }

  const iniciar = (id) => executarAcaoCicloDeVida(id, 'start')
  const parar = (id) => executarAcaoCicloDeVida(id, 'stop')
  const reiniciar = (id) => executarAcaoCicloDeVida(id, 'restart')

  // Pareamento: só LEITURA do que connection.js já persiste em state.json
  // (definirQR/definirCodigoPareamento) — disparar um pareamento novo por
  // API ainda não é suportado (hoje --code pede o telefone via stdin
  // interativo; ver nota no plano, isso fica pra quando alguém desenhar
  // como um processo já rodando aceita esse pedido sem terminal). O QR cru
  // (`estado.qr`) é convertido pra uma imagem PNG (data URL) aqui mesmo —
  // antes o painel só mostrava o texto cru pra copiar, não dava pra
  // escanear de verdade com a câmera do celular (pedido explícito do
  // usuário: "conectar o número pela aba web").
  //
  // ATENÇÃO — CREDENCIAL SENSÍVEL (achado de revisão de segurança): o QR e
  // o código de pareamento aqui devolvidos permitem parear a conta do
  // zero. Isso é aceitável hoje só porque `src/web/server.js` recusa
  // escutar fora de 127.0.0.1/localhost. Se este método for reexposto
  // atrás de um transporte hospedado (WSS, ver plano — Etapa 4.5,
  // "Fronteira hospedada"), ele PRECISA ganhar controle de acesso por
  // workspace/instalação antes disso — nunca repassar sem essa checagem.
  async function pareamento (id) {
    const instancia = exigir(id)
    const estado = estadoDa(instancia) || {}
    let qrDataUrl = null
    if (estado.qr) {
      try { qrDataUrl = await gerarQrDataUrl(estado.qr) } catch { qrDataUrl = null }
    }
    return {
      connected: estado.conectado ?? null,
      phoneNumber: estado.numero ?? null,
      qr: estado.qr ?? null,
      qrDataUrl,
      qrAt: estado.qrEm ?? null,
      pairingCode: estado.codigoPareamento ?? null,
      pairingCodeAt: estado.codigoPareamentoEm ?? null
    }
  }

  // "Controles de otimização" (pedido explícito do usuário): banda e
  // limiar de quarentena já existem de verdade (Parte A) mas só eram
  // configuráveis via dashboard de terminal — isto expõe leitura/escrita
  // pro painel web, mantendo o MESMO shape de config.json (hot-reload já
  // aplica sem reiniciar, ver src/connection.js). `resources` (memory/cpus)
  // é só leitura aqui de propósito: mudar isso exige regenerar o unit
  // Quadlet e reiniciar o container, uma operação mais pesada que não
  // existe ainda nem na CLI de terminal — redimensionar instância fica
  // pra quando alguém desenhar esse fluxo (recriar unit + daemon-reload).
  function obterOtimizacao (id) {
    const instancia = exigir(id)
    const config = lerJson(caminhoConfig(instancia)) || {}
    return {
      bandwidthLimit: { ...BANDWIDTH_PADRAO, ...(config.hardware?.bandwidthLimit || {}) },
      quarantineThreshold: config.confiabilidade?.falhasConsecutivasParaQuarentena ?? QUARENTENA_PADRAO,
      resources: instancia.resources ?? { memory: null, cpus: null }
    }
  }

  function validarPatchOtimizacao (patch) {
    if (!patch || typeof patch !== 'object') throw new Error('Corpo inválido.')
    const saida = {}
    if (patch.bandwidthLimit !== undefined) {
      const { downloadBytesPerSecond, uploadBytesPerSecond } = patch.bandwidthLimit || {}
      for (const [nome, valor] of [['downloadBytesPerSecond', downloadBytesPerSecond], ['uploadBytesPerSecond', uploadBytesPerSecond]]) {
        if (valor !== undefined && (!Number.isFinite(valor) || valor < 0)) {
          throw new Error(`bandwidthLimit.${nome} deve ser um número >= 0 (0 = sem limite).`)
        }
      }
      saida.bandwidthLimit = {
        downloadBytesPerSecond: downloadBytesPerSecond ?? undefined,
        uploadBytesPerSecond: uploadBytesPerSecond ?? undefined
      }
    }
    if (patch.quarantineThreshold !== undefined) {
      if (!Number.isInteger(patch.quarantineThreshold) || patch.quarantineThreshold < 1) {
        throw new Error('quarantineThreshold deve ser um inteiro >= 1.')
      }
      saida.quarantineThreshold = patch.quarantineThreshold
    }
    return saida
  }

  function definirOtimizacao (id, patch) {
    const instancia = exigir(id)
    const mudancas = validarPatchOtimizacao(patch)
    const arquivo = caminhoConfig(instancia)
    const config = lerJson(arquivo) || {}
    config.hardware = { ...config.hardware }
    if (mudancas.bandwidthLimit) {
      config.hardware.bandwidthLimit = {
        ...BANDWIDTH_PADRAO,
        ...config.hardware.bandwidthLimit,
        ...Object.fromEntries(Object.entries(mudancas.bandwidthLimit).filter(([, v]) => v !== undefined))
      }
    }
    if (mudancas.quarantineThreshold !== undefined) {
      config.confiabilidade = { ...config.confiabilidade, falhasConsecutivasParaQuarentena: mudancas.quarantineThreshold }
    }
    escreverJsonAtomico(arquivo, config)
    return obterOtimizacao(id)
  }

  // Painel de recursos (Parte C, Módulo 6 do plano) — leitura do uso REAL,
  // sem moldura de "cota alugada" (aluguel/cobrança é um módulo à parte,
  // ainda não implementado). Modo bare: o painel roda num PROCESSO
  // SEPARADO do bot, então não dá pra ler `process.memoryUsage()` do bot
  // direto — só o que o próprio bot já autorreporta em `state.json`
  // (`memoriaMB`, gravado em `state.js:gravar()`; `bytesBaixados`/
  // `bytesEnviados`, contadores acumulados desde o boot, gravados em
  // `visu.js` nos mesmos pontos que já chamam
  // `bandwidth.aguardarDownload/aguardarUpload`).
  //
  // Instância da Parte A (Podman): DELIBERADAMENTE não implementado ainda
  // — `podman stats --format json` tem um formato de saída que eu não
  // consigo validar neste ambiente (nunca houve Podman real disponível
  // nesta sessão, mesma ressalva que já vale pra Parte A inteira) e
  // prefiro um erro claro a um parser de JSON adivinhado que silenciosamente
  // devolve `null` sempre. Fica pra quando alguém puder testar contra um
  // Podman de verdade.
  function obterUso (id) {
    const instancia = exigir(id)
    if (!instancia.isBare) {
      throw new Error('Uso de recursos de instâncias Parte A (Podman) ainda não implementado — precisa de validação contra um Podman real, que este ambiente não tem.')
    }
    const estado = estadoDa(instancia) || {}
    const config = lerJson(caminhoConfig(instancia)) || {}
    const limite = { ...BANDWIDTH_PADRAO, ...(config.hardware?.bandwidthLimit || {}) }
    return {
      memoryMB: estado.memoriaMB ?? null,
      uptimeMs: estado.iniciadoEm ? Date.now() - estado.iniciadoEm : null,
      bandwidth: {
        downloadBytesTotal: estado.metricas?.bytesBaixados ?? 0,
        uploadBytesTotal: estado.metricas?.bytesEnviados ?? 0,
        downloadLimitBytesPerSecond: limite.downloadBytesPerSecond,
        uploadLimitBytesPerSecond: limite.uploadBytesPerSecond
      }
    }
  }

  // Logs do sistema (Parte C, Módulo 6). Bare reaproveita `logsServico()`
  // (`runtime.js`, já lê `data/bot.log` com tail) — Parte A usa
  // `podman logs --tail N`, comando simples/documentado o bastante pra
  // implementar com confiança mesmo sem Podman real disponível aqui
  // (diferente do formato JSON de `stats`, a saída de `logs` é texto cru
  // já esperado pelo resto do código, sem parsing arriscado).
  function obterLogs (id, linhas) {
    const instancia = exigir(id)
    const n = Number.isInteger(linhas) && linhas > 0 ? Math.min(linhas, 1000) : 100
    if (instancia.isBare) {
      const resultado = bareLogsServico(n)
      if (!resultado.ok) throw new Error(resultado.out)
      return { lines: resultado.out.split('\n') }
    }
    const resultado = exec('podman', ['logs', '--tail', String(n), instancia.containerName])
    const saida = resultado.stdout || resultado.stderr || ''
    if (!resultado.ok && !saida.trim()) {
      throw new Error(`Não foi possível ler logs de ${id}${resultado.stderr ? `: ${resultado.stderr.trim()}` : ''}.`)
    }
    return { lines: saida.trimEnd().split('\n') }
  }

  return { listar, obter, iniciar, parar, reiniciar, pareamento, obterOtimizacao, definirOtimizacao, obterUso, obterLogs }
}
