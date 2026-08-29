// Confirma que nenhum arquivo-fonte, dashboard, documentação, Docker ou
// teste do repositório menciona mais o provedor "codex" — só a lógica de
// migração de compatibilidade em src/config.js pode citar a palavra.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.join(__dirname, '..')

const IGNORAR_DIRS = new Set(['node_modules', '.git', 'sessao', 'midia', 'data', 'modelos'])
// Migração codex -> off (src/config.js) e os próprios testes que citam
// "codex" pra descrever o que verificam — todos intencionais.
const PERMITIDO = new Set([
  path.join(RAIZ, 'src', 'config.js'),
  path.join(RAIZ, 'tests', 'config-migracao-codex.test.mjs'),
  path.join(RAIZ, 'tests', 'sem-codex.test.mjs'),
  path.join(RAIZ, 'package.json') // só o nome dos arquivos de teste acima, no script "test"
])

function * arquivos (dir) {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (!IGNORAR_DIRS.has(nome)) yield * arquivos(p)
    } else {
      yield p
    }
  }
}

let falhas = 0
const achados = []
for (const arq of arquivos(RAIZ)) {
  if (PERMITIDO.has(arq)) continue
  let conteudo
  try { conteudo = fs.readFileSync(arq, 'utf8') } catch { continue } // binário/ilegível, ignora
  if (/codex/i.test(conteudo)) achados.push(arq)
}

const ok = achados.length === 0
if (!ok) falhas++
console.log(`${ok ? '✅' : '❌'} nenhum arquivo (fora da migração de compatibilidade) menciona "codex"${ok ? '' : `\n   encontrado em: ${achados.map((a) => path.relative(RAIZ, a)).join(', ')}`}`)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nSEM CODEX OK')
process.exit(falhas ? 1 : 0)
