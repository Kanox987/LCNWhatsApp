// Módulo 5 da Parte C do plano — o /menu (`action.menu.render`).
//
// O /menu JÁ NÃO É NATIVO: não há mais coluna de privilégio nem bypass de
// escopo. Ele é uma automação comum, de id `menu`, instalada aqui pela
// MESMA rota de qualquer outro template (ver a chamada abaixo), declarando
// `onde: em qualquer lugar`. Logo ele responde em qualquer conversa porque
// ASSIM ESTÁ ESCRITO no documento dele, e não porque o motor abre exceção —
// o dono pode editar esse escopo, trocar o gatilho, desligar ou remover.
// Banco :memory: — nunca o banco real do motor.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarApi } from '../src/engine/server/api.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p-menu', 'Pool menu', agora, agora)

// Desde a frente D a inicialização NÃO provisiona nada: o menu entra pela rota
// comum, como qualquer template. E como `menu.lcn` declara
// `depende de: config-menu`, a instalação resolve os DOIS membros — nenhum dos
// dois tem padrão para `poolId`, então os dois precisam de parâmetro.
await criarApi(db).resolver('POST', '/templates/menu/install', {
  body: {
    scope: { include: [{ kind: 'everywhere' }] },
    parameters: { menu: { poolId: 'p-menu' }, 'config-menu': { poolId: 'p-menu' } }
  },
  query: new URLSearchParams(''),
  req: { headers: {} }
})

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

const ID_DO_MENU = 'menu'
// O próprio /menu é um item da lista como qualquer outro comando publicado
// naquela conversa. Quem não quiser vê-lo ali escreve `menu: não` no .lcn dele.
const LINHA_DO_MENU = '• /menu — Mostra esta lista de comandos'
// O par do menu, que vem junto por declaração e não por acaso: `menu.lcn` tem
// `depende de: config-menu`, então instalar um instala os dois, e os dois ficam
// publicados naquela conversa. Aparecer na lista é o certo — quem não quiser o
// item escreve `menu: não` no .lcn dele.
const LINHA_DO_CONFIG = '• /configmenu — Muda o texto do menu desta conversa (só o dono)'
const PAR_DO_MENU = [LINHA_DO_MENU, LINHA_DO_CONFIG].sort()

function textoDoMenu (resultado) {
  const menu = resultado.results.find((r) => r.automationId === ID_DO_MENU)
  return menu?.commands?.[0]?.payload?.text
}

// As linhas de item do menu, sem o cabeçalho. A ORDEM entre automações não é
// contratada em lugar nenhum, então todo caso compara CONJUNTO, nunca índice.
function itensDoMenu (resultado) {
  return (textoDoMenu(resultado) || '').split('\n').slice(1).sort()
}

try {
  // Num chat onde NADA mais está escopado, o /menu ainda responde — porque o
  // documento dele diz `em qualquer lugar`, e não por exceção do motor.
  const semNadaEmEscopo = await avaliarEvento(db, eventoMenu({ chatId: '5511000000001@s.whatsapp.net', msgId: 'M1' }))
  check('o /menu responde num chat sem nenhuma OUTRA automação escopada (escopo declarado, não bypass)',
    !!textoDoMenu(semNadaEmEscopo), textoDoMenu(semNadaEmEscopo))
  check('e ali ele lista a si mesmo e o par dele, os únicos publicados naquela conversa',
    JSON.stringify(itensDoMenu(semNadaEmEscopo)) === JSON.stringify(PAR_DO_MENU),
    JSON.stringify(itensDoMenu(semNadaEmEscopo)))

  criarAutomacao({ id: 'ping', scopeId: '5511000000002@s.whatsapp.net', display: { menuLabel: '/ping', menuDescription: 'Testa a latência' } })
  const comPing = await avaliarEvento(db, eventoMenu({ chatId: '5511000000002@s.whatsapp.net', msgId: 'M2' }))
  check('/menu lista automação visível com label e descrição customizados',
    JSON.stringify(itensDoMenu(comPing)) === JSON.stringify([...PAR_DO_MENU, '• /ping — Testa a latência'].sort()),
    JSON.stringify(itensDoMenu(comPing)))

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
  check('o /menu existe de verdade no banco, instalado pela rota comum', listaAutomacoes.includes(ID_DO_MENU))
  // E nasce EDITÁVEL: documento normal, no modo ao vivo, sem marca de nativo.
  const linha = db.prepare('SELECT enabled, deployment_mode, active_revision_id, native FROM automations WHERE id = ?').get(ID_DO_MENU)
  check('o /menu é automação comum: ligada, ao vivo, com revisão ativa e SEM marca de nativo',
    linha?.enabled === 1 && linha?.deployment_mode === 'live' && !!linha?.active_revision_id && linha?.native === 0,
    JSON.stringify(linha))

  // Reenvio do MESMO evento: compara só o resultado da automação nativa em
  // si (não o total de `results`, que cresce à parte porque outras
  // automações foram criadas depois da primeira chamada) — prova que o
  // MESMO run é devolvido de novo (UNIQUE(event_id, revision) de sempre),
  // não que nenhuma automação nova entrou na lista de candidatas.
  const rodouDeNovo = await avaliarEvento(db, eventoMenu({ chatId: '5511000000001@s.whatsapp.net', msgId: 'M1' }))
  const menuNaPrimeiraVez = semNadaEmEscopo.results.find((r) => r.automationId === ID_DO_MENU)
  const menuNoReenvio = rodouDeNovo.results.find((r) => r.automationId === ID_DO_MENU)
  check('reenviar o MESMO evento de /menu é idempotente (mesmo texto, sem duplicar comando)', menuNoReenvio?.status === menuNaPrimeiraVez?.status && menuNoReenvio?.commands?.[0]?.payload?.text === menuNaPrimeiraVez?.commands?.[0]?.payload?.text)
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado no teste do /menu:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO /MENU PASSARAM')
process.exit(falhas ? 1 : 0)
