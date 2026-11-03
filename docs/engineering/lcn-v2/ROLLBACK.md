# Implantação e volta atrás — parte L

Parte **L** das doze do `FINAL_REPORT.md`: instruções de implantação, as
verificações necessárias e a volta atrás — **sem executar nenhum deploy**.

O pedido proíbe deploy em produção, e nada aqui foi implantado. Este documento
é o roteiro para quando o dono decidir, não o registro de uma subida.

---

## 1. O estado de onde se parte

| referência | commit | o que é |
|---|---|---|
| `origin/master` | `803850a` | *Revert* da máquina de estados — a correção do T1-1 já publicada |
| `origin/onda1` | `7c4cbf9` | o trabalho verde: 121 templates, 38 ações, 4394 checagens |
| `origin/v2` | `626552b` | a árvore da outra IA, **material de leitura**, nunca origem de merge |
| `v3` (local) | `7c4cbf9` | **mesma árvore da `onda1`** — nada commitado |

**Esta onda não tem commit.** `git status --short` lista **22** entradas: 16
arquivos modificados e 6 novos. Isso é deliberado e é a regra do dono: commit só
quando ele pedir.

Consequência prática para a volta atrás: **neste momento ela é gratuita.** Não
há commit para reverter, não há tag, não há migração aplicada, não há imagem
reconstruída.

## 2. Como a implantação funciona neste projeto

A via é `update.sh`, rodado **no host**, nunca por `lcn` dentro do container
(`docs/ATUALIZACAO.md`). Em modo container: `git pull` → **rebuild da imagem**
(o build reinstala a `zapo-js` do GitHub) → `run.sh`. Em modo seco:
`git pull` → `npm install` → `pm2 restart`.

Duas consequências que mudam o roteiro:

**O rebuild é parte da implantação, não um detalhe.** A imagem é reconstruída,
então voltar atrás também exige rebuild — não basta trocar o commit.

**O ambiente só é lido quando o processo nasce.** O teto do administrador viaja
por ambiente até a instância (`src/instances/quadlet.js`), então mudança de
concessão só vale depois de reiniciar a instância. A tela diz isso
(`UX_CHANGES.md` §2), e o roteiro abaixo depende disso.

## 3. Antes de subir — as verificações, nesta ordem

| # | verificação | como | critério |
|---|---|---|---|
| 1 | bateria completa | `npm test` | **≥ 4543** checagens, **zero** `❌`, `exit 0`. Qualquer número abaixo de **4394** é regressão (`TEST_RESULTS.md`) |
| 2 | ler o tail quando `exit ≠ 0` | — | alguns arquivos usam `assert` e **lançam** sem imprimir `❌`; contar vermelho não detecta crash |
| 3 | guarda do encaminhamento | `node tests/gateway-encaminhamento.test.mjs` | verde **sem ter sido editado** — é a prova de que nenhum teto por remetente derruba mensagem legítima |
| 4 | nada foi ativado sozinho | `git status --short` e `git diff` | só arquivos novos e modificados esperados; **nenhuma** chamada a `/install` no diff |
| 5 | o diff lido inteiro | `git diff onda1...v3` | arquivo por arquivo, pelo dono ou por mim, antes de qualquer publicação |
| 6 | numeração de migração | `ls src/engine/server/migrations/` | **nenhuma migração nova nesta onda**. Se alguma entrar depois, o próximo número livre é **012** (`MIGRATION.md`) |
| 7 | nenhum segredo no diff | leitura | o repositório é **público**. `config.json` e `runtime.json` estão no `.gitignore` |

As migrações presentes são `001`–`003` e `005`–`011`. **`004` é um vão
inofensivo**, porque `version` é chave primária e não contador.

## 4. O roteiro de subida

Esta onda é **código e documentação**, sem migração e sem mudança de schema.
Isso a torna a classe mais simples de subida — e o roteiro diz por quê em cada
passo.

1. **Commit e publicação da `v3`.** Commits pequenos e lógicos, na branch `v3`.
   **Sem force push. Sem merge na branch principal.** A publicação é
   `git push origin v3`, e a decisão de integrar é do dono.
2. **No host, na pasta do projeto:** `sh update.sh`. Não por `lcn`, não por
   `docker exec`.
3. **Rebuild obrigatório** em modo container — é o que o `update.sh` já faz.
4. **Reiniciar cada instância** cujo teto de administrador tenha mudado, senão o
   ambiente velho continua valendo.

### Ordem das mudanças de comportamento

| mudança | efeito ao subir | precisa de ação? |
|---|---|---|
| painel de limites (frente E) | aparece na tela de instância | nenhuma |
| rotas `GET`/`PUT` `/instances/:id/grants` | passam a existir | nenhuma — sem concessão gravada, a tela diz *"sem teto do administrador"* |
| `hardware.credencialNoLog` | **padrão `false`**, nada muda | ligar é escolha do dono |
| documentação em `docs/engineering/lcn-v2/` | nenhum efeito em runtime | nenhuma |

**Nenhuma dessas mudanças altera automação existente.** As 68 que estão no ar
continuam como estão — é o requisito do pedido, e é verificável pela bateria,
que renderiza os 121 templates.

## 5. Verificação depois de subir

| # | o que conferir | como |
|---|---|---|
| 1 | o painel abre e lista os limites | abrir a tela de instância |
| 2 | um campo sem concessão diz *"sem teto do administrador"*, não um número | leitura da tela |
| 3 | um campo em branco diz *"não escolhido"*, **nunca "sem limite"** | leitura da tela |
| 4 | as 68 automações continuam respondendo | um comando de cada família |
| 5 | o motor continua recebendo evento e devolvendo comando | log do gateway |
| 6 | memória do container | `docker stats` — a medida do **cgroup**, não a soma de RSS, que superestima **1,74x** (`PERFORMANCE.md`) |

**E o critério de encerramento do pedido:** *não declare uma implementação como
validada em produção se ela só foi testada localmente.* Até o passo 5 ser feito
no alvo real, o que existe é **validado localmente** — e é assim que está
escrito em todos os documentos desta pasta.

## 6. Volta atrás

### Agora: gratuita

Nada commitado, nada implantado. Desfazer é descartar a árvore de trabalho —
**e isso apaga 22 arquivos de trabalho**, então só com pedido explícito do dono.
Os seis novos (incluindo esta pasta de documentação) são arquivos **sem par no
histórico**: `git checkout` não os remove, eles têm de ser apagados à mão.

### Depois de publicar a branch, antes de integrar

Nada a fazer na produção: a `v3` publicada não é a branch principal e não é o
que o servidor roda. Reverter é parar de integrar.

### Depois de implantar

| o que voltar | como |
|---|---|
| o código | `git checkout <commit anterior>` no host + **`sh update.sh`** para reconstruir a imagem. Trocar o commit sem rebuild deixa a imagem velha rodando |
| as concessões | `PUT /instances/:id/grants` com o teto anterior, **mais reinício da instância** — ambiente só é lido no nascimento |
| `credencialNoLog` | volta para `false` pelo painel; é config, não código |
| o banco | **nada a fazer: esta onda não escreve migração.** Nenhum schema mudou, nenhum dado foi convertido |

**O que NÃO se faz na volta atrás**, e as razões são do pedido:

| proibido | razão |
|---|---|
| `git push --force` | proibição literal do pedido |
| merge na branch principal para "consertar" | proibição literal |
| apagar migração já aplicada | `MIGRATION.md`: não há `down`, não há checksum, e editar migração aplicada **não tem efeito nenhum** — o conserto é migração nova |
| apagar sessão do WhatsApp | proibição literal. A autenticação do `zapo` mora em SQLite; apagar "arquivo solto" não é volta atrás, é perder a conta |
| mexer em credencial | proibição literal, e regra do dono: credencial se escreve pelo painel e nunca se lê |

### O caso que exige cuidado, e é o único

**A implantação da `v3` sobre um servidor que roda `350a7c0`** significa subir
**as 21 ondas da `onda1` de uma vez**, não só esta onda. Isso inclui 38 ações,
121 templates, duas dependências nativas recompiladas (`better-sqlite3` subiu
para 13.0.3) e o schema que a `onda1` estreitou.

A volta atrás disso é o `checkout` do commit anterior **mais rebuild**, e o
banco **não** volta: as migrações `001`–`011` já estarão registradas em
`schema_migrations`, e código antigo contra schema novo é a direção que
funciona (colunas a mais são ignoradas), enquanto o contrário não é. Então:

> **Subir é reversível. Subir, criar automações novas e descer não é.**

Quem descer depois de o cliente publicar automação que usa ação nova vai ter
documento no banco que o motor antigo recusa com **422**. Isso não corrompe
nada — a automação simplesmente para de instalar —, mas é a única consequência
desta onda que um `checkout` não desfaz, e tem de ser dita antes, não depois.

## 7. Estado declarado

| item | estado |
|---|---|
| deploy executado | **nenhum** |
| commit criado | **nenhum** |
| migração escrita ou aplicada | **nenhuma** |
| infraestrutura de produção tocada | **nenhuma** |
| sessão, credencial ou segredo alterado | **nenhum** |
| branch principal alterada nesta onda | **nenhuma** |

A última linha merece a ressalva honesta: `origin/master` **foi** mudada mais
cedo nesta sessão, por commit novo de *revert* (`803850a`), com as duas decisões
autorizadas pelo dono por escrito — republicar a `onda1` e reverter o `master`
por commit novo. Sem force push e sem reescrita de histórico.
