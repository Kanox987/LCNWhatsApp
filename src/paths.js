// Caminhos centrais do LCNWhatsApp. Tudo relativo à raiz do projeto, pra
// funcionar igual no container (volumes montados) e rodando direto na máquina.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// MAIS DE UM NÚMERO NO MESMO CONTAINER.
//
// Sem isto, dois bots dividiam `sessao/`, `data/state.json` e `data/bot.pid` —
// e dividir sessão é exatamente o conflito que derruba os dois: cada conexão
// nova "substitui" a anterior no servidor do WhatsApp, e ambos caem em laço.
//
// `LCN_INSTANCIA=<nome>` dá a cada número a sua própria sessão, o seu estado e
// o seu pid. Sem a variável, os caminhos são EXATAMENTE os de sempre: quem já
// roda um número não precisa migrar nada, e a pasta antiga continua sendo a do
// número principal.
//
//   node index.js                                    -> sessao/  data/
//   LCN_INSTANCIA=dois node index.js --code=5522...  -> sessao/instancias/dois/  data/instancias/dois/
//
// O motor NÃO é dividido de propósito: ele é central, e cada gateway se
// identifica pelo próprio accountId (data/instance-id.txt, que agora nasce
// diferente por instância). É assim que o mesmo comando vale para os dois
// números sem cada um ter o seu banco.
const INSTANCIA = (process.env.LCN_INSTANCIA || '').trim().replace(/[^\w.-]/g, '')

export const NOME_INSTANCIA = INSTANCIA || null

const sub = (base) => (INSTANCIA ? path.join(base, 'instancias', INSTANCIA) : base)

export const PASTA_SESSAO = sub(path.join(RAIZ, 'sessao'))
export const PASTA_MIDIA = sub(path.join(RAIZ, 'midia'))
export const PASTA_DADOS = sub(path.join(RAIZ, 'data'))

export const ARQ_CONFIG = path.join(RAIZ, 'config.json')
export const ARQ_CONFIG_EXEMPLO = path.join(RAIZ, 'config.example.json')
export const ARQ_ESTADO = path.join(PASTA_DADOS, 'state.json')
export const ARQ_ARQUIVO = path.join(PASTA_DADOS, 'archive.json')
export const ARQ_RUNTIME = path.join(RAIZ, 'runtime.json')
export const ARQ_CONTATOS = path.join(PASTA_DADOS, 'contatos.json')
export const ARQ_GRUPOS = path.join(PASTA_DADOS, 'grupos.json')
// Pares LID <-> telefone aprendidos das mensagens recebidas (ver src/lidMap.js).
export const ARQ_LID_MAP = path.join(PASTA_DADOS, 'lid-map.json')
export const ARQ_GRUPOS_REFRESH = path.join(PASTA_DADOS, 'grupos-refresh.request')

export function garantirPastas () {
  for (const dir of [PASTA_SESSAO, PASTA_MIDIA, PASTA_DADOS]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}
