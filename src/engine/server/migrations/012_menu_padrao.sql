-- O /menu deixa de ser automação NATIVA e passa a ser automação comum.
--
-- Esta tabela é a MEMÓRIA DE QUE A SEMEADURA JÁ ACONTECEU, e existe por um
-- motivo específico: sem ela, `migrarMenuLegado` não consegue distinguir
-- "o dono apagou o menu" de "esta instância nunca teve menu". O código antigo
-- (nativeAutomations.js) fazia `if (jaExiste) return` — então apagar o menu
-- pelo painel funcionava até o próximo reinício, quando ele ressuscitava.
-- Desativar era respeitado (a linha continuava lá); remover, não.
--
-- Com a marca gravada, remover o menu é definitivo, e "rodar a instância sem
-- menu nenhum" passa a ser um estado alcançável e estável — que é exatamente
-- o que o pedido da frente C exige.
--
-- Uma linha só (CHECK id = 1): é marca de instância, não histórico.
CREATE TABLE IF NOT EXISTS menu_padrao_semeadura (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  automation_id TEXT,
  semeado_em TEXT NOT NULL
);
