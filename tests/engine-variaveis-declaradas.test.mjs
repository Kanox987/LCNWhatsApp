// Variáveis declaradas: o catálogo do que EXISTE, separado do que VALE.
//
// Problema que resolve: instalar o anti-link cria um contador de avisos que só
// passa a existir de verdade na primeira infração. Até lá a pessoa não vê a
// variável em lugar nenhum e não sabe que pode usá-la nos próprios comandos.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { declarar, listarDeclaradas, modoDeUso, removerDeclaracao } from '../src/engine/server/declaredVariables.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const ctx = (body = null, query = '') => ({ body, query: new URLSearchParams(query), req: { headers: {} } })
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Pool', agora, agora)

// --- modo de uso: é o que a pessoa copia e cola --------------------------
check('modo de uso monta o placeholder do escopo', modoDeUso('member', 'avisos') === '{{var.member.avisos}}')
check('categoria mostra que falta escolher qual', modoDeUso('category', 'usos') === '{{var.category.<categoria>.usos}}')

// --- declaração direta ----------------------------------------------------
check('declara uma variável', declarar(db, { scope: 'member', key: 'avisos', valueType: 'number', description: 'Infrações no grupo' }) === true)
check('escopo inválido é recusado', declarar(db, { scope: 'inventado', key: 'x' }) === false)
check('chave vazia é recusada', declarar(db, { scope: 'member', key: '   ' }) === false)
check('tipo inválido é recusado', declarar(db, { scope: 'member', key: 'y', valueType: 'data' }) === false)
check('entrada malformada nunca lança', declarar(db, null) === false && declarar(db, undefined) === false)

const listada = listarDeclaradas(db).find((v) => v.key === 'avisos')
check('a declarada aparece na listagem com o modo de uso pronto', listada?.usage === '{{var.member.avisos}}')
check('guarda o tipo', listada?.valueType === 'number')

// Reinstalar o mesmo comando não pode duplicar nem apagar o que a pessoa
// ajustou à mão.
declarar(db, { scope: 'member', key: 'avisos', valueType: 'number', description: 'OUTRA descrição' })
const depois = listarDeclaradas(db).filter((v) => v.key === 'avisos')
check('declarar de novo não duplica', depois.length === 1)
check('declarar de novo não sobrescreve a descrição existente', depois[0].description === 'Infrações no grupo')

// --- o caminho real: instalar um template ---------------------------------
await api.resolver('POST', '/templates/anti-link/install', ctx({
  automationIds: { 'anti-link': 'antilink-teste' },
  parameters: { 'anti-link': { limite: 3, aviso: 'Sem link', poolId: 'p1' } },
  scope: { include: [{ kind: 'group', id: '120000000000000001@g.us' }] }
}))

const aposInstalar = listarDeclaradas(db).find((v) => v.key === 'links_apagados')
check('instalar o anti-link declara o contador dele', !!aposInstalar, JSON.stringify(aposInstalar?.usage))
check('a declaração sabe de qual comando veio', aposInstalar?.sourceTemplate === 'anti-link')
check('a declaração aponta a automação criada', aposInstalar?.sourceAutomation === 'antilink-teste')
check('o contador é declarado como número', aposInstalar?.valueType === 'number')
check('tem descrição em português para quem for usar', typeof aposInstalar?.description === 'string' && aposInstalar.description.length > 20)

// O valor NÃO deve existir ainda — declarar não é criar valor.
const valorAinda = db.prepare("SELECT 1 FROM entity_attributes WHERE key = 'links_apagados'").get()
check('declarar NÃO inventa valor (o contador ainda não existe)', valorAinda === undefined)

// --- nome de variável vindo de parâmetro ----------------------------------
// O marcar-variavel deixa quem instala escolher o nome. Declarar sem resolver
// registraria a variável chamada "{{params.variavel}}".
await api.resolver('POST', '/templates/marcar-variavel/install', ctx({
  automationIds: { 'marcar-variavel': 'marcar-teste' },
  parameters: { 'marcar-variavel': { command: '/vip', variavel: 'cliente_vip', valor: 'true', confirmacao: 'ok', poolId: 'p1' } },
  scope: { include: [{ kind: 'contact', id: '5511900000001@s.whatsapp.net' }] }
}))
const porParametro = listarDeclaradas(db).find((v) => v.key === 'cliente_vip')
check('nome vindo de parâmetro é resolvido na declaração', !!porParametro, JSON.stringify(porParametro?.usage))
check('nenhuma variável foi declarada com placeholder cru', !listarDeclaradas(db).some((v) => v.key.includes('{{')))

// --- a API entrega built-in + declaradas ----------------------------------
const meta = await api.resolver('GET', '/meta/variables', ctx())
check('meta continua trazendo as variáveis do evento', meta.builtIn.some((v) => v.example === '{{sender.id}}'))
check('meta traz as declaradas junto', meta.declared.some((v) => v.key === 'links_apagados'))
check('cada declarada vem com o modo de uso pronto para copiar', meta.declared.every((v) => typeof v.usage === 'string' && v.usage.startsWith('{{var.')))

// --- remover --------------------------------------------------------------
check('remove uma declaração', removerDeclaracao(db, 'member', 'avisos') === true)
check('remover o que não existe devolve false', removerDeclaracao(db, 'member', 'nunca-existiu') === false)

// --- os cinco escopos na aba Dados ----------------------------------------
// Estes três existiam no motor desde a migração 008 mas a rota só aceitava
// contato e grupo — eram invisíveis e ineditáveis pelo painel.
await api.resolver('PUT', '/entities/global/x/attributes/total', ctx({ value: 7 }))
check('escopo global é editável', (await api.resolver('GET', '/entities/global/qualquer/attributes', ctx()))[0]?.value === 7)

const idMembro = '120000000000000001@g.us|5511900000001@s.whatsapp.net'
await api.resolver('PUT', `/entities/group_member/${idMembro}/attributes/avisos`, ctx({ value: 2 }))
check('escopo de membro de grupo é editável', (await api.resolver('GET', `/entities/group_member/${idMembro}/attributes`, ctx()))[0]?.value === 2)

await api.resolver('PUT', '/entities/category/vip/attributes/usos', ctx({ value: 10 }))
check('escopo de categoria é editável', (await api.resolver('GET', '/entities/category/vip/attributes', ctx()))[0]?.value === 10)

let erroMembro
try { await api.resolver('GET', '/entities/group_member/sem-separador/attributes', ctx()) } catch (e) { erroMembro = e }
check('id de membro sem o separador é recusado com explicação', erroMembro?.status === 400)

let erroKind
try { await api.resolver('GET', '/entities/inventado/x/attributes', ctx()) } catch (e) { erroKind = e }
check('escopo inexistente continua recusado', erroKind?.status === 400)

// Valor tipado: a tabela sempre soube guardar, quem limitava era a tela.
await api.resolver('PUT', '/entities/contact/5511900000002@s.whatsapp.net/attributes/nivel', ctx({ value: 5 }))
await api.resolver('PUT', '/entities/contact/5511900000002@s.whatsapp.net/attributes/ativo', ctx({ value: true }))
const tipados = await api.resolver('GET', '/entities/contact/5511900000002@s.whatsapp.net/attributes', ctx())
check('número é guardado como número, não como texto', tipados.find((a) => a.key === 'nivel')?.value === 5)
check('sim/não é guardado como booleano', tipados.find((a) => a.key === 'ativo')?.value === true)

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE VARIÁVEIS DECLARADAS PASSARAM')
process.exit(falhas ? 1 : 0)
