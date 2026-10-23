// Carrossel: UMA mensagem, com as mídias em cards que a pessoa desliza.
//
// POR QUE ISTO NÃO É O ÁLBUM, E POR QUE OS DOIS EXISTEM
//
// São duas coisas diferentes com o mesmo nome em português, e eu entreguei a
// errada. O dono foi direto: "isso não é carrossel... o sistema está mandando
// uma foto atrás da outra. Eu quero um carrossel bonitinho, uma única mensagem
// com as fotos uma do lado da outra".
//
//   álbum     -> N mensagens que o aplicativo AGRUPA num bloco. Nativo, chega
//                em qualquer cliente, mas continua sendo uma pilha de fotos.
//   carrossel -> UMA mensagem interativa com cards. É o que ele descreveu.
//
// O álbum fica como queda: carrossel é mensagem interativa, e mensagem
// interativa depende do aplicativo de quem recebe renderizar. Mesma regra do
// menu com botões — o conteúdo sempre chega de algum jeito.
//
// A FORMA VEM DE UM BOT QUE USA ISTO EM PRODUÇÃO (ASTA V5,
// `javascript/funcoes/botoes.js`), e cada campo foi conferido contra o proto
// instalado do zapo-js: `Message.InteractiveMessage.CarouselMessage.cards`,
// e no card `header.imageMessage`/`header.videoMessage` com
// `hasMediaAttachment`, mais `body` e `footer`.
//
// Isto importa porque já erramos assim antes: a citação passou por testes
// verdes sem nunca ter funcionado, porque o campo que inventamos não existia
// no contrato e a biblioteca descartava sem dizer nada.

const ehVideo = (m) => m.tipo === 'video'
const ehImagem = (m) => m.tipo === 'image'

// Carrossel agrupa foto e vídeo, igual ao álbum: áudio e documento não têm
// card, e fingir que têm geraria uma mensagem que não renderiza.
//
// Com UMA mídia só não há o que deslizar — ali o envio comum é melhor, porque
// mostra a foto inteira em vez de um card.
export function podeVirarCarrossel (midias) {
  return Array.isArray(midias) && midias.length > 1 && midias.every((m) => ehImagem(m) || ehVideo(m))
}

// Os campos do upload no proto da mídia. São os mesmos que o álbum monta — a
// diferença é onde eles entram: lá numa mensagem própria, aqui no cabeçalho
// de um card.
function midiaDoUpload (midia, upload) {
  return {
    url: upload.url,
    directPath: upload.directPath,
    mediaKey: upload.mediaKey,
    fileSha256: upload.fileSha256,
    fileEncSha256: upload.fileEncSha256,
    fileLength: upload.fileLength,
    mediaKeyTimestamp: upload.mediaKeyTimestamp,
    mimetype: upload.mimetype || midia.mime
  }
}

// O BOTÃO DE UM CARD.
//
// `quick_reply` é o botão que MANDA UMA MENSAGEM de volta — é o que faz o
// "baixar este" funcionar sem guardar estado nenhum entre as duas mensagens: o
// `id` carrega o comando inteiro, com o argumento que aponta para aquele card,
// e chega ao bot como se a pessoa tivesse digitado. Ver `textoDeResposta` no
// adaptador, que lê o id de volta.
//
// `display_text` é o que a pessoa lê; `id` é o que o bot recebe. Os dois
// viajam no mesmo JSON porque é assim que o nativeFlow os transporta.
// O OUTRO BOTÃO: `cta_url`, que ABRE UMA PÁGINA em vez de mandar mensagem.
//
// É o que está por trás dos "jogos dentro do WhatsApp". Não existe HTML rodando
// dentro da bolha da mensagem, e nunca existiu: o que existe é um botão com
// uma URL, e o aplicativo abre aquela página numa janela dele. O HTML continua
// sendo um site, hospedado em outro lugar.
//
// `webview_interaction` é o que faz a página abrir DENTRO do WhatsApp, e não é
// documentado. A documentação da Meta para este botão diz que a URL carrega
// "no navegador padrão do dispositivo" e lista três campos (nome, rótulo,
// endereço); `webview_interaction`, `webview_presentation` e `merchant_url`
// não aparecem lá.
//
// MEDIDO em 23/10/2026, num número comum falando pelo protocolo de aparelho
// conectado: a página abriu dentro do WhatsApp, em tela cheia, com o endereço
// no cabeçalho e um X para fechar. Então o caminho não documentado funciona —
// e, exatamente por não ser documentado, pode parar sem aviso. É o mesmo
// risco do código colorido, que viaja marcado como conteúdo da Meta AI.
//
// E "dentro do WhatsApp" é POR CIMA da conversa, nunca dentro da bolha: HTML
// renderizado dentro de uma mensagem não existe em forma nenhuma.
//
// `merchant_url` repete a URL porque é assim que o campo viaja no nativeFlow.
//
// DIFERENÇA QUE IMPORTA para quem monta o comando: `quick_reply` volta para o
// bot (o id chega como se a pessoa tivesse digitado); `cta_url` é executado no
// aparelho e NÃO avisa o bot de nada. Um botão que abre página não serve para
// saber qual card a pessoa escolheu.
const PAGINA_EM_JANELA = Object.freeze({ webview_interaction: true, webview_presentation: 'full' })

// AS DUAS FORMAS DE BOTÃO QUE ABREM UMA PÁGINA.
//
// São dois nomes de botão diferentes no protocolo, os dois não documentados, e
// nenhum é "o certo" — por isso são escolha de quem monta o comando, e não
// constante no meu código. O mesmo motivo das formas de carrossel: quando um
// aparelho não desenha, quem recebeu "nada" troca a forma e testa de novo, em
// vez de esperar alguém editar arquivo.
//
//   link   - `cta_url` com os campos de webview. MEDIDO funcionando em
//            23/10/2026, num número comum: abriu dentro do WhatsApp, em tela
//            cheia, com o endereço no cabeçalho.
//   janela - `open_webview` com um objeto `link`. É a forma que o takeshi-bot
//            usa no comando de jogo dele (`src/commands/member/games/
//            tubes.js`), conferida no código: `in_app_webview: true` e
//            `full_screen: true`. Ele diz "tela cheia" em letras, o que
//            confirma que o jogo abre POR CIMA da conversa, não na bolha.
export const FORMAS_DE_PAGINA = Object.freeze(['link', 'janela'])

// AS VARIAÇÕES QUE O DIAGNÓSTICO DISPARA.
//
// Quando o aplicativo não desenha, não há erro em lugar nenhum: o envio é
// confirmado e a conversa fica vazia. Descobrir qual variação ele aceita, uma
// por vez, custa uma ida e volta com a pessoa a cada tentativa — então vão
// todas de uma vez, numeradas, e uma resposta só diz qual apareceu.
//
// É o mesmo recurso que o carrossel já tem (`estilo: diagnóstico`), pelo mesmo
// motivo. Cada entrada diz só o que MUDA em relação à base.
export const VARIACOES_DE_PAGINA = Object.freeze([
  { nome: 'link', forma: 'link' },
  { nome: 'janela', forma: 'janela' },
  // O takeshi manda um `quick_reply` ANTES do `open_webview` no comando de
  // jogo dele. Pode ser decoração, pode ser que o aplicativo só desenhe o
  // fluxo nativo quando há um botão de resposta junto — não dá para saber sem
  // mandar.
  { nome: 'janela+resposta', forma: 'janela', comCompanheiro: true },
  // Sem o embrulho de visualização única. Ele é truque de transporte, e o
  // carrossel aqui já mostrou que em certas formas ele atrapalha.
  { nome: 'janela sem embrulho', forma: 'janela', semEmbrulho: true },
  { nome: 'link sem embrulho', forma: 'link', semEmbrulho: true },
  // O envelope cruzado: cada forma com o envelope da outra, para separar o que
  // é do botão do que é do envelope.
  { nome: 'janela com params', forma: 'janela', comParams: true },
  { nome: 'link com header', forma: 'link', comHeader: true }
])

function botaoDePagina (botao) {
  // `janela` só vale para a forma `link`: é ela que tem como pedir o navegador
  // em vez da janela interna. A forma `open_webview` existe para abrir dentro.
  if (botao.forma === 'janela') {
    return {
      name: 'open_webview',
      buttonParamsJson: JSON.stringify({
        // Aqui o rótulo se chama `title`, não `display_text` — nome diferente
        // para a mesma coisa, e trocar um pelo outro deixa o botão sem texto.
        title: botao.texto,
        link: {
          url: botao.url,
          in_app_webview: botao.janela !== false,
          full_screen: botao.janela !== false
        }
      })
    }
  }
  return {
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({
      display_text: botao.texto,
      url: botao.url,
      merchant_url: botao.url,
      // Abrir fora, no navegador, é o comportamento de quem NÃO pede janela.
      ...(botao.janela === false ? {} : PAGINA_EM_JANELA)
    })
  }
}

function montarBotao (botao) {
  if (!botao?.texto) return []
  if (botao.url) return [botaoDePagina(botao)]
  if (!botao.comando) return []
  // `disabled: false` está no bot de referência e vai junto: mensagem
  // interativa que o servidor aceita e o aplicativo não desenha não deixa
  // rastro nenhum, então aqui a forma é copiada inteira em vez de reduzida ao
  // que parece bastar.
  return [{
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: botao.texto, id: botao.comando, disabled: false })
  }]
}

export function montarCard (midia, upload, { titulo, legenda, rodape, botao } = {}) {
  const campos = midiaDoUpload(midia, upload)
  return {
    header: {
      hasMediaAttachment: true,
      // O título fica no CABEÇALHO do card, acima da imagem, e é onde o bot de
      // referência em zapo-js põe o nome de cada item.
      ...(titulo ? { title: titulo } : {}),
      ...(ehVideo(midia) ? { videoMessage: campos } : { imageMessage: campos })
    },
    // `body` é o texto do card, e é onde a legenda fatiada entra.
    body: { text: legenda || '' },
    footer: { text: rodape || '' },
    // Card sem `nativeFlowMessage` não é aceito: o carrossel é uma mensagem
    // interativa, e card sem a parte interativa fica incompleto. Lista de
    // botões vazia é o que o bot de referência manda quando não há botão.
    //
    // `messageParamsJson` vazio acompanha, como no menu com botões que já
    // funciona aqui: o campo existe no proto e os clientes esperam encontrá-lo
    // — e mensagem interativa que o servidor aceita e o aplicativo não desenha
    // é o modo de falhar mais caro que existe, porque não deixa rastro.
    // SEM `messageParamsJson` no card.
    //
    // O takeshi-bot, que manda carrossel com botão em produção pela mesma
    // biblioteca, põe esse campo na mensagem de botões SOLTA e NÃO no card. É
    // a última diferença que sobrou entre a forma dele e a minha, e campo a
    // mais numa mensagem interativa é motivo conhecido de o aplicativo
    // descartar tudo calado.
    nativeFlowMessage: { buttons: montarBotao(botao) }
  }
}

// O CARROSSEL, na forma que outro bot em zapo-js manda em produção.
//
// A primeira versão com botão foi aceita pelo servidor e NÃO apareceu na
// conversa — o modo de falhar que não deixa rastro. A forma daqui agora é a do
// takeshi-bot (guiireal/takeshi-bot, ramo 9-beta, `src/services/
// interactiveMessages.js`), que usa a MESMA biblioteca:
//
//   - `messageVersion: 1` no carrossel;
//   - o texto de abertura em `body`, SEMPRE acompanhado de um `header` com
//     `hasMediaAttachment: false` — era o header que faltava, não o body;
//   - e o pacote inteiro embrulhado em `viewOnceMessageV2`. O exemplo deles diz
//     em letras: "viewOnce: true é o caminho usual no carrossel".
//
// O embrulho é OPCIONAL aqui porque o carrossel de fotos do /dow funciona sem
// ele há semanas, e não se troca o que está provado por simetria.
// AS FORMAS DO CARROSSEL, e por que são mais de uma.
//
// Mensagem interativa é aceita pelo servidor e desenhada (ou não) pelo
// aplicativo de quem recebe — e versões diferentes do WhatsApp desenham
// coisas diferentes. Quando não desenha, NÃO HÁ ERRO EM LUGAR NENHUM: o envio
// é confirmado, o comando é marcado como enviado, e a conversa fica vazia.
//
// Por isso a forma é escolha declarada, e não constante no meu código. Quem
// recebe "nada" troca a forma pelo painel e testa de novo, em vez de esperar
// alguém editar arquivo.
//
//   completo  - viewOnce + texto dentro (com header) + messageVersion. É a
//               forma do takeshi-bot, que usa esta mesma biblioteca.
//   simples   - só os cards, sem embrulho e sem texto dentro. É a forma que o
//               carrossel de fotos do /dow usa aqui há semanas, PROVADA neste
//               aparelho — o texto vai em mensagem separada.
//   semEmbrulho - o completo sem o viewOnce.
//   bizNoStanza - o <biz> mandado à mão, por `customNodes`. É A QUE ESTÁ NO AR
//               e a única PROVADA com botão dentro do card: é assim que o
//               /buscar entrega hoje. Ver NO_DE_FLUXO_NATIVO logo abaixo.
//   fluxoNoTopo - um `nativeFlowMessage` vazio no nível principal, para a
//               biblioteca montar o nó sozinha. A outra saída para o mesmo
//               problema, não testada neste aparelho.
//
// A declaração aceita ainda `botoes`, `menu` e `diagnóstico`, que NÃO são
// carrosséis: as duas primeiras são as formas de queda descritas adiante, e
// `diagnóstico` manda todas as formas numeradas de uma vez, para uma tentativa
// só responder qual delas aquele aparelho desenha. A lista completa vive em
// `declaracao.js` (`ESTILOS`), que é quem valida o que o painel grava.
export const ESTILOS_DE_CARROSSEL = Object.freeze(['completo', 'simples', 'semEmbrulho', 'bizNoStanza', 'fluxoNoTopo'])

// O NÓ QUE DIZ AO WHATSAPP "ISTO É NATIVE FLOW".
//
// Conferido na zapo-js 1.8.2 que está instalada aqui, e é a explicação mais
// provável para "carrossel sem botão aparece, com botão some":
//
//   resolveButtonAddonKindFrom(msg) olha `msg.interactiveMessage
//   .nativeFlowMessage` — o do NÍVEL PRINCIPAL. Ele não percorre
//   `carouselMessage.cards[].nativeFlowMessage`.
//
// Quando ele acha, a biblioteca anexa ao stanza um nó <biz> dizendo que a
// mensagem é native flow (`buildButtonAddonNode`). Com os botões só dentro dos
// cards, ele não acha nada, o nó não vai, e o aplicativo recebe um carrossel
// que não se anuncia como interativo — então não desenha, sem erro nenhum.
//
// Há duas saídas, e aqui estão as duas porque não dá para saber qual o
// aparelho aceita sem mandar:
//
//   bizNoStanza  - manda o <biz> na mão, por `customNodes`, que é a saída de
//                  escape que a própria biblioteca expõe.
//   fluxoNoTopo  - põe um `nativeFlowMessage` VAZIO no nível principal, para a
//                  biblioteca achar e montar o nó sozinha. Tem a vantagem de
//                  ela também ajustar `type` e `mediatype` do stanza, que o
//                  comentário dela diz ser exigido quando o <biz> vai junto
//                  (senão o servidor recusa com SMAX_INVALID 479).
export const NO_DE_FLUXO_NATIVO = Object.freeze({
  tag: 'biz',
  attrs: {},
  content: [{
    tag: 'interactive',
    attrs: { type: 'native_flow', v: '1' },
    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' }, content: undefined }]
  }]
})

// AS OUTRAS DUAS FORMAS DE OFERECER AS MESMAS OPÇÕES — hoje, QUEDA.
//
// ESTE BLOCO JÁ AFIRMOU O CONTRÁRIO, e a correção importa mais que o texto
// novo. Ele dizia: "carrossel COM BOTÃO não é desenhado pelo WhatsApp dele em
// forma nenhuma; o botão dentro do card é o que o aplicativo recusa". Era o que
// três deploys mostravam, e estava certo PARA AQUELE MOMENTO — antes do
// `bizNoStanza` existir.
//
// Hoje é falso, e dá para conferir sem acreditar em mim: a conexão
// `midia.buscar` está declarada com `estilo: bizNoStanza` e um botão dentro do
// card, o /buscar entrega esse carrossel, e o toque chega ao bot como
// `/musica <link>`. O que faltava não era o aplicativo aceitar o botão no card:
// era o stanza ANUNCIAR que a mensagem é native flow, e os botões só dentro
// dos cards não fazem a biblioteca anunciar sozinha (ver NO_DE_FLUXO_NATIVO).
//
// (O que continua valendo da versão antiga: o exemplo do takeshi-bot que eu
// citei como prova manda cards SEM botão. O código deles suporta; o exemplo não
// usa. Eu nunca tive a prova que disse ter — e a conclusão que tirei dali era
// errada nas duas direções.)
//
// Então estas duas formas deixaram de ser "o jeito que funciona" e passaram a
// ser o que sempre deveriam ter sido: a QUEDA para o aparelho que não desenhar
// botão no card. O carrossel continua saindo; o que muda é onde a escolha
// aparece. São as duas formas que o WhatsApp comum conhece há mais tempo:
//
//   botoes - até três botões de resposta rápida, lado a lado.
//   menu   - uma lista de escolha, que abre com o nome e a descrição de cada
//            item. É a MESMA forma do /menu interativo daqui.
//
// Nos dois, o que o toque manda é o `id`: o comando inteiro, com o argumento
// daquele item. Ver `textoDeResposta` no adaptador.
export const FORMAS_DE_ESCOLHA = Object.freeze(['botoes', 'menu'])

// Três é o teto dos botões de resposta rápida no WhatsApp comum. Mandar mais
// faz o aplicativo descartar a mensagem inteira — o mesmo silêncio de sempre.
const MAXIMO_DE_BOTOES = 3

export function montarBotoesDeEscolha (itens, { texto = null, rodape = null } = {}) {
  const botoes = itens.slice(0, MAXIMO_DE_BOTOES).filter((i) => i.botao?.texto && i.botao?.comando).map((i) => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: i.botao.texto, id: i.botao.comando })
  }))
  return {
    viewOnceMessageV2: {
      message: {
        interactiveMessage: {
          body: { text: texto || ' ' },
          ...(rodape ? { footer: { text: rodape } } : {}),
          nativeFlowMessage: { buttons: botoes, messageParamsJson: '' }
        }
      }
    }
  }
}

// UMA MENSAGEM COM UM BOTÃO QUE ABRE UMA PÁGINA.
//
// É o que faltava para o botão de página servir a um comando qualquer. Até
// aqui ele só existia DENTRO de um card de carrossel, montado a partir da
// resposta de uma conexão declarada — ou seja: para mandar uma página era
// preciso ter um serviço HTTP que devolvesse uma lista de itens com imagem.
// Para "manda esta página", isso é um caminho inteiro de volta por nada.
//
// A forma é a mesma de `montarBotoesDeEscolha`, trocando o `quick_reply` pelo
// `cta_url` — e vale repetir a diferença, porque ela é o que decide quando usar
// cada um: `quick_reply` VOLTA para o bot; `cta_url` é executado no aparelho e
// não avisa o bot de nada.
export function montarBotaoDePagina ({ texto = null, rodape = null, url, rotulo, janela = true, forma = 'link', variacao = {} }) {
  // O ENVELOPE MUDA COM A FORMA, e isso não é capricho: medido no aparelho do
  // dono, a forma `janela` foi ACEITA pelo servidor e não desenhada pelo
  // aplicativo — o envio foi confirmado e a conversa ficou vazia.
  //
  // A diferença estava no envelope, não no botão. O takeshi-bot, que manda
  // `open_webview` em produção, monta assim (conferido em
  // `src/services/interactiveMessages.js`):
  //
  //   body + header { hasMediaAttachment: false }, e NADA de messageParamsJson
  //
  // O header acompanhando o body é a mesma coisa que o comentário do carrossel
  // aqui em cima já registrava: "era o header que faltava, não o body". E
  // campo a mais numa mensagem interativa é motivo conhecido de o aplicativo
  // descartar tudo calado, então `messageParamsJson` sai junto.
  //
  // A forma `link` fica como está, porque está PROVADA assim neste aparelho —
  // não se troca o que funciona por simetria.
  const comoOTakeshi = forma === 'janela'
  const comHeader = variacao.comHeader ?? comoOTakeshi
  const comParams = variacao.comParams ?? !comoOTakeshi
  const botoes = montarBotao({ texto: rotulo, url, janela, forma })
  // O companheiro é um botão de resposta rápida ANTES do de página, como o
  // takeshi manda. O id vai vazio de propósito: tocá-lo não deve virar comando.
  const comCompanheiro = variacao.comCompanheiro === true
  const interactiveMessage = {
    body: { text: texto || ' ' },
    ...(comHeader ? { header: { hasMediaAttachment: false } } : {}),
    ...(rodape ? { footer: { text: rodape } } : {}),
    nativeFlowMessage: {
      buttons: comCompanheiro
        ? [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: '🎮', id: '🎮' }) }, ...botoes]
        : botoes,
      ...(comParams ? { messageParamsJson: '' } : {})
    }
  }
  // Sem embrulho: a mensagem interativa vai crua. O `viewOnceMessageV2` é
  // truque de transporte, e o carrossel aqui já mostrou que em certas formas
  // ele atrapalha em vez de ajudar.
  return variacao.semEmbrulho === true
    ? { interactiveMessage }
    : { viewOnceMessageV2: { message: { interactiveMessage } } }
}

export function montarMenuDeEscolha (itens, { texto = null, rodape = null, titulo = 'Escolha' } = {}) {
  const linhas = itens.slice(0, 10).filter((i) => i.botao?.comando).map((i, n) => ({
    title: (i.titulo || `Opção ${n + 1}`).slice(0, 24),
    description: [i.corpo, i.rodape].filter(Boolean).join(' · ').slice(0, 72),
    id: i.botao.comando
  }))
  return {
    interactiveMessage: {
      body: { text: texto || ' ' },
      ...(rodape ? { footer: { text: rodape } } : {}),
      nativeFlowMessage: {
        buttons: [{
          name: 'single_select',
          buttonParamsJson: JSON.stringify({ title: titulo, sections: [{ title: titulo, rows: linhas }] })
        }],
        messageParamsJson: ''
      }
    }
  }
}

export function montarCarrossel (cards, { texto = null, rodape = null, estilo = 'completo' } = {}) {
  const interactiveMessage = { carouselMessage: { cards } }
  // O `nativeFlowMessage` VAZIO no topo existe só para a biblioteca enxergar
  // "isto é native flow" e anexar o nó <biz> sozinha — os botões de verdade
  // continuam dentro de cada card.
  if (estilo === 'fluxoNoTopo') {
    interactiveMessage.nativeFlowMessage = { buttons: [], messageParamsJson: '' }
  }
  if (estilo !== 'simples') {
    interactiveMessage.carouselMessage.messageVersion = 1
    if (texto) {
      // O texto NUNCA vai sozinho: sem um header ao lado dele, a mensagem foi
      // aceita e não apareceu. Ver o histórico deste arquivo.
      interactiveMessage.body = { text: texto }
      interactiveMessage.header = { hasMediaAttachment: false }
    }
    if (rodape) interactiveMessage.footer = { text: rodape }
  }
  return estilo === 'completo'
    ? { viewOnceMessageV2: { message: { interactiveMessage } } }
    : { interactiveMessage }
}

// As opções de ENVIO daquela forma — hoje só o nó do stanza, quando é o caso.
export function opcoesDoCarrossel (estilo) {
  return estilo === 'bizNoStanza' ? { customNodes: [NO_DE_FLUXO_NATIVO] } : undefined
}
