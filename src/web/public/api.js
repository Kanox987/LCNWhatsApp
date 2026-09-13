export class ApiError extends Error {
  constructor (message, { status = 0, details = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

async function request (path, { method = 'GET', body, headers = {} } = {}) {
  const options = { method, headers: { accept: 'application/json', ...headers } }
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(`/api/v1${path}`, options)
  } catch {
    throw new ApiError('Não foi possível alcançar o painel local. Confirme se o servidor web está em execução.')
  }

  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new ApiError('O servidor devolveu uma resposta inválida.', { status: response.status })
    }
  }
  if (!response.ok) {
    throw new ApiError(data?.error || `A operação falhou (HTTP ${response.status}).`, {
      status: response.status,
      details: data?.details ?? null
    })
  }
  return data
}

function segment (value) {
  return encodeURIComponent(String(value))
}

function withQuery (path, values = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

export const api = {
  health: () => request('/health'),
  instances: {
    list: () => request('/instances'),
    get: (id) => request(`/instances/${segment(id)}`),
    action: (id, action) => request(`/instances/${segment(id)}/${action}`, { method: 'POST' }),
    pairing: (id) => request(`/instances/${segment(id)}/pairing`),
    optimization: (id) => request(`/instances/${segment(id)}/optimization`),
    updateOptimization: (id, body) => request(`/instances/${segment(id)}/optimization`, { method: 'PUT', body }),
    directory: (id, filters) => request(withQuery(`/instances/${segment(id)}/directory`, filters)),
    usage: (id) => request(`/instances/${segment(id)}/usage`),
    logs: (id, lines) => request(withQuery(`/instances/${segment(id)}/logs`, lines ? { lines } : undefined))
  },
  automations: {
    meta: () => request('/meta/automation-editor'),
    list: () => request('/automations'),
    create: (document) => request('/automations', { method: 'POST', body: document }),
    get: (id) => request(`/automations/${segment(id)}`),
    saveDraft: (id, document, etag) => request(`/automations/${segment(id)}/draft`, {
      method: 'PUT',
      body: document,
      headers: etag ? { 'if-match': etag } : {}
    }),
    validate: (id, document) => request(`/automations/${segment(id)}/validate`, { method: 'POST', body: document }),
    publish: (id, revision) => request(`/automations/${segment(id)}/publish`, { method: 'POST', body: { revision } }),
    enable: (id, enabled) => request(`/automations/${segment(id)}/enabled`, { method: 'PUT', body: { enabled } }),
    setMode: (id, mode) => request(`/automations/${segment(id)}/deployment-mode`, { method: 'PUT', body: { mode } })
  },
  pools: {
    list: () => request('/pools'),
    create: (body) => request('/pools', { method: 'POST', body })
  },
  templates: {
    list: () => request('/templates'),
    get: (id) => request(`/templates/${segment(id)}`),
    install: (id, body) => request(`/templates/${segment(id)}/install`, { method: 'POST', body })
  },
  executions: {
    list: (filters) => request(withQuery('/executions', filters)),
    get: (runId) => request(`/executions/${segment(runId)}`)
  },
  connections: {
    list: () => request('/connections'),
    create: (body) => request('/connections', { method: 'POST', body }),
    update: (id, body) => request(`/connections/${segment(id)}`, { method: 'PUT', body }),
    remove: (id) => request(`/connections/${segment(id)}`, { method: 'DELETE' })
  },
  variables: {
    meta: () => request('/meta/variables')
  },
  entities: {
    list: (kind, id) => request(`/entities/${segment(kind)}/${segment(id)}/attributes`),
    set: (kind, id, key, value) => request(`/entities/${segment(kind)}/${segment(id)}/attributes/${segment(key)}`, { method: 'PUT', body: { value } }),
    remove: (kind, id, key) => request(`/entities/${segment(kind)}/${segment(id)}/attributes/${segment(key)}`, { method: 'DELETE' })
  }
}
