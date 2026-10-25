// BLOCO 2: O PORTEIRO — eventos de entrada, saída, promoção, rebaixamento e alteração de grupo.
//
// O bot agora observa a porta do grupo: quem entra, quem sai, quem é promovido ou rebaixado.
// A biblioteca já entregava o evento em `client.on('group')` mas descartava após invalidar o cache.
// Aqui cobrimos o evento canônico, a resolução da armadilha de LID vs Telefone (lidMap),
// o vocabulário e compilador da classe `porteiro`, as recusas sintáticas estritas,
// a ida e volta, a validação no schema, o avaliador de execuções com a trava de `grupo_ativo`,
// e o template no catálogo.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { obterCapacidadesRuntime } from '../src/engine/server/runtimeCapabilities.js'
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { ACOES_DE_GRUPO, CLASSES } from '../src/lcn/vocabulario.js'
import { construirEventoDeGrupo } from '../src/engine/zapoAdapter.js'
import { validarFormaCanonica, calcularEventIdDeGrupo } from '../src/engine/canonicalEvent.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'
import * as lidMap from '../src/lidMap.js'
const { registrarPar, paraTelefone, _reiniciarParaTeste } = lidMap
import { definirDono } from '../src/engine/server/owners.js'

// Inicializa o lidMap em pasta temporária isolada para nunca poluir o data/ real
const pastaTesteLid = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-porteiro-lid-'))
const arquivoTesteLid = path.join(pastaTesteLid, 'lid-map.json')
_reiniciarParaTeste(arquivoTesteLid)

let falhas = 0
const check = (nome, ok, extra) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`)
}

const recusa = (texto) => {
  try { compilar(texto); return null } catch (e) { return e }
}

const canon = (v) => Array.isArray(v)
  ? v.map(canon)
  : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v
const mesmo = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

// --- 1. O evento canônico e deduplicação determinística -------------------
const rawEntrada = {
  id: '12036304@g.us',
  groupJid: '12036304@g.us',
  action: 'add',
  author: '5511999990000@s.whatsapp.net',
  authorJid: '5511999990000@s.whatsapp.net',
  participants: ['5511988887777@s.whatsapp.net'],
  timestamp: 1729780000,
  timestampSeconds: 1729780000
}

const evtCan = construirEventoDeGrupo(rawEntrada, {
  accountId: 'acc-1',
  recebidoEmMs: 1729780000000,
  botId: '5511999990001@s.whatsapp.net'
})

check('evento canônico de grupo tem chat com kind group', evtCan.chat.id === '12036304@g.us' && evtCan.chat.kind === 'group')
check('evento canônico de grupo tem action mapeada', evtCan.group.action === 'add')
check('evento canônico de grupo tem sender resolvido do author', evtCan.sender.id === '5511999990000@s.whatsapp.net')
check('evento canônico passa na validação canônica', Boolean(validarFormaCanonica(evtCan)))

const id1 = calcularEventIdDeGrupo({
  accountId: 'acc-1',
  groupJid: '12036304@g.us',
  action: 'add',
  participants: ['5511988887777@s.whatsapp.net'],
  timestampSeconds: 1729780000
})
const id2 = calcularEventIdDeGrupo({
  accountId: 'acc-1',
  groupJid: '12036304@g.us',
  action: 'add',
  participants: ['5511988887777@s.whatsapp.net'],
  timestampSeconds: 1729780000
})
check('eventId de grupo é determinístico para mesmos dados', id1 === id2 && id1 === evtCan.eventId)

const idOutroTempo = calcularEventIdDeGrupo({
  accountId: 'acc-1',
  groupJid: '12036304@g.us',
  action: 'add',
  participants: ['5511988887777@s.whatsapp.net'],
  timestampSeconds: 1729780005
})
check('eventId varia com timestamp diferente', id1 !== idOutroTempo)

// --- 2. A armadilha: LID vs PN e resolução no lidMap ---------------------
// Um participante chega identificado por LID pelo WhatsApp.
const telefoneIntruso = '5511977776666@s.whatsapp.net'
const lidIntruso = '198765432101234@lid'

// Registramos o mapeamento previamente no lidMap
registrarPar(lidIntruso, telefoneIntruso)

// Forma 1 do participante: chega como LID (endereçamento interno do WhatsApp)
const rawComLid = {
  id: '12036304@g.us',
  groupJid: '12036304@g.us',
  action: 'add',
  author: '5511999990000@s.whatsapp.net',
  authorJid: '5511999990000@s.whatsapp.net',
  participants: [lidIntruso],
  timestamp: 1729780010,
  timestampSeconds: 1729780010
}

const evtComLid = construirEventoDeGrupo(rawComLid, {
  accountId: 'acc-1',
  recebidoEmMs: 1729780010000,
  botId: '5511999990001@s.whatsapp.net'
})

check('participante que chega como LID é normalizado para telefone', evtComLid.group.participants[0].id === telefoneIntruso)
check('participante preserva lidJid original', evtComLid.group.participants[0].lidJid === lidIntruso)
check('participante preserva phoneJid normalizado', evtComLid.group.participants[0].phoneJid === telefoneIntruso)

// Forma 2 do mesmo participante: chega como Telefone direto (PN)
const rawComTelefone = {
  id: '12036304@g.us',
  groupJid: '12036304@g.us',
  action: 'add',
  author: '5511999990000@s.whatsapp.net',
  authorJid: '5511999990000@s.whatsapp.net',
  participants: [telefoneIntruso],
  timestamp: 1729780011,
  timestampSeconds: 1729780011
}

const evtComTelefone = construirEventoDeGrupo(rawComTelefone, {
  accountId: 'acc-1',
  recebidoEmMs: 1729780011000,
  botId: '5511999990001@s.whatsapp.net'
})

check('participante que chega como telefone mantém id de telefone', evtComTelefone.group.participants[0].id === telefoneIntruso)
check('participante preserva phoneJid', evtComTelefone.group.participants[0].phoneJid === telefoneIntruso)
check('as duas formas do mesmo participante resolvem para o mesmo id canônico', evtComLid.group.participants[0].id === evtComTelefone.group.participants[0].id)

// E quando o rawEvent entrega explicitamente o par lidJid e phoneJid (WaGroupEventParticipant)
const rawComPar = {
  id: '12036304@g.us',
  groupJid: '12036304@g.us',
  action: 'add',
  author: '5511999990000@s.whatsapp.net',
  authorJid: '5511999990000@s.whatsapp.net',
  participants: [{ lid: '8888888888@lid', lidJid: '8888888888@lid', jid: '5511944443333@s.whatsapp.net', phoneJid: '5511944443333@s.whatsapp.net' }],
  timestamp: 1729780020,
  timestampSeconds: 1729780020
}
const evtComPar = construirEventoDeGrupo(rawComPar, {
  accountId: 'acc-1',
  recebidoEmMs: 1729780020000,
  botId: '5511999990001@s.whatsapp.net'
})
check('par explícito é aprendido e normalizado', evtComPar.group.participants[0].phoneJid === '5511944443333@s.whatsapp.net')
check('e o lidMap aprendeu o par', paraTelefone('8888888888@lid') === '5511944443333@s.whatsapp.net')

// --- 3. Capacidades e Vocabulário -----------------------------------------
const cap = obterCapacidadesRuntime()
check('runtimeCapabilities anuncia trigger.group', cap.triggers.includes('trigger.group'))
check('vocabulario mapeia trigger.group para classe porteiro', CLASSES['trigger.group'] === 'porteiro')
check('vocabulario expõe as 5 ações de grupo', Object.keys(ACOES_DE_GRUPO).length === 5)
check('ações de grupo contêm entrou, saiu, promoveu, rebaixou, mudou o nome',
  ACOES_DE_GRUPO.add === 'entrou' &&
  ACOES_DE_GRUPO.remove === 'saiu' &&
  ACOES_DE_GRUPO.promote === 'promoveu' &&
  ACOES_DE_GRUPO.demote === 'rebaixou' &&
  ACOES_DE_GRUPO.subject === 'mudou o nome'
)

// Prepara banco em memória para testes de schema e de execução
const db = abrirBanco(':memory:')
const dataIso = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('pool-padrao', 'Pool padrão', dataIso, dataIso)
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('pool-geral', 'Pool geral', dataIso, dataIso)

// --- 4. Compilação e Schema de Automação de Porteiro ----------------------
const lcnPorteiroValido = `automação port1
  revisão: 1
  nome: Anti-intruso
  tipo: porteiro
  quando for: entrou
  pool: pool-padrao

  se var target_group_member autorizado != "sim"
    remove do grupo
      quem: quem foi marcado
      nunca o dono: true
`

const docCompilado = compilar(lcnPorteiroValido)
check('compilação gera nó trigger.group', docCompilado.flow.nodes[0].type === 'trigger.group')
check('gatilho tem actions = ["add"]', JSON.stringify(docCompilado.flow.nodes[0].config.actions) === '["add"]')
check('porteiro define acceptedMessageKinds = ["group"]', JSON.stringify(docCompilado.inputPolicy.acceptedMessageKinds) === '["group"]')

const errosSchema = validarAutomacao(db, docCompilado)
check('automação compilada passa no schema sem erros', errosSchema.length === 0, JSON.stringify(errosSchema))

// --- 5. Recusas estritas de sintaxe em porteiro ---------------------------
// Um porteiro não tem mensagem, então campos exclusivos de mensagem devem ser recusados com ErroDeSintaxe apontando a linha.
const errosTestados = [
  ['dispara com', 'automação err1\n  tipo: porteiro\n  dispara com: /ban\n  quando for: entrou\n  pool: p1\n', /não usa "dispara com"/],
  ['acessa', 'automação err2\n  tipo: porteiro\n  acessa: texto\n  quando for: entrou\n  pool: p1\n', /"acessa" não se aplica a porteiro/],
  ['argumentos', 'automação err3\n  tipo: porteiro\n  argumentos: x / y\n  quando for: entrou\n  pool: p1\n', /"argumentos" não se aplica a porteiro/],
  ['precisa de um link', 'automação err4\n  tipo: porteiro\n  precisa de um link: na mensagem\n  quando for: entrou\n  pool: p1\n', /não se aplica a porteiro/],
  ['precisa de uma mídia', 'automação err5\n  tipo: porteiro\n  precisa de uma mídia: na mensagem\n  quando for: entrou\n  pool: p1\n', /não se aplica a porteiro/],
  ['sem ele', 'automação err6\n  tipo: porteiro\n  sem ele: "falta"\n  quando for: entrou\n  pool: p1\n', /não se aplica a porteiro/],
  ['com link', 'automação err7\n  tipo: porteiro\n  com link\n  quando for: entrou\n  pool: p1\n', /"com link" não se aplica a porteiro/],
  ['só link de mídia', 'automação err8\n  tipo: porteiro\n  só link de mídia\n  quando for: entrou\n  pool: p1\n', /"só link de mídia" não se aplica a porteiro/],
  ['também em comandos', 'automação err9\n  tipo: porteiro\n  também em comandos\n  quando for: entrou\n  pool: p1\n', /"também em comandos" não se aplica a porteiro/],
  ['casa', 'automação err10\n  tipo: porteiro\n  casa: exato\n  quando for: entrou\n  pool: p1\n', /"casa" não se aplica a porteiro/],
  ['palavras', 'automação err11\n  tipo: porteiro\n  palavras: "teste"\n  quando for: entrou\n  pool: p1\n', /"palavras" não se aplica a porteiro/],
  ['menu', 'automação err12\n  tipo: porteiro\n  menu: Entrou — aviso\n  quando for: entrou\n  pool: p1\n', /"menu" não se aplica a porteiro/],
  ['histórico', 'automação err13\n  tipo: porteiro\n  histórico: all\n  quando for: entrou\n  pool: p1\n', /"histórico" não se aplica a porteiro/],
  ['falta quando for', 'automação err14\n  tipo: porteiro\n  pool: p1\n\n  remove do grupo\n', /falta "quando for:"/],
  ['ação desconhecida', 'automação err15\n  tipo: porteiro\n  quando for: explodiu\n  pool: p1\n', /ação de grupo desconhecida/],
  ['mais de 5 ações', 'automação err16\n  tipo: porteiro\n  quando for: entrou, saiu, promoveu, rebaixou, mudou o nome, inventou\n  pool: p1\n', /ação de grupo desconhecida/]
]

for (const [nome, texto, regex] of errosTestados) {
  const err = recusa(texto)
  check(`recusa ${nome} com ErroDeSintaxe explicativo`, err instanceof ErroDeSintaxe && regex.test(err.message), err?.message)
}

// 5b. Recusa estrita independente da ordem (campos incompatíveis ANTES de tipo: porteiro)
// A validação de incompatibilidade não pode depender de `tipo:` vir na primeira linha.
const errosOrdemInvertida = [
  ['precisa de um link antes do tipo', 'automação inv1\n  precisa de um link: na mensagem\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /não se aplica a porteiro/, 2],
  ['acessa antes do tipo', 'automação inv2\n  acessa: texto\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"acessa" não se aplica a porteiro/, 2],
  ['argumentos antes do tipo', 'automação inv3\n  argumentos: x / y\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"argumentos" não se aplica a porteiro/, 2],
  ['precisa de uma mídia antes do tipo', 'automação inv4\n  precisa de uma mídia: na mensagem\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /não se aplica a porteiro/, 2],
  ['sem ele antes do tipo', 'automação inv5\n  sem ele: "falta"\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /não se aplica a porteiro/, 2],
  ['sem ela antes do tipo', 'automação inv6\n  sem ela: "falta"\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /não se aplica a porteiro/, 2],
  ['dispara com antes do tipo', 'automação inv7\n  dispara com: /ban\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /não usa "dispara com"/, 2],
  ['com link antes do tipo', 'automação inv8\n  com link\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"com link" não se aplica a porteiro/, 2],
  ['só link de mídia antes do tipo', 'automação inv9\n  só link de mídia\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"só link de mídia" não se aplica a porteiro/, 2],
  ['também em comandos antes do tipo', 'automação inv10\n  também em comandos\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"também em comandos" não se aplica a porteiro/, 2],
  ['casa antes do tipo', 'automação inv11\n  casa: exato\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"casa" não se aplica a porteiro/, 2],
  ['palavras antes do tipo', 'automação inv12\n  palavras: "teste"\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"palavras" não se aplica a porteiro/, 2],
  ['menu antes do tipo', 'automação inv13\n  menu: Entrou — aviso\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"menu" não se aplica a porteiro/, 2],
  ['histórico antes do tipo', 'automação inv14\n  histórico: all\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"histórico" não se aplica a porteiro/, 2],
  ['quem antes do tipo', 'automação inv15\n  quem: qualquer um\n  tipo: porteiro\n  quando for: entrou\n  pool: p1\n', /"quem" não se aplica a porteiro/, 2]
]

for (const [nome, texto, regex, linhaEsperada] of errosOrdemInvertida) {
  const err = recusa(texto)
  check(`ordem invertida: recusa ${nome} apontando a linha do campo`,
    err instanceof ErroDeSintaxe && regex.test(err.message) && err.linha === linhaEsperada,
    `linha: ${err?.linha}, msg: ${err?.message}`
  )
}

// Ordem invertida em declaração válida: "quando for" antes de "tipo" compila sem erro
const lcnPorteiroOrdemValida = `automação port_ordem
  quando for: entrou
  tipo: porteiro
  pool: pool-padrao

  se var target_group_member autorizado != "sim"
    remove do grupo
      quem: quem foi marcado
`
const docOrdemValida = compilar(lcnPorteiroOrdemValida)
check('ordem invertida válida: "quando for" antes de "tipo" compila trigger.group',
  docOrdemValida.flow.nodes[0].type === 'trigger.group' &&
  JSON.stringify(docOrdemValida.flow.nodes[0].config.actions) === '["add"]'
)

// 5c. A mesma conferência, para o VIGIA — e ela existe porque quase se perdeu.
// Ao mover a validação de "dispara com" para depois do cabeçalho, o ramo do
// vigia foi escrito com uma classe que não existe ("trigger.watcher"), virando
// código morto: um vigia com "dispara com: /qualquer-coisa" passou a compilar
// calado. Nenhum teste da bateria pegou. Estas três checagens pegam.
const vigiaOrdens = [
  ['dispara com inválido, ordem normal', 'automação vig1\n  tipo: vigia\n  dispara com: /lixo\n  pool: p1\n'],
  ['dispara com inválido, ordem invertida', 'automação vig2\n  dispara com: /lixo\n  tipo: vigia\n  pool: p1\n']
]
for (const [nome, texto] of vigiaOrdens) {
  const err = recusa(texto)
  check(`vigia: recusa ${nome}`, err instanceof ErroDeSintaxe && /um vigia dispara com "qualquer mensagem"/.test(err.message), err?.message)
}
const vigiaAntes = compilar('automação vig3\n  dispara com: qualquer mensagem\n  tipo: vigia\n  pool: p1\n\n  responde "oi"\n')
const vigiaDepois = compilar('automação vig3\n  tipo: vigia\n  dispara com: qualquer mensagem\n  pool: p1\n\n  responde "oi"\n')
check('vigia: as duas ordens produzem o MESMO documento', JSON.stringify(vigiaAntes) === JSON.stringify(vigiaDepois))

// --- 6. Ida e Volta (Descompilação -> Compilação) -------------------------
const lcnMultiacao = `automação port2
  nome: Monitor Geral
  tipo: porteiro
  quando for: entrou, saiu, promoveu, rebaixou, mudou o nome
  pool: pool-geral

  se var target_group_member autorizado != "sim"
    remove do grupo
      quem: quem foi marcado
      nunca o dono: true
`
const docMulti = compilar(lcnMultiacao)
const lcnGerado = descompilar(docMulti)
const docVolta = compilar(lcnGerado)
check('ida e volta não perde ações nem campos do porteiro', mesmo(docMulti, docVolta))
check('texto descompilado não contém dispara com nem acessa', !lcnGerado.includes('dispara com:') && !lcnGerado.includes('acessa:'))

// --- 7. Avaliador (evaluator): grupo_ativo, casamento e execução ----------
function publicarNoBanco (doc) {
  db.prepare('INSERT OR REPLACE INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?)')
    .run(doc.id, 'live', dataIso, dataIso)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(doc.id, 'active', JSON.stringify(doc), dataIso)
  db.prepare('INSERT INTO automation_scopes (automation_revision_id, direction, kind, ref_id) VALUES (?, ?, ?, ?)')
    .run(rev.lastInsertRowid, 'include', 'all_groups', '')
  db.prepare('UPDATE automations SET active_revision_id = ?, enabled = 1 WHERE id = ?').run(rev.lastInsertRowid, doc.id)
  return rev.lastInsertRowid
}

publicarNoBanco(docCompilado)
const rPorteiro = (res) => res.results.find((r) => r.automationId === 'port1')

const grupoAlvo = '12036304@g.us'
const autorAdmin = '5511999990000@s.whatsapp.net'
const intrusoNaoAutorizado = '5511911112222@s.whatsapp.net'

// 7.1 Trava de grupo_ativo: o grupo AINDA NÃO foi ativado pelo dono
const evtGrupoInativo = construirEventoDeGrupo({
  id: grupoAlvo,
  groupJid: grupoAlvo,
  action: 'add',
  author: autorAdmin,
  authorJid: autorAdmin,
  participants: [intrusoNaoAutorizado],
  timestamp: 1729780100,
  timestampSeconds: 1729780100
}, { accountId: 'acc-1', recebidoEmMs: 1729780100000, botId: '5511999990001@s.whatsapp.net' })

const resInativo = avaliarEvento(db, evtGrupoInativo)
check('porteiro fica inativo em grupo não ativado (grupo_ativo)', resInativo.results.length === 0)

// 7.2 Ativando o grupo: grupo_ativo = 'sim'
// A autorização do grupo (grupo_ativo = 'sim') é pré-requisito mandatório na vida real:
// o portão grupoBloqueado() corre antes de qualquer casamento para garantir que o bot
// não aja como agente ativo/punitivo em grupos onde não tem permissão explícita do proprietário.
db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
  .run('group', grupoAlvo, 'grupo_ativo', JSON.stringify('sim'), dataIso)

// 7.3 Disparo do porteiro: intruso NÃO está na lista de autorizados
const evtIntrusoEntrou = construirEventoDeGrupo({
  id: grupoAlvo,
  groupJid: grupoAlvo,
  action: 'add',
  author: autorAdmin,
  authorJid: autorAdmin,
  participants: [intrusoNaoAutorizado],
  timestamp: 1729780200,
  timestampSeconds: 1729780200
}, { accountId: 'acc-1', recebidoEmMs: 1729780200000, botId: '5511999990001@s.whatsapp.net' })

const resIntruso = avaliarEvento(db, evtIntrusoEntrou)
const rIntruso = rPorteiro(resIntruso)
check('porteiro casou ao vivo com intruso', rIntruso?.status === 'matched_live')
check('porteiro gerou comando group.remove', rIntruso?.commands[0]?.commandType === 'group.remove')
check('group.remove aponta para o intruso correto', rIntruso?.commands[0]?.payload?.participantId === intrusoNaoAutorizado)

// 7.4 Deduplicação at-most-once: reenviar o mesmo evento não reexecuta
const resDedup = avaliarEvento(db, evtIntrusoEntrou)
const rDedup = rPorteiro(resDedup)
check('reenvio de mesmo evento é idempotente (at-most-once)', rDedup?.commands.length === 1)

// 7.5 Usuário AUTORIZADO entra: gravamos `autorizado = "sim"` no membro
const membroAutorizado = '5511933334444@s.whatsapp.net'
const idMembro = `${grupoAlvo}|${membroAutorizado}`
db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
  .run('group_member', idMembro, 'autorizado', JSON.stringify('sim'), dataIso)

// 7.5a Forma 1: membro autorizado entra identificado por Telefone direto
const evtAutorizadoEntrou = construirEventoDeGrupo({
  id: grupoAlvo,
  groupJid: grupoAlvo,
  action: 'add',
  author: autorAdmin,
  authorJid: autorAdmin,
  participants: [membroAutorizado],
  timestamp: 1729780300,
  timestampSeconds: 1729780300
}, { accountId: 'acc-1', recebidoEmMs: 1729780300000, botId: '5511999990001@s.whatsapp.net' })

const resAutorizado = avaliarEvento(db, evtAutorizadoEntrou)
const rAutorizado = rPorteiro(resAutorizado)
check('porteiro casou para usuário autorizado (forma Telefone)', rAutorizado?.status === 'matched_live')
check('usuário autorizado (forma Telefone) NÃO gera comando de remoção', rAutorizado?.commands.length === 0)

// 7.5b Forma 2: o MESMO membro autorizado entra identificado pelo WhatsApp como LID
const lidMembroAutorizado = '555666777888999@lid'
registrarPar(lidMembroAutorizado, membroAutorizado)

const evtAutorizadoLidEntrou = construirEventoDeGrupo({
  id: grupoAlvo,
  groupJid: grupoAlvo,
  action: 'add',
  author: autorAdmin,
  authorJid: autorAdmin,
  participants: [lidMembroAutorizado],
  timestamp: 1729780350,
  timestampSeconds: 1729780350
}, { accountId: 'acc-1', recebidoEmMs: 1729780350000, botId: '5511999990001@s.whatsapp.net' })

const resAutorizadoLid = avaliarEvento(db, evtAutorizadoLidEntrou)
const rAutorizadoLid = rPorteiro(resAutorizadoLid)
check('porteiro casou para o MESMO usuário autorizado chegando como LID', rAutorizadoLid?.status === 'matched_live')
check('usuário autorizado chegando como LID é resolvido e NÃO é removido', rAutorizadoLid?.commands.length === 0)

// 7.5c E o intruso chegando como LID (não autorizado) É removido pelo telefone resolvido
const evtIntrusoLidEntrou = construirEventoDeGrupo({
  id: grupoAlvo,
  groupJid: grupoAlvo,
  action: 'add',
  author: autorAdmin,
  authorJid: autorAdmin,
  participants: [lidIntruso],
  timestamp: 1729780380,
  timestampSeconds: 1729780380
}, { accountId: 'acc-1', recebidoEmMs: 1729780380000, botId: '5511999990001@s.whatsapp.net' })

const resIntrusoLid = avaliarEvento(db, evtIntrusoLidEntrou)
const rIntrusoLid = rPorteiro(resIntrusoLid)
check('intruso chegando como LID gera comando de remoção para o telefone resolvido',
  rIntrusoLid?.commands[0]?.payload?.participantId === telefoneIntruso)

// 7.6 Proteção do Dono: mesmo sem autorização explícita, nuncaRemoveDono protege
const donoBot = '5511900000000@s.whatsapp.net'
definirDono(db, donoBot, true)

const evtDonoEntrou = construirEventoDeGrupo({
  id: grupoAlvo,
  groupJid: grupoAlvo,
  action: 'add',
  author: autorAdmin,
  authorJid: autorAdmin,
  participants: [donoBot],
  timestamp: 1729780400,
  timestampSeconds: 1729780400
}, { accountId: 'acc-1', recebidoEmMs: 1729780400000, botId: '5511999990001@s.whatsapp.net' })

const resDono = avaliarEvento(db, evtDonoEntrou)
const rDono = rPorteiro(resDono)
check('dono do bot NUNCA é removido', rDono?.commands.length === 0)

// 7.7 Filtragem de ação: porteiro configurado só para "entrou" NÃO reage a "saiu"
const evtSaiu = construirEventoDeGrupo({
  id: grupoAlvo,
  groupJid: grupoAlvo,
  action: 'remove',
  author: autorAdmin,
  authorJid: autorAdmin,
  participants: [intrusoNaoAutorizado],
  timestamp: 1729780500,
  timestampSeconds: 1729780500
}, { accountId: 'acc-1', recebidoEmMs: 1729780500000, botId: '5511999990001@s.whatsapp.net' })

const resSaiu = avaliarEvento(db, evtSaiu)
const rSaiu = rPorteiro(resSaiu)
check('porteiro configurado para "entrou" descarta ação "saiu"', rSaiu?.status === 'no_match')

// --- 8. Template do Catálogo: porteiro.lcn --------------------------------
const catalogo = carregarCatalogo()
check('catálogo carregou o template porteiro', catalogo.has('porteiro'))

const templatePorteiro = catalogo.get('porteiro')
check('template porteiro tem categoria modulos-especializados', templatePorteiro.category === 'modulos-especializados')

const docRenderizado = renderizarTemplate(templatePorteiro, { poolId: 'pool-porteiro' })
check('documento renderizado tem tipo trigger.group', docRenderizado.flow.nodes[0].type === 'trigger.group')
check('documento renderizado tem pool interpolado', docRenderizado.responder.poolId === 'pool-porteiro')

docRenderizado.id = 'porteiro'
docRenderizado.revision = 1
const voltaCatalogo = compilar(descompilar(docRenderizado))
check('ida e volta do template do catálogo é perfeita', mesmo(docRenderizado, voltaCatalogo))

// Limpeza de recursos de teste
_reiniciarParaTeste(undefined)
try { fs.rmSync(pastaTesteLid, { recursive: true, force: true }) } catch {}
try { db.close() } catch {}

// --- Resumo final ---------------------------------------------------------
console.log(falhas === 0 ? '\nporteiro: tudo certo' : `\nporteiro: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
