// Enquetes e votos guardados no banco do motor.
//
// A primeira versão disto viveu em MEMÓRIA do gateway e recomeçava a cada
// reinício. Uma revisão chamou de defeito de confiabilidade, com razão: uma
// enquete de reunião aberta à noite não pode perder os votos porque o bot
// subiu de novo de manhã.
//
// Havia duas propostas de conserto. A que perdeu dava um SQLite PRÓPRIO ao
// gateway — dois bancos para manter, migrar e sincronizar, com a camada de
// protocolo virando aplicação. A que venceu mantém a fronteira: o gateway
// RELATA pelo socket, o motor GRAVA.
//
// E a terceira revisão pegou o erro que a proposta vencedora trazia: ela dizia
// que o motor "soma" os votos. O WhatsApp manda o ESTADO COMPLETO da escolha a
// cada alteração, não um incremento — somar contaria a mesma pessoa de novo a
// cada troca, e o total passaria do tamanho do grupo. Por isso gravar é apagar
// e regravar, e é o que os casos 2 e 3 fixam.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarServicoDeEnquetes, hashDaOpcao } from '../src/engine/server/enquetesService.js'
import { criarApi } from '../src/engine/server/api.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000066@g.us'
const db = abrirBanco(':memory:')
const s = criarServicoDeEnquetes(db)

// =========================================================================
// 1. CONTAR, E MOSTRAR TAMBÉM O QUE NINGUÉM ESCOLHEU
// =========================================================================
// Uma enquete em que ninguém votou em "Quarta" precisa mostrar Quarta com
// zero: quem lê o resultado tem que saber o que estava em jogo.
s.anotarEnquete({ pollId: 'P1', chatId: GRUPO, opcoes: ['Segunda', 'Terça', 'Quarta'] })
s.anotarVoto({ pollId: 'P1', eleitor: 'a', hashes: [hashDaOpcao('Segunda')] })
s.anotarVoto({ pollId: 'P1', eleitor: 'b', hashes: [hashDaOpcao('Terça')] })
s.anotarVoto({ pollId: 'P1', eleitor: 'c', hashes: [hashDaOpcao('Terça')] })
{
  const r = s.apurar('P1')
  check('conta e ordena do mais votado', r.opcoes[0].opcao === 'Terça' && r.opcoes[0].votos === 2, JSON.stringify(r.opcoes))
  check('opção sem voto nenhum aparece com zero',
    r.opcoes.find((o) => o.opcao === 'Quarta')?.votos === 0, JSON.stringify(r.opcoes))
  check('e conta quantas pessoas votaram', r.votantes === 3, String(r.votantes))
}

// =========================================================================
// 2. TROCAR DE VOTO SUBSTITUI — o erro que a revisão pegou
// =========================================================================
s.anotarVoto({ pollId: 'P1', eleitor: 'a', hashes: [hashDaOpcao('Terça')] })
{
  const r = s.apurar('P1')
  check('quem trocou não conta duas vezes', r.votantes === 3, String(r.votantes))
  check('o voto novo é o que vale', r.opcoes[0].votos === 3, JSON.stringify(r.opcoes))
  check('e o antigo sai da contagem', r.opcoes.find((o) => o.opcao === 'Segunda')?.votos === 0, JSON.stringify(r.opcoes))
}

// =========================================================================
// 3. DESMARCAR É VOTO VÁLIDO
// =========================================================================
s.anotarVoto({ pollId: 'P1', eleitor: 'a', hashes: [] })
{
  const r = s.apurar('P1')
  check('desmarcar baixa a contagem', r.opcoes[0].votos === 2, JSON.stringify(r.opcoes))
  check('e tira a pessoa do total de votantes', r.votantes === 2, String(r.votantes))
}

// =========================================================================
// 4. ENQUETE QUE O MOTOR NÃO VIU NASCER NÃO GUARDA VOTO
// =========================================================================
// Sem o mapa de opções o voto é um hash, e hash não vira resposta para
// ninguém. Guardar assim encheria a tabela de lixo permanente.
check('voto em enquete desconhecida é recusado',
  s.anotarVoto({ pollId: 'NAO-EXISTE', eleitor: 'a', hashes: [hashDaOpcao('x')] }) === false)
check('e ela não apura', s.apurar('NAO-EXISTE') === null)

// =========================================================================
// 5. SOBREVIVE A UM REINÍCIO — que é a razão de tudo isto existir
// =========================================================================
// Mesmo banco, serviço novo: é o que acontece quando o processo cai e sobe.
{
  const depoisDoReinicio = criarServicoDeEnquetes(db)
  const r = depoisDoReinicio.apurar('P1')
  check('a contagem continua lá depois de recriar o serviço', r?.opcoes?.[0]?.votos === 2, JSON.stringify(r?.opcoes))
  check('e a última da conversa continua sendo encontrada', depoisDoReinicio.ultimaDaConversa(GRUPO) === 'P1')
}

// =========================================================================
// 6. O GATEWAY RELATA PELA API, SEM TOCAR NO BANCO
// =========================================================================
{
  const api = criarApi(db)
  const ctx = (body) => ({ body, query: new URLSearchParams() })
  const criada = await api.resolver('POST', '/enquetes', ctx({ pollId: 'P2', chatId: GRUPO, opcoes: ['Sim', 'Não'] }))
  check('relatar enquete nova responde 201', criada?.status === 201, JSON.stringify(criada))
  const votou = await api.resolver('POST', '/enquetes/P2/votos', ctx({ eleitor: 'z', hashes: [hashDaOpcao('Sim')] }))
  check('relatar voto grava', votou?.anotado === true, JSON.stringify(votou))
  const recusado = await api.resolver('POST', '/enquetes/FANTASMA/votos', ctx({ eleitor: 'z', hashes: ['abc'] }))
  // Responder 200 com `anotado: false` diz a verdade sem transformar um voto
  // perdido em falha de entrega — o gateway não teria o que fazer com o erro.
  check('voto órfão responde que não anotou, sem virar erro', recusado?.anotado === false, JSON.stringify(recusado))
  const menos = await api.resolver('POST', '/enquetes', ctx({ pollId: 'P3', opcoes: ['só uma'] }))
    .then(() => 'passou').catch((e) => e.status)
  check('enquete com uma opção só é recusada', menos === 400, String(menos))
}

// =========================================================================
// 7. O COMANDO /resultado LÊ DO BANCO, sem passar pelo gateway
// =========================================================================
{
  db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', new Date().toISOString(), new Date().toISOString())
  db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
    .run('group', GRUPO, 'grupo_ativo', '"sim"', new Date().toISOString())
  const doc = {
    schemaVersion: 1, id: 'res', revision: 1, name: 'res', enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/resultado', match: 'exact', allowFrom: 'any' } },
        { id: 'r', type: 'action.whatsapp.pollResults', config: { headerText: 'TOTAL', lineFormat: '{{opcao}}={{votos}}', emptyText: 'sem contagem' } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  const agora = new Date().toISOString()
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run('res', 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run('res', 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, 'res')

  const evento = {
    provider: 'zapo', accountId: 'conta', eventId: `conta:${GRUPO}:x:res1`,
    occurredAt: agora, replay: false,
    chat: { id: GRUPO, kind: 'group' },
    sender: { id: '5511900000001@s.whatsapp.net', authoredBySelf: false, authoredByBot: false, name: 'Quem' },
    message: { kind: 'text', text: '/resultado' },
    providerRef: { provider: 'zapo', id: 'res1', remoteJid: GRUPO }
  }
  const r = (avaliarEvento(db, evento).results || []).find((x) => x.automationId === 'res')
  const texto = r?.commands?.[0]?.payload?.text || ''
  // Sem id citado, vale a ÚLTIMA da conversa — que agora é a P2.
  check('o comando apura a última enquete da conversa', texto.includes('Sim=1'), texto)
  check('o título vem primeiro', texto.startsWith('TOTAL'), texto)
  check('e o rodapé diz quantas pessoas votaram', texto.includes('1 pessoa votou'), texto)
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ENQUETES PERSISTIDAS PASSARAM')
process.exit(falhas ? 1 : 0)
