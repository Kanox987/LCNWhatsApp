// Acervo de arquivos — a tela do que o dono sobe uma vez e usa em qualquer
// comando: foto de produto, áudio de boas-vindas, PDF de cardápio.
//
// A decisão de desenho que manda aqui: acervo sem miniatura não é acervo.
// Uma lista de nomes obriga a pessoa a lembrar qual "produto-2.png" é qual —
// por isso imagem aparece renderizada, áudio toca na própria linha e texto
// pode ser lido sem sair da tela. É a diferença entre um cadastro e um lugar
// onde dá para escolher.
import { api } from '../api.js'
import { badge, button, copyText, el, emptyState, errorState, field, formatDate, notify, setBusy, setPageHeader } from '../ui.js'

const ROTULO_TIPO = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  text: 'Texto pronto'
}

const SIMBOLO_TIPO = { image: '▣', video: '▶', audio: '♪', document: '▤', text: '¶' }

function formatarBytes (bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

// FileReader devolve um data: URL ("data:image/png;base64,AAAA..."); a API
// quer só a parte depois da vírgula. Ler como data URL em vez de ArrayBuffer
// evita converter bytes para base64 à mão no navegador, que para 32 MB é
// lento e fácil de errar.
function lerComoBase64 (arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo escolhido.'))
    leitor.onload = () => {
      const bruto = String(leitor.result || '')
      const virgula = bruto.indexOf(',')
      if (virgula === -1) return reject(new Error('O arquivo escolhido chegou num formato inesperado.'))
      resolve(bruto.slice(virgula + 1))
    }
    leitor.readAsDataURL(arquivo)
  })
}

function previaDoArquivo (arquivo) {
  const url = api.media.contentUrl(arquivo.id)

  if (arquivo.kind === 'image') {
    return el('div', { className: 'acervo-previa' }, [
      el('img', { src: url, alt: arquivo.description || arquivo.name, loading: 'lazy' })
    ])
  }

  if (arquivo.kind === 'audio') {
    const audio = el('audio', { controls: '', preload: 'none', className: 'acervo-audio' })
    audio.src = url
    return el('div', { className: 'acervo-previa acervo-previa-audio' }, [audio])
  }

  if (arquivo.kind === 'text') {
    const caixa = el('div', { className: 'acervo-previa acervo-previa-texto' })
    const ver = button('Ver o texto', {
      variant: 'quiet',
      onClick: async (evento) => {
        const controle = evento.currentTarget
        setBusy(controle, true, 'Lendo…')
        try {
          const resposta = await fetch(url)
          if (!resposta.ok) throw new Error('Não foi possível ler o arquivo.')
          caixa.replaceChildren(el('pre', { className: 'readonly-box', text: await resposta.text() }))
        } catch (erro) {
          notify(erro.message, 'danger')
          setBusy(controle, false)
        }
      }
    })
    caixa.append(ver)
    return caixa
  }

  return el('div', { className: 'acervo-previa acervo-previa-simbolo' }, [
    el('span', { 'aria-hidden': 'true', text: SIMBOLO_TIPO[arquivo.kind] || '◇' })
  ])
}

// O id é o que liga o acervo a um comando: é ele que vai no campo "arquivo"
// da ação de enviar. Por isso fica visível e copiável, do mesmo jeito que a
// aba de variáveis expõe o placeholder pronto para colar.
function cartaoDeArquivo (arquivo, refresh) {
  const descricao = el('input', {
    type: 'text',
    value: arquivo.description || '',
    placeholder: 'Para que serve este arquivo?'
  })

  const salvarDescricao = button('Salvar', {
    variant: 'quiet',
    onClick: async (evento) => {
      const controle = evento.currentTarget
      setBusy(controle, true, 'Salvando…')
      try {
        await api.media.describe(arquivo.id, descricao.value.trim())
        notify('Descrição atualizada.')
        await refresh()
      } catch (erro) {
        notify(erro.message, 'danger')
        setBusy(controle, false)
      }
    }
  })

  // O CAMINHO é o que se usa num comando hoje ("/arquivo produtos/capa.jpg"),
  // então ele vira o botão de copiar mais à mão. O id continua ali: é a
  // referência estável, que não muda se o arquivo for renomeado ou movido.
  const copiarCaminho = button('Copiar caminho', {
    variant: 'primary',
    onClick: async (evento) => {
      const controle = evento.currentTarget
      await copyText(arquivo.path || arquivo.name)
      controle.textContent = 'Copiado!'
      window.setTimeout(() => { controle.textContent = 'Copiar caminho' }, 1400)
    }
  })

  const campoPasta = el('input', { type: 'text', value: arquivo.folder || '', placeholder: 'sem pasta' })
  const salvarPasta = button('Mover', {
    onClick: async (evento) => {
      const controle = evento.currentTarget
      setBusy(controle, true, 'Movendo…')
      try {
        // Mover é trocar um rótulo: nenhum byte sai do lugar, porque o arquivo
        // sempre esteve plano no disco, gravado por id.
        await api.media.mover(arquivo.id, campoPasta.value.trim())
        notify('Arquivo movido.')
        await refresh()
      } catch (erro) {
        notify(erro.message, 'danger')
        setBusy(controle, false)
      }
    }
  })

  const copiarId = button('Copiar id', {
    variant: 'quiet',
    variant: 'secondary',
    onClick: async (evento) => {
      const controle = evento.currentTarget
      await copyText(arquivo.id)
      controle.textContent = 'Copiado!'
      window.setTimeout(() => { controle.textContent = 'Copiar id' }, 1400)
    }
  })

  const remover = button('Remover', {
    variant: 'danger-quiet',
    onClick: async (evento) => {
      if (!window.confirm(`Remover "${arquivo.name}" do acervo? Comandos que usam este arquivo deixam de encontrá-lo.`)) return
      const controle = evento.currentTarget
      setBusy(controle, true, 'Removendo…')
      try {
        await api.media.remove(arquivo.id)
        notify('Arquivo removido do acervo.')
        await refresh()
      } catch (erro) {
        notify(erro.message, 'danger')
        setBusy(controle, false)
      }
    }
  })

  return el('article', { className: 'list-card acervo-card' }, [
    previaDoArquivo(arquivo),
    el('div', { className: 'list-card-main' }, [
      el('div', {}, [
        el('h2', { text: arquivo.name }),
        el('p', { className: 'mono overline', text: arquivo.path || arquivo.name })
      ]),
      badge(ROTULO_TIPO[arquivo.kind] || arquivo.kind, 'info')
    ]),
    el('div', { className: 'acervo-campo-descricao' }, [descricao, salvarDescricao]),
    el('div', { className: 'acervo-campo-descricao' }, [campoPasta, salvarPasta]),
    el('small', { className: 'muted', text: `${formatarBytes(arquivo.sizeBytes)} · ${arquivo.mimetype} · enviado em ${formatDate(arquivo.createdAt)}` }),
    el('div', { className: 'button-row' }, [copiarCaminho, copiarId, remover])
  ])
}

function painelDeEnvio (limites, refresh) {
  const seletor = el('input', { type: 'file', accept: (limites?.acceptedTypes || []).join(',') })
  const descricao = el('input', { type: 'text', placeholder: 'Ex: foto do combo família' })
  const pasta = el('input', { type: 'text', placeholder: 'produtos/fotos' })
  const mensagem = el('div')
  const enviar = button('Enviar para o acervo', { variant: 'primary', type: 'submit' })
  const limiteBytes = Number(limites?.maxFileBytes) || 0

  const form = el('form', { className: 'panel stack-lg' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Enviar um arquivo' }),
        el('p', { text: `Imagem, vídeo, áudio, PDF ou texto. Até ${formatarBytes(limiteBytes)} por arquivo.` })
      ])
    ]),
    el('div', { className: 'form-grid' }, [
      field('Arquivo', seletor, 'O nome do arquivo vira só um rótulo na tela — o sistema gera um identificador próprio.'),
      field('Descrição', descricao, 'Opcional, mas ajuda a reconhecer o arquivo daqui a um mês.'),
      field('Pasta', pasta, 'Opcional, até três níveis ("produtos/fotos"). É um rótulo do acervo, não uma pasta no disco — o arquivo continua guardado por identificador gerado, e é isso que impede um nome virar caminho no sistema de arquivos.')
    ]),
    mensagem,
    el('div', { className: 'button-row' }, [enviar])
  ])

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    mensagem.replaceChildren()
    const arquivo = seletor.files?.[0]
    if (!arquivo) {
      mensagem.replaceChildren(errorState(new Error('Escolha um arquivo antes de enviar.')))
      return
    }
    // Conferido aqui além do servidor: sem isto, um arquivo grande demais
    // seria lido inteiro em memória e transmitido só para ser recusado no fim.
    if (limiteBytes && arquivo.size > limiteBytes) {
      mensagem.replaceChildren(errorState(new Error(
        `"${arquivo.name}" tem ${formatarBytes(arquivo.size)} e o limite por arquivo é ${formatarBytes(limiteBytes)}.`
      )))
      return
    }

    setBusy(enviar, true, 'Enviando…')
    try {
      const contentBase64 = await lerComoBase64(arquivo)
      await api.media.upload({
        contentBase64,
        mimetype: arquivo.type,
        name: arquivo.name,
        description: descricao.value.trim() || undefined,
        folder: pasta.value.trim() || undefined
      })
      notify('Arquivo enviado para o acervo.')
      await refresh()
    } catch (erro) {
      mensagem.replaceChildren(errorState(erro))
      setBusy(enviar, false)
    }
  })

  return form
}

// O limite do acervo NÃO é editável aqui, de propósito.
//
// Ele existe para limitar quem usa o sistema; um campo onde o próprio limitado
// digita outro número não limita nada. Vem de fora — variável de ambiente
// LCN_ACERVO_LIMITE ou `container.disk` no runtime.json, do lado de memória e
// CPU, gravados na instalação. Esta tela mostra e explica, como a tela da
// instância já faz com memória e CPU.
function painelDeUso (uso) {
  const semTeto = uso.quotaBytes === null
  const ocupado = semTeto || !uso.quotaBytes ? 0 : Math.min(100, Math.round((uso.usedBytes / uso.quotaBytes) * 100))

  const resumo = semTeto
    ? `${uso.files} ${uso.files === 1 ? 'arquivo' : 'arquivos'} · ${formatarBytes(uso.usedBytes)} em uso · sem limite definido`
    : `${uso.files} ${uso.files === 1 ? 'arquivo' : 'arquivos'} · ${formatarBytes(uso.usedBytes)} de ${formatarBytes(uso.quotaBytes)} · ${formatarBytes(uso.freeBytes)} livres`

  const barra = semTeto
    ? null
    : el('div', { className: 'acervo-barra', role: 'img', 'aria-label': `${ocupado}% do acervo em uso` }, [
      el('span', { style: `width: ${ocupado}%` })
    ])

  return el('section', { className: 'panel stack' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Espaço em uso' }),
        el('p', { text: resumo })
      ]),
      semTeto ? badge('Sem limite', 'warning') : badge(`Limite: ${formatarBytes(uso.quotaBytes)}`, 'info')
    ]),
    barra
  ])
}

export async function renderAcervo ({ refresh }) {
  setPageHeader({
    eyebrow: 'Arquivos',
    title: 'Acervo',
    description: 'Arquivos que você envia uma vez e usa em qualquer comando. Compartilhado entre todos os seus números.',
    actions: [button('Atualizar', { onClick: refresh })]
  })

  const { files = [], usage, limits } = await api.media.list()

  // Agrupado por pasta, com a raiz primeiro.
  //
  // Sem isto, criar pastas não organizaria nada: a lista continuaria uma grade
  // única, e a pasta seria uma palavra que só aparece no cartão. Agrupar é o
  // que faz a pasta existir para quem olha.
  function porPasta (arquivos) {
    const grupos = new Map()
    for (const arquivo of arquivos) {
      const pasta = arquivo.folder || ''
      if (!grupos.has(pasta)) grupos.set(pasta, [])
      grupos.get(pasta).push(arquivo)
    }
    return [...grupos.entries()].sort(([a], [b]) => {
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b)
    })
  }

  const grupos = porPasta(files)
  const lista = files.length
    ? el('div', { className: 'stack-lg' }, grupos.map(([pasta, arquivos]) => el('section', { className: 'stack' }, [
      el('div', { className: 'section-heading' }, [
        el('div', {}, [
          el('h3', { text: pasta || 'Sem pasta' }),
          el('p', { className: 'muted compact', text: `${arquivos.length} ${arquivos.length === 1 ? 'arquivo' : 'arquivos'}` })
        ])
      ]),
      el('div', { className: 'card-grid acervo-grade' }, arquivos.map((arquivo) => cartaoDeArquivo(arquivo, refresh)))
    ])))
    : emptyState(
      'O acervo está vazio',
      'Envie uma foto, um áudio ou um PDF para poder usá-lo dentro de um comando sem reenviar o arquivo toda vez.'
    )

  return el('div', { className: 'stack-lg' }, [
    painelDeEnvio(limits, refresh),
    painelDeUso(usage),
    el('div', { className: 'section-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Arquivos guardados' }),
        el('p', { text: 'O CAMINHO de cada arquivo é o que você escreve num comando — "/arquivo produtos/fotos/capa.jpg". O identificador continua ali para quem prefere a referência estável, que não muda se o arquivo for renomeado ou movido.' })
      ])
    ]),
    lista
  ])
}
