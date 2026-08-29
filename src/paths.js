// Caminhos centrais do LCNWhatsApp. Tudo relativo à raiz do projeto, pra
// funcionar igual no container (volumes montados) e no seco.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const RAIZ = path.resolve(__dirname, '..')
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
