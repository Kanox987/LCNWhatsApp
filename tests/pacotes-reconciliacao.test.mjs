// §8 FRENTE D — o que o provisionamento REPETIDO precisa dizer e guardar.
//
// Três defeitos achados por revisão externa e reproduzidos por sonda antes
// deste arquivo existir:
//  - item `criada` cuja automação foi apagada e republicada: o registro seguia
//    apontando para a revisão ANTIGA, e o painel passava a chamar de "editada"
//    uma automação que ninguém tocou;
//  - reprovisionar com escopo ou modo diferentes devolvia 201 como se tivesse
//    aplicado, quando as automações que já existiam ficam como estão;
//  - os dois acima sem nenhum campo que contasse isso a quem chamou.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const chamar = (db, metodo, caminho, body) => criarApi(db).resolver(metodo, caminho, contexto(body))

const ESCOPO = { include: [{ kind: 'everywhere' }], exclude: [] }
const OUTRO_ESCOPO = { include: [{ kind: 'group', id: '123@g.us' }], exclude: [] }
const provisionarBasico = (db, extra = {}) => chamar(db, 'POST', '/pacotes/provisionar', {
  kind: 'pacote', packageId: 'basico', scope: ESCOPO, parametrosComuns: { poolId: 'pool-comum' }, ...extra
})
const novoBanco = async () => {
  const db = abrirBanco(':memory:')
  await chamar(db, 'POST', '/pools', { id: 'pool-comum', label: 'Pool comum' })
  return db
}
const revisaoInicial = (db, itemKey) =>
  db.prepare('SELECT initial_revision_id AS id FROM package_installation_items WHERE item_key = ?').get(itemKey)?.id
const itensDoEstado = async (db) => (await chamar(db, 'GET', '/pacotes/provisionamento')).instalacoes[0].itens
  .map((i) => ({ ...i, initialRevisionId: revisaoInicial(db, i.itemKey) }))

// ------------------------- 1. automação apagada por fora e republicada

{
  const db = await novoBanco()
  await provisionarBasico(db)
  const itens = await itensDoEstado(db)
  const alvo = itens[0]
  check('1. pré-condição: toda a instalação nasce "como instalada"',
    itens.every((i) => i.personalizacao === 'comoInstalada'), itens.map((i) => i.personalizacao).join(','))

  await chamar(db, 'DELETE', `/automations/${alvo.automationId}`)
  const r = await provisionarBasico(db)
  check('1. reprovisionar após apagar à mão devolve 201', r.status === 201, `status=${r.status}`)
  check('1. e a resposta conta QUAL item foi recriado',
    JSON.stringify(r.body?.recriados) === JSON.stringify([alvo.itemKey]), JSON.stringify(r.body?.recriados))

  const depois = await itensDoEstado(db)
  const recriado = depois.find((i) => i.itemKey === alvo.itemKey)
  check('1. o item recriado volta a "comoInstalada", não "editada"',
    recriado?.personalizacao === 'comoInstalada', recriado?.personalizacao)
  check('1. e a revisão inicial gravada é a da geração NOVA',
    recriado?.initialRevisionId !== alvo.initialRevisionId && recriado?.initialRevisionId != null,
    `${alvo.initialRevisionId} -> ${recriado?.initialRevisionId}`)
  check('1. os demais itens não mudaram',
    depois.filter((i) => i.itemKey !== alvo.itemKey)
      .every((i) => i.initialRevisionId === itens.find((x) => x.itemKey === i.itemKey).initialRevisionId))

  const repetido = await provisionarBasico(db)
  check('1. repetir de novo, sem nada a recriar, não relata recriação',
    Array.isArray(repetido.body?.recriados) && repetido.body.recriados.length === 0, JSON.stringify(repetido.body?.recriados))
  db.close()
}

// ------------------- 2. edição de verdade continua sendo "editada"

{
  const db = await novoBanco()
  await provisionarBasico(db)
  const alvo = (await itensDoEstado(db))[0]
  const atual = await chamar(db, 'GET', `/automations/${alvo.automationId}`)
  const doc = JSON.parse(JSON.stringify(atual.draft.document))
  doc.name = 'mudada à mão'
  await chamar(db, 'PUT', `/automations/${alvo.automationId}/draft`, { document: doc })
  await chamar(db, 'POST', `/automations/${alvo.automationId}/publish`, {})
  const r = await provisionarBasico(db).then((ok) => ({ ok }), (erro) => ({ erro }))
  check('2. reprovisionar por cima de edição à mão é RECUSADO (409), nunca tratado como recriação',
    r.erro?.status === 409, r.erro ? `status=${r.erro.status}` : `status=${r.ok?.status}`)
  const depois = (await itensDoEstado(db)).find((i) => i.itemKey === alvo.itemKey)
  check('2. e a edição à mão continua aparecendo como "editada"', depois?.personalizacao === 'editada', depois?.personalizacao)
  db.close()
}

// ------------------- 3. escopo/modo divergentes não passam calados

{
  const db = await novoBanco()
  await provisionarBasico(db)
  const igual = await provisionarBasico(db)
  check('3. repetição idêntica não gera aviso', Array.isArray(igual.body?.avisos) && igual.body.avisos.length === 0,
    JSON.stringify(igual.body?.avisos))

  const outroEscopo = await provisionarBasico(db, { scope: OUTRO_ESCOPO })
  const codigos = new Set((outroEscopo.body?.avisos ?? []).map((a) => a.codigo))
  check('3. escopo diferente do que já está instalado vira aviso', codigos.has('escopoDivergente'), [...codigos].join(','))
  check('3. e o aviso nomeia a automação que ficou como estava',
    outroEscopo.body.avisos.every((a) => typeof a.automationId === 'string' && a.automationId.length > 0))
  const aindaIgual = await chamar(db, 'GET', `/automations/${(await itensDoEstado(db))[0].automationId}`)
  check('3. e nada foi sobrescrito: o escopo antigo segue valendo',
    aindaIgual.draft.document.scope.include[0].kind === 'everywhere', JSON.stringify(aindaIgual.draft.document.scope))

  const sombra = await provisionarBasico(db, { deploymentMode: 'shadow' })
  const codigosSombra = new Set((sombra.body?.avisos ?? []).map((a) => a.codigo))
  check('3. modo diferente do que já está instalado vira aviso', codigosSombra.has('modoDivergente'), [...codigosSombra].join(','))
  db.close()
}

// ------------------- 4. dependência não configurada é recusada ANTES de publicar

{
  const db = await novoBanco()
  const pedido = (extra = {}) => chamar(db, 'POST', '/pacotes/provisionar', {
    kind: 'especificas', templateIds: ['clima'], scope: ESCOPO,
    parametrosComuns: { poolId: 'pool-comum', ...(extra.parametrosComuns ?? {}) }
  }).then((ok) => ({ ok }), (erro) => ({ erro }))

  const sem = await pedido()
  check('4. conexão não declarada → 409, não 201 com comando quebrado',
    sem.erro?.status === 409, sem.erro ? `status=${sem.erro.status}` : `status=${sem.ok?.status}`)
  check('4. e a mensagem nomeia a conexão e manda para a aba Conexões',
    /clima/.test(sem.erro?.message ?? '') && /Conexões/.test(sem.erro?.message ?? ''), sem.erro?.message)
  const nada = db.prepare('SELECT COUNT(*) AS n FROM automations').get().n
  check('4. nada foi publicado pela metade', nada === 0, `automações=${nada}`)

  const outra = await pedido({ parametrosComuns: { conexao: 'outra-api' } })
  check('4. conexão escolhida no pedido vale mais que o padrão do template',
    outra.erro?.status === 409 && /outra-api/.test(outra.erro?.message ?? '') && !/clima/.test(outra.erro?.message ?? ''),
    outra.erro?.message)

  // Declarada de verdade: endereço e a função `previsao`, como a aba Conexões grava.
  const declaracao = {
    endereco: 'http://127.0.0.1:9', autenticacao: { tipo: 'nenhuma' },
    funcoes: [{
      nome: 'previsao', descricao: 'Previsão do tempo.', metodo: 'POST', caminho: '/previsao', enderecoProprio: false,
      entradas: [{ nome: 'cidade', tipo: 'texto', obrigatoria: true }],
      resposta: { forma: 'texto', campoDoTexto: 'texto', campoDoErro: 'erro' }
    }]
  }
  db.prepare("INSERT INTO connections (id, kind, config_json, created_at, updated_at) VALUES ('clima', 'http', ?, '', '')")
    .run(JSON.stringify(declaracao))
  const com = await pedido()
  check('4. com a conexão declarada, provisiona', com.ok?.status === 201, com.erro?.message ?? `status=${com.ok?.status}`)
  db.close()
}

console.log(falhas === 0 ? '\nRECONCILIAÇÃO DO PROVISIONAMENTO: RECRIADOS, EDIÇÃO E AVISOS' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
