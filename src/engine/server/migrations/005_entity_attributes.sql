CREATE TABLE entity_attributes (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('contact', 'group')),
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_kind, scope_id, key)
);

CREATE INDEX idx_entity_attributes_scope ON entity_attributes(scope_kind, scope_id);
