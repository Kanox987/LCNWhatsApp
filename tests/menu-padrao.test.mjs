// Os dez cenários que o pedido da frente C exige do menu, mais a guarda de
// defasagem que `src/engine/server/menuPadrao.js` promete pelo nome.
//
// Este arquivo SUBSTITUI o antigo `engine-native-automations.test.mjs`, que
// afirmava o contrário de tudo isto: que a coluna `native` marcava o menu e
// que `GET /automations` nunca o listava. As duas asserções foram INVERTIDAS,
// não apagadas — o privilégio saiu do motor, então o que era garantia virou
// defeito.
//
// Conflito de comando tem bateria própria em `tests/conflito-de-comando.test.mjs`
// (o décimo cenário, com o caminho de resolução do dono ponta a ponta); aqui
// fica só a prova de que instalar o menu padrão não nasce em conflito.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { conflitosDeComando } from '../src/engine/server/conflitos.js'
import { carregarCatalogo, obterTemplate } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { documentoDoMenu, garantirMenuPadrao, VERSAO_TEMPLATE_MENU, TEMPLATE_DO_MENU, IDS_DO_MENU } from '../src/engine/server/menuPadrao.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// Igualdade profunda INDIFERENTE À ORDEM DAS CHAVES. `JSON.stringify` não
// serve aqui: `renderizarTemplate` reconstrói o objeto chave por chave na
// ordem do `.lcn`, e `documentoDoMenu()` escreve o segundo nó como
// `{ type, config, id }`. Comparar texto acusaria uma defasagem inexistente.
function mesmo (a, b) {
  if (a === b) return true
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((item, i) => mesmo(item, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ca = Object.keys(a); const cb = Object.keys(b)
    if (ca.length !== cb.length) return false
    return ca.every((c) => Object.prototype.hasOwnProperty.call(b, c) && mesmo(a[c], b[c]))
  }
  return false
}

const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })

// Quem de fato respondeu ao evento. `matched_live` é o status que o avaliador
// usa para "casou e foi ao ar" — é o mesmo recorte de
// `tests/conflito-de-comando.test.mjs:154`.
const casaram = (r) => (r.results || []).filter((x) => x.status === 'matched_live').map((x) => x.automationId).sort()
const textoDe = (r, id) => (r.results || []).find((x) => x.automationId === id)?.commands?.[0]?.payload?.text ?? ''

function eventoTexto ({ chatId = 'chat-menu', msgId = 'm1', texto = '/menu' } = {}) {
  return {
    provider: 'zapo',
    accountId: 'acc-1',
    eventId: `acc-1:${chatId}:${chatId}:${msgId}`,
    occurredAt: new Date().toISOString(),
    replay: false,
    chat: { id: chatId, kind: 'direct' },
    sender: { id: chatId, authoredBySelf: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: msgId }
  }
}

const docAtivo = (db, id) => JSON.parse(db.prepare(
  'SELECT r.doc_json AS d FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id WHERE a.id = ?'
).get(id).d)

// ---------------------------------------------------------------- defasagem

{
  const catalogo = carregarCatalogo()
  const template = obterTemplate(catalogo, TEMPLATE_DO_MENU)
  check('o template "menu" existe no catálogo', !!template)
  check(`a versão do template bate com VERSAO_TEMPLATE_MENU (${VERSAO_TEMPLATE_MENU})`,
    template.templateVersion === VERSAO_TEMPLATE_MENU,
    `template v${template?.templateVersion}`)

  const renderizado = renderizarTemplate(template, { poolId: IDS_DO_MENU.poolComum })
  const inline = documentoDoMenu(IDS_DO_MENU.poolComum)

  // O `scope` é a ÚNICA diferença legítima entre os dois, e é de propósito:
  // nenhum dos 121 templates do catálogo declara `onde` — quem instala pelo
  // painel escolhe o escopo na hora, e a rota de instalação o preenche. O
  // menu semeado no boot não passa por essa tela, então nasce com
  // `em todo lugar`, que é o único escopo que faz sentido para ele (escopo
  // vazio NÃO significa "em tudo": `escopoCasa` recusa, e o menu ficaria
  // mudo em toda conversa). O cenário 1 confere esse escopo por si.
  const semEscopo = (d) => { const c = structuredClone(d); delete c.scope; return c }
  const igual = mesmo(semEscopo(renderizado), semEscopo(inline))
  check('documentoDoMenu() é IDÊNTICO ao template renderizado, fora o escopo (nada de defasagem)',
    igual, igual ? '' : `render=${JSON.stringify(renderizado)} inline=${JSON.stringify(inline)}`)
  check('o template não declara escopo (quem instala escolhe), e o semeado declara "em todo lugar"',
    renderizado.scope.include.length === 0 && inline.scope.include[0]?.kind === 'everywhere',
    JSON.stringify({ template: renderizado.scope, semeado: inline.scope }))
}

// ----------------------------------------------- 1. instalar o menu padrão

{
  const db = abrirBanco(':memory:')
  const api = criarApi(db)

  const linha = db.prepare('SELECT * FROM automations WHERE id = ?').get(IDS_DO_MENU.novo)
  check('1. instalar: o menu nasce como automação comum',
    !!linha && linha.enabled === 1 && linha.deployment_mode === 'live' && !!linha.active_revision_id && linha.native === 0,
    JSON.stringify({ enabled: linha?.enabled, deployment_mode: linha?.deployment_mode, native: linha?.native }))

  const doc = docAtivo(db, IDS_DO_MENU.novo)
  check('1. instalar: o pool NÃO é reservado', !doc.responder.poolId.startsWith('__'), doc.responder.poolId)

  const lista = await api.resolver('GET', '/automations', contexto())
  check('1. instalar: GET /automations INCLUI o menu (é editável pelo painel comum)',
    lista.some((a) => a.id === IDS_DO_MENU.novo))

  check('10. nenhum conflito de comando ao instalar',
    !conflitosDeComando(db).some((c) => c.comando === '/menu'),
    JSON.stringify(conflitosDeComando(db)))

  const r = await avaliarEvento(db, eventoTexto())
  check('1. instalar: /menu responde', casaram(r).includes(IDS_DO_MENU.novo), JSON.stringify(casaram(r)))
  db.close()
}

// ------------------------------------------------- 2. editar o menu em .lcn

{
  const db = abrirBanco(':memory:')
  const servico = criarServicoAutomacoes(db)

  const texto = descompilar(docAtivo(db, IDS_DO_MENU.novo))
  check('2. editar: o menu ativo descompila para .lcn', texto.includes('mostra menu'))

  const novoTexto = texto.replace('cabeçalho: "Comandos disponíveis:"', 'cabeçalho: "Escolha aí:"')
  check('2. editar: a linha do cabeçalho existe no .lcn', novoTexto !== texto)

  servico.salvarRascunho(IDS_DO_MENU.novo, { document: compilar(novoTexto) }, undefined)
  servico.publicar(IDS_DO_MENU.novo)

  const r = await avaliarEvento(db, eventoTexto({ msgId: 'm2' }))
  const texto2 = textoDe(r, IDS_DO_MENU.novo)
  check('2. editar: a edição em .lcn chega ao ar', texto2.startsWith('Escolha aí:'), texto2.split('\n')[0])
  db.close()
}

// --------------------------------------------- 3. criar um menu alternativo

{
  const db = abrirBanco(':memory:')
  const servico = criarServicoAutomacoes(db)
  const meu = structuredClone(docAtivo(db, IDS_DO_MENU.novo))
  // `normalizarDocumento` exige doc.id === id da rota: sem isto, 400.
  meu.id = 'meu-menu'
  meu.name = 'Meu menu'
  meu.flow.nodes[0].config.command = '/comandos'
  meu.flow.nodes[1].config.header = 'Meus comandos:'
  meu.display = { menuLabel: '/comandos', menuDescription: 'Lista alternativa', family: 'utilitarios' }
  servico.criarEPublicar({ id: 'meu-menu', document: meu })
  db.prepare("UPDATE automations SET deployment_mode = 'live' WHERE id = ?").run('meu-menu')

  const r = await avaliarEvento(db, eventoTexto({ texto: '/comandos', msgId: 'm3' }))
  check('3. criar outro: o menu alternativo responde pela própria palavra',
    casaram(r).includes('meu-menu'), JSON.stringify(casaram(r)))
  check('3. criar outro: e o padrão continua respondendo /menu',
    casaram(await avaliarEvento(db, eventoTexto({ msgId: 'm4' }))).includes(IDS_DO_MENU.novo))
  db.close()
}

// ----------------------------------------------------- 4. alterar o gatilho

{
  const db = abrirBanco(':memory:')
  const servico = criarServicoAutomacoes(db)
  const doc = structuredClone(docAtivo(db, IDS_DO_MENU.novo))
  doc.flow.nodes[0].config.command = '/ajuda'
  doc.display.menuLabel = '/ajuda'
  servico.salvarRascunho(IDS_DO_MENU.novo, { document: doc }, undefined)
  servico.publicar(IDS_DO_MENU.novo)

  check('4. alterar gatilho: /menu não casa mais',
    !casaram(await avaliarEvento(db, eventoTexto({ msgId: 'm5' }))).length)
  check('4. alterar gatilho: /ajuda casa',
    casaram(await avaliarEvento(db, eventoTexto({ texto: '/ajuda', msgId: 'm6' }))).includes(IDS_DO_MENU.novo))
  db.close()
}

// -------------------------------------------------------- 5. desativar menu

{
  const db = abrirBanco(':memory:')
  db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run(IDS_DO_MENU.novo)
  const r = await avaliarEvento(db, eventoTexto({ msgId: 'm7' }))
  check('5. desativar: o menu desligado não responde',
    !casaram(r).includes(IDS_DO_MENU.novo), JSON.stringify(casaram(r)))
  db.close()
}

// ----------------------------------------- 6 e 7. remover, e rodar sem menu

{
  const db = abrirBanco(':memory:')
  const api = criarApi(db)
  const saida = await api.resolver('DELETE', `/automations/${IDS_DO_MENU.novo}`, contexto())
  check('6. remover: a rota comum apaga o menu', saida?.removed === true, JSON.stringify(saida))
  check('6. remover: a linha saiu do banco',
    !db.prepare('SELECT 1 FROM automations WHERE id = ?').get(IDS_DO_MENU.novo))

  const comMenu = db.prepare('SELECT COUNT(*) AS t FROM automation_revisions WHERE doc_json LIKE ?').get('%action.menu.render%')
  check('7. sem menu: nenhuma automação com action.menu.render sobrou', comMenu.t === 0, `${comMenu.t}`)
  check('7. sem menu: /menu não casa com nada',
    !casaram(await avaliarEvento(db, eventoTexto({ msgId: 'm8' }))).length)

  // 9a. reiniciar não RESSUSCITA o que foi removido — é a marca de semeadura.
  garantirMenuPadrao(db)
  check('9. reiniciar: o boot NÃO ressuscita o menu removido',
    !db.prepare('SELECT 1 FROM automations WHERE id = ?').get(IDS_DO_MENU.novo))
  db.close()
}

// ------------------------------------------------------ 8. migrar o antigo

{
  const db = abrirBanco(':memory:')
  // Apaga o que o boot semeou e forja o estado legado: `native = 1`, pool
  // reservado, escopo vazio, nome com o sufixo "(nativo)". Por SQL cru de
  // propósito — `criarEPublicar` passaria pela validação, e escopo vazio é
  // exatamente o estado que `converterMenuNativo` existe para consertar.
  db.prepare('DELETE FROM automations WHERE id = ?').run(IDS_DO_MENU.novo)
  db.prepare('DELETE FROM menu_padrao_semeadura').run()

  const agora = new Date().toISOString()
  const antigo = documentoDoMenu('__native__')
  // `criarEPublicar` grava `id` e `revision` no doc_json; o SQL cru não, e o
  // documento sem eles é recusado pelo schema. Forjar o legado exige forjar
  // esses dois também, senão o teste mediria um estado que nunca existiu.
  antigo.id = IDS_DO_MENU.antigo
  antigo.revision = 1
  antigo.name = 'Menu de comandos (nativo)'
  antigo.scope = { include: [], exclude: [{ kind: 'contact', id: 'ninguem' }] }
  db.prepare("INSERT OR IGNORE INTO pools (id, label, created_at, updated_at) VALUES ('__native__', 'Reservado', ?, ?)").run(agora, agora)
  db.prepare('INSERT INTO automations (id, schema_version, enabled, deployment_mode, native, created_at, updated_at) VALUES (?, 1, 1, ?, 1, ?, ?)')
    .run(IDS_DO_MENU.antigo, 'live', agora, agora)
  const rev = db.prepare('INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES (?, 1, ?, ?, ?)')
    .run(IDS_DO_MENU.antigo, 'active', JSON.stringify(antigo), agora)
  db.prepare('UPDATE automations SET active_revision_id = ? WHERE id = ?').run(rev.lastInsertRowid, IDS_DO_MENU.antigo)

  garantirMenuPadrao(db)

  const linha = db.prepare('SELECT * FROM automations WHERE id = ?').get(IDS_DO_MENU.antigo)
  const doc = docAtivo(db, IDS_DO_MENU.antigo)
  check('8. migrar: o privilégio sai (native = 0)', linha.native === 0, `native=${linha.native}`)
  check('8. migrar: o pool reservado vira pool comum', !doc.responder.poolId.startsWith('__'), doc.responder.poolId)
  check('8. migrar: escopo vazio vira "em todo lugar"',
    doc.scope.include.length === 1 && doc.scope.include[0].kind === 'everywhere', JSON.stringify(doc.scope.include))
  check('8. migrar: a exclusão do dono é PRESERVADA',
    doc.scope.exclude.length === 1 && doc.scope.exclude[0].id === 'ninguem', JSON.stringify(doc.scope.exclude))
  check('8. migrar: o sufixo "(nativo)" sai do nome', doc.name === 'Menu de comandos', doc.name)
  const escopos = db.prepare('SELECT kind FROM automation_scopes WHERE automation_revision_id = ?').all(rev.lastInsertRowid)
  check('8. migrar: os escopos foram regravados na tabela',
    escopos.length === 2 && escopos.some((e) => e.kind === 'everywhere'), JSON.stringify(escopos))

  const lista = await criarApi(db).resolver('GET', '/automations', contexto())
  check('8. migrar: o menu migrado APARECE em GET /automations', lista.some((a) => a.id === IDS_DO_MENU.antigo))
  check('8. migrar: o menu migrado responde /menu',
    casaram(await avaliarEvento(db, eventoTexto({ msgId: 'm9' }))).includes(IDS_DO_MENU.antigo))

  const antes = db.prepare('SELECT COUNT(*) AS t FROM automations').get().t
  garantirMenuPadrao(db)
  check('9. reiniciar: a segunda passada é idempotente',
    db.prepare('SELECT COUNT(*) AS t FROM automations').get().t === antes)
  db.close()
}

// -------------------------------- 9b. reinício preserva a configuração feita

{
  const db = abrirBanco(':memory:')
  const servico = criarServicoAutomacoes(db)
  const doc = structuredClone(docAtivo(db, IDS_DO_MENU.novo))
  doc.flow.nodes[1].config.header = 'Minha lista:'
  servico.salvarRascunho(IDS_DO_MENU.novo, { document: doc }, undefined)
  servico.publicar(IDS_DO_MENU.novo)

  garantirMenuPadrao(db)
  check('9. reiniciar: a edição do dono sobrevive ao boot',
    docAtivo(db, IDS_DO_MENU.novo).flow.nodes[1].config.header === 'Minha lista:',
    docAtivo(db, IDS_DO_MENU.novo).flow.nodes[1].config.header)
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S) NO MENU PADRÃO` : '\nOS DEZ CENÁRIOS DO MENU PADRÃO PASSARAM')
process.exit(falhas ? 1 : 0)
