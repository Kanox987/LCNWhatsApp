import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, formatDate, notify, setBusy, setPageHeader } from '../ui.js'

function parseJson (value, label, { optional = false } = {}) {
  const text = value.trim()
  if (!text && optional) return undefined
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} precisa ser um JSON válido.`)
  }
}

function connectionForm ({ connection = null, close, refresh }) {
  const editing = Boolean(connection)
  const idInput = el('input', { type: 'text', value: connection?.id || '', placeholder: 'api-atendimento', disabled: editing })
  const kindInput = el('input', { type: 'text', value: connection?.kind || '', placeholder: 'http' })
  const configInput = el('textarea', { rows: '9', spellcheck: 'false' }, JSON.stringify(connection?.config ?? {}, null, 2))
  const secretInput = el('textarea', { rows: '5', spellcheck: 'false', placeholder: '{\n  "token": "..."\n}' })
  const message = el('div')
  const submit = button(editing ? 'Salvar conexão' : 'Criar conexão', { variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'panel stack-lg' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('h2', { text: editing ? `Editar ${connection.id}` : 'Nova conexão' }), el('p', { text: 'Conexões guardam a configuração de integrações externas no motor.' })]),
      close ? button('Fechar', { variant: 'quiet', 'aria-label': 'Fechar o formulário de conexão', onClick: close }) : null
    ]),
    el('div', { className: 'form-grid' }, [
      field('Identificador', idInput, 'Nome estável usado pelas automações para referenciar esta conexão.'),
      field('Tipo', kindInput, 'Identifica o adaptador da integração, por exemplo http. O suporte de execução depende do motor.')
    ]),
    field('Configuração em JSON', configInput, 'Parâmetros não secretos, como URL base, timeouts e opções do adaptador.'),
    field('Segredos em JSON', secretInput, editing
      ? 'O valor atual nunca volta para o navegador. Deixe vazio para preservar o segredo existente; preencha somente para substituí-lo.'
      : 'Opcional. Tokens e senhas são enviados uma vez e nunca aparecem novamente na API.'),
    editing ? el('div', { className: 'notice notice-info compact' }, [el('strong', { text: 'Segredo protegido' }), el('p', { text: 'A API atual não informa se já existe um segredo; por segurança, o campo sempre abre vazio.' })]) : null,
    message,
    el('div', { className: 'button-row' }, [submit, close ? button('Cancelar', { onClick: close }) : null])
  ])
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    message.replaceChildren()
    setBusy(submit, true, 'Salvando…')
    try {
      const id = idInput.value.trim()
      const kind = kindInput.value.trim()
      if (!id) throw new Error('Informe o identificador da conexão.')
      if (!kind) throw new Error('Informe o tipo da conexão.')
      const body = { kind, config: parseJson(configInput.value, 'A configuração') }
      const secret = parseJson(secretInput.value, 'O segredo', { optional: true })
      if (secret !== undefined) body.secret = secret
      if (editing) await api.connections.update(connection.id, body)
      else await api.connections.create({ id, ...body })
      notify(editing ? 'Conexão atualizada.' : 'Conexão criada.')
      await refresh()
    } catch (error) {
      message.replaceChildren(errorState(error))
    } finally {
      setBusy(submit, false)
    }
  })
  return form
}

export async function renderConnections ({ refresh }) {
  setPageHeader({
    eyebrow: 'Configurações da API',
    title: 'Conexões',
    description: 'Cadastre parâmetros e segredos usados por integrações externas, sem expor credenciais salvas.',
    actions: [button('Atualizar', { onClick: refresh })]
  })
  const connections = await api.connections.list()
  const root = el('div', { className: 'connections-layout' })
  const listColumn = el('div', { className: 'stack' })
  const editor = el('div')
  const showEditor = (connection = null) => editor.replaceChildren(connectionForm({ connection, close: () => editor.replaceChildren(), refresh }))
  listColumn.append(el('div', { className: 'section-heading' }, [
    el('div', {}, [
      el('h2', { text: 'Conexões cadastradas' }),
      el('p', { text: connections.length === 1 ? '1 configuração disponível.' : `${connections.length} configurações disponíveis.` })
    ]),
    button('Nova conexão', { variant: 'primary', onClick: () => showEditor() })
  ]))
  if (!connections.length) {
    listColumn.append(emptyState('Nenhuma conexão cadastrada', 'Crie uma conexão somente quando uma integração realmente precisar dela.', button('Criar conexão', { variant: 'primary', onClick: () => showEditor() })))
  } else {
    listColumn.append(...connections.map((connection) => el('article', { className: 'list-card connection-card' }, [
      el('div', { className: 'list-card-main' }, [
        el('div', {}, [el('p', { className: 'mono overline', text: connection.id }), el('h2', { text: connection.kind })]),
        badge('Configuração ativa', 'info')
      ]),
      el('pre', { className: 'json-view compact-json', text: JSON.stringify(connection.config, null, 2) }),
      el('small', { className: 'muted', text: `Atualizada em ${formatDate(connection.updatedAt)}` }),
      el('div', { className: 'button-row' }, [
        button('Editar', { variant: 'quiet', onClick: () => showEditor(connection) }),
        button('Remover', { variant: 'danger-quiet', onClick: async (event) => {
          if (!window.confirm(`Remover a conexão "${connection.id}"? Esta ação não pode ser desfeita.`)) return
          const control = event.currentTarget
          setBusy(control, true, 'Removendo…')
          try {
            await api.connections.remove(connection.id)
            notify('Conexão removida.')
            await refresh()
          } catch (error) {
            notify(error.message, 'danger')
            setBusy(control, false)
          }
        } })
      ])
    ])))
  }
  root.append(listColumn, editor)
  return root
}
