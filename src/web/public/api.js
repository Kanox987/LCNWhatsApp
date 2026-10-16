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
    // Diz o FATO e para por aí.
    //
    // A mensagem antiga mandava "confirme se o servidor web está em execução" —
    // orientação que só serve para quem tem a máquina na mão. Quem usa uma
    // instalação hospedada não tem como conferir processo nenhum: para essa
    // pessoa, o painel simplesmente caiu, e mandá-la verificar algo que ela não
    // alcança é pior que não dizer nada — parece que a culpa é dela.
    //
    // Mesma regra que já vale para os erros de download: o detalhe acionável
    // pelo dono vai para o log; o que chega a quem está olhando a tela é uma
    // frase honesta e curta.
    throw new ApiError('O painel está inacessível no momento.')
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
    criar: (nome) => request('/instances', { method: 'POST', body: { nome } }),
    remover: (id) => request(`/instances/${segment(id)}`, { method: 'DELETE' }),
    action: (id, action) => request(`/instances/${segment(id)}/${action}`, { method: 'POST' }),
    pairing: (id) => request(`/instances/${segment(id)}/pairing`),
    optimization: (id) => request(`/instances/${segment(id)}/optimization`),
    updateOptimization: (id, body) => request(`/instances/${segment(id)}/optimization`, { method: 'PUT', body }),
    directory: (id, filters) => request(withQuery(`/instances/${segment(id)}/directory`, filters)),
    usage: (id) => request(`/instances/${segment(id)}/usage`),
    logs: (id, lines) => request(withQuery(`/instances/${segment(id)}/logs`, lines ? { lines } : undefined))
  },
  automations: {
    conflicts: () => request('/automations/conflicts'),
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
    setMode: (id, mode) => request(`/automations/${segment(id)}/deployment-mode`, { method: 'PUT', body: { mode } }),
    getReconfigure: (id) => request(`/automations/${segment(id)}/reconfigure`),
    reconfigure: (id, parameters) => request(`/automations/${segment(id)}/reconfigure`, { method: 'PUT', body: { parameters } }),
    // A automação como texto. O documento continua sendo a verdade guardada;
    // isto é a mesma coisa numa forma que dá pra ler e editar.
    criarLcn: (texto) => request('/automations/lcn', { method: 'POST', body: { texto } }),
    lerLcn: (id) => request(`/automations/${segment(id)}/lcn`),
    salvarLcn: (id, texto, etag) => request(`/automations/${segment(id)}/lcn`, {
      method: 'PUT',
      body: { texto },
      headers: etag ? { 'If-Match': etag } : {}
    })
  },
  pools: {
    list: () => request('/pools'),
    create: (body) => request('/pools', { method: 'POST', body })
  },
  templates: {
    updates: () => request('/templates/updates'),
    list: () => request('/templates'),
    get: (id) => request(`/templates/${segment(id)}`),
    install: (id, body) => request(`/templates/${segment(id)}/install`, { method: 'POST', body })
  },
  executions: {
    list: (filters) => request(withQuery('/executions', filters)),
    get: (runId) => request(`/executions/${segment(runId)}`)
  },
  retention: {
    get: () => request('/retention'),
    save: (horas) => request('/retention', { method: 'PUT', body: { horas } }),
    sweep: (body) => request('/retention/sweep', { method: 'POST', body: body || {} })
  },
  connections: {
    list: () => request('/connections'),
    prontas: () => request('/connections-prontas'),
    create: (body) => request('/connections', { method: 'POST', body }),
    update: (id, body) => request(`/connections/${segment(id)}`, { method: 'PUT', body }),
    remove: (id) => request(`/connections/${segment(id)}`, { method: 'DELETE' })
  },
  variables: {
    meta: () => request('/meta/variables')
  },
  media: {
    list: () => request('/media'),
    upload: (body) => request('/media', { method: 'POST', body }),
    describe: (id, description) => request(`/media/${segment(id)}`, { method: 'PUT', body: { description } }),
    mover: (id, folder) => request(`/media/${segment(id)}`, { method: 'PUT', body: { folder } }),
    remove: (id) => request(`/media/${segment(id)}`, { method: 'DELETE' }),
    // Endereço dos bytes, não uma chamada: vai direto no src da miniatura.
    contentUrl: (id) => `/api/v1/media/${segment(id)}/content`
  },
  entities: {
    list: (kind, id) => request(`/entities/${segment(kind)}/${segment(id)}/attributes`),
    set: (kind, id, key, value) => request(`/entities/${segment(kind)}/${segment(id)}/attributes/${segment(key)}`, { method: 'PUT', body: { value } }),
    remove: (kind, id, key) => request(`/entities/${segment(kind)}/${segment(id)}/attributes/${segment(key)}`, { method: 'DELETE' })
  }
}
