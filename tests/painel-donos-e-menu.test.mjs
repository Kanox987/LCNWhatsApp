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
//   menu   — `routes/menu.js`. TEVE aba própria no painel e DEIXOU de ter:
//            o dono pediu que o menu fosse só um comando (automação comum),
//            sem aba separada. A configuração por conversa e por tipo de
//            conversa passou toda para o comando `configura menu` (campos
//            numeração, famílias, volta ao padrão, herdar e `onde vale`,
//            inclusive outra conversa). O painel ficou só com VER e APAGAR,
//            na aba Dados de cada conversa: conferir o menu sem mandar /menu
//            no grupo, e limpar a configuração de conversa onde o comando não
//            roda mais. GRAVAR não passa pelo painel. Ver
//            docs/engineering/lcn-v2/MENU_COMO_AUTOMACAO.md.
//   pools  — as rotas estavam mapeadas no BFF e o cliente do navegador só
//            tinha `list` e `create`. E pool é pré-requisito de TUDO: todo
//            template do catálogo exige um `poolId`.
//
// Este arquivo cruza as três camadas — motor, BFF, cliente do navegador —
// porque o defeito aqui nunca foi uma função errada: foi uma camada não
// repassar o que a de baixo oferecia, em silêncio.
import fs from 'node:fs'
import { paraJid } from '../src/web/public/pages/owners.js'
import { conversaPeloId, linhasDoMenu, nivelDoTipo, origemDoCampo, semFamiliasConfiguradas } from '../src/web/public/logic/menuDaConversa.js'

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
  { nome: 'remover dono', motor: motorDonos, rotaDoMotor: "roteador.delete('/owners/:contactId'", bff: "roteador.delete('/api/v1/owners/:contactId'", cliente: 'remove:' }
]

for (const corrente of correntes) {
  check(`${corrente.nome}: existe no motor`, corrente.motor.includes(corrente.rotaDoMotor), corrente.rotaDoMotor)
  check(`${corrente.nome}: o BFF repassa`, bff.includes(corrente.bff), corrente.bff)
  check(`${corrente.nome}: o navegador alcança`, clienteDoNavegador.includes(corrente.cliente))
}

// O cliente do motor já tinha o wrapper pronto — era só o BFF que não o
// chamava. Este caso guarda isso para a próxima pessoa não reescrevê-lo.
check('o cliente do motor já expunha donos', /donos:\s*{/.test(clienteDoMotor))
check('e o BFF usa', bff.includes('aplicacao.motor.donos'))

// --- o menu deixou de ter aba --------------------------------------------
//
// A aba saiu e a GRAVAÇÃO pelo painel saiu com ela: um caminho só para mudar
// o menu, o comando. Mas duas coisas não têm como ser feitas pelo comando, e
// voltaram como corrente inteira (motor → cliente do motor → BFF → navegador),
// mostradas na aba Dados de cada conversa:
//   - ver o menu que vale numa conversa sem mandar /menu nela (num grupo,
//     mandar /menu publica o menu para todo mundo);
//   - apagar a configuração própria de uma conversa onde o comando não roda
//     mais (o bot saiu do grupo, id errado). A chave é reservada, então a
//     lista de variáveis da aba Dados não a apaga.
check('a rota de configuração de menu continua no motor', motorMenu.includes("roteador.put('/menu-config/:kind'"))
check('ver o menu da conversa: o BFF repassa', bff.includes("roteador.get('/api/v1/menu-config/effective'"))
check('apagar a configuração da conversa: o BFF repassa', bff.includes("roteador.delete('/api/v1/menu-config/:kind'"))
check('gravar pelo painel continua fora do BFF', !bff.includes("roteador.put('/api/v1/menu-config"))
check('o cliente do motor tem só ver e apagar', /\bmenu:\s*{/.test(clienteDoMotor) && clienteDoMotor.includes("requisitar('GET', `/menu-config/effective") && clienteDoMotor.includes("requisitar('DELETE', `/menu-config/") && !clienteDoMotor.includes("requisitar('PUT', `/menu-config"))
check('o navegador alcança ver e apagar', clienteDoNavegador.includes('menuConfig:') && clienteDoNavegador.includes('effective:') && clienteDoNavegador.includes('removeOwn:'))
const telaDeDados = ler('../src/web/public/pages/entities.js')
check('a aba Dados mostra o menu da conversa', telaDeDados.includes('painelDoMenu(kind, item)') && telaDeDados.includes('api.menuConfig.effective('))
check('e apaga a configuração própria', telaDeDados.includes('api.menuConfig.removeOwn('))
check('a aba Dados não grava menu', !/api\.menuConfig\.(set|save|put)/.test(telaDeDados))
check('conversa fora da busca abre pelo número ou id', telaDeDados.includes('conversaPeloId('))
// O padrão de todos os grupos / todo o privado aparece e se apaga pela aba
// Dados: sem isso, o dono não sabe se um rodapé vem do padrão do tipo ou do
// documento do /menu, e para limpar o padrão precisaria instalar outro
// comando só para isso.
check('a aba Dados mostra o padrão do tipo', telaDeDados.includes('efetivo?.padraoDoTipo') && telaDeDados.includes('Nada configurado neste nível.'))
check('e apaga o padrão do tipo', telaDeDados.includes('api.menuConfig.removeDefault(') && clienteDoNavegador.includes('removeDefault:'))
check('nível do tipo: grupo é todos os grupos', nivelDoTipo('group').kind === 'group_default' && nivelDoTipo('direct').kind === 'direct_default')
{
  const fontes = { propria: { header: 'A' }, padraoDoTipo: { header: 'G', footer: 'Promoção X' }, doDocumento: { emptyText: 'nada', footer: 'doc' }, chatKind: 'group' }
  check('origem: a conversa vence', origemDoCampo('header', fontes) === 'desta conversa')
  check('origem: o rodapé vem do padrão de todos os grupos, não do documento', origemDoCampo('footer', fontes) === 'de todos os grupos')
  check('origem: o que só o documento define', origemDoCampo('emptyText', fontes) === 'do comando de menu')
  check('origem: o resto é o padrão do sistema', origemDoCampo('buttonTitle', fontes) === 'padrão do sistema')
  check('origem no privado fala de todo o privado', origemDoCampo('footer', { ...fontes, chatKind: 'direct' }) === 'de todo o privado')
  check('linhas com fontes trazem a origem', linhasDoMenu({ footer: 'Promoção X' }, fontes)[0]?.origem === 'de todos os grupos' && linhasDoMenu({ footer: 'x' })[0]?.origem === undefined)
}

// O que a tela escreve: palavras, não códigos, e '' aparece como "em branco"
// em vez de uma linha vazia que parece bug.
{
  const linhas = linhasDoMenu({ format: 'interactive', footer: '', numbered: false, families: ['vendas', 'suporte'] })
  const valor = (campo) => linhas.find((l) => l.campo === campo)?.valor
  check('formato aparece como "com botões"', valor('format') === 'com botões')
  check('rodapé vazio aparece como "(em branco)"', valor('footer') === '(em branco)')
  check('numeração aparece como sim/não', valor('numbered') === 'não')
  check('famílias aparecem em lista', valor('families') === 'vendas, suporte')
  check('"*" aparece como todas', linhasDoMenu({ families: '*' })[0]?.valor === 'todas')
  check('campo ausente não aparece (é herdado)', linhasDoMenu({ header: 'Oi' }).length === 1 && linhasDoMenu({}).length === 0)
  check('sem famílias configuradas a tela diz "todas"', semFamiliasConfiguradas({ header: 'x' }) && !semFamiliasConfiguradas({ families: [] }))
}
check('abrir pelo número vira contato', conversaPeloId('+55 (11) 99999-8888')?.id === '5511999998888@s.whatsapp.net' && conversaPeloId('5511999998888').kind === 'contact')
check('abrir pelo id de grupo vira grupo', conversaPeloId('120363000000000000@g.us')?.kind === 'group')
check('abrir pelo @lid vira contato', conversaPeloId('123456789@lid')?.kind === 'contact')
check('texto qualquer ou número curto é recusado', conversaPeloId('fulano') === null && conversaPeloId('1234') === null && conversaPeloId('') === null)
check('a aba Menu saiu da navegação', !navegacao.includes('href="/menu"'))
check('a tela menu-config.js não existe mais', !fs.existsSync(new URL('../src/web/public/pages/menu-config.js', import.meta.url)))
check('e o roteador do painel não a importa', !rotas.includes('menu-config'))
// Favorito antigo não pode cair em "Esta página não existe": vai para a lista
// de automações, onde o menu aparece como qualquer comando.
check('quem abre /menu é levado para Automações', rotas.includes("if (pathname === '/menu') return { redirect: '/automations' }"))
check('e o redirecionamento troca o histórico em vez de empilhar', rotas.includes('navigate(route.redirect, { replace: true })'))

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

// --- a tela de pools está no caminho ------------------------------------
const telaDePools = ler('../src/web/public/pages/pools.js')

for (const [nome, caminho, tela, cliente] of [
  ['pools', '/pools', telaDePools, 'api.pools.']
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

console.log(falhas === 0 ? '\npainel: donos, menu e pools — tudo certo' : `\npainel: donos, menu e pools — ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
