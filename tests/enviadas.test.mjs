// Separar "o bot mandou isso" de "uma pessoa digitou isso no celular do bot".
//
// O WhatsApp marca `fromMe: true` nas duas. Tratar igual custa caro dos dois
// lados: reagir à própria resposta vira laço; ignorar o dono faz o número
// principal não conseguir usar as automações dele — foi a reclamação real de
// mandar um link e o download automático não fazer nada.
import { _limparTudo, _tamanho, foiEnviadaPorNos, registrar } from '../src/enviadas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

_limparTudo()

// --- o básico -------------------------------------------------------------
check('id desconhecido não é nosso', foiEnviadaPorNos('ABC') === false)
registrar('ABC')
check('depois de registrar, é nosso', foiEnviadaPorNos('ABC') === true)
check('e outro id continua não sendo', foiEnviadaPorNos('XYZ') === false)

// --- entrada inválida não polui ------------------------------------------
_limparTudo()
for (const ruim of [null, undefined, '', 0, {}, []]) registrar(ruim)
check('valor inválido não entra no registro', _tamanho() === 0, String(_tamanho()))
for (const ruim of [null, undefined, '', 0, {}, []]) {
  check(`consulta com ${JSON.stringify(ruim)} devolve false em vez de quebrar`, foiEnviadaPorNos(ruim) === false)
}

// --- expira ---------------------------------------------------------------
// Sem expirar, o registro cresce para sempre num bot que manda muita mensagem.
_limparTudo()
registrar('CURTO', 1)
await new Promise((r) => setTimeout(r, 15))
check('id expirado deixa de ser nosso', foiEnviadaPorNos('CURTO') === false)
check('e sai da memória', _tamanho() === 0, String(_tamanho()))

_limparTudo()
registrar('LONGO', 60000)
registrar('CURTO', 1)
await new Promise((r) => setTimeout(r, 15))
registrar('NOVO')
check('a limpeza não leva junto o que ainda vale', foiEnviadaPorNos('LONGO') === true)
check('o expirado sumiu', foiEnviadaPorNos('CURTO') === false)

// --- a barreira do gatilho automático -------------------------------------
// É aqui que a distinção vira comportamento.
{
  const { avaliarEvento } = await import('../src/engine/server/evaluator.js')
  const { abrirBanco } = await import('../src/engine/server/db.js')
  const db = abrirBanco(':memory:')
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)

  const doc = {
    schemaVersion: 1,
    enabled: true,
    name: 'Reage a link',
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.message', config: { allowFrom: 'any', containsLink: true } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: 'peguei o link' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }

  const { criarServicoAutomacoes } = await import('../src/engine/server/automationsService.js')
  const servico = criarServicoAutomacoes(db)
  servico.criarEPublicar({ id: 'reage-link', document: doc })
  db.prepare("UPDATE automations SET deployment_mode='live' WHERE id='reage-link'").run()

  const base = (extra, id) => ({
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:chat:quem:${id}`,
    occurredAt: new Date().toISOString(),
    replay: false,
    chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
    sender: { id: '5511@s.whatsapp.net', ...extra },
    message: { kind: 'text', text: 'olha https://youtu.be/abc' },
    providerRef: { provider: 'zapo', id }
  })

  const casou = (r) => (r.results || []).some((x) => x.status === 'matched_live')

  check('mensagem de outra pessoa dispara',
    casou(avaliarEvento(db, base({ authoredBySelf: false, authoredByBot: false }, 'm1'))))

  // O caso que o dono pediu: ele digita um link no celular do bot.
  check('mensagem DIGITADA no número do bot dispara (allowFrom: any)',
    casou(avaliarEvento(db, base({ authoredBySelf: true, authoredByBot: false }, 'm2'))))

  // O caso que NUNCA pode disparar: a própria resposta do bot voltando.
  check('resposta produzida pelo PRÓPRIO bot não dispara — é o laço',
    casou(avaliarEvento(db, base({ authoredBySelf: true, authoredByBot: true }, 'm3'))) === false)

  // Sem a marca (gateway antigo, evento de outra origem), o seguro é o
  // comportamento de antes: authoredBySelf sozinho não deve virar laço.
  check('sem a marca, mensagem própria ainda passa pela barreira e depende de allowFrom',
    casou(avaliarEvento(db, base({ authoredBySelf: true }, 'm4'))))

  // E o padrão de quem não pediu nada continua ignorando o próprio número.
  const docPadrao = JSON.parse(JSON.stringify(doc))
  docPadrao.flow.nodes[0].config.allowFrom = 'external'
  servico.criarEPublicar({ id: 'padrao', document: docPadrao })
  db.prepare("UPDATE automations SET deployment_mode='live' WHERE id='padrao'").run()
  const r = avaliarEvento(db, base({ authoredBySelf: true, authoredByBot: false }, 'm5'))
  const daPadrao = (r.results || []).find((x) => x.automationId === 'padrao')
  check('com allowFrom "external" (o padrão), o próprio número continua ignorado',
    daPadrao?.status !== 'matched_live', daPadrao?.status)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE MENSAGEM PRÓPRIA PASSARAM')
process.exit(falhas ? 1 : 0)
