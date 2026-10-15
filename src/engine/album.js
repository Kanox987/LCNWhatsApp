// Álbum (carrossel) de mídias no WhatsApp.
//
// POR QUE ISTO EXISTE EM VEZ DE N MENSAGENS SOLTAS
//
// Um post de 10 fotos do Instagram entregue como 10 mensagens separadas vira
// uma parede de rolagem. O WhatsApp tem álbum de verdade, e o app agrupa as
// mídias num bloco só.
//
// POR QUE É PROTO CRU, E POR QUE ISSO NÃO É O ERRO DA CITAÇÃO
//
// A `zapo-js` tem 16 tipos prontos de conteúdo (`type: 'image'`, `'video'`…) e
// nenhum deles é álbum. Mas isso é a camada de conveniência, não o limite da
// biblioteca: `WaSendMessageContent` inclui `Proto.IMessage`, ou seja, mandar
// proto montado à mão é caminho de primeira classe e documentado — a própria
// doc de `message.upload()` diz que ela serve para "pre-upload once and
// reference it across sends, or build custom protos".
//
// A citação falhou porque INVENTAMOS um campo (`contextInfo.quoted`) que não
// existia no contrato, e a biblioteca descartou sem erro. Aqui é o contrário:
// todos os campos abaixo vêm do proto oficial —
// `Message.albumMessage`, `AlbumMessage.expectedImageCount/expectedVideoCount`,
// e `MessageContextInfo.messageAssociation` com `AssociationType.MEDIA_ALBUM`.
//
// O QUE AINDA SÓ O TESTE AO VIVO RESPONDE
//
// Protocolo existir não garante que o servidor aceite de um bot, nem que o app
// de quem recebe agrupe. Por isso a queda para envio em sequência NÃO é
// tratamento de erro — é parte do desenho, como já é no menu com botões: as
// mídias sempre chegam, agrupadas se der, uma a uma se não der.

// waproto.MessageAssociation.AssociationType.MEDIA_ALBUM
const MEDIA_ALBUM = 1

const ehImagem = (m) => m.tipo === 'image'
const ehVideo = (m) => m.tipo === 'video'

// Álbum só agrupa foto e vídeo. Áudio e documento vão soltos de qualquer jeito
// — o WhatsApp não os coloca em álbum, e fingir que sim geraria um pai com
// contagem que nunca fecha.
export function podeVirarAlbum (midias) {
  return Array.isArray(midias) && midias.length > 1 && midias.every((m) => ehImagem(m) || ehVideo(m))
}

export function montarPai (midias) {
  return {
    albumMessage: {
      expectedImageCount: midias.filter(ehImagem).length,
      expectedVideoCount: midias.filter(ehVideo).length
    }
  }
}

// Quanto de legenda cabe em CADA mídia do álbum.
//
// O dono apontou que a legenda do carrossel comporta menos que a de uma foto
// solta. Eu não sei o número exato — não tem como medir daqui, e chutar um
// valor "seguro" bem baixo cortaria legenda à toa. 1024 é o limite conhecido
// de legenda de mídia no WhatsApp, e é por onde se começa: se a prática
// mostrar que é menos, é esta constante que muda, e o fatiamento abaixo
// funciona igual para qualquer número.
export const LIMITE_LEGENDA_POR_MIDIA = 1024

// A legenda dividida entre as mídias, na ordem.
//
// O desenho é do dono: "colocar a legenda na primeira foto e o que não couber
// vai jogando pra segunda, terceira e assim sucessivamente". É melhor que
// truncar porque nada se perde, e melhor que repetir porque o mesmo texto dez
// vezes no mesmo bloco é ruído.
//
// Corta em PARÁGRAFO quando dá, em ESPAÇO quando não dá, e no limite seco só
// quando a palavra sozinha é maior que o pedaço — partir palavra no meio é a
// última opção, não a primeira.
//
// O que sobrar depois da última mídia volta como `sobra`: quem entrega manda
// num texto depois. Cortar calado seria sumir com o fim da legenda.
export function fatiarLegenda (texto, quantidade, limite = LIMITE_LEGENDA_POR_MIDIA) {
  const inteiro = typeof texto === 'string' ? texto : ''
  if (!inteiro || quantidade < 1) return { fatias: [], sobra: '' }
  if (inteiro.length <= limite) return { fatias: [inteiro], sobra: '' }

  const fatias = []
  let resto = inteiro
  while (fatias.length < quantidade && resto) {
    if (resto.length <= limite) {
      fatias.push(resto)
      resto = ''
      break
    }
    const janela = resto.slice(0, limite + 1)
    // Procura a quebra mais tardia que ainda cabe: primeiro fim de parágrafo,
    // depois fim de linha, depois espaço.
    let corte = -1
    for (const marca of ['\n\n', '\n', ' ']) {
      const achou = janela.lastIndexOf(marca)
      if (achou > 0) { corte = achou + (marca === ' ' ? 0 : marca.length); break }
    }
    if (corte <= 0) corte = limite
    fatias.push(resto.slice(0, corte).trim())
    resto = resto.slice(corte).trim()
  }
  return { fatias: fatias.filter((f) => f), sobra: resto }
}

// O filho carrega os campos do upload no proto da mídia, mais a associação que
// o prende ao pai. `messageIndex` começa em 1 e é o que dá ordem ao álbum.
export function montarFilho (midia, upload, { chatId, paiId, indice, legenda }) {
  const campos = {
    url: upload.url,
    directPath: upload.directPath,
    mediaKey: upload.mediaKey,
    fileSha256: upload.fileSha256,
    fileEncSha256: upload.fileEncSha256,
    fileLength: upload.fileLength,
    mediaKeyTimestamp: upload.mediaKeyTimestamp,
    mimetype: upload.mimetype || midia.mime
  }
  // A legenda já vem FATIADA: cada mídia recebe o pedaço dela, na ordem. Quem
  // divide é `fatiarLegenda`, e quem chama passa a fatia certa — aqui não se
  // decide nada sobre o texto.
  if (legenda) campos.caption = legenda

  return {
    [ehVideo(midia) ? 'videoMessage' : 'imageMessage']: campos,
    messageContextInfo: {
      messageAssociation: {
        associationType: MEDIA_ALBUM,
        parentMessageKey: { id: paiId, remoteJid: chatId, fromMe: true },
        messageIndex: indice
      }
    }
  }
}
