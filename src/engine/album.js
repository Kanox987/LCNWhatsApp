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
  // Só a PRIMEIRA leva legenda: repetir em cada uma faria o mesmo texto
  // aparecer dez vezes no mesmo bloco.
  if (indice === 1 && legenda) campos.caption = legenda

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
