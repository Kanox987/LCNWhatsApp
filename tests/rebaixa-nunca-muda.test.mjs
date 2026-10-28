// /rebaixa nunca fica mudo — a guarda que faltava, escrita depois do defeito.
//
// Em 27/10 o dono mandou `/rebaixa` sozinho num grupo, três vezes, e o bot não
// respondeu NADA. O histórico gravou `matched_live` e ZERO comandos, o que lido
// de fora parece impossível: o fluxo tem `senão` e sempre teria algo a enviar.
//
// A causa foi a trava de dono. Ele respondeu a uma mensagem de um número que
// está marcado como DONO do bot, então `resolverAlvo` devolveu esse número,
// `ehDono` disse sim, e o avaliador fazia `return 'success'` sem enfileirar
// comando nenhum. A trava estava certa; o silêncio não.
//
// Eu já tinha reproduzido quatro variações do comando — admin, não admin, sem
// isAdmin e com menção — e todas as quatro deram exatamente UM comando. Nenhuma
// delas mirava um dono, que era justamente o caso. É por isso que este arquivo
// existe: o caso que a reprodução não cobriu é o que quebrou em produção.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { CHAVE_DONO } from '../src/engine/server/owners.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const GRUPO = '120363000000000077@g.us'
const ADMIN = '5511900000111@s.whatsapp.net'
const DONO = '5511900000222@s.whatsapp.net'
const QUALQUER = '5511900000333@s.whatsapp.net'

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)
const atributo = db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
atributo.run('group', GRUPO, 'grupo_ativo', '"sim"', agora)
atributo.run('contact', DONO, CHAVE_DONO, 'true', agora)

function publicar (id, doc) {
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)').run(id, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)').run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)').run(rev.lastInsertRowid, 'include', 'group', GRUPO)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

// O documento é o que a produção tinha instalado, com o campo novo somado: o
// `quem` é o alvo, a trava de dono está ligada, e agora existe texto para ela.
function doc (id, { ownerText } = {}) {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    name: 'Rebaixar',
    enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: {
      nodes: [
        { id: 'g', type: 'trigger.command', config: { command: '/rebaixa', match: 'exact_or_args', allowFrom: 'any' } },
        { id: 'c', type: 'condition.compare', config: { left: { source: 'event', field: 'sender.isAdmin' }, operator: 'eq', right: { source: 'literal', value: true } } },
        {
          id: 'd',
          type: 'action.group.demote',
          config: {
            who: 'target',
            neverRemoveOwner: true,
            notFoundText: 'Marque quem você quer rebaixar.',
            ...(ownerText ? { ownerText } : {})
          }
        },
        { id: 'r', type: 'action.whatsapp.reply', config: { text: 'Só administrador pode rebaixar.' } }
      ],
      edges: [
        { from: 'g', to: 'c', on: 'matched' },
        { from: 'c', to: 'd', on: 'true' },
        { from: 'c', to: 'r', on: 'false' }
      ]
    }
  }
}

let n = 0
function evento ({ de = ADMIN, isAdmin = true, citadoDe = null, mencionado = null, texto = '/rebaixa' } = {}) {
  n++
  const ev = {
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:${GRUPO}:${de}:r${n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: GRUPO, kind: 'group' },
    sender: { id: de, authoredBySelf: false, authoredByBot: false, name: 'Quem Digitou', isAdmin },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', id: `r${n}`, remoteJid: GRUPO }
  }
  if (citadoDe) ev.message.quotedRef = { provider: 'zapo', id: 'q1', participant: citadoDe }
  if (mencionado) ev.message.mentions = [mencionado]
  return ev
}

function rodar (id, ev) {
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  return (avaliarEvento(db, ev).results || []).find((x) => x.automationId === id)
}

publicar('com-aviso', doc('com-aviso', { ownerText: 'Essa pessoa é dona do bot.' }))
publicar('sem-aviso', doc('sem-aviso'))

// =========================================================================
// 1. O CASO DO DEFEITO: alvo é dono, e o comando tem aviso declarado
// =========================================================================
{
  const r = rodar('com-aviso', evento({ de: ADMIN, citadoDe: DONO }))
  check('a execução casou ao vivo', r?.status === 'matched_live', String(r?.status))
  check('e NÃO ficou sem comando nenhum', (r?.commands || []).length === 1, JSON.stringify(r?.commands))
  check('o que sai é uma resposta, não um rebaixamento',
    r?.commands?.[0]?.commandType === 'whatsapp.reply', String(r?.commands?.[0]?.commandType))
  check('com o texto que o dono escreveu',
    r?.commands?.[0]?.payload?.text === 'Essa pessoa é dona do bot.', r?.commands?.[0]?.payload?.text)
}

// =========================================================================
// 2. A TRAVA CONTINUA VALENDO: o dono não é rebaixado em nenhuma das duas
// =========================================================================
{
  const comAviso = rodar('com-aviso', evento({ de: ADMIN, mencionado: DONO }))
  const semAviso = rodar('sem-aviso', evento({ de: ADMIN, mencionado: DONO }))
  const tentou = (r) => (r?.commands || []).some((c) => c.commandType === 'group.demote')
  check('com aviso, nenhum group.demote contra o dono', !tentou(comAviso), JSON.stringify(comAviso?.commands))
  check('sem aviso, idem — a trava não depende do texto', !tentou(semAviso), JSON.stringify(semAviso?.commands))
  check('sem aviso declarado, o silêncio antigo é preservado de propósito',
    (semAviso?.commands || []).length === 0, JSON.stringify(semAviso?.commands))
}

// =========================================================================
// 3. QUEM NÃO É DONO CONTINUA SENDO REBAIXADO
// =========================================================================
{
  const r = rodar('com-aviso', evento({ de: ADMIN, citadoDe: QUALQUER }))
  check('alvo comum vira group.demote', r?.commands?.[0]?.commandType === 'group.demote', JSON.stringify(r?.commands))
  check('e o participante é quem foi citado', r?.commands?.[0]?.payload?.participantId === QUALQUER, r?.commands?.[0]?.payload?.participantId)
}

// =========================================================================
// 4. AS OUTRAS TRÊS SAÍDAS: nenhuma delas pode ficar muda
// =========================================================================
{
  const semAlvo = rodar('com-aviso', evento({ de: ADMIN }))
  check('sem marcar ninguém, responde o aviso de falta de alvo',
    semAlvo?.commands?.[0]?.payload?.text === 'Marque quem você quer rebaixar.', JSON.stringify(semAlvo?.commands))

  const naoAdmin = rodar('com-aviso', evento({ de: QUALQUER, isAdmin: false, citadoDe: DONO }))
  check('quem não é admin recebe a recusa do senão',
    naoAdmin?.commands?.[0]?.payload?.text === 'Só administrador pode rebaixar.', JSON.stringify(naoAdmin?.commands))

  // Sem `isAdmin` o fluxo segue por UM dos dois ramos — qual não importa aqui,
  // e afirmar o ramo errado seria mentir no nome do teste. O que importa é que
  // ele não cai no vazio, que é o defeito que este arquivo guarda.
  const semCampo = rodar('com-aviso', evento({ de: QUALQUER, isAdmin: undefined, citadoDe: DONO }))
  check('isAdmin ausente ainda produz exatamente uma resposta',
    (semCampo?.commands || []).length === 1 && semCampo.commands[0].commandType === 'whatsapp.reply',
    JSON.stringify(semCampo?.commands))
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE /REBAIXA MUDO PASSARAM')
process.exit(falhas ? 1 : 0)
