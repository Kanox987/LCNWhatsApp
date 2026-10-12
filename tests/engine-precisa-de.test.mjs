// A exigência declarada: "precisa de um link: na citada ou na mensagem".
//
// O QUE ISTO SUBSTITUI, e por que importa. A entrada da ação era escrita assim:
//
//     url: "{{quoted.link}} {{message.link}}"
//
// e o dono leu exatamente o que ela é: "isso é muito abstrato... ele vai
// procurar um link na mensagem, como?". A resposta é que aquela string esconde
// um algoritmo — interpola os dois marcadores, APAGA o que não resolveu, e pega
// o primeiro link que sobrou. Ninguém adivinha isso lendo.
//
// Declarado, o motor resolve ANTES de rodar o fluxo, responde quando falta, e a
// ação escreve `url: o link`.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)

function publicar (id, requires, texto = 'peguei: {{precisa.link}}') {
  const doc = {
    schemaVersion: 1,
    id,
    revision: 1,
    enabled: true,
    name: id,
    scope: { include: [{ kind: 'everywhere' }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only', ...(requires ? { requires } : {}) },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/dow', match: 'exact_or_args', allowFrom: 'any' } },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: texto } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  servico.criarEPublicar({ id, document: doc })
  db.prepare('UPDATE automations SET deployment_mode = ?, enabled = ? WHERE id = ?').run('live', 0, id)
  return id
}

let n = 0
function evento ({ texto = '/dow', citado = null } = {}) {
  n++
  return {
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:c:s:m${n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
    sender: { id: '5511@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
    message: {
      kind: 'text',
      text: texto,
      ...(citado ? { quotedRef: { id: 'q1', remoteJid: '5511@s.whatsapp.net', text: citado } } : {})
    },
    providerRef: { provider: 'zapo', id: `m${n}` }
  }
}

// Uma automação por vez: ligo só a que estou testando, senão todas respondem
// ao mesmo /dow e os comandos se misturam.
function rodar (id, ev) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  const r = avaliarEvento(db, ev)
  return (r.results || []).find((x) => x.automationId === id)
}

const LINK_MSG = 'https://instagram.com/p/NA-MENSAGEM'
const LINK_CIT = 'https://instagram.com/p/NA-CITADA'

// --- a ordem de procura é a ordem escrita --------------------------------
//
// É o que permite um comando aceitar as DUAS formas — responder uma mensagem
// com link ou colar o link junto — sem a pessoa escolher uma na instalação.
publicar('citada-primeiro', { kind: 'link', from: ['quoted', 'message'], missingText: 'Manda um link.' })
publicar('mensagem-primeiro', { kind: 'link', from: ['message', 'quoted'], missingText: 'Manda um link.' })

{
  const r = rodar('citada-primeiro', evento({ texto: `/dow ${LINK_MSG}`, citado: LINK_CIT }))
  check('com as duas, "na citada ou na mensagem" pega a da CITADA',
    r.commands[0]?.payload.text === `peguei: ${LINK_CIT}`, r.commands[0]?.payload.text)
}
{
  const r = rodar('mensagem-primeiro', evento({ texto: `/dow ${LINK_MSG}`, citado: LINK_CIT }))
  check('e "na mensagem ou na citada" pega a da MENSAGEM',
    r.commands[0]?.payload.text === `peguei: ${LINK_MSG}`, r.commands[0]?.payload.text)
}
{
  // Só a citada tem link: a procura continua e acha.
  const r = rodar('mensagem-primeiro', evento({ texto: '/dow', citado: LINK_CIT }))
  check('faltando na primeira fonte, procura na segunda',
    r.commands[0]?.payload.text === `peguei: ${LINK_CIT}`, r.commands[0]?.payload.text)
}

// --- o portão: sem o que precisa, o fluxo NÃO roda -----------------------
{
  const r = rodar('citada-primeiro', evento({ texto: '/dow' }))
  check('sem link nenhum, a automação casa', r?.status === 'matched_live', r?.status)
  check('mas o fluxo não roda: a resposta é o aviso de falta',
    r.commands.length === 1 && r.commands[0].payload.text === 'Manda um link.',
    JSON.stringify(r.commands.map((c) => c.payload.text)))
}
{
  // Sem mensagem de falta, o comando fica em SILÊNCIO — e silêncio é o pior
  // desfecho, porque não dá nem para saber se funcionou. Por isso o aviso é
  // recomendado, mas a ausência dele não pode inventar texto.
  publicar('sem-aviso', { kind: 'link', from: ['message'] })
  const r = rodar('sem-aviso', evento({ texto: '/dow' }))
  check('sem missingText declarado, nada é enviado — não se inventa texto',
    r.commands.length === 0, JSON.stringify(r.commands))
}

// --- mídia é token, e token NÃO chega ao interpolador -------------------
//
// Invariante 4: o motor nunca vê mídia de conversa, só uma referência opaca.
// A exigência de mídia serve de portão e de mensagem de falta; quem precisa do
// ref continua resolvendo estruturalmente.
{
  publicar('precisa-midia', { kind: 'media', from: ['message', 'quoted'], missingText: 'Manda o arquivo.' },
    'tentando vazar: {{precisa.media}} {{precisa.mediaRef}}')
  const r = rodar('precisa-midia', evento({ texto: '/dow' }))
  check('sem mídia, responde o aviso de falta', r.commands[0]?.payload.text === 'Manda o arquivo.')

  const comMidia = evento({ texto: '/dow' })
  comMidia.message.mediaRef = 'TOKEN-OPACO-QUE-NAO-PODE-VAZAR'
  comMidia.message.kind = 'text'
  const r2 = rodar('precisa-midia', comMidia)
  const enviado = r2.commands[0]?.payload.text || ''
  check('com mídia, o fluxo roda', r2.commands.length === 1, JSON.stringify(r2.commands))
  check('e o TOKEN não aparece no texto — invariante 4 de pé',
    !enviado.includes('TOKEN-OPACO-QUE-NAO-PODE-VAZAR'), enviado)
  // Placeholder que não resolve fica literal, o que é o sinal de erro desta
  // base — nunca vira vazio nem false inventado.
  check('o marcador fica literal, sinalizando o uso errado', enviado.includes('{{precisa.'), enviado)
}

// --- sem exigência declarada, nada muda ---------------------------------
{
  publicar('sem-exigencia', null, 'rodei sem exigir nada')
  const r = rodar('sem-exigencia', evento({ texto: '/dow' }))
  check('automação que não declara exigência roda como sempre',
    r.commands[0]?.payload.text === 'rodei sem exigir nada', JSON.stringify(r.commands))
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE "PRECISA DE" PASSARAM')
process.exit(falhas ? 1 : 0)
