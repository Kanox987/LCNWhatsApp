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
import { ARQ_ESTADO as ARQ_ESTADO_BARE, ARQ_CONFIG as ARQ_CONFIG_BARE, RAIZ } from '../paths.js'
import * as processoDaInstancia from './processoDaInstancia.js'
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
// Dois comandos ao mesmo tempo. O recurso disputado é a conexão com o
// WhatsApp; ver engine/fila.js para por que não é um.
const COMANDOS_SIMULTANEOS_PADRAO = 2
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
export const PREFIXO_SIMPLES = 'simples:'

export function instanciasSimplesDescobertas (raizDados) {
  const pasta = path.join(raizDados, 'instancias')
  let nomes = []
  try {
    nomes = fs.readdirSync(pasta, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[\w.-]+$/.test(e.name))
      .map((e) => e.name)
  } catch {
    return []
  }
  return nomes
    // PASTA SOZINHA NÃO É INSTÂNCIA. Qualquer subdiretório virava um número na
    // tela, e o `data/instancias/suite/` que a ferramenta de teste cria
    // aparecia como se fosse um número real — em três telas. Exigir o
    // `state.json` é exigir o sinal de que algum bot de fato rodou ali.
    .filter((nome) => {
      try { return fs.statSync(path.join(pasta, nome, 'state.json')).isFile() } catch { return false }
    })
    .map((nome) => ({
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

  // O estado foi escrito agora há pouco?
  //
  // É o batimento do `state.js`: o processo reescreve o arquivo a cada 30s
  // mesmo sem nada acontecer. Isso atravessa o que o pid não atravessa —
  // quando o número roda em OUTRO container, o pid dele não existe aqui (e
  // pior: pode casar por acaso com um processo daqui), enquanto o arquivo
  // está num volume compartilhado.
  //
  // A folga é generosa de propósito: um batimento perdido por carga não pode
  // fazer a tela declarar o número morto.
  const FOLGA_DO_BATIMENTO_MS = 150000
  function estadoRecente (estado) {
    const em = estado?.atualizadoEm
    return Number.isFinite(em) && (Date.now() - em) < FOLGA_DO_BATIMENTO_MS
  }

  function statusUnit (instancia) {
    // Descoberta: o estado é o DELA, não o do bot principal. O batimento vem
    // primeiro porque vale de qualquer lugar; o pid é a segunda opinião, para
    // o processo que está vivo e simplesmente não teve o que escrever.
    if (instancia.arqPid) {
      if (estadoRecente(estadoDa(instancia))) return 'rodando'
      return pidVivoDe(instancia.arqPid) ? 'rodando' : 'parado'
    }
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

  // O serviço está DE PÉ? `statusUnit` devolve a palavra de três origens
  // diferentes (pid próprio, serviço do bare, systemctl), então a leitura fica
  // num lugar só — espalhar a comparação por string seria convidar um valor
  // novo a passar despercebido.
  function vivoPeloStatus (status) {
    if (status === 'rodando' || status === 'active' || status === 'activating') return true
    if (status === 'parado' || status === 'inactive' || status === 'failed') return false
    return null // 'indisponivel' e o que mais vier: não dá para afirmar nada
  }

  function resumir (instancia) {
    const estado = estadoDa(instancia)
    const unitStatus = statusUnit(instancia)
    const vivo = vivoPeloStatus(unitStatus)

    // "CONECTADO" PRECISA CRUZAR COM O PROCESSO ESTAR VIVO.
    //
    // `state.json` guarda `conectado: true` e NADA o invalida quando o
    // processo morre: não há checagem de pid, lock, heartbeat nem frescor. Só
    // um desligamento gracioso zera o campo — `kill -9`, queda, OOM ou
    // container removido deixam `true` para sempre. O painel então dizia
    // "Conectado" para um número que não estava rodando, e foi assim que ele
    // marcou como conectado justamente o que nem pareia.
    //
    // A ironia é que o próprio `resumir` já sabia: `unitStatus` vem de
    // `statusUnit` e estava ali do lado, sem ninguém cruzar os dois.
    //
    // Serviço parado é ausência de sessão, não dúvida: aí `false` é a verdade,
    // não um palpite. Dúvida é quando nem o status se sabe — e aí vai `null`,
    // que a tela mostra como "sem informação".
    const conectado = vivo === true
      ? (estado?.conectado ?? null)
      : (vivo === false ? false : null)

    return {
      instanceId: instancia.instanceId,
      label: instancia.label,
      expectedPhoneE164: instancia.expectedPhoneE164 || null,
      unitStatus,
      connected: conectado,
      // O número continua saindo: ele é desta instância. O que muda é o que
      // ele significa quando o serviço está parado — último número visto, e é
      // a tela que diz isso, com `estadoEm` para datar.
      phoneNumber: estado?.numero ?? null,
      estadoEm: estado?.atualizadoEm ?? null,
      // Saúde de um serviço parado é o mesmo caso: o registro ficou do jeito
      // que estava quando ele caiu.
      health: vivo === false ? 'desconhecida' : (estado?.saude?.status ?? 'desconhecida'),
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

  function executarAcaoCicloDeVida (id, acao, opcoes = {}) {
    if (id === ID_BARE) return executarAcaoCicloDeVidaBare(acao)
    const instancia = exigir(id)

    // NÚMERO DESCOBERTO NÃO TEM UNIDADE DE SERVIÇO, e mandar a ação para o
    // systemd era pedir `systemctl --user undefined.service` — erro sobre uma
    // unidade que nunca existiu. Ele é uma pasta mais um processo com
    // `LCN_INSTANCIA=<nome>`, então o ciclo de vida dele é o mesmo da linha de
    // comando: `node index.js` destacado, parado pelo pid-file da própria
    // pasta.
    if (instancia.nomeSimples) {
      const resultado = acao === 'start'
        // `pairNumber` liga o modo de pareamento por CÓDIGO: o processo sobe
        // com `--code` e pede o código para aquele telefone. Era a última
        // coisa que só o terminal fazia.
        ? processoDaInstancia.iniciar(instancia.nomeSimples, instancia.arqPid, { pairNumber: opcoes.pairNumber || null })
        : (acao === 'stop'
            ? processoDaInstancia.parar(instancia.nomeSimples, instancia.arqPid)
            : processoDaInstancia.reiniciar(instancia.nomeSimples, instancia.arqPid))
      if (!resultado.ok) throw new Error(resultado.out)
      return { instanceId: id, action: acao, ok: true, detail: resultado.out }
    }

    const resultado = exec('systemctl', ['--user', acao, unidadeDa(instancia)])
    if (!resultado.ok) {
      const detalhe = (resultado.stderr || resultado.stdout).trim()
      throw new Error(`${acao} falhou para ${id}${detalhe ? `: ${detalhe}` : ` (código ${resultado.status})`}`)
    }
    return { instanceId: id, action: acao, ok: true }
  }

  // CRIAR UM NÚMERO NOVO, sem terminal.
  //
  // Era a última coisa que só dava para fazer pela linha de comando
  // (`LCN_INSTANCIA=pessoal node index.js`), e quem aluga o sistema não tem
  // terminal. Um número do modo simples é uma pasta mais um processo; criar é
  // preparar a pasta, e o `state.json` inicial é o que diz "alguém quis este
  // número aqui" — sem ele a varredura (com razão) ignoraria o diretório.
  //
  // O NOME É SANEADO ANTES DE VIRAR CAMINHO, e isto é o ponto delicado: é o
  // único lugar onde texto de fora decide um diretório. A lista de caracteres
  // é a MESMA da varredura, porque um nome que passa aqui e é ignorado lá
  // criaria uma pasta que nunca aparece.
  const NOME_DE_INSTANCIA = /^[\w.-]{1,40}$/
  function criar (nomeBruto) {
    const nome = String(nomeBruto ?? '').trim()
    if (!NOME_DE_INSTANCIA.test(nome)) {
      throw new Error('O nome aceita letras, números, ponto, hífen e _ (até 40). Nada de barra, espaço ou acento — ele vira o nome de uma pasta.')
    }
    // ".." passa no teste acima (são dois pontos), e viraria um caminho acima
    // da raiz de dados. Recusar explicitamente é mais honesto que depender de
    // o regex cobrir isso por acidente.
    if (nome === '.' || nome === '..') throw new Error('Esse nome não pode ser usado.')
    if (nome === 'bare') throw new Error('"bare" é o nome do número principal.')

    const pasta = path.join(raizDeDados(), 'instancias', nome)
    const arqEstado = path.join(pasta, 'state.json')
    if (fs.existsSync(arqEstado)) throw new Error(`Já existe um número chamado "${nome}".`)

    fs.mkdirSync(pasta, { recursive: true })
    // Estado inicial honesto: não conectado, sem número. É o que a tela vai
    // mostrar até alguém parear.
    // SEM `atualizadoEm`: esse campo é o BATIMENTO, e só um processo rodando
    // tem o direito de escrevê-lo. Gravá-lo aqui faria o número recém-criado
    // nascer parecendo vivo — o mesmo "conectado que nunca expira" que a
    // correção do batimento acabou de matar, reintroduzido pela porta da
    // criação.
    fs.writeFileSync(arqEstado, JSON.stringify({
      conectado: false,
      numero: null,
      criadoEm: Date.now()
    }, null, 2) + '\n', { mode: 0o600 })

    const id = `${PREFIXO_SIMPLES}${nome}`
    const instancia = instanciasSimplesDescobertas(raizDeDados()).find((i) => i.instanceId === id)
    if (!instancia) throw new Error(`Criei a pasta de "${nome}" mas ela não apareceu na varredura.`)
    return resumir(instancia)
  }

  // REMOVER. Apaga a pasta de dados E a sessão: sem a sessão, o número não
  // volta sozinho — quem reaproveitar o nome vai parear de novo. É destrutivo
  // e irreversível, então tem duas travas.
  function remover (id) {
    if (id === ID_BARE) throw new Error('O número principal não pode ser removido por aqui.')
    const instancia = exigir(id)
    if (!instancia.nomeSimples) {
      throw new Error('Só número do modo simples é removido por aqui; instância gerenciada sai pelo registro.')
    }
    // PARAR ANTES. Apagar a pasta de um processo vivo deixaria um bot rodando
    // sem estado, escrevendo num diretório que já não existe.
    const status = statusUnit(instancia)
    if (vivoPeloStatus(status) !== false) {
      throw new Error(`O número "${instancia.nomeSimples}" ainda está rodando (${status}). Pare antes de remover.`)
    }

    // Caminho montado a partir da instância ENCONTRADA na varredura, nunca do
    // texto recebido — é o que impede um id inventado de apagar outra coisa.
    const pastaDados = path.dirname(instancia.arqEstado)
    const pastaSessao = path.join(RAIZ, 'sessao', 'instancias', instancia.nomeSimples)
    fs.rmSync(pastaDados, { recursive: true, force: true })
    fs.rmSync(pastaSessao, { recursive: true, force: true })
    return { instanceId: id, removed: true, nome: instancia.nomeSimples }
  }

  const iniciar = (id, opcoes) => executarAcaoCicloDeVida(id, 'start', opcoes || {})
  const parar = (id) => executarAcaoCicloDeVida(id, 'stop')
  const reiniciar = (id) => executarAcaoCicloDeVida(id, 'restart')

  // Pareamento: LEITURA do que connection.js já persiste em state.json
  // (definirQR/definirCodigoPareamento). Pedir um código NOVO também é
  // possível desde que o pedido venha com o telefone — ele sobe o processo em
  // modo `--code`, que é o que o terminal fazia. Com o processo JÁ rodando, a
  // ordem continua sendo parar e ligar de novo pedindo o código: o pareamento
  // acontece na abertura da sessão, não no meio dela. O QR cru
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
      // QUANTOS COMANDOS AO MESMO TEMPO. O recurso disputado é a conexão com o
      // WhatsApp, que é uma só: sem limite, uma rajada de buscas sobe dezenas
      // de capas de uma vez e o socket estoura o tempo. Ver engine/fila.js.
      comandosSimultaneos: config.hardware?.comandosSimultaneos ?? COMANDOS_SIMULTANEOS_PADRAO,
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
    if (patch.comandosSimultaneos !== undefined) {
      // Zero trancaria a fila inteira; sem teto porque máquina folgada é caso
      // real — padrão sensato sim, teto no código não.
      if (!Number.isInteger(patch.comandosSimultaneos) || patch.comandosSimultaneos < 1) {
        throw new Error('comandosSimultaneos deve ser um inteiro >= 1.')
      }
      saida.comandosSimultaneos = patch.comandosSimultaneos
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
    if (mudancas.comandosSimultaneos !== undefined) {
      config.hardware.comandosSimultaneos = mudancas.comandosSimultaneos
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

  return { listar, obter, criar, remover, iniciar, parar, reiniciar, pareamento, obterOtimizacao, definirOtimizacao, obterUso, obterLogs }
}
