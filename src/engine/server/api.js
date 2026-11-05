import { criarRoteador } from './transport.js'
import { registrarRotasInstances } from './routes/instances.js'
import { registrarRotasPools } from './routes/pools.js'
import { registrarRotasConnections } from './routes/connections.js'
import { registrarRotasAutomations } from './routes/automations.js'
import { registrarRotasEvents } from './routes/events.js'
import { registrarRotasMeta } from './routes/meta.js'
import { registrarRotasExecutions } from './routes/executions.js'
import { registrarRotasEntities } from './routes/entities.js'
import { registrarRotasTemplates } from './routes/templates.js'
import { registrarRotasPacotes } from './routes/pacotes.js'
import { registrarRotasPerfis } from './routes/perfis.js'
import { registrarRotasOwners } from './routes/owners.js'
import { registrarRotasMenu } from './routes/menu.js'
import { registrarRotasRetencao } from './routes/retencao.js'
import { registrarRotasEnquetes } from './routes/enquetes.js'
import { criarServicoDeEnquetes } from './enquetesService.js'

export function criarApi (db, opcoes = {}) {
  const roteador = criarRoteador()
  roteador.get('/health', () => ({ ok: true, status: 'ok', schemaVersion: 1 }))
  registrarRotasInstances(roteador, db)
  registrarRotasOwners(roteador, db)
  registrarRotasMenu(roteador, db)
  registrarRotasPools(roteador, db)
  registrarRotasConnections(roteador, db)
  registrarRotasAutomations(roteador, db)
  registrarRotasEvents(roteador, db)
  registrarRotasExecutions(roteador, db)
  registrarRotasEntities(roteador, db)
  registrarRotasTemplates(roteador, db)
  const { servico: provisionamento } = registrarRotasPacotes(roteador, db)
  registrarRotasPerfis(roteador, db, { provisionamento, env: opcoes.env ?? process.env })
  registrarRotasRetencao(roteador, db)
  registrarRotasEnquetes(roteador, criarServicoDeEnquetes(db))
  registrarRotasMeta(roteador, db)
  return roteador
}
