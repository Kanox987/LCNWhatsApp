import { api } from '../api.js'
import { button, copyText, el, notify, setPageHeader } from '../ui.js'

const TITULOS_NAMESPACE = {
  message: 'Mensagem recebida',
  sender: 'Quem enviou',
  target: 'Quem o comando está mirando',
  chat: 'Onde aconteceu',
  var: 'Variáveis e contadores que você cria',
  custom: 'Forma antiga (ainda funciona)'
}

const AJUDA_NAMESPACE = {
  message: 'Conteúdo e tipo da mensagem que acionou a automação.',
  sender: 'Identificação de quem mandou a mensagem.',
  target: 'Quando alguém escreve "/comando @fulano" — ou responde a mensagem de alguém — o fulano é o alvo. Fica vazio se não houver menção nem resposta.',
  chat: 'A conversa onde a automação executou — contato ou grupo.',
  var: 'Você cria essas na aba Dados e usa aqui. O escopo (depois de "var.") decide de quem é o valor: da conversa, de quem enviou, do alvo, da categoria ou do sistema todo.',
  custom: 'Atalho histórico para a variável da conversa. Mantido para não quebrar automações antigas.'
}

// Rótulo e tom de cada tipo de ressalva. "unofficial" é o mais grave: recurso
// que a Meta pode desligar sem aviso.
export const AVISOS = {
  info: { rotulo: 'Atenção', tom: 'info' },
  compatibility: { rotulo: 'Nem sempre funciona', tom: 'warning' },
  requirement: { rotulo: 'Precisa de', tom: 'warning' },
  unofficial: { rotulo: 'Recurso não oficial', tom: 'danger' }
}

export function avisoInline (aviso) {
  const meta = AVISOS[aviso.level] || AVISOS.info
  return el('p', { className: `variable-warning tone-${meta.tom}` }, [
    el('strong', { text: `${meta.rotulo}: ` }),
    aviso.text
  ])
}

function linhaVariavel (variavel) {
  const copiar = button('Copiar', {
    variant: 'secondary',
    onClick: async (event) => {
      const control = event.currentTarget
      await copyText(variavel.example)
      control.textContent = 'Copiado!'
      window.setTimeout(() => { control.textContent = 'Copiar' }, 1400)
    }
  })

  const principal = el('div', { className: 'variable-row-main' }, [
    el('code', { className: 'variable-token', text: variavel.example }),
    el('p', { className: 'field-help', text: variavel.description })
  ])

  // Ressalva de compatibilidade fica JUNTO da variável, nunca escondida numa
  // documentação à parte: quem vai colar o placeholder precisa saber ali
  // mesmo se ele tem pegadinha.
  if (variavel.warning) principal.append(avisoInline(variavel.warning))

  return el('div', { className: 'variable-row' }, [principal, copiar])
}

function grupoNamespace (namespace, variaveis) {
  return el('section', { className: 'panel' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: TITULOS_NAMESPACE[namespace] || namespace }),
        el('p', { text: AJUDA_NAMESPACE[namespace] || `Variáveis do grupo ${namespace}.` })
      ])
    ]),
    el('div', { className: 'variable-list' }, variaveis.map(linhaVariavel))
  ])
}

export async function renderVariables () {
  const meta = await api.variables.meta()

  setPageHeader({
    eyebrow: 'Referência',
    title: 'Variáveis do sistema',
    description: 'Escreva qualquer uma destas no texto de resposta de uma automação e o motor troca pelo valor real no momento do envio.',
    actions: []
  })

  const porNamespace = new Map()
  for (const variavel of meta.builtIn || []) {
    if (!porNamespace.has(variavel.namespace)) porNamespace.set(variavel.namespace, [])
    porNamespace.get(variavel.namespace).push(variavel)
  }

  const comoUsar = el('section', { className: 'panel' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: 'Como usar' }),
        el('p', { text: 'Copie o texto entre chaves e cole no campo de resposta da automação.' })
      ])
    ]),
    el('div', { className: 'notice notice-info compact' }, [
      el('p', { text: 'Exemplo: escrever "Olá {{sender.id}}, sua mensagem tinha {{message.kind}}." faz o bot responder com o número de quem escreveu e o tipo da mensagem.' })
    ]),
    el('p', { className: 'field-help', text: 'Se você escrever uma variável que não existe, o motor deixa o texto como está em vez de apagar — assim dá pra perceber o erro na resposta em vez de receber uma mensagem com um buraco.' })
  ])

  const grupos = [...porNamespace.entries()].map(([namespace, variaveis]) => grupoNamespace(namespace, variaveis))

  const reservadas = (meta.reserved || []).length
    ? el('section', { className: 'panel' }, [
      el('div', { className: 'panel-heading' }, [
        el('div', {}, [
          el('h2', { text: 'Casos especiais' }),
          el('p', { text: 'Funcionam sem ponto e sem namespace, porque quem resolve é o gateway no instante do envio.' })
        ])
      ]),
      el('div', { className: 'variable-list' }, meta.reserved.map((item) => linhaVariavel({
        example: item.placeholder,
        description: item.description
      })))
    ])
    : null

  return el('div', { className: 'stack-lg' }, [comoUsar, ...grupos, reservadas].filter(Boolean))
}
