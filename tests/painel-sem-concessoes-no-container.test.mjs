// O painel que roda DENTRO do container é o do cliente. As concessões são o
// teto que o administrador lhe deu: se esse painel tivesse a rota que as
// altera, o teto teria um botão na mão de quem ele limita. No host (painel do
// administrador) a rota continua existindo.
import { criarRoteadorWeb } from '../src/web/router.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const chamadas = []
const aplicacao = {
  motor: {},
  diretorio: {},
  instancias: {
    obterConcessoes: (id) => { chamadas.push(['GET', id]); return { concessoes: {} } },
    definirConcessoes: (id, corpo) => { chamadas.push(['PUT', id, corpo]); return { concessoes: corpo } }
  }
}
const ctx = (body) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const tentar = async (roteador, metodo, caminho, body) => {
  try { await roteador.resolver(metodo, caminho, ctx(body)); return 'ok' } catch (erro) { return erro.status }
}

const dentro = criarRoteadorWeb(aplicacao, { emContainer: () => true })
check('no container: PUT /grants não existe (404)', await tentar(dentro, 'PUT', '/api/v1/instances/wa-000001/grants', { 'hardware.maxMidiaMB': 999 }) === 404)
check('no container: GET /grants não existe (404)', await tentar(dentro, 'GET', '/api/v1/instances/wa-000001/grants') === 404)
check('no container: nenhuma concessão foi lida nem gravada', chamadas.length === 0, JSON.stringify(chamadas))

const fora = criarRoteadorWeb(aplicacao, { emContainer: () => false })
check('no host: PUT /grants responde', await tentar(fora, 'PUT', '/api/v1/instances/wa-000001/grants', { 'hardware.maxMidiaMB': 5 }) === 'ok')
check('no host: GET /grants responde', await tentar(fora, 'GET', '/api/v1/instances/wa-000001/grants') === 'ok')
check('no host: as duas chegaram ao serviço', chamadas.length === 2)

console.log(falhas === 0 ? '\npainel sem concessões no container: tudo certo' : `\npainel sem concessões no container: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
