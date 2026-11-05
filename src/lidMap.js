// Tradução entre os dois endereços que o WhatsApp usa para a MESMA pessoa:
// o telefone (`5511999999999@s.whatsapp.net`) e o LID
// (`123456789012345@lid`), um identificador interno que não revela o número.
//
// Por que isto existe: uma menção (`@fulano`) chega em `mentionedJid` num
// formato SÓ — e às vezes é o LID. Sem tradução, "/adv @fulano" não casava com
// o contato salvo, e a variável do alvo apontava para o vazio.
//
// Como resolve sem custo de rede: toda mensagem recebida já traz o par pronto
// (`participant` + `participantAlt` são a mesma pessoa nos dois formatos, e o
// mesmo vale para `remoteJid`/`remoteJidAlt` em conversa direta). Basta
// memorizar o que já passa pela porta. O mapa melhora sozinho conforme as
// pessoas falam — e num grupo, todo mundo que já escreveu fica endereçável.
import fs from 'fs'
import path from 'path'
import { ARQ_LID_MAP, PASTA_DADOS } from './paths.js'

const ehLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid')
const ehTelefone = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')

// Remove o sufixo de dispositivo (":12@") que aparece em algumas stanzas: o
// mesmo contato com dispositivos diferentes é o mesmo contato.
function normalizar (jid) {
  if (typeof jid !== 'string' || !jid) return null
  return jid.replace(/:\d+@/, '@')
}

// Padrão sensato, não teto: um grupo grande conhece milhares de pessoas, e
// cada par custa poucas centenas de bytes. O mapa se reconstrói sozinho, então
// passar do limite só faz as pessoas MAIS ANTIGAS voltarem a ser aprendidas na
// próxima mensagem. Quem hospeda muita gente muda por LCN_LID_MAP_MAX.
const LIMITE_PADRAO = 50000
const limiteDoAmbiente = Number.parseInt(process.env.LCN_LID_MAP_MAX, 10)
let limite = Number.isSafeInteger(limiteDoAmbiente) && limiteDoAmbiente > 0 ? limiteDoAmbiente : LIMITE_PADRAO

let mapa = null
let sujo = false
let timerFlush = null
// Sobrescrito só por teste, para nunca escrever no data/ real do checkout.
let arquivoAtual = null
let pastaAtual = null

const arquivo = () => arquivoAtual || ARQ_LID_MAP
const pasta = () => pastaAtual || PASTA_DADOS

function carregar () {
  if (mapa) return mapa
  mapa = new Map()
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivo(), 'utf8'))
    for (const [lid, telefone] of Object.entries(bruto?.lidParaTelefone || {})) {
      if (ehLid(lid) && ehTelefone(telefone)) mapa.set(lid, telefone)
    }
    aparar()
  } catch {
    // Arquivo ausente ou corrompido é normal: o mapa se reconstrói sozinho
    // conforme as mensagens chegam. Nunca é motivo para derrubar o bot.
  }
  return mapa
}

// O Map lembra a ordem de inserção, então o primeiro é o menos recente.
function aparar () {
  for (const lid of mapa.keys()) {
    if (mapa.size <= limite) break
    mapa.delete(lid)
  }
}

function agendarGravacao () {
  if (timerFlush) return
  timerFlush = setTimeout(() => {
    timerFlush = null
    gravarAgora()
  }, 5000)
  timerFlush.unref?.()
}

export function gravarAgora () {
  if (!sujo || !mapa) return
  try {
    fs.mkdirSync(pasta(), { recursive: true })
    const lidParaTelefone = Object.fromEntries(mapa)
    const temp = path.join(pasta(), `.lid-map.${process.pid}.tmp`)
    // Sem indentação: o custo é o stringify, que bloqueia o laço de eventos, e
    // com 50 mil pares a forma indentada levava quase o dobro do tempo.
    fs.writeFileSync(temp, JSON.stringify({ versao: 1, lidParaTelefone }) + '\n', { mode: 0o600 })
    fs.renameSync(temp, arquivo())
    sujo = false
  } catch {
    // Não conseguir persistir não pode quebrar o envio de mensagem: o mapa
    // continua valendo em memória até o próximo reinício.
  }
}

// Aprende um par a partir de qualquer lugar que entregue os dois formatos.
// A ordem dos argumentos não importa: descobre qual é qual pelo sufixo.
export function registrarPar (umJid, outroJid) {
  const a = normalizar(umJid)
  const b = normalizar(outroJid)
  if (!a || !b || a === b) return false

  const lid = ehLid(a) ? a : (ehLid(b) ? b : null)
  const telefone = ehTelefone(a) ? a : (ehTelefone(b) ? b : null)
  if (!lid || !telefone) return false

  const atual = carregar()
  if (atual.get(lid) === telefone) {
    // Quem continua falando é o último a sair: reposiciona no fim da ordem de
    // inserção, sem sujar o arquivo.
    atual.delete(lid)
    atual.set(lid, telefone)
    return false
  }
  atual.delete(lid)
  atual.set(lid, telefone)
  aparar()
  sujo = true
  agendarGravacao()
  return true
}

// Aprende os pares que a chave de uma mensagem recebida carrega.
export function aprenderDaChave (key) {
  if (!key) return
  registrarPar(key.participant, key.participantAlt)
  // remoteJid/remoteJidAlt só são a mesma PESSOA em conversa direta; num
  // grupo o remoteJid é o grupo, e associá-lo a alguém seria errado.
  if (key.isGroup !== true) registrarPar(key.remoteJid, key.remoteJidAlt)
}

// Converte para telefone quando possível. Um JID que já é telefone volta como
// veio; um LID desconhecido também volta como veio — nunca inventa número.
export function paraTelefone (jid) {
  const alvo = normalizar(jid)
  if (!alvo) return null
  if (!ehLid(alvo)) return alvo
  return carregar().get(alvo) || alvo
}

export function tamanho () {
  return carregar().size
}

// Troca o limite em execução (config do painel, teste). Valor inválido é
// ignorado; baixar o limite apara na hora.
export function definirLimite (novo) {
  if (!Number.isSafeInteger(novo) || novo <= 0) return limite
  limite = novo
  if (mapa) {
    const antes = mapa.size
    aparar()
    if (mapa.size !== antes) { sujo = true; agendarGravacao() }
  }
  return limite
}

// Só para teste: descarta o estado em memória e força releitura do disco.
export function _reiniciarParaTeste (caminho) {
  mapa = null
  sujo = false
  if (timerFlush) { clearTimeout(timerFlush); timerFlush = null }
  if (caminho !== undefined) {
    arquivoAtual = caminho
    pastaAtual = caminho ? path.dirname(caminho) : null
  }
}
