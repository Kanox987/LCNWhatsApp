import http from 'http'
import { SOCKET_PATH } from './paths.js'

function caminho (base, id) {
  return `${base}/${encodeURIComponent(id)}`
}

function montarQueryExecucoes (filtros = {}) {
  const query = new URLSearchParams()
  for (const campo of ['automationId', 'runStatus', 'commandStatus', 'targetAccountId', 'from', 'to', 'cursor', 'limit']) {
    const valor = filtros?.[campo]
    if (valor !== undefined && valor !== null && valor !== '') query.set(campo, String(valor))
  }
  const texto = query.toString()
  return texto ? `?${texto}` : ''
}

// O override permite que gateways em container usem o bind-mount do Quadlet;
// processos nativos continuam no caminho XDG calculado em paths.js.
export function criarClienteEngine ({ socketPath = process.env.LCN_ENGINE_SOCKET || SOCKET_PATH } = {}) {
  const requisitar = (method, pathname, body, headers = {}) => new Promise((resolve, reject) => {
    const conteudo = body === undefined ? null : JSON.stringify(body)
    const req = http.request({
      socketPath,
      method,
      path: pathname,
      headers: conteudo === null ? headers : {
        ...headers,
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
    eventos: {
      enviar: (evento) => requisitar('POST', '/events', evento)
    },
    execucoes: {
      listar: (filtros) => requisitar('GET', `/executions${montarQueryExecucoes(filtros)}`),
      obter: (runId) => requisitar('GET', caminho('/executions', runId)),
      confirmar: (id, body) => requisitar('POST', `${caminho('/commands', id)}/result`, body),
      // O que ficou sem resposta nesta conta — ver a rota no motor.
      pendentes: (accountId, limite = 20) =>
        requisitar('GET', `/commands/pending?accountId=${encodeURIComponent(accountId)}&limit=${limite}`)
    },
    meta: {
      obterVariaveis: () => requisitar('GET', '/meta/variables')
    },
    donos: {
      listar: () => requisitar('GET', '/owners'),
      adicionar: (contactId) => requisitar('POST', '/owners', { contactId }),
      remover: (contactId) => requisitar('DELETE', `/owners/${encodeURIComponent(contactId)}`)
    },
    menu: {
      obterEfetivo: (chatId, chatKind) => requisitar('GET', `/menu-config/effective?chatId=${encodeURIComponent(chatId)}&chatKind=${encodeURIComponent(chatKind || 'direct')}`),
      obter: (kind, id) => requisitar('GET', `/menu-config/${encodeURIComponent(kind)}${id ? `?id=${encodeURIComponent(id)}` : ''}`),
      salvar: (kind, id, config) => requisitar('PUT', `/menu-config/${encodeURIComponent(kind)}${id ? `?id=${encodeURIComponent(id)}` : ''}`, config),
      remover: (kind, id) => requisitar('DELETE', `/menu-config/${encodeURIComponent(kind)}${id ? `?id=${encodeURIComponent(id)}` : ''}`)
    },
    entidades: {
      listar: (kind, id) => requisitar('GET', `${caminho(`/entities/${encodeURIComponent(kind)}`, id)}/attributes`),
      definir: (kind, id, key, value) => requisitar('PUT', `${caminho(`/entities/${encodeURIComponent(kind)}`, id)}/attributes/${encodeURIComponent(key)}`, { value }),
      remover: (kind, id, key) => requisitar('DELETE', `${caminho(`/entities/${encodeURIComponent(kind)}`, id)}/attributes/${encodeURIComponent(key)}`)
    },
    automacoes: {
      obterMeta: () => requisitar('GET', '/meta/automation-editor?schemaVersion=1'),
      listar: () => requisitar('GET', '/automations'),
      criar: (documento) => requisitar('POST', '/automations', documento),
      obter: (id) => requisitar('GET', caminho('/automations', id)),
      listarRevisoes: (id) => requisitar('GET', `${caminho('/automations', id)}/revisions`),
      obterRevisao: (id, revision) => requisitar('GET', `${caminho('/automations', id)}/revisions/${encodeURIComponent(revision)}`),
      salvarRascunho: (id, documento, expectedEtag) => requisitar(
        'PUT',
        `${caminho('/automations', id)}/draft`,
        documento,
        expectedEtag === undefined ? {} : { 'if-match': expectedEtag }
      ),
      validar: (id, documento) => requisitar('POST', `${caminho('/automations', id)}/validate`, documento),
      remover: (id) => requisitar('DELETE', caminho('/automations', id)),
      publicar: (id, revision) => requisitar('POST', `${caminho('/automations', id)}/publish`, revision ? { revision } : undefined),
      despublicar: (id) => requisitar('POST', `${caminho('/automations', id)}/unpublish`),
      definirHabilitada: (id, enabled) => requisitar('PUT', `${caminho('/automations', id)}/enabled`, { enabled }),
      definirModo: (id, mode) => requisitar('PUT', `${caminho('/automations', id)}/deployment-mode`, { mode }),
      obterProvenance: (id) => requisitar('GET', `${caminho('/automations', id)}/provenance`)
    },
    templates: {
      listar: () => requisitar('GET', '/templates'),
      obter: (id) => requisitar('GET', caminho('/templates', id)),
      instalar: (id, dados) => requisitar('POST', `${caminho('/templates', id)}/install`, dados)
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
export const eventos = clientePadrao.eventos
export const execucoes = clientePadrao.execucoes
export const meta = clientePadrao.meta
export const entidades = clientePadrao.entidades
export const automacoes = clientePadrao.automacoes
export const templates = clientePadrao.templates
export const pools = clientePadrao.pools
export const instancias = clientePadrao.instancias
export const conexoes = clientePadrao.conexoes
