// Módulo 3 da Parte C do plano — "ver dados de usuários/grupos": busca um
// contato/grupo pelo diretório de uma instância e edita as variáveis
// customizadas dele (Módulo 1 da Parte C, `entity_attributes`). As
// variáveis são GLOBAIS por JID (não por instância) — o seletor de
// instância aqui é só pra ACHAR o JID pelo nome; depois de escolhido, as
// variáveis valem pra esse contato/grupo em qualquer automação.
import { api, ApiError } from '../api.js'
import { badge, button, el, emptyState, errorState, field, notify, setBusy, setPageHeader } from '../ui.js'
import { TIPOS, converterParaTipo, descreverValor, tipoDoValor, valorParaCampo } from '../logic/valores.js'
import { conversaPeloId, linhasDoMenu, nivelDoTipo, semFamiliasConfiguradas } from '../logic/menuDaConversa.js'

// Seletor de tipo + campo, que troca conforme o tipo. Devolve os dois nós e
// uma função que lê o valor já convertido — quem chama não precisa saber qual
// controle está na tela.
function controleDeValor (valorInicial) {
  const tipoInicial = tipoDoValor(valorInicial)
  const tipoSelect = el('select', {}, TIPOS.map((t) => el('option', { value: t.id, text: t.rotulo, selected: t.id === tipoInicial })))

  const campoTexto = el('input', { type: 'text', value: tipoInicial === 'boolean' ? '' : valorParaCampo(valorInicial ?? '') })
  const campoSimNao = el('select', {}, [
    el('option', { value: 'sim', text: 'Sim', selected: valorInicial === true }),
    el('option', { value: 'não', text: 'Não', selected: valorInicial !== true })
  ])

  function aplicarTipo () {
    const tipo = tipoSelect.value
    campoTexto.hidden = tipo === 'boolean'
    campoSimNao.hidden = tipo !== 'boolean'
    campoTexto.type = tipo === 'number' ? 'number' : 'text'
    campoTexto.step = tipo === 'number' ? 'any' : ''
    campoTexto.placeholder = tipo === 'number' ? 'ex: 0' : 'ex: premium'
  }
  tipoSelect.addEventListener('change', aplicarTipo)
  aplicarTipo()

  return {
    tipoSelect,
    campos: el('div', { className: 'valor-campos' }, [campoTexto, campoSimNao]),
    ler: () => converterParaTipo(tipoSelect.value === 'boolean' ? campoSimNao.value : campoTexto.value, tipoSelect.value)
  }
}

function attributeRow (kind, id, attribute, onChanged) {
  const valor = controleDeValor(attribute.value)
  const saveBtn = button('Salvar', { variant: 'quiet', onClick: async (event) => {
    const control = event.currentTarget
    const convertido = valor.ler()
    // Erro de conversão é da pessoa, não do servidor: avisa aqui e nem manda
    // a requisição, para não gravar um contador que nunca poderá ser somado.
    if (!convertido.ok) return notify(convertido.erro, 'danger')
    setBusy(control, true, 'Salvando…')
    try {
      await api.entities.set(kind, id, attribute.key, convertido.valor)
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
      el('span', { className: 'field-help', text: `Agora vale: ${descreverValor(attribute.value)}` }),
      el('div', { className: 'valor-linha' }, [valor.tipoSelect, valor.campos])
    ]),
    el('div', { className: 'button-row' }, [saveBtn, removeBtn])
  ])
}

// O QUE O BOT FAZ NESTA CONVERSA — os interruptores de família.
//
// O pedido do dono: "o menu config deveria escolher quais comandos ou famílias
// de comandos são ativos em cada grupo". Isto mora aqui, e não numa tela nova,
// porque a conversa JÁ está escolhida nesta página e o que se grava é um
// atributo dela — o mesmo lugar onde `grupo_ativo` e `auto_download` vivem.
// Uma tela separada repetiria a busca por contato e grupo inteira.
//
// A MARCA GUARDADA É A DO DESLIGADO. Guardar o ligado seria mais fácil de ler
// e teria um defeito grave: todo comando novo nasceria inerte em toda conversa
// até alguém ir ligar, uma por uma.
//
// E isto NÃO é o `grupo_ativo`: aquele diz se o bot existe no grupo; estes
// dizem o que ele faz onde já existe. São perguntas diferentes e continuam
// separadas.
const CHAVE_FAMILIAS = 'familias_desligadas'
const CHAVE_COMANDOS = 'comandos_desligados'

function painelDeFamilias (kind, entity) {
  const area = el('div', { className: 'stack-sm' }, [el('p', { className: 'muted compact', text: 'Carregando comandos…' })])

  const lerLista = (atributos, chave) => {
    const bruto = atributos.find((a) => a.key === chave)?.value
    if (Array.isArray(bruto)) return bruto.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
    if (typeof bruto === 'string') return bruto.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
    return []
  }

  const montar = async () => {
    let familias, semFamilia, atributos
    try {
      const [catalogo, lista] = await Promise.all([
        api.automations.families(),
        api.entities.list(kind, entity.id)
      ])
      familias = catalogo?.familias || []
      semFamilia = catalogo?.semFamilia || []
      atributos = lista || []
    } catch (erro) {
      area.replaceChildren(el('p', { className: 'muted compact', text: `Não consegui carregar: ${erro.message}` }))
      return
    }

    const desligadas = lerLista(atributos, CHAVE_FAMILIAS)
    const desligados = lerLista(atributos, CHAVE_COMANDOS)

    const gravar = async (chave, valores, controle) => {
      setBusy(controle, true, 'Salvando…')
      try {
        await api.entities.set(kind, entity.id, chave, valores)
        notify('Pronto.')
        await montar()
      } catch (erro) {
        notify(erro.message, 'danger')
        setBusy(controle, false)
      }
    }

    const linhaDeFamilia = ({ familia, comandos }) => {
      const ligada = !desligadas.includes(familia.trim().toLowerCase())
      const alternar = el('input', { type: 'checkbox', checked: ligada })
      alternar.addEventListener('change', () => {
        const chave = familia.trim().toLowerCase()
        const novas = alternar.checked
          ? desligadas.filter((f) => f !== chave)
          : [...new Set([...desligadas, chave])]
        gravar(CHAVE_FAMILIAS, novas, alternar)
      })
      return el('div', { className: 'row-between compact' }, [
        el('div', {}, [
          el('strong', { text: familia }),
          el('p', { className: 'muted compact', text: comandos.map((c) => c.comando || c.nome).join(' · ') })
        ]),
        el('label', { className: 'switch' }, [alternar, el('span', { text: ligada ? 'ligada' : 'desligada' })])
      ])
    }

    const linhaDeComando = (item) => {
      const ligado = !desligados.includes(String(item.automationId).toLowerCase())
      const alternar = el('input', { type: 'checkbox', checked: ligado })
      alternar.addEventListener('change', () => {
        const chave = String(item.automationId).toLowerCase()
        const novos = alternar.checked
          ? desligados.filter((c) => c !== chave)
          : [...new Set([...desligados, chave])]
        gravar(CHAVE_COMANDOS, novos, alternar)
      })
      return el('div', { className: 'row-between compact' }, [
        el('div', {}, [
          el('strong', { text: item.nome }),
          el('p', { className: 'muted compact', text: item.comando || item.automationId })
        ]),
        el('label', { className: 'switch' }, [alternar, el('span', { text: ligado ? 'ligado' : 'desligado' })])
      ])
    }

    area.replaceChildren(
      familias.length
        ? el('div', { className: 'stack-sm' }, familias.map(linhaDeFamilia))
        : el('p', { className: 'muted compact', text: 'Nenhum comando publicado declara família ainda. A família vem da categoria do template na instalação, e dá para trocar escrevendo "família:" no texto do comando.' }),
      semFamilia.length
        ? el('details', {}, [
          el('summary', { text: `Comandos sem família (${semFamilia.length})` }),
          el('div', { className: 'stack-sm' }, semFamilia.map(linhaDeComando))
        ])
        : null
    )
  }

  montar()

  return el('section', { className: 'panel stack' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: 'O que o bot faz aqui' }),
        el('p', { text: 'Desligue uma família inteira ou um comando só, nesta conversa. O menu desta conversa passa a não listar o que estiver desligado.' })
      ])
    ]),
    el('p', { className: 'field-help', text: kind === 'group'
      ? 'Em grupo, comando desligado fica MUDO — não responde nada. É diferente de "ativar o bot neste grupo", que decide se ele existe aqui.'
      : 'No privado, comando desligado responde dizendo que está desligado, em vez de ficar mudo — assim ninguém fica achando que o bot quebrou.' }),
    area
  ])
}

// O MENU NESTA CONVERSA: ver e apagar. Mudar é pelo comando `configura menu`.
//
// Ver serve para conferir o resultado do comando sem mandar /menu na conversa
// (num grupo, isso publicaria o menu para todo mundo). Apagar serve sobretudo
// para conversa onde o comando não roda mais — o bot saiu do grupo, o id foi
// digitado errado —, porque a chave do menu é reservada e a lista de
// variáveis abaixo não a apaga.
function painelDoMenu (kind, entity) {
  const area = el('div', { className: 'stack-sm' }, [el('p', { className: 'muted compact', text: 'Carregando menu…' })])
  const chatKind = kind === 'group' ? 'group' : 'direct'

  const nivel = nivelDoTipo(chatKind)

  const lista = (linhas) => el('div', { className: 'stack-sm' }, linhas.map((linha) =>
    el('div', { className: 'row-between compact' }, [
      el('span', { text: linha.rotulo }),
      el('span', {}, [
        el('strong', { text: linha.valor }),
        linha.origem ? el('span', { className: 'muted', text: ` (${linha.origem})` }) : null
      ])
    ])))

  const montar = async () => {
    let efetivo
    try {
      efetivo = await api.menuConfig.effective(entity.id, chatKind)
    } catch (erro) {
      area.replaceChildren(el('p', { className: 'muted compact', text: `Não consegui carregar: ${erro.message}` }))
      return
    }
    const propria = linhasDoMenu(efetivo?.propria)
    const doTipo = linhasDoMenu(efetivo?.padraoDoTipo)
    // Só os menus que RESPONDEM aqui: a rota já tira os de escopo de outra
    // conversa e os desligados nesta.
    const menus = Array.isArray(efetivo?.menus) ? efetivo.menus : []

    const apagarPadrao = button(`Apagar o ${nivel.nome.toLowerCase()}`, { variant: 'danger', onClick: async (event) => {
      if (!window.confirm(`Apagar o ${nivel.nome.toLowerCase()}? Isso muda o menu em ${nivel.curto}, não só nesta conversa.`)) return
      const controle = event.currentTarget
      setBusy(controle, true, 'Apagando…')
      try {
        await api.menuConfig.removeDefault(nivel.kind)
        notify(`Pronto. O ${nivel.nome.toLowerCase()} foi apagado.`)
        await montar()
      } catch (erro) {
        notify(erro.message, 'danger')
        setBusy(controle, false)
      }
    } })

    const apagar = button('Apagar a configuração desta conversa', { variant: 'danger', onClick: async (event) => {
      if (!window.confirm('Apagar a configuração do menu desta conversa? Ela volta a seguir o padrão.')) return
      const controle = event.currentTarget
      setBusy(controle, true, 'Apagando…')
      try {
        await api.menuConfig.removeOwn(kind === 'group' ? 'group' : 'contact', entity.id)
        notify('Pronto. O menu desta conversa voltou ao padrão.')
        await montar()
      } catch (erro) {
        notify(erro.message, 'danger')
        setBusy(controle, false)
      }
    } })

    area.replaceChildren(...[
      el('h3', { text: 'Configuração própria' }),
      propria.length
        ? el('div', { className: 'stack-sm' }, [lista(propria), el('div', { className: 'button-row' }, apagar)])
        : el('p', { className: 'muted compact', text: 'Nenhuma. Esta conversa segue o padrão.' }),
      el('h3', { text: nivel.nome }),
      doTipo.length
        ? el('div', { className: 'stack-sm' }, [lista(doTipo), el('div', { className: 'button-row' }, apagarPadrao)])
        : el('p', { className: 'muted compact', text: 'Nada configurado neste nível.' }),
      efetivo?.grupoAtivo === false
        ? el('p', { className: 'field-help', text: 'O bot não está ativo neste grupo, então o menu não responde aqui até o grupo ser ativado.' })
        : null,
      menus.length
        ? null
        : el('p', { className: 'muted compact', text: 'Nenhum comando de menu responde nesta conversa: ou não há nenhum publicado, ou o "onde" dele não inclui esta conversa, ou ele está desligado aqui.' }),
      ...menus.map((menu) => el('div', { className: 'stack-sm' }, [
        el('h3', { text: `Como sai aqui: ${menu.name}` }),
        lista(linhasDoMenu(menu.config, { propria: efetivo?.propria, padraoDoTipo: efetivo?.padraoDoTipo, doDocumento: menu.doDocumento, chatKind })),
        semFamiliasConfiguradas(menu.config) ? el('p', { className: 'muted compact', text: 'Famílias: todas.' }) : null
      ]))
    ].filter(Boolean))
  }

  montar()

  return el('section', { className: 'panel stack' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Menu nesta conversa' }),
        el('p', { text: 'O menu que vale aqui, já juntando a configuração desta conversa, o padrão do tipo de conversa e o que o comando de menu define.' })
      ])
    ]),
    el('p', { className: 'field-help', text: `Para mudar, use o comando de configurar menu no WhatsApp (template "Configurar menu"). Aqui dá para ver de onde vem cada parte do menu e para apagar a configuração própria desta conversa ou o padrão de ${nivel.curto}.` }),
    area
  ])
}

function entityPanel (kind, entity) {
  const attributesArea = el('div', { className: 'stack' })
  const newKeyInput = el('input', { type: 'text', placeholder: 'ex: vip' })
  const novoValor = controleDeValor('')
  const addBtn = button('Adicionar variável', { variant: 'primary', onClick: async (event) => {
    const key = newKeyInput.value.trim()
    if (!key) return notify('Informe um nome pra variável.', 'danger')
    const convertido = novoValor.ler()
    if (!convertido.ok) return notify(convertido.erro, 'danger')
    const control = event.currentTarget
    setBusy(control, true, 'Adicionando…')
    try {
      await api.entities.set(kind, entity.id, key, convertido.valor)
      newKeyInput.value = ''
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
    el('p', { className: 'field-help', text: 'Estas variáveis valem para este contato ou grupo em qualquer automação e em qualquer número — não são por instância. Nos comandos, use {{var.chat.<nome>}}.' }),
    attributesArea,
    el('div', { className: 'form-grid' }, [
      field('Nova variável — nome', newKeyInput, 'Sem espaços; use letras/números/hífen.'),
      field('Tipo', novoValor.tipoSelect, 'Escolha "Número" para criar um contador — só assim o sistema consegue somar nele depois.'),
      field('Valor inicial', novoValor.campos, 'Onde a variável começa. Um contador normalmente começa em 0.')
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

  // Os painéis de uma conversa: o que o bot FAZ aqui, o menu dela e as
  // variáveis. O primeiro vem antes porque é a pergunta mais frequente —
  // "por que o bot não responde neste grupo?".
  const abrirConversa = (kind, item) => panelArea.replaceChildren(
    painelDeFamilias(kind, item),
    painelDoMenu(kind, item),
    entityPanel(kind, item)
  )

  // Conversa que não aparece na busca (o bot saiu do grupo, contato fora da
  // agenda) ainda pode ter dados guardados — por exemplo uma configuração de
  // menu feita pelo comando com "outra conversa". Pelo número ou id dá para
  // abrir e apagar.
  const idInput = el('input', { type: 'text', placeholder: 'ex: 5511999999999 ou 1203630000@g.us' })
  const abrirPeloId = button('Abrir', { onClick: () => {
    const conversa = conversaPeloId(idInput.value)
    if (!conversa) return notify('Escreva um número com DDD ou um id terminado em @g.us, @s.whatsapp.net ou @lid.', 'danger')
    abrirConversa(conversa.kind, { id: conversa.id, label: conversa.id })
  } })

  async function search () {
    if (!instanceSelect.value) return resultsArea.replaceChildren(el('p', { className: 'muted', text: 'Escolha uma instância com diretório disponível.' }))
    resultsArea.replaceChildren(el('p', { className: 'muted', text: 'Buscando…' }))
    try {
      const result = await api.instances.directory(instanceSelect.value, { kind: kindSelect.value, q: searchInput.value.trim(), limit: 30 })
      if (!result.items.length) return resultsArea.replaceChildren(el('p', { className: 'muted', text: 'Nenhum resultado encontrado.' }))
      resultsArea.replaceChildren(...result.items.map((item) => button(`${item.label} · ${item.id}`, {
        variant: 'result',
        onClick: () => abrirConversa(kindSelect.value, item)
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
      resultsArea,
      field('Ou abra pelo número ou id', idInput, 'Para conversa que não aparece na busca, como um grupo de onde o bot já saiu.'),
      el('div', { className: 'button-row' }, abrirPeloId)
    ]),
    panelArea
  ])
}
