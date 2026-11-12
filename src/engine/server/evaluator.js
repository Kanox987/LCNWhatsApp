// Avaliador de eventos canônicos contra automações publicadas — Etapa 3.5
// do plano. Um único caminho de código serve sombra E ao vivo: a diferença
// é só o que acontece depois de um match (grava "teria executado" vs. gera
// comando executável) — decisão já registrada no plano pra não precisar de
// uma "Etapa 3 modo sombra" separada.
import crypto from 'crypto'
import { ErroHttp } from './transport.js'
import { interpolar, resolverCaminho } from './interpolate.js'
import { calcular, ErroDeCalculo } from './aritmetica.js'
import { ehLinkDeMidia } from '../linkDeMidia.js'
import { valoresDeAgora } from './momento.js'
import { avisoDeDesligado, desligadoNaConversa, familiaDoDocumento } from './familias.js'
import { ehDono, podeUsarComandoRestrito } from './owners.js'
import { adicionarNaLista, estaNaLista, listasDa, membrosDaLista, normalizarNomeDeLista, removerDaLista } from './listas.js'
import { anotarUso, contarUsos, lerJanela, limparUsos } from './registroDeUsos.js'
import { criarServicoDeEnquetes } from './enquetesService.js'
import { ehChaveReservada, motivoDeRecusa } from './chavesReservadas.js'
import { CHAVE_MENU, FORMATOS as FORMATOS_DE_MENU, familiasDoMenu, gravarConfigDeMenu, lerConfigDeMenu, normalizarFamilia, resolverConfigDeMenu } from './menuConfig.js'
import {
  ErroDeContador,
  aplicarNasVariaveis,
  carregarCategoria,
  carregarVariaveis,
  gravarAtributo,
  incrementarAtributo,
  resolverAlvo,
  separarIdMembro,
  resolverEscopo
} from './attributeScopes.js'
import { usosDoArquivo } from './usosDeArquivo.js'

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
//
// DECISÃO 2.5: grupo_ativo VALE para o porteiro.
// Motivo: grupo_ativo representa o consentimento explícito do proprietário para o
// bot atuar no grupo. Permitir que o porteiro execute ações punitivas (como expulsão
// em massa ou avisos) em grupos onde o bot é mero participante passivo (como grupos
// de família, trabalho ou grupos em que foi adicionado sem aviso prévio) seria desastroso.
// O portão decide se o bot EXISTE ali como agente automatizado.
// ATENDIMENTO HUMANO: a conversa foi passada para uma pessoa, e o bot cala.
//
// Vale para QUALQUER conversa, não só grupo — e é essa a diferença para
// `grupo_ativo`, que decide se o bot existe num grupo. Aqui o bot existe e
// está autorizado; ele só não deve responder enquanto alguém de carne e osso
// estiver atendendo. Um cliente perguntando de entrega não pode receber o
// cardápio automático no meio da conversa com o atendente.
//
// A exceção é a MESMA do outro portão, e pela mesma razão: comando restrito ao
// dono continua passando, senão não haveria como devolver a conversa ao bot de
// dentro dela — a única saída seria o painel.
//
// O marcador é um atributo comum da conversa. Quem quiser destravar sem
// comando nenhum apaga a chave na aba Dados, e o bot volta a responder.
export const CHAVE_ATENDIMENTO = 'atendimento_humano'

// Quantas horas um atendimento humano dura sem ninguém devolver a conversa.
//
// A REVISÃO DO CATÁLOGO ELEGEU ESTE O MAIOR GERADOR DE SUPORTE, e por um
// motivo concreto: o atendente digita /atendimento, resolve a dúvida, fecha o
// WhatsApp e ESQUECE de devolver. Horas depois o dono acha que o bot caiu,
// abre chamado urgente — e o sistema está perfeito, só silenciado de
// propósito por esquecimento de gente.
//
// O prazo faz isso se resolver sozinho. Doze horas é mais que um turno e
// menos que um dia: quem está atendendo de verdade não é interrompido, e quem
// esqueceu não descobre no dia seguinte.
const HORAS_DE_ATENDIMENTO_PADRAO = 12
export const CHAVE_PRAZO_ATENDIMENTO = 'atendimento_horas'

function emAtendimentoHumano (db, evento, trigger) {
  if (trigger?.config?.requireOwner === true) return false
  if (!conversaMarcada(db, evento?.chat, CHAVE_ATENDIMENTO)) return false

  // Desde quando. A marca guarda o momento em que o atendimento começou; uma
  // marca antiga, escrita antes deste prazo existir, vale como "sem hora" e
  // continua valendo para sempre — mudar o sentido de dado já gravado seria
  // devolver conversas que alguém silenciou de propósito.
  const inicio = valorDaMarca(db, evento?.chat, CHAVE_ATENDIMENTO)
  const comecouEmMs = typeof inicio === 'string' ? Date.parse(inicio) : NaN
  if (!Number.isFinite(comecouEmMs)) return true

  // Teto no código, não: quem quiser outro prazo grava `atendimento_horas` na
  // conversa, pela aba Dados ou por um comando.
  const horas = Number(valorDaMarca(db, evento?.chat, CHAVE_PRAZO_ATENDIMENTO))
  const limite = Number.isFinite(horas) && horas > 0 ? horas : HORAS_DE_ATENDIMENTO_PADRAO
  return (Date.now() - comecouEmMs) < limite * 3600 * 1000
}

// O valor cru de uma marca da conversa, sem o julgamento de "está ligada".
function valorDaMarca (db, chat, chave) {
  if (!db || !chave || !chat) return null
  const linha = db.prepare(
    'SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?'
  ).get(kindDoEscopo(chat), chat.id, chave)
  if (!linha) return null
  try { return JSON.parse(linha.value_json) } catch { return null }
}

// "Quem pode usar" além do dono: administrador do grupo ou membro de uma lista.
//
// O dono (e o próprio número do bot, como nos comandos de dono) sempre passa (ele mesmo edita as listas, então travá-lo fora só criaria
// um beco). Quem não passa é ignorado em silêncio, como no comando de dono — o
// comando que quiser responder "você não pode" usa a condição no fluxo.
// Sem `isAdmin` no evento (lista do grupo ainda não carregada) ou sem remetente
// identificado, a resposta é não: na dúvida, fechado.
function passaAcessoDoGatilho (db, evento, config) {
  const exigeAdmin = config?.requireAdmin === true
  const lista = typeof config?.requireList === 'string' ? config.requireList : null
  if (!exigeAdmin && !lista) return true
  const quem = evento?.sender?.id
  if (podeUsarComandoRestrito(db, quem, { souEuMesmo: evento?.sender?.authoredBySelf === true && evento?.sender?.authoredByBot !== true })) return true
  if (exigeAdmin && evento?.sender?.isAdmin !== true) return false
  if (lista && !estaNaLista(db, lista, quem)) return false
  return true
}

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
    // Lista de PESSOAS: vale na conversa privada de quem está nela. Em grupo não
    // casa nunca (o grupo não é uma pessoa da lista), lista vazia ou inexistente
    // não casa com ninguém, e exclude vence como nos outros destinos.
    case 'listed': return chat.kind === 'direct' && estaNaLista(db, ref.ref_id, chat.id)
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

// Gatilho do porteiro: casa pela ação ocorrida no grupo (entrou, saiu, etc.).
function eventoCasaGatilhoDeGrupo (evento, config) {
  if (!evento?.group?.action) return false
  const acoes = config?.actions
  if (Array.isArray(acoes) && acoes.length && !acoes.includes(evento.group.action)) {
    return false
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

// QUAL palavra casou — e não só SE casou.
//
// Com atalho, saber apenas que casou não basta: a extração dos argumentos tira
// o prefixo do texto, e tirar "/play" de "/p musica" devolveria lixo. Então o
// casamento passou a devolver a palavra, e quem precisa do booleano chama
// `textoCasaComando`, que é esta mesma função perguntada de outro jeito.
//
// A ordem importa: o comando principal é tentado ANTES dos atalhos. Se alguém
// declarar um atalho igual ao próprio comando, o principal ganha e nada muda.
function comandoQueCasou (texto, config) {
  if (typeof texto !== 'string') return null
  const atalhos = Array.isArray(config?.aliases) ? config.aliases : []
  for (const palavra of [config?.command, ...atalhos]) {
    if (typeof palavra !== 'string' || !palavra) continue
    if (casaUmaPalavra(texto, palavra, config?.match)) return palavra
  }
  return null
}

function textoCasaComando (texto, config) {
  return comandoQueCasou(texto, config) !== null
}

function casaUmaPalavra (texto, comando, match) {
  if (typeof texto !== 'string') return false
  const alvo = texto.trim()
  switch (match) {
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

  if (operador === 'starts_with' || operador === 'not_starts_with') {
    // PREFIXO é pergunta diferente de "contém em algum lugar", e a diferença
    // importa: conferir código de país com `contém` deixa passar um número
    // estrangeiro que tenha o código no meio. Sem valor, é falso nos dois
    // sentidos — igual a `contains` —, porque "não sei" nunca vira "sim".
    const alvo = comoTexto(esquerda)
    const agulha = comoTexto(direita)
    if (alvo === undefined || agulha === undefined) return false
    const achou = alvo.toLowerCase().startsWith(agulha.toLowerCase())
    return operador === 'starts_with' ? achou : !achou
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

// Interpola textos de ações do acervo. Além das variáveis comuns do contexto
// (com ponto, ex: {{sender.name}}), resolve os marcadores de arquivo (sem ponto:
// {{caminho}}, {{id}}, {{nome}}) no avaliador, onde o contexto da ação existe.
function interpolarTextoAcervo (texto, contexto, { caminho, fileId, nome } = {}) {
  if (typeof texto !== 'string' || !texto) return texto
  const resolvido = interpolar(texto, contexto)
  return resolvido
    .replaceAll('{{caminho}}', caminho || '')
    .replaceAll('{{id}}', fileId || '')
    .replaceAll('{{nome}}', nome || caminho || fileId || '')
}

// Executa UM nó e devolve por qual aresta seguir ('success' para ação,
// 'true'/'false' para condição). Só roda no caminho ao vivo — em sombra
// nada aqui é chamado, então nenhum efeito é persistido.
function executarNo (db, no, evento, contexto, comandos, temSucessor = false) {
  switch (no.type) {
    case 'action.whatsapp.reply': {
      const texto = interpolar(no.config.text, contexto)
      const payload = { chatId: evento.chat.id, text: no.config.numbered === true ? numerarLinhas(texto) : texto }
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

    // MANDAR UMA PÁGINA: mensagem com um botão que abre um endereço.
    //
    // O endereço é interpolado como qualquer texto, então ele pode vir do que
    // a pessoa escreveu ou de uma variável — é assim que um comando aponta
    // para a página DAQUELE item. O que ele não pode é ficar em branco: botão
    // sem endereço não faz nada ao ser tocado, e é pior que não ter botão.
    case 'action.whatsapp.webview': {
      const url = interpolar(no.config.url, contexto).trim()
      // Marcador que não resolveu vira endereço literal "{{...}}", que o
      // aplicativo recusa — e a pessoa fica sem entender por que o botão não
      // abre nada. Melhor não mandar o botão e dizer o motivo no histórico.
      if (!url || url.includes('{{')) {
        throw new ErroDeFluxo(`o endereço da página ficou vazio ou não resolveu: "${no.config.url}"`)
      }
      comandos.push({
        commandType: 'whatsapp.webview',
        payload: {
          chatId: evento.chat.id,
          text: interpolar(no.config.text || '', contexto),
          url,
          buttonLabel: interpolar(no.config.buttonLabel || 'Abrir', contexto),
          ...(no.config.footer ? { footer: interpolar(no.config.footer, contexto) } : {}),
          // Dentro do WhatsApp é o padrão; `false` manda para o navegador.
          inApp: no.config.inApp !== false,
          // A forma do botão: `link` (cta_url) ou `janela` (open_webview).
          forma: ['janela', 'diagnóstico'].includes(no.config.forma) ? no.config.forma : 'link',
          ...(referenciaDaPropria(evento) ? { replyTo: referenciaDaPropria(evento) } : {})
        }
      })
      return 'success'
    }

    // BOTÕES DE ESCOLHA declarados no próprio comando.
    //
    // Cada botão é um quick_reply que, ao ser tocado, volta para o bot como uma
    // mensagem de texto comum contendo o `command` (ou o próprio texto do botão).
    // O motor avalia essa resposta contra as automações instaladas como qualquer
    // outra mensagem recebida.
    case 'action.whatsapp.buttons': {
      const texto = interpolar(no.config.text || '', contexto)
      const buttons = (no.config.buttons || []).map((b) => ({
        id: interpolar(b.command || b.id || b.text || '', contexto),
        text: interpolar(b.text || '', contexto)
      }))
      comandos.push({
        commandType: 'whatsapp.buttons',
        payload: {
          chatId: evento.chat.id,
          text: texto,
          buttons,
          ...(no.config.footer ? { footer: interpolar(no.config.footer, contexto) } : {}),
          ...(no.config.fallbackText ? { fallbackText: interpolar(no.config.fallbackText, contexto) } : {}),
          ...(referenciaDaPropria(evento) ? { replyTo: referenciaDaPropria(evento) } : {})
        }
      })
      return 'success'
    }

    // CARROSSEL DE VALORES PRÓPRIOS ou de pasta do acervo.
    //
    // Pode vir de uma lista de cards declarados no próprio comando (com foto,
    // título, corpo e botão) ou de uma pasta do acervo local.
    case 'action.whatsapp.carousel': {
      const texto = no.config.text ? interpolar(no.config.text, contexto) : ''
      const cards = (no.config.cards || []).map((c) => ({
        ...(c.fileId ? { fileId: interpolar(c.fileId, contexto) } : {}),
        ...(c.path ? { path: interpolar(c.path, contexto) } : {}),
        ...(c.title ? { title: interpolar(c.title, contexto) } : {}),
        ...(c.body ? { body: interpolar(c.body, contexto) } : {}),
        ...(c.footer ? { footer: interpolar(c.footer, contexto) } : {}),
        ...(c.buttonText ? { buttonText: interpolar(c.buttonText, contexto) } : {}),
        ...(c.buttonCommand ? { buttonCommand: interpolar(c.buttonCommand, contexto) } : {}),
        ...(c.buttonUrl ? { buttonUrl: interpolar(c.buttonUrl, contexto) } : {})
      }))
      comandos.push({
        commandType: 'whatsapp.carousel',
        payload: {
          chatId: evento.chat.id,
          text: texto,
          ...(no.config.folder ? { folder: interpolar(no.config.folder, contexto) } : {}),
          ...(cards.length ? { cards } : {}),
          ...(no.config.buttonText ? { buttonText: interpolar(no.config.buttonText, contexto) } : {}),
          ...(no.config.buttonCommand ? { buttonCommand: interpolar(no.config.buttonCommand, contexto) } : {}),
          ...(no.config.footer ? { footer: interpolar(no.config.footer, contexto) } : {}),
          ...(no.config.estilo ? { estilo: no.config.estilo } : {}),
          ...(no.config.notFoundText ? { notFoundText: interpolar(no.config.notFoundText, contexto) } : {}),
          ...(no.config.fallbackText ? { fallbackText: interpolar(no.config.fallbackText, contexto) } : {}),
          ...(referenciaDaPropria(evento) ? { replyTo: referenciaDaPropria(evento) } : {})
        }
      })
      return 'success'
    }

    // PACOTE DE FIGURINHAS do acervo.
    //
    // Pode ser entregue de três formas:
    //   - 'pacote': envio nativo via protocolo do WhatsApp (stickerPackMessage)
    //   - 'arquivo': documento no formato .wastickers para abrir em app de terceiro
    //   - 'diagnóstico': envia as duas formas numeradas de uma vez para medição
    case 'action.whatsapp.stickerPack': {
      comandos.push({
        commandType: 'whatsapp.stickerPack',
        payload: {
          chatId: evento.chat.id,
          name: interpolar(no.config?.name || 'Pacote', contexto),
          folder: interpolar(no.config?.folder || '', contexto),
          author: interpolar(no.config?.author || 'LCN', contexto),
          forma: ['arquivo', 'diagnóstico'].includes(no.config?.forma) ? no.config.forma : 'pacote',
          ...(no.config?.caption ? { caption: interpolar(no.config.caption, contexto) } : {}),
          ...(no.config?.notFoundText ? { notFoundText: interpolar(no.config.notFoundText, contexto) } : {}),
          ...(no.config?.fallbackText ? { fallbackText: interpolar(no.config.fallbackText, contexto) } : {}),
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
          // AQUI É `interpolar`, NÃO `interpolarTextoAcervo`, e a diferença
          // importa: no `save` o arquivo ainda NÃO EXISTE. Quem conhece
          // caminho, id e nome definitivos é o gateway, depois de guardar, e é
          // ele que troca {{caminho}}, {{id}} e {{nome}} pelos valores reais
          // (gatewayExecutor.js:1287-1291). `interpolarTextoAcervo` comeria os
          // três aqui, com valor vazio, e o gateway não teria mais o que
          // trocar. `interpolar` resolve as variáveis do evento — que era o
          // defeito, {{sender.name}} chegava literal na conversa — e deixa
          // intacto o marcador que não conhece.
          ...(no.config?.okText ? { okText: interpolar(no.config.okText, contexto) } : {}),
          ...(no.config?.errorText ? { errorText: interpolar(no.config.errorText, contexto) } : {})
        }
      })
      return 'success'
    }

    // APAGAR UM ARQUIVO DO ACERVO.
    //
    // O motor não acessa o disco nem toca em bytes: resolve as variáveis do
    // caminho ou id e despacha o comando para o gateway executar no acervo.
    //
    // AVISO SOBRE QUEM USA: consultamos `usosDoArquivo` antes da emissão.
    // Se automações publicadas dependerem deste arquivo, registramos um aviso
    // em log para o operador — sem bloquear a execução em runtime, porque
    // bloquear um comando legítimo de limpeza seria transformar ajuda em trava.
    case 'action.acervo.delete': {
      const caminho = no.config?.path ? interpolar(no.config.path, contexto) : null
      const fileId = no.config?.fileId ? interpolar(no.config.fileId, contexto) : null
      if (!caminho && !fileId) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto), replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há arquivo indicado para apagar: informe o caminho ou o identificador.')
      }

      if (db) {
        try {
          const linhas = db.prepare(`
            SELECT a.id AS automation_id, r.doc_json
            FROM automations a
            JOIN automation_revisions r ON r.id = a.active_revision_id
            WHERE a.active_revision_id IS NOT NULL
          `).all()
          const automacoes = linhas.map((linha) => {
            let doc = null
            try { doc = JSON.parse(linha.doc_json) } catch {}
            return { id: linha.automation_id, nome: doc?.name || linha.automation_id, documento: doc }
          })
          const usos = usosDoArquivo({ id: fileId, path: caminho }, automacoes)
          if (usos.certos.length > 0) {
            const nomes = usos.certos.map((u) => u.nome).join(', ')
            console.warn(`[engine] Arquivo ${fileId || caminho} sendo apagado por automação, mas usado por: ${nomes}`)
          }
        } catch {}
      }

      comandos.push({
        commandType: 'acervo.delete',
        payload: {
          chatId: evento.chat.id,
          replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento),
          ...(caminho ? { caminho } : {}),
          ...(fileId ? { fileId } : {}),
          ...(no.config?.okText ? { okText: interpolarTextoAcervo(no.config.okText, contexto, { caminho, fileId }) } : {}),
          ...(no.config?.notFoundText ? { notFoundText: interpolarTextoAcervo(no.config.notFoundText, contexto, { caminho, fileId }) } : {}),
          ...(no.config?.errorText ? { errorText: interpolarTextoAcervo(no.config.errorText, contexto, { caminho, fileId }) } : {})
        }
      })
      return 'success'
    }

    // CRIAR UM ARQUIVO DE TEXTO NO ACERVO.
    //
    // Monta o texto a partir das variáveis resolvidas no contexto e encaminha
    // ao gateway. O motor não monta buffers — é o gateway que aloca e grava,
    // garantindo que os limites de memória e a cota do acervo sejam respeitados.
    case 'action.acervo.createText': {
      const texto = typeof no.config?.text === 'string' ? interpolar(no.config.text, contexto) : ''
      if (!texto) {
        if (typeof no.config?.errorText === 'string' && no.config.errorText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolarTextoAcervo(no.config.errorText, contexto).replaceAll('{{erro}}', 'conteúdo vazio'), replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Conteúdo de texto vazio para criar no acervo.')
      }

      const caminho = no.config?.path ? interpolar(no.config.path, contexto) : null
      const nome = no.config?.name ? interpolar(no.config.name, contexto) : null
      const pasta = no.config?.folder ? interpolar(no.config.folder, contexto) : null
      const descricao = no.config?.description ? interpolar(no.config.description, contexto) : null

      comandos.push({
        commandType: 'acervo.createText',
        payload: {
          chatId: evento.chat.id,
          text: texto,
          replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento),
          ...(caminho ? { caminho } : {}),
          ...(nome ? { nome } : {}),
          ...(pasta ? { pasta } : {}),
          ...(descricao ? { descricao } : {}),
          ...(no.config?.okText ? { okText: interpolarTextoAcervo(no.config.okText, contexto, { caminho, nome }) } : {}),
          ...(no.config?.errorText ? { errorText: interpolarTextoAcervo(no.config.errorText, contexto, { caminho, nome }) } : {})
        }
      })
      return 'success'
    }

    // SOBRESCREVER UM ARQUIVO PRESERVANDO O ID.
    //
    // O id é a chave de sobrevivência das automações que já apontam para este
    // arquivo. Pode receber novo texto pelo comando ou nova mídia pelo WhatsApp
    // (anexada ou citada).
    // EDITAR UM ARQUIVO SEM APAGAR O QUE JÁ ESTAVA.
    //
    // `rewrite` troca o conteúdo inteiro; para somar um item ou uma linha o
    // fluxo teria de ler, montar o texto e escrever — e dois comandos ao mesmo
    // tempo perderiam um deles. Aqui o gateway lê, muda e grava numa operação
    // só, sob a trava do acervo. O motor não vê o arquivo, só manda o pedido.
    case 'action.acervo.edit': {
      const caminho = interpolar(no.config?.path || '', contexto).trim()
      const valor = interpolar(no.config?.value ?? '', contexto)
      const responder = (texto) => comandos.push({
        commandType: 'whatsapp.reply',
        payload: { chatId: evento.chat.id, text: texto, replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento) }
      })
      if (!caminho) throw new ErroDeFluxo('Não há arquivo indicado para editar: informe o caminho.')
      if (!String(valor).trim()) {
        if (typeof no.config?.errorText === 'string' && no.config.errorText) {
          responder(interpolar(no.config.errorText, contexto).replaceAll('{{erro}}', 'valor vazio'))
          return 'success'
        }
        throw new ErroDeFluxo('Valor vazio para editar o arquivo do acervo.')
      }
      const texto = (campo) => (typeof no.config?.[campo] === 'string' && no.config[campo] ? { [campo]: interpolar(no.config[campo], contexto) } : {})
      comandos.push({
        commandType: 'acervo.edit',
        payload: {
          chatId: evento.chat.id,
          replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento),
          caminho,
          modo: no.config.mode,
          valor,
          ...(no.config?.asNumber === true ? { comoNumero: true } : {}),
          ...texto('okText'),
          ...texto('unchangedText'),
          ...texto('notFoundText'),
          ...texto('errorText')
        }
      })
      return 'success'
    }

    case 'action.acervo.rewrite': {
      const caminho = no.config?.path ? interpolar(no.config.path, contexto) : null
      const fileId = no.config?.fileId ? interpolar(no.config.fileId, contexto) : null
      if (!caminho && !fileId) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolarTextoAcervo(no.config.notFoundText, contexto, { caminho, fileId }), replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há arquivo indicado para sobrescrever: informe o caminho ou o identificador.')
      }

      const temTexto = typeof no.config?.text === 'string'
      const texto = temTexto ? interpolar(no.config.text, contexto) : null
      const citada = evento.message?.quotedMediaRef
      const mediaRef = temTexto ? null : (evento.message?.mediaRef || citada?.token || null)

      if (!temTexto && !mediaRef) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolarTextoAcervo(no.config.notFoundText, contexto, { caminho, fileId }), replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Nenhum conteúdo fornecido para sobrescrever o arquivo.')
      }

      comandos.push({
        commandType: 'acervo.rewrite',
        payload: {
          chatId: evento.chat.id,
          replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento),
          ...(caminho ? { caminho } : {}),
          ...(fileId ? { fileId } : {}),
          ...(temTexto ? { text: texto } : {}),
          ...(mediaRef ? { mediaRef } : {}),
          ...(no.config?.okText ? { okText: interpolarTextoAcervo(no.config.okText, contexto, { caminho, fileId }) } : {}),
          ...(no.config?.notFoundText ? { notFoundText: interpolarTextoAcervo(no.config.notFoundText, contexto, { caminho, fileId }) } : {}),
          ...(no.config?.errorText ? { errorText: interpolarTextoAcervo(no.config.errorText, contexto, { caminho, fileId }) } : {})
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
          ...(no.config?.errorText ? { errorText: interpolar(no.config.errorText, contexto) } : {})
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
          ...(temSucessor ? { encadeado: true, retomarDe: no.id, locais: contexto.local } : {}),
          // Quem não escolheu não manda nada: o padrão vive só na entrega.
          ...(no.config?.delivery ? { entrega: no.config.delivery } : {}),
          // Qual mensagem a resposta marca: a citada (padrão, certo para o
          // download de link) ou a de quem pediu (certo quando o pedido se
          // basta — nome digitado, botão tocado).
          replyTo: no.config?.quoteFrom === 'mensagem' ? referenciaDaPropria(evento) : referenciaDoLink(evento),
          ...(no.config?.ackText ? { ackText: interpolar(no.config.ackText, contexto) } : {}),
          ...(no.config?.caption ? { caption: interpolar(no.config.caption, contexto) } : {}),
          ...(no.config?.errorText ? { errorText: interpolar(no.config.errorText, contexto) } : {})
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
          ...(no.config.viewOnce ? { viewOnce: true } : {}),
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
      if (no.config?.who === 'target' && Array.isArray(evento.group?.participants) && evento.group.participants.length > 1) {
        for (const p of evento.group.participants) {
          const alvo = typeof p === 'string' ? p : (p.id || p.phoneJid || p.jid)
          if (!alvo) continue
          if (no.config?.neverRemoveOwner !== false && ehDono(db, alvo)) continue
          comandos.push({
            commandType: 'group.remove',
            payload: { chatId: evento.chat.id, participantId: alvo }
          })
        }
        return 'success'
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
        // Silencioso quando NINGUÉM declarou o aviso: uma regra automática
        // tentando remover o dono é engano de configuração, não motivo para
        // derrubar a execução. Mas um comando que uma PESSOA digitou e que
        // termina mudo é defeito — foi o que aconteceu com `/rebaixa`. Quem
        // declarar o texto recebe resposta; a trava não muda.
        if (typeof no.config?.ownerText === 'string' && no.config.ownerText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.ownerText, contexto) }
          })
        }
        return 'success'
      }
      comandos.push({
        commandType: 'group.remove',
        payload: { chatId: evento.chat.id, participantId: quem }
      })
      return 'success'
    }

    case 'action.whatsapp.react': {
      // Reagir NÃO exige grupo: funciona em conversa de uma pessoa também. Por
      // isso não tem a trava de só-grupo que as ações de administração têm.
      //
      // O alvo é a mensagem CITADA, e a referência vem de `referenciaDoLink`,
      // que já existe e já resolve a armadilha do LID contra telefone. Escrever
      // um jeito novo de apontar para a citada criaria um segundo lugar para a
      // mesma ambiguidade voltar.
      const alvo = referenciaDoLink(evento)
      if (!alvo) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há o que reagir: o comando não respondeu nenhuma mensagem.')
      }
      // Emoji VAZIO é legítimo: é como o WhatsApp revoga uma reação que já
      // estava lá. Então string vazia passa, e só `undefined` virava nada.
      const emoji = typeof no.config?.emoji === 'string' ? interpolar(no.config.emoji, contexto).trim() : ''
      comandos.push({
        commandType: 'whatsapp.react',
        payload: { chatId: evento.chat.id, emoji, target: alvo }
      })
      return 'success'
    }

    case 'action.whatsapp.profilePicture': {
      const dono = no.config?.who === 'target' ? resolverAlvo(evento) : evento.sender?.id
      if (!dono) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há de quem pegar a foto: o comando não indicou ninguém.')
      }
      comandos.push({
        commandType: 'whatsapp.profilePicture',
        payload: {
          chatId: evento.chat.id,
          jid: dono,
          ...(no.config?.caption ? { caption: interpolar(no.config.caption, contexto) } : {}),
          // QUEM NÃO TEM FOTO É CASO NORMAL, não erro: a consulta volta sem
          // endereço, e é o gateway que responde este texto. Sem ele o comando
          // ficaria mudo justamente no caso mais comum depois do sucesso.
          ...(no.config?.noPhotoText ? { noPhotoText: interpolar(no.config.noPhotoText, contexto) } : {}),
          replyTo: referenciaDaPropria(evento) || referenciaDoLink(evento)
        }
      })
      return 'success'
    }

    case 'action.group.promote': {
      // Promover é a irmã de `action.group.remove`, e por isso repete as travas
      // que fazem sentido e NÃO repete a que não faz. Só em grupo, nunca sem
      // alvo resolvido — mas sem proteção de dono: promover não é destrutivo,
      // e dono já promovido continua promovido.
      //
      // Depende de o bot ser admin. Não é conferido aqui: quem recusa é o
      // WhatsApp, e o executor traduz a recusa.
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para promover participante dentro de um grupo.')
      }
      // Vários marcados de uma vez: o mesmo caminho que a remoção já abriu,
      // porque "/promove @a @b" é uso normal e tratar só o primeiro seria
      // obedecer metade do comando em silêncio.
      if (no.config?.who === 'target' && Array.isArray(evento.group?.participants) && evento.group.participants.length > 1) {
        for (const p of evento.group.participants) {
          const alvo = typeof p === 'string' ? p : (p.id || p.phoneJid || p.jid)
          if (!alvo) continue
          comandos.push({
            commandType: 'group.promote',
            payload: { chatId: evento.chat.id, participantId: alvo }
          })
        }
        return 'success'
      }
      const aPromover = no.config?.who === 'target' ? resolverAlvo(evento) : evento.sender?.id
      if (!aPromover) {
        // Mesma forma de "sem alvo" das outras ações: quem declara o aviso
        // recebe resposta, quem não declara cai no erro registrado.
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há quem promover: o comando não indicou ninguém.')
      }
      comandos.push({
        commandType: 'group.promote',
        payload: { chatId: evento.chat.id, participantId: aPromover }
      })
      return 'success'
    }

    case 'action.group.demote': {
      // Rebaixar tira os privilégios de administrador de alguém.
      // Três travas, espelhando remover: só em grupo, nunca sem alvo resolvido,
      // e (por padrão) nunca um dono.
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para rebaixar participante dentro de um grupo.')
      }
      if (no.config?.who === 'target' && Array.isArray(evento.group?.participants) && evento.group.participants.length > 1) {
        for (const p of evento.group.participants) {
          const alvo = typeof p === 'string' ? p : (p.id || p.phoneJid || p.jid)
          if (!alvo) continue
          if (no.config?.neverRemoveOwner !== false && ehDono(db, alvo)) continue
          comandos.push({
            commandType: 'group.demote',
            payload: { chatId: evento.chat.id, participantId: alvo }
          })
        }
        return 'success'
      }
      const quem = no.config?.who === 'target' ? resolverAlvo(evento) : evento.sender?.id
      if (!quem) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há quem rebaixar: o comando não indicou ninguém.')
      }
      if (no.config?.neverRemoveOwner !== false && ehDono(db, quem)) {
        // O silêncio daqui custou uma investigação inteira: em 27/10, três
        // `/rebaixa` seguidos gravaram `matched_live` com ZERO comandos, e no
        // WhatsApp não apareceu nada. O alvo citado era um dono, a trava
        // funcionou, e ninguém ficou sabendo. A trava continua — o que muda é
        // que quem declarar o texto recebe resposta.
        if (typeof no.config?.ownerText === 'string' && no.config.ownerText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.ownerText, contexto) }
          })
        }
        return 'success'
      }
      comandos.push({
        commandType: 'group.demote',
        payload: { chatId: evento.chat.id, participantId: quem }
      })
      return 'success'
    }

    case 'action.variable.rank': {
      // RANKING: ordenar muitos contadores, que é a única coisa que a
      // linguagem nunca soube fazer com variável.
      //
      // A ordenação acontece AQUI e não no gateway — diferente do sorteio de
      // membro — porque o dado mora no banco do motor, e mandar o gateway
      // pedir de volta seria uma volta inteira por nada. O princípio é o
      // mesmo: quem tem a coleção faz o trabalho, a linguagem só pede.
      const escopo = no.config.scope === 'contact' ? 'contact' : 'group_member'
      if (escopo === 'group_member' && evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('O ranking dos membros só existe dentro de um grupo.')
      }
      const teto = Number.isInteger(no.config?.limit) ? Math.min(no.config.limit, 50) : 10

      // `LIKE grupo|%` limita ao grupo desta conversa. O separador não pode
      // aparecer em id nenhum (montarIdMembro recusa), então não há colisão.
      const linhas = escopo === 'group_member'
        ? db.prepare(
          "SELECT scope_id, value_json FROM entity_attributes WHERE scope_kind = 'group_member' AND key = ? AND scope_id LIKE ? ESCAPE '\\'"
        ).all(no.config.key, `${evento.chat.id.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}|%`)
        : db.prepare("SELECT scope_id, value_json FROM entity_attributes WHERE scope_kind = 'contact' AND key = ?")
          .all(no.config.key)

      const pontuados = []
      for (const linha of linhas) {
        let valor
        try { valor = JSON.parse(linha.value_json) } catch { continue }
        const n = comoNumero(valor)
        // Quem não tem número não entra: um atributo de texto com a mesma
        // chave entraria como zero e sujaria o ranking com gente que nunca
        // pontuou.
        if (n === undefined) continue
        const membro = escopo === 'group_member' ? separarIdMembro(linha.scope_id) : null
        // `separarIdMembro` devolve { groupId, memberId } — não `pessoaId`.
        // Ler o nome errado não quebrava nada: devolvia undefined e TODAS as
        // linhas caíam no `continue`, deixando o ranking vazio para sempre
        // sem erro nenhum. Foi o teste que pegou.
        const quem = escopo === 'group_member' ? membro?.memberId : linha.scope_id
        if (!quem) continue
        pontuados.push({ quem, valor: n })
      }
      pontuados.sort((a, b) => b.valor - a.valor)
      const topo = pontuados.slice(0, teto)

      if (!topo.length) {
        if (typeof no.config?.emptyText === 'string' && no.config.emptyText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.emptyText, contexto), replyTo: referenciaDoLink(evento) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Ninguém pontuou ainda: não há ranking para mostrar.')
      }

      const molde = no.config?.lineFormat || '{{posicao}}. @{{numero}} — {{valor}}'
      const linhasTexto = topo.map((p, i) => molde
        .replaceAll('{{posicao}}', String(i + 1))
        .replaceAll('{{numero}}', soDigitos(p.quem))
        .replaceAll('{{valor}}', String(p.valor)))
      const cabecalho = no.config?.headerText ? interpolar(no.config.headerText, contexto) : ''
      comandos.push({
        commandType: 'whatsapp.reply',
        payload: {
          chatId: evento.chat.id,
          text: [cabecalho, ...linhasTexto].filter(Boolean).join('\n'),
          // As menções fazem os nomes aparecerem em vez dos números crus.
          mentions: topo.map((p) => p.quem),
          replyTo: referenciaDoLink(evento)
        }
      })
      return 'success'
    }

    case 'action.whatsapp.pin': {
      // Fixar (ou soltar) a mensagem RESPONDIDA.
      //
      // A referência é a mesma que `reagir` usa — a da citação —, porque fixar
      // é sempre sobre uma mensagem que já existe. Sem citação não há o que
      // fixar, e isso é erro de uso, não falha do sistema: avisa.
      const paraFixar = referenciaDoLink(evento)
      if (!paraFixar || !evento.message?.quotedRef) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há mensagem para fixar: o comando precisa responder uma.')
      }
      comandos.push({
        commandType: 'whatsapp.pin',
        payload: {
          chatId: evento.chat.id,
          acao: no.config?.action === 'unpin' ? 'unpin' : 'pin',
          // 24h é o padrão do próprio WhatsApp, e mandar SEMPRE um valor é o
          // que impede o fixo de sumir calado no aparelho de quem recebe.
          duracaoSegundos: Number.isInteger(no.config?.durationSecs) ? no.config.durationSecs : 86400,
          alvo: paraFixar
        }
      })
      return 'success'
    }

    case 'action.whatsapp.pollResults': {
      // A contagem SAI DAQUI, do banco, e não mais de uma urna em memória do
      // gateway. O gateway relata o que vê; o motor guarda e soma. Assim o
      // resultado sobrevive a um reinício — uma enquete de reunião aberta à
      // noite não pode perder os votos porque o bot subiu de manhã.
      //
      // Sem id, usa a última enquete desta conversa: ninguém copia id de
      // mensagem no WhatsApp, e um comando que exigisse isso não seria usado.
      const enquetes = criarServicoDeEnquetes(db)
      const alvoEnquete = evento.message?.quotedRef?.id || enquetes.ultimaDaConversa(evento.chat.id)
      const apurado = alvoEnquete ? enquetes.apurar(alvoEnquete) : null

      if (!apurado) {
        // "Não conheço esta enquete" é diferente de "ninguém votou", e o texto
        // padrão do template diz isso — o bot conta a partir das que vê
        // nascer, então uma aberta antes de ele entrar no grupo fica de fora.
        if (typeof no.config?.emptyText === 'string' && no.config.emptyText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.emptyText, contexto), replyTo: referenciaDoLink(evento) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há enquete conhecida nesta conversa para apurar.')
      }

      const molde = no.config?.lineFormat || '• {{opcao}}: {{votos}}'
      const linhas = apurado.opcoes.map((o) => molde
        .replaceAll('{{opcao}}', o.opcao)
        .replaceAll('{{votos}}', String(o.votos)))
      const cabecalho = no.config?.headerText ? interpolar(no.config.headerText, contexto) : ''
      const rodape = `${apurado.votantes} ${apurado.votantes === 1 ? 'pessoa votou' : 'pessoas votaram'}.`
      comandos.push({
        commandType: 'whatsapp.reply',
        payload: {
          chatId: evento.chat.id,
          text: [cabecalho, ...linhas, '', rodape].filter((l) => l !== '').join('\n'),
          replyTo: referenciaDoLink(evento)
        }
      })
      return 'success'
    }

    case 'action.whatsapp.poll': {
      // Enquete nativa do WhatsApp.
      //
      // As opções chegam como TEXTO separado por ponto e vírgula, e quem
      // divide é aqui — num lugar só. A linguagem não tem coleção, e inventar
      // uma só para este campo seria pagar a mudança inteira por um caso.
      const opcoes = String(interpolar(no.config.options, contexto) || '')
        .split(';')
        .map((x) => x.trim())
        .filter(Boolean)
      if (opcoes.length < 2) {
        throw new ErroDeFluxo('Uma enquete precisa de pelo menos duas opções, separadas por ponto e vírgula.')
      }
      comandos.push({
        commandType: 'whatsapp.poll',
        payload: {
          chatId: evento.chat.id,
          pergunta: interpolar(no.config.question, contexto),
          opcoes,
          // Não dá para marcar mais opções do que existem: o WhatsApp aceita o
          // envio e a enquete sai quebrada no aparelho.
          quantasMarcar: Math.min(
            Number.isInteger(no.config?.selectableCount) ? no.config.selectableCount : 1,
            opcoes.length
          ),
          replyTo: referenciaDoLink(evento)
        }
      })
      return 'success'
    }

    case 'action.acervo.read': {
      // LER metadado de um item do acervo, e devolver ao fluxo.
      //
      // As outras quatro ações do acervo escrevem. Esta é a única que lê, e
      // ela existe porque sem dado de item não há vitrine: nome, descrição e
      // preço de um produto moram no acervo e não havia como mostrá-los.
      //
      // O caminho é o mesmo do cano de `chama`: emite o comando, DORME, e a
      // retomada traz o resultado. Não é canal novo — `retomarFluxo` já fazia
      // isso para conexão desde que o encadeamento existe. Reusar foi a
      // condição que uma das revisões pôs para aprovar, e ela já estava
      // satisfeita antes de a pergunta ser feita.
      // `temSucessor` já vem calculado pelo caminhador (montarFluxo), que é
      // quem enxerga o documento. É o MESMO parâmetro que o cano de `chama`
      // usa — reusar é o que garante que as duas ações durmam pela mesma regra.
      comandos.push({
        commandType: 'acervo.read',
        payload: {
          chatId: evento.chat.id,
          caminho: interpolar(no.config.path, contexto),
          ...(no.config?.content === true ? { conteudo: true } : {}),
          ...(temSucessor ? { encadeado: true, retomarDe: no.id, locais: contexto.local } : {}),
          ...(no.config?.notFoundText ? { notFoundText: interpolar(no.config.notFoundText, contexto) } : {}),
          replyTo: referenciaDoLink(evento)
        }
      })
      // Sem passo depois, ler não serve para nada — mas não é erro: alguém
      // pode estar montando o fluxo aos poucos no painel.
      return temSucessor ? 'dormindo' : 'success'
    }

    case 'action.group.members': {
      // Falar COM os membros — marcando todos, listando ou sorteando um.
      //
      // O motor não enumera ninguém aqui, e não é omissão: um comando é evento
      // de MENSAGEM, e evento de mensagem não traz participantes (só o de
      // grupo traz, zapoAdapter.js:504). Quem tem a lista é o gateway. Então
      // esta ação emite um TRABALHO e o gateway resolve com a lista em mãos.
      //
      // É também o que permite `pick` sem primitiva de aleatório no motor: o
      // sorteio acontece onde a coleção existe. Duas revisões independentes
      // (Gemini e Grok) chegaram a essa mesma conclusão antes de eu escrever.
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para falar com os membros dentro de um grupo.')
      }
      comandos.push({
        commandType: 'group.members',
        payload: {
          chatId: evento.chat.id,
          mode: no.config?.mode || 'mention',
          ...(no.config?.text ? { text: interpolar(no.config.text, contexto) } : {}),
          ...(no.config?.onlyAdmins === true ? { onlyAdmins: true } : {}),
          ...(no.config?.notFoundText ? { notFoundText: interpolar(no.config.notFoundText, contexto) } : {}),
          replyTo: referenciaDoLink(evento)
        }
      })
      return 'success'
    }

    case 'action.group.add': {
      // Adicionar participante ao grupo pelo número informado no comando.
      // Só funciona dentro de grupo.
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para adicionar participante dentro de um grupo.')
      }
      // UM nome de campo, que é o que o vocabulário declara (`chave: 'phone'`,
      // rótulo `número`) e o único que o schema admite — ele tem
      // `additionalProperties: false`, então `participant` ou `number` seriam
      // recusados na validação. Aceitar três nomes aqui era código morto que
      // fingia suportar o que não passa, e é a segunda fonte da verdade de novo.
      const valorBruto = no.config?.phone
      const resolvido = typeof valorBruto === 'string' ? interpolar(valorBruto, contexto).trim() : ''
      if (!resolvido || resolvido.includes('{{')) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há quem adicionar: o comando não indicou nenhum número.')
      }

      // SEPARA POR VÍRGULA, NÃO POR ESPAÇO — e a diferença quebrou em produção.
      //
      // Medido em 26/10: "/adiciona +62 897-7791-132" era partido em "+62" e
      // "897-7791-132". O primeiro pedaço ficava com dois dígitos e caía no
      // filtro de tamanho; o segundo virava um número ERRADO, e o WhatsApp
      // recusou com 404 — ele estava certo, o número não existia.
      //
      // Gente escreve telefone com espaço, com parêntese e com traço. Quem
      // quer somar vários usa vírgula, que é separador explícito e não aparece
      // dentro de um número.
      const partes = resolvido.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)
      const alvos = []
      for (const parte of partes) {
        if (/@(s\.whatsapp\.net|lid)$/.test(parte)) {
          alvos.push(parte)
        } else {
          const digitos = parte.replace(/\D/g, '')
          if (digitos.length >= 8) alvos.push(`${digitos}@s.whatsapp.net`)
        }
      }

      if (alvos.length === 0) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há quem adicionar: o comando não indicou nenhum número válido.')
      }

      for (const alvo of alvos) {
        comandos.push({
          commandType: 'group.add',
          payload: { chatId: evento.chat.id, participantId: alvo }
        })
      }
      return 'success'
    }

    case 'action.group.setSubject': {
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para mudar o nome do grupo dentro de um grupo.')
      }
      const valorBruto = no.config?.subject
      const resolvido = typeof valorBruto === 'string' ? interpolar(valorBruto, contexto).trim() : ''
      if (!resolvido || resolvido.includes('{{')) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há como mudar o nome do grupo: o nome não pode ser vazio.')
      }
      comandos.push({
        commandType: 'group.setSubject',
        payload: { chatId: evento.chat.id, subject: resolvido }
      })
      return 'success'
    }

    case 'action.group.setDescription': {
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para mudar a descrição do grupo dentro de um grupo.')
      }
      const valorBruto = no.config?.description ?? ''
      const resolvido = typeof valorBruto === 'string' ? interpolar(valorBruto, contexto).trim() : ''
      const textoFinal = (!resolvido || resolvido.includes('{{')) ? null : resolvido
      comandos.push({
        commandType: 'group.setDescription',
        payload: { chatId: evento.chat.id, description: textoFinal }
      })
      return 'success'
    }

    case 'action.group.setAnnounce': {
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para fechar ou abrir o grupo dentro de um grupo.')
      }
      const fechar = no.config?.close !== false
      comandos.push({
        commandType: 'group.setAnnounce',
        payload: { chatId: evento.chat.id, close: fechar }
      })
      return 'success'
    }

    case 'action.group.inviteCode': {
      if (evento.chat.kind !== 'group') {
        throw new ErroDeFluxo('Só dá para mostrar o link do grupo dentro de um grupo.')
      }
      const renova = no.config?.renova === true
      const texto = typeof no.config?.text === 'string' ? interpolar(no.config.text, contexto) : null
      comandos.push({
        commandType: 'group.inviteCode',
        payload: {
          chatId: evento.chat.id,
          renova,
          ...(texto ? { text: texto } : {}),
          ...(referenciaDaPropria(evento) ? { replyTo: referenciaDaPropria(evento) } : {})
        }
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
            // O número só muda o rótulo: o toque precisa continuar enviando
            // o comando original, ou numerar quebraria o próprio menu.
            items: menu.itens.map((item, i) => ({ id: item.label, label: menu.config.numbered ? `${i + 1}. ${item.label}` : item.label, description: item.description || '', family: item.family }))
          }
        })
        return 'success'
      }
      // TEXTO VAZIO NÃO É MENSAGEM. Isso só acontece quando não há comando
      // visível e o `quando não houver comando` daquela conversa está em
      // branco — e aí o branco quer dizer "não responda nada", não "mande uma
      // mensagem sem nada dentro", que o WhatsApp recusa. Era por onde o
      // salvar do painel (ver menu-config.js) deixava o /menu mudo e
      // engasgado em vez de mudo e limpo.
      if (!menu.texto) return 'success'
      comandos.push({
        commandType: 'whatsapp.reply',
        payload: { chatId: evento.chat.id, text: menu.texto }
      })
      return 'success'
    }

    case 'action.variable.random': {
      // SORTEAR, com a aleatoriedade acontecendo AQUI e não numa API.
      //
      // Duas formas: número numa faixa, ou um item de uma lista. A segunda
      // existe porque a linguagem não manipula coleção — quem tem a lista faz
      // o trabalho, igual ao sorteio de membro.
      if (ehChaveReservada(no.config.key)) throw new ErroDeFluxo(motivoDeRecusa(no.config.key))
      let valor
      if (typeof no.config.entre === 'string' && no.config.entre) {
        const itens = no.config.entre.split(',').map((x) => x.trim()).filter(Boolean)
        if (!itens.length) throw new ErroDeFluxo('Não há de onde sortear: a lista veio vazia.')
        valor = itens[Math.floor(Math.random() * itens.length)]
      } else {
        const minimo = Number.isInteger(no.config.minimo) ? no.config.minimo : 1
        const maximo = Number.isInteger(no.config.maximo) ? no.config.maximo : 100
        if (maximo < minimo) throw new ErroDeFluxo(`A faixa do sorteio está invertida: de ${minimo} até ${maximo}.`)
        // As duas pontas ENTRAM: "de 1 até 6" tem que poder dar 1 e 6, senão
        // um dado de seis lados nunca tira seis.
        valor = minimo + Math.floor(Math.random() * (maximo - minimo + 1))
      }
      if (no.config.scope === 'local') {
        if (no.config.categoryKey || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(no.config.key)) {
          throw new ErroDeFluxo('Resultado local precisa de nome simples, sem categoria.')
        }
        contexto.local[no.config.key] = valor
      } else {
        const alvo = resolverEscopo(no.config.scope, evento, { categoryKey: no.config.categoryKey })
        if (!alvo) throw new ErroDeFluxo(`O destino do sorteio não existe neste evento: ${no.config.scope}.`)
        gravarAtributo(db, alvo, no.config.key, valor)
        aplicarNasVariaveis(contexto.var, no.config.scope, no.config.key, valor, { categoryKey: no.config.categoryKey })
      }
      return 'success'
    }

    case 'action.variable.calculate': {
      if (ehChaveReservada(no.config.key)) throw new ErroDeFluxo(motivoDeRecusa(no.config.key))
      const esquerda = resolverOperando(db, no.config.left, evento, contexto)
      const direita = resolverOperando(db, no.config.right, evento, contexto)
      const valor = calcular(esquerda, no.config.operator, direita)
      if (no.config.scope === 'local') {
        if (no.config.categoryKey || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(no.config.key)) {
          throw new ErroDeFluxo('Resultado local precisa de nome simples, sem categoria.')
        }
        // Local pertence à execução: duas pessoas calculando ao mesmo tempo
        // não compartilham resultado e nenhuma variável de usuário é gravada.
        contexto.local[no.config.key] = valor
      } else {
        const alvo = resolverEscopo(no.config.scope, evento, { categoryKey: no.config.categoryKey })
        if (!alvo) throw new ErroDeFluxo(`O destino do cálculo não existe neste evento: ${no.config.scope}.`)
        gravarAtributo(db, alvo, no.config.key, valor)
        aplicarNasVariaveis(contexto.var, no.config.scope, no.config.key, valor, { categoryKey: no.config.categoryKey })
      }
      return 'success'
    }

    case 'action.list.add':
    case 'action.list.remove': {
      // Edita uma lista nomeada (listas.js). Roda no motor e não emite comando de
      // gateway: lê e grava o banco que o avaliador já abre.
      //
      // O nome vem do documento e só passa pela validação do serviço; o alvo é
      // sempre resolvido do evento, nunca de texto digitado — "/liberar @fulano"
      // põe o fulano, e quem escreve outra coisa não escolhe a chave.
      const adicionar = no.type === 'action.list.add'
      const lista = interpolar(no.config?.list ?? '', contexto)
      const quem = no.config?.who === 'sender' ? evento.sender?.id : resolverAlvo(evento)
      if (!quem) {
        if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo(`Não há quem ${adicionar ? 'pôr na' : 'tirar da'} lista: o comando não indicou ninguém.`)
      }
      const feito = adicionar ? adicionarNaLista(db, lista, quem) : removerDaLista(db, lista, quem)
      if (!feito.ok) {
        throw new ErroDeFluxo(feito.motivo === 'nome'
          ? `Nome de lista inválido: "${lista}". Use letras minúsculas, números e "_", começando por letra (até 32).`
          : 'Não há quem pôr ou tirar da lista: a pessoa não foi identificada.')
      }
      // Quem já está no mapa do contexto vê a mudança na MESMA execução, como as
      // variáveis: um "se" logo depois do "põe na lista" enxerga o resultado.
      const dono = no.config?.who === 'sender' ? contexto.sender : contexto.target
      const nome = normalizarNomeDeLista(lista)
      if (dono?.id === quem && nome) {
        dono.lists = dono.lists || {}
        if (adicionar) dono.lists[nome] = true
        else delete dono.lists[nome]
      }
      if (typeof no.config?.confirmText === 'string' && no.config.confirmText) {
        comandos.push({
          commandType: 'whatsapp.reply',
          payload: { chatId: evento.chat.id, text: interpolar(no.config.confirmText, contexto) }
        })
      }
      return 'success'
    }

    case 'action.list.show': {
      // Só lê: mostra quem está numa lista nomeada. Não emite comando de gateway
      // além da resposta, e nunca entrega o jid cru — só o número, como o resto.
      const nome = normalizarNomeDeLista(interpolar(no.config?.list ?? '', contexto))
      if (!nome) throw new ErroDeFluxo(`Nome de lista inválido: "${no.config?.list ?? ''}". Use letras minúsculas, números e "_", começando por letra (até 32).`)
      const membros = membrosDaLista(db, nome)
      const limite = Number.isInteger(no.config?.limit) ? no.config.limit : 50
      const dadosDaLista = { nome, total: membros.length }
      const ctxLista = { ...contexto, lista: dadosDaLista }
      let texto
      if (!membros.length) {
        texto = interpolar(no.config?.emptyText || 'A lista {{lista.nome}} está vazia.', ctxLista)
      } else {
        const linhas = membros.slice(0, limite).map((id) => `• ${soDigitos(id)}`)
        if (membros.length > limite) linhas.push(`e mais ${membros.length - limite}`)
        texto = [interpolar(no.config?.title || 'Lista {{lista.nome}} ({{lista.total}}):', ctxLista), ...linhas].join('\n')
      }
      comandos.push({ commandType: 'whatsapp.reply', payload: { chatId: evento.chat.id, text: texto } })
      return 'success'
    }

    case 'action.usage.record':
    case 'action.usage.count':
    case 'action.usage.clear': {
      // O registro de usos (registroDeUsos.js): quem usou o quê e quando, para
      // limite de uso escrito na linguagem. Roda no motor, sem comando de
      // gateway. Como nas listas, a pessoa vem sempre do evento, nunca de texto
      // digitado.
      const regra = interpolar(no.config?.rule ?? '', contexto)
      const regraInvalida = () => new ErroDeFluxo(`Nome de regra inválido: "${regra}". Use letras minúsculas, números e "_", começando por letra (até 32).`)
      const padrao = no.type === 'action.usage.clear' ? 'target' : 'sender'
      const quemDe = no.config?.who || padrao
      const pessoa = quemDe === 'everyone' ? null : quemDe === 'sender' ? evento.sender?.id : resolverAlvo(evento)

      if (no.type === 'action.usage.count') {
        const segundos = lerJanela(no.config?.window)
        if (!segundos) throw new ErroDeFluxo(`Janela inválida: "${no.config?.window ?? ''}". Escreva como "10 minutos", "1 hora" ou "7 dias".`)
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(no.config?.key ?? '')) throw new ErroDeFluxo('A contagem precisa de um nome simples de variável local.')
        // Sem pessoa identificada (alvo ausente) a conta é zero, não "de todos":
        // contar todo mundo no lugar de um alvo que faltou travaria o comando
        // de quem não tem nada a ver.
        let total = 0
        if (quemDe === 'everyone' || pessoa) {
          const feito = contarUsos(db, {
            regra, segundos, pessoa, chat: no.config?.where === 'chat' ? evento.chat?.id ?? null : null
          })
          if (!feito.ok) throw regraInvalida()
          total = feito.total
        }
        contexto.local[no.config.key] = total
        return 'success'
      }

      if (quemDe !== 'everyone' && !pessoa) {
        if (no.type === 'action.usage.clear' && typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
          comandos.push({
            commandType: 'whatsapp.reply',
            payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
          })
          return 'success'
        }
        throw new ErroDeFluxo('Não há de quem anotar ou apagar o uso: o comando não indicou ninguém.')
      }

      if (no.type === 'action.usage.record') {
        const feito = anotarUso(db, { regra, pessoa, chat: evento.chat?.id })
        if (!feito.ok) throw regraInvalida()
        return 'success'
      }

      const feito = limparUsos(db, { regra, pessoa })
      if (!feito.ok) throw regraInvalida()
      if (typeof no.config?.confirmText === 'string' && no.config.confirmText) {
        comandos.push({
          commandType: 'whatsapp.reply',
          payload: { chatId: evento.chat.id, text: interpolar(no.config.confirmText, { ...contexto, usos: { apagados: feito.apagados } }) }
        })
      }
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
// A POLÍTICA DE FILA ENTRA AQUI, NUM LUGAR SÓ, E É DE PROPÓSITO.
//
// A urgência é declarada no cabeçalho e vale para TODOS os comandos que a
// automação gerar. Isso dá dois jeitos de implementar, e um deles é uma
// armadilha: anexar `scheduling` em cada `case` que empilha comando. São muitos
// `case`s, há duas saídas nesta função — uma delas antecipada, quando o portão
// de exigência recusa — e há o fluxo RETOMADO, que entra por outra porta. Em
// algum momento alguém acrescenta um `case` e esquece, e o comando sai sem
// política. Isso não aparece em teste: aparece em produção, como um envio que
// não respeita a prioridade que o documento pediu.
//
// Então `executarFluxo` passou a ser um invólucro fino: ele chama o fluxo de
// verdade e decora o que vier, seja de qual saída for. Não dá para esquecer
// porque não há onde esquecer.
export const SCHEDULING_PADRAO = Object.freeze({ priority: 'normal', onNoSlot: { kind: 'discard' } })

// Decora uma lista de comandos com a política de fila da automação.
// Automação escrita antes disto existir não tem o campo, e o padrão não pode
// ser inventado em dois lugares diferentes: fica aqui, e é o mesmo que o
// compilador repõe.
export function aplicarScheduling (comandos, documento) {
  const fila = documento?.scheduling || SCHEDULING_PADRAO
  for (const comando of comandos) {
    if (!comando || typeof comando !== 'object') continue
    comando.payload = comando.payload || {}
    // Já decorado não se redecora: o fluxo retomado passa por aqui de novo, e
    // sobrescrever apagaria a política com que o comando original saiu.
    if (!comando.payload.scheduling) comando.payload.scheduling = fila
  }
  return comandos
}

function executarFluxo (db, documento, triggerId, evento, retomada = null) {
  const comandos = montarFluxo(db, documento, triggerId, evento, retomada)
  return aplicarScheduling(comandos, documento)
}

function montarFluxo (db, documento, triggerId, evento, retomada = null) {
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
  // Com atalho (`/p` para `/play`), o prefixo a descontar é o que a pessoa
  // DIGITOU, não o nome canônico — senão "/p musica" devolveria "lay musica"
  // ou vazio, conforme o tamanho da palavra.
  const palavraQueCasou = comandoQueCasou(evento.message?.text, gatilho?.config) || gatilho?.config?.command

  const contexto = {
    // A chamada externa pode dormir. Os resultados locais acompanham só a
    // continuação desta execução, sem virar atributos de conversa ou pessoa.
    local: Object.assign(Object.create(null), retomada?.locais || {}),
    group: evento.group ? { ...evento.group } : {},
    // A FRONTEIRA DO QUE É LEGÍVEL É ESTE OBJETO.
    //
    // Não existe mais lista de campos permitidos no interpolador: o que está
    // aqui dá para escrever num comando, o que não está, não. Então o que não
    // pode ser lido tem que sair AQUI — e o que sai é token de mídia, que é
    // capacidade, não informação. O tipo e a legenda da mídia continuam
    // disponíveis, em `media.*`, porque são dados e não segredo.
    message: semTokens({
      ...evento.message,
      args: extrairArgumentos(evento.message?.text, palavraQueCasou),
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
      ? { argumentos: dividirArgumentos(extrairArgumentos(evento.message?.text, palavraQueCasou), gatilho.config.args) }
      : {}),
    // isOwner entra como campo do remetente (e não como variável de usuário)
    // porque é uma propriedade do evento, não algo que a automação grava.
    // `lists`: as listas nomeadas em que a pessoa está, para `evento sender.lists.<nome> == true`.
    sender: { ...evento.sender, isOwner: ehDono(db, evento.sender?.id), number: soDigitos(evento.sender?.id), lists: listasDa(db, evento.sender?.id) },
    chat: { ...evento.chat, number: soDigitos(evento.chat?.id) },
    // Sem menção nem citação não existe alvo — o ramo fica vazio e
    // {{target.id}} permanece literal no texto, sinalizando o erro de uso em
    // vez de mandar uma mensagem com um buraco no meio.
    target: alvo ? { id: alvo, number: soDigitos(alvo), lists: listasDa(db, alvo) } : {},
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
      ...(typeof r.texto === 'string' ? { texto: r.texto } : {}),
      // DADOS é metadado puro, e entra por `action.acervo.read`. É o que
      // permite escrever {{resultado.dados.nome}} numa resposta — a navegação
      // existe no interpolador, que anda qualquer caminho deste objeto; o que
      // não existia era alguém PÔR dado aqui. Nunca carrega token nem caminho
      // em disco: o invariante 4 vale igual, e `resultadoValidado` é quem o
      // garante, filtrando campo por campo.
      ...(r.dados && typeof r.dados === 'object' ? { dados: r.dados } : {})
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

// A espécie do evento, num lugar só.
//
// O relógio é a terceira fonte de evento, ao lado da mensagem e do grupo, e só
// o motor a produz — por isso o `schedule` vale como tipo mesmo sem
// `message`. A ordem importa: um evento do relógio não carrega mensagem.
function tipoDoEvento (evento) {
  if (evento?.schedule) return 'schedule'
  return evento?.message?.kind || (evento?.group ? 'group' : null)
}

function inserirEvento (db, evento) {
  const jaExiste = db.prepare('SELECT 1 FROM inbound_events WHERE id = ?').get(evento.eventId)
  if (jaExiste) return false
  const messageKind = tipoDoEvento(evento)
  const messageText = evento.message?.text ?? (evento.group?.subject ?? null)
  db.prepare(`INSERT INTO inbound_events
    (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      evento.eventId, evento.accountId, evento.chat.id, evento.chat.kind, evento.sender.id,
      messageKind, messageText, evento.replay ? 1 : 0,
      JSON.stringify(evento), new Date().toISOString()
    )
  return true
}

// O documento de uma revisão publicada é imutável, mas era reparseado a CADA
// evento — duas vezes por automação (uma na ordenação, outra no laço). Com 40
// automações ligadas isso são 80 `JSON.parse` por mensagem recebida, no caminho
// quente da admissão. Aqui o parse acontece uma vez por revisão.
//
// A chave confere o TEXTO bruto, não só o id: ids de revisão se repetem entre
// bancos (testes, restauração) e um documento adulterado no banco precisa ser
// relido. O cache é por banco e só guarda as revisões que ainda estão
// publicadas, então o tamanho nunca passa do número de automações ligadas.
// Congelado de propósito: quem mutar o documento compartilhado falha alto, em
// vez de vazar a alteração para o evento seguinte.
const cacheDeRevisoes = new WeakMap()

function congelarEmProfundidade (valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor)
    for (const filho of Object.values(valor)) congelarEmProfundidade(filho)
  }
  return valor
}

function revisaoLida (db, candidato) {
  let porRevisao = cacheDeRevisoes.get(db)
  if (!porRevisao) cacheDeRevisoes.set(db, porRevisao = new Map())
  const quente = porRevisao.get(candidato.revision_id)
  if (quente && quente.bruto === candidato.doc_json) return quente
  const documento = congelarEmProfundidade(jsonOuNull(candidato.doc_json))
  const trigger = documento ? acharTrigger(documento) : null
  const lida = { bruto: candidato.doc_json, documento, trigger }
  porRevisao.set(candidato.revision_id, lida)
  return lida
}

function esquecerRevisoesDespublicadas (db, candidatos) {
  const porRevisao = cacheDeRevisoes.get(db)
  if (!porRevisao || porRevisao.size <= candidatos.length) return
  const vivas = new Set(candidatos.map((c) => c.revision_id))
  for (const id of porRevisao.keys()) if (!vivas.has(id)) porRevisao.delete(id)
}

function candidatosPublicados (db) {
  return db.prepare(`
    SELECT a.id AS automation_id, a.deployment_mode, r.id AS revision_id, r.doc_json
    FROM automations a
    JOIN automation_revisions r ON r.id = a.active_revision_id
    WHERE a.enabled = 1 AND a.active_revision_id IS NOT NULL
  `).all()
}

// NÃO EXISTE MAIS BYPASS DE ESCOPO. Automação do sistema pulava a checagem
// porque "scope.include vazio nunca casa com tudo" foi pensado pra conteúdo
// autorado pelo usuário, e o /menu nativo precisava responder em qualquer
// chat. Agora o menu é automação comum e diz onde responde: quem instala o
// template escolhe o escopo, e a conversão do menu legado preenche
// `em qualquer lugar` (ver menuPadrao.js) — pelas regras que valem pra todo
// mundo, sem exceção no avaliador.

// Lista as automações publicadas, ao vivo e habilitadas visíveis no chat do
// evento — base do /menu. Reusa exatamente a mesma semântica de escopo
// (`escopoCasa`) que o avaliador já aplica pra decidir se uma automação
// "roda" ali.
//
// O MENU APARECE NA PRÓPRIA LISTA por padrão, e isso é proposital: ele é um
// comando publicado naquela conversa como qualquer outro. Quem não quiser
// vê-lo escreve `menu: não` no .lcn do menu — primitiva criada junto com esta
// mudança, porque apagar o rótulo NÃO esconde (o rótulo cai no comando).
//
// SÓ ENTRA QUEM TEM FAMÍLIA. O menu é organizado por família, e um comando sem
// `família:` (ou com ela em branco) não tem onde morar nele: fica de fora, e
// continua respondendo normalmente. E entre os que têm, só as famílias que o
// menu daquela conversa deixa mostrar (`families` na configuração do menu).
function automacoesVisiveisEm (db, chatDoEvento, familiasPermitidas = null) {
  const linhas = db.prepare(`
    SELECT a.id AS automation_id, a.active_revision_id, r.doc_json
    FROM automations a
    JOIN automation_revisions r ON r.id = a.active_revision_id
    WHERE a.enabled = 1 AND a.active_revision_id IS NOT NULL
      AND a.deployment_mode = 'live'
  `).all()

  const obterRefs = db.prepare('SELECT direction, kind, ref_id FROM automation_scopes WHERE automation_revision_id = ?')
  const visiveis = []
  for (const linha of linhas) {
    const documento = jsonOuNull(linha.doc_json)
    if (!documento) continue
    const refs = obterRefs.all(linha.active_revision_id)
    if (!escopoCasa(db, refs, chatDoEvento)) continue
    // O MENU MUDA DE ACORDO, que é metade do pedido: desligar uma família
    // numa conversa tem de sumir com ela do menu dali. Anunciar um comando que
    // responde "estou desligado" — ou, em grupo, que não responde nada — seria
    // o menu mentindo sobre o que o bot faz naquele lugar.
    if (desligadoNaConversa(db, chatDoEvento, { automationId: linha.automation_id, documento }).desligado) continue
    // `menu: não` no .lcn. É o único jeito de tirar um comando da lista,
    // porque o rótulo cai no próprio comando quando menuLabel falta — apagar
    // o rótulo troca o texto da linha, não some com ela.
    if (documento.display?.menuHidden) continue
    const familia = familiaDoDocumento(documento)
    if (!familia) continue
    if (familiasPermitidas && !familiasPermitidas.has(normalizarFamilia(familia))) continue
    const trigger = acharTrigger(documento)
    const rotulo = documento.display?.menuLabel || trigger?.config?.command
    // Regra automática (anti-link e afins) não é um comando que alguém digita,
    // então não vira linha no menu — a não ser que quem instalou tenha dado um
    // menuLabel de propósito, o que só faz sentido para anunciar a regra.
    if (!rotulo) continue
    visiveis.push({
      label: rotulo,
      description: documento.display?.menuDescription || null,
      family: tituloDaFamilia(familia)
    })
  }
  return visiveis
}

function numerarLinhas (texto) {
  // Linha vazia é separação visual, não item. O contador só avança quando há
  // algo para mostrar; assim a lista montada por uma resposta mantém espaços.
  let numero = 0
  return texto.split(/\r?\n/).map((linha) => linha.trim() ? `${++numero}. ${linha}` : linha).join('\n')
}

// O título de uma família no menu. As famílias dos modelos vêm da categoria do
// catálogo, que é um identificador ("modulos-especializados"); estas quatro
// ganham o nome com acento, o mesmo de `CATEGORY_LABELS` em pages/catalog.js.
// Família escrita à mão já é texto de gente e só ganha a inicial maiúscula.
const TITULOS_DAS_CATEGORIAS = Object.freeze({
  utilitarios: 'Utilitários',
  configuracoes: 'Configurações',
  empresarial: 'Empresarial',
  'modulos-especializados': 'Módulos especializados'
})

function tituloDaFamilia (familia) {
  const conhecida = TITULOS_DAS_CATEGORIAS[normalizarFamilia(familia)]
  if (conhecida) return conhecida
  return familia.charAt(0).toUpperCase() + familia.slice(1)
}

// Agrupa por família, em ordem alfabética do título; dentro da família, a
// ordem de sempre. Duas famílias que só diferem em maiúscula ou acento são a
// mesma.
function agruparPorFamilia (itens) {
  const grupos = new Map()
  for (const item of itens) {
    const chave = normalizarFamilia(item.family)
    if (!grupos.has(chave)) grupos.set(chave, { titulo: item.family, itens: [] })
    grupos.get(chave).itens.push(item)
  }
  return [...grupos.values()].sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'))
}

// Monta o menu daquela conversa. A configuração vem em cascata (config do
// grupo > padrão do tipo > config do nó > padrão do código), então o mesmo
// documento de automação produz menus diferentes em grupos diferentes.
function renderizarMenu (db, acao, evento) {
  const config = resolverConfigDeMenu(db, evento.chat, acao.config)
  const visiveis = automacoesVisiveisEm(db, evento.chat, familiasDoMenu(config))

  if (!visiveis.length) {
    return { config, itens: [], texto: config.emptyText }
  }

  // A numeração corre o menu inteiro, sem recomeçar a cada família: "manda o
  // 7" tem de apontar um item só.
  const grupos = agruparPorFamilia(visiveis)
  const itens = grupos.flatMap((g) => g.itens)
  const partes = [config.header]
  let numero = 0
  for (const grupo of grupos) {
    partes.push('', `*${grupo.titulo}*`)
    for (const item of grupo.itens) {
      numero++
      partes.push(`${config.numbered ? `${numero}.` : '•'} ${item.label}${item.description ? ` — ${item.description}` : ''}`)
    }
  }
  if (config.footer) partes.push('', config.footer)

  return { config, itens, texto: partes.join('\n') }
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
//
// O evento do RELÓGIO (`schedule`) só entra por dentro: `interno: true` é o
// agendador do próprio motor. Quem chega por `POST /events` é o gateway ou um
// cliente, e deixar qualquer um deles forjar um disparo faria o endpoint
// virar a porta de "faça esta automação rodar agora, em qualquer conversa".
export function avaliarEvento (db, evento, { interno = false } = {}) {
  if (!interno && (evento?.schedule || evento?.message?.kind === 'schedule')) {
    throw new ErroHttp(400, 'Evento de agendamento só é aceito do próprio motor.')
  }
  const temOrigem = Boolean(evento?.message?.kind || evento?.group?.action || (interno && evento?.schedule?.automationId))
  if (!evento?.eventId || !evento?.accountId || !evento?.chat?.id || !temOrigem) {
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
    const publicados = candidatosPublicados(db)
    esquecerRevisoesDespublicadas(db, publicados)
    const ordenados = publicados.sort((a, b) => {
      const peso = (c) => (revisaoLida(db, c).trigger?.type === 'trigger.command' ? 0 : 2)
      return peso(a) - peso(b)
    })
    let algumComandoCasou = false

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

      const { documento, trigger } = revisaoLida(db, candidato)

      // O relógio acorda UMA automação, a dona do disparo — nunca as outras
      // quarenta que por acaso valem naquela conversa. E, no sentido
      // contrário, o agendado não reage a mensagem nenhuma: ele só existe
      // para o relógio. Sem gravar execução, pelo mesmo motivo do portão de
      // grupo logo abaixo: ruído que esconde o que importa.
      const ehAgendado = trigger?.type === 'trigger.schedule'
      if (Boolean(evento.schedule) !== ehAgendado) continue
      if (ehAgendado && evento.schedule.automationId !== candidato.automation_id) continue

      // Grupo não autorizado: nem avalia, e nem grava execução.
      //
      // Não gravar é de propósito. Com 166 grupos, registrar "não casou" para
      // cada automação a cada mensagem enche a aba Execuções de ruído e some
      // com o que importa. E o dono pediu que o bot não ficasse lendo conversa
      // de grupo onde ninguém o chamou.
      if (trigger && grupoBloqueado(db, evento, trigger)) continue
      // O atendimento humano cala TUDO nesta conversa, menos o comando do dono
      // que o encerra. Fica depois do portão do grupo de propósito: são duas
      // perguntas diferentes, e misturá-las faria uma esconder a outra no log.
      if (trigger && emAtendimentoHumano(db, evento, trigger)) continue
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
        const passaEscopo = escopoCasa(db, refs, evento.chat)
        const passaHistoria = politica.historyPolicy !== 'live_only' || evento.replay !== true
        const kindDoEvento = tipoDoEvento(evento)
        const passaTipo = Boolean(kindDoEvento && politica.acceptedMessageKinds.includes(kindDoEvento))
        // Comando restrito é o canal de administração pelo WhatsApp, então
        // mensagem do PRÓPRIO número precisa passar mesmo com
        // allowFrom:'external' — é assim que quem está com a conta na mão
        // cadastra o primeiro dono. Para comando comum, a regra de sempre
        // continua valendo (bot não reage a si mesmo).
        const ehAdministrativo = trigger.config.requireOwner === true
        const ehAutomatico = trigger.type === 'trigger.message'
        const ehGrupo = trigger.type === 'trigger.group'
        const passaAutor = ehGrupo || ehAgendado || ehAdministrativo ||
          trigger.config.allowFrom !== 'external' || evento.sender.authoredBySelf !== true
        // inputPolicy.acceptedMessageKinds continua valendo nos três casos: é a
        // política de entrada da automação, anterior ao gatilho.
        const passaComando = passaTipo && (
          ehAgendado
            // Já casado lá em cima, pelo dono do disparo: a pergunta "o texto
            // é este comando?" não existe para quem não tem texto.
            ? true
            : ehGrupo
            ? eventoCasaGatilhoDeGrupo(evento, trigger.config)
            : ehAutomatico
              ? (barreiraDeGatilhoAutomatico(evento) && eventoCasaGatilhoDeMensagem(evento, trigger.config))
              : textoCasaComando(evento.message?.text, trigger.config)
        )
        // Comando restrito a dono: enquanto ninguém foi marcado como dono, a
        // instalação continua aberta (senão nasce trancada e nem dá pra
        // configurar o primeiro dono pelo WhatsApp). Depois do primeiro,
        // vale a lista.
        const passaDono = trigger.config.requireOwner !== true ||
          podeUsarComandoRestrito(db, evento.sender.id, { souEuMesmo: evento.sender.authoredBySelf === true })
        const passaAcesso = passaAcessoDoGatilho(db, evento, trigger.config)

        // A mensagem que virou COMANDO já foi endereçada ao bot; regra automática
        // existe para a mensagem que ninguém endereçou a ele. Sem isto, o
        // mesmo link era baixado duas vezes (ver o comentário da ordenação).
        //
        // Configurável, e não travado: auditoria — uma regra que registra tudo
        // que passa — é caso legítimo de querer ver o comando também.
        const cedeAoComando = ehAutomatico && algumComandoCasou &&
          trigger.config.alsoOnCommands !== true

        // NÃO EXISTE MAIS "O NATIVO CEDE AO COMANDO DO DONO".
        //
        // Essa regra existia porque o /menu nativo respondia em todo chat sem
        // ninguém instalar nada, então quem instalasse o seu via duas
        // mensagens de menu. Agora há UM menu só, automação comum: dois
        // comandos com a mesma palavra passam a ser conflito de verdade, e é
        // `conflitos.js` que avisa — a tela, não um desempate escondido.

        if (!cedeAoComando && passaEscopo && passaHistoria && passaAutor && passaComando && passaDono && passaAcesso) {
          // DESLIGADO NESTA CONVERSA — e a conferência vem AQUI, depois de
          // casar, nunca antes.
          //
          // Antes do casamento ela seria catastrófica no privado: toda
          // mensagem passaria por todo comando desligado, e cada um deles
          // responderia "estou desligado". O portão só faz sentido sobre um
          // comando que a pessoa de fato chamou.
          //
          // Isto é diferente de `grupo_ativo`, que decide se o bot EXISTE no
          // grupo. Aqui o bot existe e o comando casou; o que se decide é se
          // ele faz aquilo ali.
          const desligamento = desligadoNaConversa(db, evento.chat, {
            automationId: candidato.automation_id,
            documento
          })
          if (desligamento.desligado) {
            status = 'desligado'
            // O comando CASOU, e isso consome a palavra: sem marcar, o nativo
            // de mesmo nome responderia no lugar dele, e a pessoa veria o bot
            // reagir a um comando que ela acabou de desligar.
            if (!ehAutomatico && !ehGrupo && !ehAgendado) algumComandoCasou = true
            const aviso = avisoDeDesligado(evento.chat, desligamento)
            if (aviso && candidato.deployment_mode === 'live') {
              // O AVISO DE COMANDO DESLIGADO SAI COM A POLÍTICA DA AUTOMAÇÃO.
              //
              // Ele nasce fora do invólucro executarFluxo porque o portão de
              // desligamento barra o evento antes de montar ou caminhar no
              // grafo — não faz sentido rodar nós para um comando desligado.
              // Mas o aviso é um comando executável emitido em nome daquela
              // automação, e a regra do cabeçalho vale para todos eles: quem
              // declarou prioridade ou descarte configurou a automação como
              // um todo. Decorar com a mesma função do invólucro garante que
              // o aviso respeite a fila e reaproveite o mesmo padrão.
              comandosGerados = aplicarScheduling([
                { commandType: 'whatsapp.reply', payload: { chatId: evento.chat.id, text: aviso } }
              ], documento)
            }
          } else {
          status = candidato.deployment_mode === 'live' ? 'matched_live' : 'matched_shadow'
          // Vale para sombra também: o comando CASOU, e é isso que consome a
          // mensagem. Só ao vivo aqui faria o mesmo evento se comportar
          // diferente conforme o modo de uma automação vizinha.
          if (!ehAutomatico && !ehGrupo && !ehAgendado) algumComandoCasou = true
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
              if (!(erro instanceof ErroDeFluxo) && !(erro instanceof ErroDeContador) && !(erro instanceof ErroDeCalculo)) throw erro
              status = 'error'
              detalheErro = { message: erro.message }
              comandosGerados = []
            }
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
  // `dados` é a porta da leitura do acervo, e ela é ESTREITA de propósito: só
  // escalar, só um nível, e nenhum campo com cara de token ou de caminho em
  // disco. Aceitar o objeto inteiro que o gateway mandar transformaria este
  // ponto — que existe justamente para filtrar — num repasse.
  if (resultado.dados && typeof resultado.dados === 'object' && !Array.isArray(resultado.dados)) {
    const dados = {}
    for (const [chave, valor] of Object.entries(resultado.dados)) {
      if (/token|caminho|path|secret|chave/i.test(chave)) continue
      if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') dados[chave] = valor
    }
    if (Object.keys(dados).length) limpo.dados = dados
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
    // A continuação merece o mesmo savepoint do começo: um cálculo inválido
    // depois da espera não pode deixar as gravações desse trecho pela metade.
    novos = db.transaction(() => executarFluxo(db, documento, gatilho.id, evento, { nodeId: payload.retomarDe, resultado, locais: payload.locais }))()
  } catch (erro) {
    if (!(erro instanceof ErroDeFluxo) && !(erro instanceof ErroDeContador) && !(erro instanceof ErroDeCalculo)) throw erro
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
