// A ajuda de CADA CLASSE sai da MESMA fonte que recusa o documento, ou não sai.
//
// `referencia-contra-schema.test.mjs` guarda os campos das AÇÕES. Este guarda a
// outra metade: as linhas do CABEÇALHO, onde há uma armadilha que as ações não
// têm — a mesma linha vira campo DIFERENTE conforme a classe. `quando for`
// escreve `messageKinds` num vigia e `actions` num porteiro, com enums que não
// se encontram. Com uma chave de documento só, a ajuda do porteiro saía sem
// tipo, sem valores e sem a descrição do schema, e a tela mostrava a união das
// duas listas: dizia que um porteiro aceita `texto`, que o compilador recusa.
//
// O que esta guarda prova, por classe e por execução real:
//  1. a fonte mínima daquela classe compila, e no gatilho que o vocabulário diz;
//  2. toda chave obrigatória do `config` daquela definição do schema é escrita
//     por uma linha de cabeçalho — e a resolução `campo -> classe -> chave` é a
//     do próprio `referencia.js` (`docDaClasse`), não uma cópia;
//  3. tirar essa linha faz `compilar` RECUSAR. É o único jeito de prender a
//     lista que `compilar.js` mantém à mão: `src/lcn` não pode importar o
//     schema (o schema é injetado em `montarReferencia`), então a amarração é
//     comportamental;
//  4. todo valor do enum daquela classe tem palavra escrita — e a palavra
//     compila naquela classe;
//  5. palavra de outra classe é RECUSADA. Esse é o par da ajuda per-classe:
//     se o compilador aceitasse as duas listas, mostrar duas listas seria erro.
import fs from 'fs'
import { montarReferencia, docDaClasse, GATILHO_DA_CLASSE } from '../src/lcn/referencia.js'
import { CAMPOS_DO_CABECALHO } from '../src/lcn/vocabulario.js'
import * as glossario from '../src/web/public/logic/acoes.js'
import { compilar } from '../src/lcn/compilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const ref = montarReferencia({ prosa: glossario, schema })

const recusa = (linhas) => {
  try { compilar(linhas.join('\n')); return null } catch (e) { return e.message }
}

// As fontes mínimas de cada classe. Cada uma é o menor documento que compila
// naquela classe: é dela que sai a prova de obrigatoriedade por remoção.
const CLASSES = [
  {
    nome: 'comando',
    linhas: ['automação teste', '  tipo: comando', '  dispara com: /t', '  casa: exato', '  quem: qualquer um', '', '  responde "oi"', '']
  },
  {
    nome: 'vigia',
    linhas: ['automação teste', '  tipo: vigia', '  dispara com: qualquer mensagem', '  quem: qualquer um', '  acessa: texto', '', '  responde "oi"', '']
  },
  {
    nome: 'porteiro',
    linhas: ['automação teste', '  tipo: porteiro', '  quando for: entrou', '', '  responde "oi"', '']
  },
  {
    nome: 'agendado',
    linhas: ['automação teste', '  tipo: agendado', '  agenda: todo dia às 08:00', '  fuso: America/Recife', '  onde: grupo 120363@g.us', '', '  responde "oi"', '']
  }
]

for (const classe of CLASSES) {
  const tipoDoGatilho = GATILHO_DA_CLASSE[classe.nome]
  let doc = null
  try { doc = compilar(classe.linhas.join('\n')) } catch (e) {
    check(`[${classe.nome}] a fonte mínima compila`, false, e.message)
    continue
  }
  check(`[${classe.nome}] a fonte mínima compila`, true)

  const gatilho = doc.flow?.nodes?.[0]
  check(`[${classe.nome}] o gatilho é ${tipoDoGatilho}`, gatilho?.type === tipoDoGatilho, gatilho?.type)

  const definicao = glossario.acharDefinicao(schema, tipoDoGatilho)
  check(`[${classe.nome}] ${tipoDoGatilho} tem definição no schema`, !!definicao)
  if (!definicao) continue

  const obrigatorias = definicao.properties?.config?.required ?? []
  const config = gatilho?.config ?? {}

  for (const chaveDoDoc of obrigatorias) {
    // O compilador tem de PRODUZIR a chave: senão a instalação recusa com 422
    // um documento que a tela disse estar completo.
    check(`[${classe.nome}] o compilador produz "${chaveDoDoc}"`, Object.hasOwn(config, chaveDoDoc), JSON.stringify(config))

    // E tem de haver linha de cabeçalho que a escreva NESTA classe. A resolução
    // é a de `referencia.js`: campo com `doc` string vale em toda classe em que
    // o campo vale; campo com `doc` por classe vale só onde o mapa disser.
    const campos = CAMPOS_DO_CABECALHO.filter((c) => docDaClasse(c, classe.nome) === chaveDoDoc)
    check(`[${classe.nome}] "${chaveDoDoc}" tem linha de cabeçalho`, campos.length === 1, campos.map((c) => c.chave).join(', ') || 'nenhuma')
    if (campos.length !== 1) continue

    // A prova comportamental: sem a linha, o compilador RECUSA. É isto que
    // prende a lista escrita à mão em `compilar.js` ao `required` do schema.
    const chave = campos[0].chave
    const sem = classe.linhas.filter((l) => !l.trimStart().startsWith(`${chave}:`))
    if (campos[0].padrao !== undefined) {
      // Campo com padrão declarado (o fuso): a chave é obrigatória NO DOCUMENTO,
      // mas a linha pode faltar — e então o compilador tem de escrever o padrão,
      // não deixar a chave de fora nem recusar.
      let semDoc = null
      try { semDoc = compilar(sem.join('\n')) } catch { /* fica null */ }
      const valor = semDoc?.flow?.nodes?.[0]?.config?.[chaveDoDoc]
      check(`[${classe.nome}] sem "${chave}:" o compilador escreve o padrão`, sem.length < classe.linhas.length && valor === campos[0].padrao, String(valor))
      continue
    }
    check(`[${classe.nome}] sem "${chave}:" o compilador recusa`, sem.length < classe.linhas.length && recusa(sem) !== null)
  }
}

// A cobertura do enum, por classe. A lista que a tela mostra é o enum do schema
// filtrado pelo vocabulário (`palavrasDoEnum`): se faltar palavra para algum
// valor, a lista é retirada inteira — então a cobertura tem de ser total, ou a
// pessoa fica sem lista nenhuma num campo de lista fechada.
//
// `tipo` fica fora, e não por conveniência: as `palavras` dele são `CLASSES`,
// cujas chaves são constantes de tipo de documento (`trigger.command`...), não
// valores de enum de config. Ele não escreve campo no `config` — escolhe a
// definição inteira.
const comDoc = ref.cabecalho.filter((c) => c.chave !== 'tipo' && c.palavras?.length && c.porClasse?.length)
check('há campo de cabeçalho com lista por classe', comDoc.length > 0, `${comDoc.length}`)

for (const campo of comDoc) {
  for (const pc of campo.porClasse) {
    check(
      `[${pc.classe}] "${campo.chave}" tem palavra para todo valor de ${pc.campoDoDocumento}`,
      Array.isArray(pc.palavras) && pc.palavras.length === (pc.valoresAceitos?.length ?? -1),
      `enum=${JSON.stringify(pc.valoresAceitos)} palavras=${JSON.stringify(pc.palavras)}`
    )
  }
}

// E as palavras não são decorativas: cada uma compila na classe dela, e a da
// outra classe é recusada. É a prova de que mostrar DUAS listas é o certo.
const quandoFor = ref.cabecalho.find((c) => c.chave === 'quando for')
check('"quando for" existe na referência com duas classes', quandoFor?.porClasse?.length === 2)

const FONTE = Object.fromEntries(CLASSES.map((c) => [c.nome, c.linhas]))
const comQuandoFor = (classe, valor) => {
  const base = FONTE[classe].filter((l) => !l.trimStart().startsWith('quando for:'))
  const i = base.findIndex((l) => l.trimStart().startsWith('tipo:'))
  return [...base.slice(0, i + 1), `  quando for: ${valor}`, ...base.slice(i + 1)]
}

for (const pc of quandoFor?.porClasse ?? []) {
  for (const palavra of pc.palavras ?? []) {
    let ok = false
    try { ok = !!compilar(comQuandoFor(pc.classe, palavra).join('\n')) } catch (e) { ok = e.message }
    check(`[${pc.classe}] "quando for: ${palavra}" compila`, ok === true, typeof ok === 'string' ? ok : '')
  }
  // Palavra da OUTRA classe: tem de ser recusada, apontando a linha.
  const outra = quandoFor.porClasse.find((o) => o.classe !== pc.classe)
  const intrusa = outra?.palavras?.[0]
  if (intrusa) {
    const erro = recusa(comQuandoFor(pc.classe, intrusa))
    check(`[${pc.classe}] "quando for: ${intrusa}" (de ${outra.classe}) é recusado`, erro !== null && /linha \d+/.test(erro ?? ''), erro ?? 'compilou')
  }
}

// Palavra que não existe em classe nenhuma: recusada nas duas.
for (const pc of quandoFor?.porClasse ?? []) {
  const erro = recusa(comQuandoFor(pc.classe, 'inventado'))
  check(`[${pc.classe}] "quando for: inventado" é recusado`, erro !== null, erro === null ? 'compilou' : '')
}

// A AJUDA NÃO PODE CITAR VALOR QUE O COMPILADOR RECUSA.
//
// Esta guarda nasceu de dois defeitos medidos: a ajuda de `casa` dizia
// "exato ou com argumento" (singular) e a de `quem` dizia "externo" — e o
// compilador recusa as duas, com a lista certa na mensagem de erro. Era a
// divergência exata que a ajuda contextual existe para não produzir: a tela
// ensinava a escrever uma palavra que a linha não aceita.
//
// A ajuda desses campos enumera os valores no formato `palavra = o que faz`,
// separados por ` · `. Então o lado esquerdo de cada ` = ` é uma afirmação
// sobre o que se pode ESCREVER, e tem de estar nas `palavras` do campo — que
// é a mesma lista que o compilador usa. E não para na comparação de listas:
// cada palavra citada é COMPILADA na classe onde o campo vale.
const LHS = (ajuda) => (ajuda ?? '')
  .split(' · ')
  .filter((t) => t.includes(' = '))
  .map((t) => t.slice(0, t.indexOf(' = ')).trim())

const comEnumeracao = ref.cabecalho.filter((c) => c.chave !== 'tipo' && c.palavras?.length && LHS(c.ajuda).length > 0)
check('há campo de cabeçalho cuja ajuda enumera valores', comEnumeracao.length >= 2, `${comEnumeracao.length}`)

// Troca o valor da linha do campo na fonte mínima da classe que a tem.
const classeDoCampo = (chave) => CLASSES.find((c) => c.linhas.some((l) => l.trimStart().startsWith(`${chave}:`)))?.nome ?? null
const comValor = (classe, chave, valor) =>
  FONTE[classe].map((l) => (l.trimStart().startsWith(`${chave}:`) ? `  ${chave}: ${valor}` : l))

for (const campo of comEnumeracao) {
  const classe = classeDoCampo(campo.chave)
  check(`"${campo.chave}" aparece na fonte mínima de alguma classe`, classe !== null)
  for (const palavra of LHS(campo.ajuda)) {
    // 1. a palavra citada está na lista fechada do campo
    check(`a ajuda de "${campo.chave}" cita "${palavra}", que é palavra do campo`, campo.palavras.includes(palavra), `palavras=${JSON.stringify(campo.palavras)}`)
    // 2. e COMPILA de verdade — comparar listas não bastaria se a lista
    //    estivesse errada dos dois lados.
    if (!classe) continue
    let ok = false
    try { ok = !!compilar(comValor(classe, campo.chave, palavra).join('\n')) } catch (e) { ok = e.message }
    check(`[${classe}] "${campo.chave}: ${palavra}" compila`, ok === true, typeof ok === 'string' ? ok : '')
  }
  // 3. o par negativo: palavra inventada é recusada apontando a linha. Sem
  //    isto, um campo que aceitasse qualquer coisa passaria nas duas acima.
  if (!classe) continue
  const erro = recusa(comValor(classe, campo.chave, 'inventado'))
  check(`[${classe}] "${campo.chave}: inventado" é recusado`, erro !== null && /linha \d+/.test(erro ?? ''), erro ?? 'compilou')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nA AJUDA DO CABEÇALHO BATE COM O SCHEMA, CLASSE POR CLASSE')
process.exit(falhas ? 1 : 0)
