// Avaliador de eventos canônicos contra automações publicadas — Etapa 3.5
// do plano. Um único caminho de código serve sombra E ao vivo: a diferença
// é só o que acontece depois de um match (grava "teria executado" vs. gera
// comando executável) — decisão já registrada no plano pra não precisar de
// uma "Etapa 3 modo sombra" separada.
import crypto from 'crypto'
import { ErroHttp } from './transport.js'
import { interpolar, resolverCaminho } from './interpolate.js'
import { ehLinkDeMidia } from '../linkDeMidia.js'
import { valoresDeAgora } from './momento.js'
import { ehDono, podeUsarComandoRestrito } from './owners.js'
import { ehChaveReservada, motivoDeRecusa } from './chavesReservadas.js'
import { CHAVE_MENU, FORMATOS as FORMATOS_DE_MENU, gravarConfigDeMenu, lerConfigDeMenu, resolverConfigDeMenu } from './menuConfig.js'
import {
  ErroDeContador,
  aplicarNasVariaveis,
  carregarCategoria,
  carregarVariaveis,
  gravarAtributo,
  incrementarAtributo,
  resolverAlvo,
  resolverEscopo
} from './attributeScopes.js'

// Fluxo malformado que passou pela validação de publish (documento adulterado
// no banco, revisão antiga de antes de uma regra nova). Vira status 'error' no
// run — nunca truncar o fluxo em silêncio, que esconderia meia execução.
class ErroDeFluxo extends Error {}

function jsonOuNull (valor) {
  if (valor == null) return null
  try { return JSON.parse(valor) } catch { return null }
}

function kindDoEscopo (chat) {
  return chat.kind === 'group' ? 'group' : 'contact'
}

// Uma conversa está "marcada" quando a variável daquela conversa existe e vale
// algo de verdade. É a mesma entidade que {{var.chat.<chave>}} lê — marcar um
// contato como vip na aba Dados é o que o coloca no destino "marcados com vip".
//
// Vazio, zero e false NÃO marcam: quem desmarcou alguém gravando `false`
// esperaria que ele saísse do destino, não que continuasse dentro.
function conversaMarcada (db, chat, chave) {
  if (!db || !chave) return false
  const linha = db.prepare(
    'SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?'
  ).get(kindDoEscopo(chat), chat.id, chave)
  if (!linha) return false
  try {
    const valor = JSON.parse(linha.value_json)
    return valor !== false && valor !== null && valor !== 0 && valor !== ''
  } catch {
    return false
  }
}

// A marca que diz "o dono autorizou o bot a agir NESTE grupo".
//
// Grupo é diferente de conversa direta: quem manda mensagem lá não escolheu
// falar com o bot, e muitas vezes nem sabe que ele está ali. Por isso o padrão
// em grupo é o bot ficar inerte até alguém com autoridade dizer que pode.
//
// A marca é um atributo comum da conversa, igual às outras marcas — assim o
// comando que a liga é uma automação como qualquer outra, criada por template,
// e não uma regra escondida dentro do motor.
export const CHAVE_GRUPO_ATIVO = 'grupo_ativo'

// A política de entrada de uma revisão, ou null se ela estiver torta.
//
// Estes campos eram lidos direto — `documento.inputPolicy.historyPolicy` — e o
// laço inteiro roda dentro de uma transação. Uma revisão sem `inputPolicy`
// (documento antigo, inserção nativa, registro adulterado) lançava TypeError,
// abortava a transação, e NENHUMA automação daquele evento era avaliada: uma
// regra quebrada calava o bot inteiro, com 500 na cara de quem chamou.
//
// `jsonOuNull` devolve o que estiver no banco, e nem toda revisão passou por
// `validarAutomacao` — então "isso não acontece" não era garantia de nada.
//
// Conferir a estrutura, em vez de alargar o catch: catch largo engole também o
// defeito de programação do próximo mês. Foi exatamente assim que um
// `.catch(() => {})` escondeu por horas o bug que fazia o gateway não entregar
// mensagem nenhuma.
function politicaDeEntrada (documento) {
  const politica = documento?.inputPolicy
  if (!politica || typeof politica !== 'object') return null
  if (!Array.isArray(politica.acceptedMessageKinds)) return null
  return politica
}

// Num grupo sem autorização, só comando restrito ao dono é avaliado — senão
// não haveria como ligar o bot lá de dentro, e a única saída seria o painel.
//
// Isso NÃO é uma segunda regra de escopo: escopo diz onde a automação PODE
// valer; isto diz onde o bot foi autorizado a existir. Uma automação com
// escopo "em qualquer lugar" continua não agindo em grupo não autorizado.
function grupoBloqueado (db, evento, trigger) {
  if (evento?.chat?.kind !== 'group') return false
  if (trigger?.config?.requireOwner === true) return false
  return !conversaMarcada(db, evento.chat, CHAVE_GRUPO_ATIVO)
}

// O dono usando um comando restrito DENTRO do grupo já é a autorização.
//
// Sem isto o portão produzia uma mentira: o dono mandava /autodow num grupo não
// autorizado, o comando rodava (comando restrito sempre passa, ver acima),
// gravava o marcador e respondia "✅ LIGADO" — mas a regra que realmente baixa
// não é restrita ao dono, então seguia barrada. O dono lia "ligado" e o bot não
// fazia nada, sem erro em lugar nenhum.
//
// Não afrouxa o portão para terceiros: continua valendo só para quem já passou
// por `podeUsarComandoRestrito`. O /ativar segue existindo para quem quer
// autorizar o grupo sem ligar mais nada.
//
// Só em execução AO VIVO: em sombra, gravar contrariaria o invariante 2 — o
// modo existe justamente para não deixar rastro.
function autorizarGrupoPeloDono (db, evento, trigger) {
  if (evento?.chat?.kind !== 'group') return false
  if (trigger?.config?.requireOwner !== true) return false
  if (conversaMarcada(db, evento.chat, CHAVE_GRUPO_ATIVO)) return false
  gravarAtributo(db, { scopeKind: 'group', scopeId: evento.chat.id }, CHAVE_GRUPO_ATIVO, 'sim')
  return true
}

// Um destino casa com a conversa do evento?
//
// `contact`/`group` continuam sendo o endereço exato de uma conversa. Os outros
// são os destinos abrangentes, que existem para a pessoa poder dizer "todos" de
// PROPÓSITO — a diferença entre escolher e esquecer, que é o motivo de lista
// vazia nunca significar todos.
function refCasa (db, ref, chat) {
  switch (ref.kind) {
    case 'contact':
    case 'group':
      return ref.kind === kindDoEscopo(chat) && ref.ref_id === chat.id
    // "Todos os contatos no privado" é conversa direta mesmo — canal e
    // transmissão não são contatos, e o bot não tem o que fazer lá.
    case 'all_contacts': return chat.kind === 'direct'
    case 'all_groups': return chat.kind === 'group'
    // "Qualquer conversa" é contato OU grupo, e a tela diz isso com estas
    // palavras. Canal e transmissão ficam de fora de propósito: responder num
    // canal não é um caso de uso, é um acidente.
    case 'everywhere': return chat.kind === 'direct' || chat.kind === 'group'
    case 'tagged': return conversaMarcada(db, chat, ref.ref_id)
    default: return false
  }
}

// scope.include vazio NUNCA significa "todos" — decisão explícita do plano
// (item 2 das "três decisões a fechar antes do primeiro publish"). Sem
// include nenhum, a automação não casa com JID nenhum. O erro é assimétrico:
// esquecer de preencher e o bot responder em TODAS as conversas, inclusive as
// pessoais, é muito pior do que ele não responder em nenhuma.
//
// Exclude vence include, sempre: é o que faz "todos os grupos MENOS este"
// funcionar, que é o motivo principal de os destinos abrangentes existirem.
function escopoCasa (db, refs, chat) {
  if (refs.some((r) => r.direction === 'exclude' && refCasa(db, r, chat))) return false
  return refs.some((r) => r.direction === 'include' && refCasa(db, r, chat))
}

// O destino de um comando pode vir de uma VARIÁVEL, não só fixo no documento.
//
// É o que liga um comando comum ao comando de configuração: o de configuração
// grava `var.global.recover_destino` na tabela, e o comum lê dali. Os dois se
// encontram na mesma tabela dos marcadores (vip e afins), sem mecanismo novo.
//
// Três formas aceitas, porque é o que uma pessoa digita no WhatsApp:
//   - um JID completo (5511...@s.whatsapp.net ou ...@g.us)
//   - só os dígitos do número, que viram JID de contato
//   - nada / variável não configurada -> null, e quem chamou avisa
function resolverDestinoConfigurado (bruto, contexto) {
  if (typeof bruto !== 'string' || !bruto) return null
  const resolvido = interpolar(bruto, contexto).trim()
  // Placeholder intacto = variável nunca gravada. Nunca tratar como endereço.
  if (!resolvido || resolvido.includes('{{')) return null
  if (/@(s\.whatsapp\.net|g\.us|lid)$/.test(resolvido)) return resolvido
  const digitos = resolvido.replace(/\D/g, '')
  return digitos.length >= 8 ? `${digitos}@s.whatsapp.net` : null
}

// QUEM A MENSAGEM MARCA, a partir do que o comando escreveu.
//
// Aceita vários, separados por vírgula, e cada um nas mesmas três formas que
// `resolverDestinoConfigurado` aceita — JID inteiro, só os dígitos, ou um
// marcador como `{{sender.id}}`, que é o caso comum.
//
// O que NÃO entra: marcador que não resolveu. Um `{{...}}` intacto significa
// variável nunca gravada, e mandá-lo como destinatário de menção marcaria
// ninguém ou, pior, alguém errado. Entrada torta sai da lista em silêncio —
// marcar é decoração da mensagem, e perder a marcação é melhor do que não
// mandar a mensagem.
export function mencoesDeclaradas (bruto, contexto) {
  if (typeof bruto !== 'string' || !bruto) return []
  const vistos = new Set()
  for (const parte of interpolar(bruto, contexto).split(',')) {
    const limpo = parte.trim()
    if (!limpo || limpo.includes('{{')) continue
    if (/@(s\.whatsapp\.net|g\.us|lid)$/.test(limpo)) { vistos.add(limpo); continue }
    const digitos = limpo.replace(/\D/g, '')
    if (digitos.length >= 8) vistos.add(`${digitos}@s.whatsapp.net`)
  }
  return [...vistos]
}

// Só os dígitos de um JID: 5511999999999@s.whatsapp.net -> 5511999999999.
// É o que um link wa.me/<numero> precisa, e o que uma pessoa reconhece como
// "o número" — o JID inteiro não serve para nenhum dos dois.
// Tira do que vai virar texto as referências de mídia. Elas são tokens: servem
// para o gateway buscar bytes, não para aparecer numa mensagem. O tipo e a
// legenda da mídia seguem legíveis por `media.*`.
function semTokens (mensagem) {
  const { mediaRef, quotedMediaRef, ...resto } = mensagem || {}
  return resto
}

function soDigitos (jid) {
  if (typeof jid !== 'string' || !jid) return undefined
  const digitos = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
  return digitos || undefined
}

// A mensagem RESPONDIDA, do ponto de vista de quem escreve um comando: quem
// escreveu, o número dela, o texto, e o primeiro link que esse texto tiver.
// O link sai pronto porque é o que um "/dow" marcando uma mensagem precisa.
function montarCitacao (evento) {
  const ref = evento?.message?.quotedRef
  if (!ref?.participant && !ref?.text) return {}
  const citacao = {}
  if (ref.participant) {
    citacao.sender = ref.participant
    citacao.number = soDigitos(ref.participant)
  }
  if (typeof ref.text === 'string' && ref.text) {
    citacao.text = ref.text
    const link = primeiroLink(ref.text)
    if (link) citacao.link = link
  }
  return citacao
}

// Qual mensagem a resposta deve MARCAR: a que tem o link.
//
// Com "/dow" respondendo alguém, o link está na mensagem citada — é ela que
// interessa, não o comando. Sem citação (download automático), o link está na
// própria mensagem que chegou. Devolve só endereçamento, nunca conteúdo.
// A MENSAGEM DE QUEM PEDIU, sem olhar o que ela responde.
//
// Existe porque a resposta de botão CARREGA um `quotedRef` — ela responde o
// carrossel —, e marcar o carrossel deixa a música pendurada no card em vez do
// pedido. Quem tocou o botão está esperando no pedido dele.
function referenciaDaPropria (evento) {
  const propria = evento?.providerRef
  if (!propria?.id) return null
  return {
    // A CONVERSA MANDA, não o `remoteJid` da chave.
    //
    // Medido no sistema do dono: a mensagem do toque no botão chega com
    // `remoteJid: "122415745073189@lid"` e `remoteJidAlt:
    // "628977791132@s.whatsapp.net"`. A resposta sai para a conversa — a
    // segunda forma —, e citar a primeira é citar uma mensagem de OUTRO
    // endereço: o WhatsApp não acha, e descarta a citação sem dizer nada.
    // Foi o "agora não marcou mensagem nenhuma".
    remoteJid: evento.chat?.id || propria.remoteJid,
    id: propria.id,
    fromMe: propria.fromMe === true,
    ...(propria.participant ? { participant: propria.participant } : {})
  }
}

function referenciaDoLink (evento) {
  const citada = evento?.message?.quotedRef
  if (citada?.id) {
    return {
      remoteJid: evento.chat?.id,
      id: citada.id,
      fromMe: false,
      ...(citada.participant ? { participant: citada.participant } : {})
    }
  }
  const propria = evento?.providerRef
  if (!propria?.id) return null
  return {
    // Mesma razão de `referenciaDaPropria`: a citação vive na CONVERSA para
    // onde a resposta vai, e o `remoteJid` da chave pode ser a forma @lid.
    remoteJid: evento.chat?.id || propria.remoteJid,
    id: propria.id,
    fromMe: propria.fromMe === true,
    ...(propria.participant ? { participant: propria.participant } : {})
  }
}

// Tipo e legenda da mídia que o comando está tratando. A da própria mensagem
// ganha da citada, na mesma ordem em que as ações a consomem.
function dadosDaMidiaEmJogo (evento) {
  const msg = evento?.message
  if (msg?.mediaRef) {
    return {
      // `message.kind` de visualização única é literalmente 'view_once' e não
      // diz se é foto, vídeo ou áudio. Por isso o tipo vem à parte.
      kind: msg.mediaKind || msg.kind,
      ...(msg.mediaCaption ? { caption: msg.mediaCaption } : {})
    }
  }
  const citada = msg?.quotedMediaRef
  if (citada?.token) {
    return {
      kind: citada.mediaKind,
      ...(citada.caption ? { caption: citada.caption } : {})
    }
  }
  return {}
}

function acharTrigger (documento) {
  return (documento?.flow?.nodes || []).find((n) => typeof n?.type === 'string' && n.type.startsWith('trigger.')) || null
}

// Detector de link próprio, fechado. Deliberadamente NÃO aceita regex vinda do
// usuário: além do risco de expressão catastrófica, uma regex livre num gatilho
// que roda em toda mensagem é superfície demais. Segue a heurística que os bots
// de referência usam para não marcar reticências e números decimais como link.
const TLD_COMUM = /\b[a-z0-9][a-z0-9-]{0,61}\.(com|net|org|br|io|me|gg|app|dev|xyz|info|tv|co|link|site|online|shop|store|club|live|news|blog|top|fun|bet|vip)\b/i
const ESQUEMA = /\b(https?:\/\/|www\.)\S{2,}/i

export function contemLink (texto) {
  if (typeof texto !== 'string' || !texto.trim()) return false
  if (ESQUEMA.test(texto)) return true
  // Sem esquema, exige um domínio com TLD conhecido. "3.5" e "etc..." não
  // passam, que era o falso-positivo clássico desses bots.
  return TLD_COMUM.test(texto)
}

// O primeiro link de um texto, já limpo de pontuação grudada.
//
// Existe porque uma mensagem quase nunca é só a URL: é "olha isso
// https://... muito bom". Um comando que baixa mídia precisa da URL sozinha, e
// obrigar a pessoa a mandar só o link seria transformar um detalhe nosso em
// regra dela.
//
// Reaproveita a MESMA heurística do detector de link (`contemLink`), para não
// existirem duas noções de "isto é um link" que discordam — uma para o
// anti-link e outra para o download.
export function primeiroLink (texto) {
  if (typeof texto !== 'string' || !texto.trim()) return undefined
  for (const pedaco of texto.split(/\s+/)) {
    // Ponto, vírgula e parêntese no fim são pontuação da frase, não da URL.
    const limpo = pedaco.replace(/[.,;:!?)\]}>'"]+$/, '')
    if (!limpo) continue
    if (ESQUEMA.test(limpo)) return limpo.startsWith('www.') ? `https://${limpo}` : limpo
    if (TLD_COMUM.test(limpo) && !/\s/.test(limpo)) return `https://${limpo}`
  }
  return undefined
}

// A EXIGÊNCIA DECLARADA, resolvida antes de o fluxo rodar.
//
// Substitui o `"{{quoted.link}} {{message.link}}"` escrito na entrada de uma
// ação — string que esconde um algoritmo (interpola, apaga o que não resolveu,
// pega o primeiro link) e que ninguém adivinha lendo.
//
// A ordem de `from` é a ordem de procura, e é o que permite um comando aceitar
// as duas formas: responder uma mensagem com link OU colar o link junto.
//
// LINK e MÍDIA são diferentes de propósito. Link é informação e entra no
// contexto, então a ação escreve `url: o link`. Mídia é TOKEN — capacidade, não
// informação — e o invariante 4 proíbe que ela chegue ao interpolador; aqui a
// exigência serve de portão e de mensagem de falta, e quem precisa do ref
// continua resolvendo estruturalmente.
function resolverExigencia (evento, exige) {
  if (!exige?.kind) return { precisa: false, ok: true }
  for (const onde of exige.from || []) {
    if (exige.kind === 'link') {
      // `quotedRef.text` é de onde `{{quoted.link}}` já tirava o link — a mesma
      // fonte, agora declarada em vez de escondida numa string.
      const texto = onde === 'quoted' ? evento.message?.quotedRef?.text : evento.message?.text
      const link = primeiroLink(texto)
      if (link) return { precisa: true, ok: true, link }
    } else {
      const ref = onde === 'quoted' ? evento.message?.quotedMediaRef?.token : evento.message?.mediaRef
      if (ref) return { precisa: true, ok: true, mediaRef: ref }
    }
  }
  return { precisa: true, ok: false }
}

// Gatilho que dispara sem comando: por tipo de mídia, por link, por palavra.
// É o que os "anti-*" e "auto-*" dos bots de referência precisam.
function eventoCasaGatilhoDeMensagem (evento, config) {
  const tipos = config?.messageKinds
  if (Array.isArray(tipos) && tipos.length && !tipos.includes(evento.message.kind)) return false

  const texto = typeof evento.message.text === 'string' ? evento.message.text : ''

  if (config?.containsLink === true && !contemLink(texto)) return false
  if (config?.containsLink === false && contemLink(texto)) return false

  // Só posts de mídia de rede conhecida.
  //
  // Sem isto, o download automático reage a QUALQUER link: loja, notícia,
  // arquivo em nuvem, post de comunidade do YouTube. Nenhum tem mídia para
  // baixar, mas o bot já mandou "⏳ Baixando…" antes de descobrir — e a pessoa
  // recebe uma promessa seguida de um pedido de desculpa.
  //
  // Vale só para o gatilho AUTOMÁTICO. O comando manual continua tentando
  // qualquer link: ali a pessoa pediu de propósito, e recusar seria decidir
  // por ela.
  if (config?.mediaLinkOnly === true && !ehLinkDeMidia(primeiroLink(texto))) return false

  if (Array.isArray(config?.keywords) && config.keywords.length) {
    const baixo = texto.toLowerCase()
    const achou = config.keywords.some((p) => typeof p === 'string' && p && baixo.includes(p.toLowerCase()))
    if (!achou) return false
  }

  return true
}

// Barreira NÃO configurável, aplicada antes de qualquer gatilho automático.
// Diferente de allowFrom (que é campo do documento e pode ser desmarcado),
// isto não tem como desligar: um gatilho que reage a toda mensagem não pode
// reagir às próprias mensagens do bot nem a status/transmissão, sob risco de
// laço entre bots e de tempestade de execuções.
function barreiraDeGatilhoAutomatico (evento) {
  // O que esta barreira existe para impedir é LAÇO: o bot responde, a resposta
  // volta como evento, ele responde de novo. Isso continua não sendo
  // configurável.
  //
  // O que ela NÃO deve impedir é o dono usar as próprias automações do número
  // dele. O WhatsApp marca `fromMe` nas duas situações, e tratar as duas igual
  // era o motivo de mandar um link do próprio número e o download automático
  // não fazer nada.
  //
  // `authoredByBot` é a distinção: só o gateway sabe qual mensagem ELE enviou.
  // Mensagem digitada por uma pessoa segue a regra normal de `allowFrom`, logo
  // abaixo — o padrão `external` continua ignorando o próprio número, então
  // nada muda para quem não pedir.
  if (evento.sender?.authoredByBot === true) return false
  const chatId = evento.chat?.id || ''
  if (chatId.endsWith('@broadcast') || chatId.endsWith('@newsletter')) return false
  if (evento.chat?.kind === 'channel') return false
  return true
}

function textoCasaComando (texto, config) {
  if (typeof texto !== 'string') return false
  const alvo = texto.trim()
  const comando = config.command
  switch (config.match) {
    case 'exact': return alvo.toLowerCase() === comando.toLowerCase()
    case 'prefix': return alvo.toLowerCase().startsWith(comando.toLowerCase())
    case 'keyword': return new RegExp(`(^|\\s)${comando.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(alvo)
    case 'exact_or_args': {
      const baixo = alvo.toLowerCase()
      const cmdBaixo = comando.toLowerCase()
      return baixo === cmdBaixo || baixo.startsWith(`${cmdBaixo} `)
    }
    default: return false
  }
}

// O que a pessoa escreveu DEPOIS do comando: "/adv fulano bagunçou" -> "fulano
// bagunçou". Sem isso, todo comando que recebe parâmetro pelo chat (a maioria
// nos bots de referência) fica sem como ler o que veio.
export function extrairArgumentos (texto, comando) {
  if (typeof texto !== 'string' || typeof comando !== 'string') return ''
  const limpo = texto.trim()
  if (limpo.toLowerCase().startsWith(comando.toLowerCase())) {
    return limpo.slice(comando.length).trim()
  }
  return ''
}

// As partes nomeadas do argumento, do jeito que o gatilho declarou.
//
// Só entram as que vieram: parte vazia não vira string vazia, porque string
// vazia no meio de um texto some sem deixar rastro e o marcador literal não.
function dividirArgumentos (texto, declarado) {
  const bruto = typeof texto === 'string' ? texto.trim() : ''
  const nomes = declarado.names
  if (!bruto) return {}
  const pedacos = bruto.split(declarado.separator)
  const partes = pedacos.length > nomes.length
    // A última leva o resto, com o separador de volta no meio.
    ? [...pedacos.slice(0, nomes.length - 1), pedacos.slice(nomes.length - 1).join(declarado.separator)]
    : pedacos
  const saida = {}
  partes.forEach((valor, i) => {
    const limpo = String(valor).trim()
    if (limpo && nomes[i]) saida[nomes[i]] = limpo
  })
  return saida
}

// Resolve um operando para seu valor BRUTO (número continua número), nunca
// para o texto já interpolado: comparar "10" com "3" como texto daria 10 < 3.
function resolverOperando (db, operando, evento, contexto) {
  if (operando.source === 'literal') return operando.value
  // Mesmo contexto e mesmo resolvedor da interpolação, de propósito: eram dois
  // mapas diferentes, e a divergência entre eles é o que fazia
  // {{sender.isAdmin}} existir no texto e não existir na condição. Quem pode
  // ser escrito numa resposta pode ser comparado numa condição — não havia
  // razão para as duas coisas discordarem.
  if (operando.source === 'event') return resolverCaminho(contexto, operando.field)

  const alvo = resolverEscopo(operando.scope, evento, { categoryKey: operando.categoryKey })
  if (!alvo) return undefined
  if (operando.scope === 'category') carregarCategoria(db, contexto.var, operando.categoryKey)

  const ramo = operando.scope === 'category'
    ? contexto.var.category?.[operando.categoryKey]
    : contexto.var[ramoDoEscopo(operando.scope)]
  return ramo && Object.hasOwn(ramo, operando.key) ? ramo[operando.key] : undefined
}

function ramoDoEscopo (escopo) {
  if (escopo === 'sender') return 'sender'
  if (escopo === 'group_member') return 'member'
  if (escopo === 'target') return 'target'
  if (escopo === 'target_group_member') return 'targetMember'
  if (escopo === 'global') return 'global'
  return 'chat'
}

function comoNumero (valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : undefined
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function comoTexto (valor) {
  if (valor === undefined || valor === null) return undefined
  return typeof valor === 'string' ? valor : String(valor)
}

function compararValores (esquerda, operador, direita) {
  if (operador === 'contains' || operador === 'not_contains') {
    const alvo = comoTexto(esquerda)
    const agulha = comoTexto(direita)
    if (alvo === undefined || agulha === undefined) return false
    const achou = alvo.toLowerCase().includes(agulha.toLowerCase())
    return operador === 'contains' ? achou : !achou
  }

  if (operador === 'eq' || operador === 'neq') {
    const nEsq = comoNumero(esquerda)
    const nDir = comoNumero(direita)
    // Dois números comparam como número; qualquer outro par compara como
    // texto, para "true" bater com true e "vip" com "vip".
    const igual = (nEsq !== undefined && nDir !== undefined)
      ? nEsq === nDir
      : comoTexto(esquerda) === comoTexto(direita)
    return operador === 'eq' ? igual : !igual
  }

  // Ordem só faz sentido entre números. Um contador que ainda não existe é
  // undefined e a comparação é falsa — nunca tratado como zero, senão
  // "avisos >= 0" removeria alguém que nunca infringiu nada.
  const nEsq = comoNumero(esquerda)
  const nDir = comoNumero(direita)
  if (nEsq === undefined || nDir === undefined) return false
  switch (operador) {
    case 'gt': return nEsq > nDir
    case 'gte': return nEsq >= nDir
    case 'lt': return nEsq < nDir
    case 'lte': return nEsq <= nDir
    default: return false
  }
}

// Executa UM nó e devolve por qual aresta seguir ('success' para ação,
// 'true'/'false' para condição). Só roda no caminho ao vivo — em sombra
// nada aqui é chamado, então nenhum efeito é persistido.
function executarNo (db, no, evento, contexto, comandos, temSucessor = false) {
  switch (no.type) {
    case 'action.whatsapp.reply': {
      const payload = { chatId: evento.chat.id, text: interpolar(no.config.text, contexto) }
      // O motor não sabe quando a resposta vai sair de verdade pelo WhatsApp
      // — só o gateway sabe, na hora do envio. Por isso o texto pode conter o
      // placeholder literal "{{latencyMs}}" (ex: template /ping) e o motor só
      // repassa o instante de recebimento pro gateway resolver o valor real
      // logo antes de mandar (ver gatewayExecutor.js). Não é um motor de
      // template genérico — só esse um placeholder.
      if (typeof no.config.text === 'string' && no.config.text.includes('{{latencyMs}}') && typeof evento.receivedAtMs === 'number') {
        payload.receivedAtMs = evento.receivedAtMs
      }
      // A MENÇÃO VIVE NO CONTEXTO DA MENSAGEM, não no texto.
      //
      // Escrever "@5511999999999" no meio do texto manda dígitos: parece uma
      // menção, não notifica ninguém e não pinta nome nenhum. O que faz o
      // WhatsApp entender é a lista de marcados que viaja ao lado do texto —
      // por isso é campo, e por isso o texto continua sendo texto.
      const marcados = mencoesDeclaradas(no.config.mentions, contexto)
      if (marcados.length) payload.mentions = marcados
      if (no.config.forward === true) payload.forward = true
      comandos.push({ commandType: 'whatsapp.reply', payload })
      return 'success'
    }

    // MOSTRAR OS METADADOS da mensagem — o que de fato chegou.
    //
    // Por que isto existe: quem escreve um comando com botão, citação ou
    // carrossel está montando contra uma caixa fechada. Eu mesmo só descobri
    // que faltava a quarta forma de resposta de botão depois de o toque não
    // fazer nada e eu ir olhar o banco. Quem aluga o sistema não tem banco nem
    // terminal — para essa pessoa, não havia como olhar.
    //
    // O QUE ELE MOSTRA é exatamente o que o comando consegue LER: o mesmo
    // objeto que o interpolador recebe. Não é um despejo do nó cru do
    // WhatsApp, e isso não é limitação, são duas razões:
    //   1. O nó cru carrega `mediaKey` e `directPath`. Mandá-lo para a
    //      conversa publicaria a capacidade de baixar a mídia de alguém — é o
    //      que o invariante 4 impede, e ele vale aqui também.
    //   2. Mostrar campo que o comando não consegue escrever ensinaria errado:
    //      a pessoa veria um caminho e escreveria um marcador que fica literal.
    // Então o que aparece aqui é o contrato, não o protocolo.
    case 'action.whatsapp.metadata': {
      const partes = []
      const escrever = (titulo, valor) => {
        if (valor === undefined || valor === null) return
        if (typeof valor === 'object' && !Object.keys(valor).length) return
        partes.push(`*${titulo}*\n${typeof valor === 'object' ? JSON.stringify(valor, null, 2) : valor}`)
      }
      // A própria mensagem primeiro: é dela que o comando saiu.
      escrever('esta mensagem', { id: evento.providerRef?.id, de: evento.sender?.id, conversa: evento.chat?.id })
      escrever('message', contexto.message)
      escrever('quoted', contexto.quoted)
      escrever('media', contexto.media)
      escrever('target', contexto.target)
      const texto = partes.length
        ? partes.join('\n\n')
        : 'Esta mensagem não trouxe metadado nenhum além dela mesma.'
      comandos.push({
        commandType: 'whatsapp.reply',
        payload: {
          chatId: evento.chat.id,
          // Bloco de código: metadado é JSON, e JSON sem fonte monoespaçada
          // vira uma parede ilegível no celular.
          text: `\`\`\`\n${texto}\n\`\`\``,
          ...(referenciaDaPropria(evento) ? { replyTo: referenciaDaPropria(evento) } : {})
        }
      })
      return 'success'
    }

    // Guardar no acervo a mídia que chegou pelo WhatsApp.
    //
    // Mesma fronteira da figurinha: o motor NUNCA vê a mídia. Ele repassa o
    // token opaco que só o gateway que o criou resolve, e diz onde guardar.
    //
    // As duas formas de mandar precisam funcionar, e a segunda é a mais usada:
    // o arquivo COM o comando na legenda, e o comando RESPONDENDO um arquivo já
    // enviado.
    case 'action.acervo.save': {
      const citada = evento.message?.quotedMediaRef
      const mediaRef = evento.message?.mediaRef || citada?.token
      if (!mediaRef) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto), replyTo: referenciaDoLink(evento) }
          })
        }
        return 'success'
      }
      comandos.push({
        commandType: 'acervo.save',
        payload: {
          chatId: evento.chat.id,
          mediaRef,
          sourceKind: evento.message?.mediaRef ? evento.message.kind : (citada?.mediaKind || null),
          replyTo: referenciaDoLink(evento),
          ...(no.config?.folder ? { pasta: interpolar(no.config.folder, contexto) } : {}),
          ...(no.config?.name ? { nome: interpolar(no.config.name, contexto) } : {}),
          ...(no.config?.description ? { descricao: interpolar(no.config.description, contexto) } : {}),
          ...(no.config?.okText ? { okText: no.config.okText } : {}),
          ...(no.config?.errorText ? { errorText: no.config.errorText } : {})
        }
      })
      return 'success'
    }

    case 'action.media.download': {
      // O motor NÃO fala com a rede. Ele resolve a URL, decide qual mensagem
      // marcar na resposta, e passa isso ao gateway — que é quem chama o
      // serviço, espera o trabalho terminar e envia os bytes. Mesma fronteira
      // do recover e da figurinha: aqui não entra nem byte nem requisição.
      // Placeholder que não resolveu é APAGADO antes de procurar o link, em vez
      // de invalidar o campo inteiro. É o que permite um comando aceitar as duas
      // formas — "{{quoted.link}} {{message.link}}" funciona marcando uma
      // mensagem OU colando o link junto do comando, e o que sobra é o que
      // existir. Sem isso a pessoa teria que escolher uma das duas na instalação.
      //
      // Apagar importa porque "{{quoted.link}}" PARECE um link: `.link` é um
      // domínio de verdade, e o detector cairia nele.
      const bruta = interpolar(no.config?.url || '', contexto).replace(/\{\{[^}]*\}\}/g, ' ').trim()
      const url = primeiroLink(bruta)

      if (!url) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto), replyTo: referenciaDoLink(evento) }
          })
        }
        return 'success'
      }

      comandos.push({
        commandType: 'media.download',
        payload: {
          chatId: evento.chat.id,
          url,
          modo: no.config?.modo || null,
          // Como entregar quando o post tem VÁRIAS mídias.
          //
          // O PADRÃO TEM QUE ESTAR NUM LUGAR SÓ. Ele estava em dois: aqui e na
          // entrega, do lado do gateway. Quando o carrossel virou o padrão, eu
          // troquei lá e esqueci daqui — e como este lado SEMPRE preenche o
          // campo, o gateway nunca via "não pediu nada" e o carrossel nunca
          // acontecia. O log dizia `pedido=album` para um comando que não
          // pedia álbum nenhum.
          //
          // Agora quem não escolhe não manda nada, e o padrão existe só onde a
          // entrega acontece.
          ...(no.config?.delivery ? { entrega: no.config.delivery } : {}),
          // Qual mensagem a resposta marca: a citada (padrão, certo para o
          // download de link) ou a de quem pediu (certo quando o pedido se
          // basta — nome digitado, botão tocado).
          replyTo: no.config?.quoteFrom === 'mensagem' ? referenciaDaPropria(evento) : referenciaDoLink(evento),
          ...(no.config?.ackText ? { ackText: interpolar(no.config.ackText, contexto) } : {}),
          ...(no.config?.caption ? { caption: interpolar(no.config.caption, contexto) } : {}),
          ...(no.config?.errorText ? { errorText: no.config.errorText } : {})
        }
      })
      return 'success'
    }

    // Chamar uma FUNÇÃO declarada numa conexão.
    //
    // A fronteira é a mesma do download: o motor NÃO fala com a rede. Ele
    // resolve as entradas, diz qual conexão e qual função, e passa adiante. Quem
    // monta a requisição, aplica a autenticação e espera a resposta é o gateway.
    //
    // E é por isso que isto funciona agora, enquanto o `action.http` continuou
    // parado: aquele foi desenhado como chamada SÍNCRONA no meio do fluxo, e o
    // gateway desiste de esperar o motor em 1,5 s. Uma função declarada encerra
    // a cadeia — vira comando terminal, e o gateway leva o tempo que precisar.
    case 'action.connection.call': {
      const entradas = {}
      for (const [nome, valor] of Object.entries(no.config?.inputs || {})) {
        // Placeholder que não resolveu é APAGADO, não deixado no texto: é o que
        // permite uma entrada aceitar as duas formas ("{{quoted.link}}
        // {{message.link}}" funciona marcando uma mensagem OU colando o link).
        // Deixar "{{quoted.link}}" viajar para o serviço mandaria lixo.
        const bruto = interpolar(String(valor ?? ''), contexto).replace(/\{\{[^}]*\}\}/g, ' ').trim()
        if (bruto) entradas[nome] = bruto
      }

      // A mídia da mensagem, quando a função declara receber arquivo.
      //
      // O token NÃO passa pelo mapa de entradas: ali tudo é interpolado, e
      // token de mídia no interpolador é o que o invariante 4 proíbe. Ele viaja
      // num campo próprio do comando, exatamente como na figurinha.
      //
      // As duas origens, as mesmas da figurinha e as duas necessárias: a mídia
      // mandada COM o comando na legenda, e o comando RESPONDENDO uma mídia.
      const citadaDeMidia = evento.message?.quotedMediaRef
      // De ONDE vem cada arquivo, por origem declarada:
      //
      //   mensagem (padrão) — a da mensagem e, não havendo, a da citada
      //   citada            — só a da citada
      //   resultado         — o que a chamada anterior devolveu, e ele só
      //                       existe numa retomada: o token chega no contexto,
      //                       não no evento
      //
      // As duas primeiras existem porque a mensagem de um comando carrega DUAS
      // mídias — a que ela responde e a anexada —, e a função que recebe duas
      // fotos precisa de um jeito de dizer qual é qual.
      const tokenDaOrigem = (origem) => {
        if (origem === 'resultado') return contexto.__resultado?.token || null
        if (origem === 'citada') return citadaDeMidia?.token || null
        if (origem === 'anexada') return evento.message?.mediaRef || null
        return evento.message?.mediaRef || citadaDeMidia?.token || null
      }
      const tipoDaOrigem = (origem, token) => {
        if (origem === 'resultado') return contexto.__resultado?.tipo || null
        if (origem === 'citada') return citadaDeMidia?.mediaKind || null
        if (token && token === evento.message?.mediaRef) return evento.message.kind
        return citadaDeMidia?.mediaKind || null
      }
      const refDeMidia = no.config?.mediaInput ? tokenDaOrigem(no.config?.mediaFrom) : null
      // O SEGUNDO arquivo. "mensagem" aqui é a ANEXADA e só ela: com o primeiro
      // vindo da citada, deixar o segundo cair na citada faria os dois campos
      // receberem a mesma foto — e a troca de fundo devolveria a pessoa colada
      // nela mesma, sem nada avisando.
      const ref2 = no.config?.mediaInput2
        ? tokenDaOrigem(no.config?.mediaFrom2 === 'citada' ? 'citada' : 'anexada')
        : null

      // Falta o que a função precisa — e "falta" tem duas formas. Sem nenhuma
      // entrada (o caso comum: nenhum link por perto), ou pedindo arquivo e não
      // havendo arquivo. A segunda não podia cair no teste da primeira: um
      // comando que manda `tamanho: 512` junto tem entrada, e chamaria o
      // serviço sem o arquivo que é o assunto da chamada.
      // Falta arquivo quando o comando nomeia um e ele não veio — e isso vale
      // para os DOIS. Chamar a troca de fundo com uma foto só faria o serviço
      // recusar com uma mensagem que não aponta para cá.
      const faltaArquivo = (!!no.config?.mediaInput && !refDeMidia) || (!!no.config?.mediaInput2 && !ref2)
      // "Nenhuma entrada resolveu" só é falta quando NÃO há arquivo. Uma função
      // que recebe só o arquivo — virar figurinha em imagem, trocar o pacote de
      // uma figurinha — não tem entrada de texto nenhuma, e tratar isso como
      // falta fazia o comando responder "manda o arquivo" com o arquivo na mão.
      const semNada = !Object.keys(entradas).length && !refDeMidia
      if ((faltaArquivo || semNada) && no.config?.notFoundText) {
        comandos.push({
          commandType: 'whatsapp.reply',
          payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto), replyTo: referenciaDoLink(evento) }
        })
        return 'success'
      }
      // Sem arquivo e sem texto de falta, não se chama o serviço: ele receberia
      // um pedido sem o conteúdo e recusaria com uma mensagem que não aponta
      // para cá. Fica registrado como erro, com o motivo.
      if (faltaArquivo) {
        throw new ErroDeFluxo(`A função "${no.config.function}" recebe arquivo, e não havia mídia nem na mensagem nem na citada.`)
      }

      comandos.push({
        commandType: 'connection.call',
        payload: {
          chatId: evento.chat.id,
          conexao: no.config.connectionRef,
          funcao: no.config.function,
          // O que a FUNÇÃO recebe fica separado de como a resposta é
          // APRESENTADA: um é contrato com o serviço, o outro é conversa.
          entradas,
          ...(refDeMidia ? {
            mediaInput: no.config.mediaInput,
            mediaRef: refDeMidia,
            sourceKind: tipoDaOrigem(no.config?.mediaFrom, refDeMidia)
          } : {}),
          ...(ref2 ? {
            mediaInput2: no.config.mediaInput2,
            mediaRef2: ref2,
            sourceKind2: tipoDaOrigem(no.config?.mediaFrom2 === 'citada' ? 'citada' : 'anexada', ref2)
          } : {}),
          // CANO: tem passo depois, então o gateway NÃO entrega — ele devolve
          // o resultado e o motor retoma daqui. Sem esta marca os dois passos
          // sairiam ao mesmo tempo, cada um pegando a mídia da mensagem: a
          // sequência compila hoje e faz a coisa errada em silêncio.
          ...(temSucessor ? { encadeado: true, retomarDe: no.id } : {}),
          // Quem não escolheu não manda nada: o padrão vive só na entrega.
          ...(no.config?.delivery ? { entrega: no.config.delivery } : {}),
          // Qual mensagem a resposta marca: a citada (padrão, certo para o
          // download de link) ou a de quem pediu (certo quando o pedido se
          // basta — nome digitado, botão tocado).
          replyTo: no.config?.quoteFrom === 'mensagem' ? referenciaDaPropria(evento) : referenciaDoLink(evento),
          ...(no.config?.ackText ? { ackText: interpolar(no.config.ackText, contexto) } : {}),
          ...(no.config?.caption ? { caption: interpolar(no.config.caption, contexto) } : {}),
          ...(no.config?.errorText ? { errorText: no.config.errorText } : {})
        }
      })
      // O FLUXO DORME AQUI quando há passo depois.
      //
      // Sem isto o caminhador seguia na hora para o nó seguinte, e os dois
      // comandos saíam juntos — cada um pegando a mídia da mensagem. O
      // segundo nem chegava a funcionar: ele espera o arquivo do primeiro, que
      // ainda não existe. Nenhuma aresta casa com "dormindo", então a
      // caminhada para; quem continua é a retomada, quando o resultado chega.
      return temSucessor ? 'dormindo' : 'success'
    }

    case 'action.whatsapp.recover': {
      // O comando que deu origem ao projeto. O motor decide COM BASE NUM TOKEN
      // e num tipo — nunca recebe a mídia da visu única, que continua só na
      // memória do gateway.
      //
      // Duas origens de mídia, e as duas são necessárias:
      //   - a visu única CITADA, que é o /recover clássico
      //   - a visu única da PRÓPRIA mensagem, que é o que torna possível o
      //     recover automático: a mídia chega e é recuperada sem ninguém
      //     digitar nada.
      const citada = evento.message?.quotedMediaRef
      const propria = evento.message?.kind === 'view_once' && evento.message?.mediaRef
        ? { token: evento.message.mediaRef, kind: 'view_once', mediaKind: evento.message.mediaKind }
        : null

      const avisar = () => {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
        }
        return 'success'
      }

      // Exige visualização única EXPLICITAMENTE. A citação passou a carregar
      // também mídia comum (é o que faz a figurinha funcionar respondendo uma
      // foto), e recuperar uma foto que todo mundo ainda vê não é recuperar
      // nada — o /recover existe para o que sumiu depois de aberto.
      const fonte = propria || (citada?.kind === 'view_once' ? citada : null)
      if (!fonte?.token) return avisar()

      const destino = no.config?.destination || 'saved_messages'
      // 'saved_messages' vira null aqui de propósito: só o gateway sabe qual é
      // o JID da própria conta, e inventar isso no motor daria destino errado
      // quando o mesmo documento roda em números diferentes.
      let chatDestino = null
      let destinoFinal = destino
      if (destino === 'same_chat') {
        chatDestino = evento.chat.id
      } else if (destino === 'fixed' || destino === 'configured') {
        chatDestino = resolverDestinoConfigurado(no.config?.destinationId, contexto)
        if (!chatDestino) {
          // A diferença entre os dois é o que significa "não resolveu":
          //   'fixed'      — alguém escreveu um destino e ele não vale: é erro
          //                  de configuração, e avisar é o certo.
          //   'configured' — ninguém configurou AINDA, o que é o estado normal
          //                  de quem acabou de instalar. Cai para as mensagens
          //                  salvas em vez de recusar: o comando funciona no
          //                  primeiro uso, e configurar depois só muda o destino.
          if (destino === 'fixed') return avisar()
          destinoFinal = 'saved_messages'
        }
      }

      comandos.push({
        commandType: 'whatsapp.recover',
        payload: {
          chatId: evento.chat.id,
          destination: destinoFinal,
          destinationId: chatDestino,
          mediaRef: fonte.token,
          mediaKind: fonte.mediaKind,
          ...(typeof no.config?.caption === 'string' && no.config.caption
            ? { caption: interpolar(no.config.caption, contexto) }
            : {})
        }
      })
      return 'success'
    }

    case 'action.whatsapp.sendFile': {
      // O motor NÃO confere se o arquivo existe: ele não enxerga o acervo, que
      // vive do lado do gateway. Manda o id e o gateway resolve — se sumiu, o
      // comando falha com motivo, e o notFoundText (se houver) avisa a pessoa.
      comandos.push({
        commandType: 'whatsapp.sendFile',
        payload: {
          chatId: evento.chat.id,
          // Por id OU por caminho. O id é estável; o caminho é o que a pessoa
          // escreve. O motor só repassa — quem enxerga o acervo é o gateway.
          ...(no.config.fileId ? { fileId: no.config.fileId } : {}),
          ...(no.config.path ? { caminho: interpolar(no.config.path, contexto) } : {}),
          // Uma PASTA inteira: é assim que um comando monta o próprio conjunto
          // — um carrossel de fotos, um pacote. A entrega só viaja quando o
          // comando escolheu; o padrão vive num lugar só, do lado que entrega.
          ...(no.config.folder ? { pasta: interpolar(no.config.folder, contexto) } : {}),
          ...(no.config.delivery ? { entrega: no.config.delivery } : {}),
          ...(no.config.caption ? { caption: interpolar(no.config.caption, contexto) } : {}),
          ...(no.config.notFoundText ? { notFoundText: interpolar(no.config.notFoundText, contexto) } : {})
        }
      })
      return 'success'
    }

    case 'action.whatsapp.rich': {
      // Formatação rica (código colorido, LaTeX). CAMINHO NÃO OFICIAL: ver o
      // comentário em gatewayExecutor.js — a mensagem precisa viajar marcada
      // como conteúdo da Meta AI para o app renderizar. O fallback em texto
      // é obrigatório, não opcional, porque isto pode parar de funcionar
      // sem aviso do dia para a noite.
      const texto = interpolar(no.config.text, contexto)
      comandos.push({
        commandType: 'whatsapp.rich',
        payload: {
          chatId: evento.chat.id,
          text: texto,
          richKind: no.config.richKind || 'code',
          language: no.config.language || 'javascript',
          fallbackText: no.config.fallbackText ? interpolar(no.config.fallbackText, contexto) : texto
        }
      })
      return 'success'
    }

    case 'action.whatsapp.delete': {
      // Apagar a mensagem que acionou o gatilho. Precisa da chave original,
      // que o gateway já mandou em providerRef — o motor só repassa, não
      // remonta endereço de mensagem por conta própria.
      if (!evento.providerRef?.id) {
        throw new ErroDeFluxo('Sem a referência da mensagem original não dá para apagá-la.')
      }
      comandos.push({
        commandType: 'whatsapp.delete',
        payload: { chatId: evento.chat.id, messageRef: evento.providerRef }
      })
      return 'success'
    }

    case 'action.group.remove': {
      // Remover alguém do grupo é a ação mais destrutiva do catálogo e não tem
      // desfazer. Três travas, todas aqui e não configuráveis para menos:
      // só em grupo, nunca sem alvo resolvido, e (por padrão) nunca um dono.
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para remover participante dentro de um grupo.')
      }
      const quem = no.config?.who === 'target' ? resolverAlvo(evento) : evento.sender?.id
      if (!quem) {
        // "/ban" sem marcar ninguém é o erro de uso mais comum deste comando, e
        // sem texto de falta ele terminava em SILÊNCIO no WhatsApp: a execução
        // virava `error` numa aba que quem digitou não abre. Mesma forma das
        // outras ações do catálogo ("sem mídia", "sem arquivo") — quem declarar
        // o aviso recebe resposta; quem não declarar continua caindo no erro
        // registrado, que é o comportamento de antes.
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há quem remover: o comando não indicou ninguém.')
      }
      if (no.config?.neverRemoveOwner !== false && ehDono(db, quem)) {
        // Silencioso de propósito: uma regra automática tentando remover o
        // dono é engano de configuração, não motivo para derrubar a execução.
        return 'success'
      }
      comandos.push({
        commandType: 'group.remove',
        payload: { chatId: evento.chat.id, participantId: quem }
      })
      return 'success'
    }

    case 'action.menu.config': {
      // Configura o menu DESTA conversa pelo próprio WhatsApp. O valor vem do
      // que a pessoa escreveu depois do comando. Restrição de quem pode fazer
      // isso é do GATILHO (requireOwner), não daqui — assim a mesma ação serve
      // para um dono, e futuramente para um admin de grupo.
      const argumento = (contexto.message?.args || '').trim()
      const campo = no.config?.field || 'header'

      if (!argumento) {
        comandos.push({
          commandType: 'whatsapp.reply',
          payload: { chatId: evento.chat.id, text: no.config?.usageText || 'Escreva o texto novo depois do comando.' }
        })
        return 'success'
      }

      const alvo = evento.chat.kind === 'group'
        ? { scopeKind: 'group', scopeId: evento.chat.id, key: CHAVE_MENU }
        : { scopeKind: 'contact', scopeId: evento.chat.id, key: CHAVE_MENU }

      if (campo === 'format' && !FORMATOS_DE_MENU.includes(argumento)) {
        comandos.push({
          commandType: 'whatsapp.reply',
          payload: { chatId: evento.chat.id, text: `Formato inválido. Use ${FORMATOS_DE_MENU.join(' ou ')}.` }
        })
        return 'success'
      }

      // Preserva o que já estava configurado: mudar o cabeçalho não pode
      // apagar o rodapé que alguém configurou antes.
      const atual = lerConfigDeMenu(db, alvo)
      gravarConfigDeMenu(db, alvo, { ...atual, [campo]: argumento })

      comandos.push({
        commandType: 'whatsapp.reply',
        payload: { chatId: evento.chat.id, text: (no.config?.confirmText || 'Menu atualizado.') }
      })
      return 'success'
    }

    case 'action.menu.render': {
      const menu = renderizarMenu(db, no, evento)
      // Formato interativo vira um comando próprio, com os itens
      // ESTRUTURADOS: o gateway é quem sabe montar a mensagem de botões do
      // WhatsApp, e cai para texto sozinho se o envio interativo falhar —
      // mensagem com botão depende de suporte do app de quem recebe, então
      // nunca pode ser um caminho sem saída.
      if (menu.config.format === 'interactive' && menu.itens.length) {
        comandos.push({
          commandType: 'whatsapp.menu',
          payload: {
            chatId: evento.chat.id,
            title: menu.config.buttonTitle,
            header: menu.config.header,
            footer: menu.config.footer,
            fallbackText: menu.texto,
            items: menu.itens.map((item) => ({ id: item.label, label: item.label, description: item.description || '' }))
          }
        })
        return 'success'
      }
      comandos.push({
        commandType: 'whatsapp.reply',
        payload: { chatId: evento.chat.id, text: menu.texto }
      })
      return 'success'
    }

    case 'action.variable.set': {
      // Vira ErroDeFluxo: status 'error' visível na aba Execuções, com o motivo.
      // Ignorar em silêncio seria pior — quem escreveu a automação ficaria
      // procurando por que a variável "não grava".
      if (ehChaveReservada(no.config.key)) throw new ErroDeFluxo(motivoDeRecusa(no.config.key))
      const alvo = resolverEscopo(no.config.scope, evento, { categoryKey: no.config.categoryKey })
      // Escopo que não existe neste evento (ex: group_member numa conversa
      // direta) é ignorado, não é erro: a mesma automação pode valer nos dois
      // lugares e só ter o contador de membro fazendo sentido em grupo.
      if (alvo) {
        const valor = interpolar(no.config.value, contexto)
        gravarAtributo(db, alvo, no.config.key, valor)
        aplicarNasVariaveis(contexto.var, no.config.scope, no.config.key, valor, { categoryKey: no.config.categoryKey })
      }
      return 'success'
    }

    case 'action.variable.increment': {
      if (ehChaveReservada(no.config.key)) throw new ErroDeFluxo(motivoDeRecusa(no.config.key))
      const alvo = resolverEscopo(no.config.scope, evento, { categoryKey: no.config.categoryKey })
      if (alvo) {
        const novo = incrementarAtributo(db, alvo, no.config.key, no.config.by)
        aplicarNasVariaveis(contexto.var, no.config.scope, no.config.key, novo, { categoryKey: no.config.categoryKey })
      }
      return 'success'
    }

    case 'condition.compare': {
      const esquerda = resolverOperando(db, no.config.left, evento, contexto)
      const direita = resolverOperando(db, no.config.right, evento, contexto)
      return compararValores(esquerda, no.config.operator, direita) ? 'true' : 'false'
    }

    default:
      // Nó que o schema aceita mas o runtime não executa nunca deveria chegar
      // aqui — o publish barra isso. Se chegou, o documento é inconsistente
      // com o runtime e a execução para com erro, nunca segue pela metade.
      throw new ErroDeFluxo(`Nó "${no.type}" não é executável pelo motor.`)
  }
}

// Interpretador de caminho: anda o grafo a partir da aresta "matched" do
// gatilho, seguindo a saída que cada nó devolve. Substituiu a antiga coleta
// linear, que só conhecia "success" e encerrava em SILÊNCIO ao revisitar um
// nó — com ramificação, silêncio viraria execução pela metade sem ninguém saber.
function executarFluxo (db, documento, triggerId, evento, retomada = null) {
  const nodesPorId = new Map(documento.flow.nodes.map((n) => [n.id, n]))
  const gatilho = nodesPorId.get(triggerId)
  const comandos = []
  const alvo = resolverAlvo(evento)

  // O PORTÃO: sem o que a automação precisa, o fluxo não roda.
  //
  // Antes cada ação se defendia sozinha com o próprio `notFoundText`, e quem
  // esquecesse ficava com um comando que casava, não fazia nada e não dizia
  // nada — o pior desfecho, porque nem dá para saber se funcionou.
  const exigido = resolverExigencia(evento, documento.inputPolicy?.requires)
  if (exigido.precisa && !exigido.ok) {
    const aviso = documento.inputPolicy.requires.missingText
    if (aviso) {
      comandos.push({
        commandType: 'whatsapp.reply',
        payload: { chatId: evento.chat.id, text: aviso, replyTo: referenciaDoLink(evento) }
      })
    }
    return comandos
  }
  const contexto = {
    // A FRONTEIRA DO QUE É LEGÍVEL É ESTE OBJETO.
    //
    // Não existe mais lista de campos permitidos no interpolador: o que está
    // aqui dá para escrever num comando, o que não está, não. Então o que não
    // pode ser lido tem que sair AQUI — e o que sai é token de mídia, que é
    // capacidade, não informação. O tipo e a legenda da mídia continuam
    // disponíveis, em `media.*`, porque são dados e não segredo.
    message: semTokens({
      ...evento.message,
      args: extrairArgumentos(evento.message?.text, gatilho?.config?.command),
      // O primeiro link da própria mensagem — é o que o download automático usa,
      // já que ali ninguém digitou comando nenhum.
      ...(primeiroLink(evento.message?.text) ? { link: primeiroLink(evento.message.text) } : {})
    }),
    // As partes do que a pessoa escreveu depois do comando, com os nomes que o
    // gatilho declarou. A divisão acontece AQUI, uma vez, a partir da
    // declaração — nunca dentro de um texto interpolado.
    //
    // A última parte leva o resto: "/rename Pacote / do / Zé" com dois nomes
    // dá pacote="Pacote" e autor="do / Zé". Cortar no primeiro separador
    // descartaria texto sem avisar.
    //
    // Parte que não veio fica AUSENTE, e o marcador aparece literal na
    // resposta. É o sinal de erro desta base: melhor a pessoa ver
    // "{{argumentos.autor}}" do que receber um pacote com autor vazio.
    ...(gatilho?.config?.args?.names?.length
      ? { argumentos: dividirArgumentos(extrairArgumentos(evento.message?.text, gatilho?.config?.command), gatilho.config.args) }
      : {}),
    // isOwner entra como campo do remetente (e não como variável de usuário)
    // porque é uma propriedade do evento, não algo que a automação grava.
    sender: { ...evento.sender, isOwner: ehDono(db, evento.sender?.id), number: soDigitos(evento.sender?.id) },
    chat: { ...evento.chat, number: soDigitos(evento.chat?.id) },
    // Sem menção nem citação não existe alvo — o ramo fica vazio e
    // {{target.id}} permanece literal no texto, sinalizando o erro de uso em
    // vez de mandar uma mensagem com um buraco no meio.
    target: alvo ? { id: alvo, number: soDigitos(alvo) } : {},
    // Quem escreveu a mensagem RESPONDIDA. `target` prefere a menção quando
    // existem as duas; aqui é sempre o autor da citação, que é o que um
    // comando tipo "/apagar" respondendo alguém precisa saber.
    quoted: montarCitacao(evento),
    // A mídia em jogo: a da própria mensagem, ou a da mensagem citada. É o que
    // permite uma resposta se explicar ("recuperei um áudio de fulano") sem o
    // motor nunca tocar nos bytes — tipo e legenda não são segredo de mídia.
    media: dadosDaMidiaEmJogo(evento),
    // O número da própria conta e se ela é admin do grupo. Vem preenchido pelo
    // gateway (accountId NÃO serve: é o id da instância, um UUID). Ausente
    // quando o gateway não soube dizer — placeholder fica literal.
    bot: evento.bot || {},
    now: valoresDeAgora(),
    // O que a automação DECLAROU precisar, já resolvido. É isto que a ação lê
    // como `url: o link` — o algoritmo de procura saiu da string e virou
    // declaração no cabeçalho.
    //
    // Só o link entra aqui. Token de mídia é capacidade, não informação, e o
    // invariante 4 proíbe que ele chegue ao interpolador.
    ...(exigido.link ? { precisa: { link: exigido.link } } : {}),
    var: carregarVariaveis(db, evento)
  }

  const visitados = new Set()
  // O publish já rejeita ciclo, então o limite é rede de segurança contra
  // documento adulterado direto no banco ou revisão antiga de antes da regra.
  const limitePassos = documento.flow.nodes.length
  // RETOMADA: o fluxo parou numa chamada que foi dormir, e o resultado dela
  // chegou. Continua da aresta que sai daquele nó, com o resultado no
  // contexto. O nó já executado entra em `visitados` para a trava de "duas
  // vezes" continuar valendo através da retomada.
  let edge
  if (retomada) {
    visitados.add(retomada.nodeId)
    contexto.__resultado = retomada.resultado || null
    // Só o que é INFORMAÇÃO entra no que dá para escrever num texto. O token
    // do arquivo fica fora, como todo token — invariante 4 não muda porque a
    // mídia agora vem de uma chamada em vez da conversa.
    const r = retomada.resultado || {}
    contexto.resultado = {
      ...(r.tipo ? { tipo: r.tipo } : {}),
      ...(r.mime ? { mime: r.mime } : {}),
      ...(typeof r.texto === 'string' ? { texto: r.texto } : {})
    }
    edge = documento.flow.edges.find((e) => e.from === retomada.nodeId && e.on === 'success')
  } else {
    edge = documento.flow.edges.find((e) => e.from === triggerId && e.on === 'matched')
  }
  let passos = 0

  while (edge) {
    if (++passos > limitePassos) throw new ErroDeFluxo('O fluxo passou do limite de passos — provável ciclo.')
    const no = nodesPorId.get(edge.to)
    if (!no) throw new ErroDeFluxo(`A aresta aponta para um nó inexistente: "${edge.to}".`)
    if (visitados.has(no.id)) throw new ErroDeFluxo(`O nó "${no.id}" seria executado duas vezes.`)
    visitados.add(no.id)

    const temSucessor = documento.flow.edges.some((e) => e.from === no.id && e.on === 'success')
    const saida = executarNo(db, no, evento, contexto, comandos, temSucessor)
    edge = documento.flow.edges.find((e) => e.from === no.id && e.on === saida)
  }

  return comandos
}

function inserirEvento (db, evento) {
  const jaExiste = db.prepare('SELECT 1 FROM inbound_events WHERE id = ?').get(evento.eventId)
  if (jaExiste) return false
  db.prepare(`INSERT INTO inbound_events
    (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      evento.eventId, evento.accountId, evento.chat.id, evento.chat.kind, evento.sender.id,
      evento.message.kind, evento.message.text ?? null, evento.replay ? 1 : 0,
      JSON.stringify(evento), new Date().toISOString()
    )
  return true
}

function candidatosPublicados (db) {
  return db.prepare(`
    SELECT a.id AS automation_id, a.deployment_mode, a.native, r.id AS revision_id, r.doc_json
    FROM automations a
    JOIN automation_revisions r ON r.id = a.active_revision_id
    WHERE a.enabled = 1 AND a.active_revision_id IS NOT NULL
  `).all()
}

// Automações do próprio sistema (hoje só /menu, ver nativeAutomations.js)
// pulam a checagem de escopo — a regra "scope.include vazio nunca casa
// com tudo" existe pra conteúdo AUTORADO PELO USUÁRIO, nunca foi pensada
// pra um comando nativo que precisa funcionar em qualquer chat.
function passaEscopoPara (db, candidato, refs, chat) {
  if (candidato.native) return true
  return escopoCasa(db, refs, chat)
}

// Lista as automações (não-nativas, publicadas, ao vivo, habilitadas)
// visíveis no chat do evento — base do /menu nativo. Reusa exatamente a
// mesma semântica de escopo (`escopoCasa`) que o avaliador já aplica pra
// decidir se uma automação "roda" ali.
function automacoesVisiveisEm (db, chatDoEvento) {
  const linhas = db.prepare(`
    SELECT a.active_revision_id, r.doc_json
    FROM automations a
    JOIN automation_revisions r ON r.id = a.active_revision_id
    WHERE a.enabled = 1 AND a.active_revision_id IS NOT NULL
      AND a.native = 0 AND a.deployment_mode = 'live'
  `).all()

  const obterRefs = db.prepare('SELECT direction, kind, ref_id FROM automation_scopes WHERE automation_revision_id = ?')
  const visiveis = []
  for (const linha of linhas) {
    const documento = jsonOuNull(linha.doc_json)
    if (!documento) continue
    const refs = obterRefs.all(linha.active_revision_id)
    if (!escopoCasa(db, refs, chatDoEvento)) continue
    const trigger = acharTrigger(documento)
    const rotulo = documento.display?.menuLabel || trigger?.config?.command
    // Regra automática (anti-link e afins) não é um comando que alguém digita,
    // então não vira linha no menu — a não ser que quem instalou tenha dado um
    // menuLabel de propósito, o que só faz sentido para anunciar a regra.
    if (!rotulo) continue
    visiveis.push({
      label: rotulo,
      description: documento.display?.menuDescription || null
    })
  }
  return visiveis
}

// Monta o menu daquela conversa. A configuração vem em cascata (config do
// grupo > padrão do tipo > config do nó > padrão do código), então o mesmo
// documento de automação produz menus diferentes em grupos diferentes.
function renderizarMenu (db, acao, evento) {
  const config = resolverConfigDeMenu(db, evento.chat, acao.config)
  const visiveis = automacoesVisiveisEm(db, evento.chat)

  if (!visiveis.length) {
    return { config, itens: [], texto: config.emptyText }
  }

  const linhas = visiveis.map((item) => item.description ? `• ${item.label} — ${item.description}` : `• ${item.label}`)
  const partes = [config.header, ...linhas]
  if (config.footer) partes.push('', config.footer)

  return { config, itens: visiveis, texto: partes.join('\n') }
}

function jaAvaliado (db, eventId, revisionId) {
  return db.prepare('SELECT * FROM automation_runs WHERE event_id = ? AND automation_revision_id = ?').get(eventId, revisionId)
}

function comandosDoRun (db, runId) {
  return db.prepare('SELECT * FROM outbound_commands WHERE run_id = ?').all(runId).map(exporComando)
}

function exporComando (row) {
  return {
    id: row.id,
    runId: row.run_id,
    targetAccountId: row.target_account_id,
    commandType: row.command_type,
    payload: jsonOuNull(row.payload_json),
    status: row.status
  }
}

// Ponto de entrada. Idempotente: reenviar o MESMO evento nunca reavalia nem
// duplica comando — devolve de novo o que já tinha sido decidido da
// primeira vez (achado real do design: rede instável entre gateway e motor
// pode causar retry do POST /events).
export function avaliarEvento (db, evento) {
  if (!evento?.eventId || !evento?.accountId || !evento?.chat?.id || !evento?.message?.kind) {
    throw new ErroHttp(400, 'Evento canônico inválido: faltam campos obrigatórios.')
  }

  const transacao = db.transaction(() => {
    const novo = inserirEvento(db, evento)
    const resultados = []

    // COMANDO PRIMEIRO, regra automática depois — e a ordem aqui é o que
    // sustenta a precedência logo abaixo.
    //
    // O defeito que isto conserta foi medido em produção: "/dow <link>" num
    // grupo com download automático ligado casava com DUAS automações, porque a
    // mensagem é comando E é mensagem com link. O bot baixava o mesmo link duas
    // vezes e respondia duas vezes. O at-most-once não pega isso: ele é por
    // (evento, revisão), e são revisões diferentes — o que faltava era alguém
    // ter dito quem tem precedência.
    const ordenados = [...candidatosPublicados(db)].sort((a, b) => {
      const peso = (c) => {
        const t = acharTrigger(jsonOuNull(c.doc_json))
        if (t?.type !== 'trigger.command') return 2
        // Comando DO DONO antes do comando NATIVO: é o nativo que cede, e para
        // ceder ele precisa ser avaliado depois.
        return c.native ? 1 : 0
      }
      return peso(a) - peso(b)
    })
    let algumComandoCasou = false
    // As palavras de comando que já casaram nesta mensagem, vindas de automação
    // do dono. Serve ao nativo, logo abaixo.
    const palavrasQueCasaram = new Set()

    for (const candidato of ordenados) {
      const existente = novo ? null : jaAvaliado(db, evento.eventId, candidato.revision_id)
      if (existente) {
        resultados.push({
          automationId: candidato.automation_id,
          status: existente.status,
          commands: comandosDoRun(db, existente.id)
        })
        continue
      }

      const documento = jsonOuNull(candidato.doc_json)
      const trigger = documento && acharTrigger(documento)

      // Grupo não autorizado: nem avalia, e nem grava execução.
      //
      // Não gravar é de propósito. Com 166 grupos, registrar "não casou" para
      // cada automação a cada mensagem enche a aba Execuções de ruído e some
      // com o que importa. E o dono pediu que o bot não ficasse lendo conversa
      // de grupo onde ninguém o chamou.
      if (trigger && grupoBloqueado(db, evento, trigger)) continue
      let status = 'no_match'
      let comandosGerados = []
      let detalheErro = null

      // `trigger.config` é lido campo a campo logo abaixo e tem exatamente o
      // mesmo problema da inputPolicy: gatilho sem config derrubava o evento
      // inteiro em vez de só a automação torta.
      const estrutura = documento && trigger
        ? (politicaDeEntrada(documento) && trigger.config && typeof trigger.config === 'object'
            ? { politica: politicaDeEntrada(documento) }
            : null)
        : null

      if (documento && trigger && !estrutura) {
        // Só ESTA automação vira erro; o laço segue para as outras.
        status = 'error'
        detalheErro = { message: 'A revisão publicada está malformada (inputPolicy.acceptedMessageKinds precisa ser uma lista, e o gatilho precisa de config). Republique a automação.' }
      } else if (documento && trigger) {
        const politica = estrutura.politica
        const refs = db.prepare('SELECT direction, kind, ref_id FROM automation_scopes WHERE automation_revision_id = ?').all(candidato.revision_id)
        const passaEscopo = passaEscopoPara(db, candidato, refs, evento.chat)
        const passaHistoria = politica.historyPolicy !== 'live_only' || evento.replay !== true
        const passaTipo = politica.acceptedMessageKinds.includes(evento.message.kind)
        // Comando restrito é o canal de administração pelo WhatsApp, então
        // mensagem do PRÓPRIO número precisa passar mesmo com
        // allowFrom:'external' — é assim que quem está com a conta na mão
        // cadastra o primeiro dono. Para comando comum, a regra de sempre
        // continua valendo (bot não reage a si mesmo).
        const ehAdministrativo = trigger.config.requireOwner === true
        const passaAutor = ehAdministrativo ||
          trigger.config.allowFrom !== 'external' || evento.sender.authoredBySelf !== true
        const ehAutomatico = trigger.type === 'trigger.message'
        // inputPolicy.acceptedMessageKinds continua valendo nos dois casos: é a
        // política de entrada da automação, anterior ao gatilho.
        const passaComando = passaTipo && (ehAutomatico
          ? (barreiraDeGatilhoAutomatico(evento) && eventoCasaGatilhoDeMensagem(evento, trigger.config))
          : textoCasaComando(evento.message.text, trigger.config))
        // Comando restrito a dono: enquanto ninguém foi marcado como dono, a
        // instalação continua aberta (senão nasce trancada e nem dá pra
        // configurar o primeiro dono pelo WhatsApp). Depois do primeiro,
        // vale a lista.
        const passaDono = trigger.config.requireOwner !== true ||
          podeUsarComandoRestrito(db, evento.sender.id, { souEuMesmo: evento.sender.authoredBySelf === true })

        // A mensagem que virou COMANDO já foi endereçada ao bot; regra automática
        // existe para a mensagem que ninguém endereçou a ele. Sem isto, o
        // mesmo link era baixado duas vezes (ver o comentário da ordenação).
        //
        // Configurável, e não travado: auditoria — uma regra que registra tudo
        // que passa — é caso legítimo de querer ver o comando também.
        const cedeAoComando = ehAutomatico && algumComandoCasou &&
          trigger.config.alsoOnCommands !== true

        // O NATIVO CEDE AO COMANDO DO DONO com a mesma palavra.
        //
        // O /menu nativo existe para o /menu funcionar sem ninguém instalar
        // nada. Quando o dono instala o dele, os dois respondiam — duas
        // mensagens de menu para quem digitou uma palavra, sem nada explicando.
        // Medido no sistema do dono, com o nativo e o instalado ligados.
        //
        // Cede por EVENTO, e não por existir: o comando do dono pode estar
        // limitado a um grupo, e ali ele responde; nas outras conversas, onde
        // ele nem casou, o nativo continua sendo o padrão que ele é.
        const palavraDoGatilho = !ehAutomatico && typeof trigger.config.command === 'string'
          ? trigger.config.command.trim().toLowerCase()
          : null
        const cedeAoDono = candidato.native === 1 && palavraDoGatilho && palavrasQueCasaram.has(palavraDoGatilho)

        if (!cedeAoComando && !cedeAoDono && passaEscopo && passaHistoria && passaAutor && passaComando && passaDono) {
          status = candidato.deployment_mode === 'live' ? 'matched_live' : 'matched_shadow'
          // Vale para sombra também: o comando CASOU, e é isso que consome a
          // mensagem. Só ao vivo aqui faria o mesmo evento se comportar
          // diferente conforme o modo de uma automação vizinha.
          if (!ehAutomatico) algumComandoCasou = true
          if (!ehAutomatico && candidato.native !== 1 && palavraDoGatilho) palavrasQueCasaram.add(palavraDoGatilho)
          if (status === 'matched_live') {
            try {
              // Savepoint por automação (transação aninhada do better-sqlite3):
              // se o fluxo falhar no meio, as variáveis que ele já tinha
              // gravado voltam atrás. Sem isso, "incrementou o aviso e só
              // depois quebrou" deixaria o contador adiantado para sempre.
              comandosGerados = db.transaction(() => executarFluxo(db, documento, trigger.id, evento))()
              // Depois do fluxo, e só se ele foi até o fim: o comando do dono
              // que ROLOU num grupo autoriza o bot ali. Antes do fluxo seria
              // pior — um comando que falhou no meio deixaria o grupo aberto.
              autorizarGrupoPeloDono(db, evento, trigger)
            } catch (erro) {
              // Fluxo inconsistente ou contador corrompido não pode derrubar a
              // avaliação das OUTRAS automações do mesmo evento: vira erro
              // registrado nesta, e o laço segue.
              if (!(erro instanceof ErroDeFluxo) && !(erro instanceof ErroDeContador)) throw erro
              status = 'error'
              detalheErro = { message: erro.message }
              comandosGerados = []
            }
          }
        }
      }

      const agora = new Date().toISOString()
      const runResult = db.prepare(`INSERT INTO automation_runs
        (event_id, automation_id, automation_revision_id, deployment_mode, status, detail_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(evento.eventId, candidato.automation_id, candidato.revision_id, candidato.deployment_mode, status,
          detalheErro ? JSON.stringify(detalheErro) : null, agora)

      const inserirComando = db.prepare(`INSERT INTO outbound_commands
        (id, run_id, target_account_id, command_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
      for (const cmd of comandosGerados) {
        inserirComando.run(crypto.randomUUID(), runResult.lastInsertRowid, evento.accountId, cmd.commandType, JSON.stringify(cmd.payload), agora)
      }

      resultados.push({
        automationId: candidato.automation_id,
        status,
        commands: comandosDoRun(db, runResult.lastInsertRowid)
      })
    }

    return resultados
  })

  return { eventId: evento.eventId, results: transacao() }
}

// Fecha comando pendente ANTIGO demais para ainda estar em andamento.
//
// O gateway fecha os órfãos DELE ao conectar, e esse é o caminho normal. Mas
// ele fecha por `accountId`, e reparear um número gera um accountId NOVO — os
// comandos da conta anterior ficam sem ninguém para reivindicá-los, presos em
// `pending` para sempre e invisíveis na aba Execuções.
//
// O corte por idade é largo de propósito: um comando de horas atrás não está
// mais em execução em lugar nenhum, então não há corrida com um gateway vivo.
// Nada é reenviado — só deixa de mentir que ainda está acontecendo.
export function fecharPendentesAntigos (db, { idadeMaximaMs = 24 * 60 * 60 * 1000, agora = Date.now() } = {}) {
  const limite = new Date(agora - idadeMaximaMs).toISOString()
  const resultado = db.prepare(
    `UPDATE outbound_commands SET status = 'outcome_unknown', resolved_at = ?
     WHERE status = 'pending' AND created_at < ?`
  ).run(new Date(agora).toISOString(), limite)
  return resultado.changes
}

// Quantas chamadas uma cadeia pode encadear.
//
// O limite de passos do fluxo não alcança a retomada: cada pedaço é uma
// execução nova, e sem teto próprio um documento torto giraria para sempre, um
// comando de cada vez. Oito é folgado para o que a linguagem escreve e curto o
// bastante para o giro parar.
const LIMITE_DE_ELOS = 8

// O resultado de uma chamada que foi dormir.
//
// Só token e rótulos: o arquivo em si nunca volta ao motor, nem aqui. É o
// mesmo contrato da mídia que chega pela conversa, usado na outra direção —
// o gateway guarda os bytes e devolve a referência opaca.
function resultadoValidado (resultado) {
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) return null
  const limpo = {}
  for (const campo of ['token', 'tipo', 'mime', 'texto']) {
    if (typeof resultado[campo] === 'string' && resultado[campo]) limpo[campo] = resultado[campo]
  }
  return Object.keys(limpo).length ? limpo : null
}

// O fluxo continua de onde parou.
//
// A ideia é do dono: "comandos que ficam aguardando uma resposta ficam
// dormindo até serem respondidos". A fila já existia — o que faltava era a
// confirmação trazer o RESULTADO e o motor saber retomar. Nada de estado novo:
// o evento original está em `inbound_events`, o documento na revisão, e onde
// parar está no próprio comando.
function retomarFluxo (db, comando, resultado) {
  const payload = jsonOuNull(comando.payload_json) || {}
  if (!payload.encadeado || !payload.retomarDe) return
  const run = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(comando.run_id)
  if (!run || run.deployment_mode !== 'live') return

  const elos = db.prepare('SELECT COUNT(*) AS n FROM outbound_commands WHERE run_id = ?').get(run.id)
  if (elos.n >= LIMITE_DE_ELOS) {
    db.prepare('UPDATE automation_runs SET detail_json = ? WHERE id = ?')
      .run(JSON.stringify({ message: `A cadeia passou de ${LIMITE_DE_ELOS} chamadas e foi interrompida.` }), run.id)
    return
  }

  const revisao = db.prepare('SELECT doc_json FROM automation_revisions WHERE id = ?').get(run.automation_revision_id)
  const documento = revisao ? jsonOuNull(revisao.doc_json) : null
  const linhaEvento = db.prepare('SELECT raw_json, account_id FROM inbound_events WHERE id = ?').get(run.event_id)
  const evento = linhaEvento ? jsonOuNull(linhaEvento.raw_json) : null
  if (!documento || !evento) return

  const gatilho = acharTrigger(documento)
  if (!gatilho) return

  let novos = []
  try {
    novos = executarFluxo(db, documento, gatilho.id, evento, { nodeId: payload.retomarDe, resultado })
  } catch (erro) {
    if (!(erro instanceof ErroDeFluxo) && !(erro instanceof ErroDeContador)) throw erro
    db.prepare('UPDATE automation_runs SET status = ?, detail_json = ? WHERE id = ?')
      .run('error', JSON.stringify({ message: erro.message }), run.id)
    return
  }

  // Os comandos novos entram no MESMO run: a aba Execuções mostra a cadeia
  // inteira como uma coisa só, que é o que ela é.
  const agora = new Date().toISOString()
  const inserir = db.prepare(`INSERT INTO outbound_commands
    (id, run_id, target_account_id, command_type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
  for (const cmd of novos) {
    inserir.run(crypto.randomUUID(), run.id, linhaEvento.account_id, cmd.commandType, JSON.stringify(cmd.payload), agora)
  }
}

export function registrarResultadoExecucao (db, commandId, { status, detail, resultado } = {}) {
  if (!['sent', 'failed', 'outcome_unknown'].includes(status)) {
    throw new ErroHttp(400, "status deve ser 'sent', 'failed' ou 'outcome_unknown'.")
  }
  const row = db.prepare('SELECT * FROM outbound_commands WHERE id = ?').get(commandId)
  if (!row) throw new ErroHttp(404, `Comando não encontrado: ${commandId}.`)

  const fechar = db.transaction(() => {
    db.prepare('UPDATE outbound_commands SET status = ?, resolved_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), commandId)
    if (detail !== undefined) {
      db.prepare('UPDATE automation_runs SET detail_json = ? WHERE id = ?').run(JSON.stringify(detail), row.run_id)
    }
    // ACORDA UMA VEZ SÓ. A confirmação pode chegar duas vezes (reenvio,
    // gateway que subiu de novo), e retomar duas vezes faria o passo seguinte
    // acontecer em dobro — mandar a figurinha duas vezes, gravar o arquivo
    // duas vezes. Só a transição de `pending` para `sent` acorda.
    if (row.status === 'pending' && status === 'sent') {
      retomarFluxo(db, row, resultadoValidado(resultado))
    }
  })
  fechar()
  return exporComando(db.prepare('SELECT * FROM outbound_commands WHERE id = ?').get(commandId))
}
