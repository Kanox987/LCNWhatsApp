// Em grupo, o bot fica inerte até o dono autorizar.
//
// Grupo é diferente de conversa direta: quem escreve lá não escolheu falar com
// o bot, e muitas vezes nem sabe que ele está no grupo. O padrão vira "não age"
// e o dono liga com um comando.
//
// O risco que estes casos guardam é o portão trancar a própria chave: se o
// comando de ativação também for bloqueado, não existe como ligar o bot de
// dentro do grupo e a única saída vira o painel.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)

const docComum = {
  schemaVersion: 1,
  enabled: true,
  name: 'Ping',
  scope: { include: [{ kind: 'everywhere' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: '/ping', match: 'exact', allowFrom: 'any' } },
      { id: 'r', type: 'action.whatsapp.reply', config: { text: 'pong' } }
    ],
    edges: [{ from: 'g', to: 'r', on: 'matched' }]
  }
}

// O comando de ativação: restrito ao dono, e é ele que grava a marca.
const docAtivar = JSON.parse(JSON.stringify(docComum))
docAtivar.name = 'Ativar'
docAtivar.flow.nodes[0].config = { command: '/ativar', match: 'exact', allowFrom: 'external', requireOwner: true }
docAtivar.flow.nodes[1] = { id: 'r', type: 'action.variable.set', config: { scope: 'chat', key: 'grupo_ativo', value: 'sim' } }

for (const [id, doc] of [['ping', docComum], ['ativar', docAtivar]]) {
  servico.criarEPublicar({ id, document: doc })
  db.prepare('UPDATE automations SET deployment_mode = ? WHERE id = ?').run('live', id)
}

// Sem dono cadastrado o comando restrito fica aberto; cadastrar um deixa o
// teste mais próximo do uso real.
db.prepare('INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('contact', '5511@s.whatsapp.net', '__owner__', 'true', agora)
db.prepare('INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('global', '__global__', '__owners_initialized__', 'true', agora)

let n = 0
const evento = (chat, texto, sender = '5511@s.whatsapp.net') => ({
  provider: 'zapo',
  accountId: 'conta',
  eventId: `conta:${chat.id}:${sender}:m${++n}`,
  occurredAt: agora,
  replay: false,
  chat,
  sender: { id: sender, authoredBySelf: false, authoredByBot: false },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', id: `m${n}` }
})

const GRUPO = { id: '123@g.us', kind: 'group' }
const DIRETO = { id: '5511@s.whatsapp.net', kind: 'direct' }

const resultado = (r, id) => (r.results || []).find((x) => x.automationId === id)
const casou = (r, id) => resultado(r, id)?.status === 'matched_live'

// --- conversa direta não precisa de nada ---------------------------------
check('em conversa direta o comando funciona sem ativar',
  casou(avaliarEvento(db, evento(DIRETO, '/ping')), 'ping'))

// --- grupo sem autorização: inerte ---------------------------------------
{
  const r = avaliarEvento(db, evento(GRUPO, '/ping'))
  check('em grupo não autorizado, comando comum NÃO responde', !casou(r, 'ping'))
  // Não gravar é parte do pedido: com 166 grupos, registrar "não casou" para
  // cada automação a cada mensagem afoga a aba Execuções.
  check('e nem fica registrado como execução', resultado(r, 'ping') === undefined,
    JSON.stringify(resultado(r, 'ping')))
}

// --- mas a chave não pode ficar trancada do lado de dentro ---------------
{
  const r = avaliarEvento(db, evento(GRUPO, '/ativar'))
  check('o comando de ativação FUNCIONA no grupo bloqueado', casou(r, 'ativar'),
    JSON.stringify(resultado(r, 'ativar')))
}

// --- depois de ativar, tudo passa ----------------------------------------
{
  const r = avaliarEvento(db, evento(GRUPO, '/ping'))
  check('depois de ativado, o comando comum responde no grupo', casou(r, 'ping'),
    JSON.stringify(resultado(r, 'ping')))
}

// --- a marca é POR GRUPO -------------------------------------------------
{
  const outro = { id: '999@g.us', kind: 'group' }
  const r = avaliarEvento(db, evento(outro, '/ping'))
  check('ativar um grupo não ativa os outros', !casou(r, 'ping'))
}

// --- desativar volta a bloquear ------------------------------------------
{
  db.prepare('UPDATE entity_attributes SET value_json = ? WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .run('""', 'group', '123@g.us', 'grupo_ativo')
  const r = avaliarEvento(db, evento(GRUPO, '/ping'))
  check('marca vazia volta a bloquear o grupo', !casou(r, 'ping'))
  check('e o comando de ativação continua passando', casou(avaliarEvento(db, evento(GRUPO, '/ativar')), 'ativar'))
}

// --- quem não é dono não liga o bot --------------------------------------
{
  db.prepare('UPDATE entity_attributes SET value_json = ? WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .run('""', 'group', '123@g.us', 'grupo_ativo')
  const r = avaliarEvento(db, evento(GRUPO, '/ativar', '5599@s.whatsapp.net'))
  check('estranho não consegue ativar o bot no grupo', !casou(r, 'ativar'),
    JSON.stringify(resultado(r, 'ativar')))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE GRUPO ATIVO PASSARAM')
process.exit(falhas ? 1 : 0)
