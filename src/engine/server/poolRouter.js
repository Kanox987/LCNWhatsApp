// Seleção ponderada de instância dentro de um pool.
//
// O avaliador chama isto quando a automação declara
// responder.strategy = 'weighted_rendezvous'. Se o pool não tem membros
// habilitados, retorna null e o avaliador faz fallback para evento.accountId
// (mesmo comportamento de antes da feature existir).

const stmtCache = new WeakMap()

function obterStmt(db) {
  let stmt = stmtCache.get(db)
  if (!stmt) {
    stmt = db.prepare(`
      SELECT i.account_id, pm.weight
      FROM pool_members pm
      JOIN instances i ON i.id = pm.instance_id
      WHERE pm.pool_id = ? AND pm.enabled = 1
      ORDER BY pm.instance_id
    `)
    stmtCache.set(db, stmt)
  }
  return stmt
}

/**
 * Selects an instance from a pool using weighted random selection.
 * Returns the account_id of the selected instance, or null if no eligible members.
 *
 * @param {object} db - better-sqlite3 database handle
 * @param {string} poolId - pool identifier from documento.responder.poolId
 * @returns {string|null} account_id of selected instance, or null
 */
export function selecionarInstanciaDoPool(db, poolId) {
  if (!poolId) return null
  const membros = obterStmt(db).all(poolId)
  if (membros.length === 0) return null

  let soma = 0
  for (const m of membros) soma += m.weight
  if (soma <= 0) return null

  const alvo = Math.random() * soma
  let acumulado = 0
  for (const m of membros) {
    acumulado += m.weight
    if (acumulado > alvo) return m.account_id
  }
  // Arredondamento: retorna o último se o float caiu exatamente na borda.
  return membros[membros.length - 1].account_id
}