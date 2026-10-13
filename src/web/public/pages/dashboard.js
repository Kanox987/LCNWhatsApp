import { api } from '../api.js'
import { badge, button, el, emptyState, notify, setBusy, setPageHeader } from '../ui.js'

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
  return badge('Sem informação', 'neutral')
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
      el('div', {}, [el('dt', { text: 'Número' }), el('dd', { text: instance.phoneNumber || instance.expectedPhoneE164 || '—' })])
    ]),
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

// Programas de fora de que o bot depende. Não é decoração: sem o ffmpeg o
// comando de figurinha responde erro, e até agora a única forma de descobrir
// isso era alguém reclamar.
function dependenciaCard (dep) {
  return el('article', { className: 'instance-card' }, [
    el('div', { className: 'instance-card-head' }, [
      el('div', {}, [
        el('p', { className: 'mono overline', text: 'programa externo' }),
        el('h2', { text: dep.nome })
      ]),
      dep.presente ? badge('Instalado', 'success') : badge('Não encontrado', 'warning')
    ]),
    el('dl', { className: 'metrics-grid' }, [
      el('div', {}, [el('dt', { text: 'Versão' }), el('dd', { text: dep.versao || '—' })]),
      el('div', {}, [el('dt', { text: 'Usado por' }), el('dd', { text: dep.usadoPor })])
    ]),
    // Faltar não é alarme: é UM comando que para. Dizer exatamente o que para
    // evita tanto o susto quanto a surpresa depois.
    el('p', { text: dep.presente ? dep.semEla : `${dep.motivo}. ${dep.semEla}` }),
    dep.presente ? null : el('p', { className: 'mono', text: dep.comoInstalar })
  ].filter(Boolean))
}

export async function renderDashboard ({ navigate, refresh }) {
  setPageHeader({
    eyebrow: 'Visão geral',
    title: 'Instâncias',
    description: 'Acompanhe seus números, o serviço de cada instância e o estado da conexão.',
    actions: [button('Atualizar', { onClick: refresh })]
  })

  const [instances, healthResult, dependencias] = await Promise.all([
    api.instances.list(),
    api.health().catch((error) => ({ web: 'down', engine: 'down', reason: error.message })),
    // Falhar a conferência não pode derrubar a tela inteira: lista vazia some
    // da página, e o resto continua.
    api.dependencies().catch(() => [])
  ])
  const root = el('div', { className: 'stack-lg' })
  const healthTone = healthResult.engine === 'ok' ? 'success' : 'warning'
  root.append(el('div', { className: `notice notice-${healthTone}` }, [
    el('strong', { text: healthResult.engine === 'ok' ? 'Painel e motor estão respondendo.' : 'O painel abriu, mas o motor está indisponível.' }),
    healthResult.reason ? el('p', { text: healthResult.reason }) : null
  ]))

  const secaoDependencias = () => {
    if (!dependencias.length) return null
    const faltando = dependencias.filter((d) => !d.presente).length
    return el('div', { className: 'stack-lg' }, [
      el('div', { className: 'section-heading' }, [
        el('div', {}, [
          el('h2', { text: 'Programas externos' }),
          el('p', {
            text: faltando
              ? `${faltando} não ${faltando === 1 ? 'foi encontrado' : 'foram encontrados'} nesta máquina. Não fazem parte do LCN: são instalados no sistema.`
              : 'Programas que não fazem parte do LCN e que alguns comandos usam. Conferido na máquina onde o painel roda.'
          })
        ])
      ]),
      el('div', { className: 'card-grid' }, dependencias.map(dependenciaCard))
    ])
  }

  if (!instances.length) {
    root.append(emptyState('Nenhuma instância cadastrada', 'Crie uma instância pela ferramenta de terminal; ela aparecerá aqui automaticamente.'))
    const deps = secaoDependencias()
    if (deps) root.append(deps)
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
  const deps = secaoDependencias()
  if (deps) root.append(deps)
  return root
}
