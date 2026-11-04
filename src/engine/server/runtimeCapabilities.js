export const GATILHOS_SUPORTADOS = Object.freeze([
  'trigger.command',
  'trigger.message',
  'trigger.group',
  'trigger.schedule'
])

// A urgência que uma automação pode declarar, e o que ela pode pedir quando a
// fila recusa. Lista fechada dos dois lados: é o que o painel usa para montar o
// seletor, e é contra isto que o publish confere.
export const PRIORIDADES_SUPORTADAS = Object.freeze(['low', 'normal', 'high', 'very_high'])
export const RECUSAS_SUPORTADAS = Object.freeze(['discard', 'notify'])

export const ACOES_SUPORTADAS = Object.freeze([
  'action.whatsapp.reply',
  'action.variable.set',
  'action.variable.increment',
  'action.variable.calculate',
  // RANKING: a única ação que lê MUITOS registros em vez de um.
  //
  // Até aqui só existia contador por pessoa: dava para somar, não para
  // ordenar. As três cabeças do painel convergiram em que esta era a maior
  // alavanca do que restava, e em que a ordenação pertence a QUEM TEM O
  // BANCO — não à linguagem. A linguagem continua sem coleção e sem índice:
  // ela pede o ranking pronto, como pede o sorteio de um membro.
  'action.variable.rank',
  // SORTEAR, e a decisão que mudou.
  //
  // O dono recusou a primitiva de aleatório quando ela custava nove camadas e
  // a alternativa era "declare uma conexão HTTP que devolve número". Depois a
  // rodada cruzada do painel estabeleceu outra coisa, sobre AGENDAMENTO mas
  // valendo igual aqui: isolamento controla FRONTEIRA DE COMUNICAÇÃO, não
  // impede o sistema de executar tarefa sozinho. Um `Math.random()` local não
  // abre porta nenhuma.
  //
  // E o custo da outra saída estava medido, pelo próprio revisor que a
  // propôs: trocar 0,001 ms por 50 a 300 ms de rede e um ponto único de falha
  // num /dado, além de obrigar quem aluga a montar infraestrutura para jogar
  // uma moeda.
  //
  // Sorteia número numa faixa OU um item de uma lista. O item entra aqui
  // porque a linguagem não manipula coleção: quem tem a lista faz o trabalho,
  // mesma forma do sorteio de membro.
  'action.variable.random',
  'action.whatsapp.recover',
  'action.menu.render',
  'action.menu.config',
  'action.whatsapp.delete',
  // Reagir com emoji, e pegar a foto de perfil. As duas saem pelo caminho de
  // mensagem da biblioteca, não pelo de grupo: reagir funciona em conversa de
  // uma pessoa também, e por isso NÃO tem a trava de só-grupo que as ações de
  // administração têm.
  'action.whatsapp.react',
  // FIXAR e ENQUETE, as duas últimas que o bot antigo tinha e este não.
  //
  // Eu já afirmei no plano que elas "só dependiam de autorização" porque li
  // `WaSendPinMessage` e `WaSendPollMessage` na biblioteca. Estava errado, e a
  // revisão pegou: a biblioteca saber ENVIAR não é a linguagem saber PEDIR.
  // Cada uma custou as mesmas nove camadas de qualquer ação nova.
  'action.whatsapp.pin',
  'action.whatsapp.poll',
  // O RESULTADO da enquete. Os votos já chegavam ao gateway e eram jogados
  // fora — 17 pacotes numa captura de 40 minutos, todos como "mensagem
  // desconhecida". Igual aos eventos de grupo antes do porteiro.
  'action.whatsapp.pollResults',
  'action.whatsapp.profilePicture',
  'action.group.remove',
  // Administração do grupo. Nascem acompanhadas do executor no gateway, não
  // antes dele: declarar aqui sem o executor deixa publicar automação que casa,
  // gera comando e morre na entrega — foi por isso que `connection.call` ficou
  // fora desta lista de propósito enquanto só o motor existia.
  'action.group.promote',
  'action.group.demote',
  'action.group.add',
  'action.group.setSubject',
  'action.group.setDescription',
  'action.group.setAnnounce',
  'action.group.inviteCode',
  // ENUMERAR OS MEMBROS, e é a única ação que faz isso.
  //
  // Um comando é evento de MENSAGEM, e evento de mensagem não traz
  // `group.participants` — só o evento de grupo traz (zapoAdapter.js:504).
  // Então nenhum template conseguia marcar todo mundo, listar o grupo ou
  // sortear um membro: faltava quem enumerasse.
  //
  // A enumeração acontece no GATEWAY, onde a lista existe de verdade
  // (groupInfo.js já busca os metadados e hoje descarta os participantes,
  // guardando só os admins). A linguagem não ganha coleção nem índice — ela
  // pede um TRABALHO pronto e recebe uma mensagem. É o que permite as três
  // modalidades sem nenhuma primitiva nova no motor.
  'action.group.members',
  'action.whatsapp.rich',
  'action.whatsapp.sendFile',
  'action.media.download',
  // Chamar uma FUNÇÃO declarada numa conexão. Os DOIS lados existem: o motor
  // emite `connection.call` (evaluator.js, validado em validate.js) e o gateway
  // o executa pela declaração (conexaoExecutor.js).
  //
  // Esta lista é o portão do invariante 7 — ela diz o que o RUNTIME executa, e
  // runtime são os dois lados. Ela ficou de fora de propósito enquanto só o
  // motor existia: declarar antes deixaria publicar uma automação que casa,
  // gera comando e morre na entrega.
  'action.connection.call',
  // Guardar no acervo a mídia que chegou pelo WhatsApp. O par de
  // `action.whatsapp.sendFile`, que só sabia tirar de lá.
  'action.acervo.save',
  'action.acervo.delete',
  'action.acervo.createText',
  'action.acervo.rewrite',
  // LER o acervo, e é a única das cinco que não escreve.
  //
  // As outras quatro gravam, apagam e sobrescrevem; nenhuma devolvia dado. Sem
  // isso, nenhum comando conseguia mostrar o NOME, o PREÇO ou a DESCRIÇÃO de
  // um item guardado — que é o que uma vitrine é. Três revisões independentes
  // apontaram esta como a peça que faltava.
  //
  // Ela devolve METADADO, nunca bytes nem caminho em disco: o que vai para o
  // motor é informação, e arquivo continua saindo só pelo gateway.
  'action.acervo.read',
  // Mostrar os metadados da mensagem. Ele não tem executor próprio no gateway:
  // o motor o transforma numa resposta de texto comum, pelo mesmo caminho de
  // `whatsapp.reply`. Entra nesta lista mesmo assim, porque é esta lista que
  // diz o que uma automação pode DECLARAR — um tipo de nó fora dela é recusado
  // na publicação, e seria recusado depois de alguém escrever o comando.
  'action.whatsapp.metadata',
  'action.whatsapp.webview',
  'action.whatsapp.buttons',
  'action.whatsapp.carousel',
  'action.whatsapp.stickerPack'
])

export const CONDICOES_SUPORTADAS = Object.freeze([
  'condition.compare'
])

// Escopos onde uma variável/contador pode viver. 'category' exige um
// categoryKey junto; os outros são resolvidos a partir do próprio evento.
// 'target' é quem o comando mira (@mencionado, ou o autor da mensagem citada)
// — é o que permite "/adv @fulano" contar no fulano, e não em quem digitou.
// 'local' é diferente dos outros oito: vale apenas durante a execução do
// fluxo e não grava atributo no banco (não persiste para a próxima mensagem).
export const ESCOPOS_DE_VARIAVEL = Object.freeze([
  'chat', 'sender', 'group', 'group_member', 'target', 'target_group_member', 'category', 'global', 'local'
])

export const OPERADORES_DE_COMPARACAO = Object.freeze([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'starts_with', 'not_starts_with'
])

export function obterCapacidadesRuntime () {
  return {
    triggers: [...GATILHOS_SUPORTADOS],
    actions: [...ACOES_SUPORTADAS],
    conditions: [...CONDICOES_SUPORTADAS],
    variableScopes: [...ESCOPOS_DE_VARIAVEL],
    comparisonOperators: [...OPERADORES_DE_COMPARACAO],
    maxTriggers: 1,
    // Deixou de ser uma cadeia linear: uma condição bifurca o caminho em
    // 'true'/'false'. Os ramos podem conter condições e voltar à continuação
    // comum; isso ainda percorre um caminho só, sem ciclo nem paralelismo.
    linearOnly: false,
    flowModel: 'exclusive_branching_dag',
    // Metadado opcional de blocos, conferido contra as arestas no publish.
    // Preserva a escrita no editor sem criar outra forma de executar o fluxo.
    sourceStructure: true,
    edgeOutcomes: { trigger: ['matched'], condition: ['true', 'false'], action: ['success'] },
    supportedPlaceholders: ['{{latencyMs}}'],
    // A POLÍTICA DE FILA, declarada como capacidade e NÃO como ação.
    //
    // `prioridade` e `sem vaga` não são efeito executável: não viram nó do
    // fluxo e não entram em `actions`. Pôr uma ação falsa `action.priority` ali
    // para "respeitar a camada" modelaria o cabeçalho como se fosse passo do
    // comando, e o painel passaria a oferecer prioridade como coisa que se
    // arrasta para dentro de um fluxo.
    //
    // Então vira capacidade própria. É isto que o painel lê para saber se o
    // motor desta instalação entende a política antes de publicar uma automação
    // que a declara.
    scheduling: {
      priorities: [...PRIORIDADES_SUPORTADAS],
      onNoSlot: [...RECUSAS_SUPORTADAS],
      // Honestidade sobre o que ainda não existe: `tenta de novo` depende de um
      // agendamento que sobreviva a reinício, e ele não existe. Declarar aqui
      // deixa o painel dizer "ainda não" em vez de a pessoa descobrir no erro
      // de compilação.
      naoSuportado: ['retry']
    }
  }
}
