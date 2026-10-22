// POOLS — quais números respondem por um comando.
//
// Esta tela faltava, e a falta travava a porta de entrada inteira: TODO
// template do catálogo exige um `poolId`, e não havia como criar um pool pelo
// painel. Quem aluga o sistema abria o catálogo, escolhia um comando, chegava
// no campo "Pool que responde" e parava ali. As rotas estavam mapeadas no BFF
// desde sempre; o cliente do navegador tinha só `list` e `create`, e nenhuma
// página chamava nem o `create`.
//
// O QUE UM POOL É, em uma frase: o conjunto de números que pode atender um
// comando. Com um número só, é só uma formalidade. Com vários, o motor
// escolhe entre eles — e o peso diz quanto cada um puxa.
import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, notify, setBusy, setPageHeader } from '../ui.js'

// O prefixo `__` é do sistema (`__native__` e afins). Oferecer esses nomes
// seria entregar o reservado de bandeja, e o motor recusa depois — com um erro
// que não explica que o problema era o nome.
const ehReservado = (id) => String(id || '').startsWith('__')

export async function renderPools ({ refresh }) {
  setPageHeader({
    eyebrow: 'Quem atende',
    title: 'Pools de números',
    description: 'O conjunto de números que pode responder por um comando. Todo comando do catálogo pede um — é aqui que ele nasce.',
    actions: [button('Atualizar', { onClick: () => refresh?.() })]
  })

  let pools = []
  let instancias = []
  try {
    [pools, instancias] = await Promise.all([
      api.pools.list(),
      // A lista de números é o que torna "adicionar membro" possível sem
      // decorar id nenhum. Se ela falhar, o resto da tela continua útil.
      api.instances.list().catch(() => [])
    ])
  } catch (erro) {
    return errorState('Não consegui carregar os pools.', erro.message)
  }

  const aviso = el('div', {})
  const limpar = () => aviso.replaceChildren()
  const mostrarErro = (titulo, mensagem) => aviso.replaceChildren(
    el('div', { className: 'notice notice-danger' }, [
      el('strong', { text: titulo }),
      el('p', { text: mensagem })
    ])
  )
  const fazer = async (controle, acao, sucesso) => {
    limpar()
    setBusy(controle, true)
    try {
      await acao()
      notify(sucesso)
      await refresh?.()
    } catch (erro) {
      mostrarErro('Não consegui', erro.message)
    } finally {
      setBusy(controle, false)
    }
  }

  // --- criar --------------------------------------------------------------
  const campoId = el('input', { type: 'text', className: 'input', placeholder: 'principal', autocomplete: 'off' })
  const campoRotulo = el('input', { type: 'text', className: 'input', placeholder: 'Números principais', autocomplete: 'off' })

  const criar = button('Criar pool', {
    variant: 'primary',
    onClick: () => {
      const id = campoId.value.trim()
      const label = campoRotulo.value.trim() || id
      if (!id) return mostrarErro('Falta o identificador', 'Escreva um identificador curto, sem espaço — é o que vai no campo "Pool que responde" dos comandos.')
      if (ehReservado(id)) return mostrarErro('Identificador reservado', 'Nomes começando com "__" são do sistema. Escolha outro.')
      return fazer(criar, async () => {
        await api.pools.create({ id, label })
        campoId.value = ''
        campoRotulo.value = ''
      }, `Pool "${id}" criado.`)
    }
  })

  const formulario = el('section', { className: 'card stack' }, [
    el('h2', { text: 'Criar um pool' }),
    el('div', { className: 'form-grid' }, [
      field('Identificador', campoId, 'Curto e sem espaço. É este texto que você escreve no campo "Pool que responde" ao instalar um comando.'),
      field('Nome', campoRotulo, 'Para você reconhecer na lista. Vazio usa o identificador.')
    ]),
    el('div', { className: 'button-row' }, [criar])
  ])

  // --- um pool ------------------------------------------------------------
  const cartaoDePool = (pool) => {
    const membros = pool.members || []
    // POOL RESERVADO NÃO SE MEXE AQUI.
    //
    // `__native__` atende as automações nativas do próprio sistema. Apagá-lo,
    // ou pôr um número nele, muda o comportamento do motor por baixo de quem
    // não pediu isso — e a tela estava oferecendo os dois botões como se
    // fossem um pool comum. Ele continua VISÍVEL, porque um comando pode
    // apontar para ele e sumir da lista seria pior; só não é editável.
    if (ehReservado(pool.id)) {
      return el('section', { className: 'card stack' }, [
        el('div', { className: 'row-between' }, [
          el('div', {}, [
            el('h3', { text: pool.label || pool.id }),
            el('code', { className: 'muted', text: pool.id })
          ]),
          badge('do sistema', 'neutral')
        ]),
        el('p', { className: 'muted compact', text: 'Reservado para as automações nativas. Não se edita por aqui.' })
      ])
    }
    const jaMembros = new Set(membros.map((m) => m.instanceId))
    const disponiveis = instancias.filter((i) => !jaMembros.has(i.instanceId))

    const linhaDeMembro = (membro) => {
      const instancia = instancias.find((i) => i.instanceId === membro.instanceId)
      const tirar = button('Tirar', {
        onClick: () => fazer(tirar, () => api.pools.removeMember(pool.id, membro.instanceId), `${membro.instanceId} saiu do pool.`)
      })
      return el('div', { className: 'row-between compact' }, [
        el('div', {}, [
          el('strong', { text: instancia?.label || membro.instanceId }),
          el('p', { className: 'muted compact', text: `${membro.instanceId} · peso ${membro.weight}${membro.enabled ? '' : ' · desligado'}` })
        ]),
        tirar
      ])
    }

    const apagar = button('Apagar pool', {
      onClick: () => fazer(apagar, () => api.pools.remove(pool.id), `Pool "${pool.id}" apagado.`)
    })

    // NÚMERO DESCOBERTO NÃO VIRA MEMBRO.
    //
    // O motor exige que o número esteja na tabela `instances` para entrar num
    // pool, e os números do modo simples (`bare`, `simples:*`) são
    // DESCOBERTOS: existem como pasta mais processo, sem linha lá. Tentar
    // devolve "Instância não encontrada: bare" — um erro que não explica que o
    // problema é a natureza do número, não o número.
    //
    // E há um fato maior, que a tela tem de dizer em vez de esconder:
    // `pool_members` não é lido por NINGUÉM no caminho de entrega. Procurei:
    // só a própria rota de CRUD o consulta. Hoje o pool é um NOME que precisa
    // existir para a publicação passar — a validação confere a existência do
    // pool, nunca os membros. Oferecer "pôr um número" como se mudasse o
    // atendimento seria prometer um comportamento que não existe.
    const podemSerMembros = disponiveis.filter((i) => i.isBare !== true)
    if (!podemSerMembros.length) {
      return el('section', { className: 'card stack' }, [
        el('div', { className: 'row-between' }, [
          el('div', {}, [
            el('h3', { text: pool.label || pool.id }),
            el('code', { className: 'muted', text: pool.id })
          ]),
          badge(membros.length ? `${membros.length} número${membros.length === 1 ? '' : 's'}` : 'pronto para usar', membros.length ? 'success' : 'info')
        ]),
        membros.length ? el('div', { className: 'stack-sm' }, membros.map(linhaDeMembro)) : null,
        el('p', { className: 'muted compact', text: 'Este pool já serve: escreva "' + pool.id + '" no campo "Pool que responde" ao instalar um comando. Pôr números dentro dele só vale no modo multi-número, que esta instalação não usa — e, hoje, a lista de membros não decide quem atende.' }),
        el('div', { className: 'button-row' }, [apagar])
      ])
    }

    const seletor = el('select', { className: 'input' }, [
      el('option', { value: '', text: podemSerMembros.length ? 'Escolha um número…' : 'Todos os números já estão neste pool' }),
      ...podemSerMembros.map((i) => el('option', { value: i.instanceId, text: `${i.label || i.instanceId}` }))
    ])
    const campoPeso = el('input', { type: 'number', className: 'input', value: '1', min: '1', step: '1' })

    const adicionar = button('Pôr no pool', {
      onClick: () => {
        const instanceId = seletor.value
        if (!instanceId) return mostrarErro('Escolha um número', 'Selecione qual número passa a atender por este pool.')
        const weight = Number(campoPeso.value)
        if (!Number.isFinite(weight) || weight <= 0) return mostrarErro('Peso inválido', 'O peso é um número maior que zero. Com dois números de peso 1 e 2, o segundo atende o dobro.')
        return fazer(adicionar, () => api.pools.saveMember(pool.id, instanceId, { weight, enabled: true }), `${instanceId} entrou no pool.`)
      }
    })

    return el('section', { className: 'card stack' }, [
      el('div', { className: 'row-between' }, [
        el('div', {}, [
          el('h3', { text: pool.label || pool.id }),
          el('code', { className: 'muted', text: pool.id })
        ]),
        badge(`${membros.length} número${membros.length === 1 ? '' : 's'}`, membros.length ? 'success' : 'warning')
      ]),
      // Pool vazio não é um detalhe estético: comando apontado para ele não
      // tem quem responda, e o silêncio não explica por quê.
      membros.length
        ? el('div', { className: 'stack-sm' }, membros.map(linhaDeMembro))
        : el('p', { className: 'muted compact', text: 'Nenhum número aqui ainda. Um comando apontado para este pool não tem quem responda.' }),
      el('div', { className: 'form-grid' }, [
        field('Pôr um número', seletor),
        field('Peso', campoPeso, 'Quanto este número puxa quando há mais de um. Com 1 e 2, o segundo atende o dobro.')
      ]),
      el('div', { className: 'button-row' }, [adicionar, apagar])
    ])
  }

  const lista = pools.length
    ? el('div', { className: 'stack' }, pools.map(cartaoDePool))
    : emptyState(
      'Nenhum pool ainda',
      'Crie o primeiro abaixo. Sem pool, os comandos do catálogo não têm o que preencher no campo "Pool que responde".'
    )

  return el('div', { className: 'stack-lg' }, [aviso, lista, formulario])
}
