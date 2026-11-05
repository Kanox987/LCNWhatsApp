// O escopo de uma instalação pelo catálogo: o que a pessoa escolheu na tela
// virou o `scope` que a rota /templates/:id/install recebe.
//
// Vive num módulo próprio porque precisa de caso de teste e a tela precisa de
// `document`. O motor já aceita os seis destinos; o formulário só oferecia
// contato e grupo, então "todos os grupos" existia para quem escreve o comando
// na linguagem e não para quem instala por aqui.
//
// Lista vazia NUNCA vira "todos": quem quer todos escolhe um destino abrangente
// de propósito, e a tela diz o alcance em palavras.
import { DESTINOS } from './acoes.js'

const ABRANGENTES = new Set(['all_contacts', 'all_groups', 'everywhere', 'tagged'])

// Os seis destinos, com o rótulo e a ajuda de `DESTINOS`: a tela não mantém uma
// segunda lista que um dia diverge da primeira.
export const OPCOES_DE_ESCOPO = DESTINOS

export const escopoExigeBusca = (modo) => modo === 'contact' || modo === 'group'
export const escopoExigeVariavel = (modo) => modo === 'tagged'
// "Todos os grupos MENOS este": só faz sentido onde o destino é abrangente.
export const escopoAceitaExcecao = (modo) => ABRANGENTES.has(modo)

const rotuloDe = (alvo) => alvo?.label || alvo?.id || ''
const tipoDe = (kind) => (kind === 'group' ? 'grupo' : 'contato')

function normalizarExcecoes (excecoes) {
  const vistos = new Set()
  const saida = []
  for (const item of Array.isArray(excecoes) ? excecoes : []) {
    if (!item?.id || (item.kind !== 'contact' && item.kind !== 'group')) continue
    const chave = `${item.kind}:${item.id}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    saida.push({ kind: item.kind, id: item.id, label: item.label })
  }
  return saida
}

// { escopo, problema }: ou o corpo pronto, ou a frase do que falta.
export function montarEscopo ({ modo, alvo = null, variavel = '', excecoes = [] } = {}) {
  if (!OPCOES_DE_ESCOPO.some((opcao) => opcao.id === modo)) {
    return { escopo: null, problema: 'Escolha onde o comando pode executar.' }
  }
  if (escopoExigeBusca(modo)) {
    if (!alvo?.id) return { escopo: null, problema: `Escolha ${modo === 'group' ? 'um grupo' : 'um contato'} na busca.` }
    return { escopo: { include: [{ kind: modo, id: alvo.id }], exclude: [] }, problema: null }
  }
  if (escopoExigeVariavel(modo)) {
    const nome = String(variavel ?? '').trim()
    if (!nome) return { escopo: null, problema: 'Informe o nome da marca que identifica as conversas (por exemplo, vip).' }
    return { escopo: { include: [{ kind: 'tagged', id: nome }], exclude: montarExclusoes(excecoes) }, problema: null }
  }
  return { escopo: { include: [{ kind: modo }], exclude: montarExclusoes(excecoes) }, problema: null }
}

const montarExclusoes = (excecoes) => normalizarExcecoes(excecoes).map(({ kind, id }) => ({ kind, id }))

// A frase de "Revise antes de instalar": o alcance, sem eufemismo.
export function descreverEscopo ({ modo, alvo = null, variavel = '', excecoes = [] } = {}) {
  const menos = normalizarExcecoes(excecoes)
  const sufixo = menos.length ? ` Menos: ${menos.map((e) => `${rotuloDe(e)} (${tipoDe(e.kind)})`).join(', ')}.` : ''
  switch (modo) {
    case 'contact':
    case 'group':
      return alvo?.id
        ? `Autorizar somente ${rotuloDe(alvo)} (${tipoDe(modo)}).`
        : `Escolher ${modo === 'group' ? 'um grupo' : 'um contato'} é obrigatório antes de instalar.`
    case 'all_contacts': return `Autorizar em TODOS os contatos no privado.${sufixo}`
    case 'all_groups': return `Autorizar em TODOS os grupos.${sufixo}`
    case 'everywhere': return `Autorizar em QUALQUER conversa (contatos e grupos).${sufixo}`
    case 'tagged': {
      const nome = String(variavel ?? '').trim()
      return nome
        ? `Autorizar só nas conversas marcadas com “${nome}”.${sufixo}`
        : 'Informe o nome da marca antes de instalar.'
    }
    default: return 'Escolher onde o comando pode executar é obrigatório antes de instalar.'
  }
}
