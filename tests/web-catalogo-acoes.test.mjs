// O catálogo da tela precisa bater com o que o motor executa — NOS DOIS SENTIDOS.
//
// Este arquivo existe por causa de um sintoma concreto: `action.whatsapp.sendFile`
// foi implementada, testada e publicada, e ficou INVISÍVEL. Sem template, sem
// tela, sem documentação. O dono subia arquivo no acervo, copiava o id, e não
// tinha onde colar.
//
// As duas direções importam por motivos diferentes:
//   - catálogo ⊆ motor: a tela não pode oferecer o que o publish vai rejeitar.
//   - motor ⊆ catálogo: uma ação nova não pode nascer escondida.
//
// E os campos são conferidos contra o SCHEMA, não contra uma segunda lista:
// duas cópias da mesma definição saem de sincronia, que foi como a lista de
// variáveis do interpolador divergiu da lista da condição.
import fs from 'fs'
import {
  ACOES, CONDICOES, DESTINOS, ESCOPOS, GATILHOS, OPERADORES,
  acharDefinicao, campoDoSchema, todosOsTipos
} from '../src/web/public/logic/acoes.js'
import {
  ACOES_SUPORTADAS, CONDICOES_SUPORTADAS, ESCOPOS_DE_VARIAVEL,
  GATILHOS_SUPORTADOS, OPERADORES_DE_COMPARACAO
} from '../src/engine/server/runtimeCapabilities.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const cat = todosOsTipos()

const faltando = (a, b) => a.filter((x) => !b.includes(x))

// --- as duas direções ------------------------------------------------------
check('todo gatilho do catálogo é executável pelo motor',
  faltando(cat.gatilhos, [...GATILHOS_SUPORTADOS]).length === 0,
  faltando(cat.gatilhos, [...GATILHOS_SUPORTADOS]).join(', '))
check('nenhum gatilho do motor fica escondido da tela',
  faltando([...GATILHOS_SUPORTADOS], cat.gatilhos).length === 0,
  faltando([...GATILHOS_SUPORTADOS], cat.gatilhos).join(', '))

check('toda ação do catálogo é executável pelo motor',
  faltando(cat.acoes, [...ACOES_SUPORTADAS]).length === 0,
  faltando(cat.acoes, [...ACOES_SUPORTADAS]).join(', '))
check('nenhuma ação do motor fica escondida da tela',
  faltando([...ACOES_SUPORTADAS], cat.acoes).length === 0,
  faltando([...ACOES_SUPORTADAS], cat.acoes).join(', '))

check('a condição bate', JSON.stringify(cat.condicoes) === JSON.stringify([...CONDICOES_SUPORTADAS]))
check('os operadores batem, sem sobra nem falta',
  JSON.stringify([...cat.operadores].sort()) === JSON.stringify([...OPERADORES_DE_COMPARACAO].sort()))
check('os escopos de variável batem',
  JSON.stringify([...cat.escopos].sort()) === JSON.stringify([...ESCOPOS_DE_VARIAVEL].sort()))

// `action.http` está no schema mas o publish rejeita (invariante 7). A tela não
// pode oferecê-la — seria prometer o que não executa.
check('action.http NÃO aparece no catálogo (o publish rejeita)', !cat.acoes.includes('action.http'))

// --- cada entrada é utilizável de verdade ---------------------------------
const todos = [...GATILHOS, ...ACOES, ...CONDICOES]
check('toda entrada tem rótulo humano em português', todos.every((x) => typeof x.rotulo === 'string' && x.rotulo.length > 3))
check('toda entrada explica para que serve', todos.every((x) => typeof x.resumo === 'string' && x.resumo.length > 20))
check('toda entrada traz um exemplo concreto', todos.every((x) => typeof x.exemplo === 'string' && x.exemplo.length > 10))
check('nenhum rótulo é só o nome técnico', todos.every((x) => x.rotulo !== x.tipo))

const familiasValidas = new Set(['resposta', 'midia', 'variavel', 'moderacao', 'configuracao'])
check('toda ação pertence a uma família conhecida', ACOES.every((a) => familiasValidas.has(a.familia)),
  ACOES.filter((a) => !familiasValidas.has(a.familia)).map((a) => a.tipo).join(', '))

// --- os campos existem no schema, e o schema é quem diz o tipo ------------
const camposErrados = []
for (const entrada of todos) {
  const def = acharDefinicao(schema, entrada.tipo)
  if (!def) { camposErrados.push(`${entrada.tipo}: sem definição no schema`); continue }
  for (const campo of entrada.campos || []) {
    if (!campoDoSchema(def, campo.chave)) camposErrados.push(`${entrada.tipo}.${campo.chave}`)
  }
}
check('todo campo documentado existe mesmo no schema', camposErrados.length === 0, camposErrados.join(' · '))

// O caminho contrário: campo que o schema aceita e o catálogo não menciona fica
// invisível para quem monta o comando — o mesmo defeito do sendFile.
const naoDocumentados = []
for (const entrada of todos) {
  const def = acharDefinicao(schema, entrada.tipo)
  const props = Object.keys(def?.properties?.config?.properties || {})
  const documentados = new Set((entrada.campos || []).map((c) => c.chave))
  for (const p of props) if (!documentados.has(p)) naoDocumentados.push(`${entrada.tipo}.${p}`)
}
check('nenhum campo do schema fica sem explicação na tela', naoDocumentados.length === 0, naoDocumentados.join(' · '))

// --- a ponte com o schema funciona ----------------------------------------
const defResposta = acharDefinicao(schema, 'action.whatsapp.reply')
check('acha a definição de um nó pelo próprio tipo, sem mapa fixo', !!defResposta)
const texto = campoDoSchema(defResposta, 'text')
check('o tipo do campo vem do SCHEMA, não do catálogo', texto?.tipo === 'string')
check('e o schema também diz o que é obrigatório', texto?.obrigatorio === true)

const defRecover = acharDefinicao(schema, 'action.whatsapp.recover')
const destino = campoDoSchema(defRecover, 'destination')
check('campo com lista fechada devolve os valores aceitos', Array.isArray(destino?.valores) && destino.valores.includes('configured'),
  JSON.stringify(destino?.valores))

check('campo inexistente devolve null em vez de inventar', campoDoSchema(defResposta, 'naoExiste') === null)
check('tipo desconhecido não quebra a busca', acharDefinicao(schema, 'action.inventada') === null)

// --- destinos: a lista da tela bate com o que o avaliador entende ---------
const destinosDoSchema = new Set()
for (const variante of schema.definitions?.scopeRef?.oneOf || []) {
  const k = variante?.properties?.kind
  for (const v of (k?.enum || (k?.const ? [k.const] : []))) destinosDoSchema.add(v)
}
check('todo destino da tela é aceito pelo schema',
  DESTINOS.every((d) => destinosDoSchema.has(d.id)),
  DESTINOS.filter((d) => !destinosDoSchema.has(d.id)).map((d) => d.id).join(', '))
check('nenhum destino do schema fica escondido',
  [...destinosDoSchema].every((d) => DESTINOS.some((x) => x.id === d)),
  [...destinosDoSchema].filter((d) => !DESTINOS.some((x) => x.id === d)).join(', '))

// --- os dois portões de tipo de mensagem precisam concordar ---------------
// `acceptedMessageKinds` é avaliado ANTES do gatilho. Um tipo aceito só no
// gatilho produz regra que salva, valida, publica e NUNCA dispara — sem erro em
// lugar nenhum, que é o pior modo de falha desta base.
const tiposDoGatilho = schema.definitions.triggerMessage.properties.config.properties.messageKinds.items.enum
const tiposDaPolitica = schema.properties.inputPolicy.properties.acceptedMessageKinds.items.enum
check('o gatilho não aceita tipo que a política de entrada barra',
  tiposDoGatilho.every((t) => tiposDaPolitica.includes(t)),
  tiposDoGatilho.filter((t) => !tiposDaPolitica.includes(t)).join(', '))

// --- os escopos mostram como se escreve a variável no texto ---------------
check('todo escopo mostra o modo de uso pronto para copiar',
  ESCOPOS.every((e) => typeof e.usoNoTexto === 'string' && e.usoNoTexto.startsWith('{{var.')))

// --- toda ação precisa de pelo menos um template que a demonstre ---------
// `sendFile` ficou invisível justamente por não ter um. Um teste que só olha o
// catálogo não pegaria isso: a ação estaria documentada e continuaria sem
// nenhum exemplo instalável.
const catalogo = fs.readdirSync(new URL('../src/engine/templates/catalog/', import.meta.url))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(new URL(`../src/engine/templates/catalog/${f}`, import.meta.url), 'utf8')))

const usadas = new Set()
for (const t of catalogo) for (const no of t.documentTemplate?.flow?.nodes || []) usadas.add(no.type)

const semExemplo = [...ACOES_SUPORTADAS].filter((a) => !usadas.has(a))
check('toda ação executável tem pelo menos um template que a usa', semExemplo.length === 0, semExemplo.join(', '))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO CATÁLOGO DE AÇÕES PASSARAM')
process.exit(falhas ? 1 : 0)
