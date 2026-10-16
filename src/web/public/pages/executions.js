import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, formatDate, loading, notify, setBusy, setPageHeader } from '../ui.js'

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

function milhar (n) {
  return Number(n || 0).toLocaleString('pt-BR')
}

function formatarBytes (n) {
  const mb = Number(n || 0) / 1024 / 1024
  return `${mb.toFixed(1).replace('.', ',')} MB`
}

// POR QUANTO TEMPO O HISTÓRICO FICA, configurável aqui.
//
// O dono pediu em uma frase — "msg com mais de 72h vai de F" — e o motivo
// estava na tela: o banco passou de 450 mil execuções, quase todas "não
// casou", e ninguém abre a Execuções para ver anteontem. Fica nesta aba porque
// é o histórico DESTA tela que a janela apaga; configuração que mora longe do
// que ela afeta é configuração que ninguém encontra.
//
// Pelo painel, e não por arquivo, pelo mesmo motivo de sempre: quem aluga o
// sistema não tem terminal.
function painelDeRetencao (estado, recarregar) {
  const horas = el('input', { type: 'number', min: '0', step: '1', value: String(estado.horas) })
  const compactar = el('input', { type: 'checkbox' })
  const resumo = el('p', { className: 'muted' })
  const salvar = button('Salvar a janela', { variant: 'primary' })
  const limpar = button('Limpar agora')

  function mostrar (dados) {
    const total = dados.total || {}
    const vencidos = dados.vencidos || {}
    resumo.textContent = dados.horas
      ? `Guardado agora: ${milhar(total.execucoes)} execuções, ${milhar(total.eventos)} mensagens e ` +
        `${milhar(total.comandos)} comandos. Fora da janela: ${milhar(vencidos.execucoes)} execuções, ` +
        `${milhar(vencidos.eventos)} mensagens e ${milhar(vencidos.comandos)} comandos.`
      : `Nada é apagado: ${milhar(total.execucoes)} execuções, ${milhar(total.eventos)} mensagens e ` +
        `${milhar(total.comandos)} comandos guardados para sempre.`
  }
  mostrar(estado)

  salvar.addEventListener('click', async () => {
    setBusy(salvar, true, 'Salvando…')
    try {
      const salvo = await api.retention.save(Number(horas.value))
      mostrar(salvo)
      notify(salvo.horas ? `Histórico guardado por ${salvo.horas}h.` : 'Histórico guardado para sempre.')
    } catch (error) {
      notify(error.message, 'danger')
    } finally {
      setBusy(salvar, false)
    }
  })

  limpar.addEventListener('click', async () => {
    setBusy(limpar, true, 'Limpando…')
    try {
      const feito = await api.retention.sweep({ compactar: compactar.checked })
      mostrar(feito)
      const quanto = feito.apagado || {}
      notify(
        `Apagados ${milhar(quanto.execucoes)} execuções, ${milhar(quanto.eventos)} mensagens e ` +
        `${milhar(quanto.comandos)} comandos` +
        (feito.disco ? `, e o banco devolveu ${formatarBytes(feito.disco.liberado)}.` : '.')
      )
      await recarregar()
    } catch (error) {
      notify(error.message, 'danger')
    } finally {
      setBusy(limpar, false)
    }
  })

  return el('details', { className: 'card' }, [
    el('summary', { text: estado.horas ? `Histórico guardado por ${estado.horas}h` : 'Histórico guardado para sempre' }),
    el('div', { className: 'stack' }, [
      field('Janela, em horas', horas, 'O que for mais velho que isso é apagado — execuções, mensagens recebidas e comandos já resolvidos. 0 guarda para sempre. A varredura roda ao subir o motor e de hora em hora.'),
      resumo,
      el('label', { className: 'switch-row' }, [compactar, el('span', {}, [
        el('strong', { text: 'Devolver o disco também' }),
        el('small', { text: 'Reescreve o banco para ele encolher de verdade. Vale depois de uma limpeza grande; nas seguintes não tem o que devolver.' })
      ])]),
      el('div', { className: 'filter-bar' }, [salvar, limpar]),
      el('p', { className: 'muted', text: 'Comando ainda pendente nunca é apagado: é dele que uma cadeia de chamadas depende para retomar. A mensagem recebida também sai, e com ela a trava que impede o mesmo evento de ser executado duas vezes — vale dentro da janela.' })
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
  const [automations, retention, initial] = await Promise.all([
    api.automations.list(),
    // Falhar a tela inteira porque a retenção não respondeu seria trocar o
    // instrumento pelo acessório: sem ela, a Execuções continua servindo.
    api.retention.get().catch(() => null),
    // A primeira carga precisa bater com o filtro que o select mostra. Pedir
    // tudo aqui e dizer "O que aconteceu" na tela seria a tela descrevendo
    // errado o que está mostrando.
    api.executions.list({ limit: 25, runStatus: 'aconteceu' })
  ])

  const root = el('div', { className: 'stack-lg' })
  const automationSelect = el('select', {}, [el('option', { value: '', text: 'Todas as automações' })])
  for (const automation of automations) automationSelect.append(el('option', { value: automation.id, text: automation.draft?.document?.name || automation.id }))
  // A TELA ABRE MOSTRANDO O QUE ACONTECEU.
  //
  // Cada mensagem recebida gera um registro por automação ao vivo, e quase
  // todos são "sem correspondência" — a automação foi avaliada e não casou.
  // Com 21 automações ligadas, o histórico passou de 450 mil linhas e a
  // execução que a pessoa veio procurar ficava soterrada em páginas de
  // "não fiz nada". Esta é a tela que o dono usa para descobrir por que um
  // comando falhou; abrir no ruído é desperdiçar o instrumento.
  //
  // "Tudo, inclusive o que não casou" continua a um clique.
  const runStatus = el('select', {}, [
    el('option', { value: 'aconteceu', text: 'O que aconteceu (padrão)', selected: true }),
    el('option', { value: '', text: 'Tudo, inclusive o que não casou' }),
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
  // `append(null)` escreveria a palavra "null" na tela — o DOM converte para
  // texto em vez de ignorar, diferente do `el()` daqui.
  if (retention) root.append(painelDeRetencao(retention, refresh))
  root.append(form, el('div', { className: 'execution-layout' }, [el('div', {}, [list, loadMore]), detail]))
  return root
}
