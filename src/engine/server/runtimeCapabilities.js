export const GATILHOS_SUPORTADOS = Object.freeze([
  'trigger.command',
  'trigger.message'
])

export const ACOES_SUPORTADAS = Object.freeze([
  'action.whatsapp.reply',
  'action.variable.set',
  'action.variable.increment',
  'action.whatsapp.sticker',
  'action.whatsapp.recover',
  'action.menu.render',
  'action.menu.config',
  'action.whatsapp.delete',
  'action.group.remove',
  'action.whatsapp.rich',
  'action.whatsapp.sendFile',
  'action.media.download'
  // `action.connection.call` NÃO entra aqui ainda, e a ausência é deliberada.
  //
  // Esta lista é o portão do invariante 7: ela diz o que o RUNTIME executa, e o
  // publish a impõe. O runtime são os dois lados — o motor já sabe emitir
  // `connection.call` (evaluator.js, com validação em validate.js), mas o
  // gateway ainda não sabe executá-lo: essa parte ficou de fora por causa do
  // trabalho não commitado de outro agente nos mesmos arquivos.
  //
  // Declarar agora deixaria publicar uma automação que casa, gera comando, e
  // morre na entrega — a tela dizendo que funciona algo que não funciona, que é
  // o defeito que esta rodada inteira passou caçando.
  //
  // A linha entra junto com o executor do gateway, num movimento só.
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
    // 'true'/'false'. Continua sem ciclo e sem paralelismo — um caminho só é
    // percorrido por execução, e o publish rejeita ciclo.
    linearOnly: false,
    flowModel: 'exclusive_branching_dag',
    edgeOutcomes: { trigger: ['matched'], condition: ['true', 'false'], action: ['success'] },
    supportedPlaceholders: ['{{latencyMs}}']
  }
}
