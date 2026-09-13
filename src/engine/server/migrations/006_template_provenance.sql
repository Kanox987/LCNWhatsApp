CREATE TABLE automation_template_provenance (
  automation_id TEXT PRIMARY KEY REFERENCES automations(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  parameters_json TEXT NOT NULL,
  installed_at TEXT NOT NULL
);
