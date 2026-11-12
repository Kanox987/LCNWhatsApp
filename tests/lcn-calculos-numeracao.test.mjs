// O contrato vai do texto publicado ao comando de saída e ao banco. Conferir
// só a conta isolada deixaria passar o defeito mais caro: calcular certo e
// perder o resultado antes da resposta, da condição ou da retomada.
import assert from 'node:assert/strict'
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento, registrarResultadoExecucao } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { ID_GLOBAL, montarIdMembro } from '../src/engine/server/attributeScopes.js'
import { interpolar } from '../src/engine/server/interpolate.js'
import { carregarCatalogo } from '../src/engine/templates/catalog.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
let checagens = 0
function check (nome, ok, detalhe = '') {
  checagens++
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${!ok && detalhe ? ` (${detalhe})` : ''}`)
}
function igual (nome, atual, esperado) {
  try { assert.deepStrictEqual(atual, esperado); check(nome, true) }
  catch (erro) { check(nome, false, erro.message) }
}

const CHAT = '5511900000001@s.whatsapp.net'
const OUTRO = '5511900000002@s.whatsapp.net'
const GRUPO = '120000000000000001@g.us'
const agora = new Date().toISOString()
const db = abrirBanco(':memory:')
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)
let sequencia = 0
let eventos = 0
function documento (corpo, id = `calculo-${++sequencia}`, extra = '') {
  return compilar(`automação ${id}
  id: ${id}
  revisão: 1
  nome: ${id}
  tipo: comando
  dispara com: /${id}
  argumentos: a / b
  onde: em qualquer lugar
  pool: p
  acessa: texto
  casa: exato ou com argumentos
  quem: qualquer um
${extra ? `  ${extra}\n` : ''}
${corpo.split('\n').map((l) => `  ${l}`).join('\n')}
`)
}
function publicar (doc, modo = 'live') {
  const erros = validarAutomacao(db, doc)
  assert.deepStrictEqual(erros, [], JSON.stringify(erros))
  servico.criarEPublicar({ id: doc.id, document: doc })
  db.prepare('UPDATE automations SET deployment_mode = ?, enabled = 1 WHERE id = ?').run(modo, doc.id)
  return doc
}
function evento (doc, { args = '', chatId = CHAT, senderId = CHAT, mentions } = {}) {
  return {
    provider: 'zapo', accountId: 'conta', eventId: `conta:calculo:${++eventos}`,
    occurredAt: agora, replay: false,
    chat: { id: chatId, kind: chatId.endsWith('@g.us') ? 'group' : 'direct' },
    sender: { id: senderId, authoredBySelf: false },
    message: { kind: 'text', text: `/${doc.id}${args ? ` ${args}` : ''}`, ...(mentions ? { mentions } : {}) },
    providerRef: { provider: 'zapo', id: `m${eventos}` }
  }
}
function rodar (doc, opcoes) {
  return avaliarEvento(db, evento(doc, opcoes)).results.find((r) => r.automationId === doc.id)
}
function executar (corpo, opcoes) {
  const doc = publicar(documento(corpo))
  return { doc, run: rodar(doc, opcoes) }
}
const texto = (run) => run?.commands?.[0]?.payload?.text
const atributo = (kind, id, key) => {
  const row = db.prepare('SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?').get(kind, id, key)
  return row ? JSON.parse(row.value_json) : undefined
}
const gravar = (key, valor) => db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('contact', CHAT, key, JSON.stringify(valor), agora)
const detalhe = (doc) => JSON.parse(db.prepare('SELECT detail_json FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT 1').get(doc.id).detail_json || '{}').message || ''
const comandos = (runId) => db.prepare('SELECT * FROM outbound_commands WHERE run_id = ? ORDER BY rowid').all(runId)

try {
  for (const [expressao, esperado] of [
    ['7 + 5', 12], ['7 - 9', -2], ['-2 * -3', 6], ['5 / 2', 2.5],
    ['2.5 × 4', 10], ['9 ÷ 4', 2.25], ['.5 + +2', 2.5],
    ['1e-7 * 2', 2e-7], ['1 / 3', 1 / 3], ['0.1 + 0.2', 0.1 + 0.2],
    ['0 * -2', 0], ['0 / 2', 0], ['"12.5" * 2', 25]
  ]) {
    const { doc, run } = executar(`calcula local total = ${expressao}\nresponde "{{local.total}}"`)
    igual(`${expressao}: resultado no texto`, texto(run), String(esperado))
    igual(`${expressao}: ida e volta preserva o documento`, compilar(descompilar(doc)), doc)
  }

  const { run: duas } = executar('define chat preco = "12.5"\ndefine chat quantidade = "3"\ncalcula chat total = var chat preco * var chat quantidade\nresponde "{{var.chat.total}}"')
  igual('duas variáveis chegam ao cálculo na mesma execução', texto(duas), '37.5')
  igual('resultado persistente é número no banco, não string', atributo('contact', CHAT, 'total'), 37.5)

  const { run: argumentos } = executar('calcula local total = evento argumentos.a * evento argumentos.b\ncalcula local metade = evento local.total / 2\nse evento local.metade > 10\n  responde "Total {{local.total}}; metade {{local.metade}}"\nsenão\n  responde "menor"', { args: '12.5 / 3' })
  igual('argumentos, cálculo seguinte e condição usam o resultado tipado', texto(argumentos), 'Total 37.5; metade 18.75')
  igual('nenhum escopo local é gravado como atributo', db.prepare("SELECT COUNT(*) AS n FROM entity_attributes WHERE scope_kind = 'local'").get().n, 0)

  for (const [scope, kind, scopeId] of [
    ['sender', 'contact', CHAT], ['global', 'global', ID_GLOBAL], ['category:loja', 'category', 'loja'],
    ['group', 'group', GRUPO], ['group_member', 'group_member', montarIdMembro(GRUPO, CHAT)],
    ['target', 'contact', OUTRO], ['target_group_member', 'group_member', montarIdMembro(GRUPO, OUTRO)]
  ]) {
    db.prepare('INSERT OR REPLACE INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)').run('group', GRUPO, 'grupo_ativo', '"sim"', agora)
    const { doc, run } = executar(`calcula ${scope} resultado = 9 / 4`, { chatId: kind.startsWith('group') ? GRUPO : CHAT, mentions: [OUTRO] })
    igual(`${scope}: executa sem falha`, run.status, 'matched_live')
    igual(`${scope}: grava o decimal no escopo certo`, atributo(kind, scopeId, 'resultado'), 2.25)
    igual(`${scope}: ida e volta`, compilar(descompilar(doc)), doc)
  }
  const { run: categoria } = executar('calcula local dobro = var category:loja resultado * 2\nresponde "{{local.dobro}}"')
  igual('operando de categoria é carregado pelo mesmo resolvedor', texto(categoria), '4.5')

  const local = publicar(documento('se evento message.args == "sim"\n  calcula local exclusivo = 2 + 3\n  responde "{{local.exclusivo}}"\nsenão\n  responde "{{local.exclusivo}}"'))
  igual('resultado local existe na execução que calculou', texto(rodar(local, { args: 'sim' })), '5')
  igual('resultado local não vaza para o evento seguinte', texto(rodar(local)), '{{local.exclusivo}}')
  igual('resultado local não vaza para outra conversa', texto(rodar(local, { chatId: OUTRO })), '{{local.exclusivo}}')
  const sombra = publicar(documento('calcula chat sombra = 2 * 3\nresponde "feito"'), 'shadow')
  igual('sombra continua sem executar ações', rodar(sombra).status, 'matched_shadow')
  igual('sombra não grava cálculo', atributo('contact', CHAT, 'sombra'), undefined)

  for (const [nome, valor] of [
    ['booleano', true], ['false', false], ['null', null], ['vazio', ''], ['espaços', '  '],
    ['texto', 'abc'], ['hexadecimal', '0x10'], ['objeto', {}], ['array', [2]],
    ['infinito', 'Infinity'], ['NaN', 'NaN'], ['inteiro inseguro', '9007199254740993'],
    ['pequeno demais', '1e-999']
  ]) {
    gravar('ruim', valor)
    const { doc, run } = executar('calcula local valor = var chat ruim + 1\nresponde "não pode chegar"')
    igual(`${nome}: falha explícita`, run.status, 'error')
    check(`${nome}: motivo aparece em Execuções`, /número|numérico|booleano|representad/.test(detalhe(doc)), detalhe(doc))
    igual(`${nome}: nenhum comando parcial sai`, run.commands.length, 0)
  }
  for (const [expr, motivo] of [
    ['var chat inexistente + 1', /ausente/], ['1 / 0', /zero/], ['1 / -0', /zero/],
    ['9007199254740991 * 2', /segura/], ['1e-300 * 1e-100', /pequeno/],
    ['1e-300 / 9007199254740991', /./]
  ]) {
    const { doc, run } = executar(`calcula local valor = ${expr}\nresponde "{{local.valor}}"`)
    if (expr === '1e-300 / 9007199254740991') {
      igual('decimal subnormal representável continua permitido', run.status, 'matched_live')
    } else {
      igual(`${expr}: para com erro`, run.status, 'error')
      check(`${expr}: motivo específico`, motivo.test(detalhe(doc)), detalhe(doc))
    }
  }
  const { doc: rollback, run: falhou } = executar('define chat nao_gravar = "alterado"\nresponde "não enviar"\ncalcula chat nao_gravar = 1 / 0')
  igual('falha desfaz a gravação anterior', atributo('contact', CHAT, 'nao_gravar'), undefined)
  igual('falha descarta inclusive resposta anterior ao cálculo', falhou.commands.length, 0)
  check('rollback guarda motivo de divisão por zero', /zero/.test(detalhe(rollback)))
  const { doc: semAlvo, run: alvoInvalido } = executar('calcula target total = 1 + 2')
  igual('destino inexistente não é ignorado em silêncio', alvoInvalido.status, 'error')
  check('destino inexistente explica o erro', /destino.*não existe/.test(detalhe(semAlvo)))

  for (const corpo of [
    'calcula local total = 1 + 2 * 3', 'calcula local total = (1 + 2)',
    'calcula local total = 1 ** 2', 'calcula local total = true + 2',
    'calcula local total = "abc" + 2', 'calcula local total = 1e309 + 1',
    'calcula local total = 1e-999 + 1', 'calcula local total = 9007199254740993 + 1',
    'calcula local total = {{message.args}} + 1', 'calcula local total = 1 + 2\n  arredonda: sim',
    'responde "x"\n  numeração: talvez'
  ]) {
    let erro
    try { documento(corpo) } catch (e) { erro = e }
    check(`sintaxe recusa ${corpo.split('\n')[0]}`, erro instanceof ErroDeSintaxe && erro.linha > 0, erro?.message)
  }
  const valido = documento('calcula local total = 2 * 3')
  const mudar = (fn) => { const d = structuredClone(valido); fn(d.flow.nodes[1].config); return validarAutomacao(d) }
  for (const [nome, fn] of [
    ['operação desconhecida', (c) => { c.operator = 'eval' }],
    ['operando booleano', (c) => { c.left.value = true }],
    ['operando vazio', (c) => { c.left.value = '' }],
    ['categoria sem nome', (c) => { c.scope = 'category' }],
    ['categoria em local', (c) => { c.categoryKey = 'loja' }],
    ['categoria ausente no operando', (c) => { c.left = { source: 'variable', scope: 'category', key: 'x' } }],
    ['nome local com ponto', (c) => { c.key = 'a.b' }],
    ['chave reservada', (c) => { c.key = '__owner__' }],
    ['campo esquecido', (c) => { delete c.right }]
  ]) check(`schema recusa ${nome}`, mudar(fn).length > 0)
  igual('interpolação continua troca pura, sem executar expressão', interpolar('{{local.a * 2}}', { local: { a: 3 } }), '{{local.a * 2}}')

  gravar('lista', 'Maçã\n\nPão\r\nÁgua')
  const { run: lista } = executar('responde "{{var.chat.lista}}"\n  numeração: sim')
  igual('numeração ocorre depois de montar o texto e ignora linhas vazias', texto(lista), '1. Maçã\n\n2. Pão\n3. Água')
  igual('a variável que forneceu a lista não é alterada', atributo('contact', CHAT, 'lista'), 'Maçã\n\nPão\r\nÁgua')
  for (const campo of ['', '\n  numeração: não']) {
    igual('sem numeração preserva o texto exatamente', texto(executar(`responde "{{var.chat.lista}}"${campo}`).run), 'Maçã\n\nPão\r\nÁgua')
  }
  igual('lista vazia não inventa item', texto(executar('responde "\\n\\n"\n  numeração: sim').run), '\n\n')
  gravar('lista', Array.from({ length: 1200 }, (_, i) => `item ${i}`).join('\n'))
  const grande = texto(executar('responde "{{var.chat.lista}}"\n  numeração: sim').run)
  check('numeração não tem teto de itens no código', grande.endsWith('1200. item 1199'))

  // Pausa real no motor, seguida da confirmação: o gateway não é necessário
  // para provar o transporte do contexto e o rollback da parte retomada.
  db.prepare('INSERT INTO connections (id, kind, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('busca', 'http', JSON.stringify({
    endereco: 'http://127.0.0.1:8767', autenticacao: { tipo: 'nenhuma' },
    funcoes: [{ nome: 'buscar', metodo: 'GET', caminho: '/', entradas: [], resposta: { forma: 'texto', campo: 'texto' } }]
  }), agora, agora)
  const { doc: cadeia, run: esperando } = executar('calcula local total = 5 * 3\nchama busca.buscar\ncalcula local metade = evento local.total / 2\nresponde "{{resultado.texto}}\\nTotal {{local.total}}; metade {{local.metade}}"\n  numeração: sim')
  igual('chamada recebe os resultados locais da própria execução', esperando.commands[0].payload.locais, { total: 15 })
  registrarResultadoExecucao(db, esperando.commands[0].id, { status: 'sent', resultado: { texto: 'resultado A\nresultado B' } })
  const runCadeia = db.prepare('SELECT id FROM automation_runs WHERE automation_id = ?').get(cadeia.id).id
  const saidas = comandos(runCadeia)
  igual('retomada usa cálculo anterior e numera a resposta de busca', JSON.parse(saidas[1].payload_json).text, '1. resultado A\n2. resultado B\n3. Total 15; metade 7.5')
  registrarResultadoExecucao(db, esperando.commands[0].id, { status: 'sent', resultado: { texto: 'duplicado' } })
  igual('confirmação repetida não duplica cálculo nem resposta', comandos(runCadeia).length, 2)
  const { doc: ruimDepois, run: aguarda } = executar('chama busca.buscar\ndefine chat depois = "não ficar"\ncalcula local total = 4 / 0')
  registrarResultadoExecucao(db, aguarda.commands[0].id, { status: 'sent', resultado: { texto: 'ok' } })
  igual('erro no cálculo retomado desfaz gravações dessa continuação', atributo('contact', CHAT, 'depois'), undefined)
  check('erro retomado aparece no histórico', /zero/.test(detalhe(ruimDepois)))

  // Só dois comandos visíveis, para conferir ordem, filtro e IDs de escolha.
  // Comando sem família não entra no menu, então os dois moram em "testes".
  db.prepare('UPDATE automations SET enabled = 0').run()
  const a = publicar(documento('responde "A"', 'alfa', 'família: testes'))
  const b = publicar(documento('responde "B"', 'beta', 'família: testes'))
  const oculto = publicar(documento('responde "oculto"', 'oculto'))
  db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run(oculto.id)
  for (const formato of ['texto', 'com botões']) {
    // `menu: não` é como este menu sai da própria lista — a única forma, e a
    // mesma que o /menu instalado usa quando o dono não quer vê-lo ali. Antes
    // isto era `native = 1`, privilégio que o motor não tem mais.
    const doc = publicar(documento(`mostra menu\n  formato: ${formato}\n  numeração: sim\n  cabeçalho: "Escolha"\n  rodapé: "Fim"`, undefined, 'menu: não'))
    const ev = evento(doc)
    const rev = db.prepare('SELECT active_revision_id AS id FROM automations WHERE id = ?').get(doc.id).id
    const r = avaliarEvento(db, ev).results.find((x) => x.automationId === doc.id)
    const p = r.commands[0].payload
    igual(`${formato}: cabeçalho e rodapé ficam fora da numeração`, p.fallbackText || p.text, 'Escolha\n\n*Testes*\n1. /alfa\n2. /beta\n\nFim')
    if (formato === 'com botões') igual('menu numera rótulos preservando IDs', p.items, [
      { id: '/alfa', label: '1. /alfa', description: '', family: 'Testes' }, { id: '/beta', label: '2. /beta', description: '', family: 'Testes' }
    ])
    check('menu conserva a revisão publicada', rev > 0)
    db.prepare('UPDATE automations SET enabled = 0 WHERE id = ?').run(doc.id)
  }
  db.prepare('UPDATE automations SET enabled = 0 WHERE id IN (?, ?)').run(a.id, b.id)
  const vazio = publicar(documento('mostra menu\n  numeração: sim\n  vazio: "Sem itens"', undefined, 'menu: não'))
  igual('menu vazio não ganha número', texto(rodar(vazio)), 'Sem itens')

  const catalogo = carregarCatalogo()
  for (const id of ['calcular-total', 'lista-numerada', 'menu']) {
    const t = catalogo.get(id)
    check(`${id}: template está no catálogo`, !!t)
    const d = renderizarTemplate(t, { poolId: 'p', numerar: false })
    d.id = id; d.revision = 1
    igual(`${id}: template renderizado passa no schema`, validarAutomacao(db, d), [])
    igual(`${id}: template inteiro faz ida e volta`, compilar(descompilar(t.documentTemplate, t)).documentTemplate, t.documentTemplate)
    if (id !== 'calcular-total') igual(`${id}: parâmetro booleano falso é preservado`, d.flow.nodes[1].config.numbered, false)
  }
  const t = compilar(`template calculo-parametrizado v1
  nome: Cálculo parametrizado
  descrição: Confere o parâmetro numérico sem convertê-lo em texto.
  categoria: utilitarios

automação
  nome: Cálculo
  tipo: comando
  dispara com: /teste
  casa: exato
  quem: qualquer um
  onde: em qualquer lugar
  pool: p
  acessa: texto

  calcula local total = {{params.fator}} * 2
  responde "{{local.total}}"

configurável
  fator: número = 2.5
    rótulo: Fator
`)
  const template = { ...t.template, documentTemplate: t.documentTemplate }
  igual('operando parametrizado preserva tipo e faz ida e volta', compilar(descompilar(t.documentTemplate, template)), t)
  igual('parâmetro numérico renderiza um número no operando', renderizarTemplate(template, {}).flow.nodes[1].config.left.value, 2.5)
} catch (erro) {
  check('execução dos casos sem erro inesperado', false, erro.stack)
} finally {
  db.close()
}
console.log(`\n${checagens} checagens, ${falhas} falhas`)
process.exitCode = falhas ? 1 : 0
