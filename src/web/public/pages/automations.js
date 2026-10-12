import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, formatDate, notify, setBusy, setPageHeader } from '../ui.js'
import { criarControleParametro, rotuloTipo, valorParametro } from '../logic/parametros.js'

function statusAutomation (automation) {
  if (!automation.activeRevisionId) return badge('Somente rascunho', 'neutral')
  if (!automation.enabled) return badge('Pausada', 'warning')
  return badge(automation.deploymentMode === 'live' ? 'Ao vivo' : 'Sombra', automation.deploymentMode === 'live' ? 'success' : 'info')
}

// O formulário de configuração de um comando JÁ instalado.
//
// Quem escreveu o comando declarou os campos no bloco `configurável` do .lcn;
// aqui quem usa preenche, sem abrir arquivo nenhum — e pode voltar depois.
//
// O motor decide se o formulário abre. Ele se fecha quando a automação foi
// editada à mão depois de instalada, porque regerar a partir do template
// apagaria essa edição. Fechar dizendo o que divergiu é melhor que abrir e
// apagar em silêncio.
async function painelReconfiguracao (automation, { refresh }) {
  const [info, pools] = await Promise.all([
    api.automations.getReconfigure(automation.id),
    api.pools.list().catch(() => [])
  ])

  if (!info.podeReconfigurar) {
    return el('div', { className: 'notice notice-info' }, [
      el('strong', { text: 'Sem formulário para esta automação.' }),
      el('p', { text: info.motivo || 'O motor não devolveu um motivo.' }),
      info.divergencias?.length
        ? el('p', { className: 'muted compact', text: `Editado à mão: ${info.divergencias.join(', ')}. Use o editor de texto para mudar.` })
        : null
    ].filter(Boolean))
  }

  const controles = new Map()
  const campos = (info.parameters || []).map((definition) => {
    const control = criarControleParametro(definition, pools, definition.value)
    controles.set(definition.key, control)
    return field(definition.label || definition.key, control,
      [definition.help, `Tipo: ${rotuloTipo(definition)}.`].filter(Boolean).join(' '))
  })

  const salvar = button('Salvar configuração', {
    variant: 'primary',
    onClick: async (event) => {
      const control = event.currentTarget
      setBusy(control, true, 'Salvando…')
      try {
        const parameters = {}
        for (const definition of info.parameters || []) {
          parameters[definition.key] = valorParametro(definition, controles.get(definition.key))
        }
        await api.automations.reconfigure(automation.id, parameters)
        notify('Configuração salva e republicada.')
        await refresh()
      } catch (error) {
        notify(error.message, 'danger')
        setBusy(control, false)
      }
    }
  })

  return el('div', { className: 'stack' }, [
    el('p', { className: 'muted compact', text: 'Salvar aplica os valores e republica a automação. O destino escolhido na instalação é preservado.' }),
    el('div', { className: 'form-grid' }, campos),
    el('div', { className: 'button-row' }, [salvar])
  ])
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

    // "Configurar" abre o formulário declarado pelo template, aqui mesmo. Ele
    // carrega sob demanda: a maioria dos cartões nunca é aberta, e buscar a
    // reconfiguração de todos na listagem seria uma consulta por automação a
    // cada vez que a tela abre.
    const areaConfig = el('div', { className: 'stack' })
    let aberto = false
    actions.append(button('Configurar', {
      variant: 'quiet',
      onClick: async (event) => {
        const control = event.currentTarget
        if (aberto) {
          areaConfig.replaceChildren()
          aberto = false
          return
        }
        setBusy(control, true, 'Abrindo…')
        try {
          areaConfig.replaceChildren(await painelReconfiguracao(automation, { refresh }))
          aberto = true
        } catch (error) {
          areaConfig.replaceChildren(errorState({ message: error.message, details: error?.details }))
          aberto = true
        } finally {
          setBusy(control, false)
        }
      }
    }))

    return el('article', { className: 'list-card' }, [
      el('div', { className: 'list-card-main' }, [
        el('div', {}, [el('p', { className: 'mono overline', text: automation.id }), el('h2', { text: name })]),
        statusAutomation(automation)
      ]),
      el('div', { className: 'list-card-meta' }, [
        el('span', { text: automation.activeRevisionId ? `Revisão ativa #${automation.draft?.revision || '—'}` : 'Ainda não publicada' }),
        el('span', { text: `Atualizada em ${formatDate(automation.updatedAt)}` })
      ]),
      actions,
      areaConfig
    ])
  }))
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

  const acoes = [button('← Voltar para a lista', { onClick: () => navigate('/automations') })]

  setPageHeader({
    eyebrow: `Editando ${atual.id}`,
    title: documento?.name || atual.id,
    description: motivo
      ? `Esta automação abre como texto: ${motivo}`
      : 'A automação inteira, na linguagem do projeto. O texto compila para o mesmo grafo que o motor executa.',
    actions: acoes
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
// CRIAR um comando escrevendo a linguagem.
//
// Aqui morava o assistente de seis passos. Ele montava exatamente DOIS nós — um
// comando e uma resposta de texto — e chamava de "resumo" tudo o que não cabia
// nisso. Duas consequências, as duas ruins: quem criava por ali não conseguia
// expressar nada do que o catálogo já faz, e quem abria uma automação de
// verdade via um resumo de duas linhas no lugar da regra.
//
// O esqueleto abaixo não é decoração: começar de uma página em branco numa
// linguagem que a pessoa está conhecendo é o jeito mais rápido de ela desistir.
// Ele nasce sendo um comando que funciona, e é editado a partir daí.
const ESQUELETO = (poolId) => `automação meu-comando
  nome: Meu comando
  tipo: comando
  dispara com: /meucomando
  acessa: texto
  quem: qualquer um
  onde: em qualquer lugar
  pool: ${poolId}
  menu: /meucomando — o que ele faz
  casa: exato

  responde "oi, {{sender.name}}!"
`

async function renderCriador ({ navigate, refresh }) {
  const pools = await api.pools.list().catch(() => [])

  setPageHeader({
    eyebrow: 'Nova automação',
    title: 'Escrever um comando',
    description: 'A automação inteira, na linguagem do projeto. O texto compila para o mesmo grafo auditado que o motor executa — nada aqui vira código solto.',
    actions: [button('← Voltar para a lista', { onClick: () => navigate('/automations') })]
  })

  // O prefixo `__` é do sistema. Oferecer `__native__` como padrão do esqueleto
  // era entregar o reservado de bandeja — a mesma família do __owner__ que o
  // motor passou a recusar, só na direção oposta.
  const oferecidos = pools.filter((p) => !String(p.id).startsWith('__'))
  const area = el('textarea', {
    className: 'lcn-editor',
    rows: '18',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off'
  }, ESQUELETO(oferecidos[0]?.id || 'pool-local'))

  const aviso = el('div', {})
  area.addEventListener('input', () => { aviso.textContent = '' })

  const criar = button('Criar automação', {
    variant: 'primary',
    onClick: async () => {
      aviso.replaceChildren()
      setBusy(criar, true, 'Criando…')
      try {
        const criada = await api.automations.criarLcn(area.value)
        notify(`Automação ${criada.id} criada.`)
        await refresh()
        // Vai direto para a edição: recém-criada, ela ainda é rascunho, e o
        // próximo passo (publicar) mora lá.
        navigate(`/automations?edit=${encodeURIComponent(criada.id)}`)
      } catch (erro) {
        // A linha do erro é o que transforma "não compilou" em algo que a
        // pessoa conserta sozinha.
        const linha = erro?.details?.linha
        if (linha) marcarLinha(area, linha)
        aviso.replaceChildren(el('div', { className: 'notice notice-danger' }, [
          el('strong', { text: linha ? `Erro na linha ${linha}` : 'Não consegui criar.' }),
          el('p', { text: erro.message })
        ]))
        setBusy(criar, false)
      }
    }
  })

  const ajuda = el('section', { className: 'card' }, [
    el('h2', { text: 'O essencial' }),
    el('ul', { className: 'human-summary' }, [
      el('li', { text: 'automação <id>: é por essa linha que a automação passa a existir. Não dá para repetir um id que já existe.' }),
      el('li', { text: 'tipo: "comando" é acordado por alguém digitar; "vigia" fica ligado o tempo todo olhando a conversa (é o que serve para responder "bom dia" ou baixar link sozinho).' }),
      el('li', { text: 'acessa: a que tipos de mensagem ele precisa de acesso. Não é preferência: tipo que não estiver aqui NUNCA chega nele.' }),
      el('li', { text: 'precisa de um link / de uma mídia: o que o comando precisa receber, e onde procurar ("na citada ou na mensagem" — a ordem é a ordem de procura). Com "sem ele"/"sem ela" logo abaixo, dizendo o que responder quando falta. A ação então escreve só "url: o link".' }),
      el('li', { text: 'onde: diz onde o comando pode valer. Deixar de fora não significa "em todo lugar" — significa que não casa com ninguém.' }),
      el('li', { text: `pool: qual conjunto de números responde.${oferecidos.length ? ' Disponíveis: ' + oferecidos.map((p) => p.id).join(', ') : ' Nenhum pool cadastrado ainda.'}` }),
      el('li', { text: 'A automação nasce como rascunho. Ela só responde no WhatsApp depois de publicada.' })
    ])
  ])

  return el('section', { className: 'stack-lg' }, [
    el('section', { className: 'card stack' }, [area, aviso, el('div', { className: 'button-row' }, [criar])]),
    ajuda
  ])
}
export async function renderAutomations (context) {
  // A LINGUAGEM É A FORMA PRINCIPAL, não o plano B.
  //
  // Antes era ao contrário: editar abria o assistente, e o texto só aparecia
  // quando o assistente não dava conta. Como o assistente conhece uma forma só
  // (um comando que responde um texto), TODAS as automações reais caíam no
  // "plano B" — e quem olhava via um resumo de duas linhas no lugar da regra.
  //
  // Agora criar e editar são a mesma coisa: o texto, que representa qualquer
  // automação que o motor executa (há teste cruzando as 12 ações contra o
  // vocabulário, nos dois sentidos).
  if (context.query.has('new')) return renderCriador(context)
  if (context.query.has('edit')) return renderEdicao(context)
  return renderList(context)
}

// Editar uma automação existente: texto sempre; o assistente fica oferecido
// quando ele consegue representar aquela automação sem perder nada.
async function renderEdicao ({ query, navigate, refresh }) {
  const atual = await api.automations.get(query.get('edit'))
  return renderEditorDeTexto({ atual, motivo: null, navigate, refresh })
}
