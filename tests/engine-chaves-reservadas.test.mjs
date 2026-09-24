// As chaves do sistema (prefixo __) não podem ser escritas por caminho comum.
//
// O achado que motivou estes casos não exigia adulterar nada:
//
//     PUT /api/v1/entities/contact/<jid>/attributes/__owner__   {"value": true}
//
// promovia qualquer contato a dono, porque a rota mandava a chave crua para o
// INSERT e `ehDono()` lê exatamente essa tabela e essa chave.
//
// O inverso é igualmente sério e mais discreto: uma automação comum gravando a
// STRING "true" (em vez do booleano) em __owner__ faz `ehDono()` deixar de
// reconhecer um dono de verdade — revoga acesso de quem já tinha, em silêncio.
//
// Estes casos também protegem o que NÃO pode ser fechado junto: os caminhos
// legítimos, e o `grupo_ativo`, que não tem prefixo e precisa continuar
// gravável pelo /ativar.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { ehDono } from '../src/engine/server/owners.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const agora = new Date().toISOString()

async function capturarErro (method, pathname, body) {
  try {
    await api.resolver(method, pathname, contexto(body))
    return null
  } catch (erro) {
    return erro
  }
}

const ALVO = '5511999%40s.whatsapp.net'
const JID = '5511999@s.whatsapp.net'

try {
  // --- a rota genérica de atributos ---------------------------------------
  const virarDono = await capturarErro('PUT', `/entities/contact/${ALVO}/attributes/__owner__`, { value: true })
  check('PUT em __owner__ pela rota genérica -> 400', virarDono?.status === 400, String(virarDono?.status))
  check('e o contato NÃO virou dono', ehDono(db, JID) === false)

  const menu = await capturarErro('PUT', `/entities/global/x/attributes/__menu_config__`, { value: {} })
  check('PUT em __menu_config__ também é recusado', menu?.status === 400)

  const apagar = await capturarErro('DELETE', `/entities/contact/${ALVO}/attributes/__owner__`, null)
  check('DELETE de chave reservada também é recusado (apagar dono é revogar acesso)', apagar?.status === 400)

  const comum = await api.resolver('PUT', `/entities/contact/${ALVO}/attributes/vip`, contexto({ value: true }))
  check('variável comum continua gravando normalmente', comum.key === 'vip' && comum.value === true)

  const umUnderscore = await api.resolver('PUT', `/entities/contact/${ALVO}/attributes/_rascunho`, contexto({ value: 1 }))
  check('um underscore só NÃO é reservado — o prefixo são dois', umUnderscore.key === '_rascunho')

  // --- o caminho legítimo continua aberto ----------------------------------
  const dono = await api.resolver('POST', '/owners', contexto({ contactId: JID }))
  check('POST /owners continua marcando dono (o caminho certo não fechou)', dono !== null && ehDono(db, JID) === true)

  // --- a ação de automação -------------------------------------------------
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
  const servico = criarServicoAutomacoes(db)

  const doc = (id, chave) => ({
    schemaVersion: 1,
    enabled: true,
    name: id,
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: `/${id}`, match: 'exact', allowFrom: 'any' } },
        { id: 'v', type: 'action.variable.set', config: { scope: 'sender', key: chave, value: 'true' } }
      ],
      edges: [{ from: 'g', to: 'v', on: 'matched' }]
    }
  })

  // O publish é o primeiro portão: nem deveria aceitar.
  let recusadoNoPublish = false
  try {
    servico.criarEPublicar({ id: 'ataque', document: doc('ataque', '__owner__') })
  } catch {
    recusadoNoPublish = true
  }
  check('publicar automação que grava __owner__ é RECUSADO pelo schema', recusadoNoPublish)
  // A recusa não pode deixar entulho: antes, `criar` commitava e só depois
  // `publicar` validava, então o id ficava ocupado por uma automação que nunca
  // foi ao ar — e a tentativa seguinte batia em 409 sem nada funcionando.
  check('e a recusa não deixa a automação criada pela metade',
    db.prepare('SELECT id FROM automations WHERE id = ?').get('ataque') === undefined)

  // E o runtime é o segundo: revisão antiga no banco não passou por este schema.
  servico.criarEPublicar({ id: 'ataque', document: doc('ataque', 'marcador_comum') })
  db.prepare('UPDATE automations SET deployment_mode = ? WHERE id = ?').run('live', 'ataque')
  const revisao = db.prepare('SELECT active_revision_id FROM automations WHERE id = ?').get('ataque').active_revision_id
  const docCru = JSON.parse(db.prepare('SELECT doc_json FROM automation_revisions WHERE id = ?').get(revisao).doc_json)
  docCru.flow.nodes[1].config.key = '__owner__'
  db.prepare('UPDATE automation_revisions SET doc_json = ? WHERE id = ?').run(JSON.stringify(docCru), revisao)

  const r = avaliarEvento(db, {
    provider: 'zapo',
    accountId: 'conta',
    eventId: 'conta:x:y:1',
    occurredAt: agora,
    replay: false,
    chat: { id: '5522@s.whatsapp.net', kind: 'direct' },
    sender: { id: '5522@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
    message: { kind: 'text', text: '/ataque' },
    providerRef: { provider: 'zapo', id: 'm1' }
  })
  const run = (r.results || []).find((x) => x.automationId === 'ataque')
  check('revisão adulterada no banco vira error no runtime, não gravação', run?.status === 'error', JSON.stringify(run))
  check('e o dono de verdade continua sendo dono', ehDono(db, JID) === true)
  check('e o atacante não virou dono', ehDono(db, '5522@s.whatsapp.net') === false)
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CHAVE RESERVADA PASSARAM')
process.exit(falhas ? 1 : 0)
