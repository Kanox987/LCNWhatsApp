# MIGRATION — migrações de esquema do motor

Escrito em 01/11/2026. Cada afirmação aqui aponta arquivo e linha, e foi
conferida por comando nesta árvore (`v3`, a partir de `onda1`).

Este documento NÃO é plano de implantação. Implantação está em `ROLLBACK.md`
e na parte L do `FINAL_REPORT.md`. Aqui está só o mecanismo de migração, a
regra de numeração e a guarda que falta.

---

## 1. O mecanismo, inteiro

São 36 linhas em `src/engine/server/db.js:52-78`. Não há biblioteca de
migração, não há CLI, não há `down`.

### 1.1 Como os arquivos são encontrados

`listarMigracoes(pasta)` (`src/engine/server/db.js:52-61`):

```js
fs.readdirSync(pasta)
  .filter((nome) => /^\d+_.+\.sql$/.test(nome))
  .sort()
  .map((nome) => ({ nome, version: Number(nome.match(/^(\d+)/)[1]), sql: ... }))
```

Três consequências que decorrem disto e de nada mais:

| fato | consequência |
|---|---|
| o filtro é `^\d+_.+\.sql$` | arquivo sem número no começo é **ignorado em silêncio** — não é erro, simplesmente não roda |
| a ordem é `.sort()` **de string** | `010` vem depois de `009` porque os dígitos estão zerados à esquerda. Uma migração `10_x.sql` (sem o zero) ordenaria **antes** de `009` |
| `version` é o prefixo numérico | `011_enquetes.sql` e `011_api_keys.sql` têm a **mesma** versão |

### 1.2 Como são aplicadas

`rodarMigrations(db, pastaMigracoes)` (`src/engine/server/db.js:63-78`):

```js
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`)
...
const aplicar = db.transaction(({ version, sql }) => {
  if (aplicada.get(version)) return
  db.exec(sql)
  registrar.run(version, new Date().toISOString())
})
for (const migration of listarMigracoes(pastaMigracoes)) aplicar(migration)
```

O que isso garante, e o que não garante:

| garante | não garante |
|---|---|
| cada migração roda dentro de **uma transação** (`db.transaction`) — SQL que falha no meio não deixa metade aplicada | que o SQL seja reversível. Não existe `down` em lugar nenhum |
| rodar duas vezes é inócuo: `if (aplicada.get(version)) return` | que o número seja único. É o defeito da seção 2 |
| o registro é por **número**, não por nome nem por conteúdo | que o arquivo não tenha mudado desde que foi aplicado. Não há soma de verificação |

A última linha é importante para quem for editar: **editar uma migração já
aplicada não tem efeito nenhum.** O banco já registrou aquela versão e o
aplicador devolve antes de executar. Corrigir esquema exige migração **nova**.

---

## 2. A REGRA DE NUMERAÇÃO, e por que ela é a mais barata de impedir

### 2.1 O estado atual, medido

```
src/engine/server/migrations/
  001_init.sql              006_template_provenance.sql
  002_runtime.sql           007_native_automations.sql
  003_panel_queries.sql     008_attribute_scopes.sql
  005_entity_attributes.sql 009_declared_variables.sql
                            010_retencao.sql
                            011_enquetes.sql
```

Dez arquivos. **`004` não existe** — é um vão no histórico, e é inofensivo:
`version` é chave primária, não contador sequencial, e o aplicador nunca
compara com a anterior. Um vão não quebra nada; um **número repetido** sim.

### 2.2 O que um número repetido faz

Era o defeito **T1-5** da `v2`, que trouxe `011_api_keys.sql` **e**
`011_pool_routing.sql` num banco onde `011_enquetes.sql` já existia. Rodado
contra um banco limpo, o resultado medido foi:

```
TABELAS CRIADAS pelas duas migrations 011: ["api_keys"]
versoes registradas: [12, 11, 10]
```

`pool_routing` **nunca é criada**, e nada reclama. `.sort()` de string decide
qual das duas ganha pelo nome do arquivo: `api_keys` vem antes de
`pool_routing` alfabeticamente, aplica, registra a versão 11, e a segunda cai
no `if (aplicada.get(version)) return`.

**E num banco de produção é pior.** Lá `011_enquetes` já registrou a versão
11. Então **nenhuma** das duas roda: `api_keys` nunca é criada, e
`validarChave(db, token)` passa a consultar uma tabela inexistente a cada
requisição. O defeito T1-3 deixa de ser 401 e passa a ser 500.

A perda é **silenciosa nos dois casos**. Não há log, não há exceção, não há
nada em `git diff` que mostre. É a classe de defeito mais barata de impedir e
a mais cara de diagnosticar.

### 2.3 A regra

> **Número de migração é chave primária, não rótulo.** Toda migração nova
> recebe o próximo número livre, conferido contra a pasta no momento de
> escrever. Quando duas frentes correm em paralelo, o número é **fixado por
> quem despacha**, antes do despacho, nunca escolhido pelo agente.

É a mesma regra que já vale para `templateId` (ver `TEMPLATES.md` §3), e pela
mesma razão: um identificador que o carregador trata como único precisa ser
atribuído na origem.

Próximo número livre nesta árvore: **012**.

### 2.4 A GUARDA QUE NÃO EXISTE

Conferido por comando: `ls tests/ | grep -i migra` devolve só dois
arquivos, e os dois são migração de **arquivo de configuração**, não de
esquema. (Os nomes não são citados aqui de propósito: um deles contém a palavra
proibida no repositório pela guarda que existe para isso, e documentação não
está na lista de exceções dela — nem deve estar.)

**Essa guarda agora existe:** `tests/migracoes-numeracao.test.mjs`, na corrente
do `npm test` logo depois de `engine-db`. O plano a exige (TRILHA 1, T1-5, e
critério 3 da Verificação).

O teste é curto e o contrato dele é inteiro:

| afirma | por quê |
|---|---|
| nenhum número repetido na pasta | é o defeito T1-5 |
| todo arquivo `.sql` casa com `^\d+_.+\.sql$` | arquivo fora do padrão é ignorado em silêncio pelo filtro |
| todo prefixo tem três dígitos | `10_x.sql` ordenaria antes de `009` pelo `.sort()` de string |

E ela **reprova** três casos que o repositório hoje não tem, para não ser verde
por acaso da árvore atual: os dois arquivos `011` que a `v2` publicou de
verdade, um prefixo de dois dígitos (`10_retencao.sql`, que o `.sort()` de
string poria antes de `009`) e um arquivo sem número (`migracao_nova.sql`, que o
filtro do aplicador ignora **em silêncio**). Oito checagens no total.

O padrão `^\d+_.+\.sql$` está copiado do aplicador **literalmente** dentro do
teste: se alguém mudar o filtro de `db.js` sem mudar o teste, o contrato aqui
deixa de corresponder, e é melhor que o teste divirja a que ele siga aprovando
uma regra que o código não aplica mais.

---

## 3. Migrações destrutivas

Proibição literal do pedido: **sem migração destrutiva sem recuperação.**

O mecanismo não ajuda aqui, e é honesto dizer: não há `down`, não há soma de
verificação, e `db.exec(sql)` executa o que estiver escrito. `DROP TABLE` numa
migração roda e registra, e a única recuperação é o arquivo do banco.

Então a regra é de escrita, não de ferramenta:

| situação | forma segura |
|---|---|
| coluna deixou de ser usada | **deixar lá.** SQLite tolera coluna morta sem custo mensurável |
| coluna precisa de outro tipo ou nome | tabela nova, `INSERT ... SELECT`, e a antiga **fica**. Remover é outra migração, outro dia, depois de o novo caminho estar em produção |
| tabela errada criada por engano | `DROP` só quando se prova por consulta que ela está vazia em todo banco alcançável — e a prova entra no corpo da migração como comentário |
| índice | `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS` são seguros: não carregam dado |

E o banco de produção fica no **caminho do volume**
(`~/.local/share/lcnwhatsapp/engine/engine.sqlite`, `src/engine/paths.js:7-8`),
nunca em `/app/engine-home`. Há registro no projeto de uma investigação
inteira perdida por consultar a cópia morta de dentro da imagem; é a primeira
coisa a conferir antes de qualquer operação de banco.

---

## 4. O que a `v2` traria, e o que entra

| migração da `v2` | decisão |
|---|---|
| `011_api_keys.sql` | a **ideia** entra, renumerada para `012_api_keys.sql`, como item da frente **J** — e a primeira chave nasce pelo painel, nunca por um POST anônimo |
| `011_pool_routing.sql` | **não entra.** Tabela com zero leitores; o roteamento por peso nunca foi consumido. Pool volta como item de documentação (frente **B**) |

Nenhum commit da `v2` é portado. Ver a decisão de base no plano:
`ARCHITECTURE.md` descreve o motor que recebe essas migrações, e
`DECISIONS.md` registra por que a `v2` não entra por merge.

---

## 5. Estado nesta árvore

| | |
|---|---|
| migrações presentes | 10 (`001`–`003`, `005`–`011`) |
| próximo número livre | **012** |
| migrações escritas nesta onda | **nenhuma** |
| guarda de numeração única | **não existe** — pendência registrada |

Nenhuma migração foi escrita, alterada ou aplicada neste trabalho. Nenhum
banco de produção foi tocado.
