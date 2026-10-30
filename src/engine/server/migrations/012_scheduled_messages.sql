-- Agendamento de mensagens: tabela para armazenar mensagens agendadas
-- que serão enviadas automaticamente quando o horário chegar.
--
-- O scheduler roda no gateway (que tem a conexão WhatsApp), mas os dados
-- vivem no engine (que é dono do banco). O gateway consulta periodicamente
-- as mensagens vencidas e as envia como comandos normais.
--
-- `scheduled_at` é UTC. O gateway converte para o fuso local na hora de
-- enviar, se necessário. A automação que agenda já guarda em UTC.
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  automation_id TEXT REFERENCES automations(id) ON DELETE SET NULL,
  target_account_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  error_text TEXT
);

-- Índice para o poll do scheduler: só busca pendentes ordenados por data.
CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_messages(status, scheduled_at)
  WHERE status = 'pending';

-- Índice para auditoria: ver agendamentos de uma automação específica.
CREATE INDEX IF NOT EXISTS idx_scheduled_automation ON scheduled_messages(automation_id);