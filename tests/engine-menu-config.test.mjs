// Menu configurável por conversa: cada grupo pode ter o SEU menu, o privado
// pode ter outro, e o formato pode ser texto simples ou botões interativos.
// Nenhum dos bots de referência tem isso — lá o menu é único e fixo.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { alvoDeConfig, gravarConfigDeMenu, resolverConfigDeMenu } from '../src/engine/server/menuConfig.js'
import { executarComandos } from '../src/engine/gatewayExecutor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

const GRUPO_TESTES = '120000000000000001@g.us'
const GRUPO_CLIENTES = '120000000000000002@g.us'

// Em grupo o bot só age depois que o dono autoriza. Estes casos são sobre a
// configuração do MENU por conversa, não sobre o portão — os grupos entram
// autorizados para o menu ser o que está sendo medido.
for (const g of [GRUPO_TESTES, GRUPO_CLIENTES]) {
  db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
    .run('group', g, 'grupo_ativo', '"sim"', agora)
}
const PRIVADO = '5511900000001@s.whatsapp.net'

function publicarComando (id, comando, escopo, label, descricao) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    display: { menuLabel: label, menuDescription: descricao },
    scope: { include: [{ kind: escopo.kind, id: escopo.id }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: comando, match: 'exact', allowFrom: 'external' } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: 'ok' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', escopo.kind, escopo.id)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
function eventoMenu (chatId) {
  n++
  const ehGrupo = chatId.endsWith('@g.us')
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${chatId}:x:m${n}`,
    occurredAt: agora, replay: false,
    chat: { id: chatId, kind: ehGrupo ? 'group' : 'direct' },
    sender: { id: PRIVADO, authoredBySelf: false },
    message: { kind: 'text', text: '/menu' },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: `m${n}` }
  }
}
const menuDe = (chatId) => {
  const r = avaliarEvento(db, eventoMenu(chatId))
  return r.results.find((x) => x.automationId === '__native_menu__')?.commands?.[0]
}

publicarComando('so-testes', '/testar', { kind: 'group', id: GRUPO_TESTES }, '/testar', 'Só do grupo de testes')
publicarComando('so-clientes', '/orcamento', { kind: 'group', id: GRUPO_CLIENTES }, '/orcamento', 'Pedir orçamento')
publicarComando('so-privado', '/suporte', { kind: 'contact', id: PRIVADO }, '/suporte', 'Falar com o suporte')

// --- cada conversa vê só o que vale nela (já valia, mas é a base) ---------
check('grupo de testes vê só o comando dele', menuDe(GRUPO_TESTES).payload.text.includes('/testar') && !menuDe(GRUPO_TESTES).payload.text.includes('/orcamento'))
check('grupo de clientes vê só o comando dele', menuDe(GRUPO_CLIENTES).payload.text.includes('/orcamento') && !menuDe(GRUPO_CLIENTES).payload.text.includes('/testar'))
check('privado vê só o comando do privado', menuDe(PRIVADO).payload.text.includes('/suporte') && !menuDe(PRIVADO).payload.text.includes('/testar'))

// --- texto configurável por conversa --------------------------------------
gravarConfigDeMenu(db, alvoDeConfig('group', GRUPO_CLIENTES), { header: 'Bem-vindo à nossa empresa!', footer: 'Atendimento 9h às 18h' })
const menuClientes = menuDe(GRUPO_CLIENTES).payload.text
check('o grupo de clientes tem cabeçalho próprio', menuClientes.startsWith('Bem-vindo à nossa empresa!'), menuClientes.split('\n')[0])
check('o grupo de clientes tem rodapé próprio', menuClientes.includes('Atendimento 9h às 18h'))
check('o grupo de testes continua com o cabeçalho padrão', menuDe(GRUPO_TESTES).payload.text.startsWith('Comandos disponíveis:'))

// --- padrão por TIPO de conversa ------------------------------------------
gravarConfigDeMenu(db, alvoDeConfig('direct_default'), { header: 'Menu do atendimento particular:' })
check('o padrão do privado vale sem configurar cada contato', menuDe(PRIVADO).payload.text.startsWith('Menu do atendimento particular:'))
gravarConfigDeMenu(db, alvoDeConfig('group_default'), { header: 'Menu dos grupos:' })
check('o padrão dos grupos vale para grupo sem config própria', menuDe(GRUPO_TESTES).payload.text.startsWith('Menu dos grupos:'))
check('a config do grupo específico VENCE o padrão do tipo', menuDe(GRUPO_CLIENTES).payload.text.startsWith('Bem-vindo à nossa empresa!'))

// --- cascata resolvida isoladamente ---------------------------------------
const efetiva = resolverConfigDeMenu(db, { id: GRUPO_CLIENTES, kind: 'group' }, { header: 'do nó', emptyText: 'nada aqui' })
check('cascata: config da conversa vence a do nó', efetiva.header === 'Bem-vindo à nossa empresa!')
check('cascata: campo que só o nó define é preservado', efetiva.emptyText === 'nada aqui')
check('cascata: campo que ninguém definiu cai no padrão do código', efetiva.format === 'text')

// --- formato interativo ----------------------------------------------------
gravarConfigDeMenu(db, alvoDeConfig('group', GRUPO_TESTES), { format: 'interactive', buttonTitle: 'Abrir comandos' })
const cmdInterativo = menuDe(GRUPO_TESTES)
check('formato interativo gera comando whatsapp.menu', cmdInterativo.commandType === 'whatsapp.menu')
check('comando interativo leva os itens estruturados', Array.isArray(cmdInterativo.payload.items) && cmdInterativo.payload.items[0].label === '/testar')
check('comando interativo leva o título do botão configurado', cmdInterativo.payload.title === 'Abrir comandos')
check('comando interativo SEMPRE leva o texto de reserva', typeof cmdInterativo.payload.fallbackText === 'string' && cmdInterativo.payload.fallbackText.includes('/testar'))
check('os outros grupos continuam em texto', menuDe(GRUPO_CLIENTES).commandType === 'whatsapp.reply')

// --- lado do gateway: interativo e o fallback -----------------------------
function clienteFake (falharInterativo) {
  const enviados = []
  return {
    enviados,
    message: {
      send: async (jid, conteudo) => {
        if (conteudo?.interactiveMessage && falharInterativo) throw new Error('app do destinatário não suporta botões')
        enviados.push({ jid, conteudo })
        return { ok: true }
      }
    }
  }
}
const engineFake = { execucoes: { confirmar: async () => ({ ok: true }) } }
const payloadMenu = {
  chatId: GRUPO_TESTES, title: 'Abrir comandos', header: 'Comandos:', footer: '',
  fallbackText: 'Comandos:\n• /testar', items: [{ id: '/testar', label: '/testar', description: 'Só do grupo de testes' }]
}

const c1 = clienteFake(false)
await executarComandos(c1, [{ id: 'm1', commandType: 'whatsapp.menu', payload: payloadMenu }], engineFake)
check('gateway: envia mensagem interativa de verdade', !!c1.enviados[0]?.conteudo?.interactiveMessage)
const botao = c1.enviados[0]?.conteudo?.interactiveMessage?.nativeFlowMessage?.buttons?.[0]
check('gateway: monta o botão no formato single_select', botao?.name === 'single_select')
const params = JSON.parse(botao?.buttonParamsJson || '{}')
check('gateway: as linhas do menu viram itens do seletor', params.sections?.[0]?.rows?.[0]?.title === '/testar')

const c2 = clienteFake(true)
await executarComandos(c2, [{ id: 'm2', commandType: 'whatsapp.menu', payload: payloadMenu }], engineFake)
check('gateway: se o interativo falhar, cai para texto em vez de sumir', c2.enviados[0]?.conteudo?.type === 'text')
check('gateway: o texto de reserva é o menu completo', c2.enviados[0]?.conteudo?.text.includes('/testar'))

// --- configurar o menu pelo próprio WhatsApp ------------------------------
// É o "config menu" do mockup: muda o texto sem abrir o painel, e cada grupo
// guarda o seu. Restrito ao dono — a restrição mora no GATILHO.
import { definirDono } from '../src/engine/server/owners.js'
const DONO = '5511977777777@s.whatsapp.net'

function publicarConfig () {
  const doc = {
    schemaVersion: 1, id: 'configmenu', revision: 1, name: 'configmenu', enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO_CLIENTES }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/configmenu', match: 'exact_or_args', allowFrom: 'external', requireOwner: true } },
        { id: 'c', type: 'action.menu.config', config: { field: 'header', usageText: 'Escreva o texto depois do comando.', confirmText: 'Menu deste grupo atualizado.' } }
      ],
      edges: [{ from: 'g', to: 'c', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run('configmenu', 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run('configmenu', 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO_CLIENTES)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, 'configmenu')
}
publicarConfig()
definirDono(db, DONO, true)

function eventoConfig (senderId, texto) {
  n++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${GRUPO_CLIENTES}:${senderId}:c${n}`,
    occurredAt: agora, replay: false,
    chat: { id: GRUPO_CLIENTES, kind: 'group' },
    sender: { id: senderId, authoredBySelf: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: GRUPO_CLIENTES, id: `c${n}` }
  }
}
const rConfig = (senderId, texto) => avaliarEvento(db, eventoConfig(senderId, texto)).results.find((x) => x.automationId === 'configmenu')

const okConfig = rConfig(DONO, '/configmenu Atendimento Premium:')
check('config pelo WhatsApp: o dono consegue mudar o menu', okConfig?.commands?.[0]?.payload?.text === 'Menu deste grupo atualizado.')
check('config pelo WhatsApp: o menu daquele grupo mudou de verdade', menuDe(GRUPO_CLIENTES).payload.text.startsWith('Atendimento Premium:'))
check('config pelo WhatsApp: o rodapé configurado antes NÃO foi apagado', menuDe(GRUPO_CLIENTES).payload.text.includes('Atendimento 9h às 18h'))
check('config pelo WhatsApp: outro grupo não foi afetado', !menuDe(GRUPO_TESTES).payload.fallbackText?.startsWith('Atendimento Premium:'))

const semArgumento = rConfig(DONO, '/configmenu')
check('config sem texto: explica como usar em vez de apagar o menu', semArgumento?.commands?.[0]?.payload?.text === 'Escreva o texto depois do comando.')

const naoDono = rConfig(PRIVADO, '/configmenu Invadido')
check('config pelo WhatsApp: quem não é dono nem aciona o comando', naoDono?.status === 'no_match')
check('config pelo WhatsApp: o menu continua o do dono', menuDe(GRUPO_CLIENTES).payload.text.startsWith('Atendimento Premium:'))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE MENU CONFIGURÁVEL PASSARAM')
process.exit(falhas ? 1 : 0)
