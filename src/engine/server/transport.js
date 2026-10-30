import fs from 'fs'
import http from 'http'
import net from 'net'
import path from 'path'
import { SOCKET_PATH } from '../paths.js'

const LIMITE_CORPO = 1024 * 1024

export class ErroHttp extends Error {
  constructor (status, message, detalhes) {
    super(message)
    this.status = status
    this.detalhes = detalhes
  }
}

export function resposta (status, body, headers = {}) {
  return { __respostaHttp: true, status, body, headers }
}

function compilarCaminho (modelo) {
  const nomes = []
  const partes = modelo.split('/').filter(Boolean).map((parte) => {
    if (parte.startsWith(':')) {
      nomes.push(parte.slice(1))
      return '([^/]+)'
    }
    return parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  return { regex: new RegExp(`^/${partes.join('/')}/?$`), nomes }
}

export function criarRoteador () {
  const rotas = []
  const adicionar = (method, modelo, handler) => rotas.push({ method, handler, ...compilarCaminho(modelo) })
  const roteador = {
    get: (caminho, handler) => adicionar('GET', caminho, handler),
    post: (caminho, handler) => adicionar('POST', caminho, handler),
    put: (caminho, handler) => adicionar('PUT', caminho, handler),
    delete: (caminho, handler) => adicionar('DELETE', caminho, handler),
    async resolver (method, pathname, contexto) {
      for (const rota of rotas) {
        if (rota.method !== method) continue
        const match = rota.regex.exec(pathname)
        if (!match) continue
        const params = {}
        rota.nomes.forEach((nome, i) => { params[nome] = decodeURIComponent(match[i + 1]) })
        return rota.handler({ ...contexto, params })
      }
      throw new ErroHttp(404, 'Rota não encontrada.')
    }
  }
  return roteador
}

export function lerCorpoJson (req) {
  return new Promise((resolve, reject) => {
    const partes = []
    let tamanho = 0
    req.on('data', (parte) => {
      tamanho += parte.length
      if (tamanho > LIMITE_CORPO) {
        reject(new ErroHttp(413, 'Corpo da requisição excede 1 MiB.'))
        req.destroy()
        return
      }
      partes.push(parte)
    })
    req.on('end', () => {
      if (!partes.length) return resolve(null)
      try {
        resolve(JSON.parse(Buffer.concat(partes).toString('utf8')))
      } catch {
        reject(new ErroHttp(400, 'Corpo JSON inválido.'))
      }
    })
    req.on('error', reject)
  })
}

export function enviarJson (res, status, body, headersExtras = {}) {
  // 304 Not Modified: sem corpo, só cabeçalhos. O spec HTTP proíbe body em 304,
  // e alguns clientes (incluindo fetch do navegador) podem se comportar de forma
  // imprevisível se receberem conteúdo num 304.
  if (status === 304) {
    res.writeHead(304, headersExtras)
    res.end()
    return
  }
  const conteudo = JSON.stringify(body ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(conteudo),
    ...headersExtras
  })
  res.end(conteudo)
}

function socketAtivo (socketPath) {
  return new Promise((resolve, reject) => {
    const cliente = net.createConnection(socketPath)
    const terminar = (valor) => { cliente.destroy(); resolve(valor) }
    cliente.setTimeout(400, () => terminar(true))
    cliente.once('connect', () => terminar(true))
    cliente.once('error', (erro) => {
      if (erro.code === 'ECONNREFUSED' || erro.code === 'ENOENT') return terminar(false)
      cliente.destroy()
      reject(erro)
    })
  })
}

async function prepararSocket (socketPath) {
  const pasta = path.dirname(socketPath)
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 })
  fs.chmodSync(pasta, 0o700)
  if (!fs.existsSync(socketPath)) return
  const stat = fs.lstatSync(socketPath)
  if (!stat.isSocket()) throw new Error(`O caminho do socket existe e não é um socket: ${socketPath}`)
  if (await socketAtivo(socketPath)) throw new Error('O motor já está rodando.')
  fs.rmSync(socketPath)
}

export async function iniciarTransport (roteador, { socketPath = SOCKET_PATH, autenticar = null } = {}) {
  await prepararSocket(socketPath)
  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      const body = await lerCorpoJson(req)
      let contextoAuth = null
      if (autenticar) {
        const header = req.headers.authorization
        const token = header?.startsWith('Bearer ') ? header.slice(7) : null
        contextoAuth = token ? autenticar(token) : null
        if (!contextoAuth && req.method !== 'GET' && req.method !== 'HEAD') {
          throw new ErroHttp(401, 'Token de API ausente ou inválido.')
        }
      }
      const retorno = await roteador.resolver(req.method, url.pathname, { req, body, query: url.searchParams, contextoAuth })
      if (retorno?.__respostaHttp) {
        // Suporte a ETag em respostas HTTP estruturadas: o campo `etag` é
        // opcional e só aparece quando o endpoint quer habilitar conditional
        // requests (ex: /pairing). Headers extras vindos de `resposta()`
        // também são repassados aqui.
        const headersExtras = { ...(retorno.headers || {}) }
        if (retorno.etag) headersExtras.etag = retorno.etag
        enviarJson(res, retorno.status, retorno.body, headersExtras)
      } else enviarJson(res, 200, retorno)
    } catch (erro) {
      const status = Number.isInteger(erro?.status) ? erro.status : 500
      const body = { error: status === 500 ? 'Erro interno do motor.' : erro.message }
      if (erro?.detalhes !== undefined) body.details = erro.detalhes
      if (status === 500) console.error('[engine] erro na API:', erro)
      if (!res.headersSent) enviarJson(res, status, body)
      else res.destroy()
    }
  })

  await new Promise((resolve, reject) => {
    const falhou = (erro) => { servidor.off('listening', iniciou); reject(erro) }
    const iniciou = () => { servidor.off('error', falhou); resolve() }
    servidor.once('error', falhou)
    servidor.once('listening', iniciou)
    servidor.listen(socketPath)
  })
  fs.chmodSync(socketPath, 0o600)

  return {
    servidor,
    socketPath,
    fechar: () => new Promise((resolve, reject) => {
      servidor.close((erro) => {
        if (erro) return reject(erro)
        try {
          if (fs.existsSync(socketPath) && fs.lstatSync(socketPath).isSocket()) fs.rmSync(socketPath)
        } catch {}
        resolve()
      })
    })
  }
}
