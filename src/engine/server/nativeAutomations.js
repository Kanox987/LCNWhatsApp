// Módulo 5 da Parte C do plano — automações nativas: comandos do próprio
// sistema (hoje só /menu) que precisam estar disponíveis em QUALQUER chat
// sem o usuário precisar configurar nada. Diferente de uma automação
// normal (sempre exige scope.include explícito, nunca casa com "todos"
// por padrão — regra de segurança pra conteúdo AUTORADO PELO USUÁRIO),
// uma automação nativa é conteúdo do próprio motor, então o avaliador
// (evaluator.js) faz um bypass explícito do escopo só quando
// `automations.native = 1`.
import { validarAutomacao } from './validate.js'

const ID_POOL_NATIVO = '__native__'
const ID_MENU = '__native_menu__'

function documentoMenu () {
  return {
    schemaVersion: 1,
    id: ID_MENU,
    revision: 1,
    enabled: true,
    name: 'Menu de comandos (nativo)',
    scope: { include: [], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: ID_POOL_NATIVO },
    flow: {
      nodes: [
        { id: 'gatilho-menu', type: 'trigger.command', config: { command: '/menu', match: 'exact', allowFrom: 'external' } },
        { id: 'render-menu', type: 'action.menu.render', config: {} }
      ],
      edges: [
        { from: 'gatilho-menu', to: 'render-menu', on: 'matched' }
      ]
    }
  }
}

// Idempotente: chamado toda vez que o motor abre o banco (db.js). Se a
// automação nativa já existe, não faz nada — nunca sobrescreve em cima de
// uma automação nativa já publicada (evita reviver algo que um admin
// tenha desabilitado manualmente no futuro, quando isso virar possível).
export function garantirAutomacoesNativas (db) {
  const agora = new Date().toISOString()
  db.prepare(`INSERT OR IGNORE INTO pools (id, label, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(ID_POOL_NATIVO, 'Reservado para automações nativas', agora, agora)

  const jaExiste = db.prepare('SELECT 1 FROM automations WHERE id = ?').get(ID_MENU)
  if (jaExiste) return

  const documento = documentoMenu()
  const erros = validarAutomacao(db, documento)
  if (erros.length) {
    throw new Error(`Documento nativo de /menu inválido (bug interno, nunca deveria acontecer): ${JSON.stringify(erros)}`)
  }

  const transacao = db.transaction(() => {
    db.prepare(`INSERT INTO automations
      (id, schema_version, enabled, active_revision_id, deployment_mode, native, created_at, updated_at)
      VALUES (?, 1, 1, NULL, 'live', 1, ?, ?)`)
      .run(ID_MENU, agora, agora)
    const resultado = db.prepare(`INSERT INTO automation_revisions
      (automation_id, revision, status, doc_json, validation_errors_json, created_at)
      VALUES (?, 1, 'active', ?, '[]', ?)`)
      .run(ID_MENU, JSON.stringify(documento), agora)
    db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(resultado.lastInsertRowid, ID_MENU)
  })
  transacao()
}

export const IDS_NATIVOS = { menu: ID_MENU, poolNativo: ID_POOL_NATIVO }
