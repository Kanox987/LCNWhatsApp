// DOIS COMANDOS COM A MESMA PALAVRA.
//
// Nada impedia, e o efeito é o pior tipo de defeito: os DOIS respondem. Quem
// digita recebe duas respostas diferentes e não tem como saber de onde cada
// uma veio — nenhum erro, nenhum log, só uma conversa estranha.
//
// Aconteceu de verdade nesta base: o template de remover fundo instala
// "/fundo", e o de pintar o fundo nasceu com a mesma palavra. Os dois ficaram
// ligados ao mesmo tempo, no sistema de produção.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { conflitosDeComando } from '../src/engine/server/conflitos.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const agora = new Date().toISOString()

function instalar (id, comando, { ligada = true } = {}) {
  const documento = {
    schemaVersion: 1,
    id,
    revision: 1,
    enabled: true,
    name: `Comando ${id}`,
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: comando, match: 'exact', allowFrom: 'external' } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: 'oi' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare(`INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at)
    VALUES (?, 1, ?, 'live', ?, ?)`).run(id, ligada ? 1 : 0, agora, agora)
  const rev = db.prepare(`INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at)
    VALUES (?, 1, 'active', ?, ?)`).run(id, JSON.stringify(documento), agora)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)

instalar('remover-fundo', '/fundo')
check('uma automação sozinha não é conflito', conflitosDeComando(db).length === 0)

instalar('pintar-fundo', '/fundo')
const conflitos = conflitosDeComando(db)
check('duas na mesma palavra são um conflito', conflitos.length === 1, JSON.stringify(conflitos))
check('e o conflito nomeia as duas',
  conflitos[0].automacoes.map((a) => a.automationId).sort().join(',') === 'pintar-fundo,remover-fundo',
  JSON.stringify(conflitos[0]?.automacoes))

instalar('outro', '/melhorar')
check('palavra diferente não entra', conflitosDeComando(db).length === 1)

// Desligada não responde nada, e acusá-la faria a tela apontar um problema que
// não existe.
db.prepare("UPDATE automations SET enabled = 0 WHERE id = 'pintar-fundo'").run()
check('desligar uma delas resolve o conflito', conflitosDeComando(db).length === 0)
db.prepare("UPDATE automations SET enabled = 1 WHERE id = 'pintar-fundo'").run()

// Não publicada também não responde.
db.prepare("UPDATE automations SET active_revision_id = NULL WHERE id = 'pintar-fundo'").run()
check('não publicada não conta', conflitosDeComando(db).length === 0)

// --- a rota ---------------------------------------------------------------
{
  db.prepare("UPDATE automations SET active_revision_id = (SELECT id FROM automation_revisions WHERE automation_id = 'pintar-fundo') WHERE id = 'pintar-fundo'").run()
  const r = await api.resolver('GET', '/automations/conflitos', { body: null, query: new URLSearchParams(''), req: { headers: {} } })
  check('a rota devolve o conflito', r.length === 1 && r[0].comando === '/fundo', JSON.stringify(r))
}

// --- e o catálogo não nasce com dois templates na mesma palavra ------------
//
// É o que teria evitado o erro: dois templates do catálogo com o mesmo comando
// padrão colidem em toda instalação feita sem trocar o nome.
{
  const catalogo = carregarCatalogo()
  const porComando = new Map()
  for (const template of catalogo.values()) {
    const padrao = (template.parameters || []).find((p) => p.key === 'command')?.default
    if (!padrao) continue
    if (!porComando.has(padrao)) porComando.set(padrao, [])
    porComando.get(padrao).push(template.templateId)
  }
  const repetidos = [...porComando.entries()].filter(([, ids]) => ids.length > 1)
  check('nenhum comando padrão se repete no catálogo', repetidos.length === 0,
    repetidos.map(([cmd, ids]) => `${cmd}: ${ids.join(' e ')}`).join(' | '))
}

db.close()
if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nconflito de comando: tudo certo')
