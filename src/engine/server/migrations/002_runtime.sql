-- Etapa 3.5 do plano: execução de verdade (antes só existia CRUD/validate).
-- deployment_mode por automação: 'shadow' (avalia e registra "teria
-- executado", nunca devolve comando executável) ou 'live' (devolve o
-- comando de verdade pro gateway). Substitui a ideia de uma "Etapa 3 modo
-- sombra" separada — é o MESMO avaliador, só muda o que ele devolve no final.
ALTER TABLE automations ADD COLUMN deployment_mode TEXT NOT NULL DEFAULT 'shadow';

-- Um evento canônico recebido de um gateway. id = eventId canônico
-- (já é determinístico por gateway — ver src/engine/canonicalEvent.js),
-- usado como chave de deduplicação: reenviar o mesmo evento nunca duplica
-- avaliação (INSERT OR IGNORE na rota).
CREATE TABLE inbound_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  chat_kind TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  message_kind TEXT NOT NULL,
  message_text TEXT,
  replay INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Um "run" = uma automação avaliada contra um evento. UNIQUE(event_id,
-- automation_revision_id) é a segunda camada de dedup: mesmo se /events for
-- chamado de novo pro mesmo evento (rede instável, retry do gateway), nunca
-- reavalia a mesma automação/revisão duas vezes pro mesmo evento.
CREATE TABLE automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES inbound_events(id),
  automation_id TEXT NOT NULL REFERENCES automations(id),
  automation_revision_id INTEGER NOT NULL REFERENCES automation_revisions(id),
  deployment_mode TEXT NOT NULL,
  status TEXT NOT NULL, -- 'matched_shadow' | 'matched_live' | 'no_match' | 'error'
  detail_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, automation_revision_id)
);

-- Uma instrução concreta pro gateway executar (ex: responder texto).
-- status começa 'pending', o gateway confirma via
-- POST /executions/:id/result -> sent | failed | outcome_unknown (nunca
-- reenviado automaticamente em caso de ambiguidade — ver plano, semântica
-- at-most-once).
CREATE TABLE outbound_commands (
  id TEXT PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES automation_runs(id),
  target_account_id TEXT NOT NULL,
  command_type TEXT NOT NULL, -- só 'whatsapp.reply' nesta etapa
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_automation_runs_event ON automation_runs(event_id);
CREATE INDEX idx_outbound_commands_run ON outbound_commands(run_id);
CREATE INDEX idx_outbound_commands_target ON outbound_commands(target_account_id, status);
