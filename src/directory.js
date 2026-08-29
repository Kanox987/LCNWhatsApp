// Diretório de contatos/grupos conhecidos — alimenta as telas de seleção do
// dashboard (em vez de digitar JID/número de cabeça). Guardado em arquivos
// simples (data/contatos.json, data/grupos.json) pra funcionar igual no
// dashboard (processo separado) e no bot.
import fs from 'fs'
import { ARQ_CONTATOS, ARQ_GRUPOS, PASTA_DADOS } from './paths.js'
import { soDigitos } from './util.js'

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
  if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true })
  fs.writeFileSync(arq, JSON.stringify(dados, null, 2) + '\n')
}

// Grava/atualiza um contato conhecido. Só escreve em disco quando algo muda
// de fato (número novo ou nome diferente) — evita I/O a cada mensagem.
export function registrarContato (numero, nome) {
  const num = soDigitos(numero)
  if (!num) return
  const lista = lerJson(ARQ_CONTATOS)
  const existente = lista.find((c) => c.numero === num)
  const nomeFinal = nome || existente?.nome || ''
  if (existente) {
    if (existente.nome === nomeFinal) return
    existente.nome = nomeFinal
  } else {
    lista.push({ numero: num, nome: nomeFinal })
  }
  escreverJson(ARQ_CONTATOS, lista)
}

export function listarContatos () {
  return lerJson(ARQ_CONTATOS)
}

// Busca a lista de grupos que a conta participa e grava em disco.
export async function atualizarGrupos (sock) {
  const mapa = await sock.groupFetchAllParticipating()
  const lista = Object.values(mapa).map((g) => ({ id: g.id, nome: g.subject || g.id }))
  escreverJson(ARQ_GRUPOS, lista)
  return lista
}

export function listarGrupos () {
  return lerJson(ARQ_GRUPOS)
}
