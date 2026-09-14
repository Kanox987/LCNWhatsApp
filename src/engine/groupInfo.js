// Dados do grupo (nome, tamanho, quem é admin) para o evento canônico.
//
// Isto mora no GATEWAY, não no motor, pela mesma regra de sempre: quem tem
// sessão do WhatsApp é este lado. O motor recebe o resultado já pronto dentro
// do evento e nunca faz chamada de rede.
//
// O problema que o cache resolve: `queryGroupMetadata` é uma ida ao servidor do
// WhatsApp. Sem cache seria UMA CHAMADA DE REDE POR MENSAGEM de grupo — num
// grupo movimentado, isso é convite para a conta ser limitada, além de somar
// latência em cima de cada resposta.
//
// Por que o cache não fica desatualizado no que importa: `invalidar()` é
// chamado nos eventos de grupo (promoveu, rebaixou, entrou, saiu, mudou o
// nome). O TTL é só rede de segurança para o caso de um evento se perder — não
// é o mecanismo principal. Isso importa porque `isAdmin` vira decisão de
// permissão: alguém rebaixado não pode continuar mandando no bot por causa de
// cache velho.
//
// Tudo aqui falha aberto: sem metadados, os campos simplesmente não entram no
// evento, e {{sender.isAdmin}} fica literal no texto. Nunca se inventa um
// "false", que seria indistinguível de "não é admin" e transformaria falha de
// rede em decisão de permissão silenciosa.
import * as lidMap from '../lidMap.js'

const TTL_MS = 5 * 60 * 1000
// Falha fica guardada por pouco tempo só para não repetir a chamada a cada
// mensagem enquanto o problema dura. Curto, porque a causa costuma ser passageira.
const TTL_FALHA_MS = 30 * 1000
const TIMEOUT_MS = 4000
const MAX_GRUPOS = 500

const cache = new Map()
const emVoo = new Map()

function normalizar (jid) {
  return typeof jid === 'string' && jid ? jid.replace(/:\d+@/, '@') : null
}

// Mantém o cache limitado: um bot em muitos grupos não pode crescer sem teto.
// Map preserva ordem de inserção, então o primeiro é o mais antigo.
function podar () {
  while (cache.size > MAX_GRUPOS) {
    const maisAntigo = cache.keys().next().value
    if (maisAntigo === undefined) break
    cache.delete(maisAntigo)
  }
}

export function invalidar (groupJid) {
  const alvo = normalizar(groupJid)
  if (alvo) cache.delete(alvo)
}

export function limparTudo () {
  cache.clear()
  emVoo.clear()
}

// Os participantes vêm com jid, lid e phoneNumber na MESMA linha — é a fonte
// mais confiável de pares LID↔telefone que existe, melhor que aprender de
// mensagem em mensagem, porque cobre quem ainda não falou no grupo.
function aprenderPares (participantes) {
  for (const p of participantes) {
    try { lidMap.registrarPar(p?.lid, p?.phoneNumber) } catch {}
  }
}

function resumir (metadados) {
  const participantes = Array.isArray(metadados?.participants) ? metadados.participants : []
  aprenderPares(participantes)

  // Um mesmo participante é endereçável por até três formas. Guardar as três
  // evita depender de qual delas o evento trouxe em sender.id.
  const admins = new Set()
  for (const p of participantes) {
    if (!p?.isAdmin) continue
    for (const forma of [p.jid, p.lid, p.phoneNumber]) {
      const n = normalizar(forma)
      if (n) admins.add(n)
    }
  }

  return {
    name: typeof metadados?.subject === 'string' && metadados.subject ? metadados.subject : null,
    size: Number.isInteger(metadados?.size) ? metadados.size : participantes.length || null,
    // `announce` significa "só admin escreve". Vale expor porque muda o que
    // um comando consegue fazer no grupo.
    onlyAdmins: metadados?.announce === true,
    admins
  }
}

function comTimeout (promessa, ms) {
  let timer
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout ao consultar os dados do grupo')), ms)
  })
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer))
}

export async function obter (client, groupJid, { agoraMs = Date.now() } = {}) {
  const alvo = normalizar(groupJid)
  if (!alvo || typeof client?.group?.queryGroupMetadata !== 'function') return null

  const guardado = cache.get(alvo)
  if (guardado && guardado.expiraEm > agoraMs) return guardado.dados

  // Duas mensagens ao mesmo tempo no mesmo grupo devem render UMA consulta.
  const jaIndo = emVoo.get(alvo)
  if (jaIndo) return jaIndo

  const busca = comTimeout(Promise.resolve().then(() => client.group.queryGroupMetadata(alvo)), TIMEOUT_MS)
    .then((metadados) => {
      const dados = resumir(metadados)
      cache.set(alvo, { expiraEm: Date.now() + TTL_MS, dados })
      podar()
      return dados
    })
    .catch(() => {
      cache.set(alvo, { expiraEm: Date.now() + TTL_FALHA_MS, dados: null })
      podar()
      return null
    })
    .finally(() => emVoo.delete(alvo))

  emVoo.set(alvo, busca)
  return busca
}

// Preenche o evento canônico com o que só o gateway consegue saber. Devolve o
// MESMO evento (mutado) para não custar uma cópia no caminho quente.
export async function enriquecerEvento (client, evento) {
  if (evento?.chat?.kind !== 'group') return evento

  const dados = await obter(client, evento.chat.id)
  if (!dados) return evento

  if (dados.name) evento.chat.name = dados.name
  if (dados.size) evento.chat.size = dados.size
  evento.chat.onlyAdmins = dados.onlyAdmins

  const remetente = normalizar(evento.sender?.id)
  if (remetente) evento.sender.isAdmin = dados.admins.has(remetente)

  // Saber se o PRÓPRIO bot é admin é o que permite um comando avisar "não
  // consigo remover ninguém aqui" em vez de tentar e falhar na cara da pessoa.
  const proprio = normalizar(evento.bot?.id)
  if (proprio) evento.bot.isAdmin = dados.admins.has(proprio)

  return evento
}

// Só para teste: quantos grupos estão guardados agora.
export function tamanhoDoCache () {
  return cache.size
}
