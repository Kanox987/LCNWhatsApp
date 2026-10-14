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
    descricao: 'Transforma uma frase em figurinha. Não recebe arquivo. Com fundo ou letra "arco-iris" a figurinha sai animada.',
    metodo: 'POST',
    caminho: '/figurinha/texto',
    entradas: [
      { nome: 'texto', tipo: 'texto', obrigatoria: true },
      { nome: 'fundo', tipo: 'texto', obrigatoria: false },
      { nome: 'letra', tipo: 'texto', obrigatoria: false },
      { nome: 'efeito', tipo: 'opção', opcoes: ['piscar', 'suave', 'nenhum'], obrigatoria: false },
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
    descricao: 'Melhora uma foto. "4k" decide sozinho como chegar perto de 4K (IA, Lanczos, ou só ajuste quando já é grande). "ia" força o modelo em 2x ou 4x. "leve" só ajusta contraste e nitidez, na hora.',
    metodo: 'POST',
    caminho: '/melhorar',
    // A mais demorada do serviço: o modo 4k vai de ~2 s a ~2 min conforme o
    // quanto a foto precisa crescer, e o próprio serviço aceita timeout_s de
    // até 900. Com os 20 s de antes, toda foto pequena morria no meio.
    esperaSegundos: 600,
    entradas: [
      { nome: 'arquivo', tipo: 'mídia', obrigatoria: true },
      { nome: 'modo', tipo: 'opção', opcoes: ['4k', 'ia', 'leve'], obrigatoria: false },
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
