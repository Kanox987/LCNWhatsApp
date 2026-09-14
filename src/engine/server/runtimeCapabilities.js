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
