import { api } from '../api.js'
import { badge, button, el, emptyState, field, notify, setBusy, setPageHeader } from '../ui.js'

const ROTULOS_SAUDE = {
  saudavel: 'Saudável',
  ok: 'Saudável',
  degradada: 'Degradada',
  atencao: 'Atenção',
  desconhecida: 'Desconhecida'
}

function connectedBadge (connected) {
  if (connected === true) return badge('Conectado', 'success')
  if (connected === false) return badge('Desconectado', 'danger')
  // Nem o status do serviço se sabe. Dizer "desconectado" aqui seria afirmar
  // o que não se sabe, que é o mesmo erro do "Conectado" de antes, invertido.
  return badge('Sem informação', 'neutral')
}

// Quando o registro foi escrito. Com o serviço parado é o que data o "último
// número visto" — sem isso, a pessoa não sabe se foi há um minuto ou em março.
function desdeQuando (ms) {
  if (!Number.isFinite(ms)) return null
  const minutos = Math.floor((Date.now() - ms) / 60000)
  if (minutos < 1) return 'agora há pouco'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  return `há ${Math.floor(horas / 24)} dia(s)`
}

function healthBadge (health) {
  const value = typeof health === 'string' ? health : health?.status
  const label = ROTULOS_SAUDE[value] || value || 'Desconhecida'
  if (value === 'saudavel' || value === 'ok') return badge(label, 'success')
  if (value === 'degradada' || value === 'atencao') return badge(label, 'warning')
  if (value && value !== 'desconhecida') return badge(label, 'danger')
  return badge('Desconhecida', 'neutral')
}

function instanceCard (instance, navigate) {
  return el('article', { className: 'instance-card' }, [
    el('div', { className: 'instance-card-head' }, [
      el('div', {}, [
        el('p', { className: 'mono overline', text: instance.isBare ? 'modo simples' : instance.instanceId }),
        el('h2', { text: instance.label || instance.instanceId })
      ]),
      connectedBadge(instance.connected)
    ]),
    el('dl', { className: 'metrics-grid' }, [
      el('div', {}, [el('dt', { text: 'Serviço' }), el('dd', { text: instance.unitStatus || '—' })]),
      el('div', {}, [el('dt', { text: 'Saúde' }), el('dd', {}, healthBadge(instance.health))]),
      // O RÓTULO MUDA COM A VERDADE. Com o serviço parado, o número que está
      // guardado é o ÚLTIMO VISTO — não é "o número conectado". Chamar os dois
      // de "Número" fazia a tela parecer dizer que havia sessão ali.
      el('div', {}, [
        el('dt', { text: instance.connected === true ? 'Número' : 'Último número visto' }),
        el('dd', { text: instance.phoneNumber || instance.expectedPhoneE164 || '—' })
      ])
    ]),
    instance.connected === true || !desdeQuando(instance.estadoEm)
      ? null
      : el('p', { className: 'muted compact', text: `Último registro ${desdeQuando(instance.estadoEm)}.` }),
    el('div', { className: 'instance-card-foot button-row' }, [
      // Conectar é a ação principal de um número desconectado, e ficava
      // escondida atrás de "Abrir detalhes": quem acabou de instalar não tem
      // como adivinhar que o QR mora lá dentro.
      instance.connected === true
        ? null
        : button('Conectar', {
          variant: 'primary',
          onClick: async (evento) => {
            const controle = evento.currentTarget
            setBusy(controle, true, 'Ligando…')
            try {
              // Ligar é o que faz o WhatsApp emitir o QR. Se já estiver de pé,
              // seguimos direto para a tela que mostra o código.
              await api.instances.action(instance.instanceId, 'start').catch((erro) => {
                if (!/já está rodando/i.test(erro.message || '')) throw erro
              })
              navigate(`/instances/${encodeURIComponent(instance.instanceId)}?conectar=1`)
            } catch (erro) {
              notify(erro.message, 'danger')
              setBusy(controle, false)
            }
          }
        }),
      button('Abrir detalhes', { onClick: () => navigate(`/instances/${encodeURIComponent(instance.instanceId)}`) })
    ].filter(Boolean))
  ])
}

export async function renderDashboard ({ navigate, refresh }) {
  setPageHeader({
    eyebrow: 'Visão geral',
    title: 'Instâncias',
    description: 'Acompanhe seus números, o serviço de cada instância e o estado da conexão.',
    actions: [button('Novo número', { variant: 'primary', onClick: () => abrirCriacao() }), button('Atualizar', { onClick: refresh })]
  })

  // ADICIONAR UM NÚMERO SEM TERMINAL.
  //
  // Era a última coisa que só a linha de comando fazia
  // (`LCN_INSTANCIA=pessoal node index.js`), e quem aluga o sistema não tem
  // terminal nenhum. O formulário abre no topo da própria lista: criar um
  // número é o começo de tudo, não um detalhe escondido atrás de um menu.
  function abrirCriacao () {
    const existente = document.getElementById('criar-numero')
    if (existente) { existente.querySelector('input')?.focus(); return }

    const nome = el('input', { type: 'text', placeholder: 'pessoal', required: true, maxlength: '40' })
    const caixa = el('div', { className: 'notice', id: 'criar-numero' }, [
      el('strong', { text: 'Novo número' }),
      field('Nome', nome,
        'Letras, números, ponto, hífen e _ — ele vira o nome de uma pasta, então nada de espaço, barra ou acento. É só uma etiqueta interna: o número de telefone vem do pareamento.'),
      el('p', { className: 'muted compact', text: 'O número nasce parado. Depois de criar, use "Conectar" para ler o QR.' }),
      el('div', { className: 'button-row' }, [
        button('Criar', {
          variant: 'primary',
          onClick: async (evento) => {
            const controle = evento.currentTarget
            setBusy(controle, true, 'Criando…')
            try {
              const criada = await api.instances.criar(nome.value.trim())
              notify(`Número "${criada.instanceId}" criado. Ligue e conecte para parear.`)
              await refresh()
            } catch (erro) {
              notify(erro.message, 'danger')
              setBusy(controle, false)
            }
          }
        }),
        button('Cancelar', { onClick: () => caixa.remove() })
      ])
    ])
    document.getElementById('page')?.querySelector('.stack-lg')?.prepend(caixa)
    nome.focus()
  }

  const [instances, healthResult] = await Promise.all([
    api.instances.list(),
    api.health().catch((error) => ({ web: 'down', engine: 'down', reason: error.message }))
  ])
  const root = el('div', { className: 'stack-lg' })
  const healthTone = healthResult.engine === 'ok' ? 'success' : 'warning'
  root.append(el('div', { className: `notice notice-${healthTone}` }, [
    el('strong', { text: healthResult.engine === 'ok' ? 'Painel e motor estão respondendo.' : 'O painel abriu, mas o motor está indisponível.' }),
    healthResult.reason ? el('p', { text: healthResult.reason }) : null
  ]))

  if (!instances.length) {
    root.append(emptyState('Nenhuma instância cadastrada', 'Crie uma instância pela ferramenta de terminal; ela aparecerá aqui automaticamente.'))
    return root
  }
  const conectadas = instances.filter((instance) => instance.connected === true).length
  root.append(
    el('div', { className: 'section-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Números administrados' }),
        el('p', { text: `${instances.length} ${instances.length === 1 ? 'instância cadastrada' : 'instâncias cadastradas'} · ${conectadas} conectada${conectadas === 1 ? '' : 's'} agora.` })
      ])
    ]),
    el('div', { className: 'card-grid' }, instances.map((instance) => instanceCard(instance, navigate)))
  )
  return root
}
