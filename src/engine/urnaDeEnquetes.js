// A URNA: quem votou no quê, por enquete.
//
// Os votos JÁ CHEGAVAM e eram jogados fora. Medido numa captura de 40 minutos
// da produção em 27/10: 17 pacotes `pollUpdateMessage`, todos registrados como
// "mensagem desconhecida" e descartados. É a mesma situação dos eventos de
// grupo antes do porteiro existir — o dado chega, ninguém encaminha.
//
// A biblioteca faz a parte difícil: entrega o voto já DECIFRADO no evento
// `message_addon`, e `resolvePollOptionNames` traduz os hashes de volta para o
// texto das opções. O que faltava era alguém guardar.
//
// POR QUE EM MEMÓRIA, e o que isso custa: o motor é quem tem banco; o gateway
// não escreve nele. Guardar aqui mantém a fronteira (o motor recebe
// informação, não bytes nem estado de socket) ao preço de a contagem recomeçar
// quando o gateway reinicia. É limitação de verdade e está escrita no template
// que usa isto — melhor do que inventar uma tabela nova no meio do caminho.
//
// UM VOTO POR PESSOA, e o último vale: o WhatsApp permite trocar o voto, e
// trocar manda outro pacote. Somar os dois contaria a mesma pessoa duas vezes.

// COMO O VOTO VIRA NOME DE OPÇÃO, sem importar nada de dentro da biblioteca.
//
// O WhatsApp não manda a opção escolhida: manda o SHA-256 do nome dela. A
// biblioteca tem um resolvedor para isso, mas ele NÃO é exportado da raiz do
// pacote — usá-lo seria importar caminho interno, que quebra na primeira
// atualização. O hash é sha256(bytes do nome), e isso dá para fazer aqui com
// o `crypto` do Node, sem acoplar a nada.
//
// A consequência honesta: só sabemos nomear opção de enquete que o BOT abriu,
// porque é quando conhecemos os nomes para calcular os hashes. Voto em enquete
// que outra pessoa criou chega e é descartado — e é melhor descartar do que
// mostrar hash para alguém.
import crypto from 'crypto'
import * as lidMap from '../lidMap.js'

// QUEM VOTOU, numa forma só.
//
// A mesma pessoa chega às vezes como @lid e às vezes como telefone — a
// própria biblioteca tipa o jid do participante como "LID or PN". Sem
// normalizar, alguém que vota como LID e TROCA o voto chegando como telefone
// vira duas pessoas: o voto antigo nunca é substituído e o total passa do
// tamanho do grupo. O risco foi levantado numa revisão e o mapa que resolve já
// existia no projeto, usado pelo porteiro pela mesma razão.
function normalizarEleitor (jid) {
  if (typeof jid !== 'string' || !jid) return null
  try {
    const telefone = lidMap.paraTelefone(jid)
    if (typeof telefone === 'string' && telefone) return telefone
  } catch {}
  return jid
}

function hashDaOpcao (nome) {
  return crypto.createHash('sha256').update(String(nome), 'utf8').digest('hex')
}

// Enquetes guardadas ao mesmo tempo. Um grupo movimentado abre poucas enquetes
// por dia; o teto existe para que uma instância esquecida não cresça sem fim.
const MAX_ENQUETES = 200

const urna = new Map()

// Avisa a urna de que ESTA enquete existe e quais são as opções dela. Chamado
// quando o bot envia a enquete, que é o único momento em que os nomes são
// conhecidos.
export function registrarEnquete ({ pollId, chatId, opcoes, emMs = Date.now() }) {
  if (typeof pollId !== 'string' || !pollId) return false
  if (!Array.isArray(opcoes) || !opcoes.length) return false
  const porHash = new Map()
  for (const nome of opcoes) {
    if (typeof nome !== 'string' || !nome) continue
    porHash.set(hashDaOpcao(nome), nome)
  }
  if (!porHash.size) return false
  liberarVaga()
  const existente = urna.get(pollId)
  urna.set(pollId, {
    chatId: chatId || null,
    porHash,
    votos: existente?.votos || new Map(),
    ultimoEmMs: emMs
  })
  return true
}

// Traduz os hashes que vieram no voto para os nomes das opções.
// Hash que não bate com nada fica de fora: é opção de outra enquete, ou de uma
// que esta instância não viu nascer.
export function registrarVotoPorHash ({ pollId, quem, hashes, emMs = Date.now() }) {
  const enquete = urna.get(pollId)
  if (!enquete || !enquete.porHash) return false
  const nomes = []
  for (const bruto of (Array.isArray(hashes) ? hashes : [])) {
    const hex = Buffer.isBuffer(bruto) || bruto instanceof Uint8Array
      ? Buffer.from(bruto).toString('hex')
      : String(bruto || '')
    const nome = enquete.porHash.get(hex)
    if (nome) nomes.push(nome)
  }
  // Votar em NADA é desmarcar, e isso é um voto válido: a pessoa tirou a
  // escolha dela. Registrar lista vazia é o que faz a contagem baixar.
  return registrarVoto({ pollId, chatId: enquete.chatId, quem, opcoes: nomes, emMs })
}

function liberarVaga () {
  if (urna.size < MAX_ENQUETES) return
  // Sai a mais antiga por ÚLTIMO VOTO, não por criação: uma enquete que ainda
  // recebe voto está viva, mesmo que tenha sido aberta ontem.
  let maisVelha = null
  for (const [id, dados] of urna) {
    if (!maisVelha || dados.ultimoEmMs < maisVelha.dados.ultimoEmMs) maisVelha = { id, dados }
  }
  if (maisVelha) urna.delete(maisVelha.id)
}

export function registrarVoto ({ pollId, chatId, quem, opcoes, emMs = Date.now() }) {
  if (typeof pollId !== 'string' || !pollId) return false
  const eleitor = normalizarEleitor(quem)
  if (!eleitor) return false
  if (!Array.isArray(opcoes)) return false

  let enquete = urna.get(pollId)
  if (!enquete) {
    liberarVaga()
    enquete = { chatId: chatId || null, porHash: null, votos: new Map(), ultimoEmMs: emMs }
    urna.set(pollId, enquete)
  }
  // Substitui, não soma: trocar de voto manda outro pacote, e somar contaria a
  // mesma pessoa duas vezes.
  enquete.votos.set(eleitor, opcoes.filter((o) => typeof o === 'string' && o))
  enquete.ultimoEmMs = emMs
  return true
}

// O resultado de UMA enquete, já somado e ordenado do mais votado para o menos.
//
// Devolve null quando não há nada guardado — e isso NÃO significa "ninguém
// votou": significa "esta instância não viu voto nenhum", o que também
// acontece depois de um reinício. Quem chama precisa dizer isso com honestidade
// em vez de anunciar zero votos.
export function apurar (pollId) {
  const enquete = urna.get(pollId)
  if (!enquete) return null
  const total = new Map()
  for (const escolhidas of enquete.votos.values()) {
    for (const opcao of escolhidas) total.set(opcao, (total.get(opcao) || 0) + 1)
  }
  const linhas = [...total.entries()]
    .map(([opcao, votos]) => ({ opcao, votos }))
    .sort((a, b) => b.votos - a.votos || a.opcao.localeCompare(b.opcao))
  return { pollId, chatId: enquete.chatId, votantes: enquete.votos.size, opcoes: linhas }
}

// A última enquete que recebeu voto NESTA conversa.
//
// É o que permite um comando "/resultado" sem ninguém precisar copiar id de
// mensagem — que é coisa que pessoa nenhuma faz no WhatsApp.
export function ultimaDaConversa (chatId) {
  if (typeof chatId !== 'string' || !chatId) return null
  let achada = null
  for (const [id, dados] of urna) {
    if (dados.chatId !== chatId) continue
    if (!achada || dados.ultimoEmMs > achada.ultimoEmMs) achada = { id, ultimoEmMs: dados.ultimoEmMs }
  }
  return achada ? achada.id : null
}

export function limparTudo () {
  urna.clear()
}

export function quantasGuardadas () {
  return urna.size
}
