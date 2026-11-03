// A ajuda contextual aponta para a ação CERTA, ou é pior que ajuda nenhuma.
//
// O pedido exige que a explicação de uma função fique ao alcance sem abandonar
// a IDE. O servidor já entrega as 38 ações com os catorze campos; a única
// pergunta que ele não pode responder é QUAL delas a pessoa está escrevendo
// agora — essa depende do texto e do cursor, e é o que `ajudaNoCursor` resolve.
//
// Esta guarda existe porque errar aqui é silencioso: o painel nunca fica em
// branco, ele mostra a explicação de OUTRA ação, e a pessoa escreve o campo de
// uma obedecendo o limite de outra. O teste roda contra as ações REAIS vindas
// de `montarReferencia`, com o glossário e o schema de verdade, e não contra
// uma lista inventada aqui — senão provaria só que o teste concorda consigo.
import fs from 'fs'
import { montarReferencia } from '../src/lcn/referencia.js'
import * as glossario from '../src/web/public/logic/acoes.js'
import { ajudaNoCursor, linhaDoCursor } from '../src/web/public/logic/ajuda-no-cursor.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const acoes = montarReferencia({ prosa: glossario, schema }).acoes

// A derivação pode degradar para tudo `null` sem lançar erro nenhum (basta o
// `prosa` chegar com a forma errada). Sem esta conferência, os casos abaixo
// passariam contra uma referência vazia.
check('a referência chegou com as ações e com os campos derivados do schema',
  acoes.length >= 38 && acoes.some((a) => a.campos?.some((c) => c.tipo && c.tipo !== 'desconhecido')),
  `${acoes.length} ações`)

const TEXTO = [
  'comando: /foto',             // 1
  'dispara com: /foto',         // 2
  '',                           // 3
  'faz:',                       // 4
  '  envia arquivo produtos/capa.jpg',  // 5
  '    legenda: olha essa',     // 6
  '    sem arquivo: não achei', // 7
  '',                           // 8
  '  responde Pronto!',         // 9
  '# responde comentado',       // 10
  ''                            // 11
].join('\n')

// Posição do primeiro caractere de uma linha (base 1).
const inicioDaLinha = (n) => TEXTO.split('\n').slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0)

check('linhaDoCursor conta a partir de 1', linhaDoCursor(TEXTO, 0) === 1)
check('linhaDoCursor acha a linha do meio', linhaDoCursor(TEXTO, inicioDaLinha(5)) === 5)

const em = (linha, desloca = 0) => ajudaNoCursor({ texto: TEXTO, posicao: inicioDaLinha(linha) + desloca, acoes })

check('no cabeçalho não inventa ação', em(2) === null)

const naAcao = em(5, 5)
check('na linha da ação, acha a ação', naAcao?.acao?.palavra === 'envia arquivo', naAcao?.acao?.palavra)
check('na linha da ação, o campo é o que se escreve na mesma linha',
  naAcao?.campo?.escrita === 'na mesma linha', naAcao?.campo?.escrita)

const naLegenda = em(6, 6)
check('num campo indentado, continua na ação que abriu o bloco',
  naLegenda?.acao?.palavra === 'envia arquivo', naLegenda?.acao?.palavra)
check('e aponta o campo daquela linha', naLegenda?.campo?.escrita === 'legenda:', naLegenda?.campo?.escrita)

const semArquivo = em(7, 6)
check('o campo mais longo ganha do prefixo curto',
  semArquivo?.campo?.escrita === 'sem arquivo:', semArquivo?.campo?.escrita)

check('linha em branco dentro do bloco ainda é da ação de cima',
  em(8)?.acao?.palavra === 'envia arquivo', em(8)?.acao?.palavra)

const segunda = em(9, 4)
check('a ação seguinte troca a ajuda', segunda?.acao?.palavra === 'responde', segunda?.acao?.palavra)

check('comentário não abre ação', em(10, 3)?.acao?.palavra === 'responde', em(10, 3)?.acao?.palavra)

// "responde rico" e "responde" convivem; o realce já ordena pela mais longa, e
// a ajuda tem de concordar com o que está aceso.
const RICO = 'faz:\n  responde rico\n    texto: oi\n'
const comRico = ajudaNoCursor({ texto: RICO, posicao: RICO.indexOf('responde rico') + 4, acoes })
check('a palavra mais longa ganha ("responde rico" não vira "responde")',
  comRico?.acao?.palavra === 'responde rico', comRico?.acao?.palavra)

// `define:` é campo de outra ação; `define` é ação. A fronteira de palavra
// inteira vem de `realce.js`, e é ela que separa os dois.
const DEFINE = 'faz:\n  configura menu\n    define: nada\n'
const comDefine = ajudaNoCursor({ texto: DEFINE, posicao: DEFINE.indexOf('define:') + 2, acoes })
check('"define:" com dois-pontos não abre a ação "define"',
  comDefine?.acao?.palavra !== 'define', comDefine?.acao?.palavra)

// Sem as ações (o `/meta/linguagem` falhou), o editor continua: a ajuda some,
// não quebra.
check('sem ações, devolve null em vez de lançar',
  ajudaNoCursor({ texto: TEXTO, posicao: 60, acoes: [] }) === null)
check('sem argumento nenhum, devolve null', ajudaNoCursor() === null)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nAJUDA NO CURSOR OK')
process.exit(falhas ? 1 : 0)
