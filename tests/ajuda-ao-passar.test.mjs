// A caixa de passar o mouse explica a palavra CERTA, ou é pior que caixa nenhuma.
//
// Ela é a ajuda "como numa IDE": o ponteiro para sobre `casa:` e aparece o que
// o campo faz e o que aceita. O erro aqui é silencioso do mesmo jeito que no
// painel lateral (`ajuda-no-cursor.test.mjs`): a caixa não fica vazia, ela
// explica OUTRA coisa. O caso que mais engana é o cabeçalho, que vem recuado
// dentro de `automação` como os campos de uma ação — `menu:` ali não é campo de
// ação nenhuma.
//
// Roda contra a referência REAL de `montarReferencia` e contra um modelo do
// catálogo, não contra uma lista inventada aqui.
import fs from 'fs'
import { montarReferencia } from '../src/lcn/referencia.js'
import * as glossario from '../src/web/public/logic/acoes.js'
import { ajudaNaPosicao } from '../src/web/public/logic/ajuda-ao-passar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const referencia = montarReferencia({ prosa: glossario, schema })
const texto = fs.readFileSync(new URL('../src/engine/templates/catalog/advertir.lcn', import.meta.url), 'utf8')
const linhas = texto.split('\n')

// A linha (base 1) da primeira ocorrência, e a coluna do primeiro caractere.
const linhaDe = (comeco) => linhas.findIndex((l) => l.trimStart().startsWith(comeco)) + 1
const em = (comeco, desloca = 0) => {
  const linha = linhaDe(comeco)
  if (!linha) return undefined
  return ajudaNaPosicao({ texto, linha, coluna: linhas[linha - 1].search(/\S/) + desloca, referencia })
}

check('o modelo tem as linhas que o teste usa',
  ['casa:', 'menu:', 'acesso:', 'remove do grupo', 'quem: quem foi marcado', 'se evento', 'configurável', 'command:', 'rótulo:'].every((c) => linhaDe(c) > 0))

const casa = em('casa:')
check('casa: explica o campo do cabeçalho', casa?.titulo === 'casa:' && Boolean(casa.texto), casa?.titulo)
check('casa: diz o que aceita, nas palavras do .lcn', casa?.aceita?.includes('começa com'), casa?.aceita?.join(', '))

const menu = em('menu:')
check('menu: recuado dentro de automação é cabeçalho, não campo de ação', menu?.titulo === 'menu:', menu?.titulo)

const acesso = em('acesso:')
check('acesso: não fala só de administradores',
  acesso?.texto?.includes('dono') && acesso.texto.includes('lista') && !acesso.rotulo, acesso?.rotulo || acesso?.texto)

const acao = em('remove do grupo', 3)
check('na linha da ação, explica a ação', acao?.titulo === 'remove do grupo' && Boolean(acao.texto), acao?.titulo)
check('a ação lista os campos que aceita', acao?.campos?.includes('quem:'), acao?.campos?.join(', '))

const quem = em('quem: quem foi marcado')
check('debaixo da ação, quem: é o campo da ação e não o do cabeçalho',
  quem?.titulo === 'quem:' && quem.aceita?.includes('quem foi marcado'), quem?.aceita?.join(', '))

check('se explica a condição e os operadores', em('se evento')?.aceita?.includes('=='))
check('configurável explica o bloco', em('configurável')?.titulo === 'configurável')
check('a declaração debaixo do bloco é explicada pelo bloco', /configurável/.test(em('command:')?.rotulo || ''), em('command:')?.rotulo)
check('rótulo: debaixo da declaração é o filho do bloco', em('rótulo:')?.titulo === 'rótulo:')

const recuo = linhaDe('casa:')
check('no recuo não há palavra', ajudaNaPosicao({ texto, linha: recuo, coluna: 0, referencia }) === null)
check('depois do fim da linha não há palavra',
  ajudaNaPosicao({ texto, linha: recuo, coluna: linhas[recuo - 1].length + 5, referencia }) === null)
check('linha vazia, linha que não existe e sem referência dão null',
  ajudaNaPosicao({ texto: 'a\n\nb', linha: 2, coluna: 0, referencia }) === null &&
  ajudaNaPosicao({ texto, linha: linhas.length + 10, coluna: 0, referencia }) === null &&
  ajudaNaPosicao({ texto, linha: recuo, coluna: 3, referencia: null }) === null)
check('comentário não é explicado',
  ajudaNaPosicao({ texto: '  # casa: exato', linha: 1, coluna: 4, referencia }) === null)

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\najuda-ao-passar: tudo certo')
