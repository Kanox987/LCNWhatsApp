import { api, ApiError } from '../api.js'
import { avisoInline } from './variables.js'
import { badge, button, el, emptyState, errorState, field, loading, notify, setBusy, setPageHeader } from '../ui.js'

const CATEGORY_LABELS = {
  utilitarios: 'Utilitários',
  configuracoes: 'Configurações',
  empresarial: 'Empresarial',
  'modulos-especializados': 'Módulos especializados'
}

const TYPE_LABELS = {
  string: 'Texto',
  number: 'Número',
  boolean: 'Sim ou não'
}

function rotuloCategoria (category) {
  return CATEGORY_LABELS[category] || category
}

function valorParametro (definition, control) {
  if (definition.type === 'boolean') return control.checked
  if (definition.type === 'number') return Number(control.value)
  return control.value
}

function mensagemErroInstalacao (error) {
  const serverMessage = error?.message || 'Erro inesperado.'
  if (!(error instanceof ApiError)) return serverMessage
  if (error.status === 400) return `Revise os parâmetros e escolha um destino. ${serverMessage}`
  if (error.status === 404) return `Este template não está mais disponível. ${serverMessage}`
  if (error.status === 409) return `Escolha outro identificador para a automação. ${serverMessage}`
  if (error.status === 422) return `A automação não passou na validação do motor. ${serverMessage}`
  return serverMessage
}

// Selos do card. Uma ressalva precisa se anunciar ANTES de a pessoa abrir
// "Ver informações" — quem está escolhendo um comando na lista tem que
// enxergar de cara que aquele ali tem pegadinha.
function selosDoCard (summary) {
  const avisos = summary.warnings || []
  const tem = (nivel) => avisos.some((a) => a.level === nivel)
  const selos = []

  if (tem('unofficial')) selos.push(badge('Recurso não oficial', 'danger'))
  if (tem('compatibility')) selos.push(badge('Nem sempre funciona', 'warning'))
  if (tem('requirement')) selos.push(badge('Tem pré-requisito', 'warning'))

  if (summary.dependsOn?.length) {
    selos.push(badge(summary.dependsOn.length === 1 ? '1 dependência' : `${summary.dependsOn.length} dependências`, 'info'))
  } else if (!selos.length) {
    selos.push(badge('Pronto para instalar', 'success'))
  }
  return selos
}

function painelInformacoes (template) {
  const dependencies = template.dependsOn || []
  const capabilities = template.requiredCapabilities || []
  const parameters = template.parameters || []

  const avisos = template.warnings || []

  return el('section', { className: 'catalog-detail' }, [
    el('h3', { text: 'Informações do comando' }),
    // Ressalvas antes de tudo: onde não funciona, o que exige, se é recurso
    // não oficial. Quem vai instalar precisa ver isso ANTES da lista de
    // parâmetros, não depois.
    avisos.length ? el('div', { className: 'template-warnings' }, avisos.map(avisoInline)) : null,
    el('dl', { className: 'detail-list detail-block' }, [
      el('dt', { text: 'Nome' }), el('dd', { text: template.name }),
      el('dt', { text: 'Descrição' }), el('dd', { text: template.description }),
      el('dt', { text: 'Categoria' }), el('dd', { text: rotuloCategoria(template.category) }),
      el('dt', { text: 'Versão' }), el('dd', { text: template.templateVersion }),
      el('dt', { text: 'Dependências' }), el('dd', {}, dependencies.length ? dependencies.map((id) => badge(id, 'info')) : 'Nenhuma'),
      el('dt', { text: 'Recursos necessários' }), el('dd', {}, capabilities.length ? capabilities.map((item) => badge(item, 'warning')) : 'Nenhum')
    ]),
    el('h3', { text: 'Parâmetros' }),
    parameters.length
      ? el('div', { className: 'stack' }, parameters.map((parameter) => el('div', { className: 'list-card compact' }, [
          el('div', { className: 'list-card-main' }, [
            el('strong', { text: parameter.label }),
            el('span', { className: 'mono muted', text: parameter.key }),
            parameter.help ? el('p', { className: 'field-help', text: parameter.help }) : null
          ]),
          el('div', { className: 'button-row' }, [
            badge(TYPE_LABELS[parameter.type] || parameter.type),
            Object.prototype.hasOwnProperty.call(parameter, 'default') ? badge(`Padrão: ${String(parameter.default)}`, 'info') : badge('Obrigatório', 'warning')
          ])
        ])))
      : el('p', { className: 'muted', text: 'Este comando não pede parâmetros.' })
  ])
}

function painelCodigo (template) {
  return el('section', { className: 'catalog-detail' }, [
    el('h3', { text: 'Código JSON do comando' }),
    el('p', { className: 'field-help', text: 'Visualização somente leitura do documento que será preenchido durante a instalação.' }),
    el('pre', { className: 'json-view', text: JSON.stringify(template.documentTemplate, null, 2) })
  ])
}

function criarControleParametro (definition, pools) {
  const hasDefault = Object.prototype.hasOwnProperty.call(definition, 'default')
  if (definition.key === 'poolId') {
    const control = el('select', { required: true }, [
      el('option', { value: '', text: pools.length ? 'Selecione um pool' : 'Nenhum pool cadastrado' })
    ])
    for (const pool of pools) {
      control.append(el('option', {
        value: pool.id,
        selected: hasDefault && String(definition.default) === pool.id,
        text: `${pool.label || pool.id} · ${pool.id}`
      }))
    }
    return control
  }
  if (definition.type === 'boolean') {
    return el('input', { type: 'checkbox', checked: hasDefault ? Boolean(definition.default) : false })
  }
  return el('input', {
    type: definition.type === 'number' ? 'number' : 'text',
    step: definition.type === 'number' ? 'any' : undefined,
    value: hasDefault ? String(definition.default) : '',
    required: true
  })
}

function painelInstalacao ({ templates, rootTemplateId, pools, instances, navigate }) {
  const templateFields = new Map()
  const selectedTarget = { value: null }
  const targetArea = el('div')
  const summaryArea = el('div', { className: 'review-card panel' })
  const resultArea = el('div')

  function atualizarResumo () {
    const lines = templates.map((template) => {
      const controls = templateFields.get(template.templateId)
      const id = controls.automationId.value.trim() || '(identificador pendente)'
      const values = template.parameters.map((definition) => {
        const value = valorParametro(definition, controls.parameters.get(definition.key))
        return `${definition.label}: ${definition.type === 'boolean' ? (value ? 'sim' : 'não') : (String(value).trim() || 'pendente')}`
      })
      return `Criar “${id}” a partir de ${template.name}${values.length ? `, com ${values.join('; ')}` : ''}.`
    })
    lines.push(selectedTarget.value
      ? `Autorizar somente ${selectedTarget.value.label || selectedTarget.value.id} (${selectedTarget.value.kind === 'group' ? 'grupo' : 'contato'}).`
      : 'Escolher um contato ou grupo é obrigatório antes de instalar.')
    summaryArea.replaceChildren(
      el('div', { className: 'panel-heading' }, [
        el('div', {}, [el('h3', { text: 'Revise antes de instalar' }), el('p', { text: 'Confira cada ponto antes de publicar o comando.' })])
      ]),
      el('ol', { className: 'human-summary' }, lines.map((line) => el('li', { text: line })))
    )
  }

  const formulariosTemplates = templates.map((template) => {
    const automationId = el('input', { type: 'text', value: template.templateId, required: true, placeholder: template.templateId })
    const parameters = new Map()
    const parameterFields = template.parameters.map((definition) => {
      const control = criarControleParametro(definition, pools)
      parameters.set(definition.key, control)
      control.addEventListener(definition.type === 'boolean' || definition.key === 'poolId' ? 'change' : 'input', atualizarResumo)
      const description = [definition.help, `Tipo: ${TYPE_LABELS[definition.type] || definition.type}.`].filter(Boolean).join(' ')
      return field(definition.label, control, description)
    })
    automationId.addEventListener('input', atualizarResumo)
    templateFields.set(template.templateId, { automationId, parameters })
    return el('section', { className: 'catalog-template-form' }, [
      el('p', { className: 'overline', text: template.templateId === rootTemplateId ? 'Comando principal' : 'Dependência' }),
      el('h3', { text: template.name }),
      field('Identificador da nova automação', automationId, 'Use um identificador único. Se ele já existir, escolha outro.'),
      parameterFields.length ? el('div', { className: 'form-grid' }, parameterFields) : el('p', { className: 'muted', text: 'Sem parâmetros adicionais.' })
    ])
  })

  const instanceSelect = el('select')
  if (!instances.length) instanceSelect.append(el('option', { value: '', text: 'Nenhuma instância disponível' }))
  for (const instance of instances) {
    instanceSelect.append(el('option', { value: instance.instanceId, text: `${instance.label || instance.instanceId} · ${instance.instanceId}` }))
  }
  const kindSelect = el('select', {}, [
    el('option', { value: 'contact', text: 'Contatos' }),
    el('option', { value: 'group', text: 'Grupos' })
  ])
  const searchInput = el('input', { type: 'search', placeholder: 'Digite um nome para buscar', disabled: !instances.length })
  const directoryResults = el('div', { className: 'directory-results' })
  let searchTimer = null

  function renderizarDestino () {
    const target = selectedTarget.value
    if (!target) {
      targetArea.replaceChildren(el('div', { className: 'notice notice-warning compact' }, [
        el('strong', { text: 'Escolha um destino.' }),
        el('p', { text: 'A instalação nunca fica liberada para todos por padrão.' })
      ]))
    } else {
      targetArea.replaceChildren(el('div', { className: 'scope-chip' }, [
        badge(target.kind === 'group' ? 'Grupo' : 'Contato', 'info'),
        el('span', {}, [el('strong', { text: target.label || target.id }), el('small', { className: 'mono', text: ` · ${target.id}` })]),
        button('Remover', { variant: 'quiet', onClick: () => {
          selectedTarget.value = null
          renderizarDestino()
          atualizarResumo()
        } })
      ]))
    }
  }

  async function buscarDiretorio () {
    if (!instanceSelect.value) {
      directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Cadastre uma instância antes de procurar contatos ou grupos.' }))
      return
    }
    directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Buscando…' }))
    try {
      const result = await api.instances.directory(instanceSelect.value, { kind: kindSelect.value, q: searchInput.value.trim(), limit: 30 })
      if (!result.items.length) {
        directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Nenhum resultado encontrado.' }))
        return
      }
      directoryResults.replaceChildren(...result.items.map((item) => button(`${item.label} · ${item.id}`, {
        variant: 'result',
        onClick: () => {
          selectedTarget.value = { ...item, kind: item.kind || kindSelect.value }
          renderizarDestino()
          atualizarResumo()
        }
      })))
    } catch (error) {
      directoryResults.replaceChildren(errorState(error))
    }
  }

  const agendarBusca = () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(buscarDiretorio, 320)
  }
  searchInput.addEventListener('input', agendarBusca)
  instanceSelect.addEventListener('change', buscarDiretorio)
  kindSelect.addEventListener('change', buscarDiretorio)

  function problemaLocal () {
    const usedIds = new Set()
    for (const template of templates) {
      const controls = templateFields.get(template.templateId)
      const automationId = controls.automationId.value.trim()
      if (!automationId) return `Informe o identificador da automação para “${template.name}”.`
      if (usedIds.has(automationId)) return `Use identificadores diferentes para cada automação. “${automationId}” está repetido.`
      usedIds.add(automationId)
      for (const definition of template.parameters) {
        const control = controls.parameters.get(definition.key)
        if (definition.type !== 'boolean' && !control.value.trim()) return `Preencha “${definition.label}” em “${template.name}”.`
        if (definition.type === 'number' && !Number.isFinite(Number(control.value))) return `Informe um número válido em “${definition.label}”.`
      }
    }
    if (!selectedTarget.value) return 'Escolha pelo menos um contato ou grupo. Uma lista vazia nunca significa todos.'
    return null
  }

  function montarCorpo () {
    const automationIds = {}
    const parameters = {}
    for (const template of templates) {
      const controls = templateFields.get(template.templateId)
      automationIds[template.templateId] = controls.automationId.value.trim()
      parameters[template.templateId] = {}
      for (const definition of template.parameters) {
        parameters[template.templateId][definition.key] = valorParametro(definition, controls.parameters.get(definition.key))
      }
    }
    return {
      automationIds,
      parameters,
      scope: {
        include: [{ kind: selectedTarget.value.kind, id: selectedTarget.value.id }],
        exclude: []
      }
    }
  }

  const botaoInstalar = button('Instalar', {
    variant: 'primary',
    onClick: async (event) => {
      const control = event.currentTarget
      resultArea.replaceChildren()
      const problem = problemaLocal()
      if (problem) {
        resultArea.replaceChildren(el('div', { className: 'notice notice-warning' }, [el('strong', { text: 'Revise a instalação.' }), el('p', { text: problem })]))
        notify(problem, 'danger')
        return
      }
      setBusy(control, true, 'Instalando…')
      try {
        const result = await api.templates.install(rootTemplateId, montarCorpo())
        const installed = Array.isArray(result?.installed) ? result.installed : []
        const ids = installed.map((automation) => automation.id).filter(Boolean)
        const message = ids.length
          ? `${ids.length === 1 ? 'Automação instalada' : 'Automações instaladas'}: ${ids.join(', ')}.`
          : 'Instalação concluída pelo motor.'
        notify(message)
        resultArea.replaceChildren(el('div', { className: 'notice notice-success' }, [
          el('strong', { text: 'Instalação concluída.' }),
          el('p', { text: message }),
          button('Ver em Automações', { onClick: () => navigate('/automations') })
        ]))
      } catch (error) {
        const message = mensagemErroInstalacao(error)
        notify(message, 'danger')
        resultArea.replaceChildren(errorState({ message, details: error?.details }))
      } finally {
        setBusy(control, false)
      }
    }
  })

  renderizarDestino()
  atualizarResumo()
  if (instances.length) buscarDiretorio()
  else directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Cadastre uma instância antes de escolher o destino.' }))

  return el('section', { className: 'catalog-detail stack-lg' }, [
    el('div', {}, [
      el('h3', { text: 'Adicionar à automação' }),
      el('p', { className: 'muted', text: templates.length > 1 ? 'O comando e suas dependências serão instalados juntos.' : 'Preencha os dados abaixo para instalar o comando já publicado e pronto para uso.' })
    ]),
    el('div', { className: 'stack' }, formulariosTemplates),
    el('section', { className: 'catalog-template-form' }, [
      el('p', { className: 'overline', text: 'Destino autorizado' }),
      el('h3', { text: 'Onde o comando pode executar?' }),
      el('div', { className: 'form-grid' }, [
        field('Diretório da instância', instanceSelect, 'A instância define em qual agenda a busca será feita.'),
        field('Tipo de destino', kindSelect, 'Escolha entre contatos e grupos.')
      ]),
      field('Buscar por nome', searchInput, 'A busca acontece automaticamente depois que você para de digitar.'),
      directoryResults,
      el('p', { className: 'overline', text: 'Destino escolhido' }),
      targetArea
    ]),
    summaryArea,
    el('div', { className: 'catalog-install-actions' }, [botaoInstalar, el('span', { className: 'muted compact', text: 'A automação será publicada imediatamente.' })]),
    resultArea
  ])
}

export async function renderCatalog ({ navigate }) {
  const templates = await api.templates.list()
  const detailCache = new Map()

  setPageHeader({
    eyebrow: 'Comandos prontos',
    title: 'Catálogo',
    description: 'Conheça comandos pré-construídos, veja como funcionam e instale-os sem editar código.',
    actions: [button('Ver automações', { onClick: () => navigate('/automations') })]
  })

  if (!templates.length) {
    return emptyState('Nenhum comando disponível', 'O catálogo ainda não tem comandos prontos para instalar.')
  }

  async function obterTemplate (templateId) {
    if (!detailCache.has(templateId)) {
      detailCache.set(templateId, api.templates.get(templateId).catch((error) => {
        detailCache.delete(templateId)
        throw error
      }))
    }
    return detailCache.get(templateId)
  }

  async function obterArvoreInstalacao (rootTemplate) {
    const ordered = []
    const visited = new Set()
    async function visitar (template) {
      if (visited.has(template.templateId)) return
      visited.add(template.templateId)
      for (const dependencyId of template.dependsOn || []) await visitar(await obterTemplate(dependencyId))
      ordered.push(template)
    }
    await visitar(rootTemplate)
    return ordered
  }

  function cartaoTemplate (summary) {
    const detailArea = el('div')
    let openMode = null

    async function abrirDetalhe (mode, control, renderizar) {
      if (openMode === mode) {
        openMode = null
        detailArea.replaceChildren()
        return
      }
      openMode = null
      setBusy(control, true, 'Carregando…')
      detailArea.replaceChildren(loading('Carregando detalhes…'))
      try {
        const template = await obterTemplate(summary.templateId)
        detailArea.replaceChildren(await renderizar(template))
        openMode = mode
      } catch (error) {
        detailArea.replaceChildren(errorState(error))
      } finally {
        setBusy(control, false)
      }
    }

    const codeButton = button('Ver código', { onClick: async (event) => {
      const control = event.currentTarget
      await abrirDetalhe('code', control, async (template) => painelCodigo(template))
    } })
    const informationButton = button('Ver informações', { onClick: async (event) => {
      const control = event.currentTarget
      await abrirDetalhe('information', control, async (template) => painelInformacoes(template))
    } })
    const addButton = button('Adicionar à automação', { variant: 'primary', onClick: async (event) => {
      const control = event.currentTarget
      await abrirDetalhe('installation', control, async (template) => {
        const [installationTree, pools, instances] = await Promise.all([
          obterArvoreInstalacao(template),
          api.pools.list(),
          api.instances.list()
        ])
        return painelInstalacao({ templates: installationTree, rootTemplateId: template.templateId, pools, instances, navigate })
      })
    } })

    return el('article', { className: 'list-card catalog-card' }, [
      el('div', { className: 'catalog-card-header' }, [
        el('div', {}, [
          el('p', { className: 'mono overline', text: `${summary.templateId} · v${summary.templateVersion}` }),
          el('h2', { text: summary.name }),
          el('p', { className: 'muted', text: summary.description })
        ]),
        el('div', { className: 'catalog-card-badges' }, selosDoCard(summary))
      ]),
      el('div', { className: 'button-row catalog-card-actions' }, [codeButton, informationButton, addButton]),
      detailArea
    ])
  }

  const byCategory = new Map()
  for (const template of templates) {
    if (!byCategory.has(template.category)) byCategory.set(template.category, [])
    byCategory.get(template.category).push(template)
  }
  const orderedCategories = [...Object.keys(CATEGORY_LABELS), ...[...byCategory.keys()].filter((category) => !CATEGORY_LABELS[category])]
  const sections = orderedCategories
    .filter((category) => byCategory.get(category)?.length)
    .map((category) => el('section', { className: 'catalog-section' }, [
      el('h2', { className: 'section-heading', text: rotuloCategoria(category) }),
      el('div', { className: 'stack' }, byCategory.get(category).map(cartaoTemplate))
    ]))

  return el('div', { className: 'stack-lg' }, sections)
}
