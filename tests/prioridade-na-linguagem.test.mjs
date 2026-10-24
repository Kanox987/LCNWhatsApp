// A URGÊNCIA DECLARADA, e o que fazer quando não há vaga.
//
// A primeira formulação disto era "prioridade = peso × perecibilidade", e ela
// se inverte: se o trabalho caro sobe de prioridade POR ser caro, arquivo
// grande fura a fila só por ser grande. São três dimensões diferentes, e
// separadas elas se comportam:
//
//   - PERECIBILIDADE decide urgência, e é só ela que vive em `prioridade:`.
//     Capturar uma visualização única é o caso-guia: se esperar, a mídia DEIXA
//     DE EXISTIR, e nenhuma repetição depois resolve.
//   - CUSTO decide admissão e reserva, e vive no orçamento de bytes.
//   - ESPERA decide justiça, e vive no envelhecimento da fila.
//
// Baixar um vídeo é caro e REPETÍVEL — pode esperar a noite inteira. É o
// contraste que mostra por que peso sozinho ordenaria errado.
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { PRIORIDADES } from '../src/lcn/vocabulario.js'
import { obterCapacidadesRuntime } from '../src/engine/server/runtimeCapabilities.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const doc = (extra) => `automação t1
  nome: Teste
  tipo: comando
  dispara com: /t
  casa: exato
  quem: qualquer um
  acessa: texto
  pool: p${extra}

  responde "oi"
`

const recusa = (texto) => {
  try { compilar(texto); return null } catch (e) { return e }
}

// --- as duas linhas novas -------------------------------------------------
const comAmbas = compilar(doc('\n  prioridade: muito alta\n  sem vaga: "Tá cheio agora."'))
check('"muito alta" vira very_high', comAmbas.scheduling.priority === 'very_high', comAmbas.scheduling.priority)
check('o texto entre aspas vira notify com o texto', comAmbas.scheduling.onNoSlot.kind === 'notify' && comAmbas.scheduling.onNoSlot.text === 'Tá cheio agora.', JSON.stringify(comAmbas.scheduling.onNoSlot))

const descarta = compilar(doc('\n  prioridade: baixa\n  sem vaga: descarta'))
check('a palavra reservada vira discard, SEM texto', descarta.scheduling.onNoSlot.kind === 'discard' && descarta.scheduling.onNoSlot.text === undefined, JSON.stringify(descarta.scheduling.onNoSlot))

// AS ASPAS SÃO O QUE SEPARA as duas formas, e é a mesma regra que `sem ele` e
// `palavras` já seguem. Sem isso não haveria como escrever um aviso cujo texto
// fosse, por acaso, igual à palavra reservada.
const avisoIgualAPalavra = compilar(doc('\n  sem vaga: "descarta"'))
check('"descarta" ENTRE ASPAS é texto de aviso, não a palavra', avisoIgualAPalavra.scheduling.onNoSlot.kind === 'notify' && avisoIgualAPalavra.scheduling.onNoSlot.text === 'descarta', JSON.stringify(avisoIgualAPalavra.scheduling.onNoSlot))

// --- os padrões, e o que eles NÃO fazem -----------------------------------
const semNada = compilar(doc(''))
check('sem declarar, a prioridade é normal', semNada.scheduling.priority === 'normal', semNada.scheduling.priority)
check('sem declarar, descarta calado', semNada.scheduling.onNoSlot.kind === 'discard', JSON.stringify(semNada.scheduling.onNoSlot))

// Avisar por omissão somaria barulho ao barulho exatamente quando o sistema já
// está apertado — então o padrão é o silêncio registrado, não o aviso.
check('o padrão NÃO é avisar', semNada.scheduling.onNoSlot.kind !== 'notify')

const voltaSimples = descompilar(semNada)
check('o padrão não escreve linha nenhuma no cabeçalho', !voltaSimples.includes('prioridade') && !voltaSimples.includes('sem vaga'))

// --- `tenta de novo` é RECUSADO, e de propósito ---------------------------
//
// Não existe estado "agendado" no protocolo: uma execução acaba em enviado,
// falhou ou resultado incerto. Reexecutar com um relógio trocaria dez mil
// itens na fila por dez mil relógios vivos — o mesmo problema com outro nome —
// e perderia a tentativa em qualquer reinício. Aceitar a palavra na linguagem
// sem cumprir a promessa seria pior que não tê-la.
const eRetry = recusa(doc('\n  sem vaga: tenta de novo'))
check('"tenta de novo" é recusado', eRetry instanceof ErroDeSintaxe)
check('e a recusa diz POR QUE ainda não existe', /agendamento|reinício/i.test(eRetry?.message || ''), eRetry?.message)
check('e diz o que usar no lugar', /descarta/.test(eRetry?.message || ''))
check('e aponta a linha', eRetry?.linha === 9, String(eRetry?.linha))

// --- recusa que ENSINA, não recusa que esconde ----------------------------
const ePrio = recusa(doc('\n  prioridade: urgentíssima'))
check('prioridade inventada é recusada', ePrio instanceof ErroDeSintaxe)
check('e a recusa LISTA as que valem', Object.values(PRIORIDADES).every((p) => ePrio.message.includes(p)), ePrio?.message)

const eSemAspas = recusa(doc('\n  sem vaga: tá cheio'))
check('texto sem aspas é recusado', eSemAspas instanceof ErroDeSintaxe)
check('e a recusa explica as duas formas', /descarta/.test(eSemAspas?.message || '') && /aspas/.test(eSemAspas?.message || ''), eSemAspas?.message)

// --- marcador de template passa inteiro -----------------------------------
//
// Num `.lcn` do catálogo a linha é `prioridade: {{params.prioridade}}`, e quem
// instala escolhe. Traduzir aqui recusaria o catálogo na carga — é o mesmo
// defeito que `ehMarcador` já resolveu no número, no booleano e na opção.
const comMarcador = compilar(doc('\n  prioridade: {{params.urgencia}}'))
check('marcador de template atravessa sem tradução', comMarcador.scheduling.priority === '{{params.urgencia}}', comMarcador.scheduling.priority)

// --- ida e volta ----------------------------------------------------------
for (const [nome, extra] of [
  ['com as duas linhas', '\n  prioridade: alta\n  sem vaga: "Cheio."'],
  ['só com prioridade', '\n  prioridade: muito alta'],
  ['com descarta explícito', '\n  prioridade: baixa\n  sem vaga: descarta'],
  ['sem nenhuma das duas', ''],
  ['com aviso que tem aspas dentro', '\n  sem vaga: "Ele disse \\"cheio\\"."']
]) {
  const ida = compilar(doc(extra))
  const volta = compilar(descompilar(ida))
  check(`ida e volta ${nome} não perde nada`, JSON.stringify(ida) === JSON.stringify(volta))
}

// --- as capacidades declaram, e declaram o que NÃO existe -----------------
const cap = obterCapacidadesRuntime()
check('as capacidades declaram a política de fila', !!cap.scheduling)
check('e não a declaram como ação', !cap.actions.some((a) => /priorit|scheduling/i.test(a)))
check('as prioridades batem com o vocabulário', JSON.stringify(cap.scheduling.priorities) === JSON.stringify(Object.keys(PRIORIDADES)), JSON.stringify(cap.scheduling.priorities))
check('e o que ainda não existe aparece como não suportado', cap.scheduling.naoSuportado.includes('retry'), JSON.stringify(cap.scheduling.naoSuportado))

// A tabela do vocabulário e a lista das capacidades não podem divergir em
// silêncio: uma palavra que o painel oferece e o motor não entende é um
// comando que publica e não roda.
check('nenhuma prioridade do vocabulário falta nas capacidades', Object.keys(PRIORIDADES).every((k) => cap.scheduling.priorities.includes(k)))
check('nenhuma prioridade das capacidades falta no vocabulário', cap.scheduling.priorities.every((k) => k in PRIORIDADES))

console.log(falhas === 0 ? '\nprioridade na linguagem: tudo certo' : `\nprioridade na linguagem: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
