CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE instances (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  capabilities_json TEXT,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pools (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pool_members (
  pool_id TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1.0,
  enabled INTEGER NOT NULL DEFAULT 1,
  overrides_json TEXT,
  PRIMARY KEY (pool_id, instance_id)
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  config_json TEXT,
  secret_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE automations (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  active_revision_id INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE automation_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  validation_errors_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (automation_id, revision)
);

CREATE TABLE automation_scopes (
  automation_revision_id INTEGER NOT NULL REFERENCES automation_revisions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL
);
