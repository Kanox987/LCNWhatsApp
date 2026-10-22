// O MENU — como ele se apresenta em cada conversa.
//
// O CRUD existe no motor desde sempre (`routes/menu.js`), incluindo a
// pré-visualização que a própria rota diz existir "para a UI". Nunca houve
// rota no painel. Até aqui o menu só se configurava de DENTRO do WhatsApp,
// pelo comando de configuração, um campo por mensagem — e quem aluga o sistema
// tinha de saber que esse comando existe.
//
// A CASCATA é o que esta tela precisa tornar visível, porque é o que mais
// confunde: a configuração de uma conversa específica ganha do padrão do tipo
// de conversa, que ganha do que o próprio comando trouxer, que ganha do padrão
// do código. Alguém que edita "todos os grupos" e não vê mudança num grupo
// específico está vendo a cascata funcionar — e sem a tela dizer isso, parece
// defeito.
import { api } from '../api.js'
import { button, el, errorState, field, notify, setBusy, setPageHeader } from '../ui.js'

// Os quatro alvos que o motor aceita. Os dois primeiros são padrões amplos; os
// dois últimos pedem o id de uma conversa.
const ALVOS = [
  { kind: 'direct_default', rotulo: 'Todo o privado', precisaDeId: false, ajuda: 'Vale para qualquer conversa direta que não tenha configuração própria.' },
  { kind: 'group_default', rotulo: 'Todos os grupos', precisaDeId: false, ajuda: 'Vale para qualquer grupo que não tenha configuração própria.' },
  { kind: 'contact', rotulo: 'Um contato específico', precisaDeId: true, ajuda: 'Ganha do padrão do privado, só para este contato.' },
  { kind: 'group', rotulo: 'Um grupo específico', precisaDeId: true, ajuda: 'Ganha do padrão dos grupos, só para este grupo.' }
]

const FORMATOS = [
  ['text', 'Texto — uma lista escrita na mensagem'],
  // A palavra do sistema é "interactive" e o que sai é uma LISTA de seleção,
  // não botões de resposta rápida. O rótulo diz o que a pessoa vai ver, não o
  // nome interno.
  ['interactive', 'Lista para tocar — abre uma lista de escolha']
]

export async function renderMenuConfig ({ refresh }) {
  setPageHeader({
    eyebrow: 'Como o bot se apresenta',
    title: 'Menu',
    description: 'O que aparece quando alguém pede o menu: o cabeçalho, o rodapé, o formato, e o texto de quando não há comando nenhum por ali.',
    actions: [button('Atualizar', { onClick: () => refresh?.() })]
  })

  const aviso = el('div', {})
  const mostrarErro = (titulo, mensagem) => aviso.replaceChildren(
    el('div', { className: 'notice notice-danger' }, [
      el('strong', { text: titulo }),
      el('p', { text: mensagem })
    ])
  )

  const seletorDeAlvo = el('select', { className: 'input' },
    ALVOS.map((a) => el('option', { value: a.kind, text: a.rotulo }))
  )
  const campoDeId = el('input', { type: 'text', className: 'input', placeholder: '5511999999999@s.whatsapp.net', autocomplete: 'off' })
  // Aparece e some conforme o alvo escolhido: os padrões amplos não têm
  // conversa, os específicos exigem uma.
  const blocoDeId = el('div', { hidden: true }, [
    field('Qual conversa', campoDeId, 'O id do grupo ou do contato. Você acha na aba Dados.')
  ])

  const formato = el('select', { className: 'input' }, FORMATOS.map(([v, t]) => el('option', { value: v, text: t })))
  const cabecalho = el('input', { type: 'text', className: 'input' })
  const rodape = el('input', { type: 'text', className: 'input' })
  const textoVazio = el('input', { type: 'text', className: 'input' })
  const tituloDoBotao = el('input', { type: 'text', className: 'input' })

  const estado = el('p', { className: 'muted compact' })

  const alvoAtual = () => ALVOS.find((a) => a.kind === seletorDeAlvo.value) || ALVOS[0]
  const idAtual = () => (alvoAtual().precisaDeId ? campoDeId.value.trim() : null)

  // Carrega o que está GRAVADO para aquele alvo. Campo vazio aqui significa
  // "não configurado neste nível" — e é informação: quer dizer que o nível de
  // cima é quem manda.
  const carregar = async () => {
    const alvo = alvoAtual()
    blocoDeId.hidden = !alvo.precisaDeId
    estado.textContent = ''
    if (alvo.precisaDeId && !idAtual()) {
      for (const campo of [cabecalho, rodape, textoVazio, tituloDoBotao]) campo.value = ''
      estado.textContent = 'Escreva o id da conversa para ver o que está configurado nela.'
      return
    }
    try {
      const resposta = await api.menuConfig.get(alvo.kind, idAtual())
      const config = resposta?.config || {}
      formato.value = config.format || 'text'
      cabecalho.value = config.header ?? ''
      rodape.value = config.footer ?? ''
      textoVazio.value = config.emptyText ?? ''
      tituloDoBotao.value = config.buttonTitle ?? ''
      const vazio = !config.header && !config.footer && !config.emptyText && !config.buttonTitle && !config.format
      estado.textContent = vazio
        ? 'Nada configurado neste nível — vale o que vier de cima na cascata.'
        : 'Configuração gravada neste nível.'
    } catch (erro) {
      mostrarErro('Não consegui ler a configuração', erro.message)
    }
  }

  seletorDeAlvo.addEventListener('change', carregar)
  campoDeId.addEventListener('change', carregar)

  const salvar = button('Salvar', {
    variant: 'primary',
    onClick: async () => {
      aviso.replaceChildren()
      const alvo = alvoAtual()
      if (alvo.precisaDeId && !idAtual()) {
        return mostrarErro('Falta a conversa', 'Para configurar um grupo ou contato específico, escreva o id dele. Você acha o id na aba Dados.')
      }
      setBusy(salvar, true)
      try {
        await api.menuConfig.save(alvo.kind, idAtual(), {
          format: formato.value,
          header: cabecalho.value,
          footer: rodape.value,
          emptyText: textoVazio.value,
          buttonTitle: tituloDoBotao.value
        })
        notify('Menu configurado.')
        await carregar()
      } catch (erro) {
        mostrarErro('Não consegui salvar', erro.message)
      } finally {
        setBusy(salvar, false)
      }
    }
  })

  // Apagar NÃO é o mesmo que limpar os campos: apagar devolve aquele nível à
  // cascata, e o nível de cima volta a mandar. Limpar grava textos vazios.
  const apagar = button('Voltar ao padrão', {
    onClick: async () => {
      aviso.replaceChildren()
      const alvo = alvoAtual()
      if (alvo.precisaDeId && !idAtual()) return
      setBusy(apagar, true)
      try {
        await api.menuConfig.remove(alvo.kind, idAtual())
        notify('Configuração removida — este nível volta a herdar.')
        await carregar()
      } catch (erro) {
        mostrarErro('Não consegui remover', erro.message)
      } finally {
        setBusy(apagar, false)
      }
    }
  })

  // --- pré-visualização ---------------------------------------------------
  const idDeTeste = el('input', { type: 'text', className: 'input', placeholder: '5511999999999@s.whatsapp.net', autocomplete: 'off' })
  const tipoDeTeste = el('select', { className: 'input' }, [
    el('option', { value: 'direct', text: 'Conversa direta' }),
    el('option', { value: 'group', text: 'Grupo' })
  ])
  const resultado = el('pre', { className: 'json-view compact-json' })

  const verEfetivo = button('Ver o que vale nesta conversa', {
    onClick: async () => {
      aviso.replaceChildren()
      const chatId = idDeTeste.value.trim()
      if (!chatId) return mostrarErro('Falta a conversa', 'Escreva o id de um contato ou grupo para ver qual configuração vence nele.')
      setBusy(verEfetivo, true)
      try {
        const efetivo = await api.menuConfig.effective(chatId, tipoDeTeste.value)
        resultado.textContent = JSON.stringify(efetivo?.config ?? efetivo, null, 2)
      } catch (erro) {
        mostrarErro('Não consegui calcular', erro.message)
      } finally {
        setBusy(verEfetivo, false)
      }
    }
  })

  await carregar()

  return el('div', { className: 'stack-lg' }, [
    aviso,
    el('div', { className: 'notice notice-info' }, [
      el('strong', { text: 'Como a cascata decide' }),
      el('p', { text: 'A configuração de uma conversa específica ganha do padrão do tipo de conversa, que ganha do que o próprio comando de menu trouxer, que ganha do padrão do sistema. Editar "todos os grupos" e não ver mudança num grupo específico significa que aquele grupo tem configuração própria.' })
    ]),
    el('section', { className: 'card stack' }, [
      el('h2', { text: 'Configurar' }),
      el('div', { className: 'form-grid' }, [
        field('Onde vale', seletorDeAlvo, alvoAtual().ajuda)
      ]),
      blocoDeId,
      el('div', { className: 'form-grid' }, [
        field('Formato', formato, 'Texto funciona em qualquer aparelho. A lista para tocar depende do aplicativo de quem recebe desenhar.'),
        field('Título do botão', tituloDoBotao, 'Só aparece no formato de lista.')
      ]),
      field('Cabeçalho', cabecalho, 'A linha antes da lista de comandos.'),
      field('Rodapé', rodape, 'Opcional, depois da lista.'),
      field('Quando não há comando', textoVazio, 'O que responder numa conversa onde nenhum comando vale.'),
      estado,
      el('div', { className: 'button-row' }, [salvar, apagar])
    ]),
    el('section', { className: 'card stack' }, [
      el('h2', { text: 'Conferir numa conversa' }),
      el('p', { className: 'muted compact', text: 'Mostra qual configuração de fato vence numa conversa, já resolvida a cascata.' }),
      el('div', { className: 'form-grid' }, [
        field('Conversa', idDeTeste),
        field('Tipo', tipoDeTeste)
      ]),
      el('div', { className: 'button-row' }, [verEfetivo]),
      resultado
    ])
  ])
}
