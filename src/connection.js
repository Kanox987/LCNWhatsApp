// Conexão com o WhatsApp: cria o WaClient (Zapo) com config enxuta, cuida de
// reconexão/backoff, login (QR ou código) e escreve o estado pro dashboard.
// Recarrega o config a quente; só reconecta quando muda algo preso à criação
// do client (logLevel, markOnline).
//
// Migrado de @whiskeysockets/baileys pra zapo-js — ver
// /home/kanox/.claude/plans/agora-o-que-eu-recursive-knuth.md pro plano
// completo. Pontos abaixo marcados "VALIDAR" dependem de comportamento real
// (não documentado com detalhe suficiente) e precisam ser confirmados no
// primeiro teste de conexão real, não presumidos.
import { WaClient, createStore, ConsoleLogger, fetchLatestWaWebVersion } from 'zapo-js'
import { createSqliteStore } from '@zapo-js/store-sqlite'
import qrcode from 'qrcode-terminal'
import fs from 'fs'
import readline from 'readline'
import path from 'path'
import { PASTA_SESSAO, PASTA_DADOS, ARQ_GRUPOS_REFRESH, garantirPastas } from './paths.js'
import { carregar, observar } from './config.js'
import { atualizarGrupos, registrarContato } from './directory.js'
import * as state from './state.js'
import * as bandwidth from './bandwidth.js'
import { classificarFechamento, mensagemParaClasse, codigoParaClasse } from './connectionReasons.js'
import { EXIT_QUARANTINED } from './exitCodes.js'
import { resolverAccountId } from './engine/instanceIdentity.js'
import { construirEventoDeMensagem, construirEventoDeIndisponivel, construirEventoDeGrupo, chatIdDoEvento } from './engine/zapoAdapter.js'
import { criarFila } from './engine/fila.js'
import { maxPendentesEfetivo } from './agent/concessoes.js'
import { comEvento, cancelarTrabalhoExterno, erroDeCancelamento } from './engine/cancelamento.js'
import { tipoPodeCasar } from './engine/canonicalEvent.js'
import { fecharOrfaos } from './engine/orfaos.js'
import { emitirDesconhecidoDebug, emitirEventoDebug } from './engine/eventSink.js'
import { criarClienteEngine } from './engine/client.js'
import { enviarEventoAoMotor } from './engine/gatewaySink.js'
import * as groupInfo from './engine/groupInfo.js'
import { executarComandos, COMANDOS_LONGOS } from './engine/gatewayExecutor.js'
import { APARELHOS, resolverAparelho } from './aparelho.js'
import * as lidMap from './lidMap.js'

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}]`, ...a)
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
let encerrarConexao = null

// O ponto de entrada fecha o espelho de logs depois da drenagem. Ter dois
// handlers de sinal chamando exit em paralelo encerrava o processo cedo demais.
export function desligar () {
  return encerrarConexao?.({ sair: false }) || Promise.resolve()
}
// Pareamento por código aceita o número por argumento ou ambiente, além do
// terminal. Sem isso ele só existia de forma interativa (`pergunta()` no
// stdin), e um bot iniciado pelo painel — que roda destacado, sem terminal —
// ficava pendurado esperando alguém digitar num prompt que ninguém vê.
//
//   node index.js --code=5522999999999
//   LCN_PAIR_NUMBER=5522999999999 node index.js --code
// O que decide entre código de pareamento e QR.
//
// `LCN_PAIR_NUMBER` já era lido por `numeroDoArgumento()`, mas sozinho NUNCA
// ligava o modo: a variável parecia suportada, entregava o número a ninguém, e
// a conexão caía no QR sem dizer por quê. Meio caminho é pior que não ter.
export function querPareamentoPorCodigo (argv = process.argv, env = process.env) {
  if (argv.some((a) => a === '--code' || a.startsWith('--code='))) return true
  return String(env.LCN_PAIR_NUMBER || '').replace(/\D/g, '').length >= 8
}

const USAR_CODIGO = querPareamentoPorCodigo()

// Aparelho por argumento/ambiente, com a mesma lógica do --code: quem conecta
// escolhe na hora, sem editar arquivo. O config.json é o padrão de quem não
// escolhe nada.
function aparelhoDoArgumento () {
  const pegar = (nome, env) => {
    const arg = process.argv.find((a) => a.startsWith(`--${nome}=`))
    const bruto = arg ? arg.slice(nome.length + 3) : (process.env[env] || '')
    return String(bruto).trim()
  }
  return { navegador: pegar('aparelho', 'LCN_APARELHO'), sistema: pegar('sistema', 'LCN_APARELHO_SISTEMA') }
}

function numeroDoArgumento () {
  const arg = process.argv.find((a) => a.startsWith('--code='))
  const bruto = arg ? arg.slice('--code='.length) : (process.env.LCN_PAIR_NUMBER || '')
  const digitos = String(bruto).replace(/\D/g, '')
  return digitos.length >= 8 ? digitos : null
}

// Só cai no prompt quando existe terminal de verdade. Num processo destacado
// isso travaria para sempre — e travar em silêncio é pior que recusar.
async function numeroParaParear () {
  const doArgumento = numeroDoArgumento()
  if (doArgumento) return doArgumento
  if (!process.stdin.isTTY) return null
  return (await pergunta('Digite seu número com DDI (ex: 5511999999999): ')).replace(/\D/g, '')
}
const SESSION_ID = 'default'

export const ADMISSAO_CONCORRENCIA_PADRAO = 8
export const ADMISSAO_LOG_JANELA_MS_PADRAO = 5000

export function criarAdmissaoDeEventos (cfg = {}, { registrar = log, aoMudar } = {}) {
  const hardware = cfg.hardware || {}
  const positivo = (valor, padrao) => Number.isSafeInteger(valor) && valor > 0 ? valor : padrao
  const janelaMs = positivo(hardware.admissaoLogJanelaMs, ADMISSAO_LOG_JANELA_MS_PADRAO)
  let contadas = 0
  let expiradasContadas = 0
  let recusadas = 0
  let expiradas = 0
  let timer = null
  let publicacao = null
  let encerramento = null
  const eventos = new Set()
  // Trabalho que já devolveu a vaga mas ainda não terminou. O desligamento
  // continua drenando isto: vaga solta não pode virar trabalho solto.
  const caudas = new Set()
  let cancelandoExternos = false
  const escrever = (texto) => { try { registrar(texto) } catch {} }
  const fila = criarFila({
    recurso: 'admissao',
    limite: positivo(hardware.admissaoConcorrencia, ADMISSAO_CONCORRENCIA_PADRAO),
    maxPendentes: maxPendentesEfetivo(cfg),
    agingMs: hardware.agingMs,
    esperaMaximaMs: hardware.esperaMaximaMs,
    aoMudar: (estado) => {
      recusadas += estado.recusas - contadas
      expiradas += estado.expiradas - expiradasContadas
      contadas = estado.recusas
      expiradasContadas = estado.expiradas
      if ((recusadas || expiradas) && !timer) {
        const inicio = new Date().toISOString()
        // Um único timer por janela garante também o resumo da última rajada,
        // mesmo que depois dela não chegue mais nenhuma mensagem.
        publicacao = new Promise((resolver) => {
          timer = setTimeout(() => {
            escrever(`[engine] fila admissao: recusados=${recusadas}, expirados=${expiradas}, totalRecusados=${contadas}, janela=${inicio}..${new Date().toISOString()}`)
            recusadas = 0
            expiradas = 0
            timer = null
            resolver()
          }, janelaMs)
          timer.unref?.()
        })
      }
      aoMudar?.(estado)
    }
  })
  return {
    // `tarefa` recebe `soltar`: chamá-lo devolve a vaga (a ordem por conversa)
    // sem encerrar o evento. Serve a quem vai passar minutos esperando um
    // serviço externo — um `/play` — e não deve segurar o `/ping` que vem depois
    // na mesma conversa. O evento continua vivo até o fim: conta em
    // `eventosAtivos`, é alcançado por `cancelarExternos` e `encerrar` o espera.
    admitir (chave, tarefa) {
      // Ainda não existe automação avaliada: toda entrada tem urgência normal
      // e recusa local. Sem promessa para recusada, sem aviso no WhatsApp.
      let controle
      let fimDoTrabalho
      const trabalho = fila.tentarExecutar(() => new Promise((resolver, rejeitar) => {
        // O primeiro entre `soltar()` e o fim da tarefa libera a vaga.
        fimDoTrabalho = new Promise((resolverTarefa) => {
          resolverTarefa(comEvento(controle, () => tarefa(() => resolver())))
        })
        fimDoTrabalho.then(resolver, rejeitar)
      }), { chave, prioridade: 'normal' })
      if (!trabalho) {
        // Uma recusa só alcança trabalho já disparado pelo MESMO evento.
        // As 2.865.000 recusas do soak não devem criar sinais nem promessas.
        cancelarTrabalhoExterno(cancelandoExternos ? 'desligamento' : 'recusa_admissao', 'admissao')
        return null
      }
      controle = new AbortController()
      if (cancelandoExternos) controle.abort(erroDeCancelamento('desligamento'))
      eventos.add(controle)
      // A mesma falha pode chegar pela vaga e pela cauda: registra uma vez.
      let falhaRegistrada = false
      const registrarFalha = (erro) => {
        if (falhaRegistrada) return
        falhaRegistrada = true
        if (erro?.code === 'LCN_SEM_VAGA' || erro?.code === 'LCN_TIMEOUT') {
          controle.abort(erroDeCancelamento('recusa_admissao', erro.recurso || 'admissao'))
        }
        if (erro?.code !== 'LCN_SEM_VAGA' && erro?.code !== 'LCN_TIMEOUT') {
          escrever(`[engine] evento admitido falhou: ${erro?.message || erro}`)
        }
      }
      const cauda = trabalho
        .then(() => fimDoTrabalho)
        .catch(registrarFalha)
        .finally(() => { eventos.delete(controle); caudas.delete(cauda) })
      caudas.add(cauda)
      return cauda
    },
    encerrar ({ cancelarExternos = false } = {}) {
      // Encerrar a fila continua sendo drenar. O desligamento pede também o
      // aborto das leituras; os envios admitidos conservam suas vagas até o fim.
      cancelandoExternos ||= cancelarExternos
      if (!encerramento) {
        encerramento = fila.encerrar().then(async () => {
          // As caudas já devolveram a vaga, mas o desligamento ainda as espera.
          while (caudas.size) await Promise.allSettled([...caudas])
          // O último resumo também precisa sair no desligamento. Esperar o
          // timer preserva a janela mínima em vez de despejar duas linhas juntas.
          if (timer) { timer.ref?.(); await publicacao }
        })
      }
      // O aborto dispara listeners síncronos. Fechar antes impede que uma
      // reação ao sinal consiga admitir outro evento durante o desligamento.
      if (cancelarExternos) {
        for (const controle of eventos) controle.abort(erroDeCancelamento('desligamento'))
      }
      return encerramento
    },
    get estado () { return { ...fila.estado, logJanelaMs: janelaMs, eventosAtivos: eventos.size } }
  }
}

export function registrarEntradaDeEventos (client, clienteEngine, {
  admissao, obterContexto, registrar = log, encaminhar = encaminharEventoAoMotor,
  invalidarGrupo = groupInfo.invalidar
}) {
  function receber (tipo, event) {
    const recebidoEmMs = Date.now()
    // Permissões não podem esperar a fila: até um evento recusado invalida o
    // cache antes que a próxima mensagem possa consultar sender.isAdmin.
    if (tipo === 'group') {
      try { invalidarGrupo(chatIdDoEvento(event)) } catch {}
    }
    const { cfg, accountId } = obterContexto()
    // Interruptor de emergência: `false` devolve o comportamento de segurar a
    // vaga do início ao fim do evento.
    const liberaVaga = cfg?.hardware?.liberarVagaEmTrabalhoLongo !== false
    return admissao.admitir(chatIdDoEvento(event), (soltar) => {
      const opcoes = { accountId, recebidoEmMs, botId: jidProprio(client) }
      let eventoCanonico
      if (tipo === 'group') {
        eventoCanonico = construirEventoDeGrupo(event, opcoes)
      } else if (tipo === 'message_unavailable') {
        eventoCanonico = construirEventoDeIndisponivel(event, opcoes)
      } else {
        registrarContatoConhecido(event)
        // ENQUETE CRIADA POR QUALQUER PESSOA, não só pelo bot.
        //
        // A criação passa por aqui com os nomes das opções EM CLARO — só o
        // voto é que vem como hash. Anotar o mapa agora é o que permite
        // contar enquete que um membro abriu, e não apenas as do próprio bot.
        //
        // Foi a terceira saída, que nenhuma das duas primeiras revisões viu:
        // uma propunha um banco novo no gateway, a outra limitava a contagem
        // às enquetes do bot. Esta não precisa de nenhum dos dois.
        anotarEnqueteCriada(event, clienteEngine)
        eventoCanonico = construirEventoDeMensagem(event, opcoes)
        if (eventoCanonico?.message?.kind === 'unknown') emitirDesconhecidoDebug(event, cfg, registrar)
      }
      emitirEventoDebug(eventoCanonico, cfg, registrar)
      return encaminhar(client, clienteEngine, eventoCanonico, cfg, registrar, liberaVaga ? soltar : undefined)
    })
  }
  // Os listeners são síncronos: o recebimento nunca aguarda o motor. Até a
  // construção canônica só acontece depois de ocupar uma vaga de admissão.
  client.on('message', (event) => { receber('message', event) })
  client.on('group', (event) => { receber('group', event) })
  client.on('message_unavailable', (event) => { receber('message_unavailable', event) })

  // OS VOTOS DE ENQUETE, que até 27/10 chegavam e eram jogados fora.
  //
  // Medido numa captura de 40 minutos da produção: 17 pacotes de voto, todos
  // registrados como "mensagem desconhecida". É a mesma história dos eventos
  // de grupo antes do porteiro — o dado chegava, ninguém encaminhava.
  //
  // Este ouvinte NÃO vai ao motor e não ocupa vaga de admissão: ele só anota
  // na urna, em memória. Um voto não aciona automação nenhuma; quem pergunta
  // o resultado é um comando, e aí sim o caminho normal roda.
  client.on('message_addon', (event) => {
    try {
      if (event?.kind !== 'poll_vote') return
      const quem = event?.key?.participant || event?.key?.remoteJid
      const alvo = event?.targetMessageId
      const escolhidas = event?.decrypted?.pollVote?.selectedOptions
      if (!quem || !alvo) return
      const hashes = (escolhidas || [])
        .map((b) => (Buffer.isBuffer(b) || b instanceof Uint8Array ? Buffer.from(b).toString('hex') : String(b || '')))
        .filter(Boolean)
      // A mesma pessoa chega ora como @lid, ora como telefone. Sem normalizar,
      // quem vota como LID e TROCA o voto chegando como telefone vira dois
      // eleitores: o antigo nunca é substituído e o total passa do tamanho do
      // grupo. O mapa que resolve já existia, usado pelo porteiro.
      let eleitor = quem
      try { eleitor = lidMap.paraTelefone(quem) || quem } catch {}
      clienteEngine.enquetes.votar(alvo, eleitor, hashes).catch(() => {
        // Voto perdido é um voto a menos no resultado, nunca uma queda.
      })
    } catch {
      // Um voto perdido não pode derrubar o emissor de eventos: o resultado
      // sai com um voto a menos, e isso é muito melhor que o bot cair.
    }
  })
}

// Dispara o caminho novo sem bloquear nem substituir a captura existente.
// Embora sink/executor sejam defensivos por conta própria, o catch final
// protege o event emitter contra qualquer regressão futura nesses módulos.
// `cfg` vem por PARÂMETRO, não por closure: a configuração é recarregada a
// quente dentro de `iniciar()`, e esta função mora fora dela. Ler `cfg` aqui
// como variável livre não é "pegar a versão atual" — é ReferenceError, e foi
// exatamente o que quebrou TODAS as automações que produzem comando: o motor
// casava, gravava o comando, e o gateway estourava antes de executar.
// Anota na urna uma enquete que acabou de nascer na conversa.
//
// Os nomes das opções só existem em claro AQUI, na criação. O voto que chegar
// depois traz o SHA-256 de um deles, e sem este mapa não haveria como dizer em
// que opção alguém votou — apenas um hash, que não serve para ninguém.
function anotarEnqueteCriada (event, clienteEngine) {
  try {
    const bruto = event?.message
    const criacao = bruto?.pollCreationMessage || bruto?.pollCreationMessageV2 ||
      bruto?.pollCreationMessageV3 || bruto?.pollCreationMessageV5
    if (!criacao) return
    const opcoes = (criacao.options || [])
      .map((o) => (typeof o === 'string' ? o : o?.optionName))
      .filter((n) => typeof n === 'string' && n)
    if (opcoes.length < 2) return
    const pollId = event?.key?.id
    const chatId = event?.key?.remoteJid
    if (!pollId) return
    clienteEngine.enquetes.anotar(pollId, chatId, opcoes).catch(() => {
      // Enquete não anotada significa resultado indisponível para ela, e só.
    })
  } catch {
    // Enquete não anotada significa resultado indisponível para ela, e só.
    // Nunca pode atrapalhar a entrega da mensagem em si.
  }
}

// Quem já foi despachado por ESTE processo.
//
// O motor é idempotente por (evento, revisão): quando o WhatsApp entrega o
// mesmo evento duas vezes, ele devolve o que decidiu na primeira — inclusive
// os comandos que ainda estão `pending`, porque a primeira entrega pode estar
// no meio de um download ou de uma edição de arquivo. Sem esta lembrança o
// gateway executava o mesmo comando duas vezes (duas linhas acrescentadas, dois
// itens no JSON). Quem reinicia perde a lembrança, mas aí os pendentes viram
// `outcome_unknown` em `fecharOrfaos`, então nada é reenviado.
// Quando este processo subiu: o que o motor lista como pendente e é mais velho
// que isto é órfão de uma queda anterior (ver `fecharOrfaos`).
const INICIO_DO_PROCESSO = Date.now()
const LIMITE_DE_DESPACHADOS = 5000
// Um id só é esquecido depois de uma hora (a mesma régua de `fecharOrfaos`): até
// lá o comando ainda pode estar em andamento, e expulsá-lo só porque a lista
// encheu deixaria o evento repetido executá-lo de novo. O teto duro existe para
// a memória não crescer sem fim numa enxurrada.
const VALIDADE_DO_DESPACHO_MS = 60 * 60 * 1000
export function criarRegistroDeDespachados (limite = LIMITE_DE_DESPACHADOS, { agora = Date.now, validadeMs = VALIDADE_DO_DESPACHO_MS } = {}) {
  const vistos = new Map() // id -> quando foi despachado (ordem de inserção = ordem do tempo)
  return {
    // true na primeira vez que vê o id, false nas seguintes.
    reivindicar (id) {
      if (!id) return true
      if (vistos.has(id)) return false
      const t = agora()
      vistos.set(id, t)
      while (vistos.size > limite) {
        const [maisAntigo, quando] = vistos.entries().next().value
        if (t - quando < validadeMs && vistos.size <= limite * 10) break
        vistos.delete(maisAntigo)
      }
      return true
    }
  }
}
const despachados = criarRegistroDeDespachados()

export function encaminharEventoAoMotor (client, clienteEngine, eventoCanonico, cfg, log, soltar) {
  // Esboço não vai ao motor.
  //
  // A mesma mensagem chega duas vezes: primeiro sem conteúdo decifrado
  // (`unknown`), depois inteira. As duas geram o MESMO eventId, então o
  // at-most-once devolve o resultado da primeira — e a primeira não casa com
  // nada, porque o tipo dela nem está na política de entrada. Resultado: a
  // mensagem real é descartada calada.
  //
  // Num evento de grupo, filtramos ações não suportadas pelo porteiro logo aqui,
  // antes de onerar a rede ou o motor com stanzas irrelevantes.
  const kind = eventoCanonico?.message?.kind || (eventoCanonico?.group ? 'group' : null)
  if (!tipoPodeCasar(kind)) {
    if (cfg?.hardware?.debug) {
      log?.(`[engine] ignorado: ${kind} não casa com automação (esboço antes de decifrar ou tipo não mapeado)`)
    }
    return Promise.resolve()
  }
  if (eventoCanonico?.group && !['add', 'remove', 'promote', 'demote', 'subject'].includes(eventoCanonico.group.action)) {
    if (cfg?.hardware?.debug) {
      log?.(`[engine] evento de grupo ignorado: ação "${eventoCanonico.group.action}" não é monitorada pelo porteiro`)
    }
    return Promise.resolve()
  }
  // O enriquecimento de grupo (nome, tamanho, quem é admin) acontece aqui e
  // não na construção do evento porque é chamada de rede: fica no caminho já
  // assíncrono, sem atrasar o processamento da mensagem. Falha aberto — sem os
  // dados, o evento segue como estava.
  return groupInfo.enriquecerEvento(client, eventoCanonico)
    .catch(() => eventoCanonico)
    .then((evento) => enviarEventoAoMotor(clienteEngine, evento))
    .then(async (resultado) => {
    // Motor fora do ar ou lento passa por aqui: `enviarEventoAoMotor` falha
    // aberto e devolve `ok: false`. Sem esta linha, "o bot parou de responder"
    // não deixa rastro em lugar nenhum.
    if (!resultado.ok) {
      try { log?.(`[engine] evento não avaliado: ${resultado.motivo}`) } catch {}
      return
    }
    for (const avaliacao of resultado.results || []) {
      const comandos = (avaliacao.commands || []).filter((comando) => comando.status === 'pending' && despachados.reivindicar(comando.id))
      // O `cfg` chega ao executor porque ações como o download leem
      // configuração (endereço do serviço, token, limite de tamanho). Era a
      // lacuna que também travava a transcrição.
      // SEM FILA AQUI, e isso é uma correção de rumo.
      //
      // A primeira versão enfileirava o COMANDO INTEIRO, e ficou pior: um
      // `/play` passa minutos só esperando a API de download, sem tocar na
      // conexão, e segurando a vaga ele fazia um `/ping` esperar atrás de um
      // download. A fila mudou para onde está a disputa de verdade — o envio e
      // o upload, em gatewayExecutor.js.
      //
      // A vaga de admissão (uma por conversa) tinha o mesmo defeito, e o
      // `/ping` de 32 s do dono foi isso. Ela é devolvida no PRIMEIRO comando
      // longo do lote: o que vem antes dele (o "baixando…") sai em ordem, o que
      // vem depois já não segura a conversa.
      if (!comandos.length) continue
      const primeiroLongo = soltar ? comandos.findIndex((comando) => COMANDOS_LONGOS.has(comando?.commandType)) : -1
      if (primeiroLongo > 0) await executarComandos(client, comandos.slice(0, primeiroLongo), clienteEngine, { cfg })
      if (primeiroLongo >= 0) soltar()
      await executarComandos(client, primeiroLongo > 0 ? comandos.slice(primeiroLongo) : comandos, clienteEngine, { cfg })
    }
  // Engolir o erro aqui deixou o bot mudo por duas horas sem uma linha de log:
  // o comando ficava `pending` para sempre e não havia onde olhar. Continua
  // falhando aberto — o event emitter não pode cair —, mas agora DIZ.
  }).catch((e) => {
    try { log?.(`[engine] falha ao entregar comando: ${e?.message || e}`) } catch {}
  })
}

// O JID da própria conta. meJid vem com
// sufixo de dispositivo (":12@"), e é a forma sem ele que endereça a pessoa.
function jidProprio (client) {
  try {
    const meJid = client.getCredentials?.()?.meJid
    return meJid ? meJid.replace(/:\d+@/, '@') : null
  } catch {
    return null
  }
}

// Alimenta o diretório de contatos conhecidos (usado pelas telas de seleção
// do dashboard) com quem já mandou mensagem — sem sync extra, orgânico.
function registrarContatoConhecido (event) {
  const from = event.key?.remoteJid
  if (!from || event.key.fromMe) return
  if (from.endsWith('@broadcast') || from.endsWith('@newsletter')) return
  // Grupo entra também: antes só conversa direta era registrada, então o nome
  // de quem falava em grupo nunca era lembrado e {{sender.name}} dependia de o
  // WhatsApp mandar o nome naquela mensagem específica. O que se guarda é a
  // PESSOA que escreveu, nunca o grupo.
  const ehGrupo = from.endsWith('@g.us')
  const jidReal = event.key.participantAlt || event.key.participant || (ehGrupo ? null : (event.key.remoteJidAlt || from))
  if (!jidReal) return
  try { registrarContato(jidReal, event.pushName) } catch {}
}

// `event.pushName` é só o nome que a própria pessoa escolheu pro perfil dela
// (às vezes vazio) — não é o nome salvo na agenda. Na Baileys, o nome salvo
// de verdade (agenda do celular) chegava via 'contacts.upsert'/'contacts.update'
// (app-state sync). VALIDAR: o Zapo não documenta um evento equivalente — o
// candidato mais próximo é 'mutation' (app-state sync genérico). Mantido
// como função pura testável; a chamada real (mutationParaContato) tenta
// mapear o evento e loga a forma bruta em debug pra fechar essa lacuna no
// primeiro teste real. Se não houver equivalente, o diretório regride pra
// só pushName — decisão a confirmar, não a assumir.
export function registrarNomesDoDiretorio (contatos) {
  for (const c of contatos || []) {
    const numero = c.phoneNumber || c.id
    const nome = c.name || c.notify
    if (!numero || !nome) continue
    try { registrarContato(numero, nome) } catch {}
  }
}

const pergunta = (texto) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question(texto, (r) => { rl.close(); resolve(r) })
})

// Assinatura só do que é passado pro WaClient na criação (logLevel,
// markOnline) — o resto (contatos/blocklist/grupos) é lido ao vivo por
// passaFiltro() a cada mensagem, sem precisar reconectar.
function assinaturaSocket (cfg) {
  return JSON.stringify({
    logLevel: cfg.hardware?.logLevel,
    markOnline: cfg.hardware?.markOnline
  })
}

// SQLite local (better-sqlite3, addon nativo) — equivalente mais próximo do
// useMultiFileAuthState em arquivos da Baileys.
function criarStore () {
  const caminho = path.join(PASTA_SESSAO, 'zapo.sqlite')
  return createStore({
    backends: { sqlite: createSqliteStore({ path: caminho, driver: 'auto' }) },
    providers: {
      auth: 'sqlite',
      signal: 'sqlite',
      preKey: 'sqlite',
      session: 'sqlite',
      identity: 'sqlite',
      senderKey: 'sqlite',
      appState: 'sqlite',
      privacyToken: 'sqlite',
      messages: 'none',
      threads: 'none',
      contacts: 'none'
    }
  })
}

export async function iniciar () {
  garantirPastas()
  let cfg = carregar()

  // Precedência: o que foi passado na hora de conectar vence o config.json,
  // que vence o padrão. Resolvido UMA vez, aqui, e não a cada reconexão: o
  // rótulo é gravado no pareamento, então mudá-lo no meio da vida da sessão
  // não teria efeito nenhum e só confundiria quem lesse o log.
  const escolha = aparelhoDoArgumento()
  let aparelho
  try {
    aparelho = resolverAparelho({
      navegador: escolha.navegador || cfg.hardware?.aparelho?.navegador,
      sistema: escolha.sistema || cfg.hardware?.aparelho?.sistema
    })
  } catch (erro) {
    // Recusa clara em vez do aparelho sem nome que a biblioteca produziria.
    console.error(erro.message)
    console.error(`Opções: ${APARELHOS.map((a) => `${a.id} (${a.rotulo})`).join(' · ')}`)
    throw erro
  }
  log(`aparelho: ${aparelho.rotulo}`)

  let assinatura = assinaturaSocket(cfg)
  let falhas = 0
  let clienteAtual = null
  let reiniciando = false
  let desligando = false
  let orfaosFechados = false
  let orfaosEmCurso = false
  // Handle do setTimeout(conectar, espera) do retry transiente — guardado
  // pra poder cancelar se um fechamento TERMINAL (logout/conflito/
  // fatal_account/quarentena) chegar logo depois de um retry já agendado.
  // Sem isso, o timer antigo dispararia mesmo assim e reconectaria — quebra
  // a garantia de "nunca reconecta sozinho" nesses casos (achado real na
  // revisão de código).
  let handleRetry = null
  const store = criarStore()
  // Etapa 1 do motor de automação (Parte B do plano): identidade estável
  // deste gateway, usada só pra rotular o evento canônico de debug por
  // enquanto (emitirEventoDebug) — nenhum consumidor real ainda. Recalculado
  // no hot-reload porque cfg.instancia.id pode ser editado ao vivo.
  let accountId = resolverAccountId({ cfg, pastaDados: PASTA_DADOS })
  // Uma instância por processo, reaproveitada por todas as mensagens e por
  // todas as reconexões do WaClient.
  const clienteEngine = criarClienteEngine()
  // Compartilhada inclusive nas reconexões: trocar o socket não pode abrir
  // outro orçamento de cadeias enquanto a fila anterior ainda está viva.
  const admissao = criarAdmissaoDeEventos(cfg)
  state.registrarFonteDeAdmissao(() => admissao.estado)

  // Hot-reload: a maioria do config (captura, transcrição, atualização) é lida ao
  // vivo pelos handlers via closure em `cfg`. Só reconecta quando muda algo que
  // precisa recriar o client (logLevel, markOnline).
  observar((novo) => {
    if (desligando) return
    cfg = novo
    accountId = resolverAccountId({ cfg, pastaDados: PASTA_DADOS })
    bandwidth.configurar(cfg.hardware?.bandwidthLimit)
    const nova = assinaturaSocket(novo)
    if (nova !== assinatura) {
      assinatura = nova
      log('Config de conexão mudou — reconectando pra aplicar...')
      try { clienteAtual?.disconnect() } catch {}
    }
  })

  // Desligamento gracioso: matar o processo sem desconectar (ex.: SIGTERM
  // abrupto) já causou, na prática, o WhatsApp invalidar a sessão recém-
  // pareada na próxima tentativa de resume (failure_not_authorized/401,
  // credenciais limpas pelo próprio Zapo) — visto num teste real durante a
  // migração. disconnect() fecha a conexão preservando as credenciais.
  let desligamento = null
  function desligarGracioso ({ codigo = 0, apagarSessao = false, sair = true } = {}) {
    if (desligamento) return desligamento
    desligando = true
    clearTimeout(handleRetry)
    desligamento = (async () => {
      // Recusar primeiro e desconectar por último deixa os admitidos concluírem
      // seus envios; fechar o socket antes transformaria a drenagem em falhas.
      await admissao.encerrar({ cancelarExternos: true })
      if (apagarSessao) {
        try { await clienteAtual?.logout() } catch {}
        await sleepMs(800)
        try {
          for (const f of fs.readdirSync(PASTA_SESSAO)) {
            fs.rmSync(path.join(PASTA_SESSAO, f), { recursive: true, force: true })
          }
        } catch (e) { log('erro limpando sessão:', e.message) }
        state.definirConexao({ conectado: false, numero: null, nome: null })
        log('Sessão limpa. Reiniciando pra novo login (veja o QR/código nos logs)...')
      } else {
        try { await clienteAtual?.disconnect() } catch {}
      }
      state.gravar()
      if (sair) process.exit(codigo)
    })()
    return desligamento
  }
  encerrarConexao = desligarGracioso

  // Comando "apagar dados do número" (vindo do painel > Serviço): o painel cria
  // data/logout.request; aqui deslogamos, limpamos a sessão e saímos pra reiniciar
  // limpo (o restart policy do container / PM2 recoloca de pé pedindo novo login).
  const reqLogout = path.join(PASTA_DADOS, 'logout.request')
  const reqRestart = path.join(PASTA_DADOS, 'restart.request')
  setInterval(async () => {
    if (desligando) return
    // Painel pediu refresh da lista de grupos (sem precisar reiniciar o bot).
    if (fs.existsSync(ARQ_GRUPOS_REFRESH)) {
      try { fs.unlinkSync(ARQ_GRUPOS_REFRESH) } catch {}
      if (clienteAtual) {
        try { await atualizarGrupos(clienteAtual) } catch (e) { log('erro atualizando grupos:', e.message) }
      }
    }
    // Reiniciar sem apagar sessão (restart policy do container / PM2 recolocam de pé).
    if (fs.existsSync(reqRestart)) {
      try { fs.unlinkSync(reqRestart) } catch {}
      log('🔄 Comando recebido: reiniciando o bot...')
      await desligarGracioso()
      return
    }
    if (!fs.existsSync(reqLogout)) return
    try { fs.unlinkSync(reqLogout) } catch {}
    log('🔌 Comando recebido: apagando dados do número e reiniciando...')
    await desligarGracioso({ apagarSessao: true })
  }, 3000)

  async function conectar () {
    if (reiniciando || desligando) return
    bandwidth.configurar(cfg.hardware?.bandwidthLimit)
    const nivel = cfg.hardware?.logLevel
    const logger = nivel && nivel !== 'silent' ? new ConsoleLogger(nivel) : undefined

    const client = new WaClient({
      store,
      sessionId: SESSION_ID,
      deviceBrowser: aparelho.deviceBrowser,
      deviceOsDisplayName: aparelho.deviceOsDisplayName,
      markOnlineOnConnect: cfg.hardware?.markOnline === true,
      // Equivalente a syncFullHistory:false da Baileys: sync leve (só o
      // recente), não o histórico completo.
      history: { enabled: true, requireFullSync: false },
      version: async () => (await fetchLatestWaWebVersion()).version
    }, logger)
    clienteAtual = client

    if (!USAR_CODIGO) {
      client.on('auth_qr', ({ qr }) => {
        state.definirQR(qr)                     // pro painel renderizar
        // O QR só é desenhado no log quando o dono pediu — ver
        // `hardware.credencialNoLog` em src/config.js.
        if (cfg.hardware?.credencialNoLog) {
          qrcode.generate(qr, { small: true })   // pros logs (docker logs -f)
          log('QR gerado — escaneie pelo painel (lcn > Serviço > Conectar) ou nos logs.')
        } else {
          log('QR gerado — escaneie pelo painel (lcn > Serviço > Conectar).')
        }
      })
    }


    // VALIDAR: candidato a equivalente de contacts.upsert/contacts.update
    // (agenda do telefone) — ver comentário de registrarNomesDoDiretorio.
    client.on('mutation', (event) => {
      if (cfg.hardware?.debug) log('mutation:', JSON.stringify(event).slice(0, 500))
    })

    registrarEntradaDeEventos(client, clienteEngine, {
      admissao, obterContexto: () => ({ cfg, accountId })
    })

    client.on('connection', ({ status, reason, isLogout }) => {
      if (status === 'open') {
        if (desligando) return
        falhas = 0
        state.registrarSucessoConexao()
        state.limparQR()
        state.limparCodigoPareamento()
        const creds = client.getCredentials?.()
        const jid = creds?.meJid
        log('Conectado como', jid || '(jid não disponível)')
        // Marca o dispositivo como ativo — igual ao comportamento anterior. Sem
        // isso, o dispositivo pode ficar "offline" e remetentes podem não
        // encriptar as mensagens pra ele.
        client.presence?.send?.('available').catch(() => {})
        atualizarGrupos(client).catch((e) => log('erro atualizando grupos:', e.message))
        // Carrega de uma vez quem é admin em cada grupo. Sem isto, a PRIMEIRA
        // mensagem de cada grupo depois de conectar pagaria a consulta — e, se
        // ela falhasse, sairia sem {{sender.isAdmin}} e sem {{chat.name}}.
        groupInfo.aquecer(client)
          .then((n) => { if (n) log(`dados de ${n} grupo(s) carregados`) })
          .catch(() => {})
        // Fecha o que ficou pendurado de uma queda anterior. Se este gateway
        // acabou de conectar, nada dele está em andamento — o que sobrou
        // `pending` morreu no meio. O caso que dói é o download: ele promete
        // "⏳ Baixando…" antes de baixar, e sem isto a pessoa fica esperando
        // para sempre uma mídia que nunca vem.
        //
        // SÓ NA PRIMEIRA CONEXÃO DO PROCESSO (ou até uma limpeza completa). O
        // evento `open` volta a cada reconexão do WhatsApp, e nessa hora este
        // processo continua vivo, com downloads de verdade em andamento:
        // fechá-los como "interrompidos" mentiria e ainda mandaria o aviso de
        // "o serviço reiniciou" para quem esperava uma mídia a caminho.
        if (!orfaosFechados && !orfaosEmCurso) {
          orfaosEmCurso = true
          fecharOrfaos(client, clienteEngine, accountId, { log, antesDe: INICIO_DO_PROCESSO })
            .then((r) => { if (r?.completo) orfaosFechados = true })
            .catch(() => {})
            .finally(() => { orfaosEmCurso = false })
        }
        state.definirConexao({
          conectado: true,
          numero: jid ? jid.split('@')[0].split(':')[0] : null,
          nome: null,
          desde: Date.now()
        })
      }

      // VALIDADO em teste real: o valor do evento é 'close', não 'closed'
      // como a doc do Zapo descreve em prosa.
      if (status === 'close') {
        state.definirConexao({ conectado: false })
        if (desligando) return
        const classe = classificarFechamento({ reason, isLogout })

        if (classe === 'auto_gerenciado') {
          // stream_error_force_login: o Zapo já reconecta o MESMO client
          // sozinho (ver connectionReasons.js). NÃO agendar setTimeout(conectar)
          // aqui é o ponto principal — fazer isso criaria um segundo WaClient
          // pro mesmo sessionId enquanto o Zapo ainda está se recuperando,
          // recriando o incidente de disputa de sessão. Só loga e espera o
          // próximo evento do client atual.
          state.incr('quedas')
          log(`Conexão caiu (motivo ${reason}) — o Zapo reconecta sozinho aqui, não vou interferir.`)
          return
        }

        if (classe === 'transiente') {
          falhas++
          // Usa o valor retornado, não state.ler() — o flush em disco é
          // debounced (250ms), reler o arquivo aqui sempre pegaria o valor
          // ANTERIOR (bug real encontrado em revisão de código).
          const falhasConsecutivas = state.registrarFalhaConexao()
          state.incr('quedas')
          avaliarAutoUpdate(falhas, cfg)
          const limiteQuarentena = cfg.confiabilidade?.falhasConsecutivasParaQuarentena || 15
          if (falhasConsecutivas >= limiteQuarentena) {
            // Mesma trava do bloco terminal abaixo: quarentena também nunca
            // deve reconectar sozinho.
            clearTimeout(handleRetry)
            reiniciando = true
            entrarEmQuarentena(reason)
            if (process.env.LCN_SUPERVISED === 'systemd') void desligarGracioso({ codigo: EXIT_QUARANTINED })
            return
          }
          const espera = Math.min(30000, 2000 * falhas)
          log(`Conexão caiu (motivo ${reason}), reconectando em ${espera / 1000}s (falha ${falhas})...`)
          state.incr('reconexoes')
          handleRetry = setTimeout(conectar, espera)
          return
        }

        // logout / conflito / fatal_account: nunca reconecta sozinho — motivo
        // exato do incidente que causou este pedaço do plano (duas instâncias
        // da mesma sessão brigando porque o retry era genérico pra qualquer
        // motivo de fechamento, inclusive conflito de sessão). Cancela
        // qualquer retry transiente já agendado e trava conectar() via
        // `reiniciando` — sem isso um timer residual (ou o próprio Zapo
        // reconectando internamente em alguns motivos) poderia reconectar
        // mesmo assim (achado real em revisão de código).
        clearTimeout(handleRetry)
        reiniciando = true
        state.incr('quedas')
        state.definirSaude({ status: classe, motivo: reason, desde: Date.now() })
        log(mensagemParaClasse(classe, reason))
        if (process.env.LCN_SUPERVISED === 'systemd') {
          state.gravar()
          void desligarGracioso({ codigo: codigoParaClasse(classe) })
        }
      }
    })

    const conexao = client.connect()

    // A hipótese anterior de que connect() aguardava o pareamento estava errada:
    // no Zapo 1.8.2 ele resolve quando o transporte sobe, mesmo sem meJid.
    // auth_pairing_required nasce só de refresh_code e serve para renovar o código.
    await conexao

    if (USAR_CODIGO) {
      if (!client.getState().registered) {
        const numero = await numeroParaParear()
        if (!numero) throw new Error('pareamento por código exige um número: use --code=5522999999999 ou LCN_PAIR_NUMBER')
        let pedidoCodigo = null

        const solicitarCodigo = () => {
          if (pedidoCodigo) return pedidoCodigo
          pedidoCodigo = client.auth.requestPairingCode(numero)
            .then((codigo) => {
              const formatado = codigo.match(/.{1,4}/g)?.join('-') || codigo
              state.definirCodigoPareamento(formatado)
              // Os dígitos só vão para o log quando o dono pediu — ver
              // `hardware.credencialNoLog` em src/config.js. Sem eles a linha
              // continua existindo: quem acompanha o log precisa saber que o
              // código SAIU, senão não distingue "pediram e chegou" de
              // "travou antes de pedir".
              if (cfg.hardware?.credencialNoLog) log('Código de pareamento:', formatado)
              else log('Código de pareamento gerado — pegue pelo painel (lcn > Serviço > Conectar).')
            })
            .finally(() => { pedidoCodigo = null })
          return pedidoCodigo
        }
        const renovarCodigo = () => {
          if (client.getState().registered) return
          void solicitarCodigo().catch((e) => log('Erro renovando código de pareamento:', e.message))
        }
        const encerrarRenovacao = () => {
          client.off('auth_pairing_required', renovarCodigo)
          client.off('auth_paired', encerrarRenovacao)
          client.off('connection', aoMudarConexao)
        }
        const aoMudarConexao = ({ status }) => {
          if (status === 'close') encerrarRenovacao()
        }

        client.on('auth_pairing_required', renovarCodigo)
        client.on('connection', aoMudarConexao)
        client.once('auth_paired', encerrarRenovacao)
        try {
          await solicitarCodigo()
        } catch (e) {
          encerrarRenovacao()
          throw e
        }
      }
    }

    return client
  }

  await conectar()
}

// Em queda persistente, sinaliza que o Zapo pode precisar de atualização.
// Última instância antes de desistir de reconectar sozinho: N falhas
// consecutivas (persistidas em state.saude, sobrevivem a restart do
// processo — ver state.js) sem NENHUM sucesso no meio. Nunca apaga a sessão
// — só para de tentar; o usuário decide (via painel/lcn instances retry) se
// quer só tentar de novo ou limpar a sessão e parear do zero.
function entrarEmQuarentena (motivo) {
  state.definirSaude({ status: 'quarentena', motivo, desde: Date.now() })
  log(`⚠️  Muitas falhas de conexão seguidas sem sucesso — entrando em quarentena (motivo mais recente: ${motivo}). Não vou mais tentar reconectar sozinho.`)
  state.gravar()
}

function avaliarAutoUpdate (falhas, cfg) {
  const limite = cfg.atualizacao?.falhasParaUpdate || 5
  if (!cfg.atualizacao?.autoUpdateLib) return
  if (falhas < limite) return
  try {
    garantirPastas()
    const flag = path.join(PASTA_DADOS, 'precisa-update.flag')
    fs.writeFileSync(flag, `Quedas consecutivas: ${falhas}. Rode a atualização (sh update.sh) ou "lcn" > Atualizar.\n`)
    log('⚠️  Muitas quedas seguidas — pode ser mudança de protocolo do WhatsApp. Sinalizado update do zapo-js.')
  } catch {}
}
