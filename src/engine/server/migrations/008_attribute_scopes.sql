-- Expande os escopos de variável/contador. A 005 criou a tabela com
-- CHECK (scope_kind IN ('contact','group')) e o SQLite não altera um CHECK
-- sem recriar a tabela — daí o recriar-e-copiar abaixo, preservando tudo que
-- já existe (o painel já grava atributos reais de contato e grupo).
--
-- Escopos novos e o que cada um endereça:
--   contact       -> uma pessoa, valendo em qualquer conversa
--   group         -> o grupo inteiro
--   group_member  -> uma pessoa DENTRO de um grupo específico. Moderação quase
--                    sempre quer isto: 3 avisos no grupo A não podem somar com
--                    os do grupo B. scope_id é "<jid do grupo>|<jid da pessoa>",
--                    montado pelo motor — o grupo nunca é codificado dentro do
--                    NOME da variável.
--   category      -> um rótulo que agrupa contatos (ex: "vip"). Quem pertence
--                    à categoria continua sendo definido por um atributo comum
--                    no contato, então não existe tabela de associação: aqui
--                    mora só o contador compartilhado da categoria.
--   global        -> do sistema, não pertence a ninguém. scope_id é sempre a
--                    constante '__global__'.

CREATE TABLE entity_attributes_novo (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('contact', 'group', 'group_member', 'category', 'global')),
  scope_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_kind, scope_id, key)
);

INSERT INTO entity_attributes_novo (scope_kind, scope_id, key, value_json, updated_at)
  SELECT scope_kind, scope_id, key, value_json, updated_at FROM entity_attributes;

DROP TABLE entity_attributes;

ALTER TABLE entity_attributes_novo RENAME TO entity_attributes;

CREATE INDEX idx_entity_attributes_scope ON entity_attributes(scope_kind, scope_id);
