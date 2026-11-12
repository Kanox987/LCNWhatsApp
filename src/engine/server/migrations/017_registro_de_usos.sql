-- Quem usou o quê, e quando: o registro que deixa escrever limite de uso na
-- própria linguagem ("no máximo 3 /dow em 10 minutos por pessoa").
--
-- Uma linha por uso ANOTADO pelo fluxo (`anota uso`), nunca por mensagem que
-- passa: quem decide o que conta é a automação. `rule` é o nome que ela deu
-- (normalizado como o nome de lista), e é o que junta usos de comandos
-- diferentes na mesma conta — "/dow" e "/video" podem anotar em "downloads".
--
-- `person_id` é o jid já canônico (o adaptador troca LID por telefone antes de
-- o evento chegar ao motor). `chat_id` serve para contar só "aqui".
--
-- A varredura de retenção apaga o que passou da janela (`__retencao_usos__`,
-- padrão de 7 dias para limite semanal funcionar; 0 guarda para sempre).
CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY,
  rule TEXT NOT NULL,
  person_id TEXT NOT NULL,
  chat_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_usage_records_regra ON usage_records (rule, person_id, created_at);
CREATE INDEX idx_usage_records_data ON usage_records (created_at);
