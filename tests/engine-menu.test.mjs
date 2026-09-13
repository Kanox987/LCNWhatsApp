// Módulo 5 da Parte C do plano — /menu nativo (`action.menu.render` +
// bypass de escopo pra automação `native = 1`, ver nativeAutomations.js).
// Banco :memory: — nunca o banco real do motor. `abrirBanco()` já semeia
// a automação nativa `/menu` sozinha (mesmo caminho que o motor real usa
// no boot), então este teste não precisa recriá-la.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p-menu', 'Pool menu', agora, agora)

function criarAutomacao ({ id, scopeId, scopeKind = 'contact', display, deploymentMode = 'live', enabled = true, command = `/${id}` }) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    ...(display ? { display } : {}),
    scope: { include: [{ kind: scopeKind, id: scopeId }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p-menu' },
    flow: {
      nodes: [
        { id: 'trigger', type: 'trigger.command', config: { command, match: 'exact', allowFrom: 'external' } },
        { id: 'reply', type: 'action.whatsapp.reply', config: { text: 'ok' } }
      ],
      edges: [{ from: 'trigger', to: 'reply', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)')
    .run(id, enabled ? 1 : 0, deploymentMode, agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', scopeKind, scopeId)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

function eventoMenu ({ chatId, msgId, textoComando = '/menu' } = {}) {
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${chatId}:${chatId}:${msgId}`,
    occurredAt: new Date().toISOString(), replay: false,
    chat: { id: chatId, kind: 'direct' },
    sender: { id: chatId, authoredBySelf: false },
    message: { kind: 'text', text: textoComando },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: msgId }
  }
}

function textoDoMenu (resultado) {
  const menu = resultado.results.find((r) => r.automationId === '__native_menu__')
  return menu?.commands?.[0]?.payload?.text
}

try {
  const semNadaEmEscopo = await avaliarEvento(db, eventoMenu({ chatId: '5511000000001@s.whatsapp.net', msgId: 'M1' }))
  check('/menu responde mesmo num chat sem NENHUMA automação escopada pra ele (bypass de escopo nativo)', textoDoMenu(semNadaEmEscopo)?.includes('Nenhum comando'))

  criarAutomacao({ id: 'ping', scopeId: '5511000000002@s.whatsapp.net', display: { menuLabel: '/ping', menuDescription: 'Testa a latência' } })
  const comPing = await avaliarEvento(db, eventoMenu({ chatId: '5511000000002@s.whatsapp.net', msgId: 'M2' }))
  check('/menu lista automação visível com label e descrição customizados', textoDoMenu(comPing) === 'Comandos disponíveis:\n• /ping — Testa a latência')

  const outroContato = await avaliarEvento(db, eventoMenu({ chatId: '5511000000003@s.whatsapp.net', msgId: 'M3' }))
  check('/menu NÃO lista automação fora de escopo pra este contato', !textoDoMenu(outroContato).includes('/ping'))

  criarAutomacao({ id: 'semlabel', scopeId: '5511000000004@s.whatsapp.net', command: '/semlabel' })
  const semLabel = await avaliarEvento(db, eventoMenu({ chatId: '5511000000004@s.whatsapp.net', msgId: 'M4' }))
  check('sem display.menuLabel, usa o próprio comando do gatilho como rótulo (nunca undefined)', textoDoMenu(semLabel).includes('• /semlabel'))

  criarAutomacao({ id: 'sombra', scopeId: '5511000000005@s.whatsapp.net', deploymentMode: 'shadow', display: { menuLabel: '/sombra' } })
  const comSombra = await avaliarEvento(db, eventoMenu({ chatId: '5511000000005@s.whatsapp.net', msgId: 'M5' }))
  check('automação em modo sombra NUNCA aparece no /menu (não está de fato respondendo)', !textoDoMenu(comSombra).includes('/sombra'))

  criarAutomacao({ id: 'desligada', scopeId: '5511000000006@s.whatsapp.net', enabled: false, display: { menuLabel: '/desligada' } })
  const comDesligada = await avaliarEvento(db, eventoMenu({ chatId: '5511000000006@s.whatsapp.net', msgId: 'M6' }))
  check('automação desabilitada NUNCA aparece no /menu', !textoDoMenu(comDesligada).includes('/desligada'))

  const listaAutomacoes = db.prepare('SELECT id FROM automations').all().map((r) => r.id)
  check('a automação nativa /menu existe de verdade no banco (semeada por abrirBanco())', listaAutomacoes.includes('__native_menu__'))

  // Reenvio do MESMO evento: compara só o resultado da automação nativa em
  // si (não o total de `results`, que cresce à parte porque outras
  // automações foram criadas depois da primeira chamada) — prova que o
  // MESMO run é devolvido de novo (UNIQUE(event_id, revision) de sempre),
  // não que nenhuma automação nova entrou na lista de candidatas.
  const rodouDeNovo = await avaliarEvento(db, eventoMenu({ chatId: '5511000000001@s.whatsapp.net', msgId: 'M1' }))
  const menuNaPrimeiraVez = semNadaEmEscopo.results.find((r) => r.automationId === '__native_menu__')
  const menuNoReenvio = rodouDeNovo.results.find((r) => r.automationId === '__native_menu__')
  check('reenviar o MESMO evento de /menu é idempotente (mesmo texto, sem duplicar comando)', menuNoReenvio?.status === menuNaPrimeiraVez?.status && menuNoReenvio?.commands?.[0]?.payload?.text === menuNaPrimeiraVez?.commands?.[0]?.payload?.text)
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado no teste do /menu:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO MENU NATIVO PASSARAM')
process.exit(falhas ? 1 : 0)
