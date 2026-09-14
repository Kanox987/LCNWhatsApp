// Conversão entre o que a pessoa digita na tela e o valor que o motor guarda.
//
// A tabela sempre soube guardar qualquer tipo (a coluna é JSON), mas a tela
// mandava tudo como texto — então um contador criado à mão virava a string
// "0", e somar nela falhava com "guarda um valor que não é número inteiro".
// Este módulo é a tradução, isolada aqui para ser testável sem navegador.

export const TIPOS = Object.freeze([
  { id: 'text', rotulo: 'Texto', ajuda: 'Qualquer palavra ou frase. Ex: premium, aguardando.' },
  { id: 'number', rotulo: 'Número', ajuda: 'Serve para contador: só assim dá para somar nele depois.' },
  { id: 'boolean', rotulo: 'Sim ou não', ajuda: 'Marca ligada ou desligada. Ex: cliente VIP.' }
])

export const TIPOS_VALIDOS = Object.freeze(TIPOS.map((t) => t.id))

// Que tipo um valor já guardado tem. Usado ao abrir a tela: a pessoa vê o
// campo certo para o que está lá, em vez de sempre um campo de texto.
export function tipoDoValor (valor) {
  if (typeof valor === 'number') return 'number'
  if (typeof valor === 'boolean') return 'boolean'
  return 'text'
}

// Converte o que foi digitado para o tipo escolhido. Devolve
// `{ ok: true, valor }` ou `{ ok: false, erro }` — nunca lança, e nunca
// "conserta" silenciosamente: digitar "abc" num contador é erro que a pessoa
// precisa ver, senão ela cria um contador que nunca vai poder somar.
export function converterParaTipo (bruto, tipo) {
  if (!TIPOS_VALIDOS.includes(tipo)) return { ok: false, erro: 'Tipo de valor desconhecido.' }

  if (tipo === 'number') {
    const texto = String(bruto ?? '').trim().replace(',', '.')
    if (!texto) return { ok: false, erro: 'Informe um número.' }
    const numero = Number(texto)
    if (!Number.isFinite(numero)) return { ok: false, erro: `"${bruto}" não é um número.` }
    return { ok: true, valor: numero }
  }

  if (tipo === 'boolean') {
    if (typeof bruto === 'boolean') return { ok: true, valor: bruto }
    const texto = String(bruto ?? '').trim().toLowerCase()
    if (['true', 'sim', '1', 'ligado'].includes(texto)) return { ok: true, valor: true }
    if (['false', 'não', 'nao', '0', 'desligado', ''].includes(texto)) return { ok: true, valor: false }
    return { ok: false, erro: `"${bruto}" não é sim nem não.` }
  }

  return { ok: true, valor: String(bruto ?? '') }
}

// Como o valor aparece no campo de edição. Texto continua texto (sem aspas
// de JSON em volta, que era o que a tela antiga mostrava); número vira o
// número; sim/não é tratado pelo próprio controle de marcar.
export function valorParaCampo (valor) {
  if (typeof valor === 'string') return valor
  if (typeof valor === 'number') return String(valor)
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não'
  return JSON.stringify(valor)
}

// Descrição curta do valor para leitura rápida na lista.
export function descreverValor (valor) {
  const tipo = tipoDoValor(valor)
  if (tipo === 'boolean') return valor ? 'sim' : 'não'
  if (tipo === 'number') return String(valor)
  return valor === '' ? '(vazio)' : String(valor)
}
