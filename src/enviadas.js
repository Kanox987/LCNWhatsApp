// As mensagens que ESTE bot acabou de enviar.
//
// Existe para desfazer uma confusão do WhatsApp: ele marca `fromMe: true` em
// duas coisas muito diferentes —
//
//   1. a mensagem que o BOT produziu (resposta de automação)
//   2. a mensagem que uma PESSOA digitou no celular do bot
//
// Tratar as duas igual custa caro dos dois lados. Se o bot reage à primeira,
// vira laço: ele responde, aquilo volta como evento, ele responde de novo. Se
// o bot ignora a segunda, o dono não consegue usar as próprias automações do
// número dele — que foi exatamente a reclamação: mandar link e o download
// automático não fazer nada.
//
// Quem sabe a diferença é só este processo: ele recebeu o id de volta no envio.
//
// LIMITE CONHECIDO: isto vive na memória do gateway. Depois de um reinício, uma
// mensagem que o bot mandou antes de cair volta a parecer "digitada por uma
// pessoa". A janela é o TTL abaixo, e o custo é uma reação a mais, não um laço
// — o evento antigo não se repete sozinho.
const TTL_MS = 10 * 60 * 1000

// Varrer o Map inteiro a cada envio custava O(n) por mensagem: com 50 mil ids
// vivos na janela de 10 min, o registro sozinho levava 16 s. A consulta já
// confere o vencimento de cada id, então a varredura só precisa limitar a
// memória — uma vez por intervalo basta.
const INTERVALO_LIMPEZA_MS = 30 * 1000

const enviadas = new Map()
let proximaLimpeza = 0

function limpar (agora) {
  for (const [id, expiraEm] of enviadas) {
    if (expiraEm <= agora) enviadas.delete(id)
  }
  proximaLimpeza = agora + INTERVALO_LIMPEZA_MS
}

export function registrar (id, ttlMs = TTL_MS) {
  if (typeof id !== 'string' || !id) return
  const agora = Date.now()
  if (agora >= proximaLimpeza) limpar(agora)
  enviadas.set(id, agora + ttlMs)
}

export function foiEnviadaPorNos (id) {
  if (typeof id !== 'string' || !id) return false
  const expiraEm = enviadas.get(id)
  if (expiraEm === undefined) return false
  if (expiraEm <= Date.now()) {
    enviadas.delete(id)
    return false
  }
  return true
}

// Só para teste — a memória não é observável de fora de outro jeito.
export function _tamanho () {
  limpar(Date.now())
  return enviadas.size
}

export function _limparTudo () {
  enviadas.clear()
  proximaLimpeza = 0
}
