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
    campos: [
      { chave: 'text', inline: true, tipo: 'texto' },
      // METADADOS DA MENSAGEM QUE SAI.
      //
      // `marca` é a menção: o @ que faz o WhatsApp notificar alguém e pintar o
      // nome. Sem ela, escrever "@5511999999999" no texto manda um número
      // cru — parece uma menção e não é, não notifica ninguém, e quem recebe
      // só vê dígitos. A menção de verdade mora no contexto da mensagem, não
      // no texto, e é por isso que ela precisa ser um campo.
      //
      // Aceita vários, separados por vírgula, e aceita marcador: o caso comum
      // é "marca: {{sender.id}}" para responder avisando a pessoa.
      { chave: 'mentions', rotulo: 'marca', tipo: 'texto' },
      // Faz a mensagem sair com o selo de encaminhada. É decoração de
      // contexto, e o WhatsApp a trata como tal.
      { chave: 'forward', rotulo: 'encaminhada', tipo: 'booleano' }
    ]
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
      { chave: 'delivery', rotulo: 'entrega', tipo: 'palavra', palavras: { carrossel: 'carrossel', album: 'álbum', separate: 'separado' } },
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
    // AS ENTRADAS QUE RECEBEM ARQUIVO. Escritas dentro do mesmo bloco `com`,
    // porque são entradas da função como as outras — mas guardadas fora de
    // `inputs`, porque ali tudo passa pelo interpolador e token de mídia no
    // interpolador é o que o invariante 4 proíbe.
    //
    // São DUAS porque existe função que precisa de duas fotos: trocar o fundo
    // recebe a foto da pessoa e a foto que vira o fundo. Uma mensagem de
    // comando pode carregar as duas — a que ela responde e a que vem anexada —
    // e é a palavra escrita aqui que diz qual é qual.
    //
    // A PRIMEIRA linha de arquivo do bloco preenche `mediaInput`, a segunda
    // `mediaInput2`. A ordem é a da escrita, que é a mesma em que a função
    // declara: primeiro o assunto, depois o acessório.
    arquivos: [
      // Sem dizer de onde: a mídia da mensagem e, se não houver, a da citada.
      // É o comportamento de sempre, e o que quase todo comando quer.
      { palavra: 'a mídia', chave: 'mediaInput', origem: 'mediaFrom' },
      // A CITADA, e só ela. Existe para desempatar quando são duas: a foto
      // respondida é o assunto, a anexada é o fundo.
      { palavra: 'a mídia citada', chave: 'mediaInput', origem: 'mediaFrom', valor: 'citada' },
      // A ANEXADA, e só ela. O outro lado do mesmo desempate.
      { palavra: 'a mídia anexada', chave: 'mediaInput', origem: 'mediaFrom', valor: 'mensagem' },
      // O que a chamada ANTERIOR devolveu — é o que faz duas chamadas em
      // sequência virarem um cano, em vez de duas chamadas soltas sobre a
      // mesma mídia.
      { palavra: 'o resultado', chave: 'mediaInput', origem: 'mediaFrom', valor: 'resultado' }
    ],
    campos: [
      { chave: 'delivery', rotulo: 'entrega', tipo: 'palavra', palavras: { carrossel: 'carrossel', album: 'álbum', separate: 'separado' } },
      { chave: 'ackText', rotulo: 'avisa', tipo: 'texto' },
      { chave: 'caption', rotulo: 'legenda', tipo: 'texto' },
      // QUAL mensagem a resposta marca. O padrão é a citada, que é o certo
      // para o download de link; "quem pediu" é o certo quando o pedido se
      // basta — o nome da música digitado, ou o toque no botão do carrossel.
      { chave: 'quoteFrom', rotulo: 'cita', tipo: 'palavra', palavras: { citada: 'a citada', mensagem: 'quem pediu' } },
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
      // Uma pasta inteira em vez de um arquivo: é assim que um comando monta
      // o próprio carrossel.
      { chave: 'folder', rotulo: 'pasta', tipo: 'texto' },
      { chave: 'delivery', rotulo: 'entrega', tipo: 'palavra', palavras: { carrossel: 'carrossel', album: 'álbum', separate: 'separado' } },
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
  // Mostrar o que de fato chegou na mensagem: id, quem mandou, o que ela
  // responde, e o toque no botão por inteiro. Não tem campo nenhum — o que ele
  // mostra é o evento, e o evento não se configura.
  {
    palavra: 'mostra metadados',
    tipo: 'action.whatsapp.metadata',
    campos: []
  },
  // Mandar uma PÁGINA: uma mensagem com um botão que abre um endereço.
  //
  // Não existe HTML rodando dentro de uma mensagem do WhatsApp — o que existe
  // é um botão com uma URL, e o aplicativo abre aquela página numa janela
  // dele. Esta ação é isso, e nada além disso: o site continua sendo um site,
  // hospedado onde você quiser.
  //
  // O botão NÃO VOLTA para o bot. Quem toca abre a página e pronto; se o
  // comando precisa saber que a pessoa escolheu algo, isso tem de vir da
  // própria página falando com o serviço dela.
  {
    palavra: 'abre página',
    tipo: 'action.whatsapp.webview',
    campos: [
      { chave: 'text', inline: true, tipo: 'texto' },
      { chave: 'url', rotulo: 'endereço', tipo: 'texto' },
      { chave: 'buttonLabel', rotulo: 'botão', tipo: 'texto' },
      { chave: 'footer', rotulo: 'rodapé', tipo: 'texto' },
      // Dentro do WhatsApp é o padrão, porque é o que se espera de um botão
      // numa conversa. Desligado, vai para o navegador do aparelho.
      { chave: 'inApp', rotulo: 'dentro do WhatsApp', tipo: 'booleano' }
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

// --- o CABEÇALHO da automação --------------------------------------------
//
// Por que esta tabela existe: as ações sempre tiveram tabela (ACOES, acima),
// mas o cabeçalho era um `switch (chave)` escrito à mão em compilar.js, e os
// blocos de template outro laço de `if`. Ou seja: a abertura e o fechamento do
// arquivo — justo as duas partes fixas, as que uma pessoa escreve PRIMEIRO e
// POR ÚLTIMO — eram as únicas sem tabela. Sem elas não há como listar os
// campos num painel, colorir a palavra no editor, nem gerar referência: cada
// uma dessas três coisas viraria uma cópia do vocabulário, e cópia do
// vocabulário é exatamente o que o cabeçalho deste arquivo conta que já deu
// errado uma vez.
//
// ESTA TABELA SÓ DECLARA. O `switch` continua sendo quem lê, porque cada caso
// tem conferência própria e mensagem de erro escrita para aquele caso — trocar
// isso por despacho genérico pioraria o erro e arriscaria a ida e volta sobre
// os 42 templates do catálogo. Um teste cruza as duas listas nos dois sentidos,
// então elas não têm como divergir em silêncio.
//
// `doc` é a chave do DOCUMENTO, e serve para juntar com a prosa que já existe
// no glossário do painel. Onde há `doc` não se escreve `ajuda` aqui: a
// explicação mora num lugar só. `ajuda` aparece apenas nos campos que nunca
// tiveram descrição em lugar nenhum.
export const CAMPOS_DO_CABECALHO = Object.freeze([
  {
    chave: 'tipo',
    vale: 'ambos',
    obrigatorio: true,
    palavras: CLASSES,
    ajuda: 'O que a automação É, e é a primeira coisa a escrever: um comando acorda quando alguém digita; um vigia fica ligado olhando a conversa.'
  },
  {
    chave: 'dispara com',
    vale: 'ambos',
    obrigatorio: 'comando',
    doc: 'command',
    ajuda: 'Num comando, a palavra digitada. Num vigia, a frase "qualquer mensagem" — o que ele observa se diz nas linhas seguintes.'
  },
  { chave: 'casa', vale: 'comando', palavras: CASAMENTOS, doc: 'match' },
  { chave: 'quem', vale: 'ambos', palavras: ORIGENS, doc: 'allowFrom' },
  { chave: 'argumentos', vale: 'comando', doc: 'args' },
  { chave: 'palavras', vale: 'vigia', doc: 'keywords' },
  { chave: 'quando for', vale: 'vigia', palavras: TIPOS_DE_MENSAGEM, doc: 'messageKinds' },
  {
    chave: 'acessa',
    vale: 'ambos',
    palavras: TIPOS_DE_MENSAGEM,
    ajuda: 'Os tipos de mensagem que a automação chega a VER. É exigência, não preferência: o motor não avalia a automação para tipo que não esteja aqui, então quem declara só texto nunca vê a mensagem de voz — e falha calado.'
  },
  {
    chave: 'precisa de um link',
    vale: 'ambos',
    palavras: ONDE_PROCURAR,
    ajuda: 'Diz que a automação só roda se houver um link, e onde procurar. A ordem escrita é a ordem da procura. O motor resolve antes do fluxo começar, então a ação só escreve "o link".'
  },
  {
    chave: 'precisa de uma mídia',
    vale: 'ambos',
    palavras: ONDE_PROCURAR,
    ajuda: 'O mesmo para foto, vídeo, áudio ou documento: "na mensagem ou na citada" aceita as duas formas — mandar junto com o comando, ou responder um arquivo já enviado.'
  },
  {
    chave: 'sem ele',
    vale: 'ambos',
    depende: 'precisa de um link',
    ajuda: 'O que responder quando o link não aparece. Fica aqui, junto do que ele guarda, e não perdido entre os textos da ação.'
  },
  {
    chave: 'sem ela',
    vale: 'ambos',
    depende: 'precisa de uma mídia',
    ajuda: 'O que responder quando não vem mídia nenhuma. Sem isto o comando fica mudo, e quem mandou acha que o bot quebrou.'
  },
  { chave: 'id', vale: 'ambos', ajuda: 'O identificador da automação. É por ele que ela passa a existir, e ele não muda depois.' },
  { chave: 'revisão', vale: 'ambos', ajuda: 'A revisão, quando o texto vem de uma automação que já existe. Escrevendo do zero, não se põe.' },
  { chave: 'nome', vale: 'ambos', ajuda: 'O nome que aparece no painel. Para quem lê a lista de comandos daqui a um mês.' },
  {
    chave: 'menu',
    vale: 'ambos',
    ajuda: 'A linha que este comando ocupa no menu, no formato "rótulo — descrição". Sem esta linha, o comando funciona mas não aparece no menu.'
  },
  {
    chave: 'família',
    vale: 'ambos',
    ajuda: 'A que grupo de comandos este pertence — "download", "figurinha", "compra e venda". É texto livre: serve para ligar e desligar um conjunto inteiro de uma vez numa conversa, em vez de comando por comando.'
  },
  { chave: 'onde', vale: 'ambos', palavras: DESTINOS, repetivel: true, ajuda: 'Em que conversas esta automação vale. Pode repetir a linha. Lista vazia nunca significa "em todas".' },
  { chave: 'menos', vale: 'ambos', palavras: DESTINOS, repetivel: true, ajuda: 'A exceção do "onde": vale em todos os grupos, menos neste.' },
  { chave: 'pool', vale: 'ambos', ajuda: 'Qual conjunto de números responde. Crie um na aba Automações antes, se ainda não tiver.' },
  { chave: 'histórico', vale: 'ambos', ajuda: 'Se a automação enxerga mensagem antiga ou só a que está chegando agora.' }
])

// As linhas SOLTAS do cabeçalho: sem dois-pontos e sem valor, porque a
// presença da linha já é a resposta. "só dono" não tem como ser "só dono: não"
// — essa linha seria uma maneira comprida de não escrever nada.
export const MARCAS_DO_CABECALHO = Object.freeze([
  { chave: 'só dono', vale: 'ambos', doc: 'requireOwner' },
  { chave: 'com link', vale: 'vigia', doc: 'containsLink' },
  { chave: 'só link de mídia', vale: 'vigia', doc: 'mediaLinkOnly' },
  { chave: 'também em comandos', vale: 'vigia', doc: 'alsoOnCommands' },
  { chave: 'desligada', vale: 'ambos', ajuda: 'Nasce desligada: fica gravada e não responde até alguém ligar no painel.' }
])

// --- o cabeçalho do TEMPLATE ---------------------------------------------
//
// A primeira linha, `template <id> v<n>`, é o que separa um arquivo
// instalável de uma automação já publicada. A versão é load-bearing: é por ela
// que o painel sabe oferecer "este comando tem versão nova".
export const CAMPOS_DO_TEMPLATE = Object.freeze([
  { chave: 'nome', ajuda: 'O nome que aparece no catálogo.' },
  { chave: 'descrição', ajuda: 'O que o comando faz, para quem está escolhendo se instala. Vale escrever a frase inteira.' },
  { chave: 'categoria', ajuda: 'Onde ele aparece agrupado no catálogo.' },
  { chave: 'motor', ajuda: 'A versão mínima do motor. Só importa se o comando usa algo recém-criado.' },
  { chave: 'depende de', repetivel: true, ajuda: 'Outro template que precisa estar instalado antes. A instalação resolve a ordem sozinha.' },
  { chave: 'exige', repetivel: true, ajuda: 'Uma capacidade que a instalação precisa ter. Serve para o painel avisar ANTES, em vez de o comando falhar depois.' }
])

// --- os blocos do fim do arquivo -----------------------------------------
//
// `configurável` é o que torna um comando reaproveitável: quem escreve declara
// o formulário, e quem instala preenche pelo painel sem abrir arquivo nenhum.
export const BLOCOS_DE_TEMPLATE = Object.freeze([
  {
    bloco: 'configurável',
    forma: 'chave: tipo [(opções)] [= padrão]',
    palavras: TIPOS_DE_CONFIG,
    ajuda: 'Cada linha é um campo do formulário de instalação. O valor preenchido entra no comando onde estiver escrito {{params.chave}}.',
    filhos: [
      { chave: 'rótulo', ajuda: 'O nome do campo na tela. Sem ele, quem instala lê a chave crua.' },
      { chave: 'ajuda', ajuda: 'A frase embaixo do campo. É onde se explica a escolha, não o tipo.' },
      { chave: 'várias linhas', ajuda: 'Para o campo de texto que nasce com uma linha e ainda assim precisa aceitar várias.' }
    ]
  },
  {
    bloco: 'declara',
    forma: '<escopo> <chave>: <tipo de valor>',
    palavras: TIPOS_DE_VALOR,
    ajuda: 'As variáveis e contadores que o comando guarda — por conversa, por pessoa, por grupo. As linhas indentadas embaixo são a descrição.'
  },
  {
    bloco: 'avisa',
    forma: 'avisa <nível>',
    palavras: NIVEIS_DE_AVISO,
    ajuda: 'O recado que o painel mostra na hora de instalar: "exige" é o que precisa estar configurado antes, "nota" é o detalhe que evita uma surpresa.'
  }
])

// --- as palavras de dentro da condição -----------------------------------
//
// `se var member avisos >= 3` e `se evento message.args != ""`: as duas
// palavras que dizem DE ONDE sai o valor comparado. Ficam aqui, e não só
// dentro do `lerOperando`, pelo mesmo motivo de todas as outras — o editor
// precisa saber que são palavras da linguagem para acendê-las, e lista de
// palavras escrita na tela é a cópia que envelhece.
export const PALAVRAS_DE_OPERANDO = Object.freeze({
  variable: 'var',
  event: 'evento'
})

// Os escopos de uma variável declarada, do mais estreito ao mais largo. O
// compilador não os valida (quem valida é o schema do template), mas o editor
// e a referência precisam saber que existem.
export const ESCOPOS_DE_VALOR = Object.freeze([
  'chat', 'sender', 'member', 'target', 'targetMember', 'category', 'global'
])
