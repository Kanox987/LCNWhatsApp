-- O RELÓGIO DO MOTOR: uma linha por disparo marcado.
--
-- A automação `agendado` (`trigger.schedule`) não reage a mensagem nenhuma; ela
-- reage ao tempo. Quem acorda é o agendador do próprio motor (agendador.js), que
-- varre esta tabela e entrega o disparo ao avaliador como evento interno. O
-- gateway não toca aqui: ele relata o que viu no WhatsApp, o motor é quem grava.
--
-- `revision` faz parte da chave porque editar a automação cria revisão nova, e
-- revisão nova é um agendamento novo ("daqui 30 minutos" volta a contar do
-- zero). Salvar sem mudar nada não cria revisão e, portanto, não reinicia nada.
--
-- `anchor` é de onde a série conta (só importa para "a cada N minutos": o
-- disparo n é âncora + n·N, então um atraso do motor não desloca a série).
--
-- A chave única (automation_id, revision, chat_id, scheduled_for) é o que
-- impede a mesma ocorrência de existir duas vezes, e o `UPDATE ... WHERE
-- status = 'pending'` do agendador é o que impede dois workers de dispararem a
-- mesma linha.
CREATE TABLE schedule_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  chat_kind TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  anchor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'done', 'perdido', 'cancelado', 'ignorado', 'erro')),
  detail TEXT,
  fired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (automation_id, revision, chat_id, scheduled_for)
);

CREATE INDEX idx_schedule_jobs_due ON schedule_jobs(status, scheduled_for);
