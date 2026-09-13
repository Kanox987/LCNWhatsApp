-- Catálogo de variáveis conhecidas — o que EXISTE, não o que VALE.
--
-- Separada de entity_attributes de propósito. Aquela guarda valor, e um valor
-- só nasce quando alguém grava: até a primeira infração, o contador de avisos
-- do anti-link não existe em lugar nenhum e ninguém sabe que ele deveria.
-- Esta guarda a declaração: "este comando usa var.member.avisos, é um número,
-- serve para contar infrações". Assim a variável aparece na aba assim que o
-- comando é instalado.
--
-- Por que não dá para simplesmente criar a linha de valor no install: uma
-- linha de entity_attributes exige (scope_kind, scope_id) concretos, e os
-- escopos mais usados (sender, group_member, target) só são resolvíveis a
-- partir de um EVENTO. No momento da instalação não existe scope_id.

CREATE TABLE declared_variables (
  -- Escopo declarado como a automação o escreve ('member', 'sender', 'chat',
  -- 'global', 'category'), não o scope_kind da tabela de valores — é isto que
  -- a pessoa lê na tela como {{var.<escopo>.<chave>}}.
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  -- 'number' habilita contador; 'text' e 'boolean' são valor simples.
  value_type TEXT NOT NULL DEFAULT 'text' CHECK (value_type IN ('text', 'number', 'boolean')),
  description TEXT,
  -- De onde veio: o templateId que a declarou, ou NULL quando foi a pessoa
  -- que criou à mão pela aba Dados.
  source_template TEXT,
  -- A automação concreta que a instalou. ON DELETE SET NULL: apagar a
  -- automação não apaga a declaração, porque o VALOR pode continuar existindo
  -- e a pessoa ainda precisa entender o que é aquilo.
  source_automation TEXT REFERENCES automations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE INDEX idx_declared_variables_template ON declared_variables(source_template);
