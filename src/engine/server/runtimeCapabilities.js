export const GATILHOS_SUPORTADOS = Object.freeze([
  'trigger.command',
  'trigger.message',
  'trigger.group'
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
  'action.whatsapp.recover',
  'action.menu.render',
  'action.menu.config',
  'action.whatsapp.delete',
  'action.group.remove',
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
  // Mostrar os metadados da mensagem. Ele não tem executor próprio no gateway:
  // o motor o transforma numa resposta de texto comum, pelo mesmo caminho de
  // `whatsapp.reply`. Entra nesta lista mesmo assim, porque é esta lista que
  // diz o que uma automação pode DECLARAR — um tipo de nó fora dela é recusado
  // na publicação, e seria recusado depois de alguém escrever o comando.
  'action.whatsapp.metadata',
  'action.whatsapp.webview'
])

export const CONDICOES_SUPORTADAS = Object.freeze([
  'condition.compare'
])

// Escopos onde uma variável/contador pode viver. 'category' exige um
// categoryKey junto; os outros são resolvidos a partir do próprio evento.
// 'target' é quem o comando mira (@mencionado, ou o autor da mensagem citada)
// — é o que permite "/adv @fulano" contar no fulano, e não em quem digitou.
export const ESCOPOS_DE_VARIAVEL = Object.freeze([
  'chat', 'sender', 'group', 'group_member', 'target', 'target_group_member', 'category', 'global'
])

export const OPERADORES_DE_COMPARACAO = Object.freeze([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains'
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
