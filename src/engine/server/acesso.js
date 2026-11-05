// "Quem pode usar" escrito como uma palavra só: todos, dono, admins ou
// "lista <nome>". É a forma que a linguagem e o formulário de instalação falam;
// o gatilho guarda o resultado em `requireOwner`, `requireAdmin` e `requireList`.
import { normalizarNomeDeLista } from './listas.js'

export const ACESSOS_SEM_LISTA = Object.freeze(['todos', 'dono', 'admins'])

// { config } com as chaves do gatilho (vazio para "todos"), ou null se o texto
// não for nenhuma das quatro formas. Nunca devolve um padrão no lugar de erro.
export function interpretarAcesso (texto) {
  const valor = String(texto ?? '').trim().toLowerCase()
  if (valor === 'todos') return { config: {} }
  if (valor === 'dono') return { config: { requireOwner: true } }
  if (valor === 'admins') return { config: { requireAdmin: true } }
  const lista = /^lista\s+(.+)$/.exec(valor)
  const nome = lista && normalizarNomeDeLista(lista[1])
  return nome ? { config: { requireList: nome } } : null
}
