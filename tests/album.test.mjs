// Álbum (carrossel) de mídias.
//
// O defeito que abriu este caminho: `escolherMidia` no downloader ordenava as
// mídias do trabalho e devolvia UMA. Um post de 10 fotos do Instagram baixava
// as 10 e entregava 1; num post misto, o vídeo ganhava da imagem e as fotos
// sumiam sem aviso. Isso vinha sendo confundido com bloqueio de IP.
//
// A parte delicada é o proto cru. Estes casos travam os campos contra o proto
// oficial da zapo-js — é o que separa isto do erro da citação, onde inventamos
// um campo que a biblioteca descartava em silêncio.
import { montarFilho, montarPai, podeVirarAlbum } from '../src/engine/album.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const img = (nome) => ({ tipo: 'image', mime: 'image/jpeg', nome, buffer: Buffer.alloc(8) })
const vid = (nome) => ({ tipo: 'video', mime: 'video/mp4', nome, buffer: Buffer.alloc(8) })

// --- quando álbum faz sentido --------------------------------------------
check('uma mídia só não vira álbum', !podeVirarAlbum([img('a')]))
check('duas fotos viram álbum', podeVirarAlbum([img('a'), img('b')]))
check('foto e vídeo juntos viram álbum — o proto tem contagem para os dois',
  podeVirarAlbum([img('a'), vid('b')]))
// Álbum do WhatsApp agrupa só foto e vídeo; declarar um pai que conta áudio
// deixaria uma contagem que nunca fecha.
check('áudio no meio impede o álbum', !podeVirarAlbum([img('a'), { tipo: 'audio', mime: 'audio/ogg', nome: 'c', buffer: Buffer.alloc(1) }]))
check('documento no meio impede o álbum', !podeVirarAlbum([img('a'), { tipo: 'document', mime: 'application/pdf', nome: 'd', buffer: Buffer.alloc(1) }]))

// --- o pai declara o que vem ----------------------------------------------
const pai = montarPai([img('a'), img('b'), vid('c')])
check('o pai é um albumMessage', Object.keys(pai)[0] === 'albumMessage')
check('contando as fotos', pai.albumMessage.expectedImageCount === 2, String(pai.albumMessage.expectedImageCount))
check('e contando os vídeos separadamente', pai.albumMessage.expectedVideoCount === 1, String(pai.albumMessage.expectedVideoCount))

// --- o filho se prende ao pai ---------------------------------------------
const upload = {
  url: 'https://mmg/x', directPath: '/v/t62', mediaKey: new Uint8Array(32),
  fileSha256: new Uint8Array(32), fileEncSha256: new Uint8Array(32),
  fileLength: 8, mediaKeyTimestamp: 1700000000, mimetype: 'image/jpeg'
}
const filho = montarFilho(img('a'), upload, { chatId: 'g@g.us', paiId: 'PAI1', indice: 1, legenda: 'olha' })
check('foto vira imageMessage', Boolean(filho.imageMessage))
check('vídeo vira videoMessage', Boolean(montarFilho(vid('b'), upload, { chatId: 'g@g.us', paiId: 'PAI1', indice: 2 }).videoMessage))
check('os campos do upload vão para o proto da mídia',
  filho.imageMessage.url === upload.url && filho.imageMessage.directPath === upload.directPath &&
  filho.imageMessage.mediaKeyTimestamp === upload.mediaKeyTimestamp)

const assoc = filho.messageContextInfo?.messageAssociation
check('a associação fica em messageContextInfo, onde o proto a define', Boolean(assoc))
check('do tipo MEDIA_ALBUM (1)', assoc.associationType === 1, String(assoc.associationType))
check('apontando para a chave do pai', assoc.parentMessageKey.id === 'PAI1' && assoc.parentMessageKey.remoteJid === 'g@g.us')
check('marcada como nossa (fromMe)', assoc.parentMessageKey.fromMe === true)
check('com índice começando em 1', assoc.messageIndex === 1)

// Legenda repetida em cada mídia apareceria dez vezes no mesmo bloco.
check('só a primeira mídia leva legenda', filho.imageMessage.caption === 'olha')
const segundo = montarFilho(img('b'), upload, { chatId: 'g@g.us', paiId: 'PAI1', indice: 2, legenda: 'olha' })
check('e a segunda não repete a legenda', segundo.imageMessage.caption === undefined)

// --- ponta a ponta: álbum aceito -----------------------------------------
const comando = (id) => ({
  id, commandType: 'media.download',
  payload: { chatId: 'g@g.us', url: 'https://insta/p/x', ackText: null, errorText: 'erro' }
})
const tresFotos = { midias: [img('1.jpg'), img('2.jpg'), img('3.jpg')], foraPorTamanho: 0, descricao: null }

{
  const envios = []
  const client = {
    message: {
      send: async (chat, conteudo) => { envios.push(conteudo); return { id: 'PAI1' } },
      upload: async () => upload
    }
  }
  await executarComandos(client, [comando('c1')],
    { execucoes: { confirmar: async () => {} } },
    { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => tresFotos }) })

  check('sai o pai e as três mídias', envios.length === 4, String(envios.length))
  check('o primeiro envio é o álbum', Boolean(envios[0].albumMessage))
  check('e os três seguintes se prendem a ele',
    envios.slice(1).every((e) => e.messageContextInfo?.messageAssociation?.parentMessageKey?.id === 'PAI1'))
  check('em ordem', envios.slice(1).map((e) => e.messageContextInfo.messageAssociation.messageIndex).join(',') === '1,2,3')
}

// --- ponta a ponta: álbum RECUSADO cai para sequência ---------------------
//
// Esta é a parte que precisa funcionar de verdade. O protocolo ter álbum não
// garante que o servidor aceite de um bot; se a queda falhar, a pessoa não
// recebe nada — que é pior que o defeito original.
{
  const envios = []
  const client = {
    message: {
      send: async (chat, conteudo) => {
        if (conteudo.albumMessage) throw new Error('album recusado pelo servidor')
        envios.push(conteudo)
        return { id: 'X' }
      },
      upload: async () => upload
    }
  }
  await executarComandos(client, [comando('c2')],
    { execucoes: { confirmar: async () => {} } },
    { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => tresFotos }) })

  check('álbum recusado: as três mídias chegam assim mesmo', envios.length === 3, String(envios.length))
  check('e chegam como mídia comum, sem associação órfã',
    envios.every((e) => e.type === 'image' && !e.messageContextInfo))
}

// --- o que ficou de fora por tamanho é dito ------------------------------
{
  const envios = []
  const client = { message: { send: async (chat, c) => { envios.push(c); return { id: 'X' } }, upload: async () => upload } }
  await executarComandos(client, [comando('c3')],
    { execucoes: { confirmar: async () => {} } },
    { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => ({ midias: [img('1.jpg')], foraPorTamanho: 2, descricao: null }) }) })

  const textos = envios.filter((e) => e.type === 'text').map((e) => e.text)
  check('entregar 1 de 3 não passa calado', textos.some((t) => /grandes demais/.test(t)), JSON.stringify(textos))
}

// --- quem PEDIU separado recebe separado --------------------------------
//
// O álbum é o padrão, não um teto: quem monta o comando escolhe, pelo campo
// `entrega` do .lcn ("entrega: separado").
{
  const envios = []
  const client = { message: { send: async (chat, c) => { envios.push(c); return { id: 'X' } }, upload: async () => upload } }
  await executarComandos(client, [{
    id: 'c4', commandType: 'media.download',
    payload: { chatId: 'g@g.us', url: 'https://insta/p/x', entrega: 'separate', errorText: 'erro' }
  }], { execucoes: { confirmar: async () => {} } },
  { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => tresFotos }) })

  check('com entrega "separado", nenhum álbum é aberto', !envios.some((e) => e.albumMessage))
  check('e as três mídias saem como mensagens comuns', envios.length === 3 && envios.every((e) => e.type === 'image'),
    String(envios.length))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ÁLBUM PASSARAM')
process.exit(falhas ? 1 : 0)
