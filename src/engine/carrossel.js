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
  return [{
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: botao.texto, id: botao.comando })
  }]
}

export function montarCard (midia, upload, { legenda, rodape, botao } = {}) {
  const campos = midiaDoUpload(midia, upload)
  return {
    header: {
      hasMediaAttachment: true,
      ...(ehVideo(midia) ? { videoMessage: campos } : { imageMessage: campos })
    },
    // `body` é o texto do card, e é onde a legenda fatiada entra.
    body: { text: legenda || '' },
    footer: { text: rodape || '' },
    // Card sem `nativeFlowMessage` não é aceito: o carrossel é uma mensagem
    // interativa, e card sem a parte interativa fica incompleto. Lista de
    // botões vazia é o que o bot de referência manda quando não há botão.
    nativeFlowMessage: { buttons: montarBotao(botao) }
  }
}

export function montarCarrossel (cards, cabecalho = null) {
  return {
    interactiveMessage: {
      // O texto acima dos cards. Numa busca é ele que diz o que foi buscado —
      // sem isso o carrossel chega sem assunto, e dez minutos depois ninguém
      // lembra qual pergunta gerou aqueles cards.
      ...(cabecalho ? { body: { text: cabecalho } } : {}),
      carouselMessage: { cards }
    }
  }
}
