-- Índices de DATA, para a varredura de retenção não ler a tabela inteira.
--
-- A varredura apaga por "mais velho que", e as três tabelas de runtime só
-- tinham índice por relacionamento (event_id, run_id, conta+status). Sem isto
-- cada passada percorre tudo: na máquina do dono eram 453 mil execuções, de
-- hora em hora, para apagar algumas centenas.
--
-- O índice serve de graça à tela de Execuções, que ordena por data.
CREATE INDEX IF NOT EXISTS idx_inbound_events_recebido ON inbound_events(received_at);
CREATE INDEX IF NOT EXISTS idx_automation_runs_criado ON automation_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_outbound_commands_criado ON outbound_commands(created_at);
