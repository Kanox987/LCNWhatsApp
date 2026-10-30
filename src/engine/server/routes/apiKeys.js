import { ErroHttp } from '../transport.js'
import { criarChave, listarChavesDoOwner, revogarChave } from '../apiKeys.js'
import { ehDono } from '../owners.js'

export function registrarRotasApiKeys (roteador, db) {
  roteador.get('/api-keys', ({ contextoAuth }) => {
    if (!contextoAuth?.ownerContactId) throw new ErroHttp(403, 'Autenticação necessária.')
    return { keys: listarChavesDoOwner(db, contextoAuth.ownerContactId) }
  })

  roteador.post('/api-keys', ({ body, contextoAuth }) => {
    if (!contextoAuth?.ownerContactId) throw new ErroHttp(403, 'Autenticação necessária.')
    const label = typeof body?.label === 'string' && body.label.trim()
      ? body.label.trim() : 'default'
    try {
      return criarChave(db, { ownerContactId: contextoAuth.ownerContactId, label })
    } catch (e) {
      throw new ErroHttp(400, e.message)
    }
  })

  roteador.delete('/api-keys/:keyId', ({ params, contextoAuth }) => {
    if (!contextoAuth?.ownerContactId) throw new ErroHttp(403, 'Autenticação necessária.')
    try {
      return revogarChave(db, params.keyId, contextoAuth.ownerContactId)
    } catch (e) {
      throw new ErroHttp(404, e.message)
    }
  })
}