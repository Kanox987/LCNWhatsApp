// Configuração do /menu por conversa.
//
// O pedido: cada grupo pode ter o SEU menu, e o privado pode ter outro — tanto
// no texto quanto no formato (lista de texto simples ou mensagem interativa
// com botões). Nenhum dos bots de referência tem isso; lá o menu é único.
//
// Guardado em entity_attributes numa chave reservada, pelo mesmo motivo dos
// donos: reaproveita CRUD, tela e escopos que já existem, em vez de criar mais
// uma tabela para guardar quatro campos.
import { ID_GLOBAL } from './attributeScopes.js'

export const CHAVE_MENU = '__menu_config__'
export const CHAVE_MENU_PADRAO_GRUPO = '__menu_default_group__'
export const CHAVE_MENU_PADRAO_PRIVADO = '__menu_default_direct__'

export const FORMATOS = Object.freeze(['text', 'interactive'])

const PADRAO = Object.freeze({
  format: 'text',
  header: 'Comandos disponíveis:',
  footer: '',
  emptyText: 'Nenhum comando disponível por aqui ainda.',
  buttonTitle: 'Ver comandos'
})

function lerJson (db, scopeKind, scopeId, chave) {
  const linha = db.prepare('SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .get(scopeKind, scopeId, chave)
  if (!linha) return null
  try {
    const valor = JSON.parse(linha.value_json)
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : null
  } catch {
    return null
  }
}

// Só campos conhecidos entram, e cada um com o tipo certo. Um valor
// adulterado no banco vira "campo ausente", nunca um menu quebrado.
function limpar (bruto) {
  if (!bruto) return {}
  const limpo = {}
  if (FORMATOS.includes(bruto.format)) limpo.format = bruto.format
  for (const campo of ['header', 'footer', 'emptyText', 'buttonTitle']) {
    if (typeof bruto[campo] === 'string') limpo[campo] = bruto[campo]
  }
  return limpo
}

// Cascata, do mais específico para o mais geral:
//   1. a configuração daquela conversa exata (este grupo, este contato)
//   2. o padrão do tipo de conversa (todos os grupos / todo o privado)
//   3. o que o próprio nó action.menu.render trouxer no documento
//   4. o padrão do código
// Assim dá para ter um menu diferente num grupo específico sem precisar
// configurar todos os outros.
export function resolverConfigDeMenu (db, chat, configDoNo = {}) {
  const ehGrupo = chat?.kind === 'group'
  const scopeKind = ehGrupo ? 'group' : 'contact'
  const especifica = chat?.id ? limpar(lerJson(db, scopeKind, chat.id, CHAVE_MENU)) : {}
  const chavePadrao = ehGrupo ? CHAVE_MENU_PADRAO_GRUPO : CHAVE_MENU_PADRAO_PRIVADO
  const padraoDoTipo = limpar(lerJson(db, 'global', ID_GLOBAL, chavePadrao))
  const doNo = limpar(configDoNo)

  return { ...PADRAO, ...doNo, ...padraoDoTipo, ...especifica }
}

export function gravarConfigDeMenu (db, alvo, config) {
  const limpo = limpar(config)
  db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
      value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run(alvo.scopeKind, alvo.scopeId, alvo.key, JSON.stringify(limpo), new Date().toISOString())
  return limpo
}

export function lerConfigDeMenu (db, alvo) {
  return limpar(lerJson(db, alvo.scopeKind, alvo.scopeId, alvo.key))
}

export function apagarConfigDeMenu (db, alvo) {
  return db.prepare('DELETE FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .run(alvo.scopeKind, alvo.scopeId, alvo.key).changes > 0
}

// Traduz o alvo vindo da API para a linha real da tabela. Os dois padrões
// moram no escopo 'global' (que o CHECK aceita) em chaves diferentes — o
// "tipo" só existe na API, nunca como scope_kind inventado no banco.
export function alvoDeConfig (kind, id) {
  if (kind === 'group_default') return { scopeKind: 'global', scopeId: ID_GLOBAL, key: CHAVE_MENU_PADRAO_GRUPO }
  if (kind === 'direct_default') return { scopeKind: 'global', scopeId: ID_GLOBAL, key: CHAVE_MENU_PADRAO_PRIVADO }
  if (kind === 'group' && id) return { scopeKind: 'group', scopeId: id, key: CHAVE_MENU }
  if (kind === 'contact' && id) return { scopeKind: 'contact', scopeId: id, key: CHAVE_MENU }
  return null
}
