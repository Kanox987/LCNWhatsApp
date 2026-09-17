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
      { chave: 'richKind', rotulo: 'formato', tipo: 'palavra' },
      { chave: 'language', rotulo: 'linguagem', tipo: 'palavra' },
      { chave: 'fallbackText', rotulo: 'senão', tipo: 'texto' }
    ]
  },
  {
    palavra: 'figurinha',
    tipo: 'action.whatsapp.sticker',
    campos: [{ chave: 'notFoundText', rotulo: 'sem mídia', tipo: 'texto' }]
  },
  {
    palavra: 'recupera',
    tipo: 'action.whatsapp.recover',
    campos: [
      { chave: 'destination', rotulo: 'para', tipo: 'palavra' },
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
      { chave: 'modo', rotulo: 'modo', tipo: 'palavra' },
      { chave: 'ackText', rotulo: 'avisa', tipo: 'texto' },
      { chave: 'caption', rotulo: 'legenda', tipo: 'texto' },
      { chave: 'notFoundText', rotulo: 'sem mídia', tipo: 'texto' },
      { chave: 'errorText', rotulo: 'erro', tipo: 'texto' }
    ]
  },
  {
    palavra: 'envia arquivo',
    tipo: 'action.whatsapp.sendFile',
    campos: [
      { chave: 'fileId', inline: true, tipo: 'texto' },
      { chave: 'caption', rotulo: 'legenda', tipo: 'texto' },
      { chave: 'notFoundText', rotulo: 'sem arquivo', tipo: 'texto' }
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
      { chave: 'who', rotulo: 'quem', tipo: 'palavra' },
      { chave: 'neverRemoveOwner', rotulo: 'nunca o dono', tipo: 'booleano' }
    ]
  },
  {
    palavra: 'mostra menu',
    tipo: 'action.menu.render',
    campos: [
      { chave: 'format', rotulo: 'formato', tipo: 'palavra' },
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
      { chave: 'field', rotulo: 'campo', tipo: 'palavra' },
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
export const OPERADORES = Object.freeze({
  eq: '==',
  ne: '!=',
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

export const ORIGENS = Object.freeze({ external: 'externo', any: 'qualquer' })

export const TIPOS_DE_MENSAGEM = Object.freeze({
  text: 'texto',
  audio: 'áudio',
  image: 'foto',
  video: 'vídeo',
  document: 'documento',
  view_once: 'visualização única'
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
