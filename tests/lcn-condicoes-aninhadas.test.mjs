// O que importa é a decisão publicada: cada caminho faz seus efeitos uma
// vez e reencontra a continuação, inclusive depois de uma chamada que dorme.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { PROFUNDIDADE_CONDICOES_PADRAO, BLOCOS_DE_CONDICAO } from '../src/lcn/vocabulario.js'
import { montarReferencia } from '../src/lcn/referencia.js'
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento, registrarResultadoExecucao } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { validarAutomacao } from '../src/engine/server/validate.js'
import { obterCapacidadesRuntime } from '../src/engine/server/runtimeCapabilities.js'

let checagens = 0
let falhas = 0
function teste (nome, fn) {
  checagens++
  try { fn(); console.log(`✅ ${nome}`) }
  catch (erro) { falhas++; console.error(`❌ ${nome}: ${erro.message}`) }
}
const igual = (nome, a, b) => teste(nome, () => assert.deepStrictEqual(a, b))
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)
let sequencia = 0
let eventos = 0
function fonte (corpo, id = `condicao-${++sequencia}`) {
  return `automação ${id}\n  revisão: 1\n  nome: ${id}\n  tipo: comando\n  dispara com: /${id}\n  onde: em qualquer lugar\n  pool: p\n  acessa: texto\n  casa: exato ou com argumentos\n  quem: qualquer um\n\n${corpo.split('\n').map((l) => `  ${l}`).join('\n')}\n`
}
function documento (corpo, opcoes) { return compilar(fonte(corpo), opcoes) }
function publicar (doc) {
  assert.deepStrictEqual(validarAutomacao(db, doc), [])
  servico.criarEPublicar({ id: doc.id, document: doc })
  db.prepare("UPDATE automations SET deployment_mode = 'live', enabled = 1 WHERE id = ?").run(doc.id)
  return doc
}
function rodar (doc, args = '') {
  const chat = '5511900000001@s.whatsapp.net'
  const r = avaliarEvento(db, {
    provider: 'zapo', accountId: 'conta', eventId: `conta:condicao:${++eventos}`,
    occurredAt: agora, replay: false, chat: { id: chat, kind: 'direct' },
    sender: { id: chat, authoredBySelf: false },
    message: { kind: 'text', text: `/${doc.id}${args ? ` ${args}` : ''}` },
    providerRef: { provider: 'zapo', id: `m${eventos}` }
  }).results.find((r) => r.automationId === doc.id)
  assert.equal(r.status, 'matched_live')
  return r
}
const textos = (doc, args) => rodar(doc, args).commands.map((c) => c.payload.text)
function volta (nome, doc, opcoes) {
  teste(`${nome}: documento idêntico na ida e volta`, () => assert.deepStrictEqual(compilar(descompilar(doc), opcoes), doc))
  teste(`${nome}: texto idêntico na segunda ida e volta`, () => {
    const texto = descompilar(doc)
    assert.equal(descompilar(compilar(texto, opcoes)), texto)
  })
  teste(`${nome}: todas as arestas avançam na ordem da escrita`, () => {
    const ordem = new Map(doc.flow.nodes.map((n, i) => [n.id, i]))
    assert.ok(doc.flow.edges.every((e) => ordem.get(e.from) < ordem.get(e.to)))
  })
}

try {
  const sequenciais = publicar(documento(`responde "início"
se evento message.args contém "a"
  responde "A"
senão
  responde "não A"
responde "entre"
se evento message.args contém "b"
  responde "B"
senão
  responde "não B"
soma chat encontros = 1
responde "fim"`))
  for (const args of ['', 'a', 'b', 'ab']) {
    igual(`duas decisões independentes (${args || 'nenhuma'}) e continuação única`, textos(sequenciais, args),
      ['início', args.includes('a') ? 'A' : 'não A', 'entre', args.includes('b') ? 'B' : 'não B', 'fim'])
  }
  igual('efeito comum ocorre uma vez por execução', JSON.parse(db.prepare("SELECT value_json FROM entity_attributes WHERE key = 'encontros'").get().value_json), 4)
  volta('condições sequenciais', sequenciais)

  const aninhada = publicar(documento(`se evento message.args contém "a"
  responde "entrou A"
  se evento message.args contém "b"
    responde "AB"
  senão
    responde "A sem B"
  responde "fim A"
senão
  se evento message.args contém "c"
    responde "C"
  senão
    responde "sem A nem C"
  responde "fim falso"
responde "fim geral"`))
  for (const args of ['', 'a', 'b', 'c', 'ab', 'ac', 'bc', 'abc']) {
    igual(`aninhamento nos dois ramos (${args || 'nenhuma'})`, textos(aninhada, args), args.includes('a')
      ? ['entrou A', args.includes('b') ? 'AB' : 'A sem B', 'fim A', 'fim geral']
      : [args.includes('c') ? 'C' : 'sem A nem C', 'fim falso', 'fim geral'])
  }
  volta('aninhamento nos dois ramos', aninhada)

  const corpoEscolha = `se evento message.args contém "a"
  responde "A"
senão se evento message.args contém "b"
  se evento message.args contém "x"
    responde "BX"
  senão
    responde "B"
senão se evento message.args contém "c"
  responde "C"
senão
  responde "nenhuma"
responde "fim"`
  const escolha = publicar(documento(corpoEscolha))
  for (const [args, esperado] of [['ab', 'A'], ['bc', 'B'], ['bxc', 'BX'], ['c', 'C'], ['', 'nenhuma']]) {
    igual(`senão se escolhe só a primeira alternativa (${args || 'nenhuma'})`, textos(escolha, args), [esperado, 'fim'])
  }
  volta('cadeia de senão se', escolha)
  teste('a escrita de senão se e a indentação voltam literalmente iguais', () => {
    const x = fonte(corpoEscolha, escolha.id) + `\n# nós: ${escolha.flow.nodes.map((n) => n.id).join(', ')}\n`
    assert.equal(descompilar(compilar(x)), x)
  })
  const expandida = documento('se 1 == 1\n  responde "A"\nsenão\n  se 2 == 2\n    responde "B"\n  senão\n    responde "C"')
  const acucar = documento('se 1 == 1\n  responde "A"\nsenão se 2 == 2\n  responde "B"\nsenão\n  responde "C"')
  igual('açúcar e aninhamento explícito têm os mesmos nós e arestas',
    { nodes: expandida.flow.nodes.slice(1), edges: expandida.flow.edges }, { nodes: acucar.flow.nodes.slice(1), edges: acucar.flow.edges })
  volta('senão com se explicitamente indentado', expandida)
  teste('o descompilador preserva o senão com se indentado', () => assert.match(descompilar(expandida), /  senão\n    se /))

  for (const [nome, corpo, sim, nao] of [
    ['só ramo verdadeiro terminal', 'se evento message.args == "sim"\n  responde "sim"', ['sim'], []],
    ['senão vazio terminal', 'se evento message.args == "sim"\n  responde "sim"\nsenão', ['sim'], []],
    ['só ramo falso terminal', 'se evento message.args == "sim"\nsenão\n  responde "não"', [], ['não']],
    ['só ramo verdadeiro com continuação', 'se evento message.args == "sim"\n  responde "sim"\nresponde "fim"', ['sim', 'fim'], ['fim']],
    ['só ramo falso com continuação', 'se evento message.args == "sim"\nsenão\n  responde "não"\nresponde "fim"', ['fim'], ['não', 'fim']],
    ['senão explicitamente vazio', 'se evento message.args == "sim"\n  se 1 == 1\n    responde "sim"\nsenão\nresponde "fim"', ['sim', 'fim'], ['fim']]
  ]) {
    const doc = publicar(documento(corpo))
    igual(`${nome}: verdadeiro`, textos(doc, 'sim'), sim)
    igual(`${nome}: falso`, textos(doc), nao)
    volta(nome, doc)
  }
  const inativo = publicar(documento('se 1 == 2\n  se 1 == 1\n    calcula local falha = 1 / 0\nresponde "seguiu"'))
  igual('ramo não escolhido nem avalia a condição interna nem calcula', textos(inativo), ['seguiu'])

  for (const [nome, doc] of [['sequenciais', sequenciais], ['aninhada', aninhada], ['alternativas', escolha]]) {
    const semMetadado = structuredClone(doc)
    delete semMetadado.flow.structure
    teste(`${nome}: grafo sem metadado também descompila sem perder arestas`, () => {
      const volta = compilar(descompilar(semMetadado))
      assert.deepStrictEqual(volta.flow.nodes, doc.flow.nodes)
      assert.deepStrictEqual(volta.flow.edges, doc.flow.edges)
    })
  }

  for (const [corpo, motivo] of [
    ['se 1 == 1', /pelo menos um ramo com ação/],
    ['se 1 == 1\nsenão\nresponde "fora"', /pelo menos um ramo com ação/],
    ['se 1 == 1\n  se 2 == 2\nresponde "fora"', /pelo menos um ramo com ação/],
    ['senão\n  responde "solto"', /logo após um "se"/],
    ['senão se 1 == 1\n  responde "solto"', /logo após um "se"/],
    ['se 1 == 1\n  responde "a"\nsenão\n  responde "b"\nsenão\n  responde "c"', /logo após um "se"/],
    ['se 1 == 1\n    responde "saltou nível"', /indentação inesperada/],
    ['responde "a"\n  se 1 == 1\n    responde "b"', /indentada sob uma ação/],
    ['se 1 == 1\n   responde "ímpar"', /dois espaços/],
    ['se 1 == 1\n\tresponde "tab"', /sem tabulação/]
  ]) teste(`erro legível: ${corpo.split('\n')[0]} / ${motivo}`, () => {
    assert.throws(() => documento(corpo), (e) => e instanceof ErroDeSintaxe && e.linha > 0 && motivo.test(e.message))
  })

  const profundo = (n) => [...Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}se 1 == 1`), `${'  '.repeat(n)}responde "fundo"`].join('\n')
  const padrao = PROFUNDIDADE_CONDICOES_PADRAO
  const noLimite = publicar(documento(profundo(padrao)))
  igual('profundidade padrão inteira executa', textos(noLimite), ['fundo'])
  volta('profundidade padrão', noLimite)
  teste('erro de profundidade informa linha, nível atingido, limite e configuração', () => {
    assert.throws(() => documento(profundo(padrao + 1)), (e) => e instanceof ErroDeSintaxe && e.linha > 0 &&
      e.message.includes(`profundidade ${padrao + 1}`) && e.message.includes(`limite é ${padrao}`) && e.message.includes('LCN_MAX_PROFUNDIDADE_CONDICOES'))
  })
  const aumentado = publicar(documento(profundo(padrao * 2), { maxProfundidade: padrao * 2 }))
  igual('configuração pode subir além do padrão, sem teto fixo', textos(aumentado), ['fundo'])
  volta('limite aumentado', aumentado, { maxProfundidade: padrao * 2 })
  teste('senão se também conta na profundidade lógica', () => assert.throws(
    () => documento('se 1 == 1\n  responde "a"\nsenão se 2 == 2\n  responde "b"', { maxProfundidade: 1 }), /profundidade 2; o limite é 1/))
  teste('condições irmãs não acumulam profundidade', () => assert.doesNotThrow(() => documento(
    'se 1 == 1\n  responde "a"\nse 2 == 2\n  responde "b"', { maxProfundidade: 1 })))
  const ambienteAnterior = process.env.LCN_MAX_PROFUNDIDADE_CONDICOES
  try {
    process.env.LCN_MAX_PROFUNDIDADE_CONDICOES = '1'
    teste('variável de ambiente configura as chamadas sem opções do painel', () => assert.throws(() => documento(profundo(2)), /limite é 1/))
    teste('opção explícita prevalece sobre o ambiente', () => assert.doesNotThrow(() => documento(profundo(2), { maxProfundidade: 2 })))
  } finally {
    if (ambienteAnterior === undefined) delete process.env.LCN_MAX_PROFUNDIDADE_CONDICOES
    else process.env.LCN_MAX_PROFUNDIDADE_CONDICOES = ambienteAnterior
  }
  for (const limite of [0, -1, 1.5, NaN, Infinity, 'texto', true, [2]]) teste(`limite inválido ${limite} tem mensagem legível`, () => {
    assert.throws(() => documento('responde "ok"', { maxProfundidade: limite }), /inteiro positivo/)
  })

  const adulterada = structuredClone(aninhada)
  adulterada.flow.structure[0].true = []
  teste('publish valida o metadado contra as arestas', () => assert.ok(validarAutomacao(adulterada).some((e) => e.path === '/flow/structure')))
  teste('editor recusa metadado divergente em vez de mostrar outra regra', () => assert.throws(() => descompilar(adulterada), /estrutura/))
  for (const [nome, alterar] of [
    ['ramo false malformado', (s) => { s[0].false = 'passo' }],
    ['açúcar sem condição', (s) => { s[0].elseIf = true; s[0].false = ['reply'] }],
    ['nó repetido', (s) => { s.push(s[0]) }],
    ['referência inexistente', (s) => { s.push('inexistente') }],
    ['campo desconhecido', (s) => { s[0].surpresa = true }],
    ['dois ramos vazios', (s) => { s[0].true = []; s[0].false = [] }]
  ]) teste(`schema e validador recusam estrutura: ${nome}`, () => {
    const doc = structuredClone(aninhada)
    alterar(doc.flow.structure)
    assert.ok(validarAutomacao(doc).length > 0)
  })
  teste('trocar os ramos sem trocar as arestas é rejeitado', () => {
    const doc = structuredClone(aninhada)
    const s = doc.flow.structure[0]
    ;[s.true, s.false] = [s.false, s.true]
    assert.ok(validarAutomacao(doc).some((e) => /não corresponde às arestas/.test(e.message)))
  })
  const ciclo = documento('se 1 == 1\n  se 2 == 2\n    responde "dentro"\nresponde "fim"')
  ciclo.flow.edges.push({ from: ciclo.flow.nodes.at(-1).id, to: ciclo.flow.nodes[1].id, on: 'success' })
  teste('ciclo inserido num fluxo aninhado é rejeitado pelo validador', () => assert.ok(validarAutomacao(ciclo).some((e) => /ciclo/.test(e.message))))
  teste('serviço real de publicação recusa ciclo no grafo aninhado', () => assert.throws(
    () => servico.criarEPublicar({ id: ciclo.id, document: ciclo }), (e) => e.status === 422 && e.detalhes.some((d) => /ciclo/.test(d.message))))
  delete ciclo.flow.structure
  teste('descompilação de grafo antigo com ciclo termina com erro', () => assert.throws(() => descompilar(ciclo), /ciclo/))

  const anti = compilar(fs.readFileSync(new URL('../src/engine/templates/catalog/anti-silenciado.lcn', import.meta.url), 'utf8'))
  teste('anti-silenciado continua compilando e preservando o ramo falso ausente', () => {
    const condicao = anti.documentTemplate.flow.nodes.find((n) => n.type === 'condition.compare')
    assert.ok(anti.documentTemplate.flow.edges.some((e) => e.from === condicao.id && e.on === 'true'))
    assert.ok(!anti.documentTemplate.flow.edges.some((e) => e.from === condicao.id && e.on === 'false'))
    assert.deepStrictEqual(compilar(descompilar(anti.documentTemplate, anti.template)), anti)
  })
  const caps = obterCapacidadesRuntime()
  igual('capacidades preservam modelo, gatilho e condição já executável',
    [caps.maxTriggers, caps.flowModel, caps.conditions, caps.sourceStructure], [1, 'exclusive_branching_dag', ['condition.compare'], true])
  teste('vocabulário e referência da tela incluem senão se e a profundidade', () => {
    const ref = montarReferencia()
    assert.ok(ref.palavras.estrutura.includes(BLOCOS_DE_CONDICAO.senaoSe))
    assert.ok(ref.condicao.ajuda.includes(String(padrao)))
  })

  db.prepare('INSERT INTO connections (id, kind, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('busca', 'http', JSON.stringify({
    endereco: 'http://127.0.0.1:8767', autenticacao: { tipo: 'nenhuma' },
    funcoes: [{ nome: 'buscar', metodo: 'GET', caminho: '/', entradas: [{ nome: 'termo', tipo: 'texto' }], resposta: { forma: 'texto', campo: 'texto' } }]
  }), agora, agora)
  const suspensa = publicar(documento(`se 1 == 1
  se 2 == 2
    calcula local total = 2 + 3
    chama busca.buscar
      com
        termo: "teste"
  senão
    responde "não deveria"
  se evento local.total == 5
    responde "retomou {{resultado.texto}}"
senão
  responde "não entrou"
responde "fim"`))
  volta('ação com campos profundos e retomada', suspensa)
  const aguardando = rodar(suspensa)
  igual('o ramo dorme na chamada, antes da continuação', aguardando.commands.map((c) => c.commandType), ['connection.call'])
  registrarResultadoExecucao(db, aguardando.commands[0].id, { status: 'sent', resultado: { texto: 'ok' } })
  const runId = db.prepare('SELECT id FROM automation_runs WHERE automation_id = ?').get(suspensa.id).id
  const respostas = () => db.prepare("SELECT payload_json FROM outbound_commands WHERE run_id = ? AND command_type = 'whatsapp.reply' ORDER BY rowid").all(runId).map((r) => JSON.parse(r.payload_json).text)
  igual('retomada cruza condição interna e retorna à continuação externa uma vez', respostas(), ['retomou ok', 'fim'])
  registrarResultadoExecucao(db, aguardando.commands[0].id, { status: 'sent', resultado: { texto: 'duplicado' } })
  igual('confirmação repetida não repete a continuação dos ramos', respostas(), ['retomou ok', 'fim'])
} finally {
  db.close()
}
console.log(`\n${checagens} checagens, ${falhas} falhas`)
process.exitCode = falhas ? 1 : 0
