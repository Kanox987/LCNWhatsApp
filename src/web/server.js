// Módulo 4 da Etapa 4.5 — transporte HTTP local do painel. De propósito
// "burro": só escuta, faz parsing de corpo e despacha pro roteador — toda
// decisão de negócio mora em application.js/router.js. Reaproveita os
// helpers do transporte do motor (lerCorpoJson/enviarJson/ErroHttp) em vez
// de duplicá-los — mesma forma de erro `{error, details}` nos dois lados.
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { enviarJson, lerCorpoJson } from '../engine/server/transport.js'
import { criarRoteadorWeb } from './router.js'
import { ehRespostaBinaria, enviarBinario } from './binario.js'
import { criarAplicacao } from '../agent/application.js'

const HOSTS_PERMITIDOS = new Set(['127.0.0.1', 'localhost', '::1'])
const PASTA_PUBLIC_PADRAO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

// Servido só pra rotas FORA de /api/v1 — nunca mistura com a API (um 404 de
// API precisa continuar sendo JSON, não cair pra index.html). É um SPA
// simples (wizard/páginas client-side): qualquer caminho sem extensão de
// arquivo conhecida cai pra index.html, o roteamento de tela é responsabilidade
// do próprio front-end (Módulo 5), não deste servidor.
function servirEstatico (pastaPublic, urlPath, res) {
  const relativo = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const candidato = path.normalize(path.join(pastaPublic, relativo))
  // Nunca serve nada fora da pasta public — bloqueia "../" e symlink escape.
  if (!candidato.startsWith(path.normalize(pastaPublic) + path.sep) && candidato !== path.normalize(pastaPublic)) {
    enviarJson(res, 400, { error: 'Caminho inválido.' })
    return
  }
  const alvoComExtensao = path.extname(candidato) ? candidato : null
  const arquivo = alvoComExtensao && fs.existsSync(alvoComExtensao) && fs.statSync(alvoComExtensao).isFile()
    ? alvoComExtensao
    : path.join(pastaPublic, 'index.html')
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) return enviarJson(res, 404, { error: 'Painel web ainda não instalado (src/web/public/index.html não encontrado).' })
    const tipo = TIPOS_MIME[path.extname(arquivo)] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': tipo, 'content-length': Buffer.byteLength(conteudo) })
    res.end(conteudo)
  })
}

export async function iniciarServidorWeb ({ host = '127.0.0.1', port = 4780, aplicacao = criarAplicacao(), pastaPublic = PASTA_PUBLIC_PADRAO } = {}) {
  // Regra fixa do plano: NUNCA expor isto em 0.0.0.0 sem autenticação — a
  // única fronteira de segurança hoje é "só alcançável localmente". Trocar
  // isso por hospedagem pública é outra etapa inteira (control plane/WSS).
  if (!HOSTS_PERMITIDOS.has(host)) {
    throw new Error(`src/web/server.js só pode escutar em 127.0.0.1/localhost (recebido: ${host}).`)
  }

  const roteador = criarRoteadorWeb(aplicacao)

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        return servirEstatico(pastaPublic, url.pathname, res)
      }
      const body = await lerCorpoJson(req)
      const retorno = await roteador.resolver(req.method, url.pathname, { req, body, query: url.searchParams })
      if (ehRespostaBinaria(retorno)) enviarBinario(res, retorno)
      else if (retorno?.__respostaHttp) enviarJson(res, retorno.status, retorno.body)
      else enviarJson(res, 200, retorno)
    } catch (erro) {
      // client.js (chamadas ao motor) usa `.status`/`.details`; ErroHttp
      // local do motor usa `.status`/`.detalhes` — normaliza os dois. Sem
      // `.status` numérico = motor inalcançável/erro de rede, não bug
      // nosso: 502, não 500.
      const status = Number.isInteger(erro?.status) ? erro.status : 502
      const body = { error: erro?.message || 'Falha ao processar requisição.' }
      const detalhes = erro?.detalhes !== undefined ? erro.detalhes : erro?.details
      if (detalhes !== undefined) body.details = detalhes
      if (status >= 500) console.error('[web] erro na API:', erro)
      if (!res.headersSent) enviarJson(res, status, body)
      else res.destroy()
    }
  })

  await new Promise((resolve, reject) => {
    const falhou = (erro) => { servidor.off('listening', iniciou); reject(erro) }
    const iniciou = () => { servidor.off('error', falhou); resolve() }
    servidor.once('error', falhou)
    servidor.once('listening', iniciou)
    servidor.listen(port, host)
  })

  return {
    servidor,
    host,
    // `port` pode ter sido pedido como 0 (porta efêmera) — o SO decide a
    // porta real só depois do listen() resolver, por isso lê de
    // servidor.address() em vez de ecoar o parâmetro recebido.
    port: servidor.address().port,
    fechar: () => new Promise((resolve, reject) => {
      servidor.close((erro) => (erro ? reject(erro) : resolve()))
    })
  }
}
