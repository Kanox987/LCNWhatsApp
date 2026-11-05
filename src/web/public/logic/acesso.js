// "Quem pode usar" na instalação: o texto que o motor lê ("todos", "dono",
// "admins", "lista vip") e as duas peças do formulário (a escolha e o nome da
// lista). Fica fora de parametros.js porque aquele precisa de `document`.
export const MODOS_DE_ACESSO = Object.freeze([
  { id: 'todos', rotulo: 'Todos' },
  { id: 'dono', rotulo: 'Só o dono' },
  { id: 'admins', rotulo: 'Administradores do grupo' },
  { id: 'lista', rotulo: 'Quem está numa lista' }
])

export const ehParametroDeAcesso = (definition) => definition?.key === 'acesso'

// Texto gravado -> { modo, lista }. O que não se reconhece volta como "todos",
// vazio: abrir o formulário nunca inventa uma restrição que não está lá.
export function acessoParaFormulario (valor) {
  const texto = String(valor ?? '').trim()
  if (texto === 'dono' || texto === 'admins') return { modo: texto, lista: '' }
  const lista = /^lista\s+(.+)$/i.exec(texto)
  if (lista) return { modo: 'lista', lista: lista[1].trim() }
  return { modo: 'todos', lista: '' }
}

// { modo, lista } -> texto. "lista" sem nome sai como "lista": o motor recusa
// com a frase do que vale, em vez de a tela trocar por outro valor.
export function acessoDoFormulario ({ modo, lista } = {}) {
  if (modo === 'lista') {
    const nome = String(lista ?? '').trim()
    return nome ? `lista ${nome}` : 'lista'
  }
  return modo === 'dono' || modo === 'admins' ? modo : 'todos'
}
