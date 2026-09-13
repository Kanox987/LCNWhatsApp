import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, formatDate, loading, setBusy, setPageHeader } from '../ui.js'

const STATUS = {
  matched_shadow: ['Correspondência em sombra', 'info'],
  matched_live: ['Executada ao vivo', 'success'],
  no_match: ['Sem correspondência', 'neutral'],
  error: ['Erro', 'danger'],
  pending: ['Pendente', 'warning'],
  sent: ['Enviado', 'success'],
  failed: ['Falhou', 'danger'],
  outcome_unknown: ['Resultado desconhecido', 'warning']
}

function statusBadge (status) {
  const [label, tone] = STATUS[status] || [status || 'desconhecido', 'neutral']
  return badge(label, tone)
}

function plural (quantidade, singular, plural) {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`
}

function commandCounts (commands) {
  if (!commands?.total) return 'Sem comando de saída'
  const parts = [plural(commands.total, 'comando', 'comandos')]
  if (commands.sent) parts.push(plural(commands.sent, 'enviado', 'enviados'))
  if (commands.failed) parts.push(plural(commands.failed, 'com falha', 'com falha'))
  if (commands.pending) parts.push(plural(commands.pending, 'pendente', 'pendentes'))
  if (commands.outcomeUnknown) parts.push(`${commands.outcomeUnknown} sem confirmação`)
  return parts.join(' · ')
}

function detailPanel (run, close) {
  const commands = run.commands?.items || []
  return el('aside', { className: 'detail-panel' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('p', { className: 'mono overline', text: `Execução #${run.id}` }), el('h2', { text: run.automationId })]),
      button('Fechar', { variant: 'quiet', 'aria-label': 'Fechar o detalhe da execução', onClick: close })
    ]),
    el('dl', { className: 'detail-list' }, [
      el('dt', { text: 'Resultado' }), el('dd', {}, statusBadge(run.runStatus)),
      el('dt', { text: 'Modo' }), el('dd', { text: run.deploymentMode === 'live' ? 'Ao vivo' : 'Sombra' }),
      el('dt', { text: 'Revisão' }), el('dd', { text: String(run.automationRevision) }),
      el('dt', { text: 'Criada em' }), el('dd', { text: formatDate(run.createdAt) }),
      el('dt', { text: 'Tipo de conversa' }), el('dd', { text: run.event?.chat?.kind || '—' }),
      el('dt', { text: 'Mensagem recebida' }), el('dd', { text: run.event?.message?.preview || '—' })
    ]),
    run.detail ? el('div', { className: 'detail-block' }, [el('h3', { text: 'Detalhe do motor' }), el('pre', { className: 'json-view compact-json', text: JSON.stringify(run.detail, null, 2) })]) : null,
    el('div', { className: 'detail-block' }, [
      el('h3', { text: 'Comandos de saída' }),
      commands.length
        ? el('div', { className: 'command-list' }, commands.map((command) => el('div', { className: 'command-item' }, [
            el('div', {}, [el('strong', { text: command.commandType }), el('span', { className: 'mono', text: `#${command.id}` })]),
            statusBadge(command.status),
            el('small', { text: command.resolvedAt ? `Resolvido em ${formatDate(command.resolvedAt)}` : `Criado em ${formatDate(command.createdAt)}` })
          ])))
        : el('p', { className: 'muted', text: 'Esta execução não gerou comando de saída.' })
    ])
  ])
}

export async function renderExecutions ({ refresh }) {
  setPageHeader({
    eyebrow: 'Observabilidade',
    title: 'Execuções',
    description: 'Investigue correspondências, respostas enviadas e falhas registradas pelo motor.',
    actions: [button('Atualizar', { onClick: refresh })]
  })
  const [automations, initial] = await Promise.all([
    api.automations.list(),
    api.executions.list({ limit: 25 })
  ])

  const root = el('div', { className: 'stack-lg' })
  const automationSelect = el('select', {}, [el('option', { value: '', text: 'Todas as automações' })])
  for (const automation of automations) automationSelect.append(el('option', { value: automation.id, text: automation.draft?.document?.name || automation.id }))
  const runStatus = el('select', {}, [
    el('option', { value: '', text: 'Todos os resultados' }),
    el('option', { value: 'matched_shadow', text: 'Correspondência em sombra' }),
    el('option', { value: 'matched_live', text: 'Executada ao vivo' }),
    el('option', { value: 'no_match', text: 'Sem correspondência' }),
    el('option', { value: 'error', text: 'Erro' })
  ])
  const commandStatus = el('select', {}, [
    el('option', { value: '', text: 'Qualquer envio' }),
    el('option', { value: 'pending', text: 'Envio pendente' }),
    el('option', { value: 'sent', text: 'Enviado' }),
    el('option', { value: 'failed', text: 'Falhou' }),
    el('option', { value: 'outcome_unknown', text: 'Resultado desconhecido' })
  ])
  const filterButton = button('Aplicar filtros', { variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'filter-bar' }, [
    field('Automação', automationSelect),
    field('Resultado da execução', runStatus),
    field('Estado do envio', commandStatus),
    filterButton
  ])
  const list = el('div', { className: 'execution-list' })
  const detail = el('div')
  const loadMore = button('Carregar mais', { className: 'button button-secondary load-more' })
  let items = initial.items || []
  let nextCursor = initial.nextCursor

  function filters (cursor) {
    return {
      automationId: automationSelect.value,
      runStatus: runStatus.value,
      commandStatus: commandStatus.value,
      cursor,
      limit: 25
    }
  }

  function renderList () {
    list.replaceChildren()
    if (!items.length) {
      list.append(emptyState('Nenhuma execução encontrada', 'Ajuste os filtros ou aguarde uma automação processar uma nova mensagem.'))
    } else {
      list.append(...items.map((run) => {
        const open = button('Ver detalhes', { variant: 'quiet', onClick: async (event) => {
          // event.currentTarget vira null assim que o despacho do evento
          // termina — precisa capturar ANTES do primeiro await, senão o
          // reset de setBusy() no fim vira um no-op silencioso e o botão
          // fica preso em "Abrindo…" pra sempre (achado real testando).
          const control = event.currentTarget
          setBusy(control, true, 'Abrindo…')
          detail.replaceChildren(loading('Carregando detalhe…'))
          try {
            const full = await api.executions.get(run.id)
            detail.replaceChildren(detailPanel(full, () => detail.replaceChildren()))
            detail.scrollIntoView({ behavior: 'smooth', block: 'start' })
          } catch (error) {
            detail.replaceChildren(errorState(error))
          } finally {
            setBusy(control, false)
          }
        } })
        return el('article', { className: 'execution-row' }, [
          el('div', { className: 'execution-title' }, [
            el('strong', { text: run.automationId }),
            el('small', { text: `Revisão ${run.automationRevision} · ${run.deploymentMode === 'live' ? 'ao vivo' : 'sombra'}` })
          ]),
          el('div', { className: 'execution-aside' }, [statusBadge(run.runStatus), open]),
          el('div', { className: 'execution-head' }, [
            el('span', { className: 'execution-id', text: `#${run.id}` }),
            el('span', { className: 'command-count', text: `${formatDate(run.createdAt)} · ${commandCounts(run.commands)}` })
          ])
        ])
      }))
    }
    loadMore.hidden = !nextCursor
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    setBusy(filterButton, true, 'Filtrando…')
    detail.replaceChildren()
    try {
      const result = await api.executions.list(filters())
      items = result.items || []
      nextCursor = result.nextCursor
      renderList()
    } catch (error) {
      list.replaceChildren(errorState(error))
    } finally {
      setBusy(filterButton, false)
    }
  })
  loadMore.addEventListener('click', async () => {
    setBusy(loadMore, true, 'Carregando…')
    try {
      const result = await api.executions.list(filters(nextCursor))
      items.push(...(result.items || []))
      nextCursor = result.nextCursor
      renderList()
    } catch (error) {
      detail.replaceChildren(errorState(error))
    } finally {
      setBusy(loadMore, false)
    }
  })
  renderList()
  root.append(form, el('div', { className: 'execution-layout' }, [el('div', {}, [list, loadMore]), detail]))
  return root
}
