// Atendimento humano: a conversa passa para uma pessoa e o bot cala.
//
// A lacuna foi apontada por uma revisão externa como a mais grave do catálogo
// para quem ALUGA o sistema: "imagine um restaurante, oficina ou loja. O
// cliente escreve 'quero falar com uma pessoa'. Sem transferir de verdade, o
// produto parece um bot cheio de comandos, não uma plataforma."
//
// O portão segue o MESMO desenho do `grupo_ativo`, que já existia: um atributo
// da conversa, consultado na admissão, com uma exceção para o comando do dono.
// Estes casos fixam as três coisas que importam — que cala tudo, que o dono
// ainda passa, e que o silêncio é só daquela conversa.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento, CHAVE_ATENDIMENTO, CHAVE_PRAZO_ATENDIMENTO } from '../src/engine/server/evaluator.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const CLIENTE = '5511900000321@s.whatsapp.net'
const OUTRO = '5511900000654@s.whatsapp.net'

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
// O cliente é dono para o caso 3 poder exercitar a exceção sem um segundo
// cadastro: o que o teste prova ali é o requireOwner, não quem é dono.
db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('contact', CLIENTE, '__owner__', 'true', agora)

function publicar (id, trigger, texto, escopo) {
  const doc = {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'contact', id: escopo }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: trigger },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: texto } }
      ],
      edges: [{ from: 'g', to: 'r', on: 'matched' }]
    }
  }
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'contact', escopo)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

let n = 0
const evento = (texto, de) => ({
  provider: 'zapo', accountId: 'conta', eventId: `conta:${de}:${de}:h${++n}`,
  occurredAt: agora, replay: false,
  chat: { id: de, kind: 'contact' },
  sender: { id: de, authoredBySelf: false, authoredByBot: false, name: 'Cliente' },
  message: { kind: 'text', text: texto },
  providerRef: { provider: 'zapo', id: `h${n}`, remoteJid: de }
})

const rodar = (ev) => avaliarEvento(db, ev).results || []
const casou = (rs, id) => rs.find((x) => x.automationId === id)?.status === 'matched_live'

publicar('cardapio', { command: '/cardapio', match: 'exact', allowFrom: 'any' }, 'pizza e esfiha', CLIENTE)
publicar('voltar', { command: '/voltar', match: 'exact', allowFrom: 'any', requireOwner: true }, 'voltei', CLIENTE)
publicar('cardapio-outro', { command: '/cardapio', match: 'exact', allowFrom: 'any' }, 'pizza e esfiha', OUTRO)

const marcar = (chat, valor) => db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('contact', chat, CHAVE_ATENDIMENTO, JSON.stringify(valor), agora)

// =========================================================================
// 1. ANTES: tudo normal
// =========================================================================
check('antes do atendimento, o comando responde', casou(rodar(evento('/cardapio', CLIENTE)), 'cardapio'))

// =========================================================================
// 2. DURANTE: o bot cala — e calar é o ponto, não um efeito colateral
// =========================================================================
marcar(CLIENTE, 'sim')
check('com atendimento em curso, o comando comum não responde', !casou(rodar(evento('/cardapio', CLIENTE)), 'cardapio'))

// =========================================================================
// 3. A EXCEÇÃO: o comando do dono ainda passa
// =========================================================================
// Sem esta exceção a conversa ficaria presa: nada responderia, nem o comando
// que serve para destravar, e a única saída seria o painel.
check('mas o comando "só dono" continua passando', casou(rodar(evento('/voltar', CLIENTE)), 'voltar'))

// =========================================================================
// 4. O SILÊNCIO É DAQUELA CONVERSA, não do bot
// =========================================================================
check('outra conversa segue respondendo normalmente', casou(rodar(evento('/cardapio', OUTRO)), 'cardapio-outro'))

// =========================================================================
// 5. DEPOIS: vazio é o mesmo que não marcado
// =========================================================================
// O template encerra gravando "" porque não existe ação de apagar atributo.
// Se o portão tratasse "" como marcado, o comando de devolver não devolveria
// nada — e isso é exatamente o tipo de falha que não aparece em teste nenhum.
marcar(CLIENTE, '')
check('gravar vazio devolve a conversa ao bot', casou(rodar(evento('/cardapio', CLIENTE)), 'cardapio'))

// =========================================================================
// 6. O ATENDIMENTO EXPIRA SOZINHO — o maior gerador de suporte, consertado
// =========================================================================
// Duas revisões independentes elegeram este par o campeão de chamado, com o
// mesmo caso: o atendente resolve a dúvida, fecha o WhatsApp e ESQUECE de
// devolver. Horas depois o dono acha que o bot caiu e abre chamado urgente —
// com o sistema perfeito, só silenciado de propósito por esquecimento humano.
{
  const horasAtras = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString()

  marcar(CLIENTE, horasAtras(1))
  check('atendimento de uma hora atrás ainda cala o bot', !casou(rodar(evento('/cardapio', CLIENTE)), 'cardapio'))

  marcar(CLIENTE, horasAtras(13))
  check('depois de 12 horas o bot volta sozinho', casou(rodar(evento('/cardapio', CLIENTE)), 'cardapio'))

  // Padrão sensato, teto nenhum: quem quiser outro prazo grava na conversa.
  db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
    .run('contact', CLIENTE, CHAVE_PRAZO_ATENDIMENTO, '48', agora)
  check('com prazo de 48h, treze horas ainda é atendimento', !casou(rodar(evento('/cardapio', CLIENTE)), 'cardapio'))
  db.prepare('DELETE FROM entity_attributes WHERE scope_id = ? AND key = ?').run(CLIENTE, CHAVE_PRAZO_ATENDIMENTO)

  // Marca antiga, escrita antes de o prazo existir, não tem hora nenhuma.
  // Mudar o sentido de dado já gravado devolveria conversas que alguém
  // silenciou de propósito — então "sem hora" continua valendo para sempre.
  marcar(CLIENTE, 'sim')
  check('marca antiga sem hora continua valendo', !casou(rodar(evento('/cardapio', CLIENTE)), 'cardapio'))
  marcar(CLIENTE, '')
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ATENDIMENTO HUMANO PASSARAM')
process.exit(falhas ? 1 : 0)
