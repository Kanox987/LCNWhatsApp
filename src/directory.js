// Diretório de contatos/grupos conhecidos — alimenta as telas de seleção do
// dashboard (em vez de digitar JID/número de cabeça). Guardado em arquivos
// simples (data/contatos.json, data/grupos.json) pra funcionar igual no
// dashboard (processo separado) e no bot.
import fs from 'fs'
import path from 'path'
import { ARQ_CONTATOS, ARQ_GRUPOS, PASTA_DADOS } from './paths.js'
import { soDigitos } from './util.js'

// Sobrescrito só por teste, para nunca escrever no data/ real do checkout.
let pastaSobrescrita = null
const pastaDados = () => pastaSobrescrita || PASTA_DADOS
const arqContatos = () => (pastaSobrescrita ? path.join(pastaSobrescrita, 'contatos.json') : ARQ_CONTATOS)
const arqGrupos = () => (pastaSobrescrita ? path.join(pastaSobrescrita, 'grupos.json') : ARQ_GRUPOS)

export function _usarPastaParaTeste (pasta) {
  pastaSobrescrita = pasta || null
  nomes = null
}

function lerJson (arq) {
  try {
    if (!fs.existsSync(arq)) return []
    const dados = JSON.parse(fs.readFileSync(arq, 'utf8'))
    return Array.isArray(dados) ? dados : []
  } catch {
    return []
  }
}

function escreverJson (arq, dados) {
  if (!fs.existsSync(pastaDados())) fs.mkdirSync(pastaDados(), { recursive: true })
  fs.writeFileSync(arq, JSON.stringify(dados, null, 2) + '\n')
}

// Grava/atualiza um contato conhecido. Só escreve em disco quando algo muda
// de fato (número novo ou nome diferente) — evita I/O a cada mensagem.
// Índice número -> nome, em memória. Existe porque resolver {{sender.name}}
// acontece em TODA mensagem: reler e varrer o JSON a cada uma seria I/O no
// caminho quente. Invalidado sempre que um contato muda.
let nomes = null

function indiceDeNomes () {
  if (nomes) return nomes
  nomes = new Map()
  for (const c of lerJson(arqContatos())) {
    if (c?.numero && c?.nome) nomes.set(c.numero, c.nome)
  }
  return nomes
}

// O nome que já se viu desta pessoa. O WhatsApp não manda o nome de exibição
// em toda mensagem, mas ele quase não muda — então lembrar o último que passou
// é o que faz {{sender.name}} valer sempre, em vez de valer às vezes.
export function nomeDe (numeroOuJid) {
  const num = soDigitos(numeroOuJid)
  if (!num) return null
  return indiceDeNomes().get(num) || null
}

export function registrarContato (numero, nome) {
  const num = soDigitos(numero)
  if (!num) return
  const lista = lerJson(arqContatos())
  const existente = lista.find((c) => c.numero === num)
  const nomeFinal = nome || existente?.nome || ''
  if (existente) {
    if (existente.nome === nomeFinal) return
    existente.nome = nomeFinal
  } else {
    lista.push({ numero: num, nome: nomeFinal })
  }
  escreverJson(arqContatos(), lista)
  nomes = null
}

export function listarContatos () {
  return lerJson(arqContatos())
}

// Normaliza o retorno de queryAllGroups(): a doc do Zapo só diz "retorna uma
// coleção completa", sem confirmar se é array, Map ou objeto {jid: metadata}
// (o formato antigo da Baileys). Cobre os três até validar em teste real.
function normalizarGrupos (grupos) {
  if (Array.isArray(grupos)) return grupos
  if (grupos instanceof Map) return Array.from(grupos.values())
  if (grupos && typeof grupos === 'object') return Object.values(grupos)
  return []
}

// Busca a lista de grupos que a conta participa e grava em disco.
export async function atualizarGrupos (client) {
  const grupos = await client.group.queryAllGroups()
  const lista = normalizarGrupos(grupos).map((g) => ({ id: g.jid, nome: g.subject || g.jid }))
  escreverJson(arqGrupos(), lista)
  return lista
}

export function listarGrupos () {
  return lerJson(arqGrupos())
}
