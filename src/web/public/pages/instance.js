import { api, ApiError } from '../api.js'
import { formatBandwidth, formatBytes, parseBandwidth } from '../logic/optimization.js'
import { badge, button, copyText, el, errorState, field, formatDate, notify, setBusy, setPageHeader } from '../ui.js'

function formatUptime (uptimeMs) {
  if (!Number.isFinite(uptimeMs) || uptimeMs < 0) return '—'
  const minutos = Math.floor(uptimeMs / 60000)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas}h ${minutos % 60}min`
  return `${Math.floor(horas / 24)}d ${horas % 24}h`
}

function lifecycleCard (instance, refresh) {
  // Modo simples ("bare") não sabe iniciar do zero por API — precisa do
  // terminal (npm start/node index.js) porque relançar o processo do
  // painel web não é o mesmo binário do bot. Uma vez rodando, pausar/
  // reiniciar já funcionam (ver instanceService.js).
  const acoesDisponiveis = instance.isBare
    ? [['Parar', 'stop', 'danger'], ['Reiniciar', 'restart', 'secondary']]
    : [['Iniciar', 'start', 'primary'], ['Parar', 'stop', 'danger'], ['Reiniciar', 'restart', 'secondary']]
  const actions = acoesDisponiveis.map(([label, action, variant]) => button(label, {
    variant,
    onClick: async (event) => {
      const control = event.currentTarget
      setBusy(control, true, `${label}...`)
      try {
        await api.instances.action(instance.instanceId, action)
        notify(`Ação "${label.toLowerCase()}" enviada para ${instance.label || instance.instanceId}.`)
        await refresh()
      } catch (error) {
        notify(error.message, 'danger')
        setBusy(control, false)
      }
    }
  }))
  return el('section', { className: 'panel' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('h2', { text: 'Ciclo de vida' }), el('p', { text: instance.isBare ? 'Modo simples: pra ligar do zero, use o terminal (npm start ou node index.js).' : 'Controle o serviço desta instância no sistema.' })]),
      badge(instance.unitStatus || 'desconhecido', instance.unitStatus === 'active' || instance.unitStatus === 'rodando' ? 'success' : 'neutral')
    ]),
    el('div', { className: 'button-row' }, actions)
  ])
}

function pairingCard (pairing) {
  const content = el('div', { className: 'stack' })
  if (pairing.connected === true) {
    content.append(el('div', { className: 'notice notice-success' }, [
      el('strong', { text: 'WhatsApp conectado.' }),
      el('p', { text: pairing.phoneNumber ? `Número ativo: ${pairing.phoneNumber}` : 'Esta instância não precisa de pareamento agora.' })
    ]))
  } else if (!pairing.qr && !pairing.pairingCode) {
    content.append(el('div', { className: 'notice notice-warning' }, [
      el('strong', { text: 'Aguardando dados de pareamento.' }),
      el('p', { text: 'Inicie a instância para que ela gere um QR. A geração de um novo código por telefone ainda depende do fluxo de terminal.' })
    ]))
  } else {
    if (pairing.pairingCode) {
      content.append(el('div', { className: 'pairing-block' }, [
        el('div', { className: 'field' }, [el('span', { className: 'field-label', text: 'Código de pareamento' }), el('strong', { className: 'pairing-code', text: pairing.pairingCode })]),
        button('Copiar código', { onClick: async () => { await copyText(pairing.pairingCode); notify('Código copiado.') } }),
        el('small', { className: 'muted', text: `Gerado em ${formatDate(pairing.pairingCodeAt)}` })
      ]))
    }
    if (pairing.qr) {
      content.append(el('div', { className: 'pairing-block' }, [
        el('div', { className: 'field' }, [
          el('span', { className: 'field-label', text: 'Escaneie com o WhatsApp' }),
          el('p', { className: 'field-help', text: 'No celular: WhatsApp > Dispositivos conectados > Conectar dispositivo, e aponte a câmera pra este código.' })
        ]),
        pairing.qrDataUrl
          ? el('img', { src: pairing.qrDataUrl, alt: 'QR de pareamento do WhatsApp', width: '260', height: '260', className: 'qr-image' })
          : el('div', { className: 'notice notice-warning compact' }, [el('p', { text: 'Não foi possível gerar a imagem do QR agora — copie o conteúdo abaixo.' })]),
        el('details', {}, [
          el('summary', { text: 'Ver conteúdo textual do QR' }),
          el('pre', { className: 'compact-json', text: pairing.qr }),
          button('Copiar conteúdo', { variant: 'quiet', onClick: async () => { await copyText(pairing.qr); notify('Conteúdo do QR copiado.') } })
        ]),
        el('small', { className: 'muted', text: `Gerado em ${formatDate(pairing.qrAt)} — o WhatsApp renova este código periodicamente enquanto não conectar.` })
      ]))
    }
  }
  return el('section', { className: 'panel' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('h2', { text: 'Pareamento' }), el('p', { text: 'Consulte o vínculo atual da conta com o WhatsApp.' })]),
      pairing.connected === true ? badge('Conectado', 'success') : badge('Não conectado', 'warning')
    ]),
    content
  ])
}

function optimizationCard (instanceId, optimization) {
  const download = el('input', { type: 'text', value: formatBandwidth(optimization.bandwidthLimit?.downloadBytesPerSecond), placeholder: '500 KB/s' })
  const upload = el('input', { type: 'text', value: formatBandwidth(optimization.bandwidthLimit?.uploadBytesPerSecond), placeholder: 'sem limite' })
  const quarantine = el('input', { type: 'number', min: '1', step: '1', value: optimization.quarantineThreshold })
  const formMessage = el('div')
  const submit = button('Salvar otimização', { variant: 'primary', type: 'submit' })
  const form = el('form', { className: 'stack-lg' }, [
    el('div', { className: 'form-grid' }, [
      field('Limite de download', download, 'Velocidade máxima recebida por esta instância. Exemplos: 500 KB/s, 2 MB/s ou sem limite.'),
      field('Limite de upload', upload, 'Velocidade máxima enviada por esta instância. Use as mesmas unidades ou escreva sem limite.'),
      field('Limiar de quarentena', quarantine, 'Quantas falhas de conexão seguidas até a instância parar de tentar reconectar sozinha.')
    ]),
    el('div', { className: 'readonly-box' }, [
      el('div', {}, [el('span', { text: 'Memória' }), el('strong', { text: optimization.resources?.memory || 'não definida' })]),
      el('div', {}, [el('span', { text: 'CPUs' }), el('strong', { text: optimization.resources?.cpus ?? 'não definidas' })]),
      el('p', { text: 'Estes recursos são somente leitura: mudar isso exige recriar a instância.' })
    ]),
    formMessage,
    el('div', { className: 'button-row' }, submit)
  ])
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    formMessage.replaceChildren()
    try {
      const threshold = Number(quarantine.value)
      if (!Number.isInteger(threshold) || threshold < 1) throw new Error('O limiar de quarentena deve ser um número inteiro a partir de 1.')
      const body = {
        bandwidthLimit: {
          downloadBytesPerSecond: parseBandwidth(download.value),
          uploadBytesPerSecond: parseBandwidth(upload.value)
        },
        quarantineThreshold: threshold
      }
      setBusy(submit, true, 'Salvando…')
      const saved = await api.instances.updateOptimization(instanceId, body)
      download.value = formatBandwidth(saved.bandwidthLimit.downloadBytesPerSecond)
      upload.value = formatBandwidth(saved.bandwidthLimit.uploadBytesPerSecond)
      quarantine.value = saved.quarantineThreshold
      notify('Controles de otimização atualizados.')
    } catch (error) {
      formMessage.replaceChildren(errorState(error))
    } finally {
      setBusy(submit, false)
    }
  })
  return el('section', { className: 'panel panel-accent' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('h2', { text: 'Otimização e proteção' }), el('p', { text: 'Limite o consumo de rede e evite ciclos infinitos de reconexão.' })])
    ]),
    form
  ])
}

// Painel de recursos (Parte C, Módulo 6) — leitura do uso REAL desta
// instância, sem moldura de "cota alugada" (aluguel é um recurso à parte,
// ainda não existe). `usage` já vem resolvido (ou como erro) de quem
// chamou — instâncias da Parte A (Podman) ainda não têm suporte real
// (mensagem clara em vez de números inventados, ver instanceService.js).
function usageCard (usage, usageError) {
  if (usageError) {
    return el('section', { className: 'panel' }, [
      el('div', { className: 'panel-heading' }, [
        el('div', {}, [el('h2', { text: 'Uso de recursos' }), el('p', { text: 'Leitura direta do processo desta instância.' })])
      ]),
      el('p', { className: 'muted compact', text: usageError.message || 'Não foi possível ler o uso de recursos desta instância.' })
    ])
  }
  return el('section', { className: 'panel' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('h2', { text: 'Uso de recursos' }), el('p', { text: 'Leitura direta do processo — não é uma cota comprada, só o consumo real agora.' })])
    ]),
    el('div', { className: 'readonly-box' }, [
      el('div', {}, [el('span', { text: 'Memória (RSS)' }), el('strong', { text: Number.isFinite(usage.memoryMB) ? `${usage.memoryMB} MB` : '—' })]),
      el('div', {}, [el('span', { text: 'Tempo ligado' }), el('strong', { text: formatUptime(usage.uptimeMs) })]),
      el('div', {}, [el('span', { text: 'Baixado (total)' }), el('strong', { text: formatBytes(usage.bandwidth?.downloadBytesTotal) })]),
      el('div', {}, [el('span', { text: 'Enviado (total)' }), el('strong', { text: formatBytes(usage.bandwidth?.uploadBytesTotal) })]),
      el('div', {}, [el('span', { text: 'Limite de download' }), el('strong', { text: formatBandwidth(usage.bandwidth?.downloadLimitBytesPerSecond) })]),
      el('div', {}, [el('span', { text: 'Limite de upload' }), el('strong', { text: formatBandwidth(usage.bandwidth?.uploadLimitBytesPerSecond) })]),
      el('p', { text: 'Totais acumulados desde o último início do processo — reiniciar a instância zera esses contadores.' })
    ])
  ])
}

// Logs carregados sob demanda (nunca no carregamento da página) — evita
// atraso na abertura da tela e, pra instâncias Parte A, adia o eventual
// erro de `podman logs` até quem realmente pediu ver o log.
function logsCard (instanceId) {
  const output = el('pre', { className: 'log-output', text: 'Clique em "Carregar logs" pra ver as últimas linhas.' })
  const loadBtn = button('Carregar logs', { onClick: async (event) => {
    const control = event.currentTarget
    setBusy(control, true, 'Carregando…')
    try {
      const resultado = await api.instances.logs(instanceId, 200)
      output.textContent = resultado.lines.join('\n') || '(sem linhas de log ainda)'
    } catch (error) {
      output.textContent = ''
      output.replaceWith(errorState(error))
    } finally {
      setBusy(control, false)
    }
  } })
  return el('section', { className: 'panel' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('h2', { text: 'Logs do sistema' }), el('p', { text: 'Últimas linhas registradas por esta instância.' })]),
      loadBtn
    ]),
    output
  ])
}

// Só uma instância de página fica visível por vez — um módulo-level timer
// simples basta, contanto que toda entrada nesta página limpe o anterior E
// o próprio timer se auto-cancele ao perceber que o usuário navegou pra
// outro lugar (o roteador deste painel não tem hook de "desmontar").
let pollTimer = null

export async function renderInstance ({ params, navigate, refresh }) {
  if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null }
  const id = params.id
  const [instance, pairing, optimization, usageResult] = await Promise.all([
    api.instances.get(id),
    api.instances.pairing(id),
    api.instances.optimization(id),
    api.instances.usage(id).then((usage) => ({ usage })).catch((error) => ({ error }))
  ])
  setPageHeader({
    eyebrow: instance.instanceId,
    title: instance.label || instance.instanceId,
    description: 'Pareamento, ciclo de vida e limites operacionais desta instância.',
    actions: [button('← Voltar', { onClick: () => navigate('/') }), button('Atualizar', { onClick: refresh })]
  })

  // Enquanto não conectar, atualiza sozinho — pega a conexão automaticamente
  // assim que o QR for escaneado, sem precisar ficar clicando em Atualizar.
  if (pairing.connected !== true) {
    const caminhoEsperado = `/instances/${encodeURIComponent(id)}`
    pollTimer = window.setInterval(() => {
      if (window.location.pathname !== caminhoEsperado) {
        window.clearInterval(pollTimer)
        pollTimer = null
        return
      }
      refresh()
    }, 4000)
  }

  return el('div', { className: 'stack-lg' }, [
    el('div', { className: 'summary-strip' }, [
      el('div', {}, [el('span', { text: 'Conexão' }), pairing.connected ? badge('Conectado', 'success') : badge('Desconectado', 'danger')]),
      el('div', {}, [el('span', { text: 'Telefone' }), el('strong', { text: instance.phoneNumber || instance.expectedPhoneE164 || '—' })]),
      el('div', {}, [el('span', { text: 'Serviço' }), el('strong', { text: instance.unitStatus || '—' })]),
      el('div', {}, [el('span', { text: 'Criada em' }), el('strong', { text: formatDate(instance.createdAt) })])
    ]),
    el('div', { className: 'two-columns' }, [lifecycleCard(instance, refresh), pairingCard(pairing)]),
    optimizationCard(id, optimization),
    usageCard(usageResult.usage, usageResult.error),
    logsCard(id)
  ])
}
