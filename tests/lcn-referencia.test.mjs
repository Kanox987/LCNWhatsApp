// A referência da linguagem: ela existe para que ninguém precise adivinhar, e
// o único jeito de ela continuar servindo é NÃO ter sido escrita à mão.
//
// Os casos aqui guardam três coisas, e cada uma já deu errado nesta base de
// um jeito ou de outro:
//
//   1. A tabela e o compilador não podem divergir. A tabela não LÊ nada — quem
//      lê é o `switch` de compilar.js. Então o cruzamento é feito sobre o
//      código-fonte do compilador, nos dois sentidos: campo que o compilador
//      aceita e a tabela não lista ficaria invisível no painel e no realce;
//      campo que a tabela lista e o compilador recusa viraria promessa falsa.
//      É o mesmo cruzamento que `painel-conexoes-cobertura` faz com a página.
//
//   2. Todo trecho oferecido tem de COMPILAR. Trecho que não compila é pior do
//      que trecho nenhum, porque a pessoa confia nele e o erro aparece como se
//      fosse culpa dela.
//
//   3. A prosa continua num lugar só. A referência JUNTA vocabulário e
//      glossário; se ela passar a escrever descrição própria, voltou a
//      divergência que o cabeçalho de vocabulario.js documenta.
import fs from 'node:fs'
import { compilar } from '../src/lcn/compilar.js'
import { exemploDeChamada, montarReferencia, trechoCompilavel, TRECHOS } from '../src/lcn/referencia.js'
import {
  ACOES, BLOCOS_DE_TEMPLATE, CAMPOS_DO_CABECALHO, CAMPOS_DO_TEMPLATE, MARCAS_DO_CABECALHO
} from '../src/lcn/vocabulario.js'
import * as glossario from '../src/web/public/logic/acoes.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const fonteDoCompilador = fs.readFileSync(new URL('../src/lcn/compilar.js', import.meta.url), 'utf8')

// --- 1. a tabela contra o compilador, nos dois sentidos -------------------
//
// O recorte é o `switch (chave)` do cabeçalho da automação. Cruzar contra o
// arquivo inteiro apanharia `case` de outros switches (tipo de envio, forma de
// resposta) e o teste acusaria divergência que não existe.
const inicioDoSwitch = fonteDoCompilador.indexOf('switch (chave)')
const fimDoSwitch = fonteDoCompilador.indexOf('não conheço o campo', inicioDoSwitch)
check('achei o switch do cabeçalho no compilador', inicioDoSwitch > 0 && fimDoSwitch > inicioDoSwitch)
const trechoDoSwitch = fonteDoCompilador.slice(inicioDoSwitch, fimDoSwitch)

const casosDoCompilador = new Set(
  [...trechoDoSwitch.matchAll(/case '([^']+)'/g)].map((m) => m[1])
)
const chavesDaTabela = new Set(CAMPOS_DO_CABECALHO.map((c) => c.chave))

for (const caso of casosDoCompilador) {
  check(`o compilador aceita "${caso}:" e a tabela lista`, chavesDaTabela.has(caso))
}
for (const chave of chavesDaTabela) {
  check(`a tabela lista "${chave}:" e o compilador aceita`, casosDoCompilador.has(chave))
}

// As linhas soltas não passam pelo switch: são `if` antes dele, comparando o
// texto inteiro da linha.
for (const marca of MARCAS_DO_CABECALHO) {
  check(
    `o compilador conhece a linha solta "${marca.chave}"`,
    fonteDoCompilador.includes(`l.texto === '${marca.chave}'`)
  )
}

// O cabeçalho do template é um `if/else if` por chave, não um switch.
for (const campo of CAMPOS_DO_TEMPLATE) {
  check(
    `o compilador conhece "${campo.chave}:" no cabeçalho do template`,
    fonteDoCompilador.includes(`chave === '${campo.chave}'`)
  )
}

for (const bloco of BLOCOS_DE_TEMPLATE) {
  check(
    `o compilador conhece o bloco "${bloco.bloco}"`,
    fonteDoCompilador.includes(`'${bloco.bloco}'`) || fonteDoCompilador.includes(`^${bloco.bloco}\\s`)
  )
}

// --- 2. a referência montada ---------------------------------------------
const ref = montarReferencia({ prosa: glossario })

check('a referência traz os campos do cabeçalho', ref.cabecalho.length === CAMPOS_DO_CABECALHO.length, `${ref.cabecalho.length}`)
check('a referência traz as 13 ações', ref.acoes.length === ACOES.length, `${ref.acoes.length}`)

// Nenhum campo e nenhuma ação pode aparecer sem explicação: um item sem frase
// no painel se lê como "isto não serve para nada".
const campoSemAjuda = ref.cabecalho.filter((c) => !c.ajuda).map((c) => c.chave)
check('todo campo do cabeçalho tem explicação', campoSemAjuda.length === 0, campoSemAjuda.join(', '))
const acaoSemResumo = ref.acoes.filter((a) => !a.resumo).map((a) => a.palavra)
check('toda ação tem resumo', acaoSemResumo.length === 0, acaoSemResumo.join(', '))
const marcaSemAjuda = ref.marcas.filter((m) => !m.ajuda).map((m) => m.chave)
check('toda linha solta tem explicação', marcaSemAjuda.length === 0, marcaSemAjuda.join(', '))

// Sem o glossário a referência sai com as palavras e sem as frases — e isso é
// o certo, não um erro: é o que acontece ao gerar documento fora do painel.
const refSemProsa = montarReferencia()
check('sem glossário ainda saem as palavras', refSemProsa.acoes.length === ACOES.length)
check('sem glossário as palavras do realce continuam', refSemProsa.palavras.acoes.length === ACOES.length)

// --- o realce recebe palavras, não a forma das tabelas -------------------
for (const grupo of ['blocos', 'campos', 'marcas', 'acoes', 'estrutura', 'arquivos', 'operadores', 'valores']) {
  const lista = ref.palavras[grupo]
  const ok = Array.isArray(lista) && lista.length > 0 && lista.every((p) => typeof p === 'string' && p.trim())
  check(`as palavras de "${grupo}" são texto não vazio`, ok, `${lista?.length}`)
}
check(
  'as palavras de ação são exatamente as 13 da tabela',
  ref.palavras.acoes.join('|') === ACOES.map((a) => a.palavra).join('|')
)

// --- 3. todo trecho compila ----------------------------------------------
for (const trecho of TRECHOS) {
  let erro = null
  try { compilar(trechoCompilavel(trecho)) } catch (e) { erro = e.message }
  check(`o trecho "${trecho.chave}" compila`, erro === null, erro || undefined)
  check(`o trecho "${trecho.chave}" tem rótulo e motivo`, Boolean(trecho.rotulo && trecho.quando))
}
check('existe o trecho do carrossel, que é o pedido do dono', TRECHOS.some((t) => t.chave === 'carrossel-de-busca'))

// Todo trecho diz ONDE vai. A tela traduz esse `onde` numa frase; um valor
// que ela não conhece sairia sem frase, e inserir um trecho de corpo no topo
// do arquivo quebra o texto sem o botão ter avisado nada.
const ONDES_CONHECIDOS = ['arquivo', 'corpo', 'blocos']
for (const trecho of TRECHOS) {
  check(`o trecho "${trecho.chave}" diz onde vai`, ONDES_CONHECIDOS.includes(trecho.onde), trecho.onde)
}

// NENHUM trecho escreve quantidade de resultado, de card ou de item. Quem
// decide quantos é quem declara a conexão, e o padrão é "todos os que vieram";
// um trecho com `quantos: 5` ensinaria o contrário por exemplo.
for (const trecho of TRECHOS) {
  const temQuantos = /\bquantos:/.test(trecho.texto)
  check(`o trecho "${trecho.chave}" não fixa quantos resultados`, !temQuantos)
}

// --- o exemplo de chamada ------------------------------------------------
//
// Ele é gerado da tabela da ação `chama`, então o que se confere é que o texto
// gerado passa pelo compilador — nos três casos que existem: sem arquivo, com
// um, e com dois (onde as origens têm de ser DIFERENTES, senão as duas
// entradas apontam para o mesmo arquivo).
const casosDeExemplo = [
  {
    nome: 'sem arquivo',
    conexao: 'midia',
    funcao: { nome: 'buscar', entradas: [{ nome: 'busca', tipo: 'texto', obrigatoria: true, comoEscrever: 'busca: "o que vai aqui"' }] }
  },
  {
    nome: 'com um arquivo',
    conexao: 'imagem',
    funcao: { nome: 'figurinha', entradas: [{ nome: 'arquivo', tipo: 'mídia', obrigatoria: true, recebeArquivo: true }] }
  },
  {
    nome: 'com dois arquivos',
    conexao: 'imagem',
    funcao: {
      nome: 'trocar_fundo',
      entradas: [
        { nome: 'foto', tipo: 'mídia', obrigatoria: true, recebeArquivo: true },
        { nome: 'fundo', tipo: 'mídia', obrigatoria: true, recebeArquivo: true }
      ]
    }
  }
]

for (const caso of casosDeExemplo) {
  const texto = exemploDeChamada(caso)
  let erro = null
  try { compilar(trechoCompilavel({ onde: 'corpo', texto })) } catch (e) { erro = e.message }
  check(`o exemplo ${caso.nome} compila`, erro === null, erro || undefined)
}

const comDois = exemploDeChamada(casosDeExemplo[2])
const origens = [...comDois.matchAll(/: (a mídia[^\n]*)/g)].map((m) => m[1].trim())
check('com dois arquivos, as origens são diferentes', origens.length === 2 && origens[0] !== origens[1], origens.join(' / '))

// --- a mensagem de erro passou a ensinar ---------------------------------
//
// Era "não conheço o campo X" e nada mais, numa linguagem sem documentação
// nenhuma: mandava procurar a palavra certa num catálogo que não existia.
const erroDeCampo = (() => {
  try {
    compilar('automação x\n  tipo: comando\n  dispara com: /oi\n  nomee: Oi\n\n  responde "oi"')
    return null
  } catch (e) { return e.message }
})()
check('campo desconhecido lista os campos que existem', /Conheço: .*dispara com:/.test(erroDeCampo || ''), erroDeCampo?.slice(0, 60))
check('e lista as linhas soltas também', /linhas soltas: .*só dono/.test(erroDeCampo || ''))

// A lista é FILTRADA pela classe: oferecer "casa:" a um vigia manda a pessoa
// escrever uma linha que o compilador vai recusar na próxima tentativa.
const erroDeVigia = (() => {
  try {
    compilar('automação x\n  tipo: vigia\n  dispara com: qualquer mensagem\n  casinha: exato\n\n  responde "oi"')
    return null
  } catch (e) { return e.message }
})()
check('num vigia a lista não oferece "casa:"', !/\bcasa:/.test(erroDeVigia || ''), erroDeVigia?.slice(0, 80))
check('num vigia a lista oferece "palavras:"', /palavras:/.test(erroDeVigia || ''))
check('e oferece as linhas soltas do vigia', /com link/.test(erroDeVigia || ''))

console.log(falhas === 0 ? '\nreferência da linguagem: tudo certo' : `\nreferência da linguagem: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
