CREATE INDEX idx_automation_runs_created ON automation_runs(created_at, id);
CREATE INDEX idx_automation_runs_automation_created ON automation_runs(automation_id, created_at, id);
CREATE INDEX idx_automation_runs_status_created ON automation_runs(status, created_at);
CREATE INDEX idx_outbound_commands_target_status_created ON outbound_commands(target_account_id, status, created_at);
