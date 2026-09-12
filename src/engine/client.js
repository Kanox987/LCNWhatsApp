import http from 'http'
import { SOCKET_PATH } from './paths.js'

function caminho (base, id) {
  return `${base}/${encodeURIComponent(id)}`
}

export function criarClienteEngine ({ socketPath = SOCKET_PATH } = {}) {
  const requisitar = (method, pathname, body) => new Promise((resolve, reject) => {
    const conteudo = body === undefined ? null : JSON.stringify(body)
    const req = http.request({
      socketPath,
      method,
      path: pathname,
      headers: conteudo === null ? {} : {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(conteudo)
      }
    }, (res) => {
      const partes = []
      res.on('data', (parte) => partes.push(parte))
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8')
        let resposta = null
        try { resposta = texto ? JSON.parse(texto) : null } catch { return reject(new Error('Resposta JSON inválida do motor.')) }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(resposta)
        const erro = new Error(resposta?.error || `Motor respondeu HTTP ${res.statusCode}.`)
        erro.status = res.statusCode
        erro.details = resposta?.details
        reject(erro)
      })
    })
    req.on('error', (erro) => {
      if (erro.code === 'ENOENT' || erro.code === 'ECONNREFUSED') {
        return reject(new Error('motor não está rodando — lcn engine start'))
      }
      reject(new Error(`Falha ao comunicar com o motor: ${erro.message}`))
    })
    if (conteudo !== null) req.end(conteudo)
    else req.end()
  })

  return {
    saude: () => requisitar('GET', '/health'),
    automacoes: {
      listar: () => requisitar('GET', '/automations'),
      criar: (documento) => requisitar('POST', '/automations', documento),
      obter: (id) => requisitar('GET', caminho('/automations', id)),
      listarRevisoes: (id) => requisitar('GET', `${caminho('/automations', id)}/revisions`),
      obterRevisao: (id, revision) => requisitar('GET', `${caminho('/automations', id)}/revisions/${encodeURIComponent(revision)}`),
      salvarRascunho: (id, documento) => requisitar('PUT', `${caminho('/automations', id)}/draft`, documento),
      validar: (id, documento) => requisitar('POST', `${caminho('/automations', id)}/validate`, documento),
      remover: (id) => requisitar('DELETE', caminho('/automations', id))
    },
    pools: {
      listar: () => requisitar('GET', '/pools'),
      criar: (dados) => requisitar('POST', '/pools', dados),
      obter: (id) => requisitar('GET', caminho('/pools', id)),
      atualizar: (id, dados) => requisitar('PUT', caminho('/pools', id), dados),
      remover: (id) => requisitar('DELETE', caminho('/pools', id)),
      salvarMembro: (id, instanceId, dados) => requisitar('PUT', `${caminho('/pools', id)}/members/${encodeURIComponent(instanceId)}`, dados),
      removerMembro: (id, instanceId) => requisitar('DELETE', `${caminho('/pools', id)}/members/${encodeURIComponent(instanceId)}`)
    },
    instancias: {
      listar: () => requisitar('GET', '/instances'),
      criar: (dados) => requisitar('POST', '/instances', dados),
      obter: (id) => requisitar('GET', caminho('/instances', id)),
      atualizar: (id, dados) => requisitar('PUT', caminho('/instances', id), dados),
      remover: (id) => requisitar('DELETE', caminho('/instances', id))
    },
    conexoes: {
      listar: () => requisitar('GET', '/connections'),
      criar: (dados) => requisitar('POST', '/connections', dados),
      obter: (id) => requisitar('GET', caminho('/connections', id)),
      atualizar: (id, dados) => requisitar('PUT', caminho('/connections', id), dados),
      remover: (id) => requisitar('DELETE', caminho('/connections', id))
    }
  }
}

const clientePadrao = criarClienteEngine()
export const saude = clientePadrao.saude
export const automacoes = clientePadrao.automacoes
export const pools = clientePadrao.pools
export const instancias = clientePadrao.instancias
export const conexoes = clientePadrao.conexoes
