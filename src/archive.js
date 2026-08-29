// Índice das mídias capturadas (data/archive.json). Guarda metadados; os arquivos
// em si ficam em midia/. Usado pra galeria, contagem por remetente, recuperação e
// limpeza (por seleção ou em lote).
import fs from 'fs'
import path from 'path'
import { ARQ_ARQUIVO, PASTA_MIDIA, garantirPastas } from './paths.js'

function lerBruto () {
  try {
    return JSON.parse(fs.readFileSync(ARQ_ARQUIVO, 'utf8'))
  } catch {
    return { itens: [] }
  }
}

function gravarBruto (dados) {
  garantirPastas()
  fs.writeFileSync(ARQ_ARQUIVO, JSON.stringify(dados, null, 2) + '\n')
}

// Registra uma captura. `arquivo` é o caminho absoluto salvo em midia/.
export function registrar ({ tipo, numero, nome, caption, arquivo, transcricao }) {
  const dados = lerBruto()
  const item = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tipo,
    numero: String(numero || 'desconhecido'),
    nome: nome || null,
    caption: caption || null,
    transcricao: transcricao || null,
    arquivo: path.basename(arquivo),
    tamanho: (() => { try { return fs.statSync(arquivo).size } catch { return 0 } })(),
    timestamp: Date.now()
  }
  dados.itens.push(item)
  gravarBruto(dados)
  return item
}

export function listar () {
  return lerBruto().itens.sort((a, b) => b.timestamp - a.timestamp)
}

export function obter (id) {
  return lerBruto().itens.find((i) => i.id === id) || null
}

export function caminhoDe (item) {
  return path.join(PASTA_MIDIA, item.arquivo)
}

// Contagem de mídias por remetente: { numero: quantidade }.
export function contagemPorNumero () {
  const mapa = {}
  for (const i of lerBruto().itens) mapa[i.numero] = (mapa[i.numero] || 0) + 1
  return mapa
}

export function total () {
  return lerBruto().itens.length
}

// Apaga itens por id (seleção) ou por filtro em lote. Remove o arquivo físico
// e a entrada do índice. Retorna quantos foram apagados.
export function apagar (ids) {
  const alvo = new Set(ids)
  const dados = lerBruto()
  let apagados = 0
  dados.itens = dados.itens.filter((i) => {
    if (!alvo.has(i.id)) return true
    try { fs.unlinkSync(path.join(PASTA_MIDIA, i.arquivo)) } catch {}
    apagados++
    return false
  })
  gravarBruto(dados)
  return apagados
}

// Filtra ids por remetente e/ou período (ms epoch) — pra limpeza em lote.
export function idsPorFiltro ({ numero, de, ate } = {}) {
  return lerBruto().itens
    .filter((i) => (numero ? i.numero === String(numero) : true))
    .filter((i) => (de ? i.timestamp >= de : true))
    .filter((i) => (ate ? i.timestamp <= ate : true))
    .map((i) => i.id)
}
