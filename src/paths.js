// Caminhos centrais do LCNWhatsApp. Tudo relativo à raiz do projeto, pra
// funcionar igual no container (volumes montados), no seco e empacotado
// como .exe standalone (Node SEA, Windows).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

// createRequire só precisa de uma string/URL válida como âncora de resolução
// pra achar módulos — não precisa ser o arquivo real, e node:sea resolve por
// nome (builtin) independente da âncora. process.execPath serve bem e,
// diferente de import.meta.url, continua válido mesmo depois do esbuild
// bundlar isto pra CJS (exigência do SEA) — o esbuild ESVAZIA import.meta.url
// nesse processo, o que quebraria exatamente a detecção que este código
// precisa fazer. isSea() é builtin do Node (node:sea) e retorna false fora
// de um SEA — o catch cobre só Node antigo sem esse módulo.
function estaEmpacotadoComoSea () {
  try { return createRequire(process.execPath)('node:sea').isSea() } catch { return false }
}

// Calculado sob demanda (não no top-level do módulo): dentro do bundle CJS
// injetado no .exe, import.meta.url vem vazio (mesmo motivo do comentário
// acima) — chamar fileURLToPath nele lançaria ANTES de sequer chegar a
// checar estaEmpacotadoComoSea(). Como só entra nessa branch quando NÃO é
// SEA, o valor vazio nunca chega a ser avaliado nesse cenário.
function raizViaImportMetaUrl () {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

export const RAIZ = estaEmpacotadoComoSea()
  ? path.dirname(process.execPath) // .exe standalone: RAIZ = pasta onde o lcn.exe está
  : raizViaImportMetaUrl()         // node index.js / node src/dashboard.js: comportamento de sempre
export const PASTA_SESSAO = path.join(RAIZ, 'sessao')
export const PASTA_MIDIA = path.join(RAIZ, 'midia')
export const PASTA_DADOS = path.join(RAIZ, 'data')

export const ARQ_CONFIG = path.join(RAIZ, 'config.json')
export const ARQ_CONFIG_EXEMPLO = path.join(RAIZ, 'config.example.json')
export const ARQ_ESTADO = path.join(PASTA_DADOS, 'state.json')
export const ARQ_ARQUIVO = path.join(PASTA_DADOS, 'archive.json')
export const ARQ_RUNTIME = path.join(RAIZ, 'runtime.json')
export const ARQ_CONTATOS = path.join(PASTA_DADOS, 'contatos.json')
export const ARQ_GRUPOS = path.join(PASTA_DADOS, 'grupos.json')
export const ARQ_GRUPOS_REFRESH = path.join(PASTA_DADOS, 'grupos-refresh.request')

export function garantirPastas () {
  for (const dir of [PASTA_SESSAO, PASTA_MIDIA, PASTA_DADOS]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}
