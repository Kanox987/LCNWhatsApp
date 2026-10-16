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
function montarBotao (botao) {
  if (!botao?.texto || !botao?.comando) return []
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
export function montarCarrossel (cards, { texto = null, rodape = null, viewOnce = false } = {}) {
  const interactiveMessage = { carouselMessage: { cards, messageVersion: 1 } }
  if (texto) {
    interactiveMessage.body = { text: texto }
    interactiveMessage.header = { hasMediaAttachment: false }
  }
  if (rodape) interactiveMessage.footer = { text: rodape }
  return viewOnce ? { viewOnceMessageV2: { message: { interactiveMessage } } } : { interactiveMessage }
}
