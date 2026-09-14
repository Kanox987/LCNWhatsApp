// Avaliador de eventos canônicos contra automações publicadas — Etapa 3.5
// do plano. Um único caminho de código serve sombra E ao vivo: a diferença
// é só o que acontece depois de um match (grava "teria executado" vs. gera
// comando executável) — decisão já registrada no plano pra não precisar de
// uma "Etapa 3 modo sombra" separada.
import crypto from 'crypto'
import { ErroHttp } from './transport.js'
import { interpolar, resolverCaminho } from './interpolate.js'
import { valoresDeAgora } from './momento.js'
import { ehDono, podeUsarComandoRestrito } from './owners.js'
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

// Gatilho que dispara sem comando: por tipo de mídia, por link, por palavra.
// É o que os "anti-*" e "auto-*" dos bots de referência precisam.
function eventoCasaGatilhoDeMensagem (evento, config) {
  const tipos = config?.messageKinds
  if (Array.isArray(tipos) && tipos.length && !tipos.includes(evento.message.kind)) return false

  const texto = typeof evento.message.text === 'string' ? evento.message.text : ''

  if (config?.containsLink === true && !contemLink(texto)) return false
  if (config?.containsLink === false && contemLink(texto)) return false

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
  if (evento.sender?.authoredBySelf === true) return false
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
function executarNo (db, no, evento, contexto, comandos) {
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
      comandos.push({ commandType: 'whatsapp.reply', payload })
      return 'success'
    }

    case 'action.whatsapp.sticker': {
      // O motor NUNCA vê a mídia: repassa o token opaco que só o processo do
      // gateway que o criou sabe resolver (mediaRefCache). Quem baixa e
      // converte é o gateway — mesma fronteira que /recover e visu única já
      // respeitam. Sem mídia no evento, não gera comando de figurinha: manda
      // (se configurado) só um aviso de texto explicando o que faltou.
      // Duas formas de mandar a mídia, e as duas precisam funcionar: a foto
      // COM o comando na legenda, e o comando RESPONDENDO uma foto já enviada.
      // A segunda é a mais usada nos bots de referência, e era a que faltava —
      // a referência da citação existia no evento e esta ação não a consultava.
      const citada = evento.message?.quotedMediaRef
      const mediaRef = evento.message?.mediaRef || citada?.token
      if (mediaRef) {
        comandos.push({
          commandType: 'whatsapp.sticker',
          payload: {
            chatId: evento.chat.id,
            mediaRef,
            sourceKind: evento.message?.mediaRef ? evento.message.kind : (citada?.mediaKind || null)
          }
        })
      } else if (typeof no.config?.notFoundText === 'string' && no.config.notFoundText) {
        comandos.push({
          commandType: 'whatsapp.reply',
          payload: { chatId: evento.chat.id, text: interpolar(no.config.notFoundText, contexto) }
        })
      }
      return 'success'
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
          fileId: no.config.fileId,
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
function executarFluxo (db, documento, triggerId, evento) {
  const nodesPorId = new Map(documento.flow.nodes.map((n) => [n.id, n]))
  const gatilho = nodesPorId.get(triggerId)
  const comandos = []
  const alvo = resolverAlvo(evento)
  const contexto = {
    // A FRONTEIRA DO QUE É LEGÍVEL É ESTE OBJETO.
    //
    // Não existe mais lista de campos permitidos no interpolador: o que está
    // aqui dá para escrever num comando, o que não está, não. Então o que não
    // pode ser lido tem que sair AQUI — e o que sai é token de mídia, que é
    // capacidade, não informação. O tipo e a legenda da mídia continuam
    // disponíveis, em `media.*`, porque são dados e não segredo.
    message: semTokens({ ...evento.message, args: extrairArgumentos(evento.message?.text, gatilho?.config?.command) }),
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
    quoted: evento.message?.quotedRef?.participant
      ? { sender: evento.message.quotedRef.participant, number: soDigitos(evento.message.quotedRef.participant) }
      : {},
    // A mídia em jogo: a da própria mensagem, ou a da mensagem citada. É o que
    // permite uma resposta se explicar ("recuperei um áudio de fulano") sem o
    // motor nunca tocar nos bytes — tipo e legenda não são segredo de mídia.
    media: dadosDaMidiaEmJogo(evento),
    // O número da própria conta e se ela é admin do grupo. Vem preenchido pelo
    // gateway (accountId NÃO serve: é o id da instância, um UUID). Ausente
    // quando o gateway não soube dizer — placeholder fica literal.
    bot: evento.bot || {},
    now: valoresDeAgora(),
    var: carregarVariaveis(db, evento)
  }

  const visitados = new Set()
  // O publish já rejeita ciclo, então o limite é rede de segurança contra
  // documento adulterado direto no banco ou revisão antiga de antes da regra.
  const limitePassos = documento.flow.nodes.length
  let edge = documento.flow.edges.find((e) => e.from === triggerId && e.on === 'matched')
  let passos = 0

  while (edge) {
    if (++passos > limitePassos) throw new ErroDeFluxo('O fluxo passou do limite de passos — provável ciclo.')
    const no = nodesPorId.get(edge.to)
    if (!no) throw new ErroDeFluxo(`A aresta aponta para um nó inexistente: "${edge.to}".`)
    if (visitados.has(no.id)) throw new ErroDeFluxo(`O nó "${no.id}" seria executado duas vezes.`)
    visitados.add(no.id)

    const saida = executarNo(db, no, evento, contexto, comandos)
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

    for (const candidato of candidatosPublicados(db)) {
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
      let status = 'no_match'
      let comandosGerados = []
      let detalheErro = null

      if (documento && trigger) {
        const refs = db.prepare('SELECT direction, kind, ref_id FROM automation_scopes WHERE automation_revision_id = ?').all(candidato.revision_id)
        const passaEscopo = passaEscopoPara(db, candidato, refs, evento.chat)
        const passaHistoria = documento.inputPolicy.historyPolicy !== 'live_only' || evento.replay !== true
        const passaTipo = documento.inputPolicy.acceptedMessageKinds.includes(evento.message.kind)
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

        if (passaEscopo && passaHistoria && passaAutor && passaComando && passaDono) {
          status = candidato.deployment_mode === 'live' ? 'matched_live' : 'matched_shadow'
          if (status === 'matched_live') {
            try {
              // Savepoint por automação (transação aninhada do better-sqlite3):
              // se o fluxo falhar no meio, as variáveis que ele já tinha
              // gravado voltam atrás. Sem isso, "incrementou o aviso e só
              // depois quebrou" deixaria o contador adiantado para sempre.
              comandosGerados = db.transaction(() => executarFluxo(db, documento, trigger.id, evento))()
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

export function registrarResultadoExecucao (db, commandId, { status, detail } = {}) {
  if (!['sent', 'failed', 'outcome_unknown'].includes(status)) {
    throw new ErroHttp(400, "status deve ser 'sent', 'failed' ou 'outcome_unknown'.")
  }
  const row = db.prepare('SELECT * FROM outbound_commands WHERE id = ?').get(commandId)
  if (!row) throw new ErroHttp(404, `Comando não encontrado: ${commandId}.`)
  db.prepare('UPDATE outbound_commands SET status = ?, resolved_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), commandId)
  if (detail !== undefined) {
    db.prepare('UPDATE automation_runs SET detail_json = ? WHERE id = ?').run(JSON.stringify(detail), row.run_id)
  }
  return exporComando(db.prepare('SELECT * FROM outbound_commands WHERE id = ?').get(commandId))
}
