-- As enquetes e os votos, guardados onde o resto do estado já mora.
--
-- Os votos chegavam ao gateway e eram jogados fora — 17 pacotes numa captura
-- de 40 minutos, todos registrados como "mensagem desconhecida". A primeira
-- versão da contagem viveu em MEMÓRIA do gateway, e recomeçava a cada
-- reinício. Uma revisão chamou isso de defeito de confiabilidade, com razão:
-- enquete de reunião aberta à noite não pode perder os votos porque o bot
-- subiu de novo de manhã.
--
-- POR QUE AQUI E NÃO NUM BANCO DO GATEWAY: a outra proposta na mesa era dar
-- um SQLite próprio ao gateway. Isso cria dois bancos para manter, migrar e
-- sincronizar, e transforma a camada de protocolo em aplicação. O gateway
-- continua sem escrever aqui: ele RELATA ao motor, que é quem guarda.

-- O mapa de uma enquete: qual hash é qual opção.
--
-- O WhatsApp manda o SHA-256 do nome da opção no voto, nunca o nome. Os nomes
-- só passam em claro na mensagem de CRIAÇÃO — por isso o mapa é gravado ali, e
-- por isso dá para contar enquete que qualquer pessoa criou, não só as do bot.
CREATE TABLE IF NOT EXISTS poll_options (
  poll_id     TEXT NOT NULL,
  chat_id     TEXT,
  option_hash TEXT NOT NULL,
  option_name TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (poll_id, option_hash)
);

CREATE INDEX IF NOT EXISTS idx_poll_options_chat ON poll_options(chat_id, created_at);

-- O voto de UMA pessoa numa enquete, no estado atual dela.
--
-- A chave primária é (enquete, pessoa, opção) e a gravação é um UPSERT com
-- apagamento do que não veio: o WhatsApp manda o ESTADO COMPLETO da escolha a
-- cada alteração, não um incremento. Somar contaria a mesma pessoa de novo a
-- cada troca de voto, e o total passaria do tamanho do grupo — foi o erro que
-- uma das propostas de desenho tinha, e que esta forma torna impossível.
--
-- `voter_id` é normalizado antes de chegar aqui: a mesma pessoa aparece ora
-- como @lid, ora como telefone, e sem normalizar trocar de voto a contaria
-- duas vezes.
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id     TEXT NOT NULL,
  voter_id    TEXT NOT NULL,
  option_hash TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (poll_id, voter_id, option_hash)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_enquete ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_data ON poll_votes(updated_at);
