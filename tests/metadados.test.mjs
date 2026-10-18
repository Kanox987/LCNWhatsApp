// VER OS METADADOS DA MENSAGEM.
//
// Por que isto existe: quem escreve um comando com botão, citação ou carrossel
// monta contra uma caixa fechada. Eu mesmo só descobri que faltava a quarta
// forma de resposta de botão (`templateButtonReplyMessage`) depois de o toque
// não fazer nada e eu ir ler o banco. Quem aluga o sistema não tem banco nem
// terminal — para essa pessoa, não havia como olhar.
//
// Dois assuntos aqui, e o segundo é o que importa de verdade:
//
//   1. O TOQUE NO BOTÃO chega inteiro. `textoDeResposta` sempre tirou dali só
//      o id, porque para ACIONAR um comando o id basta. O rótulo lido, a
//      posição e o card eram descartados — e são justamente o que falta ver.
//
//   2. O QUE SAI NA CONVERSA não pode carregar segredo. O nó cru do WhatsApp
//      traz `mediaKey` e `directPath`: publicá-los entregaria a quem estivesse
//      lendo a capacidade de baixar a mídia de outra pessoa. É o invariante 4,
//      e ele vale aqui também — por isso a ação mostra o que o COMANDO lê, e
//      não o pacote cru.
import { construirEventoDeMensagem } from '../src/engine/zapoAdapter.js'
import { ACOES_SUPORTADAS } from '../src/engine/server/runtimeCapabilities.js'
import { mencoesDeclaradas } from '../src/engine/server/evaluator.js'
import { ACOES } from '../src/lcn/vocabulario.js'
import { compilar } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'
import fs from 'node:fs'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const chave = (id) => ({ remoteJid: '5511999@s.whatsapp.net', id, fromMe: false, isGroup: false, isBroadcast: false, isNewsletter: false })
const evento = (id, message) => construirEventoDeMensagem(
  { key: chave(id), message, timestampSeconds: 1893456000, pushName: 'Fulano' },
  { accountId: 'acc-1', recebidoEmMs: 1893456000123 }
)

// --- 1. as quatro formas de toque, por inteiro ---------------------------

// O carrossel: é esta que carrega o card tocado, e é o caso do dono.
const modelo = evento('TPL1', {
  templateButtonReplyMessage: {
    selectedId: '/musica https://y/abc',
    selectedDisplayText: '⬇️ Baixar esta',
    selectedIndex: 0,
    selectedCarouselCardIndex: 2
  }
})
check('botão de modelo: a forma é reconhecida', modelo.message.buttonReply?.forma === 'modelo', modelo.message.buttonReply?.forma)
check('botão de modelo: o id vira o comando', modelo.message.buttonReply?.id === '/musica https://y/abc')
check('botão de modelo: o rótulo LIDO é preservado', modelo.message.buttonReply?.texto === '⬇️ Baixar esta')
// O que o `textoDeResposta` jogava fora, e é o que diz QUAL card foi tocado.
check('botão de modelo: guarda o card do carrossel', modelo.message.buttonReply?.card === 2, String(modelo.message.buttonReply?.card))
check('e o texto da mensagem continua sendo o id, que é o que aciona', modelo.message.text === '/musica https://y/abc')

const classico = evento('BTN1', {
  buttonsResponseMessage: { selectedButtonId: '/fig', selectedDisplayText: 'Fazer figurinha' }
})
check('botão clássico: forma e id', classico.message.buttonReply?.forma === 'botão' && classico.message.buttonReply?.id === '/fig')
check('botão clássico: o rótulo lido', classico.message.buttonReply?.texto === 'Fazer figurinha')

const lista = evento('LST1', {
  listResponseMessage: { title: 'Figurinha', description: 'converte foto', singleSelectReply: { selectedRowId: '/fig' } }
})
check('linha de lista: forma e id', lista.message.buttonReply?.forma === 'lista' && lista.message.buttonReply?.id === '/fig')
check('linha de lista: a descrição também vem', lista.message.buttonReply?.descricao === 'converte foto')

const fluxo = evento('FLX1', {
  interactiveResponseMessage: {
    body: { text: '⬇️ Baixar esta' },
    nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: JSON.stringify({ id: '/musica https://y/xyz' }) }
  }
})
check('fluxo nativo: forma e id', fluxo.message.buttonReply?.forma === 'fluxo' && fluxo.message.buttonReply?.id === '/musica https://y/xyz')

// `paramsJson` é escrito pelo cliente do WhatsApp. Ilegível, o id fica ausente
// e o resto continua — nunca lança, senão uma mensagem torta derruba o evento.
const torto = evento('FLX2', {
  interactiveResponseMessage: { body: { text: 'oi' }, nativeFlowResponseMessage: { paramsJson: '{{{' } }
})
check('fluxo com paramsJson ilegível não derruba o evento', torto.message.buttonReply?.forma === 'fluxo')
check('e o id simplesmente fica ausente', torto.message.buttonReply?.id === undefined)

// Mensagem comum não ganha o campo: ausente fica ausente, e o marcador aparece
// literal em vez de um buraco no meio do texto.
const comum = evento('MSG1', { conversation: 'oi' })
check('mensagem comum não tem buttonReply', comum.message.buttonReply === undefined)

// Campo vazio não vira string vazia — string vazia casaria com comparações e
// pareceria um valor que existe.
const semRotulo = evento('TPL2', { templateButtonReplyMessage: { selectedId: '/x', selectedDisplayText: '' } })
check('rótulo vazio fica ausente, não vazio', semRotulo.message.buttonReply?.texto === undefined)

// --- 2. a ação existe nas quatro camadas ---------------------------------
//
// Uma ação só funciona se ela estiver na linguagem (para escrever), no schema
// (para publicar), nas capacidades (para o publish aceitar) e no motor (para
// rodar). Faltando uma, o defeito aparece tarde: a pessoa escreve o comando e
// a publicação recusa.
check('a palavra existe na linguagem', ACOES.some((a) => a.palavra === 'mostra metadados'))
check('o tipo está nas capacidades do runtime', ACOES_SUPORTADAS.includes('action.whatsapp.metadata'))

const schema = JSON.parse(fs.readFileSync(new URL('../src/engine/server/schema/automation.v1.schema.json', import.meta.url), 'utf8'))
const noDoSchema = Object.values(schema.definitions).some((d) => d?.properties?.type?.const === 'action.whatsapp.metadata')
check('o schema aceita o nó', noDoSchema)

const avaliador = fs.readFileSync(new URL('../src/engine/server/evaluator.js', import.meta.url), 'utf8')
check('o motor sabe executar', avaliador.includes("case 'action.whatsapp.metadata'"))

// O comando do catálogo compila, e é por ele que alguém instala isto sem
// escrever nada.
const fonte = fs.readFileSync(new URL('../src/engine/templates/catalog/metadados.lcn', import.meta.url), 'utf8')
const { template, documentTemplate } = compilar(fonte)
check('o template do catálogo compila', template.templateId === 'metadados')
check('e usa a ação', documentTemplate.flow.nodes.some((n) => n.type === 'action.whatsapp.metadata'))
// O padrão aqui é `any` de propósito: este comando serve para VOCÊ inspecionar
// o que chega enquanto monta outro comando, e `external` ignoraria o seu
// próprio número — que é de onde o dono testa.
check('nasce respondendo ao próprio número', template.parameters.find((p) => p.key === 'allowFrom')?.default === 'any')

// --- 3. O QUE NÃO PODE SAIR ----------------------------------------------
//
// A ação monta o texto a partir do CONTEXTO do interpolador, que já é a
// fronteira do legível — `semTokens` tira dali as referências de mídia. Este
// caso guarda a fronteira pelo lado de fora: as palavras que nunca podem
// aparecer num texto que vai para a conversa.
const proibidas = ['mediaKey', 'directPath', 'fileEncSha256', 'mediaRef', 'quotedMediaRef']
const trechoDaAcao = avaliador.slice(
  avaliador.indexOf("case 'action.whatsapp.metadata'"),
  avaliador.indexOf("case 'action.acervo.save'")
)
for (const palavra of proibidas) {
  // A ação escreve `contexto.message`, `contexto.quoted`, `contexto.media` e
  // `contexto.target` — nenhum deles nomeia token. Citar qualquer um destes
  // campos aqui seria o caminho de volta para o vazamento.
  check(`a ação não toca em "${palavra}"`, !trechoDaAcao.includes(palavra))
}
// A MENSAGEM vem pelo contexto, nunca de `evento.message` — é no contexto que
// `semTokens` já tirou as referências de mídia. O endereçamento (id da própria
// mensagem, quem enviou, a conversa) vem do evento, e pode: não há segredo em
// saber o id da mensagem que acabou de chegar.
check('a mensagem é lida pelo contexto, não por evento.message', trechoDaAcao.includes('contexto.message') && !trechoDaAcao.includes('evento.message'))

// --- 4. DEFINIR os metadados da mensagem que sai ------------------------
//
// A menção é o caso que não dava para fazer de jeito nenhum antes. Escrever
// "@5511999999999" no meio do texto manda dígitos: parece uma menção, não
// notifica ninguém e não pinta nome nenhum. O que o WhatsApp entende é a lista
// que viaja AO LADO do texto — por isso virou campo, e por isso o texto
// continua sendo texto.
const comMetadados = [
  'automação avisa',
  '  id: avisa',
  '  nome: Avisa',
  '  tipo: comando',
  '  dispara com: /avisa',
  '  pool: p',
  '  acessa: texto',
  '  casa: exato',
  '  quem: qualquer um',
  '',
  '  responde "olha isto"',
  '    marca: "{{sender.id}}, 5511988887777"',
  '    encaminhada: sim',
  '',
  '# nós: gatilho-comando, responder'
].join('\n')

const doc = compilar(comMetadados)
const noDeResposta = doc.flow.nodes.find((n) => n.type === 'action.whatsapp.reply')
check('a linguagem escreve "marca:"', noDeResposta.config.mentions === '{{sender.id}}, 5511988887777', noDeResposta.config.mentions)
check('a linguagem escreve "encaminhada:"', noDeResposta.config.forward === true)
// A ida e volta é o que garante que uma automação com estes campos possa ser
// ABERTA para edição depois — documento que não vira texto não se edita.
check('vai e volta idêntico', JSON.stringify(compilar(descompilar(doc))) === JSON.stringify(doc))

// Como o motor resolve o que foi escrito. A função é a mesma que o nó usa.
const evaluator = fs.readFileSync(new URL('../src/engine/server/evaluator.js', import.meta.url), 'utf8')
check('o motor resolve as menções antes de mandar', evaluator.includes('mencoesDeclaradas'))
check('e o gateway manda isso no contexto, não no texto', fs.readFileSync(new URL('../src/engine/gatewayExecutor.js', import.meta.url), 'utf8').includes('opcoes.mentions = payload.mentions'))

// O QUE NÃO PODE ENTRAR NA LISTA: marcador que não resolveu. Um "{{...}}"
// intacto significa variável nunca gravada — mandá-lo como destinatário
// marcaria ninguém, ou alguém errado.
// O QUE NÃO PODE ENTRAR NA LISTA: marcador que não resolveu. Um "{{...}}"
// intacto significa variável nunca gravada — mandá-lo como destinatário
// marcaria ninguém, ou alguém errado.
//
// A função do MOTOR é chamada aqui, e não uma cópia da regra: um teste que
// reimplementa o que testa passa mesmo quando o original quebra.
const resolver = (texto) => mencoesDeclaradas(texto, {})

check('dígitos viram JID de contato', resolver('5511988887777').join() === '5511988887777@s.whatsapp.net')
check('JID inteiro passa como está', resolver('5511988887777@s.whatsapp.net').join() === '5511988887777@s.whatsapp.net')
check('vários separados por vírgula', resolver('5511988887777, 5522999998888').length === 2)
check('marcador que não resolveu NÃO vira destinatário', resolver('{{var.global.ninguem}}').length === 0)
check('o mesmo número duas vezes marca uma vez só', resolver('5511988887777, 5511988887777').length === 1)
check('número curto demais não entra', resolver('123').length === 0)

console.log(falhas === 0 ? '\nmetadados da mensagem: tudo certo' : `\nmetadados da mensagem: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
