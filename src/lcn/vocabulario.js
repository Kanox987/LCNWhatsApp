// O vocabulário da linguagem `.lcn`, em português.
//
// UMA tabela serve às duas direções — escrever texto a partir do documento e
// ler documento a partir do texto. Duas tabelas separadas sairiam de sincronia,
// que é exatamente como a lista de variáveis do interpolador divergiu da lista
// da condição nesta base.
//
// A linguagem não é interpretada em lugar nenhum: ela COMPILA para o mesmo
// grafo de nós que o motor já executa, e o resultado passa pelo mesmo schema e
// pelo mesmo publish de sempre. Um `.lcn` malicioso no máximo gera JSON que a
// validação rejeita.

// --- ações: palavra -> tipo de nó, e como os campos aparecem no texto ------
//
// `campos` lista os campos do config na ORDEM em que saem no texto. O primeiro
// com `inline: true` vai na mesma linha da palavra-chave; o resto vira linha
// indentada `nome: valor`. Campo ausente no documento não aparece no texto, e
// texto sem o campo não inventa valor — ausente continua ausente.
export const ACOES = Object.freeze([
  {
    palavra: 'responde',
    tipo: 'action.whatsapp.reply',
    campos: [{ chave: 'text', inline: true, tipo: 'texto' }]
  },
  {
    palavra: 'responde rico',
    tipo: 'action.whatsapp.rich',
    campos: [
      { chave: 'text', inline: true, tipo: 'texto' },
      { chave: 'richKind', rotulo: 'formato', tipo: 'palavra', palavras: { code: 'código', latex: 'fórmula', text: 'texto' } },
      { chave: 'language', rotulo: 'linguagem', tipo: 'palavra' },
      { chave: 'fallbackText', rotulo: 'senão', tipo: 'texto' }
    ]
  },
  {
    palavra: 'recupera',
    tipo: 'action.whatsapp.recover',
    campos: [
      { chave: 'destination', rotulo: 'para', tipo: 'palavra', palavras: { same_chat: 'esta conversa', saved_messages: 'mensagens salvas', fixed: 'número fixo', configured: 'o número configurado' } },
      { chave: 'destinationId', rotulo: 'destino', tipo: 'texto' },
      { chave: 'caption', rotulo: 'legenda', tipo: 'texto' },
      { chave: 'notFoundText', rotulo: 'sem mídia', tipo: 'texto' }
    ]
  },
  {
    palavra: 'baixa',
    tipo: 'action.media.download',
    campos: [
      { chave: 'url', inline: true, tipo: 'texto' },
      { chave: 'modo', rotulo: 'modo', tipo: 'palavra', palavras: { auto: 'automático', video: 'vídeo', audio: 'áudio', thumbnail: 'capa' } },
      // Como entregar quando o post tem VÁRIAS mídias. `palavras` traduz o
      // código do documento para a palavra escrita no .lcn, nos dois sentidos —
      // a linguagem é em português, e "album"/"separate" no meio do texto
      // seriam as únicas palavras estrangeiras do arquivo.
      { chave: 'delivery', rotulo: 'entrega', tipo: 'palavra', palavras: { album: 'carrossel', separate: 'separado' } },
      { chave: 'ackText', rotulo: 'avisa', tipo: 'texto' },
      { chave: 'caption', rotulo: 'legenda', tipo: 'texto' },
      { chave: 'notFoundText', rotulo: 'sem mídia', tipo: 'texto' },
      { chave: 'errorText', rotulo: 'erro', tipo: 'texto' }
    ]
  },
  // Chamar uma função declarada numa conexão.
  //
  // A única ação com campos ABERTOS: as entradas são o que a conexão declarou,
  // e o compilador não pode conhecê-las de antemão — se conhecesse, a gente
  // teria voltado ao problema que isto resolve, com o serviço fixo no meu
  // código. Elas vão num bloco `com`, e o resto são campos normais.
  //
  // `mapa: 'inputs'` é o que diz ao compilador para tratar esse bloco assim.
  {
    palavra: 'chama',
    tipo: 'action.connection.call',
    // `midia.baixar` na mesma linha: a conexão e a função, separadas por ponto.
    alvo: { conexao: 'connectionRef', funcao: 'function' },
    mapa: { bloco: 'com', chave: 'inputs' },
    // A entrada que recebe o ARQUIVO da mensagem. Escrita dentro do mesmo
    // bloco `com`, porque é uma entrada da função como as outras — mas guardada
    // fora de `inputs`, porque ali tudo passa pelo interpolador e token de
    // mídia no interpolador é o que o invariante 4 proíbe.
    arquivo: { palavra: 'a mídia', chave: 'mediaInput' },
    campos: [
      { chave: 'delivery', rotulo: 'entrega', tipo: 'palavra', palavras: { album: 'carrossel', separate: 'separado' } },
      { chave: 'ackText', rotulo: 'avisa', tipo: 'texto' },
      { chave: 'caption', rotulo: 'legenda', tipo: 'texto' },
      { chave: 'notFoundText', rotulo: 'sem dados', tipo: 'texto' },
      { chave: 'errorText', rotulo: 'erro', tipo: 'texto' }
    ]
  },
  {
    palavra: 'envia arquivo',
    tipo: 'action.whatsapp.sendFile',
    campos: [
      // O valor na mesma linha é o CAMINHO, que é o que uma pessoa escreve
      // ("produtos/fotos/capa.jpg"). O id continua aceito como campo, para
      // quem quer a referência estável que não muda se o arquivo for renomeado.
      { chave: 'path', inline: true, tipo: 'texto' },
      { chave: 'fileId', rotulo: 'id', tipo: 'texto' },
      { chave: 'caption', rotulo: 'legenda', tipo: 'texto' },
      { chave: 'notFoundText', rotulo: 'sem arquivo', tipo: 'texto' }
    ]
  },
  {
    palavra: 'guarda no acervo',
    tipo: 'action.acervo.save',
    campos: [
      { chave: 'folder', rotulo: 'pasta', tipo: 'texto' },
      { chave: 'name', rotulo: 'nome', tipo: 'texto' },
      { chave: 'description', rotulo: 'descrição', tipo: 'texto' },
      { chave: 'okText', rotulo: 'confirma', tipo: 'texto' },
      { chave: 'notFoundText', rotulo: 'sem arquivo', tipo: 'texto' },
      { chave: 'errorText', rotulo: 'erro', tipo: 'texto' }
    ]
  },
  {
    palavra: 'apaga mensagem',
    tipo: 'action.whatsapp.delete',
    campos: []
  },
  {
    palavra: 'remove do grupo',
    tipo: 'action.group.remove',
    campos: [
      { chave: 'who', rotulo: 'quem', tipo: 'palavra', palavras: { sender: 'quem enviou', target: 'quem foi marcado' } },
      { chave: 'neverRemoveOwner', rotulo: 'nunca o dono', tipo: 'booleano' },
      { chave: 'notFoundText', rotulo: 'sem alvo', tipo: 'texto' }
    ]
  },
  {
    palavra: 'mostra menu',
    tipo: 'action.menu.render',
    campos: [
      { chave: 'format', rotulo: 'formato', tipo: 'palavra', palavras: { text: 'texto', interactive: 'com botões' } },
      { chave: 'header', rotulo: 'cabeçalho', tipo: 'texto' },
      { chave: 'footer', rotulo: 'rodapé', tipo: 'texto' },
      { chave: 'emptyText', rotulo: 'vazio', tipo: 'texto' },
      { chave: 'buttonTitle', rotulo: 'botão', tipo: 'texto' }
    ]
  },
  {
    palavra: 'configura menu',
    tipo: 'action.menu.config',
    campos: [
      { chave: 'field', rotulo: 'campo', tipo: 'palavra', palavras: { header: 'cabeçalho', footer: 'rodapé', emptyText: 'texto de vazio', buttonTitle: 'título do botão', format: 'formato' } },
      { chave: 'usageText', rotulo: 'como usar', tipo: 'texto' },
      { chave: 'confirmText', rotulo: 'confirma', tipo: 'texto' }
    ]
  },
  // `define` e `soma` têm forma própria no texto (`define chat chave = valor`),
  // porque escrever `define` com quatro linhas indentadas seria pior de ler que
  // a linha única que essas duas pedem.
  {
    palavra: 'define',
    tipo: 'action.variable.set',
    forma: 'variavel',
    campos: [
      { chave: 'scope', tipo: 'palavra' },
      { chave: 'categoryKey', tipo: 'palavra' },
      { chave: 'key', tipo: 'palavra' },
      { chave: 'value', tipo: 'texto' }
    ]
  },
  {
    palavra: 'soma',
    tipo: 'action.variable.increment',
    forma: 'variavel',
    campos: [
      { chave: 'scope', tipo: 'palavra' },
      { chave: 'categoryKey', tipo: 'palavra' },
      { chave: 'key', tipo: 'palavra' },
      { chave: 'by', tipo: 'numero' }
    ]
  }
])

// --- operadores da condição ----------------------------------------------
// Os códigos aqui são os do DOCUMENTO, e o nome tem que bater exatamente com
// o que o schema aceita e o motor executa. `ne` não batia: o schema e o
// runtime falam `neq`, então `!=` compilava para um operador que não existe e
// a automação era RECUSADA na publicação. Ninguém tinha esbarrado porque
// nenhum template do catálogo usava "diferente de".
export const OPERADORES = Object.freeze({
  eq: '==',
  neq: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  contains: 'contém',
  not_contains: 'não contém'
})

// --- destinos -------------------------------------------------------------
export const DESTINOS = Object.freeze({
  everywhere: 'em qualquer lugar',
  all_contacts: 'todos os contatos',
  all_groups: 'todos os grupos',
  contact: 'contato',
  group: 'grupo',
  tagged: 'marcadas com'
})

// --- modos de casamento do comando ---------------------------------------
export const CASAMENTOS = Object.freeze({
  exact: 'exato',
  exact_or_args: 'exato ou com argumentos',
  prefix: 'começa com',
  keyword: 'palavra solta'
})

// Quem pode acionar. Renomeado de `de:` para `quem:` — a pergunta que a pessoa
// faz é "quem pode usar isso?", não "de onde vem".
export const ORIGENS = Object.freeze({ external: 'só externos', any: 'qualquer um' })

// O QUE a automação precisa receber, e ONDE procurar.
//
// Isto substitui escrever `"{{quoted.link}} {{message.link}}"` numa entrada de
// ação. Aquela string esconde um algoritmo — interpola os dois marcadores,
// APAGA o que não resolveu, e pega o primeiro link que sobrou — e o dono leu
// exatamente como ela é: "isso é muito abstrato... ele vai procurar um link na
// mensagem, como?".
//
// Declarado, o motor resolve antes de rodar o fluxo, responde quando falta, e a
// ação só escreve `url: o link`.
export const EXIGENCIAS = Object.freeze({
  link: 'um link',
  media: 'uma mídia'
})

// Onde procurar, e a ordem importa: "na citada ou na mensagem" procura primeiro
// na mensagem marcada. É o que faz um comando aceitar as duas formas — responder
// um arquivo OU mandar junto com o comando.
export const ONDE_PROCURAR = Object.freeze({
  message: 'na mensagem',
  quoted: 'na citada'
})

// As duas CLASSES de automação, e a diferença não é detalhe de gatilho.
//
// Um comando é acordado por alguém digitar. Um vigia fica ligado o tempo todo,
// olhando a conversa — é o download automático, e é o "responder bom dia" que o
// dono descreveu. Ele não tem gatilho de comando nenhum.
//
// Estava escondido na palavra de abertura (`comando /x` contra `ao receber
// mensagem`), como se fosse variação do mesmo. A primeira coisa que se lê agora
// é o que a automação É.
export const CLASSES = Object.freeze({
  'trigger.command': 'comando',
  'trigger.message': 'vigia'
})

export const TIPOS_DE_MENSAGEM = Object.freeze({
  text: 'texto',
  audio: 'áudio',
  image: 'foto',
  video: 'vídeo',
  document: 'documento',
  view_once: 'visualização única',
  sticker: 'figurinha'
})

// Inverte um mapa palavra->código para ler o texto de volta.
export function inverter (mapa) {
  return Object.fromEntries(Object.entries(mapa).map(([k, v]) => [v, k]))
}

export function acaoPorTipo (tipo) {
  return ACOES.find((a) => a.tipo === tipo) || null
}

// A palavra mais longa primeiro: "responde rico" tem que ganhar de "responde",
// senão o texto vira a ação errada sem erro nenhum.
export function acaoPorPalavra (linha) {
  const candidatas = [...ACOES].sort((a, b) => b.palavra.length - a.palavra.length)
  return candidatas.find((a) => linha === a.palavra || linha.startsWith(`${a.palavra} `)) || null
}

// --- tipos de configuração ------------------------------------------------
//
// O que quem ESCREVE o comando declara para quem vai USÁ-LO configurar pelo
// painel, sem abrir arquivo nenhum. Os quatro tipos são o pedido do dono:
// digitar livremente, escolher da lista, número, e liga/desliga.
//
// `string` e `number` são os nomes que os templates já usam no JSON — a
// linguagem só dá a eles nome em português. `enum` e `booleano` são novos.
export const TIPOS_DE_CONFIG = Object.freeze({
  string: 'texto',
  number: 'número',
  enum: 'opção',
  boolean: 'liga/desliga'
})

// --- níveis de aviso ------------------------------------------------------
export const NIVEIS_DE_AVISO = Object.freeze({
  info: 'nota',
  requirement: 'exige',
  compatibility: 'compatibilidade',
  unofficial: 'não oficial'
})

// --- tipos de valor de variável declarada --------------------------------
export const TIPOS_DE_VALOR = Object.freeze({
  text: 'texto',
  number: 'número',
  boolean: 'sim/não'
})
