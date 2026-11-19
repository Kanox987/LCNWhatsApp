-- A recuperação de visualização única saiu do LCN: o WhatsApp mudou o
-- tratamento desses arquivos, e o nó `action.whatsapp.recover` deixou de
-- existir no motor. Automação instalada com ele (x9, auto-recover,
-- recuperar-visu-unica e afins) continuaria ligada e cairia no `default` do
-- avaliador a cada mensagem, gravando um erro por evento.
--
-- Aqui ela só é DESLIGADA. Nada é apagado: revisões, histórico de execuções e
-- atributos (`recover_destino`, `auto_recover`) ficam, e o painel mostra o
-- aviso a partir de `nosRemovidos.js`, com "Tirar do ar" como saída. Ligar de
-- novo é recusado pela rota (409).
--
-- O filtro olha o TIPO do nó, não um texto qualquer do documento: uma
-- resposta que só cita a palavra não é desligada. `instr` corta antes do parse
-- quem nem cita o tipo, e o `CASE` com `json_valid` garante que um `doc_json`
-- malformado nunca derrube a partida (o `CASE` do SQLite só avalia o ramo
-- escolhido).
--
-- O nó não basta: config-auto-recover (/autorecover) e config-recover
-- (/configrecover) só gravam uma variável e respondem, sem o nó. Ligados,
-- seguiriam prometendo a recuperação. Por isso também cai quem tem
-- proveniência num dos modelos retirados (MODELOS_REMOVIDOS em
-- nosRemovidos.js; as duas listas andam juntas).
UPDATE automations
SET enabled = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE enabled = 1
  AND (
    active_revision_id IN (
      SELECT r.id
      FROM automation_revisions r
      WHERE instr(r.doc_json, '"action.whatsapp.recover"') > 0
        AND CASE WHEN json_valid(r.doc_json) THEN EXISTS (
          SELECT 1 FROM json_each(r.doc_json, '$.flow.nodes') n
          WHERE json_extract(n.value, '$.type') = 'action.whatsapp.recover'
        ) ELSE 0 END
    )
    OR id IN (
      SELECT automation_id
      FROM automation_template_provenance
      WHERE template_id IN ('x9', 'auto-recover', 'config-auto-recover', 'recuperar-visu-unica', 'config-recover')
    )
  );
