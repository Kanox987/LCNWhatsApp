// A CORRENTE DAS LISTAS: motor → cliente do motor → BFF → navegador → tela.
// Mesmo cuidado de `painel-donos-e-menu`: o defeito típico é uma camada não
// repassar o que a de baixo oferece, em silêncio.
import fs from 'node:fs'
import { nomeDeLista } from '../src/web/public/pages/listas.js'
import { normalizarNomeDeLista } from '../src/engine/server/listas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const ler = (caminho) => fs.readFileSync(new URL(caminho, import.meta.url), 'utf8')

const motor = ler('../src/engine/server/routes/listas.js')
const bff = ler('../src/web/router.js')
const navegador = ler('../src/web/public/api.js')
const clienteDoMotor = ler('../src/engine/client.js')
const rotas = ler('../src/web/public/main.js')
const menu = ler('../src/web/public/index.html')

const correntes = [
  { nome: 'listar listas', motor: "roteador.get('/listas'", bff: "roteador.get('/api/v1/listas'", cliente: "request('/listas')" },
  { nome: 'ver uma lista', motor: "roteador.get('/listas/:nome'", bff: "roteador.get('/api/v1/listas/:nome'", cliente: 'get: (nome)' },
  { nome: 'pôr na lista', motor: "roteador.post('/listas/:nome/membros'", bff: "roteador.post('/api/v1/listas/:nome/membros'", cliente: 'add: (nome' },
  { nome: 'tirar da lista', motor: "roteador.delete('/listas/:nome/membros/:contactId'", bff: "roteador.delete('/api/v1/listas/:nome/membros/:contactId'", cliente: 'remove: (nome' },
  { nome: 'apagar a lista', motor: "roteador.delete('/listas/:nome'", bff: "roteador.delete('/api/v1/listas/:nome'", cliente: 'clear: (nome' }
]
for (const c of correntes) {
  check(`${c.nome}: existe no motor`, motor.includes(c.motor))
  check(`${c.nome}: o BFF repassa`, bff.includes(c.bff))
  check(`${c.nome}: o navegador alcança`, navegador.includes(c.cliente))
}
check('o cliente do motor tem listas', /listas:\s*{/.test(clienteDoMotor))
check('a tela está nas rotas do painel', rotas.includes("'/listas'") && rotas.includes('renderListas'))
check('a tela está no menu lateral', menu.includes('href="/listas"'))

// O nome que a tela aceita é o mesmo que o motor aceita.
for (const bruto of ['autorizados', 'Clientes VIP', 'time-A', 'ação_1', ' x ']) {
  check(`nome “${bruto}” igual ao do motor`, nomeDeLista(bruto) === (normalizarNomeDeLista(bruto) || null), `${nomeDeLista(bruto)}`)
}
for (const ruim of ['', '1abc', '__x', 'a'.repeat(33), 'a b!']) {
  check(`nome “${ruim}” recusado`, nomeDeLista(ruim) === null && !normalizarNomeDeLista(ruim))
}

process.exit(falhas ? 1 : 0)
