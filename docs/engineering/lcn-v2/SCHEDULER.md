# Agendamento — frente G

**Estado: implementado em `v3` (04/11/2026), no motor.** Este documento começou
como o registro de uma frente parada numa decisão do dono; a decisão foi
tomada e a frente foi reescrita do zero. O texto abaixo guarda o que a `v2`
entregou (medido, e descartado), a objeção que bloqueou a frente, e como cada
ponto dela foi resolvido no código.

Commits: `50604c9` (interpretador de tempo), `2f8136f` (classe `agendado` na
linguagem), `178bd20` (agendador no motor), `4ba0dd9` (achados da revisão),
`67e94c0` (reconciliação sem parsear tudo, retenção). Testes:
`tests/lcn-tempo.test.mjs`, `tests/lcn-agendado.test.mjs`,
`tests/agendador.test.mjs`, `tests/retencao-agenda.test.mjs`.

---

## 1. O que a `v2` entregou, medido na árvore dela — e descartado

Medições feitas em `/home/kanox/auditoria-v2`, worktree destacada no commit
`626552b`. **Nada disso foi portado.**

| # | defeito | prova |
|---|---|---|
| **G-1** | **o scheduler nunca roda.** Abre `engine.db` na pasta de dados; o banco é `engine.sqlite` em `PASTA_ENGINE` (`src/engine/paths.js`) | `sed -n '311,318p' src/connection.js` na `v2` |
| **G-2** | e **falha em silêncio**: arquivo ausente → loga e retorna | `src/connection.js:315-318` na `v2` |
| **G-3** | `evaluator.js:745` lança `ReferenceError` (`candidato` não declarado nesse escopo) | `grep -n candidato` na `v2` |
| **G-4** | **`scheduler.agendar` não é chamado em lugar nenhum**: a pessoa recebe "agendado" e nada é agendado | `grep -rn "\.agendar(" src/` vazio |
| **G-5** | `buscarPendentes` não filtra `target_account_id`: uma conta poderia enviar o agendamento de outra | `scheduler.js:23-27` na `v2` |
| **G-6** | vazamento de descritor e de temporizador | `grep -c "db.close()"` = 0 |

Consertar o caminho teria sido pior que deixar quebrado: apontar o arquivo certo
abriria um **segundo escritor** no banco do motor, a partir do gateway, e quebra
a fronteira que organiza o projeto — **o gateway RELATA; o motor GRAVA.** Por
isso foi reescrita, não conserto.

---

## 2. A objeção que bloqueava a frente, e a resposta que o código deu

A objeção (Gemini, sustentada na rodada cruzada): um disparo temporal acorda
**sem remetente, sem grupo e sem mensagem de entrada**, e o avaliador inteiro é
construído sobre um evento canônico que tem as três coisas. O trabalho real de
agendar era decidir o contexto sintético **antes** de escrever código.

| pergunta | como ficou |
|---|---|
| quem é o remetente de um comando que ninguém mandou? | `REMETENTE_DO_RELOGIO = '__schedule__'`. Não é o dono nem admin: sem `isAdmin` no evento, quem exige `acesso: admins` não passa. O dono não é forjado |
| quem pode produzir um evento do relógio? | só o próprio motor. `POST /events` **recusa** o evento do relógio, e o avaliador acorda **apenas a automação dona** do disparo |
| qual é a chave de serialização? | a conversa de destino, como em qualquer evento: os destinos vêm do `onde:` da automação (grupos e contatos fixos) |
| `{{sender.isAdmin}}` responde o quê? | nada: o campo não existe no evento do relógio, e permissão não é decidida com dado de um momento que passou |
| de qual número sai a mensagem? | o `responder` da automação: pool → membro ligado de maior peso (desempate pelo id); sem pool, a única instância. **Ambíguo ou vazio = o disparo vira `ignorado` com o motivo.** Escolher ao acaso mandaria pelo número errado |
| e se o grupo não existe mais? | o envio passa pelos mesmos portões e falha como qualquer envio; o disparo fica registrado com o resultado |

## 3. O desenho

**Lado do motor.** `src/engine/server/agendador.js` é o relógio; não há segundo
agendador.

1. `reconciliar` olha as automações publicadas **e ligadas** e garante que cada
   revisão agendada tenha o primeiro disparo em `schedule_jobs` (migração
   `015_agenda.sql`); cancela o que ficou órfão (desligada, despublicada,
   revisão substituída). Compara o estado a cada passada, então vale para
   publicar, instalar modelo, pacote e edição, sem fiação em cada caminho. Filtra
   por `instr(doc_json, '"trigger.schedule"')` antes de parsear.
2. `tick` pega os vencidos e reivindica cada um com `UPDATE ... WHERE status =
   'pending'` (confere `changes === 1`), na mesma transação que semeia a próxima
   ocorrência. O `eventId` é determinístico
   (`schedule:<automação>:<revisão>:<conversa>:<instante>`), então repetir é
   inofensivo.
3. O relógio é injetado (`agora`): teste não espera tempo passar.

**Política de tempo parado.** Atraso dentro da tolerância (5 min) dispara; além
dela vira `perdido`, com o motivo. Recorrente **nunca** dispara em rajada: a
próxima ocorrência conta a partir de agora, então três dias parado deixam um
`perdido`, não três mensagens. Reivindicado há mais de 2 min e nunca concluído é
órfão e é conferido contra `inbound_events` antes de voltar à fila.

**Linguagem.** Quarta classe do `.lcn`, `agendado`, com cabeçalho `agenda:` e
`fuso:` (`daqui 30 minutos`, `23/08/2030 às 14:30`, `todo dia às 8h`). O fuso é
validado também no motor (JSON enviado direto à API não publica fuso que nunca
dispararia). O interpretador de tempo (`src/lcn/tempo.js`) é módulo puro.

**Portões.** A ação nova passou pelas camadas: vocabulário, schema,
`runtimeCapabilities.js`, avaliador, catálogo do painel e teste de ida e volta.

**Retenção.** A varredura de agendamentos vencidos nunca apaga a última linha de
uma série: um disparo único não some.

## 4. O que continua de fora, com a razão

| item | razão |
|---|---|
| poll do gateway no banco do motor | quebra a fronteira relata/grava |
| `setTimeout` por agendamento | troca 10 mil itens de fila por 10 mil temporizadores vivos e **perde a tentativa num reinício** (D-11) |
| `sem vaga: tenta de novo` como palavra da linguagem | não existe estado "agendado" no protocolo de envio (`sent`, `failed`, `outcome_unknown`); o compilador recusa a palavra com o motivo (D-12) |
| destino calculado em tempo de disparo (ex.: "o grupo de quem pediu") | o evento do relógio não tem autor; os destinos são os fixos do `onde:` |

## 5. Estado nesta árvore

| item | estado |
|---|---|
| `src/engine/server/agendador.js` | **existe**, único relógio |
| migração `015_agenda.sql` | aplicada pelo motor |
| `trigger.schedule` | em `ACOES_SUPORTADAS`/capacidades, no catálogo do painel e na linguagem |
| decisão do contexto sintético | **tomada** (§2) |
| validado em produção | **não** — validado localmente, com relógio injetado |
