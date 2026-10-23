// MANDAR UMA PÁGINA, de um comando qualquer.
//
// A pesquisa do dono desfez a premissa e vale repetir: NÃO existe HTML rodando
// dentro de uma mensagem do WhatsApp. O que existe é um botão com uma URL, e o
// aplicativo abre aquela página numa janela dele — o site continua sendo um
// site, hospedado onde a pessoa quiser.
//
// O botão de página já existia, mas só DENTRO de um card de carrossel, montado
// a partir da resposta de uma conexão declarada. Ou seja: para mandar uma
// página era preciso ter um serviço HTTP devolvendo uma lista de itens com
// imagem. Para "manda esta página", isso é um caminho inteiro de volta por
// nada — e era o que faltava para o HTML servir para alguma coisa.
//
// A DIFERENÇA QUE DECIDE QUANDO USAR CADA UM, e por isso ela está no aviso do
// template e no glossário: `quick_reply` VOLTA para o bot; `cta_url` é
// executado no aparelho e não avisa o bot de nada.
import fs from 'node:fs'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import { montarBotaoDePagina } from '../src/engine/carrossel.js'
import { ACOES_SUPORTADAS } from '../src/engine/server/runtimeCapabilities.js'
import { ACOES } from '../src/lcn/vocabulario.js'
import { renderizarTemplate } from '../src/engine/templates/render.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// --- a mensagem que sai ---------------------------------------------------
const msg = montarBotaoDePagina({ texto: 'Toque para abrir:', rodape: 'LCN', url: 'https://jogo.exemplo/x', rotulo: '🎮 Jogar', janela: true })
const interativa = msg.viewOnceMessageV2.message.interactiveMessage
const botao = interativa.nativeFlowMessage.buttons[0]
const params = JSON.parse(botao.buttonParamsJson)

check('sai como botão de abrir endereço', botao.name === 'cta_url', botao.name)
check('com o endereço', params.url === 'https://jogo.exemplo/x')
check('e o rótulo que a pessoa lê', params.display_text === '🎮 Jogar')
// É este campo, e não o `webview_presentation` sozinho, que faz a página abrir
// DENTRO do WhatsApp no celular.
check('pede janela dentro do WhatsApp', params.webview_interaction === true)
check('o texto vai no corpo', interativa.body.text === 'Toque para abrir:')
check('e o rodapé no rodapé', interativa.footer.text === 'LCN')

const noNavegador = montarBotaoDePagina({ url: 'https://exemplo.com', rotulo: 'Abrir', janela: false })
const semJanela = JSON.parse(noNavegador.viewOnceMessageV2.message.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson)
check('desligando a janela, vira link comum', semJanela.webview_interaction === undefined)

// Corpo vazio não pode ir vazio: mensagem interativa sem corpo é recusada por
// alguns clientes, e a recusa não deixa rastro nenhum.
const semTexto = montarBotaoDePagina({ url: 'https://exemplo.com', rotulo: 'Abrir' })
check('sem texto, o corpo não fica vazio', semTexto.viewOnceMessageV2.message.interactiveMessage.body.text.length > 0)

// --- POR QUE ESTA MENSAGEM NÃO PRECISA DO <biz> NA MÃO --------------------
//
// O carrossel com botão precisa: os botões ficam dentro de
// `carouselMessage.cards[]`, e o resolvedor da zapo-js não percorre os cards.
// Por isso o estilo `bizNoStanza` manda o nó `<biz>` por `customNodes`.
//
// Aqui o `nativeFlowMessage` está no NÍVEL PRINCIPAL do `interactiveMessage`,
// e foi isso que eu confirmei lendo a biblioteca instalada (zapo-js 1.8.2):
//
//   `resolveButtonAddonKindFrom` procura `msg.interactiveMessage
//   .nativeFlowMessage` — acha, devolve 'interactive', e o despachante anexa
//   `buildButtonAddonNode` sozinho.
//
//   `unwrapMessage` desfaz `viewOnceMessageV2` ANTES dessa procura, então o
//   embrulho é transparente para ela.
//
// Este caso guarda a propriedade que faz isso valer — e que uma refatoração
// descuidada quebraria em silêncio, porque mensagem interativa que o servidor
// aceita e o aplicativo não desenha não deixa rastro nenhum.
const dentro = msg.viewOnceMessageV2.message.interactiveMessage
check('o fluxo nativo fica no NÍVEL PRINCIPAL, não dentro de cards', Boolean(dentro.nativeFlowMessage) && !dentro.carouselMessage)
check('e o embrulho é o viewOnceMessageV2, que a biblioteca desfaz', Boolean(msg.viewOnceMessageV2?.message))

// --- AS DUAS FORMAS DE BOTÃO ---------------------------------------------
//
// São dois nomes diferentes no protocolo, os dois não documentados pela Meta,
// e nenhum é "o certo". A forma `janela` é exatamente a que o takeshi-bot usa
// no comando de jogo dele — conferida clonando o repositório e lendo
// `src/commands/member/games/tubes.js`:
//
//   { name: "open_webview", buttonParamsJson: { title, link: {
//       url, in_app_webview: true, full_screen: true } } }
//
// `full_screen: true` escrito por ele é a confirmação, vinda do bot de
// referência, de que o jogo abre POR CIMA da conversa — não dentro da bolha.
const comoJanela = montarBotaoDePagina({ url: 'https://jogo/x', rotulo: '🎮 Jogar', janela: true, forma: 'janela' })
const botaoJanela = comoJanela.viewOnceMessageV2.message.interactiveMessage.nativeFlowMessage.buttons[0]
const paramsJanela = JSON.parse(botaoJanela.buttonParamsJson)

check('a forma "janela" usa open_webview', botaoJanela.name === 'open_webview', botaoJanela.name)
// Aqui o rótulo se chama `title`, não `display_text`: trocar um pelo outro
// deixa o botão sem texto, e isso não dá erro em lugar nenhum.
check('e o rótulo vai em "title"', paramsJanela.title === '🎮 Jogar')
check('o endereço vai dentro de "link"', paramsJanela.link?.url === 'https://jogo/x')
check('pedindo janela interna', paramsJanela.link?.in_app_webview === true)
check('e tela cheia', paramsJanela.link?.full_screen === true)
check('a forma "janela" NÃO tem display_text', paramsJanela.display_text === undefined)

// O ENVELOPE MUDA COM A FORMA, e foi medido: a primeira versão da forma
// `janela` foi ACEITA pelo servidor e não desenhada pelo aplicativo — envio
// confirmado, conversa vazia. A diferença não estava no botão, estava no
// envelope. O takeshi-bot monta `body` + `header { hasMediaAttachment: false }`
// e NÃO manda `messageParamsJson`; é a mesma lição que o comentário do
// carrossel aqui já registrava ("era o header que faltava, não o body").
const envelopeJanela = comoJanela.viewOnceMessageV2.message.interactiveMessage
check('a forma janela leva o header do bot de referência', envelopeJanela.header?.hasMediaAttachment === false, JSON.stringify(envelopeJanela.header))
check('e NÃO leva messageParamsJson', envelopeJanela.nativeFlowMessage.messageParamsJson === undefined)

// A forma `link` fica como está, porque está provada assim neste aparelho —
// não se troca o que funciona por simetria.
const envelopeLink = msg.viewOnceMessageV2.message.interactiveMessage
check('a forma link continua sem header', envelopeLink.header === undefined)
check('e continua com messageParamsJson', envelopeLink.nativeFlowMessage.messageParamsJson === '')

// A forma padrão continua sendo a medida funcionando.
const padrao = montarBotaoDePagina({ url: 'https://jogo/x', rotulo: 'Ir' })
check('sem escolher, vale a forma "link"', padrao.viewOnceMessageV2.message.interactiveMessage.nativeFlowMessage.buttons[0].name === 'cta_url')

// Mandar para o navegador também vale na forma janela: é o mesmo pedido, pelo
// outro campo.
const janelaDesligada = JSON.parse(montarBotaoDePagina({ url: 'https://x', rotulo: 'Ir', janela: false, forma: 'janela' })
  .viewOnceMessageV2.message.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson)
check('forma janela com a janela desligada vai para o navegador', janelaDesligada.link.in_app_webview === false)

// --- a ação existe nas quatro camadas ------------------------------------
check('a palavra existe na linguagem', ACOES.some((a) => a.palavra === 'abre página'))
check('o tipo está nas capacidades do runtime', ACOES_SUPORTADAS.includes('action.whatsapp.webview'))

const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
check('o schema aceita o nó', Object.values(schema.definitions).some((d) => d?.properties?.type?.const === 'action.whatsapp.webview'))

const avaliador = fs.readFileSync(new URL('../src/engine/server/evaluator.js', import.meta.url), 'utf8')
check('o motor sabe executar', avaliador.includes("case 'action.whatsapp.webview'"))
const gateway = fs.readFileSync(new URL('../src/engine/gatewayExecutor.js', import.meta.url), 'utf8')
check('o gateway tem executor próprio', gateway.includes("'whatsapp.webview': executarPagina"))

// QUEDA PARA TEXTO. Mensagem interativa que o aplicativo não desenha não deixa
// rastro: a conversa fica vazia e ninguém sabe por quê. Com a queda, o
// endereço sempre chega — como link escrito, que é clicável do mesmo jeito.
check('e cai para texto quando o botão é recusado', gateway.includes('mandando o endereço como texto'))

// --- a linguagem escreve e relê ------------------------------------------
const fonte = [
  'automação jogar',
  '  id: jogar',
  '  nome: Jogar',
  '  tipo: comando',
  '  dispara com: /jogar',
  '  pool: p',
  '  acessa: texto',
  '  casa: exato',
  '  quem: qualquer um',
  '',
  '  abre página "Partida pronta:"',
  '    endereço: "https://jogo.exemplo/{{message.args}}"',
  '    botão: "🎮 Jogar"',
  '    dentro do WhatsApp: sim',
  '',
  '# nós: gatilho-comando, abrir-pagina'
].join('\n')

const doc = compilar(fonte)
const no = doc.flow.nodes.find((n) => n.type === 'action.whatsapp.webview')
check('a linguagem escreve a ação', Boolean(no))
check('com o endereço', no.config.url === 'https://jogo.exemplo/{{message.args}}')
check('o rótulo do botão', no.config.buttonLabel === '🎮 Jogar')
check('e a janela', no.config.inApp === true)
// A ida e volta é o que permite ABRIR essa automação para editar depois.
check('vai e volta idêntico', JSON.stringify(compilar(descompilar(doc))) === JSON.stringify(doc))

// --- o comando do catálogo ------------------------------------------------
const template = compilar(fs.readFileSync(new URL('../src/engine/templates/catalog/abrir-pagina.lcn', import.meta.url), 'utf8'))
check('o template do catálogo compila', template.template.templateId === 'abrir-pagina')
check('e usa a ação', template.documentTemplate.flow.nodes.some((n) => n.type === 'action.whatsapp.webview'))
// Ele já nasce com família: é o primeiro template a declarar uma, e serve de
// exemplo de como se escreve.
check('nasce com família configurável', template.template.parameters.some((p) => p.key === 'familia'))

// Os dois avisos que o template precisa carregar, porque são as duas coisas
// que alguém supõe errado: que o HTML roda na mensagem, e que o botão volta.
const avisos = template.template.warnings.map((a) => a.text).join(' ')
check('avisa que não há HTML dentro da mensagem', /NÃO existe HTML rodando dentro/.test(avisos))
check('avisa que o botão não volta para o bot', /não volta para o bot/i.test(avisos))

// --- A ESCOLHA DE QUEM INSTALA TEM DE CHEGAR ----------------------------
//
// Campo BOOLEANO de ação não aceitava marcador de template, e falhava CALADO:
// `{{params.dentroDoApp}}` não é "sim" nem "true", então virava `false` no
// documento. Quem instalasse escolhendo "sim" receberia o contrário, sem nada
// avisando. Apareceu instalando este comando no servidor — passei
// `dentroDoApp: true` e saiu `inApp: false`.
//
// Os campos de NÚMERO e de OPÇÃO já tinham essa exceção; o booleano era o
// único sem, e o único cujo erro não dá para ver.
for (const escolha of [true, false]) {
  const doc = renderizarTemplate(
    { ...template.template, documentTemplate: template.documentTemplate },
    { command: '/x', url: 'https://e.com', rotulo: 'Ir', texto: 't', rodape: '', dentroDoApp: escolha, familia: 'utilitarios', allowFrom: 'external', poolId: 'p' }
  )
  const noRenderizado = doc.flow.nodes.find((n) => n.type === 'action.whatsapp.webview')
  check(`instalando com "dentro do WhatsApp = ${escolha}", chega ${escolha}`, noRenderizado.config.inApp === escolha, JSON.stringify(noRenderizado.config.inApp))
}

// Mesma raiz, outra família de campo: o passo do contador também só aceitava
// número literal, e era a única em que o marcador dava erro de sintaxe.
const comPasso = compilar([
  'template t v1', '  nome: T', '  categoria: utilitarios', '',
  'automação a', '  id: a', '  tipo: comando', '  dispara com: /a',
  '  pool: p', '  acessa: texto', '  casa: exato', '  quem: qualquer um', '',
  '  soma chat n = {{params.passo}}', '',
  'configurável', '  passo: número = 1', '    rótulo: Passo'
].join('\n'))
check('o passo do contador aceita marcador de template', comPasso.documentTemplate.flow.nodes[1].config.by === '{{params.passo}}')
const passoResolvido = renderizarTemplate(
  { ...comPasso.template, documentTemplate: comPasso.documentTemplate }, { passo: 5 }
)
check('e vira número de verdade na instalação', passoResolvido.flow.nodes[1].config.by === 5, JSON.stringify(passoResolvido.flow.nodes[1].config.by))

// A escolha da forma atravessa a instalação, como qualquer outro parâmetro.
for (const escolha of ['link', 'janela']) {
  const doc = renderizarTemplate(
    { ...template.template, documentTemplate: template.documentTemplate },
    { command: '/x', url: 'https://e.com', rotulo: 'Ir', texto: 't', rodape: '', dentroDoApp: true, forma: escolha, familia: 'u', allowFrom: 'any', poolId: 'p' }
  )
  const no = doc.flow.nodes.find((n) => n.type === 'action.whatsapp.webview')
  check(`instalando com forma "${escolha}", chega "${escolha}"`, no.config.forma === escolha, JSON.stringify(no.config.forma))
}

console.log(falhas === 0 ? '\nmandar uma página: tudo certo' : `\nmandar uma página: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
