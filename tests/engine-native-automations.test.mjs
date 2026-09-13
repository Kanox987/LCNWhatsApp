// Módulo 5 da Parte C do plano — garantirAutomacoesNativas() (chamada de
// dentro de abrirBanco()) e o filtro de listagem que esconde automações
// nativas do wizard normal. Banco :memory: — nunca o banco real do motor.
import { abrirBanco } from '../src/engine/server/db.js'
import { garantirAutomacoesNativas } from '../src/engine/server/nativeAutomations.js'
import { criarApi } from '../src/engine/server/api.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })

try {
  const automacao = db.prepare('SELECT * FROM automations WHERE id = ?').get('__native_menu__')
  check('abrirBanco() já semeia a automação nativa /menu sozinho, sem chamada manual', !!automacao)
  check('automação nativa nasce habilitada, ao vivo, com revisão ativa', automacao.enabled === 1 && automacao.deployment_mode === 'live' && automacao.active_revision_id !== null)
  check('coluna native marca a automação corretamente', automacao.native === 1)

  const pool = db.prepare('SELECT * FROM pools WHERE id = ?').get('__native__')
  check('pool reservado pra automações nativas existe', !!pool)

  const contagemAntes = db.prepare('SELECT COUNT(*) AS n FROM automations').get().n
  garantirAutomacoesNativas(db)
  garantirAutomacoesNativas(db)
  const contagemDepois = db.prepare('SELECT COUNT(*) AS n FROM automations').get().n
  check('chamar garantirAutomacoesNativas() de novo é idempotente (não duplica linha)', contagemAntes === contagemDepois)

  const api = criarApi(db)
  const listaPublica = await api.resolver('GET', '/automations', contexto())
  check('GET /automations NUNCA inclui a automação nativa (não é editável pelo wizard genérico)', !listaPublica.some((a) => a.id === '__native_menu__'))
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado no teste de automações nativas:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE AUTOMAÇÕES NATIVAS PASSARAM')
process.exit(falhas ? 1 : 0)
