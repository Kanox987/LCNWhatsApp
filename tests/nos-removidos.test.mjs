// AUTOMAÇÕES INSTALADAS COM UM NÓ QUE O MOTOR DEIXOU DE EXECUTAR.
//
// A recuperação de visualização única saiu do LCN (o WhatsApp mudou o
// tratamento desses arquivos). Quem já tinha o x9, o auto-recover ou afins
// instalado ficava com uma automação ligada apontando para um nó que o
// avaliador não conhece mais: um erro por evento, e o botão de ligar
// religando sem reclamar.
//
// Este arquivo prova a saída inteira, num banco que passou pela 017 com a
// automação já instalada, como uma instância real que atualiza:
//   - a 018 desliga só quem usa o nó, uma vez só, sem apagar nada;
//   - ligar de novo é recusado (409) com a mensagem legível; desligar e
//     "Tirar do ar" continuam;
//   - publicar uma revisão com o nó dá 422 legível, não o erro cru do schema;
//   - a listagem traz `bloqueio`, e a tela mostra o selo e o aviso;
//   - quem não usa o nó não é tocado;
//   - config-auto-recover e config-recover, que não têm o nó e só gravam uma
//     variável, caem pela proveniência (MODELOS_REMOVIDOS).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { rodarMigrations } from '../src/engine/server/db.js'
import { registrarRotasAutomations } from '../src/engine/server/routes/automations.js'
import { criarRoteador, ErroHttp } from '../src/engine/server/transport.js'
import { MODELOS_REMOVIDOS, NOS_REMOVIDOS, bloqueioDoDocumento, bloqueioDoModelo, bloqueioDoTexto } from '../src/engine/server/nosRemovidos.js'

let falhas = 0
const check = (nome, ok, extra) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PASTA_REAL = path.join(__dirname, '..', 'src', 'engine', 'server', 'migrations')
const MIGRACAO = '018_desligar_recuperacao_visu_unica.sql'

// ============================================================================
// 1. Banco como o de uma instância antes da atualização (até a 017)
// ============================================================================

const pastaAte017 = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-nos-removidos-'))
for (const nome of fs.readdirSync(PASTA_REAL)) {
  const m = nome.match(/^(\d+)_.+\.sql$/)
  if (m && Number(m[1]) <= 17) fs.copyFileSync(path.join(PASTA_REAL, nome), path.join(pastaAte017, nome))
}

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')
rodarMigrations(db, pastaAte017)
fs.rmSync(pastaAte017, { recursive: true, force: true })

check('a 018 existe na pasta real', fs.existsSync(path.join(PASTA_REAL, MIGRACAO)))
check('o banco de partida ainda não tem a 018', !db.prepare('SELECT 1 FROM schema_migrations WHERE version = 18').get())

// Documentos gravados como o serviço grava (JSON.stringify compacto). Entram
// por SQL porque o tipo removido não passa mais no schema nem no publish.
function documento (id, nos) {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    name: id,
    enabled: true,
    flow: { nodes: nos, edges: [] }
  }
}
const gatilho = { id: 'gatilho', type: 'trigger.command', config: { command: '/x' } }
const recover = { id: 'recupera', type: 'action.whatsapp.recover', config: { destination: 'same_chat' } }
const responde = { id: 'responde', type: 'action.whatsapp.reply', config: { text: 'ok' } }
// Só CITA o tipo num texto: não pode ser desligada.
const citaNoTexto = { id: 'responde', type: 'action.whatsapp.reply', config: { text: 'o "action.whatsapp.recover" saiu' } }

const agoraAntigo = '2026-01-01T00:00:00.000Z'
function instalar (id, nos, { enabled = 1, publicada = true, docJson } = {}) {
  db.prepare(`INSERT INTO automations (id, schema_version, enabled, active_revision_id, created_at, updated_at)
    VALUES (?, 1, ?, NULL, ?, ?)`).run(id, enabled, agoraAntigo, agoraAntigo)
  const rev = db.prepare(`INSERT INTO automation_revisions
    (automation_id, revision, status, doc_json, validation_errors_json, created_at)
    VALUES (?, 1, ?, ?, NULL, ?)`).run(id, publicada ? 'active' : 'draft', docJson ?? JSON.stringify(documento(id, nos)), agoraAntigo)
  if (publicada) db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, id)
  return rev.lastInsertRowid
}

instalar('x9', [gatilho, recover])
instalar('auto-recover', [{ id: 'gatilho', type: 'trigger.message', config: { messageKinds: ['view_once'] } }, recover])
instalar('ping', [gatilho, responde])
instalar('cita-no-texto', [gatilho, citaNoTexto])
instalar('ja-desligada', [gatilho, recover], { enabled: 0 })
instalar('so-rascunho', [gatilho, recover], { enabled: 0, publicada: false })
// doc_json malformado que cita o tipo: a migração não pode derrubar a partida.
instalar('malformada', [], { docJson: '{"flow":{"nodes":[{"type":"action.whatsapp.recover"' })

// Modelos sem o nó: só gravam a variável e respondem. Caem pela proveniência.
function proveniencia (automationId, templateId) {
  db.prepare(`INSERT INTO automation_template_provenance
    (automation_id, template_id, template_version, parameters_json, installed_at)
    VALUES (?, ?, 1, '{}', ?)`).run(automationId, templateId, agoraAntigo)
}
const gravaVariavel = { id: 'grava', type: 'action.variable.set', config: { scope: 'chat', name: 'auto_recover', value: true } }
const avisaLigado = { id: 'avisa', type: 'action.whatsapp.reply', config: { text: 'Recuperação automática LIGADA nesta conversa.' } }
instalar('config-auto-recover', [{ id: 'gatilho', type: 'trigger.command', config: { command: '/autorecover' } }, gravaVariavel, avisaLigado])
proveniencia('config-auto-recover', 'config-auto-recover')
instalar('config-recover', [{ id: 'gatilho', type: 'trigger.command', config: { command: '/configrecover' } }, responde])
proveniencia('config-recover', 'config-recover')
// Veio de um modelo que continua no catálogo: não é tocada.
instalar('menu-de-modelo', [gatilho, responde])
proveniencia('menu-de-modelo', 'menu')

// ============================================================================
// 2. A migração 018
// ============================================================================

let erroMigracao = null
try { rodarMigrations(db, PASTA_REAL) } catch (erro) { erroMigracao = erro }
check('a 018 roda sem erro, mesmo com doc_json malformado no banco', !erroMigracao, erroMigracao?.message)
check('a 018 fica registrada em schema_migrations', Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version = 18').get()))

const linha = (id) => db.prepare('SELECT * FROM automations WHERE id = ?').get(id)
check('x9 (recover) ficou desligada', linha('x9').enabled === 0)
check('auto-recover (recover) ficou desligada', linha('auto-recover').enabled === 0)
check('x9 teve updated_at atualizado', linha('x9').updated_at !== agoraAntigo, linha('x9').updated_at)
check('updated_at no mesmo formato ISO do serviço', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(linha('x9').updated_at), linha('x9').updated_at)
check('x9 continua publicada (nada é apagado)', linha('x9').active_revision_id !== null)
check('a revisão do x9 continua no banco', db.prepare("SELECT COUNT(*) AS n FROM automation_revisions WHERE automation_id = 'x9'").get().n === 1)
check('ping (sem recover) continua ligada', linha('ping').enabled === 1)
check('ping não teve updated_at mexido', linha('ping').updated_at === agoraAntigo)
check('quem só cita o tipo num texto continua ligada', linha('cita-no-texto').enabled === 1)
check('doc_json malformado não é tocado', linha('malformada').enabled === 1)
check('a já desligada não teve updated_at mexido', linha('ja-desligada').updated_at === agoraAntigo)
check('config-auto-recover (sem o nó, pela proveniência) ficou desligada', linha('config-auto-recover').enabled === 0)
check('config-recover (sem o nó, pela proveniência) ficou desligada', linha('config-recover').enabled === 0)
check('config-auto-recover continua publicada (nada é apagado)', linha('config-auto-recover').active_revision_id !== null)
check('modelo que continua no catálogo não é tocado', linha('menu-de-modelo').enabled === 1 && linha('menu-de-modelo').updated_at === agoraAntigo)

// Roda uma vez só: religada por fora, uma nova partida não desliga de novo.
db.prepare("UPDATE automations SET enabled = 1 WHERE id = 'ja-desligada'").run()
rodarMigrations(db, PASTA_REAL)
check('a 018 não roda de novo numa segunda partida', linha('ja-desligada').enabled === 1)
db.prepare("UPDATE automations SET enabled = 0 WHERE id = 'ja-desligada'").run()

// ============================================================================
// 3. nosRemovidos.js
// ============================================================================

check('NOS_REMOVIDOS tem o recover', typeof NOS_REMOVIDOS['action.whatsapp.recover'] === 'string')
const bloqueio = bloqueioDoDocumento(documento('x9', [gatilho, recover]))
check('bloqueioDoDocumento acha o nó removido', bloqueio?.tipo === 'action.whatsapp.recover')
check('a mensagem diz que a recuperação foi retirada', /recuperação de visualização única foi retirada/.test(bloqueio?.mensagem))
check('a mensagem diz o motivo (o WhatsApp mudou o tratamento)', /WhatsApp mudou o tratamento/.test(bloqueio?.mensagem))
check('a mensagem diz que a automação foi desligada', /foi desligada/.test(bloqueio?.mensagem))
check('a mensagem oferece "Tirar do ar"', bloqueio?.mensagem.includes('"Tirar do ar"'))
check('documento sem o nó não tem bloqueio', bloqueioDoDocumento(documento('ping', [gatilho, responde])) === null)
check('citar o tipo num texto não é bloqueio', bloqueioDoDocumento(documento('c', [gatilho, citaNoTexto])) === null)
check('bloqueioDoTexto aguenta JSON malformado', bloqueioDoTexto('{"type":"action.whatsapp.recover"') === null)
check('bloqueioDoTexto aguenta null', bloqueioDoTexto(null) === null && bloqueioDoDocumento(null) === null)
check('MODELOS_REMOVIDOS tem os cinco modelos retirados',
  ['x9', 'auto-recover', 'config-auto-recover', 'recuperar-visu-unica', 'config-recover'].every((id) => typeof MODELOS_REMOVIDOS[id] === 'string'))
check('bloqueioDoModelo acha o config-auto-recover', bloqueioDoModelo('config-auto-recover')?.modelo === 'config-auto-recover')
check('bloqueioDoModelo traz a mesma mensagem do nó', bloqueioDoModelo('config-recover')?.mensagem === bloqueio.mensagem)
check('bloqueioDoModelo ignora modelo que continua', bloqueioDoModelo('menu') === null && bloqueioDoModelo(undefined) === null)
// A lista da 018 é a mesma de MODELOS_REMOVIDOS.
const sql018 = fs.readFileSync(path.join(PASTA_REAL, MIGRACAO), 'utf8')
check('a 018 cita todos os MODELOS_REMOVIDOS', Object.keys(MODELOS_REMOVIDOS).every((id) => sql018.includes(`'${id}'`)))

// ============================================================================
// 4. Rotas do motor
// ============================================================================

const roteador = criarRoteador()
registrarRotasAutomations(roteador, db)
async function chamar (method, caminho, body) {
  try {
    return { ok: true, valor: await roteador.resolver(method, caminho, { body, req: { headers: {} } }) }
  } catch (erro) {
    if (!(erro instanceof ErroHttp)) throw erro
    return { ok: false, status: erro.status, mensagem: erro.message, detalhes: erro.detalhes }
  }
}

const lista = (await chamar('GET', '/automations')).valor
const porId = new Map(lista.map((a) => [a.id, a]))
check('GET /automations traz bloqueio para o x9', porId.get('x9')?.bloqueio?.tipo === 'action.whatsapp.recover')
check('o bloqueio da listagem traz a mensagem legível', porId.get('x9')?.bloqueio?.mensagem === bloqueio.mensagem)
check('GET /automations traz bloqueio null para o ping', porId.get('ping')?.bloqueio === null)
check('rascunho com recover não tem bloqueio (só a ativa conta)', porId.get('so-rascunho')?.bloqueio === null)
check('GET /automations traz bloqueio para o config-auto-recover (sem o nó)', porId.get('config-auto-recover')?.bloqueio?.modelo === 'config-auto-recover')
check('o bloqueio do config-auto-recover traz a mensagem legível', porId.get('config-auto-recover')?.bloqueio?.mensagem === bloqueio.mensagem)
check('GET /automations traz bloqueio para o config-recover', porId.get('config-recover')?.bloqueio?.modelo === 'config-recover')
check('modelo que continua no catálogo não tem bloqueio', porId.get('menu-de-modelo')?.bloqueio === null)
check('GET /automations/:id também traz bloqueio', (await chamar('GET', '/automations/x9')).valor?.bloqueio?.tipo === 'action.whatsapp.recover')

const ligar = await chamar('PUT', '/automations/x9/enabled', { enabled: true })
check('ligar o x9 é recusado com 409', !ligar.ok && ligar.status === 409, ligar.status)
check('a recusa traz a mensagem legível', ligar.mensagem === bloqueio.mensagem, ligar.mensagem)
check('o x9 continua desligado depois da recusa', linha('x9').enabled === 0)

const desligar = await chamar('PUT', '/automations/x9/enabled', { enabled: false })
check('desligar o x9 continua permitido', desligar.ok && desligar.valor.enabled === false)

const ligarConfig = await chamar('PUT', '/automations/config-auto-recover/enabled', { enabled: true })
check('ligar o config-auto-recover é recusado com 409', !ligarConfig.ok && ligarConfig.status === 409, ligarConfig.status)
check('a recusa do config-auto-recover traz a mensagem legível', ligarConfig.mensagem === bloqueio.mensagem, ligarConfig.mensagem)
check('o config-auto-recover continua desligado', linha('config-auto-recover').enabled === 0)
const republicar = await chamar('POST', '/automations/config-auto-recover/publish', {})
check('republicar o config-auto-recover dá 422 legível', !republicar.ok && republicar.status === 422 &&
  /recuperação de visualização única foi retirada/.test(republicar.mensagem), republicar.mensagem)
check('o config-auto-recover continua desligado depois do publish recusado', linha('config-auto-recover').enabled === 0)

const ligarPing = await chamar('PUT', '/automations/ping/enabled', { enabled: false })
const religarPing = await chamar('PUT', '/automations/ping/enabled', { enabled: true })
check('o ping desliga e liga normalmente', ligarPing.ok && religarPing.ok && religarPing.valor.enabled === true)

const publicar = await chamar('POST', '/automations/so-rascunho/publish', {})
check('publicar revisão com recover dá 422', !publicar.ok && publicar.status === 422, publicar.status)
check('o 422 diz o motivo, não o erro cru do schema', /recuperação de visualização única foi retirada/.test(publicar.mensagem), publicar.mensagem)
check('o 422 aponta o nó', publicar.detalhes?.[0]?.path === '/flow/nodes/1/type', publicar.detalhes?.[0]?.path)
check('o rascunho continua sem publicar', linha('so-rascunho').active_revision_id === null)

const tirar = await chamar('POST', '/automations/x9/unpublish', {})
check('"Tirar do ar" continua permitido', tirar.ok && tirar.valor.activeRevisionId === null)
check('fora do ar, o bloqueio some (não há revisão ativa)', tirar.valor?.bloqueio === null)
const ligarForaDoAr = await chamar('PUT', '/automations/x9/enabled', { enabled: true })
check('fora do ar, ligar segue recusado (sem revisão publicada)', !ligarForaDoAr.ok && ligarForaDoAr.status === 409)

// ============================================================================
// 5. A tela
// ============================================================================

const tela = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'public', 'pages', 'automations.js'), 'utf8')
check('a tela mostra o selo "Desligada: recurso removido"', tela.includes("'Desligada: recurso removido'"))
check('a tela mostra a mensagem do motor no aviso', tela.includes('automation.bloqueio.mensagem'))
check('a tela desabilita "Ligar" quando há bloqueio', /disabled:[^\n]*bloqueada/.test(tela))

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nNÓS REMOVIDOS OK')
process.exit(falhas ? 1 : 0)
