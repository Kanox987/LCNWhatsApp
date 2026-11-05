-- Quais perfis de provisionamento já foram aplicados a este motor, e com que
-- resultado.
--
-- O perfil é aplicado na PRIMEIRA subida do container. Sem este registro o
-- motor não teria como distinguir "primeira subida" de "reinício": ou
-- reaplicaria o perfil a cada reinício (e passaria por cima do que o dono
-- mexeu), ou nunca aplicaria. A chave é (profile_id, profile_version) e o hash
-- do conteúdo vai junto: a mesma versão com outro conteúdo é um erro de quem
-- escreveu o perfil, e só se descobre se o hash estiver guardado.
--
-- `status` diz por que um perfil NÃO está aplicado, porque a conduta de cada
-- falha é diferente (quem lê o registro precisa saber o que fazer):
--   applied            está no ar; não se repete
--   blocked            o perfil pede o que este motor não tem (parâmetro,
--                      pool, conexão, política). Não repete a cada reinício:
--                      só muda com perfil novo ou com --retry
--   needs_operator     a instância tem automação editada ou em conflito; uma
--                      pessoa precisa decidir. Também não repete sozinho
--   transient_failure  falha de motor, não do perfil: tenta de novo
--
-- `error_summary` guarda só a frase de erro (cortada), nunca parâmetros nem
-- corpo — o registro pode ser lido por quem não deveria ver credencial.
CREATE TABLE provisioning_profile_applications (
  profile_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'blocked', 'needs_operator', 'transient_failure')),
  applied_at TEXT,
  last_attempt_at TEXT NOT NULL,
  error_code TEXT,
  error_summary TEXT,
  PRIMARY KEY (profile_id, profile_version)
);
