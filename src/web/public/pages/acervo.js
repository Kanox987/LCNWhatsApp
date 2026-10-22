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

function previaDoArquivo (arquivo, refresh) {
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
    // EDITAR o conteúdo, mantendo o id.
    //
    // Até aqui "editar um arquivo" era apagar e subir de novo — com ID NOVO, e
    // todo comando que apontava para ele por `fileId` passava a não achar
    // nada, em silêncio, só na próxima vez que rodasse. O id é o que liga o
    // acervo ao comando; ele tem de sobreviver à edição.
    const editar = button('Editar', {
      variant: 'quiet',
      onClick: async (evento) => {
        const controle = evento.currentTarget
        setBusy(controle, true, 'Abrindo…')
        try {
          const resposta = await fetch(url)
          if (!resposta.ok) throw new Error('Não foi possível ler o arquivo.')
          const area = el('textarea', { className: 'lcn-editor', rows: '14', spellcheck: 'false' }, await resposta.text())
          const salvar = button('Salvar conteúdo', {
            variant: 'primary',
            onClick: async () => {
              setBusy(salvar, true, 'Salvando…')
              try {
                await api.media.rewrite(arquivo.id, btoa(unescape(encodeURIComponent(area.value))))
                notify('Conteúdo salvo — o arquivo continua com o mesmo id.')
                await refresh?.()
              } catch (erro) {
                notify(erro.message, 'danger')
                setBusy(salvar, false)
              }
            }
          })
          caixa.replaceChildren(area, el('div', { className: 'button-row' }, [salvar]))
        } catch (erro) {
          notify(erro.message, 'danger')
          setBusy(controle, false)
        }
      }
    })
    caixa.append(ver, editar)
    return caixa
  }

  // VÍDEO E DOCUMENTO recebiam só um glifo, e não havia como ABRIR nem baixar
  // nada pela tela — nem aqui, nem em botão nenhum. O motor já servia os bytes
  // com `content-disposition: attachment` para esses tipos desde sempre: era
  // só não existir link.
  return el('div', { className: 'acervo-previa acervo-previa-simbolo' }, [
    el('span', { 'aria-hidden': 'true', text: SIMBOLO_TIPO[arquivo.kind] || '◇' }),
    el('a', { href: url, className: 'button button-quiet', download: arquivo.name || '' }, 'Baixar')
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

  // QUEM USA ESTE ARQUIVO — e o aviso de apagar deixa de ser um palpite.
  //
  // A confirmação dizia "Comandos que usam este arquivo deixam de encontrá-lo"
  // sem poder dizer QUAIS, porque o vínculo nunca foi indexado. Agora ela
  // pergunta antes, e nomeia. Se a consulta falhar, o aviso volta ao genérico
  // em vez de impedir a remoção: saber quem usa é uma ajuda, não um portão.
  const nomesDeQuemUsa = async () => {
    try {
      const usos = await api.media.usage(arquivo.id)
      return [
        ...(usos?.certos || []).map((u) => `• ${u.nome} (${u.como})`),
        ...(usos?.talvez || []).map((u) => `• ${u.nome} — talvez: ${u.como}`)
      ]
    } catch {
      return null
    }
  }

  const verUsos = el('div', { className: 'acervo-usos' })
  const consultar = button('Quem usa', {
    variant: 'quiet',
    onClick: async (evento) => {
      const controle = evento.currentTarget
      setBusy(controle, true, 'Procurando…')
      const linhas = await nomesDeQuemUsa()
      setBusy(controle, false)
      if (linhas === null) {
        verUsos.replaceChildren(el('p', { className: 'muted compact', text: 'Não consegui consultar agora.' }))
        return
      }
      verUsos.replaceChildren(linhas.length
        ? el('pre', { className: 'readonly-box', text: linhas.join('\n') })
        : el('p', { className: 'muted compact', text: 'Nenhum comando publicado aponta para este arquivo.' }))
    }
  })

  const remover = button('Remover', {
    variant: 'danger-quiet',
    onClick: async (evento) => {
      const linhas = await nomesDeQuemUsa()
      const detalhe = linhas === null
        ? 'Comandos que usam este arquivo deixam de encontrá-lo.'
        : (linhas.length
            ? `Estes comandos apontam para ele:\n\n${linhas.join('\n')}\n\nEles deixam de encontrá-lo.`
            : 'Nenhum comando publicado aponta para ele.')
      if (!window.confirm(`Remover "${arquivo.name}" do acervo?\n\n${detalhe}`)) return
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
    previaDoArquivo(arquivo, refresh),
    verUsos,
    el('div', { className: 'list-card-main' }, [
      el('div', {}, [
        el('h2', { text: arquivo.name }),
        el('p', { className: 'mono overline', text: arquivo.path || arquivo.name })
      ]),
      badge(ROTULO_TIPO[arquivo.kind] || arquivo.kind, 'info')
    ]),
    el('div', { className: 'acervo-campo-descricao' }, [descricao, salvarDescricao]),
    el('div', { className: 'acervo-campo-descricao' }, [campoPasta, salvarPasta]),
    el('small', { className: 'muted', text: `${formatarBytes(arquivo.sizeBytes)} · ${arquivo.mimetype} · enviado em ${formatDate(arquivo.createdAt)}${arquivo.updatedAt ? ` · editado em ${formatDate(arquivo.updatedAt)}` : ''}` }),
    el('div', { className: 'button-row' }, [copiarCaminho, copiarId, consultar, remover])
  ])
}

// CRIAR UM ARQUIVO DE TEXTO AQUI, sem subir nada.
//
// O motor já aceitaria desde sempre — `POST /media` quer `contentBase64` e um
// mimetype, e `text/plain` e `text/html` estão entre os tipos aceitos. O que
// faltava era a tela: ela só tinha um seletor de arquivo, então escrever uma
// página ou um texto exigia criar o arquivo noutro programa, salvar, e subir.
function painelDeTextoNovo (limites, refresh) {
  const aceitos = limites?.acceptedTypes || []
  const tiposDeTexto = [
    ['text/plain', 'Texto simples (.txt)'],
    ['text/html', 'Página HTML (.html)']
  ].filter(([mime]) => aceitos.includes(mime))
  // Se o acervo deixar de aceitar texto, esta seção some sozinha em vez de
  // oferecer um tipo que o motor vai recusar.
  if (!tiposDeTexto.length) return null

  const nome = el('input', { type: 'text', className: 'input', placeholder: 'pagina.html' })
  const tipo = el('select', { className: 'input' }, tiposDeTexto.map(([v, t]) => el('option', { value: v, text: t })))
  const pasta = el('input', { type: 'text', className: 'input', placeholder: 'paginas' })
  const conteudo = el('textarea', { className: 'lcn-editor', rows: '12', spellcheck: 'false', placeholder: '<!doctype html>\n<title>Minha página</title>' })
  const mensagem = el('div')

  const criar = button('Criar no acervo', {
    variant: 'primary',
    onClick: async () => {
      mensagem.replaceChildren()
      if (!conteudo.value.trim()) {
        mensagem.replaceChildren(el('div', { className: 'notice notice-danger' }, [el('p', { text: 'Escreva algum conteúdo — arquivo vazio o acervo recusa.' })]))
        return
      }
      setBusy(criar, true, 'Criando…')
      try {
        await api.media.upload({
          // `btoa` sozinho quebra em acento: ele só aceita latin-1, e um "ç"
          // no texto vira erro. A volta por encodeURIComponent é o caminho
          // padrão para passar UTF-8 por ele.
          contentBase64: btoa(unescape(encodeURIComponent(conteudo.value))),
          mimetype: tipo.value,
          name: nome.value.trim() || undefined,
          folder: pasta.value.trim() || undefined
        })
        notify('Arquivo criado no acervo.')
        conteudo.value = ''
        nome.value = ''
        await refresh?.()
      } catch (erro) {
        mensagem.replaceChildren(el('div', { className: 'notice notice-danger' }, [el('p', { text: erro.message })]))
      } finally {
        setBusy(criar, false)
      }
    }
  })

  return el('section', { className: 'panel stack-lg' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Escrever um arquivo' }),
        el('p', { text: 'Para o que você escreve aqui mesmo, em vez de subir de outro programa. Depois de criado, dá para editar o conteúdo sem trocar o identificador.' })
      ])
    ]),
    el('div', { className: 'form-grid' }, [
      field('Nome', nome, 'Opcional. Vazio recebe um nome genérico com a extensão certa.'),
      field('Tipo', tipo, 'HTML é guardado como DOCUMENTO: quem receber baixa e abre no navegador. Texto simples vai como mensagem na conversa.'),
      field('Pasta', pasta, 'Opcional, até três níveis.')
    ]),
    field('Conteúdo', conteudo),
    mensagem,
    el('div', { className: 'button-row' }, [criar])
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
    painelDeTextoNovo(limits, refresh),
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
