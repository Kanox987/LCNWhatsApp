import { ErroHttp } from '../transport.js'
import { adicionarNaLista, limparLista, listasExistentes, membrosDaLista, normalizarNomeDeLista, removerDaLista } from '../listas.js'

// Mesmo formato dos donos: só dígitos antes do domínio. Um id inventado viraria
// uma linha que parece autorizar alguém e nunca corresponde a ninguém.
const JID_CONTATO = /^\d{5,20}@s\.whatsapp\.net$/

function exigirNome (valor) {
  const nome = normalizarNomeDeLista(decodeURIComponent(String(valor ?? '')))
  if (!nome) throw new ErroHttp(400, 'Nome de lista inválido: use letras minúsculas, números e "_", começando por letra (até 32).')
  return nome
}

function exigirJid (valor) {
  if (typeof valor !== 'string' || !JID_CONTATO.test(valor)) {
    throw new ErroHttp(400, 'Informe o contato no formato 5511999999999@s.whatsapp.net.')
  }
  return valor
}

export function registrarRotasListas (roteador, db) {
  roteador.get('/listas', () => ({ lists: listasExistentes(db) }))

  roteador.get('/listas/:nome', ({ params }) => {
    const nome = exigirNome(params.nome)
    return { name: nome, members: membrosDaLista(db, nome) }
  })

  roteador.post('/listas/:nome/membros', ({ params, body }) => {
    const nome = exigirNome(params.nome)
    const contactId = exigirJid(body?.contactId)
    const r = adicionarNaLista(db, nome, contactId)
    return { name: nome, contactId, changed: r.mudou }
  })

  roteador.delete('/listas/:nome/membros/:contactId', ({ params }) => {
    const nome = exigirNome(params.nome)
    const contactId = exigirJid(decodeURIComponent(params.contactId))
    const r = removerDaLista(db, nome, contactId)
    return { name: nome, contactId, changed: r.mudou }
  })

  roteador.delete('/listas/:nome', ({ params }) => {
    const nome = exigirNome(params.nome)
    return { name: nome, removed: limparLista(db, nome).removidos }
  })
}
