-- Módulo 5 da Parte C: automações nativas (ex: /menu) que o motor mesmo
-- garante que existam, sempre disponíveis em QUALQUER chat sem exigir
-- scope.include explícito (a regra "scope vazio nunca casa com tudo" é
-- pra automação AUTORADA POR USUÁRIO — /menu é conteúdo do sistema, não
-- do usuário).
ALTER TABLE automations ADD COLUMN native INTEGER NOT NULL DEFAULT 0;
