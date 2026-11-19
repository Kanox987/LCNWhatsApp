// Índice das mídias capturadas pelo pipeline antigo de visualização única
// (data/archive.json); os arquivos em si ficam em midia/. A recuperação saiu do
// LCN e nada mais registra aqui: sobrou só o que a limpeza do `lcn` precisa
// para apagar as capturas de instalações antigas (por seleção ou em lote).
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

export function listar () {
  return lerBruto().itens.sort((a, b) => b.timestamp - a.timestamp)
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
