-- Chaves de API para acesso programático à engine.
-- Vinculadas a um owner (contact_id): quem cria a chave é o dono dela,
-- e revogar o dono revoga todas as chaves dele por cascata lógica.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,              -- prefixo público (ex: "lcn_abc...")
  key_hash TEXT NOT NULL,           -- SHA-256 do token completo
  owner_contact_id TEXT NOT NULL,   -- FK lógica para entity_attributes(contact)
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT                   -- NULL = ativa; preenchido = revogada
);

CREATE INDEX idx_api_keys_owner ON api_keys(owner_contact_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;