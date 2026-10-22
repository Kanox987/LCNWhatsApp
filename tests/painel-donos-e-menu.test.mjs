// AS CAPACIDADES QUE O MOTOR TINHA E O PAINEL NÃO ALCANÇAVA.
//
// Três CRUDs completos viviam no motor sem nenhuma porta no painel — e o
// público do painel é quem ALUGA o sistema e não tem terminal. Para essa
// pessoa, "existe no motor" e "não existe" são a mesma coisa.
//
//   donos  — `routes/owners.js`. O beco mais fechado dos três: a mensagem de
//            chave reservada manda usar "a tela de Donos", a tela não existia,
//            e `__owner__` é reservada, então nem pela aba Dados dava para
//            contornar. Sobrava mandar mensagem de si para si no WhatsApp ou
//            falar HTTP direto com o motor.
//   menu   — `routes/menu.js`, incluindo a pré-visualização que a própria rota
//            diz existir "para a UI". Até aqui o menu só se configurava de
//            dentro do WhatsApp, um campo por mensagem.
//   pools  — as rotas estavam mapeadas no BFF e o cliente do navegador só
//            tinha `list` e `create`. E pool é pré-requisito de TUDO: todo
//            template do catálogo exige um `poolId`.
//
// Este arquivo cruza as três camadas — motor, BFF, cliente do navegador —
// porque o defeito aqui nunca foi uma função errada: foi uma camada não
// repassar o que a de baixo oferecia, em silêncio.
import fs from 'node:fs'
import { paraJid } from '../src/web/public/pages/owners.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const ler = (caminho) => fs.readFileSync(new URL(caminho, import.meta.url), 'utf8')
const motorDonos = ler('../src/engine/server/routes/owners.js')
const motorMenu = ler('../src/engine/server/routes/menu.js')
const bff = ler('../src/web/router.js')
const clienteDoNavegador = ler('../src/web/public/api.js')
const clienteDoMotor = ler('../src/engine/client.js')
const telaDeDonos = ler('../src/web/public/pages/owners.js')
const navegacao = ler('../src/web/public/index.html')
const rotas = ler('../src/web/public/main.js')

// --- a corrente inteira, elo por elo -------------------------------------
//
// Cada rota do motor é procurada no cliente do motor, no BFF e no cliente do
// navegador. Faltando um elo, a capacidade existe e não chega a ninguém.
const correntes = [
  { nome: 'listar donos', motor: motorDonos, rotaDoMotor: "roteador.get('/owners'", bff: "/api/v1/owners'", cliente: 'owners' },
  { nome: 'cadastrar dono', motor: motorDonos, rotaDoMotor: "roteador.post('/owners'", bff: "roteador.post('/api/v1/owners'", cliente: 'add:' },
  { nome: 'remover dono', motor: motorDonos, rotaDoMotor: "roteador.delete('/owners/:contactId'", bff: "roteador.delete('/api/v1/owners/:contactId'", cliente: 'remove:' },
  { nome: 'menu efetivo', motor: motorMenu, rotaDoMotor: "'/menu-config/effective'", bff: "'/api/v1/menu-config/effective'", cliente: 'effective:' },
  { nome: 'ler config de menu', motor: motorMenu, rotaDoMotor: "roteador.get('/menu-config/:kind'", bff: "roteador.get('/api/v1/menu-config/:kind'", cliente: 'menuConfig' },
  { nome: 'salvar config de menu', motor: motorMenu, rotaDoMotor: "roteador.put('/menu-config/:kind'", bff: "roteador.put('/api/v1/menu-config/:kind'", cliente: 'save:' },
  { nome: 'apagar config de menu', motor: motorMenu, rotaDoMotor: "roteador.delete('/menu-config/:kind'", bff: "roteador.delete('/api/v1/menu-config/:kind'", cliente: 'remove:' }
]

for (const corrente of correntes) {
  check(`${corrente.nome}: existe no motor`, corrente.motor.includes(corrente.rotaDoMotor), corrente.rotaDoMotor)
  check(`${corrente.nome}: o BFF repassa`, bff.includes(corrente.bff), corrente.bff)
  check(`${corrente.nome}: o navegador alcança`, clienteDoNavegador.includes(corrente.cliente))
}

// O cliente do motor já tinha os dois wrappers prontos — era só o BFF que não
// os chamava. Este caso guarda isso para a próxima pessoa não reescrevê-los.
check('o cliente do motor já expunha donos', /donos:\s*{/.test(clienteDoMotor))
check('o cliente do motor já expunha menu', /menu:\s*{/.test(clienteDoMotor))
check('e agora o BFF usa os dois', bff.includes('aplicacao.motor.donos') && bff.includes('aplicacao.motor.menu'))

// --- pools: o cliente do navegador estava pela metade --------------------
//
// Pool é pré-requisito de todo template do catálogo. Com só `list` e `create`,
// não havia como pôr um número num pool pelo painel.
for (const metodo of ['get:', 'update:', 'remove:', 'saveMember:', 'removeMember:']) {
  check(`pools: o navegador alcança "${metodo}"`, clienteDoNavegador.includes(metodo))
}
for (const rota of ["'/api/v1/pools/:id/members/:instanceId'"]) {
  check('pools: o BFF já mapeava membros', bff.includes(rota))
}

// --- a tela de donos existe e está no caminho ----------------------------
check('a tela de donos está registrada na navegação', navegacao.includes('href="/owners"'))
check('e tem rota no painel', rotas.includes("pathname === '/owners'"))
check('a tela usa o cliente, não monta URL na mão', telaDeDonos.includes('api.owners.') && !telaDeDonos.includes('fetch('))

// O estado de arranque não pode ficar escondido: sem nenhum dono, comando
// restrito responde só ao próprio número do bot, e quem não sabe disso fica
// tentando no número errado.
check('a tela explica o estado "ainda sem dono"', telaDeDonos.includes('noOwnerYet'))

// A lista do motor vem como `{ contactId, since }`. Ler isso como texto não dá
// erro: dá "[object Object]" na tela — aconteceu, e é o jeito mais silencioso
// de uma lista mentir.
check('a tela lê contactId, não o objeto cru', telaDeDonos.includes('dono?.contactId'))

// --- o número, como uma pessoa o digita ----------------------------------
check('número puro vira JID', paraJid('5511988887777') === '5511988887777@s.whatsapp.net')
check('com + e pontuação também', paraJid('+55 (11) 98888-7777') === '5511988887777@s.whatsapp.net')
check('JID inteiro passa como está', paraJid('5511988887777@s.whatsapp.net') === '5511988887777@s.whatsapp.net')
check('espaço em volta não atrapalha', paraJid('  5511988887777  ') === '5511988887777@s.whatsapp.net')
check('vazio é recusado', paraJid('') === null)
check('curto demais é recusado', paraJid('123') === null)
check('texto sem número é recusado', paraJid('fulano') === null)
// O valor vira linha de autorização no banco. Um JID de GRUPO ali seria uma
// linha que parece autorizar e não corresponde a ninguém.
check('JID de grupo é recusado', paraJid('120363000000000000@g.us') === null)
check('JID com letras antes do domínio é recusado', paraJid('abc@s.whatsapp.net') === null)

// --- as três telas estão no caminho -------------------------------------
const telaDePools = ler('../src/web/public/pages/pools.js')
const telaDeMenu = ler('../src/web/public/pages/menu-config.js')

for (const [nome, caminho, tela, cliente] of [
  ['pools', '/pools', telaDePools, 'api.pools.'],
  ['menu', '/menu', telaDeMenu, 'api.menuConfig.']
]) {
  check(`a tela de ${nome} está na navegação`, navegacao.includes(`href="${caminho}"`))
  check(`e tem rota no painel`, rotas.includes(`pathname === '${caminho}'`))
  check(`a tela de ${nome} usa o cliente`, tela.includes(cliente))
}

// POOL RESERVADO NÃO SE APAGA PELA TELA. `__native__` atende as automações
// nativas do próprio sistema, e a primeira versão desta tela oferecia "Apagar
// pool" nele como se fosse um pool comum.
check('a tela de pools protege o pool do sistema', telaDePools.includes('ehReservado(pool.id)'))

// A TELA NÃO PODE PROMETER O QUE O MOTOR NÃO FAZ.
//
// `pool_members` é lido por exatamente um arquivo — a própria rota de CRUD.
// Nada no caminho de entrega consulta membro de pool: a validação confere que
// o POOL existe (`validate.js`), nunca os membros. Oferecer "pôr um número"
// como se mudasse quem atende seria prometer comportamento inexistente.
const consomePoolMembers = [
  '../src/engine/gatewayExecutor.js',
  '../src/engine/gatewaySink.js',
  '../src/engine/server/evaluator.js',
  '../src/engine/server/validate.js'
].filter((caminho) => ler(caminho).includes('pool_members'))
check('nada no caminho de entrega lê pool_members', consomePoolMembers.length === 0, consomePoolMembers.join(', '))
check('a validação confere a EXISTÊNCIA do pool', ler('../src/engine/server/validate.js').includes('FROM pools WHERE id = ?'))
check('e a tela avisa que membro não decide quem atende', telaDePools.includes('não decide quem atende'))

// Número DESCOBERTO (modo simples) não entra em pool: o motor exige linha na
// tabela `instances`, e eles existem como pasta mais processo. A tela precisa
// filtrar em vez de deixar o erro "Instância não encontrada: bare" aparecer.
check('a tela de pools não oferece número descoberto', telaDePools.includes('isBare !== true'))

// Apagar uma config de menu NÃO é o mesmo que limpar os campos: apagar devolve
// aquele nível à cascata.
check('a tela de menu separa apagar de limpar', telaDeMenu.includes('volta a herdar'))
check('a tela de menu mostra a cascata', telaDeMenu.includes('cascata'))
// O nome interno é "interactive" e o que sai é uma LISTA de seleção, não
// botões de resposta rápida. O rótulo tem de dizer o que a pessoa vai ver.
check('o formato de lista não é chamado de botões', !/bot[õo]/i.test(telaDeMenu.split('const FORMATOS')[1].split(']')[0]))

console.log(falhas === 0 ? '\npainel: donos, menu e pools — tudo certo' : `\npainel: donos, menu e pools — ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
