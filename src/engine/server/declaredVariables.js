// Catálogo de variáveis conhecidas: o que existe e para que serve, separado
// do que vale (entity_attributes).
//
// Resolve um problema concreto: instalar o anti-link cria uma automação que
// usa um contador de avisos, mas esse contador só passa a existir de verdade
// na primeira infração. Até lá a pessoa não vê a variável em lugar nenhum e
// não sabe que pode usá-la nos próprios comandos. Declarar na instalação
// fecha essa lacuna sem inventar valor para ninguém.

// Como a automação escreve o escopo no texto: {{var.<escopo>.<chave>}}.
// 'chat' e 'member' são os nomes que aparecem na interpolação; a tabela de
// valores usa outros (contact/group, group_member) porque lá o que importa é
// onde a linha mora, não como se escreve.
export const ESCOPOS_DECLARAVEIS = Object.freeze([
  'chat', 'sender', 'member', 'target', 'targetMember', 'category', 'global'
])

export const TIPOS_DE_VALOR = Object.freeze(['text', 'number', 'boolean'])

function valido (declaracao) {
  if (!declaracao || typeof declaracao !== 'object') return false
  if (!ESCOPOS_DECLARAVEIS.includes(declaracao.scope)) return false
  if (typeof declaracao.key !== 'string' || !declaracao.key.trim()) return false
  if (declaracao.valueType !== undefined && !TIPOS_DE_VALOR.includes(declaracao.valueType)) return false
  return true
}

// Como a variável se escreve dentro de um comando. É o que a aba mostra e o
// que o botão de copiar entrega — a pessoa nunca deveria precisar montar isso
// de cabeça.
export function modoDeUso (scope, key) {
  if (scope === 'category') return `{{var.category.<categoria>.${key}}}`
  return `{{var.${scope}.${key}}}`
}

export function listarDeclaradas (db) {
  return db.prepare(`SELECT scope, key, value_type, description, source_template, source_automation, created_at
    FROM declared_variables ORDER BY scope, key`).all().map((linha) => ({
    scope: linha.scope,
    key: linha.key,
    valueType: linha.value_type,
    description: linha.description || null,
    sourceTemplate: linha.source_template || null,
    sourceAutomation: linha.source_automation || null,
    createdAt: linha.created_at,
    usage: modoDeUso(linha.scope, linha.key)
  }))
}

// Registra uma declaração. Idempotente por (scope, key): reinstalar o mesmo
// comando não duplica, e não sobrescreve uma descrição que a pessoa tenha
// ajustado à mão — só preenche o que estiver vazio.
export function declarar (db, declaracao, { sourceTemplate = null, sourceAutomation = null } = {}) {
  if (!valido(declaracao)) return false
  db.prepare(`INSERT INTO declared_variables
      (scope, key, value_type, description, source_template, source_automation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, key) DO UPDATE SET
      description = COALESCE(declared_variables.description, excluded.description),
      source_template = COALESCE(declared_variables.source_template, excluded.source_template),
      source_automation = COALESCE(declared_variables.source_automation, excluded.source_automation)`)
    .run(
      declaracao.scope,
      declaracao.key.trim(),
      declaracao.valueType || 'text',
      declaracao.description || null,
      sourceTemplate,
      sourceAutomation,
      new Date().toISOString()
    )
  return true
}

// Declara em lote o que um template trouxe. Silenciosamente ignora entrada
// malformada em vez de derrubar a instalação inteira: uma declaração torta é
// um problema de documentação do template, não motivo para o comando não ser
// instalado. Devolve quantas entraram, para o chamador poder registrar.
export function declararDoTemplate (db, declaracoes, contexto) {
  if (!Array.isArray(declaracoes)) return 0
  let total = 0
  for (const declaracao of declaracoes) {
    if (declarar(db, declaracao, contexto)) total++
  }
  return total
}

export function removerDeclaracao (db, scope, key) {
  return db.prepare('DELETE FROM declared_variables WHERE scope = ? AND key = ?').run(scope, key).changes > 0
}
