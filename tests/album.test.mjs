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
import { fatiarLegenda, montarFilho, montarPai, podeVirarAlbum } from '../src/engine/album.js'
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

// QUEM DECIDE A LEGENDA NÃO É AQUI, e isso mudou de propósito.
//
// Antes `montarFilho` escrevia a legenda só na primeira mídia e descartava
// para as outras. O dono apontou o limite disso: a legenda do carrossel
// comporta menos que a de uma foto solta, e um post com texto longo chegava
// cortado. O desenho dele: "a legenda na primeira foto e o que não couber vai
// jogando pra segunda, terceira e assim sucessivamente".
//
// Então o fatiamento virou função própria (`fatiarLegenda`) e esta aqui só
// escreve o pedaço que recebeu. Uma decisão a menos escondida na montagem.
check('a mídia leva a fatia que recebeu', filho.imageMessage.caption === 'olha')
const segundo = montarFilho(img('b'), upload, { chatId: 'g@g.us', paiId: 'PAI1', indice: 2, legenda: 'resto da legenda' })
check('e a segunda leva a FATIA dela, não a repetição da primeira', segundo.imageMessage.caption === 'resto da legenda')
const semLegenda = montarFilho(img('c'), upload, { chatId: 'g@g.us', paiId: 'PAI1', indice: 3, legenda: null })
check('mídia sem fatia vai sem legenda nenhuma', semLegenda.imageMessage.caption === undefined)

// --- o fatiamento -------------------------------------------------------
{
  const curta = fatiarLegenda('bom dia', 3, 100)
  check('legenda que cabe fica inteira na primeira', JSON.stringify(curta.fatias) === '["bom dia"]' && curta.sobra === '')

  // Corta em PARÁGRAFO quando dá: partir no meio de uma frase para ganhar
  // vinte caracteres deixa o texto pior do que entrou.
  const comParagrafos = ['Primeiro parágrafo aqui.', 'Segundo parágrafo aqui.', 'Terceiro parágrafo aqui.'].join('\n\n')
  const porParagrafo = fatiarLegenda(comParagrafos, 3, 30)
  check('corta no fim do parágrafo quando ele cabe', porParagrafo.fatias[0] === 'Primeiro parágrafo aqui.', porParagrafo.fatias[0])
  check('e a seguinte começa no parágrafo seguinte', porParagrafo.fatias[1] === 'Segundo parágrafo aqui.', porParagrafo.fatias[1])

  // Sem parágrafo, corta no espaço — nunca no meio da palavra.
  const corrido = 'palavra '.repeat(20).trim()
  const porEspaco = fatiarLegenda(corrido, 3, 30)
  check('sem parágrafo, corta no espaço', porEspaco.fatias.every((f) => !f.startsWith('vra') && !f.endsWith('pala')),
    JSON.stringify(porEspaco.fatias))
  check('e nenhuma fatia passa do limite', porEspaco.fatias.every((f) => f.length <= 30),
    JSON.stringify(porEspaco.fatias.map((f) => f.length)))

  // Palavra sozinha maior que o pedaço: aí sim corta seco, porque a
  // alternativa é não entregar nada.
  const palavrao = 'a'.repeat(80)
  const seco = fatiarLegenda(palavrao, 2, 30)
  check('palavra maior que o pedaço é cortada no limite', seco.fatias[0].length === 30, String(seco.fatias[0].length))

  // O QUE SOBRA NÃO SOME. Cortar o fim da legenda em silêncio seria sumir com
  // parte do post — quem entrega manda a sobra num texto depois.
  const grande = 'z'.repeat(500)
  const sobrou = fatiarLegenda(grande, 2, 100)
  check('o que não coube volta como sobra', sobrou.sobra.length === 300, String(sobrou.sobra.length))
  check('e nunca mais fatias do que mídias', sobrou.fatias.length === 2, String(sobrou.fatias.length))

  check('sem legenda, nenhuma fatia', JSON.stringify(fatiarLegenda(null, 3, 100)) === '{"fatias":[],"sobra":""}')
}

// --- ponta a ponta -------------------------------------------------------
//
// O PADRÃO MUDOU, e a razão está na reclamação do dono: "isso não é carrossel,
// o sistema está mandando uma foto atrás da outra. Eu quero um carrossel
// bonitinho, uma única mensagem com as fotos uma do lado da outra".
//
// Álbum e carrossel são coisas diferentes com o mesmo nome em português. O
// álbum são N mensagens que o aplicativo agrupa; o carrossel é UMA mensagem
// com cards. Ele queria a segunda, e eu tinha entregado a primeira.
const comando = (id, extra = {}) => ({
  id, commandType: 'media.download',
  payload: { chatId: 'g@g.us', url: 'https://insta/p/x', ackText: null, errorText: 'erro', ...extra }
})
const tresFotos = { midias: [img('1.jpg'), img('2.jpg'), img('3.jpg')], foraPorTamanho: 0, descricao: null }

// Sem pedir nada, o padrão é o CARROSSEL — uma mensagem só.
//
// O CASO ABAIXO PASSA PELO MOTOR DE PROPÓSITO, e não só pela entrega: o padrão
// estava escrito em DOIS lugares, e o motor preenchia "album" em todo comando
// que não escolhia. O gateway nunca via "não pediu nada", então o carrossel
// nunca acontecia — e o log dizia `pedido=album` para um comando que não
// pedia álbum nenhum. Testar só a entrega deixaria isso passar de novo.
{
  const envios = []
  const client = {
    message: {
      send: async (chat, conteudo) => { envios.push(conteudo); return { id: 'MSG1' } },
      upload: async () => upload
    }
  }
  await executarComandos(client, [comando('c0')],
    { execucoes: { confirmar: async () => {} } },
    { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => tresFotos }) })

  check('o padrão manda UMA mensagem', envios.length === 1, String(envios.length))
  const cards = envios[0]?.interactiveMessage?.carouselMessage?.cards
  check('e ela é um carrossel com um card por mídia', cards?.length === 3, String(cards?.length))
  check('cada card carrega a mídia no cabeçalho',
    cards.every((c) => c.header?.hasMediaAttachment === true && c.header?.imageMessage?.url === upload.url))
  // Card sem a parte interativa fica incompleto — o carrossel É uma mensagem
  // interativa, mesmo quando não tem botão nenhum.
  check('e tem a parte interativa, mesmo sem botão',
    cards.every((c) => Array.isArray(c.nativeFlowMessage?.buttons)))
}

// --- álbum: continua existindo, agora a pedido --------------------------
{
  const envios = []
  const client = {
    message: {
      send: async (chat, conteudo) => { envios.push(conteudo); return { id: 'PAI1' } },
      upload: async () => upload
    }
  }
  await executarComandos(client, [comando('c1', { entrega: 'album' })],
    { execucoes: { confirmar: async () => {} } },
    { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => tresFotos }) })

  check('pedindo álbum, sai o pai e as três mídias', envios.length === 4, String(envios.length))
  check('o primeiro envio é o álbum', Boolean(envios[0].albumMessage))
  check('e os três seguintes se prendem a ele',
    envios.slice(1).every((e) => e.messageContextInfo?.messageAssociation?.parentMessageKey?.id === 'PAI1'))
  check('em ordem', envios.slice(1).map((e) => e.messageContextInfo.messageAssociation.messageIndex).join(',') === '1,2,3')
}

// --- a escada: carrossel recusado cai para ÁLBUM, álbum para SEQUÊNCIA ---
//
// Mensagem interativa depende do aplicativo de quem recebe. A queda não é
// tratamento de erro, é parte do desenho — igual ao menu com botões.
{
  const envios = []
  const client = {
    message: {
      send: async (chat, conteudo) => {
        if (conteudo.interactiveMessage) throw new Error('carrossel recusado pelo servidor')
        envios.push(conteudo)
        return { id: 'PAI1' }
      },
      upload: async () => upload
    }
  }
  await executarComandos(client, [comando('c1b')],
    { execucoes: { confirmar: async () => {} } },
    { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => tresFotos }) })

  check('carrossel recusado: cai para álbum', Boolean(envios[0]?.albumMessage), JSON.stringify(Object.keys(envios[0] || {})))
  check('e as três mídias chegam assim mesmo', envios.length === 4, String(envios.length))
}
{
  const envios = []
  const client = {
    message: {
      send: async (chat, conteudo) => {
        if (conteudo.interactiveMessage || conteudo.albumMessage) throw new Error('recusado pelo servidor')
        envios.push(conteudo)
        return { id: 'X' }
      },
      upload: async () => upload
    }
  }
  await executarComandos(client, [comando('c1c')],
    { execucoes: { confirmar: async () => {} } },
    { mediaRefCache: {}, criarBaixador: () => ({ baixar: async () => tresFotos }) })

  check('os dois recusados: as mídias ainda chegam, uma a uma', envios.length === 3, String(envios.length))
  check('e sem associação órfã', envios.every((e) => e.type === 'image' && !e.messageContextInfo))
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
  await executarComandos(client, [comando('c2', { entrega: 'album' })],
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

// --- o padrão vive num lugar só -----------------------------------------
//
// Este caso olha o que o MOTOR emite. Era aqui que o padrão duplicado morava:
// o documento não escolhia entrega, o motor preenchia "album", e o carrossel
// nunca acontecia por mais correto que o lado da entrega estivesse.
{
  const { abrirBanco } = await import('../src/engine/server/db.js')
  const { avaliarEvento } = await import('../src/engine/server/evaluator.js')
  const { criarServicoAutomacoes } = await import('../src/engine/server/automationsService.js')

  const db = abrirBanco(':memory:')
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
  const servico = criarServicoAutomacoes(db)

  const publicar = (id, config) => {
    servico.criarEPublicar({
      id,
      document: {
        schemaVersion: 1,
        id,
        revision: 1,
        enabled: true,
        name: id,
        scope: { include: [{ kind: 'everywhere' }], exclude: [] },
        inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
        responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
        flow: {
          nodes: [
            { id: 'g', type: 'trigger.command', config: { command: '/dow', match: 'exact_or_args', allowFrom: 'any' } },
            { id: 'd', type: 'action.media.download', config: { url: '{{message.link}}', ...config } }
          ],
          edges: [{ from: 'g', to: 'd', on: 'matched' }]
        }
      }
    })
    db.prepare('UPDATE automations SET deployment_mode = ?, enabled = ? WHERE id = ?').run('live', 0, id)
  }

  publicar('sem-escolha', {})
  publicar('com-escolha', { delivery: 'separate' })

  let n = 0
  const rodar = (id) => {
    n++
    db.prepare('UPDATE automations SET enabled = 0').run()
    db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
    const r = avaliarEvento(db, {
      provider: 'zapo',
      accountId: 'conta',
      eventId: `conta:c:s:e${n}`,
      occurredAt: agora,
      replay: false,
      chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
      sender: { id: '5511@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
      message: { kind: 'text', text: '/dow https://instagram.com/p/x' },
      providerRef: { provider: 'zapo', id: `e${n}` }
    })
    return (r.results || []).find((x) => x.automationId === id)?.commands[0]?.payload
  }

  const semEscolha = rodar('sem-escolha')
  check('comando que não escolhe entrega NÃO manda entrega nenhuma',
    !('entrega' in semEscolha), JSON.stringify(semEscolha.entrega))
  const comEscolha = rodar('com-escolha')
  check('e quem escolhe continua mandando o que escolheu', comEscolha.entrega === 'separate', comEscolha.entrega)
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ÁLBUM PASSARAM')
process.exit(falhas ? 1 : 0)
