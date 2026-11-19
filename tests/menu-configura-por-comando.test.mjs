// O MENU SEM ABA: tudo o que a aba Menu do painel configurava passa pelo
// comando `configura menu`.
//
// O dono pediu que o menu deixasse de ser uma aba separada e fosse só um
// comando. A aba fazia cinco coisas que o comando não fazia:
//
//   1. numeração          → `campo: numeração`   (era a lacuna registrada em
//                            MENU_COMO_AUTOMACAO.md)
//   2. famílias mostradas → `campo: famílias`
//   3. "todos os grupos"  → `onde vale: todos os grupos`
//   4. "todo o privado"   → `onde vale: todo o privado`
//   5. "voltar ao padrão" → `campo: volta ao padrão`
//
// E as que faltavam ao comando na primeira versão (achados da revisão):
//
//   6. "Herdar" por campo   → escrever `herdar` depois do comando tira SÓ
//                              aquele campo (volta ao padrão apaga o nível)
//   7. texto em branco      → `em branco` (ou aspas vazias) grava ''; no
//                              texto de vazio, isso deixa o /menu mudo
//   8. formato por palavra  → `texto` / `com botões`, não só os códigos
//   9. um grupo/contato     → `onde vale: outra conversa`, com o número ou id
//      específico              logo depois do comando; e volta ao padrão de
//                              outra conversa limpa linha órfã
//  10. o template           → config-menu v2 escolhe o campo e onde vale
//
// E o painel ficou com ver e apagar (aba Dados): a rota do motor que mostra o
// menu de uma conversa já com a cascata, e a que apaga a configuração própria.
//
// Cada uma é medida aqui no caminho inteiro: texto .lcn → documento →
// publicação pela rota comum (que valida contra o schema) → mensagem no
// WhatsApp → o /menu da conversa mudou. E a ida e volta do texto fecha.
import fs from 'node:fs'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarApi } from '../src/engine/server/api.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { definirDono } from '../src/engine/server/owners.js'
import { alvoDaConversa, lerFormato, lerNumeracao, usoDoCampo, valorDoComando } from '../src/engine/server/menuConfig.js'
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const canon = (v) => Array.isArray(v)
  ? v.map(canon)
  : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v
const mesmo = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

const db = abrirBanco(':memory:')
const api = criarApi(db)
const ctx = (body = null) => ({ body, query: new URLSearchParams(''), req: { headers: {} } })
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

// O menu entra como qualquer template (vem com o config-menu junto).
await api.resolver('POST', '/templates/menu/install', ctx({
  scope: { include: [{ kind: 'everywhere' }] },
  parameters: { menu: { poolId: 'p1' }, 'config-menu': { poolId: 'p1' } }
}))

const GRUPO_A = '120000000000000011@g.us'
const GRUPO_B = '120000000000000012@g.us'
const PRIVADO = '5511900000021@s.whatsapp.net'
const DONO = '5511977770000@s.whatsapp.net'
for (const g of [GRUPO_A, GRUPO_B]) {
  db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
    .run('group', g, 'grupo_ativo', '"sim"', agora)
}
definirDono(db, DONO, true)

// Um comando com família, para o menu ter mais de uma linha e a de famílias
// ter o que esconder.
const comandoDeVenda = compilar(`automação vendas-preco
  revisão: 1
  nome: Preço
  tipo: comando
  dispara com: /preco
  menu: /preco — Tabela de preços
  família: vendas
  pool: p1
  acessa: texto
  casa: exato
  quem: qualquer um
  onde: em qualquer lugar

  responde "tabela"
`)
// Publicar pela rota comum põe em SOMBRA; o ao vivo é um passo à parte, o
// mesmo que o painel dá.
async function publicarAoVivo (doc) {
  await api.resolver('POST', '/automations', ctx(doc))
  await api.resolver('POST', `/automations/${doc.id}/publish`, ctx())
  return api.resolver('PUT', `/automations/${doc.id}/deployment-mode`, ctx({ mode: 'live' }))
}
await publicarAoVivo(comandoDeVenda)

// --- .lcn → documento → publicação ---------------------------------------
const fonteDe = (id, comando, linhas) => `automação ${id}
  revisão: 1
  nome: ${id}
  tipo: comando
  dispara com: ${comando}
  menu: não
  pool: p1
  acessa: texto
  casa: exato ou com argumentos
  quem: qualquer um
  onde: em qualquer lugar
  só dono

  configura menu
${linhas.map((l) => `    ${l}`).join('\n')}
`

const comandos = {
  numerar: fonteDe('menu-numerar', '/numerar', ['campo: numeração', 'como usar: "Escreva sim ou não."', 'confirma: "Numeração trocada."']),
  familias: fonteDe('menu-familias', '/familias', ['campo: famílias', 'confirma: "Famílias trocadas."']),
  cabecalhoGrupos: fonteDe('menu-cab-grupos', '/cabgrupos', ['campo: cabeçalho', 'onde vale: todos os grupos', 'confirma: "Cabeçalho de todos os grupos trocado."']),
  numerarPrivado: fonteDe('menu-num-privado', '/numprivado', ['campo: numeração', 'onde vale: todo o privado']),
  voltar: fonteDe('menu-voltar', '/menupadrao', ['campo: volta ao padrão', 'confirma: "Menu desta conversa voltou ao padrão."']),
  // Sem `como usar`: o motor explica conforme o campo.
  rodape: fonteDe('menu-rodape', '/rodape', ['campo: rodapé']),
  vazio: fonteDe('menu-vazio', '/vazio', ['campo: texto de vazio']),
  formato: fonteDe('menu-formato', '/formato', ['campo: formato']),
  remoto: fonteDe('menu-remoto', '/menuremoto', ['campo: cabeçalho', 'onde vale: outra conversa', 'confirma: "Cabeçalho da outra conversa trocado."']),
  remotoPadrao: fonteDe('menu-remoto-padrao', '/remotopadrao', ['campo: volta ao padrão', 'onde vale: outra conversa'])
}

const docs = {}
for (const [nome, fonte] of Object.entries(comandos)) {
  let doc
  try { doc = compilar(fonte) } catch (erro) { check(`${nome}: o .lcn compila`, false, erro.message); continue }
  docs[nome] = doc
  check(`${nome}: o .lcn compila`, true)
  check(`${nome}: a ida e volta fecha`, mesmo(doc, compilar(descompilar(doc))), descompilar(doc))
  const erros = validarAutomacao(db, doc)
  check(`${nome}: o documento passa no schema`, erros.length === 0, JSON.stringify(erros))
  const pub = await publicarAoVivo(doc)
  check(`${nome}: publica pela rota comum e fica ao vivo`, pub?.deploymentMode === 'live' && pub?.activeRevisionId, JSON.stringify(pub).slice(0, 160))
}

const configDe = (nome) => docs[nome]?.flow.nodes.find((n) => n.type === 'action.menu.config')?.config || {}
check('numeração vira field "numbered" no documento', configDe('numerar').field === 'numbered', JSON.stringify(configDe('numerar')))
check('famílias vira field "families"', configDe('familias').field === 'families')
check('volta ao padrão vira field "reset"', configDe('voltar').field === 'reset')
check('"todos os grupos" vira target "group_default"', configDe('cabecalhoGrupos').target === 'group_default')
check('"todo o privado" vira target "direct_default"', configDe('numerarPrivado').target === 'direct_default')
check('sem "onde vale", o documento não ganha target (como todo documento antigo)', configDe('numerar').target === undefined)

const descompilado = descompilar(docs.numerar)
check('o descompilador escreve a palavra em português', descompilado.includes('campo: numeração'), descompilado)
check('e escreve "onde vale" em português', descompilar(docs.cabecalhoGrupos).includes('onde vale: todos os grupos'))

// O código do documento também é aceito na entrada, como em todo campo de palavra.
check('o código "numbered" também compila', compilar(comandos.numerar.replace('campo: numeração', 'campo: numbered'))
  .flow.nodes.find((n) => n.type === 'action.menu.config').config.field === 'numbered')

let erroDePalavra = null
try { compilar(comandos.numerar.replace('campo: numeração', 'campo: numeracao errada')) } catch (erro) { erroDePalavra = erro }
check('palavra fora da lista é recusada com a linha', erroDePalavra instanceof ErroDeSintaxe && erroDePalavra.message.includes('numeração'), erroDePalavra?.message)

// --- documento guardado antes continua valendo ---------------------------
//
// Só se ACRESCENTOU valor ao enum e um campo opcional. Um documento com o
// formato antigo (só field, sem target) tem de passar igual.
const antigo = {
  schemaVersion: 1, id: 'cfg-antigo', revision: 1, name: 'cfg-antigo', enabled: true,
  scope: { include: [{ kind: 'everywhere' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p1' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: '/cfgantigo', match: 'exact_or_args', allowFrom: 'external', requireOwner: true } },
      { id: 'c', type: 'action.menu.config', config: { field: 'header', usageText: 'x', confirmText: 'y' } }
    ],
    edges: [{ from: 'g', to: 'c', on: 'matched' }]
  }
}
for (const field of ['header', 'footer', 'emptyText', 'buttonTitle', 'format']) {
  const doc = structuredClone(antigo)
  doc.flow.nodes[1].config.field = field
  check(`documento antigo com field "${field}" continua válido`, validarAutomacao(db, doc).length === 0)
}
const torto = structuredClone(antigo)
torto.flow.nodes[1].config.field = 'numerado'
check('field fora do enum continua recusado', validarAutomacao(db, torto).length > 0)
const alvoTorto = structuredClone(antigo)
alvoTorto.flow.nodes[1].config.target = 'everywhere'
check('target fora do enum é recusado', validarAutomacao(db, alvoTorto).length > 0)

// --- execução: a numeração mudou de verdade --------------------------------
let n = 0
const evento = (chatId, senderId, texto) => {
  n++
  const ehGrupo = chatId.endsWith('@g.us')
  return {
    provider: 'zapo', accountId: 'acc-1', eventId: `acc-1:${chatId}:${senderId}:e${n}`,
    occurredAt: agora, replay: false,
    chat: { id: chatId, kind: ehGrupo ? 'group' : 'direct' },
    sender: { id: senderId, authoredBySelf: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', remoteJid: chatId, id: `e${n}` }
  }
}
const resposta = (chatId, texto, automacao, quem = DONO) => avaliarEvento(db, evento(chatId, quem, texto))
  .results.find((r) => r.automationId === automacao)?.commands?.[0]?.payload?.text
const menuDe = (chatId) => resposta(chatId, '/menu', 'menu', PRIVADO)
const linhas = (texto) => (texto || '').split('\n')

const antes = menuDe(GRUPO_A)
check('antes: o menu do grupo A não é numerado', linhas(antes).some((l) => l.startsWith('• /preco')) && !linhas(antes).some((l) => /^1\. /.test(l)), antes)

check('o dono numera pelo comando', resposta(GRUPO_A, '/numerar sim', 'menu-numerar') === 'Numeração trocada.')
const depois = menuDe(GRUPO_A)
check('depois: o menu do grupo A sai numerado', linhas(depois).some((l) => /^1\. /.test(l)) && linhas(depois).some((l) => /^\d\. \/preco/.test(l)), depois)
check('o grupo B não foi afetado', !linhas(menuDe(GRUPO_B)).some((l) => /^1\. /.test(l)), menuDe(GRUPO_B))

check('"não" desliga a numeração', resposta(GRUPO_A, '/numerar não', 'menu-numerar') === 'Numeração trocada.' &&
  !linhas(menuDe(GRUPO_A)).some((l) => /^1\. /.test(l)), menuDe(GRUPO_A))
check('sem argumento, explica como usar', resposta(GRUPO_A, '/numerar', 'menu-numerar') === 'Escreva sim ou não.')
check('argumento que não é sim nem não é recusado sem gravar', resposta(GRUPO_A, '/numerar talvez', 'menu-numerar').includes('sim ou não') &&
  !linhas(menuDe(GRUPO_A)).some((l) => /^1\. /.test(l)))
check('quem não é dono nem aciona o comando', resposta(GRUPO_A, '/numerar sim', 'menu-numerar', PRIVADO) === undefined &&
  !linhas(menuDe(GRUPO_A)).some((l) => /^1\. /.test(l)))

check('lerNumeracao entende sim/não com e sem acento', lerNumeracao('Sim') === true && lerNumeracao('nao') === false && lerNumeracao('NÃO') === false && lerNumeracao('talvez') === null)

// --- famílias por conversa -------------------------------------------------
check('o dono escolhe as famílias', resposta(GRUPO_A, '/familias Utilitários', 'menu-familias') === 'Famílias trocadas.')
const soUtilitarios = menuDe(GRUPO_A)
check('o menu passa a esconder a família de fora', !soUtilitarios.includes('/preco') && soUtilitarios.includes('/menu'), soUtilitarios)
resposta(GRUPO_A, '/familias todas', 'menu-familias')
check('"todas" desfaz a restrição', menuDe(GRUPO_A).includes('/preco'), menuDe(GRUPO_A))

// --- padrão de todos os grupos ---------------------------------------------
check('o dono troca o cabeçalho de todos os grupos de dentro de um grupo',
  resposta(GRUPO_B, '/cabgrupos Comandos do grupo:', 'menu-cab-grupos') === 'Cabeçalho de todos os grupos trocado.')
check('vale no grupo B', menuDe(GRUPO_B).startsWith('Comandos do grupo:'), linhas(menuDe(GRUPO_B))[0])
check('e no grupo A também (ele não tem cabeçalho próprio)', menuDe(GRUPO_A).startsWith('Comandos do grupo:'), linhas(menuDe(GRUPO_A))[0])
check('o privado não foi afetado', menuDe(PRIVADO).startsWith('Comandos disponíveis:'), linhas(menuDe(PRIVADO))[0])

// --- padrão de todo o privado, usado de dentro de um grupo ------------------
resposta(GRUPO_A, '/numprivado sim', 'menu-num-privado')
check('numerar todo o privado vale no privado', linhas(menuDe(PRIVADO)).some((l) => /^1\. /.test(l)), menuDe(PRIVADO))
check('e não nos grupos', !linhas(menuDe(GRUPO_B)).some((l) => /^1\. /.test(l)))

// --- voltar ao padrão --------------------------------------------------------
resposta(GRUPO_A, '/numerar sim', 'menu-numerar')
resposta(GRUPO_A, '/configmenu Cabeçalho só do A:', 'config-menu')
check('antes de voltar: o A tem cabeçalho próprio e numeração', menuDe(GRUPO_A).startsWith('Cabeçalho só do A:') && linhas(menuDe(GRUPO_A)).some((l) => /^1\. /.test(l)), menuDe(GRUPO_A))
check('voltar ao padrão não precisa de texto', resposta(GRUPO_A, '/menupadrao', 'menu-voltar') === 'Menu desta conversa voltou ao padrão.')
check('o A volta a herdar o cabeçalho de todos os grupos', menuDe(GRUPO_A).startsWith('Comandos do grupo:'), linhas(menuDe(GRUPO_A))[0])
check('e a numeração própria sumiu junto', !linhas(menuDe(GRUPO_A)).some((l) => /^1\. /.test(l)))
check('o padrão de todos os grupos continua lá', menuDe(GRUPO_B).startsWith('Comandos do grupo:'))
const linhaGravada = db.prepare("SELECT COUNT(*) AS t FROM entity_attributes WHERE scope_kind = 'group' AND scope_id = ? AND key = '__menu_config__'").get(GRUPO_A)
check('a linha da conversa saiu do banco (apagar, não gravar vazio)', linhaGravada.t === 0)

// --- funções puras do comando ----------------------------------------------
check('valorDoComando: "herdar" tira o campo, em qualquer campo', ['header', 'format', 'numbered', 'families'].every((c) => valorDoComando(c, 'Herdar').herdar === true))
check('valorDoComando: "em branco" grava vazio nos textos', valorDoComando('footer', 'em branco').valor === '' && valorDoComando('emptyText', 'Em Branco').valor === '')
check('valorDoComando: aspas vazias também gravam vazio', valorDoComando('header', '""').valor === '' && valorDoComando('header', '“”').valor === '')
check('valorDoComando: entre aspas grava a palavra literal', valorDoComando('header', '"herdar"').valor === 'herdar' && valorDoComando('footer', '"em branco"').valor === 'em branco')
check('valorDoComando: texto comum vai como foi escrito', valorDoComando('header', 'Olá, turma!').valor === 'Olá, turma!')
check('valorDoComando: formato errado vira erro, não gravação', typeof valorDoComando('format', 'talvez').erro === 'string')
check('lerFormato entende português e os códigos', lerFormato('texto') === 'text' && lerFormato('Com Botões') === 'interactive' && lerFormato('com botoes') === 'interactive' &&
  lerFormato('text') === 'text' && lerFormato('interactive') === 'interactive' && lerFormato('talvez') === null)
check('alvoDaConversa: número vira contato', alvoDaConversa('+55 11 90000-0021'.replace(/\s/g, ''))?.scopeId === PRIVADO && alvoDaConversa('5511900000021')?.scopeKind === 'contact')
check('alvoDaConversa: id de grupo vira grupo', alvoDaConversa(GRUPO_A)?.scopeKind === 'group' && alvoDaConversa('1234@lid')?.scopeKind === 'contact')
check('alvoDaConversa: texto ou número curto é recusado', alvoDaConversa('fulano') === null && alvoDaConversa('1234') === null && alvoDaConversa('') === null)
check('usoDoCampo muda conforme o campo', usoDoCampo('footer').includes('rodapé') && usoDoCampo('format').includes('com botões') &&
  usoDoCampo('footer').includes('em branco') && !usoDoCampo('format').includes('em branco') && usoDoCampo('header', true).includes('número ou o id'))

// --- herdar UM campo, sem apagar os outros -----------------------------------
const linhaDoA = () => db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind = 'group' AND scope_id = ? AND key = '__menu_config__'").get(GRUPO_A)
resposta(GRUPO_A, '/configmenu Cabeçalho do A:', 'config-menu')
check('o rodapé se grava pelo comando', resposta(GRUPO_A, '/rodape Rodapé do A', 'menu-rodape') === 'Menu atualizado.')
check('o A tem cabeçalho e rodapé próprios', menuDe(GRUPO_A).startsWith('Cabeçalho do A:') && menuDe(GRUPO_A).includes('Rodapé do A'), menuDe(GRUPO_A))
check('"herdar" no cabeçalho responde a confirmação', resposta(GRUPO_A, '/configmenu herdar', 'config-menu') === 'Menu atualizado.')
check('o cabeçalho volta a seguir o de todos os grupos', menuDe(GRUPO_A).startsWith('Comandos do grupo:'), linhas(menuDe(GRUPO_A))[0])
check('e o rodapé próprio continua (só um campo saiu)', menuDe(GRUPO_A).includes('Rodapé do A'), menuDe(GRUPO_A))
check('no banco ficou só o rodapé', mesmo(JSON.parse(linhaDoA()?.value_json || 'null'), { footer: 'Rodapé do A' }), linhaDoA()?.value_json)
resposta(GRUPO_A, '/rodape herdar', 'menu-rodape')
check('herdando o último campo, a linha sai do banco (não fica {} vazio)', linhaDoA() === undefined)

// --- em branco ---------------------------------------------------------------
//
// O template config-menu v2 escolhe o campo e onde vale. Aqui ele vira um
// rodapé de TODOS os grupos — antes, o template só sabia o cabeçalho da
// conversa.
await api.resolver('POST', '/templates/config-menu/install', ctx({
  scope: { include: [{ kind: 'everywhere' }] },
  automationIds: { 'config-menu': 'rodape-grupos' },
  parameters: { 'config-menu': { poolId: 'p1', command: '/rodapegrupos', campo: 'footer', ondeVale: 'group_default' } }
}))
const docDoTemplate = db.prepare("SELECT r.doc_json FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id WHERE a.id = 'rodape-grupos'").get()
const configDoTemplate = JSON.parse(docDoTemplate?.doc_json || '{}').flow?.nodes?.find((n) => n.type === 'action.menu.config')?.config || {}
check('template v2: instala com campo e onde vale escolhidos', configDoTemplate.field === 'footer' && configDoTemplate.target === 'group_default', JSON.stringify(configDoTemplate))
check('template v2: sem "como usar" fixo, o motor explica pelo campo', configDoTemplate.usageText === undefined && resposta(GRUPO_B, '/rodapegrupos', 'rodape-grupos') === usoDoCampo('footer'))
check('template v2: o rodapé de todos os grupos é gravado', resposta(GRUPO_B, '/rodapegrupos Rodapé dos grupos', 'rodape-grupos') === 'Menu atualizado.' &&
  menuDe(GRUPO_A).includes('Rodapé dos grupos') && menuDe(GRUPO_B).includes('Rodapé dos grupos'))
check('"em branco" tira o rodapé só do A, apesar do padrão', resposta(GRUPO_A, '/rodape em branco', 'menu-rodape') === 'Menu atualizado.' &&
  !menuDe(GRUPO_A).includes('Rodapé dos grupos') && menuDe(GRUPO_B).includes('Rodapé dos grupos'), menuDe(GRUPO_A))
check('no banco é um vazio guardado, não ausência', mesmo(JSON.parse(linhaDoA()?.value_json || 'null'), { footer: '' }), linhaDoA()?.value_json)
check('entre aspas grava a palavra "herdar" como texto', resposta(GRUPO_A, '/rodape "herdar"', 'menu-rodape') === 'Menu atualizado.' && linhas(menuDe(GRUPO_A)).includes('herdar'), menuDe(GRUPO_A))
resposta(GRUPO_A, '/rodape herdar', 'menu-rodape')
check('herdar volta ao rodapé de todos os grupos', menuDe(GRUPO_A).includes('Rodapé dos grupos'), menuDe(GRUPO_A))

// Texto de vazio em branco = /menu mudo (sem comando visível).
resposta(GRUPO_B, '/familias nenhuma-familia', 'menu-familias')
check('sem comando visível, sai o texto de vazio padrão', menuDe(GRUPO_B) === 'Nenhum comando disponível por aqui ainda.', menuDe(GRUPO_B))
resposta(GRUPO_B, '/vazio em branco', 'menu-vazio')
const mudo = avaliarEvento(db, evento(GRUPO_B, PRIVADO, '/menu')).results.find((r) => r.automationId === 'menu')
check('texto de vazio em branco: o /menu fica mudo, sem mensagem vazia', mudo && (mudo.commands || []).length === 0, JSON.stringify(mudo?.commands))
resposta(GRUPO_B, '/vazio herdar', 'menu-vazio')
check('herdar devolve o texto de vazio padrão', menuDe(GRUPO_B) === 'Nenhum comando disponível por aqui ainda.', menuDe(GRUPO_B))
check('o texto de vazio explica o próprio campo', resposta(GRUPO_B, '/vazio', 'menu-vazio') === usoDoCampo('emptyText'))

// --- famílias: "todas" é diferente de herdar --------------------------------
await api.resolver('PUT', '/menu-config/group_default', ctx({ header: 'Comandos do grupo:', footer: 'Rodapé dos grupos', families: ['utilitarios'] }))
resposta(GRUPO_B, '/familias todas', 'menu-familias')
check('"todas" no grupo desfaz a restrição do padrão dos grupos', menuDe(GRUPO_B).includes('/preco'), menuDe(GRUPO_B))
resposta(GRUPO_B, '/familias herdar', 'menu-familias')
check('"herdar" volta a seguir o padrão dos grupos (que esconde vendas)', !menuDe(GRUPO_B).includes('/preco') && menuDe(GRUPO_B).includes('/menu'), menuDe(GRUPO_B))
await api.resolver('PUT', '/menu-config/group_default', ctx({ header: 'Comandos do grupo:', footer: 'Rodapé dos grupos' }))
check('sem restrição no padrão, o grupo B mostra tudo de novo', menuDe(GRUPO_B).includes('/preco'), menuDe(GRUPO_B))

// --- formato por palavra -----------------------------------------------------
const primeiroComandoDoMenu = (chatId) => avaliarEvento(db, evento(chatId, PRIVADO, '/menu')).results.find((r) => r.automationId === 'menu')?.commands?.[0]
check('"com botões" liga o formato interativo', resposta(GRUPO_A, '/formato com botões', 'menu-formato') === 'Menu atualizado.' &&
  primeiroComandoDoMenu(GRUPO_A)?.commandType === 'whatsapp.menu')
check('"texto" volta ao formato de texto', resposta(GRUPO_A, '/formato texto', 'menu-formato') === 'Menu atualizado.' &&
  primeiroComandoDoMenu(GRUPO_A)?.commandType === 'whatsapp.reply')
check('formato desconhecido é recusado sem gravar', resposta(GRUPO_A, '/formato talvez', 'menu-formato').includes('com botões') &&
  primeiroComandoDoMenu(GRUPO_A)?.commandType === 'whatsapp.reply')
check('formato sem nada explica as palavras', resposta(GRUPO_A, '/formato', 'menu-formato') === usoDoCampo('format'))

// --- outra conversa ----------------------------------------------------------
//
// O dono, no privado com o bot, configura o privado de um cliente e um grupo
// — sem nada ser enviado nessas conversas.
const doDono = (texto, automacao) => avaliarEvento(db, evento(DONO, DONO, texto)).results.find((r) => r.automationId === automacao)?.commands || []
const pelonumero = doDono('/menuremoto 5511900000021 Olá, cliente:', 'menu-remoto')
check('pelo número: confirma ao dono', pelonumero.length === 1 && pelonumero[0].payload.text === 'Cabeçalho da outra conversa trocado.')
check('e a resposta vai só para o privado do dono', pelonumero.every((c) => c.payload.chatId === DONO))
check('o privado do cliente passa a ter o cabeçalho', menuDe(PRIVADO).startsWith('Olá, cliente:'), linhas(menuDe(PRIVADO))[0])
doDono(`/menuremoto ${GRUPO_B} Menu do grupo B:`, 'menu-remoto')
check('pelo id do grupo: o grupo B muda', menuDe(GRUPO_B).startsWith('Menu do grupo B:'), linhas(menuDe(GRUPO_B))[0])
check('e o grupo A, não', menuDe(GRUPO_A).startsWith('Comandos do grupo:'))
check('sem o número, explica o que escrever', doDono('/menuremoto', 'menu-remoto')[0]?.payload.text === usoDoCampo('header', true))
check('endereço inválido explica e não grava', doDono('/menuremoto fulano Oi', 'menu-remoto')[0]?.payload.text === usoDoCampo('header', true) &&
  !db.prepare("SELECT 1 FROM entity_attributes WHERE scope_id LIKE 'fulano%'").get())
check('herdar também funciona em outra conversa', doDono('/menuremoto 5511900000021 herdar', 'menu-remoto').length === 1 &&
  menuDe(PRIVADO).startsWith('Comandos disponíveis:'), linhas(menuDe(PRIVADO))[0])

// Linha órfã: um grupo de onde o bot já saiu. O comando com outra conversa
// apaga sem precisar estar lá.
const ORFAO = '120000000000000099@g.us'
doDono(`/menuremoto ${ORFAO} Grupo antigo:`, 'menu-remoto')
const linhaOrfa = () => db.prepare("SELECT 1 AS ok FROM entity_attributes WHERE scope_kind = 'group' AND scope_id = ? AND key = '__menu_config__'").get(ORFAO)
check('a linha do grupo antigo existe', Boolean(linhaOrfa()))
check('volta ao padrão sem endereço explica', doDono('/remotopadrao', 'menu-remoto-padrao')[0]?.payload.text === usoDoCampo('reset', true))
check('volta ao padrão de outra conversa apaga a linha órfã', doDono(`/remotopadrao ${ORFAO}`, 'menu-remoto-padrao')[0]?.payload.text === 'Menu de volta ao padrão.' && !linhaOrfa())

// --- o painel: ver e apagar ---------------------------------------------------
const ctxQ = (q) => ({ body: null, query: new URLSearchParams(q), req: { headers: {} } })
resposta(GRUPO_A, '/numerar sim', 'menu-numerar')
const efetivo = await api.resolver('GET', '/menu-config/effective', ctxQ({ chatId: GRUPO_A, chatKind: 'group' }))
// O formato "texto" gravado acima também é configuração própria do A.
check('o painel vê a configuração própria da conversa', mesmo(efetivo?.propria, { format: 'text', numbered: true }), JSON.stringify(efetivo?.propria))
check('e o padrão do tipo de conversa', efetivo?.padraoDoTipo?.header === 'Comandos do grupo:', JSON.stringify(efetivo?.padraoDoTipo))
const doMenu = (efetivo?.menus || []).find((m) => m.automationId === 'menu')
check('e o menu como sai, já com a cascata', doMenu?.config?.numbered === true && doMenu?.config?.header === 'Comandos do grupo:' && doMenu?.config?.footer === 'Rodapé dos grupos', JSON.stringify(efetivo?.menus))
doDono(`/menuremoto ${ORFAO} Outra vez:`, 'menu-remoto')
const apagado = await api.resolver('DELETE', '/menu-config/group', ctxQ({ id: ORFAO }))
check('o painel apaga a configuração de uma conversa onde o bot não está', apagado?.removed === true && !linhaOrfa())

// Cada menu traz o que o documento define, para a tela dizer "do comando de
// menu" sem adivinhar; e o grupo diz se o bot está ativo nele.
check('cada menu traz o que o documento define', doMenu && typeof doMenu.doDocumento === 'object' && !Object.hasOwn(doMenu.doDocumento, 'footer'), JSON.stringify(doMenu?.doDocumento))
check('grupo ativo aparece como ativo', efetivo?.grupoAtivo === true)
const inativo = await api.resolver('GET', '/menu-config/effective', ctxQ({ chatId: '120000000000000077@g.us', chatKind: 'group' }))
check('grupo onde o bot não foi ativado aparece como inativo', inativo?.grupoAtivo === false)
const efetivoDoPrivado = async () => api.resolver('GET', '/menu-config/effective', ctxQ({ chatId: PRIVADO, chatKind: 'direct' }))
check('privado conta sempre como ativo', (await efetivoDoPrivado())?.grupoAtivo === true)

// "Como sai aqui" só mostra menu que RESPONDE na conversa. Um /menub com
// escopo só no grupo B não pode aparecer no grupo A — lá ele não responde.
await publicarAoVivo(compilar(`automação menu-so-b
  revisão: 1
  nome: Menu só do B
  tipo: comando
  dispara com: /menub
  menu: não
  pool: p1
  acessa: texto
  casa: exato
  quem: qualquer um
  onde: grupo ${GRUPO_B}

  mostra menu
    cabeçalho: "Só no B:"
`))
const menusEm = async (chatId) => ((await api.resolver('GET', '/menu-config/effective', ctxQ({ chatId, chatKind: 'group' })))?.menus || []).map((m) => m.automationId)
check('o menu com escopo só no B aparece no B', (await menusEm(GRUPO_B)).includes('menu-so-b'), JSON.stringify(await menusEm(GRUPO_B)))
check('e não aparece no A, onde não responde', !(await menusEm(GRUPO_A)).includes('menu-so-b') && (await menusEm(GRUPO_A)).includes('menu'), JSON.stringify(await menusEm(GRUPO_A)))
check('o /menub de fato só responde no B', Boolean(resposta(GRUPO_B, '/menub', 'menu-so-b', PRIVADO)) && !resposta(GRUPO_A, '/menub', 'menu-so-b', PRIVADO))
// Desligado na conversa também some: o mesmo portão do avaliador.
db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?,?,?,?,?)')
  .run('group', GRUPO_B, 'comandos_desligados', JSON.stringify(['menu-so-b']), agora)
check('menu desligado na conversa some da prévia', !(await menusEm(GRUPO_B)).includes('menu-so-b'), JSON.stringify(await menusEm(GRUPO_B)))

// O padrão de todos os grupos aparece no painel e se apaga por ele.
check('antes de apagar, o padrão de todos os grupos existe', Object.keys(efetivo?.padraoDoTipo || {}).length > 0)
const privadoAntes = (await efetivoDoPrivado())?.padraoDoTipo || {}
const apagouPadrao = await api.resolver('DELETE', '/menu-config/group_default', ctxQ({}))
const depoisDoPadrao = await api.resolver('GET', '/menu-config/effective', ctxQ({ chatId: GRUPO_A, chatKind: 'group' }))
check('o painel apaga o padrão de todos os grupos', apagouPadrao?.removed === true && Object.keys(depoisDoPadrao?.padraoDoTipo || {}).length === 0, JSON.stringify(depoisDoPadrao?.padraoDoTipo))
check('e o padrão do privado não foi junto', mesmo((await efetivoDoPrivado())?.padraoDoTipo || {}, privadoAntes), JSON.stringify(privadoAntes))

// Sem `campo:`, o comando muda o CABEÇALHO — e o schema diz isso (default),
// para a referência não mostrar o campo como "sem padrão".
await publicarAoVivo(compilar(fonteDe('menu-sem-campo', '/semcampo', ['onde vale: todos os grupos'])))
resposta(GRUPO_B, '/semcampo sim', 'menu-sem-campo')
const semCampo = await api.resolver('GET', '/menu-config/effective', ctxQ({ chatId: GRUPO_B, chatKind: 'group' }))
check('sem a linha campo, o valor vai para o cabeçalho de todos os grupos', mesmo(semCampo?.padraoDoTipo, { header: 'sim' }), JSON.stringify(semCampo?.padraoDoTipo))
const schemaDoMotor = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const configDoMenu = schemaDoMotor.definitions.actionMenuConfig.properties.config.properties
check('o schema declara cabeçalho como padrão de campo', configDoMenu.field.default === 'header')
check('e "nesta conversa" como padrão de onde vale', configDoMenu.target.default === 'chat')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nMENU PELO COMANDO: TUDO O QUE A ABA FAZIA, PASSOU')
process.exit(falhas ? 1 : 0)
