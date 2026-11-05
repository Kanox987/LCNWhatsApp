import { api, ApiError } from '../api.js'
import { avisoInline } from './variables.js'
import { badge, button, el, emptyState, errorState, field, loading, notify, setBusy, setPageHeader } from '../ui.js'
import { TYPE_LABELS, criarControleParametro, valorParametro } from '../logic/parametros.js'
import {
  OPCOES_DE_ESCOPO, montarEscopo, descreverEscopo, escopoExigeBusca, escopoExigeVariavel, escopoAceitaExcecao,
  excecoesDoAlcance, escopoEhAbrangente
} from '../logic/escopo.js'

const CATEGORY_LABELS = {
  utilitarios: 'Utilitários',
  configuracoes: 'Configurações',
  empresarial: 'Empresarial',
  'modulos-especializados': 'Módulos especializados'
}

function rotuloCategoria (category) {
  return CATEGORY_LABELS[category] || category
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

function painelInstalacao ({ templates, rootTemplateId, pools, instances, navigate }) {
  const templateFields = new Map()
  const selectedTarget = { value: null }
  // O que a pessoa escolheu sobre ONDE: o destino (um dos seis do motor), a marca
  // quando o destino é "conversas marcadas" e as conversas que ficam de fora.
  // Começa em "um contato" para que nada nasça liberado para todos por esquecimento.
  const escopo = { modo: 'contact', variavel: '', excecoes: [] }
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
    lines.push(descreverEscopo({ ...escopo, alvo: selectedTarget.value }))
    lines.push(modoSelect.value === 'shadow' ? 'Modo sombra: só registra o que faria, sem enviar nada.' : 'Modo ao vivo: o comando responde de verdade assim que for instalado.')
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
  // Onde o comando pode executar: os seis destinos que o motor aceita.
  const modoEscopoSelect = el('select', {}, OPCOES_DE_ESCOPO.map((opcao) => el('option', { value: opcao.id, text: opcao.rotulo })))
  const modoAjuda = el('p', { className: 'muted compact' })
  const variavelInput = el('input', { type: 'text', placeholder: 'Ex.: vip' })
  const kindSelect = el('select', {}, [
    el('option', { value: 'contact', text: 'Contatos' }),
    el('option', { value: 'group', text: 'Grupos' })
  ])
  // O que a busca procura: o destino de contato/grupo e os destinos "todos os
  // contatos"/"todos os grupos" já dizem; só os outros precisam perguntar.
  const tipoDaBusca = () => (escopo.modo === 'all_contacts' ? 'contact' : escopo.modo === 'all_groups' ? 'group' : escopo.modo === 'contact' || escopo.modo === 'group' ? escopo.modo : kindSelect.value)
  const excecoesArea = el('div')
  const searchInput = el('input', { type: 'search', placeholder: 'Digite um nome para buscar', disabled: !instances.length })
  const directoryResults = el('div', { className: 'directory-results' })
  let searchTimer = null

  const campoDoTipoDaBusca = field('Buscar em', kindSelect, 'Qual tipo de conversa você quer deixar de fora.')
  const campoDaMarca = field('Nome da marca', variavelInput, 'A conversa precisa ter esta variável preenchida (a mesma que a aba Dados mostra, como vip).')
  const campoDaBusca = field('Buscar por nome', searchInput, 'A busca acontece automaticamente depois que você para de digitar.')
  const areaDoDestino = el('div', {}, [el('p', { className: 'overline', text: 'Destino escolhido' }), targetArea])
  const areaDasExcecoes = el('div', {}, [el('p', { className: 'overline', text: 'Fica de fora (opcional)' }), excecoesArea])

  function renderizarExcecoes () {
    excecoesArea.replaceChildren(...(escopo.excecoes.length
      ? escopo.excecoes.map((item) => el('div', { className: 'scope-chip' }, [
        badge(item.kind === 'group' ? 'Grupo' : 'Contato', 'warning'),
        el('span', {}, [el('strong', { text: item.label || item.id }), el('small', { className: 'mono', text: ` · ${item.id}` })]),
        button('Voltar a incluir', { variant: 'quiet', onClick: () => {
          escopo.excecoes = escopo.excecoes.filter((outro) => !(outro.kind === item.kind && outro.id === item.id))
          renderizarExcecoes()
          atualizarResumo()
        } })
      ]))
      : [el('p', { className: 'muted compact', text: 'Nenhuma. Escolha na busca acima para tirar uma conversa do alcance.' })]))
  }

  // Mostra só o que o destino escolhido pede: busca para contato/grupo, o nome
  // da marca para "marcadas", e a busca de exceções para os abrangentes.
  function ajustarCamposDoEscopo () {
    const busca = escopoExigeBusca(escopo.modo)
    const excecao = escopoAceitaExcecao(escopo.modo)
    modoAjuda.textContent = OPCOES_DE_ESCOPO.find((opcao) => opcao.id === escopo.modo)?.ajuda || ''
    campoDaMarca.hidden = !escopoExigeVariavel(escopo.modo)
    campoDoTipoDaBusca.hidden = !(escopo.modo === 'everywhere' || escopo.modo === 'tagged')
    campoDaBusca.hidden = !(busca || excecao)
    directoryResults.hidden = !(busca || excecao)
    areaDoDestino.hidden = !busca
    areaDasExcecoes.hidden = !excecao
    campoDaBusca.querySelector('label').textContent = busca ? 'Buscar por nome' : 'Buscar conversa para deixar de fora'
  }

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

  // Só a última busca pode desenhar resultado: uma resposta lenta de "grupo"
  // não pode chegar depois da troca para "contato" e virar o alvo errado.
  let buscaAtual = 0

  async function buscarDiretorio () {
    const minha = ++buscaAtual
    if (!instanceSelect.value) {
      directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Cadastre uma instância antes de procurar contatos ou grupos.' }))
      return
    }
    directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Buscando…' }))
    try {
      const tipo = tipoDaBusca()
      const result = await api.instances.directory(instanceSelect.value, { kind: tipo, q: searchInput.value.trim(), limit: 30 })
      if (minha !== buscaAtual) return
      if (!result.items.length) {
        directoryResults.replaceChildren(el('p', { className: 'muted', text: 'Nenhum resultado encontrado.' }))
        return
      }
      directoryResults.replaceChildren(...result.items.map((item) => button(`${item.label} · ${item.id}`, {
        variant: 'result',
        onClick: () => {
          const escolhida = { ...item, kind: item.kind || tipo }
          if (escolhida.kind !== tipoDaBusca()) return
          if (escopoExigeBusca(escopo.modo)) {
            selectedTarget.value = escolhida
            renderizarDestino()
          } else if (!escopo.excecoes.some((outra) => outra.kind === escolhida.kind && outra.id === escolhida.id)) {
            escopo.excecoes = [...escopo.excecoes, escolhida]
            renderizarExcecoes()
          }
          atualizarResumo()
        }
      })))
    } catch (error) {
      if (minha === buscaAtual) directoryResults.replaceChildren(errorState(error))
    }
  }

  const agendarBusca = () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(buscarDiretorio, 320)
  }
  searchInput.addEventListener('input', agendarBusca)
  // O diretório é de UMA instância: o que foi escolhido na anterior não vale na nova.
  instanceSelect.addEventListener('change', () => {
    selectedTarget.value = null
    escopo.excecoes = []
    renderizarDestino()
    renderizarExcecoes()
    atualizarResumo()
    buscarDiretorio()
  })
  kindSelect.addEventListener('change', buscarDiretorio)
  variavelInput.addEventListener('input', () => { escopo.variavel = variavelInput.value; atualizarResumo() })
  modoEscopoSelect.addEventListener('change', () => {
    escopo.modo = modoEscopoSelect.value
    // O que foi escolhido para um destino não vale para outro: um grupo
    // escolhido não pode sobreviver à troca para "contato".
    if (selectedTarget.value && selectedTarget.value.kind !== escopo.modo) selectedTarget.value = null
    escopo.excecoes = escopoAceitaExcecao(escopo.modo) ? excecoesDoAlcance(escopo.modo, escopo.excecoes) : []
    // A marca de "conversas marcadas" não acompanha a pessoa para os outros alcances.
    if (!escopoExigeVariavel(escopo.modo)) { escopo.variavel = ''; variavelInput.value = '' }
    ajustarCamposDoEscopo()
    renderizarDestino()
    renderizarExcecoes()
    atualizarResumo()
    if (escopoExigeBusca(escopo.modo) || escopoAceitaExcecao(escopo.modo)) buscarDiretorio()
  })

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
    return montarEscopo({ ...escopo, alvo: selectedTarget.value }).problema
  }

  // Em que modo a automação nasce.
  //
  // Antes isto não existia: a coluna tem DEFAULT 'shadow', a rota não definia o
  // campo, e todo comando instalado nascia mudo — avaliava, registrava "teria
  // executado" e não enviava nada. O controle para trocar existia, mas só na
  // tela de Automações, que quem acabou de instalar não abre. Escolher aqui, com
  // "ao vivo" marcado, é o que faz o botão "Instalar" significar o que diz.
  const modoSelect = el('select', {}, [
    el('option', { value: 'live', selected: true, text: 'Ao vivo — responde de verdade' }),
    el('option', { value: 'shadow', text: 'Sombra — só registra o que faria, sem enviar' })
  ])

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
      deploymentMode: modoSelect.value,
      scope: montarEscopo({ ...escopo, alvo: selectedTarget.value }).escopo
    }
  }

  modoSelect.addEventListener('change', atualizarResumo)

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
      // "Todos" só vale se a pessoa escolheu: uma confirmação com o alcance em
      // palavras separa escolher de clicar sem querer.
      if (escopoEhAbrangente(escopo.modo) && !window.confirm(`${descreverEscopo({ ...escopo, alvo: selectedTarget.value })}\n\nInstalar com este alcance?`)) return
      setBusy(control, true, 'Instalando…')
      try {
        const result = await api.templates.install(rootTemplateId, montarCorpo())
        const installed = Array.isArray(result?.installed) ? result.installed : []
        const ids = installed.map((automation) => automation.id).filter(Boolean)
        const emSombra = result?.deploymentMode === 'shadow'
        const message = ids.length
          ? `${ids.length === 1 ? 'Automação instalada' : 'Automações instaladas'}: ${ids.join(', ')}.`
          : 'Instalação concluída pelo motor.'
        notify(message)
        resultArea.replaceChildren(el('div', { className: `notice ${emSombra ? 'notice-warning' : 'notice-success'}` }, [
          el('strong', { text: emSombra ? 'Instalado em SOMBRA.' : 'Instalado e no ar.' }),
          el('p', { text: message }),
          // Dizer o modo aqui, e não só na outra tela, é o conserto de um erro
          // que já aconteceu duas vezes: anunciar "está no ar" um comando mudo.
          el('p', {
            className: 'muted compact',
            text: emSombra
              ? 'Ele NÃO vai responder no WhatsApp ainda — só registra o que faria, na aba Execuções. Troque para "ao vivo" em Automações quando quiser ligar.'
              : 'Já responde no WhatsApp.'
          }),
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
  renderizarExcecoes()
  ajustarCamposDoEscopo()
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
        field('Alcance', modoEscopoSelect, 'Nada fica liberado para todos por padrão: “todos” só vale se você escolher.')
      ]),
      modoAjuda,
      el('div', { className: 'form-grid' }, [campoDaMarca, campoDoTipoDaBusca]),
      campoDaBusca,
      directoryResults,
      areaDoDestino,
      areaDasExcecoes
    ]),
    summaryArea,
    el('section', { className: 'catalog-template-form' }, [
      el('p', { className: 'overline', text: 'Como nasce' }),
      field('Modo', modoSelect, 'Sombra serve para conferir o que o comando faria antes de deixar que ele faça.')
    ]),
    el('div', { className: 'catalog-install-actions' }, [botaoInstalar]),
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
