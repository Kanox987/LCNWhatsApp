// Conexões que já vêm declaradas — e que são EDITÁVEIS como qualquer outra.
//
// O dono pediu "as duas: prontas e customizáveis". A razão de existirem prontas
// não é conveniência: é que elas são o exemplo de como se declara uma. Quem
// quiser ligar uma IA abre a do download, vê a forma, e escreve a sua.
//
// O que está aqui hoje é EXATAMENTE o protocolo que vive fixo dentro de
// src/downloader.js:
//
//   POST {endereço}/download   {url, modo}     -> { job }
//   GET  {endereço}/jobs/{job}                 -> { estado, midias[], descricao, erro }
//   estados "na_fila" e "baixando" significam "ainda não acabou"
//
// Trazer isso para cá é a diferença entre o dono PODER trocar o serviço de
// download e ter que me pedir.
import { FORMAS_DE_RESPOSTA } from './declaracao.js'

// O acompanhamento de trabalho, declarado uma vez: as duas funções de download
// compartilham o mesmo protocolo, e repetir o bloco convidaria as duas a
// divergirem no dia em que uma fosse ajustada.
// Música: o mesmo acompanhamento, com OUTRA legenda.
//
// A legenda de um post do Instagram é a descrição dele, e por isso o download
// usa `descricao`. Em música a mesma chave traz o texto que o YouTube gera
// sozinho — "Provided to YouTube by...", produtor, compositor, parágrafos — e
// quem pediu uma música quer ver o nome dela. Por isso a função de música
// declara `titulo`, e é só o que muda entre as duas.
const TRABALHO_DE_MUSICA = Object.freeze({
  forma: FORMAS_DE_RESPOSTA.trabalho,
  campoDoTrabalho: 'job',
  caminhoDeAcompanhamento: '/jobs/{job}',
  campoDoEstado: 'estado',
  estadosEmAndamento: ['na_fila', 'baixando'],
  campoDoResultado: 'midias',
  // A CAPA PRIMEIRO, com a legenda; a música logo abaixo. O serviço entrega na
  // ordem do disco (01 áudio, 02 capa) e aqui a ordem é a da conversa.
  ordemDosTipos: ['foto', 'áudio'],
  // A legenda da capa, escrita com o que o serviço devolve sobre a faixa.
  // `|tempo` transforma os 299 segundos em 4:59.
  // `??` é "o primeiro que tiver valor": faixa e artista só existem quando o
  // vídeo é do YouTube Music; nos outros, o que o serviço tem é o título do
  // vídeo e o canal. Sem as alternativas, a conversa recebia
  // "{{metadados.faixa}}" escrito — aconteceu, com "coração de pedra".
  modeloDaDescricao: '🎵 *{{metadados.faixa ?? titulo}}*\n👤 {{metadados.artista ?? metadados.autor}}\n⏱️ {{duracao ?? metadados.duracao|tempo}}\n\n🎶🎧🎼',
  // Queda, quando o serviço não souber faixa e artista (vídeo que não é do
  // YouTube Music): o título do vídeo ainda diz o que chegou.
  campoDaDescricao: 'titulo',
  campoDoErro: 'erro'
})

const TRABALHO_DE_DOWNLOAD = Object.freeze({
  forma: FORMAS_DE_RESPOSTA.trabalho,
  campoDoTrabalho: 'job',
  caminhoDeAcompanhamento: '/jobs/{job}',
  campoDoEstado: 'estado',
  estadosEmAndamento: ['na_fila', 'baixando'],
  campoDoResultado: 'midias',
  campoDoErro: 'erro'
})

// O SERVIÇO DE IMAGEM, declarado.
//
// Mesmo princípio da conexão de download: o protocolo real do serviço vira
// DADO, não código meu. Quem trocar a LCNimg por outra API de imagem reescreve
// esta declaração na aba Conexões e os comandos continuam valendo — era isso
// que o dono queria ao dizer "não existe problema em criar a função baixar que
// recebe um link ou baixar2 que recebe o mesmo link com outra configuração".
//
// Três coisas valem para todas as funções daqui:
//
//   - `resposta: json` é entrada obrigatória com lista de um item só. O serviço
//     devolve o arquivo cru por padrão, e é o JSON com `arquivo_base64` que
//     cabe neste transporte. Lista fechada de um item parece esquisito e é
//     deliberado: quem editar para outra coisa é recusado na publicação, em vez
//     de descobrir na primeira chamada.
//   - a resposta é a forma `arquivo`: o conteúdo vem em `arquivo_base64` e o
//     tipo em `mime`.
//   - o erro vem em `mensagem`, e é uma frase feita para quem usou o comando
//     ("Ficou com 151,5 KB e o limite é 2,9 KB, mesmo em qualidade 15 e 8 fps").
const RESPOSTA_JSON = Object.freeze({
  nome: 'resposta', tipo: 'opção', opcoes: ['json'], obrigatoria: false, padrao: 'json'
})

function arquivoDeVolta (tipo) {
  return {
    forma: FORMAS_DE_RESPOSTA.arquivo,
    campo: 'arquivo_base64',
    campoDoMime: 'mime',
    ...(tipo ? { tipo } : {}),
    campoDoErro: 'mensagem'
  }
}

const FUNCOES_DE_IMAGEM = Object.freeze([
  {
    nome: 'figurinha',
    descricao: 'Transforma foto, vídeo ou GIF em figurinha. Vídeo vira figurinha animada. Grava o nome do pacote e o autor que o WhatsApp mostra.',
    metodo: 'POST',
    caminho: '/figurinha',
    // Vídeo leva segundos; com `remover_fundo` entra a IA, que leva ~9 s.
    esperaSegundos: 120,
    entradas: [
      { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
      { nome: 'pacote', tipo: 'texto', obrigatoria: false },
      { nome: 'autor', tipo: 'texto', obrigatoria: false },
      { nome: 'tamanho', tipo: 'número', obrigatoria: false },
      { nome: 'modo', tipo: 'opção', opcoes: ['transparente', 'quadrado', 'esticar'], obrigatoria: false },
      { nome: 'fundo', tipo: 'texto', obrigatoria: false },
      { nome: 'remover_fundo', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      { nome: 'melhorar', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      { nome: 'duracao_max', tipo: 'número', obrigatoria: false },
      { nome: 'inicio', tipo: 'número', obrigatoria: false },
      // `animada: nao` é o que faz um vídeo virar figurinha PARADA, do quadro
      // escolhido. Sem declarar, o comando de figurinha de vídeo não tinha
      // como pedir isso.
      { nome: 'animada', tipo: 'opção', opcoes: ['auto', 'sim', 'nao'], obrigatoria: false },
      { nome: 'fps', tipo: 'número', obrigatoria: false },
      { nome: 'ajustar', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      { nome: 'qualidade', tipo: 'número', obrigatoria: false },
      { nome: 'limite_bytes', tipo: 'número', obrigatoria: false },
      { nome: 'emojis', tipo: 'texto', obrigatoria: false },
      RESPOSTA_JSON
    ],
    // Figurinha é declarada, nunca deduzida: o serviço devolve `image/webp`, e
    // um webp pode ser figurinha ou foto. Deduzir mandaria a figurinha como
    // foto, com legenda e miniatura.
    resposta: arquivoDeVolta('figurinha')
  },
  {
    nome: 'figurinha_de_frase',
    descricao: 'Transforma uma frase em figurinha. Não recebe arquivo. Letreiro que desliza, letras que acendem uma a uma, temas de cor prontos; com fundo ou letra "arco-iris" a frase sai animada.',
    metodo: 'POST',
    caminho: '/figurinha/texto',
    // O letreiro arco-íris chegava a 28 s e estourava os 20 s padrão; o próprio
    // serviço subiu o prazo das frases de 30 para 60 s. Declarar 120 dá folga
    // para o caso ruim sem segurar o pedido para sempre.
    esperaSegundos: 120,
    entradas: [
      { nome: 'texto', tipo: 'texto', obrigatoria: true },
      { nome: 'fundo', tipo: 'texto', obrigatoria: false },
      { nome: 'letra', tipo: 'texto', obrigatoria: false },
      // A cor de DESTAQUE. No "letra-a-letra" é a cor da letra que acabou de
      // acender; nos outros efeitos, as palavras alternam entre as duas.
      { nome: 'letra2', tipo: 'texto', obrigatoria: false },
      {
        nome: 'efeito',
        tipo: 'opção',
        opcoes: ['piscar', 'suave', 'deslizar', 'letra-a-letra', 'nenhum'],
        obrigatoria: false
      },
      // Combinação pronta de fundo, letra e destaque. Só preenche o que não foi
      // mandado — `tema: neon` com `letra: branco` usa o fundo do neon e a
      // letra escolhida.
      {
        nome: 'tema',
        tipo: 'opção',
        opcoes: ['classico', 'papel', 'neon', 'alerta', 'noite', 'doce', 'festa'],
        obrigatoria: false
      },
      { nome: 'alinhamento', tipo: 'opção', opcoes: ['centro', 'esquerda', 'direita'], obrigatoria: false },
      { nome: 'quadros', tipo: 'número', obrigatoria: false },
      { nome: 'velocidade_ms', tipo: 'número', obrigatoria: false },
      { nome: 'contorno', tipo: 'texto', obrigatoria: false },
      { nome: 'fonte', tipo: 'opção', opcoes: ['padrao', 'serifa', 'mono', 'liberation', 'liberation-serifa', 'fina'], obrigatoria: false },
      { nome: 'maiusculas', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      { nome: 'pacote', tipo: 'texto', obrigatoria: false },
      { nome: 'autor', tipo: 'texto', obrigatoria: false },
      RESPOSTA_JSON
    ],
    resposta: arquivoDeVolta('figurinha')
  },
  {
    nome: 'trocar_metadados',
    descricao: 'Troca o nome do pacote e o autor de uma figurinha que já existe, SEM recodificar — a imagem fica idêntica, só o bloco de informação muda.',
    metodo: 'POST',
    caminho: '/figurinha/metadados',
    entradas: [
      { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
      { nome: 'pacote', tipo: 'texto', obrigatoria: false },
      { nome: 'autor', tipo: 'texto', obrigatoria: false },
      { nome: 'emojis', tipo: 'texto', obrigatoria: false },
      RESPOSTA_JSON
    ],
    resposta: arquivoDeVolta('figurinha')
  },
  {
    nome: 'converter',
    descricao: 'Troca o formato de foto, animação, vídeo ou áudio. O formato de saída é escolhido na chamada.',
    metodo: 'POST',
    caminho: '/converter',
    esperaSegundos: 180,
    entradas: [
      { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
      {
        nome: 'formato',
        tipo: 'opção',
        // A lista fechada do serviço. Vale a pena ser lista e não texto livre:
        // o painel mostra as escolhas, e um formato inventado é recusado na
        // publicação em vez de virar 415 na frente de quem usou o comando.
        opcoes: ['jpg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'ico', 'mp4', 'webm', 'mov', 'mkv', 'mp3', 'ogg', 'm4a'],
        obrigatoria: true
      },
      { nome: 'largura', tipo: 'número', obrigatoria: false },
      { nome: 'altura', tipo: 'número', obrigatoria: false },
      { nome: 'qualidade', tipo: 'número', obrigatoria: false },
      { nome: 'limite_bytes', tipo: 'número', obrigatoria: false },
      { nome: 'sem_audio', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      RESPOSTA_JSON
    ],
    // Sem tipo fixo DE PROPÓSITO: a saída depende do formato pedido na chamada.
    // O mime da resposta é quem sabe se aquilo é foto, vídeo ou áudio.
    resposta: arquivoDeVolta(null)
  },
  {
    // O FUNDO, com as quatro ações numa função só.
    //
    // A IA separa o centro (pessoa, bicho, objeto) do fundo, e `acao` decide o
    // que fazer com o que sobrou: tirar, borrar, trocar por outra foto ou
    // pintar de uma cor. `remover_fundo` continua existindo logo abaixo porque
    // é a função que os comandos instalados chamam — apagá-la quebraria o
    // /remover-fundo de quem já tem o sistema.
    nome: 'fundo',
    descricao: 'Mexe no fundo de uma foto: tira (transparente), desfoca deixando o centro nítido (efeito retrato), pinta de uma cor, ou troca por outra foto.',
    metodo: 'POST',
    caminho: '/fundo',
    // Medido no serviço: 6 a 9 s numa foto de 1000x667, mais a espera por vaga
    // de IA quando outro pedido está usando o modelo.
    esperaSegundos: 180,
    entradas: [
      { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
      // A SEGUNDA foto: a que vira o fundo, e só a ação `trocar` a usa. Opcional
      // porque as outras três ações chamam a mesma função com uma foto só.
      { nome: 'imagem_fundo', tipo: 'mídia', obrigatoria: false },
      { nome: 'acao', tipo: 'opção', opcoes: ['remover', 'desfocar', 'trocar', 'cor'], obrigatoria: false, padrao: 'desfocar' },
      { nome: 'modelo', tipo: 'opção', opcoes: ['isnet-general-use', 'silueta', 'u2netp'], obrigatoria: false },
      // O quanto o fundo borra, de 1 a 10. É o botão do efeito retrato.
      { nome: 'forca', tipo: 'número', obrigatoria: false },
      // Esfuma a beirada do centro, para não ficar com cara de recorte colado.
      { nome: 'suavizar_bordas', tipo: 'número', obrigatoria: false },
      // Na troca: borra a foto nova, e puxa luz e cor do centro para as dela.
      { nome: 'desfocar_fundo', tipo: 'número', obrigatoria: false },
      { nome: 'harmonizar', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      { nome: 'formato', tipo: 'opção', opcoes: ['png', 'webp', 'jpg'], obrigatoria: false },
      // Em `cor`, a cor do fundo; em `remover`, a cor que entra no lugar da
      // transparência.
      { nome: 'fundo', tipo: 'texto', obrigatoria: false },
      { nome: 'recortar', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      { nome: 'refinar_bordas', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      RESPOSTA_JSON
    ],
    resposta: arquivoDeVolta('foto')
  },
  {
    nome: 'remover_fundo',
    descricao: 'Recorta o objeto principal de uma foto e deixa o fundo transparente, ou troca o fundo por uma cor.',
    metodo: 'POST',
    caminho: '/remover-fundo',
    // Medido no serviço: ~9 s no melhor modelo, mais a espera por vaga de IA.
    esperaSegundos: 180,
    entradas: [
      { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
      { nome: 'modelo', tipo: 'opção', opcoes: ['isnet-general-use', 'silueta', 'u2netp'], obrigatoria: false },
      { nome: 'formato', tipo: 'opção', opcoes: ['png', 'webp'], obrigatoria: false },
      { nome: 'fundo', tipo: 'texto', obrigatoria: false },
      { nome: 'recortar', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      { nome: 'refinar_bordas', tipo: 'opção', opcoes: ['sim', 'nao'], obrigatoria: false },
      RESPOSTA_JSON
    ],
    resposta: arquivoDeVolta('foto')
  },
  {
    nome: 'melhorar',
    descricao: 'Melhora uma foto, até 4K. Duas escolhas independentes: o TRATAMENTO ("auto" decide, "classico" sem IA, "ia" só o modelo, "ambos" os dois) e ATÉ ONDE a foto cresce ("4k", "original", "2x", "4x").',
    metodo: 'POST',
    caminho: '/melhorar',
    // A mais demorada do serviço: o modo 4k vai de ~2 s a ~2 min conforme o
    // quanto a foto precisa crescer, e o próprio serviço aceita timeout_s de
    // até 900. Com os 20 s de antes, toda foto pequena morria no meio.
    esperaSegundos: 600,
    entradas: [
      { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
      // Os nomes NOVOS e os ANTIGOS na mesma lista, de propósito: o serviço
      // continua aceitando os dois (`4k` é `auto`, `leve` é `classico`), e tirar
      // os antigos daqui faria o comando já instalado — que manda `modo: 4k` —
      // ser recusado na publicação da próxima vez que alguém o abrisse.
      { nome: 'modo', tipo: 'opção', opcoes: ['auto', 'classico', 'ia', 'ambos', '4k', 'leve'], obrigatoria: false },
      // ATÉ ONDE a foto cresce, que antes vinha junto do modo. `original`
      // mantém o tamanho e só melhora; `2x`/`4x` é escala fixa.
      { nome: 'alvo', tipo: 'opção', opcoes: ['4k', 'original', '2x', '4x'], obrigatoria: false },
      // O quanto o tratamento clássico aparece, de 0 a 2.
      { nome: 'intensidade', tipo: 'número', obrigatoria: false },
      { nome: 'escala', tipo: 'número', obrigatoria: false },
      { nome: 'formato', tipo: 'opção', opcoes: ['png', 'jpg', 'webp'], obrigatoria: false },
      { nome: 'qualidade', tipo: 'número', obrigatoria: false },
      { nome: 'limite_bytes', tipo: 'número', obrigatoria: false },
      { nome: 'timeout_s', tipo: 'número', obrigatoria: false },
      RESPOSTA_JSON
    ],
    resposta: arquivoDeVolta('foto')
  }
])

export const CONEXOES_PRONTAS = Object.freeze([
  {
    id: 'midia',
    kind: 'http',
    titulo: 'Serviço de download de mídia',
    descricao: 'Baixa vídeo, áudio e foto de link de rede social. É o serviço que o /dow e o download automático usam.',
    config: {
      // Loopback por padrão: o serviço baixa URL arbitrária e devolve o
      // arquivo, então em endereço de rede ele viraria um proxy de download
      // aberto. Quem quiser expor precisa dizer isso de propósito.
      endereco: 'http://127.0.0.1:8765',
      // É como o downloader autentica hoje: Authorization: Bearer <token>.
      autenticacao: { tipo: 'bearer' },
      funcoes: [
        {
          nome: 'baixar',
          descricao: 'Baixa a mídia de um link e devolve os arquivos.',
          metodo: 'POST',
          caminho: '/download',
          entradas: [
            { nome: 'url', tipo: 'texto', obrigatoria: true },
            { nome: 'modo', tipo: 'opção', opcoes: ['auto', 'video', 'audio', 'thumbnail'], obrigatoria: false, padrao: 'auto' }
          ],
          resposta: TRABALHO_DE_DOWNLOAD
        },
        {
          // MÚSICA PELO NOME, que é o que o /play faz: ninguém cola link do
          // YouTube para ouvir uma música, digita o nome dela.
          //
          // Função à parte e não um `modo` a mais no `baixar` porque as duas
          // diferem em três coisas, não em uma: a entrada é o NOME e não o
          // link, a espera é outra (resolver a busca é uma extração antes do
          // download) e a legenda sai de outro campo. Era isto que o dono quis
          // ao dizer "não existe problema em criar a função baixar que recebe
          // um link ou baixar2 que recebe o mesmo link com outra configuração".
          nome: 'musica',
          descricao: 'Baixa uma música do YouTube pelo NOME, com a capa e o nome da faixa. Prefere a versão do YouTube Music quando existe.',
          metodo: 'POST',
          caminho: '/download',
          // A busca é uma extração de metadados ANTES do download, e o próprio
          // serviço troca de IP e tenta de novo quando o YouTube barra. Com os
          // 20 s de sempre, a música que precisa de outra tentativa morria no
          // meio do caminho.
          esperaSegundos: 120,
          entradas: [
            // O NOME ou o LINK, e o serviço recusa os dois juntos. O nome é
            // o caso comum ("/play evidências"); o link é o que o botão do
            // carrossel de busca manda, apontando para a música exata que a
            // pessoa escolheu entre as capas.
            { nome: 'busca', tipo: 'texto', obrigatoria: false },
            { nome: 'url', tipo: 'texto', obrigatoria: false },
            // Declarado com padrão, e não fixo no código: é `musica` que faz o
            // serviço trazer áudio + capa + faixa num trabalho só.
            { nome: 'modo', tipo: 'opção', opcoes: ['musica', 'audio'], obrigatoria: false, padrao: 'musica' },
            { nome: 'audio_ext', tipo: 'opção', opcoes: ['m4a', 'mp3', 'opus', 'wav', 'flac'], obrigatoria: false }
          ],
          resposta: TRABALHO_DE_MUSICA
        },
        {
          // BUSCAR SEM BAIXAR. Serve para escolher entre homônimos antes de
          // gastar um download — "Evidências" tem a versão do Chitãozinho, a
          // do Bruno & Marrone e uma dúzia de covers.
          nome: 'buscar',
          descricao: 'Mostra as primeiras músicas que o YouTube acha para um nome, sem baixar nada. Serve para escolher qual pedir.',
          metodo: 'POST',
          caminho: '/buscar',
          esperaSegundos: 60,
          entradas: [
            { nome: 'busca', tipo: 'texto', obrigatoria: true },
            { nome: 'quantos', tipo: 'número', obrigatoria: false, padrao: 5 }
          ],
          resposta: {
            forma: FORMAS_DE_RESPOSTA.carrossel,
            campo: 'achados',
            // A CAPA PELO PRÓPRIO SERVIÇO, e o endereço do YouTube como queda.
            //
            // `capa` é um caminho do serviço (`/capa/<id>`) e volta em JPEG —
            // o dono passou a servi-la assim depois de medirmos que o endereço
            // direto do YouTube responde WEBP (ele ignora o `Accept`) e que a
            // mensagem de imagem do WhatsApp espera jpeg.
            //
            // Caminho relativo leva a credencial da conexão junto, como
            // qualquer outro arquivo do serviço; `capa_youtube` é endereço de
            // fora e vai sem ela. É a segunda tentativa, para o dia em que o
            // serviço não conseguir buscar a capa.
            imagem: ['capa', 'capa_youtube'],
            corpo: '🎵 *{{titulo}}*\n👤 {{autor}}',
            rodape: '⏱️ {{duracao_texto}}  ·  👁️ {{visualizacoes}} visualizações',
            cabecalho: '🔎 Achei isto para "{{busca}}":',
            // O botão manda um COMANDO: o id dele é "/play <link daquele
            // vídeo>", que é exatamente o que a pessoa teria digitado. Por isso
            // escolher entre as capas não precisa de nada guardado entre as
            // duas mensagens — a segunda chega inteira, sozinha.
            // O COMANDO QUE O BOTÃO MANDA é o de baixar música POR LINK, e
            // não o de buscar por nome: a busca por nome escolheria de novo
            // entre os resultados, e podia vir outra — o botão tem que trazer
            // exatamente a música daquele card.
            //
            // Trocar a palavra do comando no painel pede trocar aqui também.
            // É o preço de o botão ser um comando de verdade, e é visível dos
            // dois lados.
            botao: { texto: '⬇️ Baixar esta', comando: '/musica {{url}}' },
            // Dez é o teto do carrossel do WhatsApp; cinco cabe na tela sem
            // deslizar até o fim.
            limite: 5,
            vazio: 'Não achei nada com esse nome no YouTube.',
            // O que o serviço recusa vem em `detail`, que é onde o FastAPI
            // escreve a frase — "Termo longo demais (máximo 200)" diz à pessoa
            // o que fazer; "o serviço respondeu 400" não diz nada.
            campoDoErro: 'detail'
          }
        }
      ]
    }
  },
  {
    id: 'imagem',
    kind: 'http',
    titulo: 'Serviço de imagem e figurinha',
    descricao: 'Gera figurinha de foto, vídeo e frase (com nome de pacote e autor), troca formato, remove fundo e melhora foto. É o serviço que os comandos de figurinha usam.',
    config: {
      // Loopback, como o de download: o serviço aceita arquivo arbitrário e
      // gasta CPU convertendo. Em endereço de rede viraria conversor aberto —
      // e ele próprio recusa subir fora do loopback, então apontar para fora
      // daqui não funcionaria de qualquer forma.
      endereco: 'http://127.0.0.1:8767',
      // A chave fica colada pelo painel por padrão. Quem tem terminal pode
      // trocar para `arquivo` e apontar para o .token do serviço — a chave não
      // entra no banco, nem em backup do banco.
      autenticacao: { tipo: 'bearer' },
      funcoes: FUNCOES_DE_IMAGEM
    }
  }
])

export function conexaoProntaPorId (id) {
  return CONEXOES_PRONTAS.find((c) => c.id === id) || null
}
