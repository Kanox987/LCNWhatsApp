import crypto from 'node:crypto'
import { ehDono } from './owners.js'

const PREFIXO = 'lcn_'

export function gerarChaveApi () {
  const raw = PREFIXO + crypto.randomBytes(32).toString('base64url')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

export function criarChave (db, { ownerContactId, label }) {
  if (!ehDono(db, ownerContactId)) {
    throw new Error('Apenas owners podem ter chaves de API.')
  }
  const { raw, hash } = gerarChaveApi()
  const id = PREFIXO + raw.slice(PREFIXO.length, PREFIXO.length + 8)
  const agora = new Date().toISOString()
  db.prepare(`INSERT INTO api_keys (id, key_hash, owner_contact_id, label, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(id, hash, ownerContactId, label, agora)
  return { id, key: raw, label, createdAt: agora }
}

export function validarChave (db, token) {
  if (typeof token !== 'string' || !token.startsWith(PREFIXO)) return null
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const row = db.prepare(`SELECT id, owner_contact_id FROM api_keys
    WHERE key_hash = ? AND revoked_at IS NULL`).get(hash)
  if (!row) return null
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id)
  return { keyId: row.id, ownerContactId: row.owner_contact_id }
}

export function listarChavesDoOwner (db, ownerContactId) {
  return db.prepare(`SELECT id, label, created_at, last_used_at, revoked_at
    FROM api_keys WHERE owner_contact_id = ? ORDER BY created_at DESC`)
    .all(ownerContactId)
}

export function revogarChave (db, keyId, ownerContactId) {
  const resultado = db.prepare(`UPDATE api_keys SET revoked_at = ?
    WHERE id = ? AND owner_contact_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), keyId, ownerContactId)
  if (!resultado.changes) throw new Error('Chave não encontrada ou já revogada.')
  return { revoked: true, keyId }
}