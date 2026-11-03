// A guarda que o T1-5 do plano exige e que não existia: a v2 publicou
// 011_api_keys.sql e 011_pool_routing.sql no mesmo número, e como
// schema_migrations.version é INTEGER PRIMARY KEY com
// `if (aplicada.get(version)) return`, a segunda migração do mesmo número é
// PERDIDA EM SILÊNCIO — nenhum erro, nenhuma tabela.
//
// O contrato está escrito em docs/engineering/lcn-v2/MIGRATION.md §2.4.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PASTA = path.join(__dirname, '..', 'src', 'engine', 'server', 'migrations')

// O MESMO filtro de listarMigracoes (src/engine/server/db.js): o que não casa
// com ele é ignorado em silêncio pelo aplicador.
const PADRAO_DO_APLICADOR = /^\d+_.+\.sql$/

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const todos = fs.readdirSync(PASTA)
const sql = todos.filter((n) => n.endsWith('.sql'))

check('a pasta de migrações existe e tem arquivos .sql', sql.length > 0, `${sql.length} arquivos`)

// 1 — nenhum número repetido. É o defeito T1-5, e é o que perde dado.
const porNumero = new Map()
for (const nome of sql) {
  const m = nome.match(/^(\d+)/)
  if (!m) continue
  const version = Number(m[1])
  if (!porNumero.has(version)) porNumero.set(version, [])
  porNumero.get(version).push(nome)
}
const repetidos = [...porNumero.entries()].filter(([, nomes]) => nomes.length > 1)
check(
  'nenhum número de migração aparece duas vezes',
  repetidos.length === 0,
  repetidos.map(([v, nomes]) => `${v}: ${nomes.join(' + ')}`).join('; ')
)

// 2 — todo .sql é visto pelo aplicador. Arquivo fora do padrão não dá erro:
// simplesmente nunca roda.
const invisiveis = sql.filter((n) => !PADRAO_DO_APLICADOR.test(n))
check(
  'todo arquivo .sql casa com o filtro do aplicador (senão é ignorado em silêncio)',
  invisiveis.length === 0,
  invisiveis.join(', ')
)

// 3 — três dígitos. O aplicador ordena com .sort() de STRING, então
// "10_x.sql" rodaria ANTES de "009_x.sql".
const prefixoTorto = sql
  .map((n) => [n, n.match(/^(\d+)/)])
  .filter(([, m]) => m && m[1].length !== 3)
  .map(([n]) => n)
check(
  'todo prefixo tem exatamente três dígitos (a ordenação é de string, não numérica)',
  prefixoTorto.length === 0,
  prefixoTorto.join(', ')
)

// 4 — a ordem que o aplicador vai usar é a ordem numérica. Prova direta do
// que as regras 2 e 3 protegem, em vez de confiar nelas.
const ordemDoAplicador = sql.filter((n) => PADRAO_DO_APLICADOR.test(n)).sort()
const ordemNumerica = [...ordemDoAplicador].sort(
  (a, b) => Number(a.match(/^(\d+)/)[1]) - Number(b.match(/^(\d+)/)[1])
)
check(
  'a ordem alfabética do aplicador é igual à ordem numérica',
  ordemDoAplicador.join('|') === ordemNumerica.join('|')
)

// 5 — a guarda tem de PEGAR o caso real da v2. Sem isto, as regras acima
// podem estar verdes por acidente da árvore atual.
const simulado = ['009_declared_variables.sql', '011_enquetes.sql', '011_api_keys.sql', '011_pool_routing.sql']
const mapaSimulado = new Map()
for (const nome of simulado) {
  const v = Number(nome.match(/^(\d+)/)[1])
  mapaSimulado.set(v, [...(mapaSimulado.get(v) || []), nome])
}
check(
  'a regra de número repetido reprova o caso real da v2 (dois 011)',
  [...mapaSimulado.values()].some((nomes) => nomes.length > 1)
)
check(
  'a regra de três dígitos reprova "10_retencao.sql"',
  '10_retencao.sql'.match(/^(\d+)/)[1].length !== 3
)
check(
  'a regra do filtro reprova "migracao_nova.sql" (sem número)',
  !PADRAO_DO_APLICADOR.test('migracao_nova.sql')
)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nNUMERAÇÃO DE MIGRAÇÕES OK')
process.exit(falhas ? 1 : 0)
