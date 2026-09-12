import { criarRoteador } from './transport.js'
import { registrarRotasInstances } from './routes/instances.js'
import { registrarRotasPools } from './routes/pools.js'
import { registrarRotasConnections } from './routes/connections.js'
import { registrarRotasAutomations } from './routes/automations.js'

export function criarApi (db) {
  const roteador = criarRoteador()
  roteador.get('/health', () => ({ ok: true, status: 'ok', schemaVersion: 1 }))
  registrarRotasInstances(roteador, db)
  registrarRotasPools(roteador, db)
  registrarRotasConnections(roteador, db)
  registrarRotasAutomations(roteador, db)
  return roteador
}
