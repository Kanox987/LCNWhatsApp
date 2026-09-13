// Bloco A do Módulo 7 da Parte C — condição (`condition.compare`), contador
// (`action.variable.increment`) e os cinco escopos de variável. O caso que
// guia o arquivo inteiro é o que o usuário pediu: "ao detectar algo, avisa; na
// 3a vez, remove" — que só é expressável com ramificação + contador por
// pessoa-dentro-do-grupo. Banco :memory:, nunca o banco real do motor.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { montarIdMembro, resolverEscopo } from '../src/engine/server/attributeScopes.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

const GRUPO_A = '120000000000000001@g.us'
const GRUPO_B = '120000000000000002@g.us'
const PESSOA = '5511900000001@s.whatsapp.net'

function publicar (id, doc, { scopeKind = 'group', scopeId = GRUPO_A, deploymentMode = 'live' } = {}) {
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(id, deploymentMode, agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(id, 'active', JSON.stringify(doc), agora)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', scopeKind, scopeId)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
}

function base (id, nodes, edges) {
  return {
    schemaVersion: 1, id, revision: 1, name: id, enabled: true,
    scope: { include: [{ kind: 'group', id: GRUPO_A }], exclude: [] },
    inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
    responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
    flow: { nodes, edges }
  }
}

let contadorDeEvento = 0
function evento ({ chatId = GRUPO_A, texto = '/aviso', senderId = PESSOA } = {}) {
  contadorDeEvento++
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${chatId}:${senderId}:m${contadorDeEvento}`,
    occurredAt: new Date().toISOString(), replay: false,
    chat: { id: chatId, kind: chatId.endsWith('@g.us') ? 'group' : 'direct' },
    sender: { id: senderId, authoredBySelf: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: `m${contadorDeEvento}` }
  }
}

const respostaDe = (resultado, id) => resultado.results.find((r) => r.automationId === id)?.commands?.[0]?.payload?.text
const statusDe = (resultado, id) => resultado.results.find((r) => r.automationId === id)?.status

// --- o caso completo: 3 avisos e "remove" ---------------------------------
// Enquanto action.group.remove não existe (Bloco D), o terceiro caminho
// responde um texto diferente — o que se prova aqui é a DECISÃO, não o efeito.
publicar('moderacao', base('moderacao', [
  { id: 'gatilho', type: 'trigger.command', config: { command: '/aviso', match: 'exact', allowFrom: 'external' } },
  { id: 'soma', type: 'action.variable.increment', config: { scope: 'group_member', key: 'avisos', by: 1 } },
  { id: 'checa', type: 'condition.compare', config: { left: { source: 'variable', scope: 'group_member', key: 'avisos' }, operator: 'gte', right: { source: 'literal', value: 3 } } },
  { id: 'expulsa', type: 'action.whatsapp.reply', config: { text: 'Limite atingido ({{var.member.avisos}}) — seria removido.' } },
  { id: 'avisa', type: 'action.whatsapp.reply', config: { text: 'Aviso {{var.member.avisos}} de 3.' } }
], [
  { from: 'gatilho', to: 'soma', on: 'matched' },
  { from: 'soma', to: 'checa', on: 'success' },
  { from: 'checa', to: 'expulsa', on: 'true' },
  { from: 'checa', to: 'avisa', on: 'false' }
]))

const r1 = avaliarEvento(db, evento())
check('1a infração: segue o caminho "false" e avisa', respostaDe(r1, 'moderacao') === 'Aviso 1 de 3.', respostaDe(r1, 'moderacao'))
const r2 = avaliarEvento(db, evento())
check('2a infração: contador acumula entre eventos', respostaDe(r2, 'moderacao') === 'Aviso 2 de 3.', respostaDe(r2, 'moderacao'))
const r3 = avaliarEvento(db, evento())
check('3a infração: a condição vira "true" e segue o outro caminho', respostaDe(r3, 'moderacao') === 'Limite atingido (3) — seria removido.', respostaDe(r3, 'moderacao'))
check('só UMA resposta por execução (os dois ramos nunca rodam juntos)', r3.results.find((r) => r.automationId === 'moderacao').commands.length === 1)

// --- escopo group_member é por grupo, não global da pessoa ----------------
const rOutroGrupo = avaliarEvento(db, evento({ chatId: GRUPO_B }))
check('a MESMA pessoa em outro grupo não herda as infrações (fora de escopo aqui)', statusDe(rOutroGrupo, 'moderacao') === undefined || statusDe(rOutroGrupo, 'moderacao') === 'no_match')
const linhaA = db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind='group_member' AND scope_id=? AND key='avisos'").get(montarIdMembro(GRUPO_A, PESSOA))
const linhaB = db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind='group_member' AND scope_id=? AND key='avisos'").get(montarIdMembro(GRUPO_B, PESSOA))
check('o contador do grupo A tem 3', JSON.parse(linhaA.value_json) === 3)
check('o contador do grupo B nem existe — nada vazou entre grupos', linhaB === undefined)

// --- comparação é numérica, não lexicográfica -----------------------------
publicar('ordem', base('ordem', [
  { id: 'g', type: 'trigger.command', config: { command: '/ordem', match: 'exact', allowFrom: 'external' } },
  { id: 'c', type: 'condition.compare', config: { left: { source: 'literal', value: '10' }, operator: 'gt', right: { source: 'literal', value: '3' } } },
  { id: 'sim', type: 'action.whatsapp.reply', config: { text: 'dez é maior' } },
  { id: 'nao', type: 'action.whatsapp.reply', config: { text: 'comparou como texto' } }
], [
  { from: 'g', to: 'c', on: 'matched' },
  { from: 'c', to: 'sim', on: 'true' },
  { from: 'c', to: 'nao', on: 'false' }
]))
const rOrdem = avaliarEvento(db, evento({ texto: '/ordem' }))
check('"10" > "3" compara como número, nunca como texto', respostaDe(rOrdem, 'ordem') === 'dez é maior', respostaDe(rOrdem, 'ordem'))

// --- contador inexistente NÃO é zero em comparação de ordem ---------------
publicar('inexistente', base('inexistente', [
  { id: 'g', type: 'trigger.command', config: { command: '/nunca', match: 'exact', allowFrom: 'external' } },
  { id: 'c', type: 'condition.compare', config: { left: { source: 'variable', scope: 'group_member', key: 'jamais_gravada' }, operator: 'gte', right: { source: 'literal', value: 0 } } },
  { id: 'sim', type: 'action.whatsapp.reply', config: { text: 'tratou ausente como zero' } },
  { id: 'nao', type: 'action.whatsapp.reply', config: { text: 'ausente não é zero' } }
], [
  { from: 'g', to: 'c', on: 'matched' },
  { from: 'c', to: 'sim', on: 'true' },
  { from: 'c', to: 'nao', on: 'false' }
]))
const rAusente = avaliarEvento(db, evento({ texto: '/nunca' }))
check('variável que nunca existiu não vira zero (senão ">= 0" puniria inocente)', respostaDe(rAusente, 'inexistente') === 'ausente não é zero', respostaDe(rAusente, 'inexistente'))

// --- escopo global e categoria --------------------------------------------
publicar('globais', base('globais', [
  { id: 'g', type: 'trigger.command', config: { command: '/global', match: 'exact', allowFrom: 'external' } },
  { id: 'inc', type: 'action.variable.increment', config: { scope: 'global', key: 'total', by: 2 } },
  { id: 'incCat', type: 'action.variable.increment', config: { scope: 'category', categoryKey: 'vip', key: 'usos', by: 5 } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'total={{var.global.total}} vip={{var.category.vip.usos}}' } }
], [
  { from: 'g', to: 'inc', on: 'matched' },
  { from: 'inc', to: 'incCat', on: 'success' },
  { from: 'incCat', to: 'r', on: 'success' }
]))
const rGlobal = avaliarEvento(db, evento({ texto: '/global' }))
check('escopo global acumula e é legível por {{var.global.X}}', respostaDe(rGlobal, 'globais') === 'total=2 vip=5', respostaDe(rGlobal, 'globais'))
const rGlobal2 = avaliarEvento(db, evento({ texto: '/global' }))
check('escopo global e categoria acumulam entre eventos', respostaDe(rGlobal2, 'globais') === 'total=4 vip=10', respostaDe(rGlobal2, 'globais'))

// --- {{custom.X}} continua funcionando (retrocompatibilidade) -------------
publicar('legado', base('legado', [
  { id: 'g', type: 'trigger.command', config: { command: '/legado', match: 'exact', allowFrom: 'external' } },
  { id: 's', type: 'action.variable.set', config: { scope: 'chat', key: 'apelido', value: 'turma' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'oi {{custom.apelido}} / {{var.chat.apelido}}' } }
], [
  { from: 'g', to: 's', on: 'matched' },
  { from: 's', to: 'r', on: 'success' }
]))
const rLegado = avaliarEvento(db, evento({ texto: '/legado' }))
check('{{custom.X}} antigo e {{var.chat.X}} novo apontam para a mesma variável', respostaDe(rLegado, 'legado') === 'oi turma / turma', respostaDe(rLegado, 'legado'))

// --- sombra nunca persiste contador ---------------------------------------
publicar('sombra', base('sombra', [
  { id: 'g', type: 'trigger.command', config: { command: '/sombra', match: 'exact', allowFrom: 'external' } },
  { id: 'inc', type: 'action.variable.increment', config: { scope: 'global', key: 'contador_sombra', by: 1 } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'ok' } }
], [
  { from: 'g', to: 'inc', on: 'matched' },
  { from: 'inc', to: 'r', on: 'success' }
]), { deploymentMode: 'shadow' })
const rSombra = avaliarEvento(db, evento({ texto: '/sombra' }))
check('sombra reconhece o comando', statusDe(rSombra, 'sombra') === 'matched_shadow')
const nadaGravado = db.prepare("SELECT 1 FROM entity_attributes WHERE key='contador_sombra'").get()
check('sombra NUNCA persiste o incremento', nadaGravado === undefined)

// --- fluxo quebrado vira error, e o contador não fica adiantado -----------
publicar('quebrado', base('quebrado', [
  { id: 'g', type: 'trigger.command', config: { command: '/quebrado', match: 'exact', allowFrom: 'external' } },
  { id: 'inc', type: 'action.variable.increment', config: { scope: 'global', key: 'contador_quebrado', by: 1 } },
  { id: 'fantasma', type: 'action.whatsapp.reply', config: { text: 'nunca chega' } }
], [
  { from: 'g', to: 'inc', on: 'matched' },
  // aponta para um nó que não existe: só alcançável por documento gravado
  // direto no banco, que é exatamente o caso que o limite de passos cobre.
  { from: 'inc', to: 'nao-existe', on: 'success' }
]))
const rQuebrado = avaliarEvento(db, evento({ texto: '/quebrado' }))
check('aresta apontando para nó inexistente vira status error, não silêncio', statusDe(rQuebrado, 'quebrado') === 'error', statusDe(rQuebrado, 'quebrado'))
const contadorRevertido = db.prepare("SELECT 1 FROM entity_attributes WHERE key='contador_quebrado'").get()
check('o savepoint reverteu o incremento do fluxo que falhou', contadorRevertido === undefined)
check('a automação que falhou não impede as outras do mesmo evento', rQuebrado.results.length > 1)

// --- resolverEscopo: group_member não existe em conversa direta -----------
const eventoDireto = evento({ chatId: PESSOA })
check('group_member em conversa direta resolve para nada (não inventa membro)', resolverEscopo('group_member', eventoDireto) === null)
check('chat em conversa direta resolve para o contato', resolverEscopo('chat', eventoDireto).scopeKind === 'contact')
check('global resolve sempre, sem depender do evento', resolverEscopo('global', eventoDireto).scopeId === '__global__')
check('category sem categoryKey resolve para nada', resolverEscopo('category', eventoDireto) === null)

// --- validação de documento ------------------------------------------------
const semLadoFalso = base('x', [
  { id: 'g', type: 'trigger.command', config: { command: '/x', match: 'exact', allowFrom: 'external' } },
  { id: 'c', type: 'condition.compare', config: { left: { source: 'literal', value: 1 }, operator: 'eq', right: { source: 'literal', value: 1 } } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'oi' } }
], [
  { from: 'g', to: 'c', on: 'matched' },
  { from: 'c', to: 'r', on: 'true' }
])
check('condição sem a saída "false" é rejeitada', validarAutomacao(db, semLadoFalso).some((e) => e.message.includes("saída 'false'")))

const doisGatilhos = base('y', [
  { id: 'g1', type: 'trigger.command', config: { command: '/a', match: 'exact', allowFrom: 'external' } },
  { id: 'g2', type: 'trigger.command', config: { command: '/b', match: 'exact', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'oi' } }
], [{ from: 'g1', to: 'r', on: 'matched' }])
check('dois gatilhos são rejeitados (maxTriggers:1 agora é imposto, não só anunciado)', validarAutomacao(db, doisGatilhos).some((e) => e.message.includes('só aceita um gatilho')))

const arestaErrada = base('z', [
  { id: 'g', type: 'trigger.command', config: { command: '/z', match: 'exact', allowFrom: 'external' } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: 'oi' } },
  { id: 'r2', type: 'action.whatsapp.reply', config: { text: 'tchau' } }
], [
  { from: 'g', to: 'r', on: 'matched' },
  { from: 'r', to: 'r2', on: 'true' }
])
check('ação ligada por "true" é rejeitada (ação só produz "success")', validarAutomacao(db, arestaErrada).some((e) => e.message.includes("não produz a saída 'true'")))

// --- alvo: "/adv @fulano" pune o fulano, não quem digitou -----------------
// É a família de comando mais comum dos bots de referência (adv, ban,
// promover, transferir saldo) e era impossível antes: o evento canônico nem
// carregava menção.
const OUTRO = '5511900000009@s.whatsapp.net'
publicar('punir', base('punir', [
  { id: 'g', type: 'trigger.command', config: { command: '/adv', match: 'exact_or_args', allowFrom: 'external' } },
  { id: 'inc', type: 'action.variable.increment', config: { scope: 'target_group_member', key: 'punicoes', by: 1 } },
  { id: 'r', type: 'action.whatsapp.reply', config: { text: '{{target.id}} agora tem {{var.targetMember.punicoes}} punição(ões).' } }
], [
  { from: 'g', to: 'inc', on: 'matched' },
  { from: 'inc', to: 'r', on: 'success' }
]))

function eventoComMencao (mencionado) {
  const e = evento({ texto: '/adv @fulano' })
  e.message.mentions = [mencionado]
  return e
}
const rPunir = avaliarEvento(db, eventoComMencao(OUTRO))
check('o contador vai para o MENCIONADO, não para quem digitou', respostaDe(rPunir, 'punir') === `${OUTRO} agora tem 1 punição(ões).`, respostaDe(rPunir, 'punir'))
const punicaoDoAlvo = db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind='group_member' AND scope_id=? AND key='punicoes'").get(montarIdMembro(GRUPO_A, OUTRO))
const punicaoDeQuemDigitou = db.prepare("SELECT 1 FROM entity_attributes WHERE scope_kind='group_member' AND scope_id=? AND key='punicoes'").get(montarIdMembro(GRUPO_A, PESSOA))
check('o alvo mencionado tem a punição gravada', JSON.parse(punicaoDoAlvo.value_json) === 1)
check('quem digitou o comando NÃO foi punido', punicaoDeQuemDigitou === undefined)

// Sem menção, o alvo pode vir da mensagem citada — o outro caminho que os
// bots de referência aceitam ("responder a mensagem + /adv").
const eventoCitando = evento({ texto: '/adv' })
eventoCitando.message.quotedRef = { provider: 'zapo', id: 'x', participant: OUTRO }
const rCitando = avaliarEvento(db, eventoCitando)
check('sem menção, o alvo vem do autor da mensagem citada', respostaDe(rCitando, 'punir') === `${OUTRO} agora tem 2 punição(ões).`, respostaDe(rCitando, 'punir'))

// Sem menção NEM citação não há alvo: a ação é ignorada e o placeholder fica
// literal, em vez de punir a pessoa errada em silêncio.
const rSemAlvo = avaliarEvento(db, evento({ texto: '/adv' }))
check('sem alvo nenhum, nada é gravado e o placeholder fica visível', respostaDe(rSemAlvo, 'punir') === '{{target.id}} agora tem {{var.targetMember.punicoes}} punição(ões).', respostaDe(rSemAlvo, 'punir'))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CONDIÇÃO E CONTADOR PASSARAM')
process.exit(falhas ? 1 : 0)
