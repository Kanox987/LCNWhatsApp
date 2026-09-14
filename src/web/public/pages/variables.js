import { api } from '../api.js'
import { badge, button, copyText, el, notify, setPageHeader } from '../ui.js'
import {
  ACOES, CONDICOES, DESTINOS, ESCOPOS, FAMILIAS, GATILHOS, OPERADORES,
  ORIGENS_DE_OPERANDO, acharDefinicao, campoDoSchema
} from '../logic/acoes.js'

const TITULOS_NAMESPACE = {
  message: 'Mensagem recebida',
  sender: 'Quem enviou',
  target: 'Quem o comando está mirando',
  quoted: 'A mensagem respondida',
  chat: 'Onde aconteceu',
  bot: 'O próprio bot',
  now: 'Data e hora',
  var: 'Variáveis e contadores que você cria'
}

const AJUDA_NAMESPACE = {
  message: 'Conteúdo e tipo da mensagem que acionou a automação.',
  sender: 'Identificação de quem mandou a mensagem.',
  target: 'Quando alguém escreve "/comando @fulano" — ou responde a mensagem de alguém — o fulano é o alvo. Fica vazio se não houver menção nem resposta.',
  quoted: 'Quando alguém responde a mensagem de outra pessoa e usa um comando, é dessa mensagem respondida que se trata.',
  chat: 'A conversa onde a automação executou — contato ou grupo.',
  bot: 'O número que está executando a automação.',
  now: 'O relógio da máquina no instante em que a resposta é montada. Já vêm prontas em vários formatos porque não existe conta nem função dentro do texto — você escolhe a que quer colar.',
  var: 'Você cria essas na aba Dados e usa aqui. O escopo (depois de "var.") decide de quem é o valor: da conversa, de quem enviou, do alvo, da categoria ou do sistema todo.'
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

// Uma variável declarada por um comando. Além da descrição, mostra de onde
// veio — sem isso a pessoa vê um contador estranho na lista e não faz ideia
// de quem o criou nem se pode apagar.
function linhaDeclarada (variavel) {
  const copiar = button('Copiar', {
    variant: 'secondary',
    onClick: async (event) => {
      const control = event.currentTarget
      await copyText(variavel.usage)
      control.textContent = 'Copiado!'
      window.setTimeout(() => { control.textContent = 'Copiar' }, 1400)
    }
  })

  const detalhe = []
  if (variavel.valueType === 'number') detalhe.push('contador (número)')
  else if (variavel.valueType === 'boolean') detalhe.push('sim ou não')
  else detalhe.push('texto')
  if (variavel.sourceTemplate) detalhe.push(`veio do comando "${variavel.sourceTemplate}"`)

  return el('div', { className: 'variable-row' }, [
    el('div', { className: 'variable-row-main' }, [
      el('code', { className: 'variable-token', text: variavel.usage }),
      el('p', { className: 'field-help', text: variavel.description || 'Sem descrição.' }),
      el('p', { className: 'field-help muted', text: detalhe.join(' · ') })
    ]),
    copiar
  ])
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

// Um campo de um gatilho ou ação. O TIPO vem do schema — este arquivo não sabe
// e não deve saber se `by` é número ou se `match` tem quatro valores. Quando a
// lista de valores existe, ela é mostrada, porque é o que a pessoa precisa
// escolher entre.
function linhaDeCampo (campo, definicao) {
  const doSchema = definicao ? campoDoSchema(definicao, campo.chave) : null
  const selos = []
  if (doSchema?.obrigatorio) selos.push(badge('obrigatório', 'warning'))
  if (doSchema?.valores?.length) selos.push(badge(doSchema.valores.join(' · '), 'neutral'))
  else if (doSchema?.tipo && doSchema.tipo !== 'desconhecido') selos.push(badge(doSchema.tipo, 'neutral'))

  return el('div', { className: 'campo-linha' }, [
    el('div', {}, [
      el('strong', { text: campo.rotulo }),
      el('code', { className: 'campo-chave', text: campo.chave }),
      campo.ajuda ? el('p', { className: 'field-help', text: campo.ajuda }) : null
    ]),
    selos.length ? el('div', { className: 'campo-selos' }, selos) : null
  ])
}

// Um cartão de gatilho, ação ou condição.
function cartaoDeBloco (entrada, documentSchema) {
  const definicao = documentSchema ? acharDefinicao(documentSchema, entrada.tipo) : null
  const corpo = [
    el('div', { className: 'bloco-cabeca' }, [
      el('div', {}, [
        el('h3', { text: entrada.rotulo }),
        el('code', { className: 'mono overline', text: entrada.tipo })
      ]),
      button('Copiar', {
        variant: 'secondary',
        onClick: async (evento) => {
          const c = evento.currentTarget
          await copyText(entrada.tipo)
          c.textContent = 'Copiado!'
          window.setTimeout(() => { c.textContent = 'Copiar' }, 1400)
        }
      })
    ]),
    el('p', { className: 'bloco-resumo', text: entrada.resumo }),
    el('p', { className: 'bloco-exemplo' }, [el('strong', { text: 'Exemplo: ' }), entrada.exemplo])
  ]
  if (entrada.ressalva) corpo.push(avisoInline({ level: entrada.ressalva.level, text: entrada.ressalva.text }))
  if (entrada.campos?.length) {
    corpo.push(el('div', { className: 'campo-lista' }, entrada.campos.map((c) => linhaDeCampo(c, definicao))))
  } else {
    corpo.push(el('p', { className: 'field-help muted', text: 'Não tem nada para configurar — a ação age sobre a mensagem que acionou a automação.' }))
  }
  return el('article', { className: 'list-card bloco-card' }, corpo)
}

function painel (titulo, ajuda, filhos, id) {
  return el('section', { className: 'panel', id }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [el('h2', { text: titulo }), el('p', { text: ajuda })])
    ]),
    ...filhos
  ])
}

function listaSimples (itens, chaveRotulo = 'rotulo') {
  return el('div', { className: 'variable-list' }, itens.map((item) => el('div', { className: 'variable-row' }, [
    el('div', { className: 'variable-row-main' }, [
      el('div', { className: 'bloco-cabeca' }, [
        el('strong', { text: item[chaveRotulo] }),
        el('code', { className: 'campo-chave', text: item.usoNoTexto || item.id })
      ]),
      item.ajuda ? el('p', { className: 'field-help', text: item.ajuda }) : null
    ])
  ])))
}

// Índice no topo: a página ficou longa de propósito (são 2 gatilhos, 11 ações,
// 8 operadores, 8 escopos, 6 destinos e 32 variáveis). Sem um índice, quem abre
// procurando "como remover do grupo" rola até desistir.
function indice (secoes) {
  return el('nav', { className: 'panel indice-referencia' }, [
    el('p', { className: 'field-help', text: 'Ir direto para:' }),
    el('div', { className: 'indice-links' }, secoes.map(([id, rotulo]) =>
      el('a', { href: `#${id}`, className: 'indice-link', text: rotulo })))
  ])
}

export async function renderVariables () {
  // Duas rotas: as variáveis de interpolação, e o schema + capacidades do motor.
  // O schema é o que dá o TIPO de cada campo — este arquivo nunca declara tipo.
  // Se a segunda falhar, a página ainda abre com as variáveis: referência pela
  // metade é melhor que tela de erro.
  const [meta, editor] = await Promise.all([
    api.variables.meta(),
    api.automations.meta().catch(() => null)
  ])
  const documentSchema = editor?.documentSchema || null

  setPageHeader({
    eyebrow: 'Referência',
    title: 'Variáveis e funções do sistema',
    description: 'Tudo que dá para usar ao montar um comando: quando ele começa, o que ele faz, como ele decide, e o que você pode escrever dentro do texto.',
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

  // Variáveis que os comandos instalados trouxeram. Ficam num painel próprio,
  // logo depois das do sistema: são as que a pessoa mais vai usar no dia a dia
  // e as únicas que mudam conforme o que ela instala.
  const declaradas = (meta.declared || []).length
    ? el('section', { className: 'panel panel-accent' }, [
      el('div', { className: 'panel-heading' }, [
        el('div', {}, [
          el('h2', { text: 'Contadores e marcas dos seus comandos' }),
          el('p', { text: 'Criadas pelos comandos que você instalou. Já existem e podem ser usadas em qualquer outro comando seu — mesmo antes de receberem o primeiro valor.' })
        ])
      ]),
      el('div', { className: 'variable-list' }, meta.declared.map(linhaDeclarada))
    ])
    : null

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

  // --- as FUNÇÕES: o que o painel não mostrava --------------------------
  // O motor executa 2 gatilhos, 11 ações e 1 condição, e esta aba mostrava zero
  // dos três. Vêm antes das variáveis porque é a ordem em que a pessoa pensa:
  // primeiro quando o comando começa, depois o que ele faz, e só então o texto.
  const porFamilia = new Map()
  for (const acao of ACOES) {
    if (!porFamilia.has(acao.familia)) porFamilia.set(acao.familia, [])
    porFamilia.get(acao.familia).push(acao)
  }

  const blocoGatilhos = painel(
    'Quando o comando começa',
    'Todo comando começa por um destes dois. Só pode haver um gatilho por automação.',
    [el('div', { className: 'bloco-grade' }, GATILHOS.map((g) => cartaoDeBloco(g, documentSchema)))],
    'gatilhos'
  )

  const blocoAcoes = painel(
    'O que o comando faz',
    'As ações acontecem em sequência. Um comando pode ter quantas quiser.',
    [...porFamilia.entries()].map(([familia, acoes]) => el('div', { className: 'familia-bloco' }, [
      el('h3', { className: 'familia-titulo', text: FAMILIAS[familia] || familia }),
      el('div', { className: 'bloco-grade' }, acoes.map((a) => cartaoDeBloco(a, documentSchema)))
    ])),
    'acoes'
  )

  const blocoCondicao = painel(
    'Como o comando decide',
    'A condição é o único bloco que separa o comando em dois caminhos: um para quando a comparação dá certo, outro para quando não dá.',
    [
      el('div', { className: 'bloco-grade' }, CONDICOES.map((c) => cartaoDeBloco(c, documentSchema))),
      el('h3', { className: 'familia-titulo', text: 'De onde vem cada lado da comparação' }),
      listaSimples(ORIGENS_DE_OPERANDO),
      el('h3', { className: 'familia-titulo', text: 'Comparações disponíveis' }),
      listaSimples(OPERADORES)
    ],
    'condicao'
  )

  const blocoEscopos = painel(
    'De quem é cada variável',
    'O escopo decide a quem um valor pertence. É estrutural: nunca coloque o nome do grupo dentro do nome da variável — escolha o escopo certo.',
    [listaSimples(ESCOPOS)],
    'escopos'
  )

  const blocoDestinos = painel(
    'Onde o comando pode rodar',
    'Deixar em branco NUNCA significa "todos" — sem destino o comando não responde a ninguém. Para valer em todo lugar, escolha isso de propósito.',
    [listaSimples(DESTINOS)],
    'destinos'
  )

  const navegacao = indice([
    ['gatilhos', 'Quando começa'],
    ['acoes', 'O que faz'],
    ['condicao', 'Como decide'],
    ['escopos', 'Escopos'],
    ['destinos', 'Destinos'],
    ['variaveis', 'Variáveis de texto']
  ])

  const tituloVariaveis = el('div', { className: 'section-heading', id: 'variaveis' }, [
    el('div', {}, [
      el('h2', { text: 'O que escrever dentro do texto' }),
      el('p', { text: 'Estas o sistema troca na hora do envio. Copie e cole no campo de resposta.' })
    ])
  ])

  return el('div', { className: 'stack-lg' }, [
    navegacao,
    blocoGatilhos,
    blocoAcoes,
    blocoCondicao,
    blocoEscopos,
    blocoDestinos,
    tituloVariaveis,
    comoUsar,
    declaradas,
    ...grupos,
    reservadas
  ].filter(Boolean))
}
