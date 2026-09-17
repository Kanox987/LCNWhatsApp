import { api, ApiError } from '../api.js'
import {
  automationSummary,
  buildAutomationDocument,
  emptyScopeBlocksSave,
  stateFromDocument,
  suggestAutomationId
} from '../logic/automation.js'
import { ACOES, CONDICOES, GATILHOS } from '../logic/acoes.js'
import { badge, button, el, emptyState, errorState, field, formatDate, notify, setBusy, setPageHeader } from '../ui.js'

const MATCH_DESCRIPTIONS = {
  exact: 'Somente a mensagem exatamente igual ao comando.',
  prefix: 'Qualquer mensagem que comece com o comando.',
  keyword: 'O comando como palavra isolada em qualquer posição.',
  exact_or_args: 'O comando sozinho ou seguido de argumentos.'
}

function statusAutomation (automation) {
  if (!automation.activeRevisionId) return badge('Somente rascunho', 'neutral')
  if (!automation.enabled) return badge('Pausada', 'warning')
  return badge(automation.deploymentMode === 'live' ? 'Ao vivo' : 'Sombra', automation.deploymentMode === 'live' ? 'success' : 'info')
}

async function renderList ({ navigate, refresh }) {
  const automations = await api.automations.list()
  setPageHeader({
    eyebrow: 'Motor de regras',
    title: 'Automações',
    description: 'Crie respostas por comando, teste em modo sombra e publique quando estiver pronto.',
    actions: [button('Nova automação', { variant: 'primary', onClick: () => navigate('/automations?new=1') }), button('Atualizar', { onClick: refresh })]
  })
  if (!automations.length) {
    return emptyState('Nenhuma automação ainda', 'O assistente conduz do comando até a resposta sem exigir edição de JSON.', button('Criar primeira automação', { variant: 'primary', onClick: () => navigate('/automations?new=1') }))
  }
  return el('div', { className: 'stack' }, automations.map((automation) => {
    const name = automation.draft?.document?.name || automation.id
    const actions = el('div', { className: 'button-row table-actions' })
    const toggle = button(automation.enabled ? 'Desligar' : 'Ligar', {
      disabled: !automation.activeRevisionId && !automation.enabled,
      title: !automation.activeRevisionId ? 'Publique uma revisão antes de ligar.' : '',
      onClick: async (event) => {
        // Captura ANTES do await: event.currentTarget vira null assim que
        // o despacho termina, então usá-lo depois de um await faz o reset
        // de setBusy() virar no-op e o botão fica preso em estado de busy.
        const control = event.currentTarget
        setBusy(control, true)
        try {
          await api.automations.enable(automation.id, !automation.enabled)
          notify(automation.enabled ? 'Automação pausada.' : 'Automação ligada.')
          await refresh()
        } catch (error) {
          notify(error.message, 'danger')
          setBusy(control, false)
        }
      }
    })
    actions.append(toggle)
    if (automation.activeRevisionId && automation.deploymentMode === 'shadow') {
      actions.append(button('Promover para ao vivo', {
        variant: 'primary',
        onClick: async (event) => {
          const control = event.currentTarget
          setBusy(control, true, 'Promovendo…')
          try {
            await api.automations.setMode(automation.id, 'live')
            notify('Automação promovida para o modo ao vivo.')
            await refresh()
          } catch (error) {
            notify(error.message, 'danger')
            setBusy(control, false)
          }
        }
      }))
    }
    actions.append(button('Editar', { variant: 'quiet', onClick: () => navigate(`/automations?edit=${encodeURIComponent(automation.id)}`) }))

    return el('article', { className: 'list-card' }, [
      el('div', { className: 'list-card-main' }, [
        el('div', {}, [el('p', { className: 'mono overline', text: automation.id }), el('h2', { text: name })]),
        statusAutomation(automation)
      ]),
      el('div', { className: 'list-card-meta' }, [
        el('span', { text: automation.activeRevisionId ? `Revisão ativa #${automation.draft?.revision || '—'}` : 'Ainda não publicada' }),
        el('span', { text: `Atualizada em ${formatDate(automation.updatedAt)}` })
      ]),
      actions
    ])
  }))
}

function validationNotice (result) {
  if (result.valid) return el('div', { className: 'notice notice-success' }, [el('strong', { text: 'Documento válido.' }), el('p', { text: `A revisão ${result.revision} passou pelas regras do motor.` })])
  return el('div', { className: 'notice notice-danger' }, [
    el('strong', { text: 'A automação ainda tem problemas.' }),
    el('ul', { className: 'error-details' }, (result.errors || []).map((item) => el('li', { text: `${item.path}: ${item.message}` })))
  ])
}

function localProblem (state) {
  if (!state.name.trim()) return 'Informe um nome para a automação.'
  if (!state.id.trim()) return 'Informe um identificador para a automação.'
  if (!state.command.trim()) return 'Informe o comando que inicia a automação.'
  if (emptyScopeBlocksSave(state.scopeInclude)) return 'Escolha pelo menos um contato ou grupo. Uma lista vazia nunca significa todos.'
  if (!state.poolId.trim()) return 'Informe o id do pool que responderá.'
  if (!state.replyText.trim()) return 'Escreva o texto da resposta.'
  return null
}

// O assistente monta uma forma só. Abrir nele uma automação de outra forma e
// salvar reescreveria o documento inteiro — a regra vira um comando vazio
// respondendo texto vazio, sem erro nenhum na tela.
//
// Enquanto o assistente não souber montar N passos, a saída certa é NÃO ABRIR:
// mostrar o que a automação faz e o documento de verdade. Quem precisa editar
// hoje edita pelo arquivo; quem só clicou em "Editar" por curiosidade não perde
// a automação por isso.
// Editar a automação como TEXTO.
//
// O assistente monta uma forma só (um comando que responde um texto), e as
// automações instaladas estão todas fora dela — o /ping inclusive. Elas abriam
// em somente leitura não porque editar fosse perigoso, mas porque a tela não
// conseguia REPRESENTÁ-LAS.
//
// O texto resolve pela representação: qualquer documento que o motor executa
// vira algo que uma pessoa lê e edita. E continua sem executar código de
// usuário — o texto COMPILA para o mesmo grafo auditado de sempre, e o que sai
// passa pelo mesmo schema e pelo mesmo publish.
async function renderEditorDeTexto ({ atual, motivo, navigate, refresh }) {
  const documento = atual?.draft?.document

  setPageHeader({
    eyebrow: `Editando ${atual.id}`,
    title: documento?.name || atual.id,
    description: 'Esta automação é mais do que o assistente monta, então ela abre como texto.',
    actions: [button('← Voltar para a lista', { onClick: () => navigate('/automations') })]
  })

  let lido
  try {
    lido = await api.automations.lerLcn(atual.id)
  } catch (erro) {
    return el('div', { className: 'stack' }, [
      errorState('Não consegui mostrar esta automação como texto.', erro.message),
      el('section', { className: 'card' }, [
        el('h2', { text: 'Documento' }),
        el('pre', { className: 'json-view compact-json', text: JSON.stringify(documento, null, 2) })
      ])
    ])
  }

  let etag = lido.etag
  const area = el('textarea', {
    className: 'lcn-editor',
    rows: String(Math.max(14, lido.texto.split('\n').length + 2)),
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off'
  }, lido.texto)

  const aviso = el('div', {})
  const limparAviso = () => { aviso.textContent = '' }
  area.addEventListener('input', limparAviso)

  const salvar = button('Salvar rascunho', {
    variant: 'primary',
    onClick: async () => {
      limparAviso()
      setBusy(salvar, true)
      try {
        const resultado = await api.automations.salvarLcn(atual.id, area.value, etag)
        etag = resultado?.draft?.etag ?? etag
        notify('Rascunho salvo.')
        // Recarrega do servidor: o texto que volta é o que o documento virou de
        // verdade. Se a linguagem normalizou algo, quem editou precisa VER —
        // achar que salvou uma coisa e ter salvo outra é o pior resultado.
        const novo = await api.automations.lerLcn(atual.id)
        area.value = novo.texto
        etag = novo.etag
      } catch (erro) {
        const linha = erro.details?.linha
        aviso.replaceChildren(el('div', { className: 'notice notice-danger' }, [
          el('strong', { text: linha ? `Erro na linha ${linha}` : 'Não consegui salvar' }),
          el('p', { text: erro.message })
        ]))
        if (linha) marcarLinha(area, linha)
      } finally {
        setBusy(salvar, false)
      }
    }
  })

  const publicar = button('Publicar', {
    onClick: async () => {
      limparAviso()
      setBusy(publicar, true)
      try {
        const atualizado = await api.automations.get(atual.id)
        await api.automations.publish(atual.id, atualizado.draft.revision)
        notify('Publicada.')
        refresh?.()
      } catch (erro) {
        aviso.replaceChildren(el('div', { className: 'notice notice-danger' }, [
          el('strong', { text: 'Não consegui publicar' }),
          el('p', { text: erro.message })
        ]))
      } finally {
        setBusy(publicar, false)
      }
    }
  })

  return el('div', { className: 'stack' }, [
    el('div', { className: 'notice notice-info' }, [
      el('strong', { text: 'Editando como texto' }),
      el('p', { text: motivo }),
      el('p', { text: 'O texto vira exatamente o mesmo documento que o motor executa. Salvar cria um rascunho; publicar é que coloca no ar.' })
    ]),
    el('section', { className: 'card' }, [area]),
    aviso,
    el('div', { className: 'wizard-footer' }, [salvar, publicar])
  ])
}

// Leva o cursor para a linha do erro. Dizer "linha 7" e deixar a pessoa contar
// linhas num texto de quarenta é metade do trabalho.
function marcarLinha (area, linha) {
  const linhas = area.value.split('\n')
  const inicio = linhas.slice(0, Math.max(0, linha - 1)).reduce((n, l) => n + l.length + 1, 0)
  const fim = inicio + (linhas[linha - 1]?.length ?? 0)
  area.focus()
  try { area.setSelectionRange(inicio, fim) } catch { /* navegador antigo */ }
}

// Rótulo humano vindo do catálogo, que já é a fonte única desses nomes.
function rotuloDoNo (tipo) {
  const achado = [...GATILHOS, ...ACOES, ...CONDICOES].find((x) => x.tipo === tipo)
  return achado?.rotulo || tipo
}

async function renderWizard ({ query, navigate, refresh }) {
  const editId = query.get('edit')
  const [meta, pools, instances, current] = await Promise.all([
    api.automations.meta(),
    api.pools.list(),
    api.instances.list(),
    editId ? api.automations.get(editId) : Promise.resolve(null)
  ])
  if (!editId && !query.has('new')) return null

  const initial = current?.draft?.document
    ? stateFromDocument(current.draft.document)
    : {
        id: '', revision: 1, enabled: true, name: '', menuLabel: '', menuDescription: '', command: '/', match: 'exact_or_args',
        scopeInclude: [], poolId: '', replyText: ''
      }
  const state = { ...initial }
  if (state.suportada === false) return renderEditorDeTexto({ atual: current, motivo: state.motivo, navigate, refresh })
  let etag = current?.draft?.etag
  let persisted = Boolean(current)
  let step = 0
  let idTouched = persisted
  let directoryTimer = null

  setPageHeader({
    eyebrow: persisted ? `Editando ${state.id}` : 'Nova automação',
    title: persisted ? state.name : 'Assistente de automação',
    description: 'Seis passos curtos para criar uma regra linear de comando e resposta.',
    actions: [button('← Voltar para a lista', { onClick: () => navigate('/automations') })]
  })

  const steps = ['Identidade', 'Quando', 'Onde', 'Quem responde', 'Resposta', 'Revisar']
  const stepNavigation = el('ol', { className: 'wizard-steps', 'aria-label': 'Etapas da automação' })
  const panels = el('div', { className: 'wizard-panels' })
  const footer = el('div', { className: 'wizard-footer' })
  const message = el('div', { className: 'wizard-message' })

  const nameInput = el('input', { type: 'text', value: state.name, placeholder: 'Resposta de disponibilidade' })
  const idInput = el('input', { type: 'text', value: state.id, placeholder: 'resposta-disponibilidade', disabled: persisted })
  nameInput.addEventListener('input', () => {
    state.name = nameInput.value
    if (!idTouched) {
      state.id = suggestAutomationId(state.name)
      idInput.value = state.id
    }
  })
  idInput.addEventListener('input', () => { idTouched = true; state.id = idInput.value })
  const menuLabelInput = el('input', { type: 'text', value: state.menuLabel, placeholder: '/ping' })
  menuLabelInput.addEventListener('input', () => { state.menuLabel = menuLabelInput.value })
  const menuDescriptionInput = el('input', { type: 'text', value: state.menuDescription, placeholder: 'Testa a latência do bot' })
  menuDescriptionInput.addEventListener('input', () => { state.menuDescription = menuDescriptionInput.value })
  panels.append(el('section', { className: 'wizard-panel' }, [
    el('div', { className: 'step-intro' }, [el('span', { text: 'Passo 1' }), el('h2', { text: 'Como vamos identificar esta automação?' }), el('p', { text: 'O nome aparece no painel. O id é estável e pode ser editado somente antes do primeiro salvamento.' })]),
    el('div', { className: 'form-grid' }, [
      field('Nome', nameInput, 'Use um nome curto que descreva o resultado.'),
      field('Identificador', idInput, 'Sugerido pelo nome; use letras, números e hífens para facilitar a leitura.')
    ]),
    el('div', { className: 'form-grid' }, [
      field('Rótulo no /menu (opcional)', menuLabelInput, 'Se preenchido, esta automação aparece na lista do comando /menu pra quem tiver acesso a ela. Deixe em branco pra ficar de fora do menu.'),
      field('Descrição no /menu (opcional)', menuDescriptionInput, 'Uma frase curta explicando o que o comando faz, mostrada ao lado do rótulo.')
    ])
  ]))

  const commandInput = el('input', { type: 'text', value: state.command, placeholder: '/ping' })
  commandInput.addEventListener('input', () => { state.command = commandInput.value })
  const matchSelect = el('select')
  const matchValues = meta.documentSchema?.definitions?.triggerCommand?.properties?.config?.properties?.match?.enum || ['exact', 'prefix', 'keyword', 'exact_or_args']
  for (const value of matchValues) matchSelect.append(el('option', { value, selected: state.match === value, text: `${value} — ${MATCH_DESCRIPTIONS[value] || value}` }))
  matchSelect.addEventListener('change', () => { state.match = matchSelect.value })
  panels.append(el('section', { className: 'wizard-panel' }, [
    el('div', { className: 'step-intro' }, [el('span', { text: 'Passo 2' }), el('h2', { text: 'Quando ela deve executar?' }), el('p', { text: 'Nesta versão, o gatilho suportado é um comando recebido como mensagem de texto.' })]),
    field('Comando', commandInput, 'Exemplo: /ping. A comparação não diferencia maiúsculas de minúsculas.'),
    field('Tipo de correspondência', matchSelect, 'Escolha o quanto a mensagem precisa se parecer com o comando.')
  ]))

  const instanceSelect = el('select')
  if (!instances.length) instanceSelect.append(el('option', { value: '', text: 'Nenhuma instância disponível' }))
  for (const instance of instances) instanceSelect.append(el('option', { value: instance.instanceId, text: `${instance.label || instance.instanceId} · ${instance.instanceId}` }))
  const kindSelect = el('select', {}, [el('option', { value: 'contact', text: 'Contatos' }), el('option', { value: 'group', text: 'Grupos' })])
  const directoryInput = el('input', { type: 'search', placeholder: 'Digite um nome para buscar' })
  const directoryResults = el('div', { className: 'directory-results' })
  const selectedScopes = el('div', { className: 'scope-list' })
  const scopeWarning = el('div', { className: 'notice notice-warning compact' })

  function renderSelectedScopes () {
    selectedScopes.replaceChildren()
    for (const item of state.scopeInclude) {
      const temLabelPropria = item.label && item.label !== item.id
      selectedScopes.append(el('div', { className: 'scope-chip' }, [
        el('span', {}, [
          badge(item.kind === 'group' ? 'Grupo' : 'Contato', 'info'),
          el('strong', { text: item.label || item.id }),
          temLabelPropria ? el('small', { className: 'mono', text: item.id }) : null
        ]),
        button('Remover', { variant: 'quiet', 'aria-label': `Remover ${item.label || item.id}`, onClick: () => {
          state.scopeInclude = state.scopeInclude.filter((scope) => !(scope.kind === item.kind && scope.id === item.id))
          renderSelectedScopes()
        } })
      ]))
    }
    const empty = emptyScopeBlocksSave(state.scopeInclude)
    scopeWarning.replaceChildren(
      el('strong', { text: empty ? 'Escolha pelo menos um destino.' : `${state.scopeInclude.length} destino(s) autorizado(s).` }),
      el('p', { text: empty ? 'Uma lista vazia nunca significa todos: sem um contato ou grupo, a automação não pode ser salva.' : 'A automação executará somente nestes contatos e grupos.' })
    )
    scopeWarning.className = `notice ${empty ? 'notice-warning' : 'notice-success'} compact`
  }

  async function searchDirectory () {
    if (!instanceSelect.value) return directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Cadastre uma instância antes de procurar contatos ou grupos.' }))
    directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Buscando…' }))
    try {
      const result = await api.instances.directory(instanceSelect.value, { kind: kindSelect.value, q: directoryInput.value.trim(), limit: 50 })
      if (!result.items.length) return directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Nenhum resultado encontrado.' }))
      directoryResults.replaceChildren(...result.items.map((item) => button(`${item.label} · ${item.id}`, {
        variant: 'result',
        onClick: () => {
          if (!state.scopeInclude.some((scope) => scope.kind === item.kind && scope.id === item.id)) state.scopeInclude.push(item)
          renderSelectedScopes()
        }
      })))
    } catch (error) {
      directoryResults.replaceChildren(errorState(error))
    }
  }
  const scheduleSearch = () => {
    window.clearTimeout(directoryTimer)
    directoryTimer = window.setTimeout(searchDirectory, 320)
  }
  directoryInput.addEventListener('input', scheduleSearch)
  instanceSelect.addEventListener('change', searchDirectory)
  kindSelect.addEventListener('change', searchDirectory)
  panels.append(el('section', { className: 'wizard-panel' }, [
    el('div', { className: 'step-intro' }, [el('span', { text: 'Passo 3' }), el('h2', { text: 'Onde ela pode executar?' }), el('p', { text: 'Busque o diretório de uma instância e autorize contatos ou grupos específicos. Dá pra misturar os dois: adicione contatos, troque o filtro pra "Grupos" e adicione grupos também — tudo entra na mesma lista de destinos autorizados abaixo.' })]),
    el('div', { className: 'form-grid' }, [field('Diretório da instância', instanceSelect, 'A instância define em qual agenda a busca será feita.'), field('Tipo de destino', kindSelect, 'Só filtra a busca abaixo — trocar aqui não remove o que você já adicionou. Pode adicionar contatos E grupos na mesma automação.')]),
    field('Buscar por nome', directoryInput, 'A busca acontece automaticamente depois que você para de digitar.'),
    directoryResults,
    el('h3', { text: 'Destinos autorizados' }),
    selectedScopes,
    scopeWarning
  ]))

  let poolsDisponiveis = pools
  const poolInput = el('input', { type: 'text', value: state.poolId, list: 'pool-options', placeholder: 'principal' })
  poolInput.addEventListener('input', () => { state.poolId = poolInput.value; atualizarAvisoPool() })
  const poolOptions = el('datalist', { id: 'pool-options' })
  const poolAviso = el('div')
  const poolCreateArea = el('div', { className: 'button-row' })

  function poolExisteComOId (id) {
    return poolsDisponiveis.some((pool) => pool.id === id.trim())
  }

  function atualizarAvisoPool () {
    const id = state.poolId.trim()
    poolCreateArea.replaceChildren()
    if (!id) {
      poolAviso.replaceChildren(el('div', { className: 'notice notice-warning compact' }, [el('p', { text: 'Digite um nome pra identificar quem responde — pode ser algo simples como "principal".' })]))
      return
    }
    if (poolExisteComOId(id)) {
      poolAviso.replaceChildren(el('div', { className: 'notice notice-success compact' }, [el('p', { text: `"${id}" já existe no motor — pronto pra usar.` })]))
      return
    }
    poolAviso.replaceChildren(el('div', { className: 'notice notice-warning compact' }, [el('p', { text: `"${id}" ainda não existe no motor. Crie com um clique ou escolha outro nome.` })]))
    poolCreateArea.append(button(`Criar pool "${id}"`, {
      variant: 'primary',
      onClick: async (event) => {
        const control = event.currentTarget
        setBusy(control, true, 'Criando…')
        try {
          const criado = await api.pools.create({ id, label: state.name.trim() || id })
          poolsDisponiveis = [...poolsDisponiveis, criado]
          poolOptions.replaceChildren(...poolsDisponiveis.map((pool) => el('option', { value: pool.id, label: pool.label })))
          notify(`Pool "${id}" criado.`)
          atualizarAvisoPool()
        } catch (error) {
          notify(error.message, 'danger')
          setBusy(control, false)
        }
      }
    }))
  }
  poolOptions.replaceChildren(...poolsDisponiveis.map((pool) => el('option', { value: pool.id, label: pool.label })))
  atualizarAvisoPool()

  panels.append(el('section', { className: 'wizard-panel' }, [
    el('div', { className: 'step-intro' }, [
      el('span', { text: 'Passo 4' }),
      el('h2', { text: 'Quem envia a resposta?' }),
      el('p', { text: 'Todo comando precisa de um "pool" — um nome que agrupa os números que podem responder. Hoje, com um número só, isso é só um identificador obrigatório: a resposta sempre sai pelo mesmo número que recebeu a mensagem. Escolher entre vários números pra responder (sorteio/rodízio) é um recurso futuro do motor, ainda não afeta o comportamento.' })
    ]),
    field('Nome do pool', poolInput, 'Se já usou esse nome antes, ele será reaproveitado. Se for novo, você pode criá-lo agora mesmo, sem sair desta tela.'),
    poolOptions,
    poolAviso,
    poolCreateArea
  ]))

  const replyInput = el('textarea', { rows: '4', placeholder: 'Ex: Recebido! Já estou cuidando disso.' }, state.replyText)
  replyInput.addEventListener('input', () => { state.replyText = replyInput.value })
  const placeholder = meta.runtime?.supportedPlaceholders?.includes('{{latencyMs}}') ? '{{latencyMs}}' : null
  panels.append(el('section', { className: 'wizard-panel' }, [
    el('div', { className: 'step-intro' }, [
      el('span', { text: 'Passo 5' }),
      el('h2', { text: 'O que deve ser respondido?' }),
      el('p', { text: `Escreva exatamente o texto que a pessoa vai receber no WhatsApp assim que mandar "${state.command || '/comando'}". Pode ser qualquer texto simples — não precisa de nenhum código ou marcação especial.` })
    ]),
    field('Texto da resposta', replyInput, 'Este é o texto final, sem edição — o que você escrever aqui é o que chega pro contato.'),
    placeholder ? el('div', { className: 'notice notice-info compact' }, [
      el('strong', { text: 'Opcional: mostrar o tempo de resposta' }),
      el('p', { text: `Se quiser exibir quanto tempo o bot levou pra responder, inclua o texto literal ${placeholder} em qualquer parte da mensagem — o motor troca isso pelo número de milissegundos real na hora do envio.` }),
      el('p', { className: 'muted', text: `Exemplo: escrevendo "Pong! Respondi em ${placeholder} ms." o contato recebe algo como "Pong! Respondi em 42 ms."` })
    ]) : null
  ]))

  const summaryContent = el('div')
  const jsonContent = el('pre', { className: 'json-view' })
  const reviewTabs = el('div', { className: 'tabs' })
  const reviewBody = el('div')
  const reviewActions = el('div', { className: 'review-actions' })
  const validationArea = el('div')
  let reviewMode = 'summary'

  function renderReview () {
    const document = buildAutomationDocument(state)
    summaryContent.replaceChildren(el('ol', { className: 'human-summary' }, automationSummary(state).map((line) => el('li', { text: line }))))
    jsonContent.textContent = JSON.stringify(document, null, 2)
    reviewBody.replaceChildren(reviewMode === 'summary' ? summaryContent : jsonContent)
    reviewTabs.replaceChildren(
      button('Resumo', { variant: reviewMode === 'summary' ? 'tab-active' : 'tab', onClick: () => { reviewMode = 'summary'; renderReview() } }),
      button('Ver JSON', { variant: reviewMode === 'json' ? 'tab-active' : 'tab', onClick: () => { reviewMode = 'json'; renderReview() } })
    )
  }

  async function persistDraft () {
    const problem = localProblem(state)
    if (problem) throw new Error(problem)
    const document = buildAutomationDocument(state)
    if (!persisted) {
      const automation = await api.automations.create(document)
      persisted = true
      state.revision = automation.draft.revision
      etag = automation.draft.etag
      idInput.disabled = true
      window.history.replaceState({}, '', `/automations?edit=${encodeURIComponent(state.id)}`)
      return automation.draft
    }
    try {
      const draft = await api.automations.saveDraft(state.id, document, etag)
      state.revision = draft.revision
      etag = draft.etag
      return draft
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error('Este rascunho foi editado em outro lugar. Recarregue a página antes de tentar salvar novamente.')
      }
      throw error
    }
  }

  async function runAction (control, action, busyLabel) {
    validationArea.replaceChildren()
    setBusy(control, true, busyLabel)
    try {
      await action()
    } catch (error) {
      validationArea.replaceChildren(errorState(error))
    } finally {
      setBusy(control, false)
    }
  }

  const saveButton = button('Salvar rascunho', { onClick: (event) => runAction(event.currentTarget, async () => {
    const draft = await persistDraft()
    notify(`Rascunho da revisão ${draft.revision} salvo.`)
    renderReview()
  }, 'Salvando…') })
  const validateButton = button('Validar', { variant: 'secondary', onClick: (event) => runAction(event.currentTarget, async () => {
    await persistDraft()
    const result = await api.automations.validate(state.id, buildAutomationDocument(state))
    validationArea.replaceChildren(validationNotice(result))
  }, 'Validando…') })
  const modeSelect = el('select', { 'aria-label': 'Modo de publicação' }, [
    el('option', { value: 'shadow', selected: current?.deploymentMode !== 'live', text: 'Sombra — registra sem enviar' }),
    el('option', { value: 'live', selected: current?.deploymentMode === 'live', text: 'Ao vivo — envia respostas' })
  ])
  const publishButton = button('Publicar', { variant: 'primary', onClick: (event) => runAction(event.currentTarget, async () => {
    await persistDraft()
    const result = await api.automations.validate(state.id, buildAutomationDocument(state))
    if (!result.valid) {
      validationArea.replaceChildren(validationNotice(result))
      return
    }
    await api.automations.setMode(state.id, modeSelect.value)
    await api.automations.publish(state.id, state.revision)
    notify(`Automação publicada em modo ${modeSelect.value === 'live' ? 'ao vivo' : 'sombra'}.`)
    navigate('/automations')
  }, 'Publicando…') })
  reviewActions.append(saveButton, validateButton, modeSelect, publishButton)
  panels.append(el('section', { className: 'wizard-panel' }, [
    el('div', { className: 'step-intro' }, [el('span', { text: 'Passo 6' }), el('h2', { text: 'Revise antes de salvar' }), el('p', { text: 'Leia o comportamento em linguagem humana, valide no motor e escolha entre observar em sombra ou responder ao vivo.' })]),
    el('div', { className: 'review-card' }, [reviewTabs, reviewBody]),
    el('label', { className: 'switch-row' }, [
      el('input', { type: 'checkbox', checked: state.enabled, onChange: (event) => { state.enabled = event.currentTarget.checked; renderReview() } }),
      el('span', {}, [el('strong', { text: 'Deixar habilitada depois de publicar' }), el('small', { text: 'Desmarque para publicar a revisão, mas mantê-la pausada.' })])
    ]),
    reviewActions,
    validationArea
  ]))

  function showStep (next) {
    step = Math.max(0, Math.min(steps.length - 1, next))
    ;[...panels.children].forEach((panel, index) => { panel.hidden = index !== step })
    ;[...stepNavigation.children].forEach((item, index) => {
      item.classList.toggle('active', index === step)
      item.classList.toggle('done', index < step)
      item.querySelector('button').setAttribute('aria-current', index === step ? 'step' : 'false')
    })
    footer.replaceChildren(
      step > 0 ? button('← Anterior', { onClick: () => showStep(step - 1) }) : el('span'),
      step < steps.length - 1 ? button('Próximo →', { variant: 'primary', onClick: () => showStep(step + 1) }) : el('span')
    )
    message.replaceChildren()
    if (step === 2 && !directoryResults.childNodes.length) searchDirectory()
    if (step === 5) renderReview()
  }
  steps.forEach((label, index) => stepNavigation.append(el('li', {}, button(`${index + 1}. ${label}`, { variant: 'step', onClick: () => showStep(index) }))))
  renderSelectedScopes()
  showStep(0)

  return el('div', { className: 'wizard-layout' }, [stepNavigation, el('div', { className: 'wizard-card' }, [panels, message, footer])])
}

export async function renderAutomations (context) {
  if (context.query.has('new') || context.query.has('edit')) return renderWizard(context)
  return renderList(context)
}
