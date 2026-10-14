// Duas chamadas em sequência: melhorar a foto e DEPOIS virar figurinha.
//
// O PROBLEMA, nas palavras do dono: "não poderíamos ser limitados a uma única
// chamada, isso pode acabar limitando outros tipos de api". E a saída foi
// ideia dele: "comandos que ficam aguardando uma resposta ficam dormindo até
// serem respondidos" — a fila já existia, faltava a confirmação trazer o
// RESULTADO e o motor saber retomar.
//
// O QUE ISTO CONSERTA, e é pior do que faltar: a sequência JÁ COMPILAVA. Dois
// `chama` seguidos viravam dois comandos emitidos ao mesmo tempo, cada um
// pegando a mídia da mensagem. A pessoa escrevia um cano e recebia duas
// conversões paralelas, sem erro nenhum.
//
// A PEÇA QUE TORNA ISSO SEGURO: o resultado volta como TOKEN, nunca como
// bytes. É o mesmo contrato da mídia que chega pela conversa, usado na outra
// direção — o gateway guarda os bytes e o motor só vê a referência.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento, registrarResultadoExecucao } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const CHAT = '5511900000001@s.whatsapp.net'
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
db.prepare('INSERT INTO connections (id, kind, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
  .run('imagem', 'http', JSON.stringify({
    endereco: 'http://127.0.0.1:8767',
    autenticacao: { tipo: 'nenhuma' },
    funcoes: [
      { nome: 'melhorar', metodo: 'POST', caminho: '/melhorar', enderecoProprio: false, entradas: [{ nome: 'arquivo', tipo: 'mídia', obrigatoria: true }], resposta: { forma: 'arquivo', campo: 'a' } },
      { nome: 'figurinha', metodo: 'POST', caminho: '/figurinha', enderecoProprio: false, entradas: [{ nome: 'arquivo', tipo: 'mídia', obrigatoria: true }, { nome: 'pacote', tipo: 'texto', obrigatoria: false }], resposta: { forma: 'arquivo', campo: 'a', tipo: 'figurinha' } },
      { nome: 'perguntar', metodo: 'POST', caminho: '/ia', enderecoProprio: false, entradas: [{ nome: 'texto', tipo: 'texto', obrigatoria: true }], resposta: { forma: 'texto', campo: 'resposta' } }
    ]
  }), agora, agora)
const servico = criarServicoAutomacoes(db)

function publicar (id, nodes, edges) {
  servico.criarEPublicar({
    id,
    document: {
      schemaVersion: 1,
      id,
      revision: 1,
      enabled: true,
      name: id,
      scope: { include: [{ kind: 'everywhere' }], exclude: [] },
      inputPolicy: { acceptedMessageKinds: ['text', 'image'], historyPolicy: 'live_only' },
      responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
      flow: { nodes, edges }
    }
  })
  db.prepare('UPDATE automations SET deployment_mode = ?, enabled = ? WHERE id = ?').run('live', 0, id)
  return id
}

const gatilho = { id: 'g', type: 'trigger.command', config: { command: '/x', match: 'exact_or_args', allowFrom: 'any' } }
const chamada = (id, funcao, extra = {}) => ({
  id, type: 'action.connection.call', config: { connectionRef: 'imagem', function: funcao, mediaInput: 'arquivo', ...extra }
})

publicar('cano', [
  gatilho,
  chamada('melhora', 'melhorar'),
  chamada('fig', 'figurinha', { mediaFrom: 'resultado', inputs: { pacote: 'LCN' } })
], [{ from: 'g', to: 'melhora', on: 'matched' }, { from: 'melhora', to: 'fig', on: 'success' }])

let n = 0
function rodar (id) {
  n++
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  const ev = {
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:c:s:k${n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredBySelf: false, authoredByBot: false },
    message: { kind: 'image', text: '/x', mediaRef: 'TOKEN-DA-MENSAGEM', mediaKind: 'image' },
    providerRef: { provider: 'zapo', id: `k${n}` }
  }
  return (avaliarEvento(db, ev).results || []).find((x) => x.automationId === id)
}

const comandosDoRun = (runId) => db.prepare('SELECT * FROM outbound_commands WHERE run_id = ? ORDER BY rowid').all(runId)

// --- o primeiro passo sai sozinho, e marcado -----------------------------
const r1 = rodar('cano')
check('só o PRIMEIRO passo sai na avaliação', r1.commands.length === 1, String(r1.commands.length))
{
  const p = r1.commands[0].payload
  check('e ele vai marcado como elo de cadeia', p.encadeado === true)
  check('dizendo de onde retomar', p.retomarDe === 'melhora', p.retomarDe)
  check('com a mídia da MENSAGEM', p.mediaRef === 'TOKEN-DA-MENSAGEM', p.mediaRef)
}

const runId = db.prepare('SELECT run_id FROM outbound_commands ORDER BY rowid DESC LIMIT 1').get().run_id
const primeiro = comandosDoRun(runId)[0]

// --- a confirmação com resultado ACORDA o resto --------------------------
registrarResultadoExecucao(db, primeiro.id, {
  status: 'sent',
  resultado: { token: 'TOKEN-DO-RESULTADO', tipo: 'image', mime: 'image/jpeg' }
})
{
  const cmds = comandosDoRun(runId)
  check('o segundo passo nasce quando o primeiro é confirmado', cmds.length === 2, String(cmds.length))
  const p = JSON.parse(cmds[1].payload_json)
  check('e ele é a chamada seguinte', p.funcao === 'figurinha', p.funcao)
  // O PONTO CENTRAL: o passo 2 usa o resultado do passo 1, não a mídia da
  // mensagem de novo. Era isso que a sequência fazia errado em silêncio.
  check('usando o RESULTADO do passo anterior', p.mediaRef === 'TOKEN-DO-RESULTADO', p.mediaRef)
  check('e não a mídia da mensagem', p.mediaRef !== 'TOKEN-DA-MENSAGEM')
  check('o último passo NÃO é elo — ele entrega', !p.encadeado, JSON.stringify(p.encadeado))
  check('as entradas do passo 2 continuam valendo', p.entradas?.pacote === 'LCN', JSON.stringify(p.entradas))
  check('a cadeia inteira fica no MESMO run, como uma coisa só',
    cmds.every((c) => c.run_id === runId))
}

// --- acorda UMA VEZ SÓ ---------------------------------------------------
//
// A confirmação pode chegar duas vezes (reenvio, gateway que subiu de novo), e
// retomar duas vezes mandaria a figurinha em dobro.
registrarResultadoExecucao(db, primeiro.id, { status: 'sent', resultado: { token: 'OUTRO', tipo: 'image' } })
check('confirmar de novo NÃO cria outro passo', comandosDoRun(runId).length === 2,
  String(comandosDoRun(runId).length))

// --- falhou no meio: a cadeia para ---------------------------------------
{
  const r = rodar('cano')
  const run = db.prepare('SELECT run_id FROM outbound_commands ORDER BY rowid DESC LIMIT 1').get().run_id
  const cmd = comandosDoRun(run)[0]
  registrarResultadoExecucao(db, cmd.id, { status: 'failed' })
  check('passo que falhou não acorda o seguinte', comandosDoRun(run).length === 1,
    String(comandosDoRun(run).length))
  check('e a avaliação tinha gerado só o primeiro', r.commands.length === 1)
}
{
  // Resultado incerto também não: só "deu certo" segue adiante.
  const r = rodar('cano')
  const run = db.prepare('SELECT run_id FROM outbound_commands ORDER BY rowid DESC LIMIT 1').get().run_id
  registrarResultadoExecucao(db, comandosDoRun(run)[0].id, { status: 'outcome_unknown' })
  check('resultado incerto não acorda o seguinte', comandosDoRun(run).length === 1,
    String(comandosDoRun(run).length))
  check('e nada foi inventado na avaliação', r.commands.length === 1)
}

// --- SOMBRA não encadeia -------------------------------------------------
//
// Em sombra o fluxo nem roda, então não há comando para confirmar. O caso
// existe para a retomada nunca virar a porta dos fundos do modo sombra.
{
  db.prepare("UPDATE automations SET deployment_mode = 'shadow' WHERE id = 'cano'").run()
  const r = rodar('cano')
  check('em sombra, nenhum comando é gerado', (r.commands || []).length === 0, JSON.stringify(r.commands))
  check('e o registro diz que foi sombra', r.status === 'matched_shadow', r.status)
  db.prepare("UPDATE automations SET deployment_mode = 'live' WHERE id = 'cano'").run()
}

// --- resultado de TEXTO também atravessa ---------------------------------
//
// Um serviço que responde em palavras — uma IA — pode alimentar o passo
// seguinte. Aí o resultado é informação, e entra no que dá para escrever.
publicar('texto-depois', [
  gatilho,
  { id: 'pergunta', type: 'action.connection.call', config: { connectionRef: 'imagem', function: 'perguntar', inputs: { texto: 'oi' } } },
  { id: 'responde', type: 'action.whatsapp.reply', config: { text: 'a IA disse: {{resultado.texto}}' } }
], [{ from: 'g', to: 'pergunta', on: 'matched' }, { from: 'pergunta', to: 'responde', on: 'success' }])

{
  rodar('texto-depois')
  const run = db.prepare('SELECT run_id FROM outbound_commands ORDER BY rowid DESC LIMIT 1').get().run_id
  registrarResultadoExecucao(db, comandosDoRun(run)[0].id, { status: 'sent', resultado: { texto: 'bom dia' } })
  const cmds = comandosDoRun(run)
  check('o texto do serviço vira o passo seguinte', cmds.length === 2, String(cmds.length))
  check('e dá para escrevê-lo na resposta',
    JSON.parse(cmds[1].payload_json).text === 'a IA disse: bom dia',
    JSON.parse(cmds[1].payload_json).text)
}

// --- o TOKEN não entra no que se escreve ---------------------------------
//
// Invariante 4: a mídia que volta de uma chamada é capacidade, não informação.
// O token alimenta o passo seguinte como ARQUIVO e nunca aparece num texto.
publicar('vazar', [
  gatilho,
  chamada('melhora2', 'melhorar'),
  { id: 'fala', type: 'action.whatsapp.reply', config: { text: 'token=[{{resultado.token}}] tipo=[{{resultado.tipo}}]' } }
], [{ from: 'g', to: 'melhora2', on: 'matched' }, { from: 'melhora2', to: 'fala', on: 'success' }])

{
  rodar('vazar')
  const run = db.prepare('SELECT run_id FROM outbound_commands ORDER BY rowid DESC LIMIT 1').get().run_id
  registrarResultadoExecucao(db, comandosDoRun(run)[0].id, {
    status: 'sent',
    resultado: { token: 'TOKEN-SECRETO', tipo: 'image', mime: 'image/jpeg' }
  })
  const texto = JSON.parse(comandosDoRun(run)[1].payload_json).text
  check('o token NÃO aparece no texto', !texto.includes('TOKEN-SECRETO'), texto)
  check('o marcador fica literal, sinalizando o uso errado', texto.includes('{{resultado.token}}'), texto)
  // O que é informação continua legível: o tipo do arquivo não é segredo.
  check('mas o tipo do resultado é legível', texto.includes('tipo=[image]'), texto)
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CADEIA DE CHAMADAS PASSARAM')
process.exit(falhas ? 1 : 0)
