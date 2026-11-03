# Agendamento — frente G

Este documento existe para cumprir o critério 9 do pedido: *as pendências
estarem explicitamente registradas*. **A frente G não foi implementada nesta
onda**, e não foi por falta de trabalho — está bloqueada numa decisão de
arquitetura que é do dono.

Ele registra três coisas: por que o agendamento da `v2` é placebo (medido), qual
é a objeção que ninguém respondeu, e qual é o desenho correto se a decisão for
seguir.

---

## 1. O que a `v2` entregou, medido na árvore dela

Medições feitas em `/home/kanox/auditoria-v2`, worktree destacada no commit
`626552b` (*"feat: scheduler de mensagens agendadas e seed de templates na
conexão"*). **Nada disso existe em `v3`** — nada foi portado, por decisão
registrada no plano.

| # | defeito | prova |
|---|---|---|
| **G-1** | **o scheduler nunca roda.** Abre `path.join(PASTA_DADOS, 'engine.db')` (`src/connection.js:314`). O banco é `engine.sqlite` dentro de `PASTA_ENGINE` (`src/engine/paths.js:7-8`) — **pasta errada e nome errado** | `sed -n '311,318p' src/connection.js` |
| **G-2** | e **falha em silêncio**: se o arquivo não existe, loga `scheduler: engine.db não encontrado, poll desativado` e **retorna**. É por isso que ninguém notou | `src/connection.js:315-318` |
| **G-3** | `evaluator.js:745` lança `ReferenceError`. `automationId: candidato?.automation_id \|\| null` dentro de `case 'action.whatsapp.schedule'`, e **`candidato` não é declarado nesse escopo** — as declarações estão em `:1361` e `:1374`. Optional chaining **não** protege contra identificador inexistente | `grep -n candidato src/engine/server/evaluator.js` |
| **G-4** | **`scheduler.agendar` não é chamado em lugar nenhum.** `grep -rn "\.agendar(" src/` é **vazio**. `executarAgendamento` só manda o texto de confirmação: a pessoa recebe "agendado" e **nada é agendado** | o grep |
| **G-5** | `buscarPendentes` **não filtra `target_account_id`**. O `SELECT` tem dois parâmetros, `scheduled_at <= ?` e `LIMIT ?`, e a coluna existe na tabela (`scheduler.js:20`) sem ser usada no filtro — risco de uma conta enviar o agendamento de outra | `sed -n '23,27p' src/engine/server/scheduler.js` |
| **G-6** | **vazamento de descritor e de temporizador.** `new Database(...)` a cada reconexão e `grep -c "db.close()" src/connection.js` = **0**; `schedulerTimer` nunca é limpo na desconexão | o grep |

### E consertar o caminho seria pior que deixar quebrado

Este é o ponto que não se vê olhando o defeito G-1 isolado. Apontar o caminho
certo abriria um **segundo escritor** no banco do motor, a partir do **gateway**.
Isso quebra a fronteira que organiza o projeto inteiro:

> **O gateway RELATA; o motor GRAVA.**

É a mesma fronteira que fez o defeito raro de WAL do `better-sqlite3` ser
classificado como não urgente — o motor centraliza numa conexão. Um poll do
gateway escrevendo no `engine.sqlite` reintroduz exatamente a condição que
tornava o defeito alcançável.

Então G-1 **não tem conserto de uma linha**. O agendamento tem de nascer do lado
do motor, e é por isso que o plano o classificou como **reescrita do zero**.

### Os portões que a ação da v2 não passou

`action.whatsapp.schedule` passou **5 dos 9 portões**. Faltaram:

| portão | estado na v2 |
|---|---|
| catálogo de ações do painel (`src/web/public/logic/acoes.js`) | ausente |
| asserção de lista exata (`tests/engine-editor-contract.test.mjs`) | não atualizada |
| qualquer template no catálogo | nenhum |
| executor coerente no gateway | existe, mas só confirma |

Uma ação em cinco camadas é o defeito do escopo `local` outra vez — a lição que
este projeto já pagou duas vezes.

---

## 2. A OBJEÇÃO QUE NINGUÉM RESPONDEU — e é por isso que a frente está parada

O painel das três IAs debateu isto em duas rodadas, inclusive cruzada (cada uma
vendo a posição das outras). O resultado está registrado no plano e vale repetir
aqui porque é a razão do bloqueio.

**Primeira rodada (cega):** Gemini disse que agendamento quebra o isolamento;
ChatGPT e Grok propuseram um worker sem notar o conflito.

**Rodada cruzada:** ChatGPT e Grok sustentaram o **não**, com a mesma razão, e
ela é boa:

> *o Gemini confundiu origem de um evento com fronteira de comunicação.
> Isolamento controla fronteiras de comunicação; não exige que o sistema seja
> incapaz de executar tarefas sozinho.*

O Gemini **cedeu no conceito** — mas sustentou no arquitetural, e é esta parte
que continua de pé, sem resposta de ninguém:

> *um worker temporal acorda sem remetente, sem grupo e sem mensagem de entrada;
> ele exige forjar um CONTEXTO SINTÉTICO. Venceram na semântica de dicionário,
> mas ignoraram a complexidade de transformar um motor puramente reativo num
> orquestrador com estado temporal ativo.*

### Por que isso é específico, e não filosofia

Todo o avaliador é construído em cima de um evento canônico que tem remetente,
conversa e mensagem. É de lá que saem `{{sender.id}}`, `{{chat.id}}`,
`{{message.args}}`, a resolução de admin, a trava de dono, o escopo de variável
`target`, e a chave de serialização da fila de admissão — que **é a conversa**
(`src/engine/fila.js:179`).

Um disparo temporal não tem nenhuma dessas coisas. Então agendar exige decidir,
antes de escrever uma linha:

| pergunta | por que não tem resposta óbvia |
|---|---|
| quem é o remetente de um comando que ninguém mandou? | a automação? o dono? ninguém? cada escolha muda permissão e trava de dono |
| qual é a chave de serialização? | sem conversa de origem, a fila perde a garantia de ordem que ela existe para dar |
| `{{sender.isAdmin}}` responde o quê? | a informação é de um momento que já passou; decidir permissão com dado velho é o defeito que o porteiro foi construído para evitar |
| o que acontece se o grupo não existir mais? | hoje nenhum caminho do motor precisa tratar isso |

**Isto não é objeção contra agendar. É o trabalho real de agendar**, e nenhum
dos três painéis o estimou. É decisão de arquitetura, não de código — e por isso
está aqui em vez de meio-implementada.

---

## 3. O desenho correto, se a decisão for seguir

Registrado para que a decisão seja tomada com o custo visível, não como
compromisso.

**Lado do motor, nunca do gateway.** O motor já tem o banco, as migrações, a
fila, os limites e as permissões. O gateway recebe comando e envia.

**Pelos nove portões, as nove.** Palavra em `src/lcn/vocabulario.js`; schema;
`ACOES_SUPORTADAS` em `runtimeCapabilities.js`; `case` no avaliador; executor no
gateway; catálogo do painel (`acoes.js`); asserção de lista exata em
`tests/engine-editor-contract.test.mjs`; teste de ida e volta; e um template no
catálogo. **Cinco não bastam** — a v2 provou.

**Migração nova, numerada por quem despacha.** Próximo número livre é **012**
(ver `MIGRATION.md` §2.3). A tabela da v2 serve de referência de forma, nunca de
commit, e `target_account_id` entra **no filtro**, não só na tabela.

**O que a reescrita tem de cobrir** — a lista do pedido, inteira: data e hora,
fuso, destinatário, autorização, estado, edição, cancelamento, **retomada após
reinício**, idempotência, concorrência entre workers e histórico. Reusando fila,
limites e permissões que já existem, **sem agendador paralelo**.

**E o contexto sintético tem de ser decidido primeiro, não descoberto no meio.**
É o item 1 da lista, não o último.

---

## 4. O que NÃO entra

| item | razão |
|---|---|
| qualquer arquivo de `src/engine/server/scheduler.js` da v2 | reescrita do zero; a forma da tabela serve de leitura |
| poll do gateway no banco do motor | quebra a fronteira relata/grava |
| `setTimeout` por agendamento | já recusado neste projeto com razão escrita: troca 10 mil itens de fila por 10 mil temporizadores vivos, e **perde a tentativa num reinício** |
| `sem vaga: tenta de novo` como palavra da linguagem | fora da v1 — não existe estado "agendado" no protocolo (`evaluator.js` conhece `sent`, `failed`, `outcome_unknown`). O compilador **recusa** a palavra, com erro que diz por quê |

---

## 5. Estado nesta árvore

| item | estado |
|---|---|
| `src/engine/server/scheduler.js` | **não existe** em `v3` |
| `action.whatsapp.schedule` | **não existe** em `ACOES_SUPORTADAS` |
| migração de agendamento | **não escrita** |
| template de agendamento | **nenhum** |
| decisão do contexto sintético | **pendente, do dono** |

Nada da frente G foi portado, escrito ou ativado. O bloqueio é decisão, não
trabalho — e está registrado na parte **J** do `FINAL_REPORT.md` com este
documento como referência.
