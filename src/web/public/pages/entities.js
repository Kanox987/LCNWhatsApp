// Módulo 3 da Parte C do plano — "ver dados de usuários/grupos": busca um
// contato/grupo pelo diretório de uma instância e edita as variáveis
// customizadas dele (Módulo 1 da Parte C, `entity_attributes`). As
// variáveis são GLOBAIS por JID (não por instância) — o seletor de
// instância aqui é só pra ACHAR o JID pelo nome; depois de escolhido, as
// variáveis valem pra esse contato/grupo em qualquer automação.
import { api, ApiError } from '../api.js'
import { badge, button, el, emptyState, errorState, field, notify, setBusy, setPageHeader } from '../ui.js'

function attributeRow (kind, id, attribute, onChanged) {
  const valueInput = el('input', { type: 'text', value: typeof attribute.value === 'string' ? attribute.value : JSON.stringify(attribute.value) })
  const saveBtn = button('Salvar', { variant: 'quiet', onClick: async (event) => {
    const control = event.currentTarget
    setBusy(control, true, 'Salvando…')
    try {
      await api.entities.set(kind, id, attribute.key, valueInput.value)
      notify(`Variável "${attribute.key}" atualizada.`)
      setBusy(control, false)
    } catch (error) {
      notify(error.message, 'danger')
      setBusy(control, false)
    }
  } })
  const removeBtn = button('Remover', { variant: 'danger-quiet', onClick: async (event) => {
    if (!window.confirm(`Remover a variável "${attribute.key}"?`)) return
    const control = event.currentTarget
    setBusy(control, true, 'Removendo…')
    try {
      await api.entities.remove(kind, id, attribute.key)
      notify(`Variável "${attribute.key}" removida.`)
      await onChanged()
    } catch (error) {
      notify(error.message, 'danger')
      setBusy(control, false)
    }
  } })
  return el('div', { className: 'list-card compact' }, [
    el('div', { className: 'list-card-main' }, [
      el('strong', { className: 'mono', text: attribute.key }),
      valueInput
    ]),
    el('div', { className: 'button-row' }, [saveBtn, removeBtn])
  ])
}

function entityPanel (kind, entity) {
  const attributesArea = el('div', { className: 'stack' })
  const newKeyInput = el('input', { type: 'text', placeholder: 'ex: vip' })
  const newValueInput = el('input', { type: 'text', placeholder: 'ex: true' })
  const addBtn = button('Adicionar variável', { variant: 'primary', onClick: async (event) => {
    const key = newKeyInput.value.trim()
    if (!key) return notify('Informe um nome pra variável.', 'danger')
    const control = event.currentTarget
    setBusy(control, true, 'Adicionando…')
    try {
      await api.entities.set(kind, entity.id, key, newValueInput.value)
      newKeyInput.value = ''
      newValueInput.value = ''
      notify(`Variável "${key}" adicionada.`)
      await renderAttributes()
      setBusy(control, false)
    } catch (error) {
      notify(error.message, 'danger')
      setBusy(control, false)
    }
  } })

  async function renderAttributes () {
    attributesArea.replaceChildren(el('p', { className: 'muted', text: 'Carregando variáveis…' }))
    try {
      const attributes = await api.entities.list(kind, entity.id)
      if (!attributes.length) {
        attributesArea.replaceChildren(el('p', { className: 'muted', text: 'Nenhuma variável ainda pra este ' + (kind === 'group' ? 'grupo' : 'contato') + '.' }))
      } else {
        attributesArea.replaceChildren(...attributes.map((attribute) => attributeRow(kind, entity.id, attribute, renderAttributes)))
      }
    } catch (error) {
      attributesArea.replaceChildren(errorState(error))
    }
  }
  renderAttributes()

  return el('section', { className: 'panel panel-accent' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: entity.label || entity.id }),
        el('p', { className: 'mono compact', text: entity.id })
      ]),
      badge(kind === 'group' ? 'Grupo' : 'Contato', 'info')
    ]),
    el('p', { className: 'field-help', text: 'Variáveis customizadas ficam disponíveis em qualquer automação como {{custom.<nome>}}, e valem pra este contato/grupo em qualquer instância — não são por número.' }),
    attributesArea,
    el('div', { className: 'form-grid' }, [
      field('Nova variável — nome', newKeyInput, 'Sem espaços; use letras/números/hífen.'),
      field('Nova variável — valor', newValueInput, 'Sempre texto (ex: "true", "premium").')
    ]),
    el('div', { className: 'button-row' }, addBtn)
  ])
}

export async function renderEntities ({ navigate }) {
  const instances = await api.instances.list()
  setPageHeader({
    eyebrow: 'Dados do sistema',
    title: 'Contatos e grupos',
    description: 'Busque um contato ou grupo e edite as variáveis customizadas usadas pelas automações (ex: marcar um contato como VIP).',
    actions: []
  })

  const instanceSelect = el('select')
  if (!instances.length) instanceSelect.append(el('option', { value: '', text: 'Nenhuma instância disponível' }))
  for (const instance of instances) instanceSelect.append(el('option', { value: instance.instanceId, text: `${instance.label || instance.instanceId} · ${instance.instanceId}` }))
  const kindSelect = el('select', {}, [el('option', { value: 'contact', text: 'Contatos' }), el('option', { value: 'group', text: 'Grupos' })])
  const searchInput = el('input', { type: 'search', placeholder: 'Digite um nome para buscar' })
  const resultsArea = el('div', { className: 'directory-results' })
  const panelArea = el('div')
  let searchTimer = null

  async function search () {
    if (!instanceSelect.value) return resultsArea.replaceChildren(el('p', { className: 'muted', text: 'Escolha uma instância com diretório disponível.' }))
    resultsArea.replaceChildren(el('p', { className: 'muted', text: 'Buscando…' }))
    try {
      const result = await api.instances.directory(instanceSelect.value, { kind: kindSelect.value, q: searchInput.value.trim(), limit: 30 })
      if (!result.items.length) return resultsArea.replaceChildren(el('p', { className: 'muted', text: 'Nenhum resultado encontrado.' }))
      resultsArea.replaceChildren(...result.items.map((item) => button(`${item.label} · ${item.id}`, {
        variant: 'result',
        onClick: () => { panelArea.replaceChildren(entityPanel(kindSelect.value, item)) }
      })))
    } catch (error) {
      resultsArea.replaceChildren(error instanceof ApiError ? errorState(error) : el('p', { className: 'muted', text: 'Não foi possível buscar agora.' }))
    }
  }
  const scheduleSearch = () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(search, 320) }
  searchInput.addEventListener('input', scheduleSearch)
  instanceSelect.addEventListener('change', search)
  kindSelect.addEventListener('change', search)

  if (!instances.length) {
    return emptyState('Nenhuma instância disponível', 'Cadastre ou conecte uma instância antes de buscar contatos e grupos.')
  }

  return el('div', { className: 'stack-lg' }, [
    el('section', { className: 'panel' }, [
      el('div', { className: 'form-grid' }, [
        field('Diretório da instância', instanceSelect, 'A instância define em qual agenda a busca será feita.'),
        field('Tipo', kindSelect, 'Contatos ou grupos.')
      ]),
      field('Buscar por nome', searchInput, 'A busca acontece automaticamente depois que você para de digitar.'),
      resultsArea
    ]),
    panelArea
  ])
}
