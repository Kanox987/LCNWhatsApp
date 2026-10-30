// Prova que o texto do estado vazio NÃO menciona terminal e que a função
// abrirCriacao existe no escopo do renderDashboard. O contrato é textual:
// se alguém mudar o emptyState de volta pra "terminal", este teste falha.
import fs from 'node:fs'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const dashboardSource = fs.readFileSync(new URL('../src/web/public/pages/dashboard.js', import.meta.url), 'utf8')

check('empty state does NOT mention terminal', !dashboardSource.includes('ferramenta de terminal'))
check('empty state includes Novo número button action', dashboardSource.includes("button('Novo número'") && dashboardSource.includes('abrirCriacao'))
check('empty state uses guided copy ("Comece adicionando")', dashboardSource.includes('Comece adicionando um número'))

if (falhas > 0) process.exit(1)