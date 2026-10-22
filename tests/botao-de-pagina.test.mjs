// O BOTÃO QUE ABRE UMA PÁGINA.
//
// O que a pesquisa do dono desfez, e vale deixar escrito aqui porque é
// contraintuitivo: **não existe HTML rodando dentro de uma mensagem do
// WhatsApp**, e nunca existiu. Os "jogos dentro do WhatsApp" são um botão com
// uma URL; o aplicativo abre aquela página numa janela dele, e o HTML continua
// sendo um site hospedado em outro lugar.
//
// Então este botão não é "suporte a HTML": é um `cta_url` ao lado do
// `quick_reply` que já existia. A diferença entre os dois é o que mais importa
// para quem monta um comando:
//
//   quick_reply  -> VOLTA para o bot (o id chega como se fosse digitado)
//   cta_url      -> é executado no aparelho e NÃO avisa o bot de nada
//
// Por isso um botão que abre página não serve para saber qual card a pessoa
// escolheu, e por isso os dois campos não podem conviver no mesmo botão.
import { montarCard } from '../src/engine/carrossel.js'
import { validarFuncao } from '../src/engine/server/conexoes/declaracao.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const midia = { tipo: 'imagem', mimetype: 'image/jpeg' }
const upload = {
  url: 'https://cdn/x', directPath: '/d', mediaKey: 'k', fileSha256: 's',
  fileEncSha256: 'e', fileLength: 1, mediaKeyTimestamp: 1, mimetype: 'image/jpeg'
}
const botoesDe = (botao) => montarCard(midia, upload, { titulo: 'T', legenda: 'L', botao }).nativeFlowMessage.buttons
const params = (botao) => JSON.parse(botoesDe(botao)[0].buttonParamsJson)

// --- o botão de comando continua exatamente como era --------------------
const comando = botoesDe({ texto: '⬇️ Baixar esta', comando: '/musica https://y/abc' })
check('botão de comando continua quick_reply', comando[0].name === 'quick_reply', comando[0].name)
check('e leva o comando no id', JSON.parse(comando[0].buttonParamsJson).id === '/musica https://y/abc')

// --- o botão de página --------------------------------------------------
const pagina = botoesDe({ texto: '🎮 Jogar', url: 'https://jogo.exemplo/play', janela: true })
check('botão de página é cta_url', pagina[0].name === 'cta_url', pagina[0].name)

const p = params({ texto: '🎮 Jogar', url: 'https://jogo.exemplo/play', janela: true })
check('leva a URL', p.url === 'https://jogo.exemplo/play')
// `merchant_url` repete a URL porque é assim que o campo viaja no nativeFlow.
check('repete em merchant_url', p.merchant_url === p.url)
// É este campo, e não o `webview_presentation` sozinho, que faz a página abrir
// DENTRO do WhatsApp no celular.
check('pede janela dentro do WhatsApp', p.webview_interaction === true)
check('e apresentação cheia', p.webview_presentation === 'full')
check('o rótulo é o que a pessoa lê', p.display_text === '🎮 Jogar')

// Sem janela, é um link comum: vai para o navegador.
const noNavegador = params({ texto: 'Abrir', url: 'https://exemplo.com', janela: false })
check('sem janela, não pede webview', noNavegador.webview_interaction === undefined)
check('mas continua levando a URL', noNavegador.url === 'https://exemplo.com')

// Rótulo sem ação nenhuma não vira botão: um botão que não faz nada ao ser
// tocado é pior do que não ter botão.
check('rótulo sem ação não vira botão', botoesDe({ texto: 'Só o rótulo' }).length === 0)
check('sem rótulo não vira botão', botoesDe({ url: 'https://exemplo.com' }).length === 0)

// --- a declaração ------------------------------------------------------
const funcaoCom = (botao) => validarFuncao({
  nome: 'buscar',
  metodo: 'POST',
  caminho: '/buscar',
  entradas: [{ nome: 'busca', tipo: 'texto' }],
  resposta: { forma: 'carrossel', campo: 'achados', imagem: ['capa'], corpo: '{{titulo}}', botao }
})

const comUrl = funcaoCom({ texto: 'Jogar', url: 'https://jogo.exemplo/{{id}}' })
check('a declaração aceita URL no botão', comUrl.resposta.botao.url === 'https://jogo.exemplo/{{id}}')
check('e a janela nasce ligada', comUrl.resposta.botao.janela === true)
check('declarando URL, não há comando', comUrl.resposta.botao.comando === undefined)

const comJanelaDesligada = funcaoCom({ texto: 'Abrir', url: 'https://exemplo.com', janela: false })
check('dá para mandar para o navegador', comJanelaDesligada.resposta.botao.janela === false)

// OS DOIS JUNTOS SÃO RECUSADOS. São botões de tipos diferentes no protocolo, e
// aceitar ambos obrigaria esta camada a escolher por quem declarou — o tipo de
// escolha silenciosa que depois vira "por que esse botão não faz o que escrevi?".
let recusa = null
try { funcaoCom({ texto: 'X', url: 'https://a.com', comando: '/x' }) } catch (e) { recusa = e.message }
check('comando E url juntos são recusados', recusa !== null, recusa || 'não recusou')
check('e a recusa explica que a página não volta para o bot', /não volta para o bot/.test(recusa || ''), recusa)

// A URL do botão é executada no APARELHO de quem recebeu. Um "javascript:" ou
// um "data:" ali seria código escolhido por quem declarou a conexão rodando no
// telefone de outra pessoa.
for (const ruim of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd']) {
  let erro = null
  try { funcaoCom({ texto: 'X', url: ruim }) } catch (e) { erro = e.message }
  check(`"${ruim.slice(0, 22)}…" é recusado`, erro !== null, erro || 'passou')
}

// URL com marcador não dá para conferir como endereço — e é a forma que torna
// o botão útil, porque é assim que ele aponta para AQUELE card.
const comMarcador = funcaoCom({ texto: 'X', url: 'https://jogo.exemplo/{{id}}?p={{slug}}' })
check('URL com marcador passa', comMarcador.resposta.botao.url.includes('{{id}}'))

// Validar duas vezes tem de dar o mesmo resultado: a conexão é regravada por
// qualquer motivo, e uma validação que muda o valor tranca a tela na segunda vez.
const umaVez = funcaoCom({ texto: 'Jogar', url: 'https://jogo.exemplo/x' })
const duasVezes = validarFuncao({
  nome: 'buscar', metodo: 'POST', caminho: '/buscar',
  entradas: [{ nome: 'busca', tipo: 'texto' }],
  resposta: { ...umaVez.resposta }
})
check('validar de novo dá o mesmo botão', JSON.stringify(duasVezes.resposta.botao) === JSON.stringify(umaVez.resposta.botao))

// O botão de comando declarado continua intacto.
const comComando = funcaoCom({ texto: '⬇️ Baixar esta', comando: '/musica {{url}}' })
check('o botão de comando continua válido', comComando.resposta.botao.comando === '/musica {{url}}')
check('e não ganha url', comComando.resposta.botao.url === undefined)

console.log(falhas === 0 ? '\nbotão de página: tudo certo' : `\nbotão de página: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
