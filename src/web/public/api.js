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
    action: (id, action, body) => request(`/instances/${segment(id)}/${action}`, { method: 'POST', body: body || {} }),
    pairing: (id) => request(`/instances/${segment(id)}/pairing`),
    optimization: (id) => request(`/instances/${segment(id)}/optimization`),
    updateOptimization: (id, body) => request(`/instances/${segment(id)}/optimization`, { method: 'PUT', body }),
    directory: (id, filters) => request(withQuery(`/instances/${segment(id)}/directory`, filters)),
    usage: (id) => request(`/instances/${segment(id)}/usage`),
    logs: (id, lines) => request(withQuery(`/instances/${segment(id)}/logs`, lines ? { lines } : undefined))
  },
  // A linguagem explicada, e a conferência do texto sem gravar nada. Ficam
  // juntas porque é delas que o editor vive: uma diz o que existe, a outra diz
  // se o que está escrito está de pé.
  linguagem: {
    referencia: () => request('/meta/linguagem'),
    funcoesDeConexao: () => request('/meta/funcoes-de-conexao'),
    validar: (texto) => request('/lcn/validar', { method: 'POST', body: { texto } })
  },
  automations: {
    conflicts: () => request('/automations/conflicts'),
    families: () => request('/automations/families'),
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
    create: (body) => request('/pools', { method: 'POST', body }),
    // O CRUD inteiro já estava mapeado no BFF e nada aqui o alcançava — e
    // POOL É PRÉ-REQUISITO DE TUDO: todo template do catálogo exige um
    // `poolId`, então quem aluga instalava um comando e travava num campo que
    // não tinha como preencher.
    get: (id) => request(`/pools/${segment(id)}`),
    update: (id, body) => request(`/pools/${segment(id)}`, { method: 'PUT', body }),
    remove: (id) => request(`/pools/${segment(id)}`, { method: 'DELETE' }),
    saveMember: (id, instanceId, body) => request(`/pools/${segment(id)}/members/${segment(instanceId)}`, { method: 'PUT', body }),
    removeMember: (id, instanceId) => request(`/pools/${segment(id)}/members/${segment(instanceId)}`, { method: 'DELETE' })
  },
  // Quem pode usar comando restrito. Sem nenhum cadastrado, só o próprio
  // número do bot responde a comando de dono — é assim que se cadastra o
  // primeiro, e é o que `noOwnerYet` serve para a tela explicar.
  owners: {
    list: () => request('/owners'),
    add: (contactId) => request('/owners', { method: 'POST', body: { contactId } }),
    remove: (contactId) => request(`/owners/${segment(contactId)}`, { method: 'DELETE' })
  },
  // A cascata do menu: config da conversa > padrão do tipo > padrão do código.
  // `effective` devolve o que de fato vale, já resolvido.
  menuConfig: {
    effective: (chatId, chatKind) => request(withQuery('/menu-config/effective', { chatId, chatKind })),
    get: (kind, id) => request(withQuery(`/menu-config/${segment(kind)}`, id ? { id } : undefined)),
    save: (kind, id, body) => request(withQuery(`/menu-config/${segment(kind)}`, id ? { id } : undefined), { method: 'PUT', body }),
    remove: (kind, id) => request(withQuery(`/menu-config/${segment(kind)}`, id ? { id } : undefined), { method: 'DELETE' })
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
    // Reescreve o conteúdo mantendo o id, para os comandos que apontam
    // para o arquivo continuarem achando o mesmo arquivo.
    rewrite: (id, contentBase64) => request(`/media/${segment(id)}/content`, { method: 'PUT', body: { contentBase64 } }),
    // Que comandos apontam para este arquivo. Separa o que é certo do que só
    // "pode ser", porque comando que monta o caminho na hora alcança qualquer um.
    usage: (id) => request(`/media/${segment(id)}/usage`, { method: 'POST' }),
    // Endereço dos bytes, não uma chamada: vai direto no src da miniatura.
    contentUrl: (id) => `/api/v1/media/${segment(id)}/content`
  },
  entities: {
    list: (kind, id) => request(`/entities/${segment(kind)}/${segment(id)}/attributes`),
    set: (kind, id, key, value) => request(`/entities/${segment(kind)}/${segment(id)}/attributes/${segment(key)}`, { method: 'PUT', body: { value } }),
    remove: (kind, id, key) => request(`/entities/${segment(kind)}/${segment(id)}/attributes/${segment(key)}`, { method: 'DELETE' })
  }
}
