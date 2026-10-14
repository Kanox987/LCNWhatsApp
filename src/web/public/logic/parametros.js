// Os campos do bloco `configurável` de um template, montados como controles.
//
// Isto vive num módulo próprio porque agora são DOIS momentos que precisam do
// mesmo formulário: a instalação (catálogo) e a reconfiguração depois, em
// Automações. Duplicar traria o problema que este painel já tem com o seletor
// de contato — duas cópias que divergem no primeiro tipo novo, e uma delas
// passa a mentir.
import { el } from '../ui.js'

export const TYPE_LABELS = {
  string: 'Texto',
  number: 'Número',
  boolean: 'Sim ou não',
  enum: 'Escolha da lista'
}

export function rotuloTipo (definition) {
  return TYPE_LABELS[definition?.type] || definition?.type
}

// `valorAtual` é o que faz o formulário servir aos dois momentos: na instalação
// não existe valor ainda e o padrão do template manda; ao reconfigurar, quem
// abre quer ver como ESTÁ, não como nasceria.
function valorInicial (definition, valorAtual) {
  if (valorAtual !== undefined) return valorAtual
  return Object.prototype.hasOwnProperty.call(definition, 'default') ? definition.default : undefined
}

// TEXTO DE VÁRIAS LINHAS PRECISA DE ÁREA DE TEXTO, e isto não é estética.
//
// `<input type="text">` APAGA quebra de linha, em silêncio — é o navegador que
// faz isso ao receber o valor. A legenda do /recover chegava à tela já
// achatada, e salvar publicava o texto destruído. Medido no `auto-recover` que
// estava no ar: entravam 142 caracteres com 5 quebras, sobravam 137 sem
// nenhuma. Perda de dados a um clique de distância, nos DOIS formulários — o de
// instalação e o de reconfiguração usam este mesmo controle.
//
// Duas formas de saber, e as duas são necessárias:
//
//   - o template DECLARA `várias linhas: sim`. É o caso do campo que nasce com
//     uma linha e ainda assim precisa aceitar várias. Sem isso, um campo de uma
//     linha nunca poderia receber uma segunda — teto no meu código.
//   - o valor que está lá JÁ TEM quebra. Decide sozinho, porque exigir a
//     declaração deixaria sem proteção todo template já escrito, inclusive os
//     de fora deste repositório.
//
// Separada de `criarControleParametro` porque o resto deste módulo precisa de
// `document` — e é por isso que ele nunca teve teste. A decisão não precisa.
export function ehCampoDeVariasLinhas (definition, valor) {
  if (definition?.type !== 'string') return false
  if (definition.multiline === true) return true
  return String(valor ?? '').includes('\n')
}

export function criarControleParametro (definition, pools = [], valorAtual) {
  const inicial = valorInicial(definition, valorAtual)
  const temInicial = inicial !== undefined

  if (definition.key === 'poolId') {
    const control = el('select', { required: true }, [
      el('option', { value: '', text: pools.length ? 'Selecione um pool' : 'Nenhum pool cadastrado' })
    ])
    for (const pool of pools) {
      control.append(el('option', {
        value: pool.id,
        selected: temInicial && String(inicial) === pool.id,
        text: `${pool.label || pool.id} · ${pool.id}`
      }))
    }
    return control
  }
  if (definition.type === 'boolean') {
    return el('input', { type: 'checkbox', checked: temInicial ? Boolean(inicial) : false })
  }
  // "Escolher uma opção da lista" — o quarto tipo do bloco `configurável`.
  //
  // Sem este ramo, um parâmetro declarado como `opção` no .lcn caía na caixa de
  // texto do final: a pessoa via um campo livre onde devia haver escolhas, e
  // qualquer coisa digitada fora da lista produzia um comando que não faz nada.
  // Este ramo vem DEPOIS do poolId de propósito — aquele monta a lista a partir
  // dos pools do motor, não das opções declaradas.
  if (definition.type === 'enum' && Array.isArray(definition.options) && definition.options.length) {
    const escolhido = temInicial ? String(inicial) : null
    return el('select', { required: true }, definition.options.map((opcao) => el('option', {
      value: opcao,
      selected: escolhido === null ? false : escolhido === opcao,
      text: opcao
    })))
  }
  if (ehCampoDeVariasLinhas(definition, inicial)) {
    const area = el('textarea', { rows: 4, required: true })
    // `value` por propriedade, não por atributo: no textarea o atributo é o
    // conteúdo inicial e trocá-lo depois não mexe no que a pessoa vê.
    area.value = temInicial ? String(inicial) : ''
    return area
  }
  return el('input', {
    type: definition.type === 'number' ? 'number' : 'text',
    step: definition.type === 'number' ? 'any' : undefined,
    value: temInicial ? String(inicial) : '',
    required: true
  })
}

export function valorParametro (definition, control) {
  if (definition.type === 'boolean') return control.checked
  if (definition.type === 'number') return Number(control.value)
  // enum também sai como string: o <select> já garante que o valor está na
  // lista, e o motor confere de novo na instalação.
  return control.value
}
