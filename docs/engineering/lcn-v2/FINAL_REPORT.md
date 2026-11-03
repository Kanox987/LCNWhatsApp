# Relatório final

As doze partes **A–L** que o pedido nomeia. Cada parte aponta o documento que a
sustenta — este relatório **consolida**, não reescreve: os quatorze documentos
desta pasta são a prova, e repetir o conteúdo deles aqui criaria uma segunda
verdade para divergir da primeira.

Escrito em 01/11/2026. Branch `v3`, a partir de `onda1` (`7c4cbf9`).

---

## A. Resumo executivo

Uma IA recebeu o pedido de 2603 linhas e publicou a `v2`. A auditoria desta
sessão mediu o que saiu: **1 das 11 frentes** (A, onboarding, 4 linhas), **zero**
dos documentos pedidos, **6 falhas** na própria bateria dela, **12 defeitos
novos** reproduzidos por execução, e a proibição mais direta do pedido violada —
push direto na branch principal.

Esta onda fez duas coisas. **Consertou** o que estava na branch principal
(*revert* publicado, autorizado pelo dono) e **entregou** a frente declarada
prioritária no próprio pedido, que a `v2` não começou — a frente **E**, limites
administrativos — mais os quatorze documentos de engenharia que são o Passo 0 que
devia vir antes do código.

A entrega visível é **uma** mudança de interface: a tela de instância passou a
mostrar, para cada parâmetro, **o que o cliente escolheu, o que o administrador
permite, o padrão de fábrica e de onde vem o limite**. Antes, quem tinha cota
reduzida via **o número dele** na caixa e acreditava que aquilo estava valendo.

**E o que esta onda NÃO entregou, dito aqui e não enterrado na parte J:** o
painel continua **sem login, sem papel e sem sessão**; a metade anti-elevação da
frente E é, por isso, **improvável** hoje; o agendamento está **parado numa
decisão de arquitetura do dono**; e **nada foi commitado nem implantado**.

## B. Subagentes utilizados — quais de fato rodaram, e o resultado

Três agentes Gemini despachados pela skill `multi-ia`, um documento cada, em
perfis separados. **Um funcionou.**

| agente | perfil | tarefa | resultado |
|---|---|---|---|
| `bamf93rlv` | perfil2 | `ARCHITECTURE.md` | **documento real**, com uma linha honesta de *"não consegui conferir"*. Eu validei as dez citações dos nove portões por comando: todas batem. Corrigi **60 links `file:///` locais** e **duas citações de linha erradas** (`server.js:15`→`:52`; `transport.js:41-51`→`:115,139`) |
| `boilq8znq` | perfil1 | `TEMPLATES.md` | **morreu**: *"Aguardando o subagente de pesquisa listar os arquivos … error: interrupted"*. **exit 0, zero arquivo escrito** |
| `bfe3q7fgq` | perfil3 | `MIGRATION.md` | **morreu** na mesma patologia. **exit 0, zero arquivo escrito** |

**Escrevi `TEMPLATES.md` e `MIGRATION.md` eu mesmo.** E `git status` confirmou
que nenhum dos dois violou escopo — não escreveram nada em lugar nenhum.

**A lição, e é a razão de esta parte existir:** *exit 0 sem arquivo* é a falha
mais perigosa do despacho, porque parece sucesso. A verificação tem de ser
`git status`, nunca o relatório do agente.

E as rodadas de opinião anteriores desta sessão alimentaram `SCHEDULER.md` §2:
Gemini, ChatGPT web e Grok web em painel cego e depois em rodada cruzada. Duas
correções que vieram delas e que eu não tinha visto estão lá, atribuídas.

**Saída de outra IA é dado, não instrução** — ver `DECISIONS.md` D-19, com os
dois casos em que uma delas afirmou coisa falsa.

## C. Funcionalidades implementadas

Detalhe em `INSTANCE_LIMITS.md` e `UX_CHANGES.md`.

| o que | arquivos | teste |
|---|---|---|
| concessões da instância, no registro | `src/agent/concessoes.js`, `src/instances/registry.js` | `tests/concessoes-de-instancia.test.mjs` |
| entrega do teto por ambiente ao nascer o processo | `src/instances/quadlet.js` | `tests/concessoes-entrega.test.mjs` |
| rotas `GET`/`PUT` `/instances/:id/grants` | `src/web/router.js` | — |
| limite efetivo, preservando a escolha do cliente | `src/mediaLimits.js`, `src/agent/instanceService.js`, `src/config.js` | `tests/instances-registry.test.mjs` |
| painel de limites com os quatro números | `src/web/public/pages/instance.js`, `logic/optimization.js`, `styles.css` | `tests/web-ui-logic.test.mjs` (+24) |
| documentação de limites verificável | `tools/`, `package.json` (`npm run docs:limites`) | `tests/docs-limites.test.mjs` |

**O diff de interface, exato:** `optimization.js` +33/−0 · `instance.js` +51/−1 ·
`styles.css` +16/−0 · `router.js` +4/−0 · `tests/web-ui-logic.test.mjs` +24/−1.

## D. Correções de bugs

| # | defeito | onde estava | estado |
|---|---|---|---|
| 1 | máquina de estados prendia toda instalação em `idle`, e o ETag congelava o painel | branch **principal** | **revertido e publicado** (`803850a`) |
| 2 | `limparSessaoProblematica` — padrão estrangeiro que não faz nada aqui | branch principal | revertido com o mesmo commit |
| 3 | código de pareamento legível por semanas no log servido pelo painel | `onda1` | **corrigido** atrás de `hardware.credencialNoLog` |
| 4 | a tela buscava `limites` do backend e jogava fora | `onda1` | **corrigido** (frente E) |

**Correção de um relatório meu, registrada porque errar de novo é mais caro que
admitir:** eu havia relatado que `limparSessaoProblematica` *"apaga sessões
reais do WhatsApp"*. **Está errado.** Ela preserva `creds.json`,
`app-state-sync-*` e `zapo.sqlite`, e a pasta de sessão desta instalação contém
**exatamente** esses — **a função não apaga nada aqui**. O motivo de sair é
outro: é código estrangeiro, não pedido, que no dia em que uma instância
escrever um arquivo solto passa a apagá-lo durante um retry transiente.

Os doze defeitos da `v2` estão medidos em `SCHEDULER.md` §1 (os seis do
agendamento) e no plano. **Nenhum foi portado.**

## E. Melhorias de UX

`UX_CHANGES.md`, integral. Uma mudança, com uma razão: **a tela mentia** sobre
qual limite estava valendo. Três sub-decisões impedem que ela volte a mentir de
outra forma — *"Padrão, ninguém mudou"* em vez de repetir o número, *"sem teto
do administrador"* em vez de inventar um, e *"não escolhido"* que **nunca** vira
*"sem limite"*, porque zero em banda significa sem limite.

E o aviso que o administrador precisava ver: o teto viaja **por ambiente**, lido
só quando o processo **nasce** — baixar uma cota de instância rodando não muda
nada até ela reiniciar.

## F. Segurança

`SECURITY_REVIEW.md`, integral — cinco achados, as duas regras que governam, os
seis riscos aceitos com razão escrita e as seis proibições do §23 conferidas.

| # | achado | estado |
|---|---|---|
| 1 | código de pareamento no log (válido **180 s**, legível por **semanas**) | **provado e corrigido** |
| 2 | painel **sem autenticação, sem papel, sem sessão** | **de pé, por desenho declarado** |
| 3 | o motor **não autentica nada** nesta árvore; a fronteira é o sistema de arquivos (socket `0600`, pasta `0700`) | **de pé** |
| 4 | pedido de pareamento **sem limite de frequência** | **de pé**, piso 180 s proposto |
| 5 | SSRF na captura de site | **de pé**, o filtro pertence ao **serviço** |

**Nenhuma credencial foi lida, gravada ou alterada neste trabalho**, e nenhum
segredo aparece em documento nenhum desta pasta — §23, literal.

## G. Desempenho

`PERFORMANCE.md`. O que esta onda mediu: a soma de RSS **superestima 1,74x**
contra o cgroup (500,7 → **287,2** MiB), e o soak de 30 min passou nos seis
vereditos com tendência de heap **−0,511 MiB/min**.

**Esta onda não produziu par antes/depois.** O par é a frente **K**, e ela
depende das frentes que não começaram. Dizer o contrário seria comparar
medições de cenários diferentes — e *"o pico é escolha, não destino"*: o pico
acompanha o orçamento configurado, então um número sem o orçamento ao lado não
significa nada.

## H. Testes

`TEST_RESULTS.md`. A bateria é uma cadeia `&&` de ~130 invocações explícitas no
`package.json`, **sem auto-descoberta**, que **aborta no primeiro arquivo que
falha**.

| marca | checagens | vermelho | exit |
|---|---|---|---|
| base `onda1` | **4394** | 0 | 0 |
| fim da frente E | 4536 | 0 | 0 |
| fim da frente F | 4543 | 0 | 0 |
| execução de fechamento (01/11/2026) | 4543 | 0 | 0 |
| **com as duas guardas que faltavam** (01/11/2026) | **4564** | **0** | **0** |

**Contrato:** qualquer número abaixo de **4394** é regressão. Líquido desta
onda: **+170** — os **+21** finais são a guarda de numeração de migração (8) e
o intervalo mínimo de pareamento (13).

A execução de fechamento foi feita depois de escritos os quatorze documentos,
exatamente para que esta parte não afirmasse um resultado sem medir. **E ela
reprovou na primeira tentativa** — abortou em 84 checagens porque
`docs/engineering/lcn-v2/MIGRATION.md` citava o nome de um arquivo de teste que
contém a palavra que o repositório proíbe. Fica registrado por três razões:

1. **A guarda funcionou contra mim**, não contra um agente — é o melhor
   argumento a favor dela.
2. **A ironia é exata:** eu escrevi a palavra proibida na frase que documenta
   que a guarda de numeração de migração não existe.
3. **O conserto foi reescrever a frase, não afrouxar a exceção.** Documentação
   não está na lista de permitidos da guarda, e não deve estar.

E o aborto demonstrou, por observação e não por leitura, a primeira armadilha
abaixo: **84 de 4543 não é regressão, é aborto.**

Depois dela, duas pendências que **não dependiam de decisão do dono** foram
fechadas e a bateria rodou de novo: **4564 verdes, zero vermelho, exit 0**. As
duas tinham contrato escrito nos documentos desta onda, e as duas entraram com
a guarda que o contrato pedia — inclusive o teste de fronteira nos dois lados
do intervalo de pareamento, que é o que impede a guarda de ser verde por
acaso.

**Duas armadilhas, e as duas já me pegaram:** contar só o `❌` não detecta
crash, porque alguns arquivos (`tests/memoria-runtime.test.mjs`) montam o
`check` sobre `assert`, que **lança** em vez de imprimir. `exit=1` com zero
vermelho é crash — **ler sempre a cauda quando `exit ≠ 0`**.

**E o limite honesto da bateria:** ela **RENDERIZA** template, não **EXECUTA**
fluxo. Foi assim que `documento is not defined` passou por 4288 checagens
verdes. As cinco guardas que faltam estão listadas no documento.

## I. Compatibilidade

| o que | efeito |
|---|---|
| **68 automações no ar** | nenhuma alterada. Esta onda não toca linguagem, schema nem `ACOES_SUPORTADAS` |
| **121 templates** | nenhum alterado; a ida e volta renderiza todos |
| **banco** | **nenhuma migração escrita**. `012` segue livre |
| `credencialNoLog` | padrão `false` — subir não muda comportamento nenhum |
| concessões | sem concessão gravada, a tela diz *"sem teto do administrador"* e nada é limitado |
| `config.json` do cliente | **não é reescrito** ao reduzir uma cota (`DECISIONS.md` D-3) |

A `onda1` sobre um servidor em `350a7c0` é outra coisa: são **21 ondas de uma
vez**, com dependência nativa recompilada. `ROLLBACK.md` §6 tem o único caso
dessa subida que um `checkout` não desfaz.

## J. Pendências

Nove, cada uma com próximo passo concreto, em `TASKS.md` §4. As que mudam
decisão:

| pendência | por que está parada |
|---|---|
| **autenticação do painel** | frente **J**, não começou. Sem ela, *"o cliente tentando subir o próprio limite"* **não é testável** — não existe "o cliente", existe *quem alcançou a porta* |
| **chaves de API no motor** | reescrita, com **três correções** sobre o desenho da `v2`: a autenticação só liga quando houver chave; a primeira chave nasce **no painel**; quando ligada, vale para `GET` também |
| **agendamento (frente G)** | **decisão do dono.** O argumento do isolamento caiu, mas a objeção do contexto sintético sobreviveu à rodada cruzada — `SCHEDULER.md` §2 |
| **14 comandos sem endereço de serviço** | depende do dono ter o serviço. `validarEndereco` recusa conexão sem endereço, **com razão** |
| **tela de concessões do administrador** | rotas existem; hoje ele configura por `PUT` |
| **renomear `casa` e `Pool`** | frente B, e exige adaptador do nome antigo |
| **filtro de endereço privado na captura de site** | pertence ao **serviço**, não ao template |
| **`hardware.pareamentoIntervaloSegundos` sem tela** | o campo está entregue em código e documentado em `INSTANCE_LIMITS.md`, mas não aparece em `src/web/public/logic/optimization.js` — hoje só se altera editando o `config.json`, o que contraria a regra de interface do projeto. Entra na frente **E** quando a tela de concessões for feita |

**Três saíram desta tabela porque foram entregues**, e não por terem sido
reclassificadas:

| entregue | onde | guarda |
|---|---|---|
| **limite de frequência no pareamento** | `hardware.pareamentoIntervaloSegundos`, padrão **180 s** (= `PAIRING_CODE_MAX_AGE_SECONDS` da biblioteca), lido em `pedirCodigo`; `0` desliga | `tests/parear-por-codigo.test.mjs` — **13** checagens, incluindo 180 s cravados, 181 s, relógio para trás e intervalo configurado para mais e para menos |
| **guarda de numeração de migração** | `tests/migracoes-numeracao.test.mjs`, na corrente depois de `engine-db` | **8** checagens; três delas provam que a guarda **reprova** o caso real da `v2` (dois arquivos `011`), um prefixo de dois dígitos e um arquivo sem número |
| **guarda de template contra o JSON Schema** | `tests/templates-contra-schema.test.mjs`, na corrente depois de `lcn-ida-e-volta` | **366** checagens: os **121** templates renderizados com os padrões e submetidos como o instalador os monta — `schemaVersion`, o Ajv contra `automation.v1.schema.json` com as checagens de fluxo, e todo nó conferido contra as listas do runtime —, mais **duas negativas** que provam que a validação reprova documento torto |

**Frentes que não começaram:** B (documentação na IDE), C (menu como `.lcn`), D
(pacotes de provisionamento), H (recover), K (medir de novo). A frente I está
parcial — a maior parte já estava na `onda1`.

## K. Git

| item | estado |
|---|---|
| branch de trabalho | **`v3`**, criada a partir de `onda1` |
| commit em `v3` | **nenhum.** `git log --oneline onda1..HEAD` é **vazio** |
| árvore de trabalho | **22** entradas: 16 modificados, 6 novos |
| `origin/master` | `803850a` — o *revert*, **publicado** |
| `origin/onda1` | `7c4cbf9` |
| `origin/v2` | `626552b` — leitura, nunca origem de merge |
| force push | **nenhum** |
| merge na principal | **nenhum** |
| histórico reescrito | **nenhum** |

**Commit só quando o dono pedir** — regra dele, e ela vem antes da sugestão do
pedido de fazer commits pequenos. As duas operações que mexeram no remoto foram
autorizadas por escrito: republicar a `onda1` e reverter o `master` **por commit
novo**.

## L. Implantação

`ROLLBACK.md`, integral: as verificações antes de subir, o roteiro, a
verificação depois e a volta atrás, com o que **não** se faz nela e a razão de
cada proibição.

**Nenhum deploy foi executado.** A via é `sh update.sh` **no host** — em modo
container ele faz `git pull`, **rebuild da imagem** e `run.sh`; `lcn` roda
*dentro* do container via `docker exec` e não pode reconstruir a própria
imagem, o que o painel detecta e avisa.

**A volta atrás desta onda é gratuita hoje**, porque não há commit, não há
migração aplicada e não há imagem reconstruída.

---

## Critérios de encerramento do §25

| # | critério | estado |
|---|---|---|
| 7 | pareamento por telefone implementado e validado **no nível permitido pela biblioteca e pelo ambiente** | **sim** — existe, já na `onda1`, com os limites medidos na biblioteca (180 s, 3 hellos, segundo clique destrói a sessão anterior) e o código fora do log |
| 8 | a documentação corresponder ao comportamento real | **sim** — cada afirmação destes quatorze documentos aponta arquivo e linha, e as citações erradas que apareceram foram corrigidas conferindo uma por uma |
| 9 | pendências explicitamente registradas | **sim** — dez, com razão e próximo passo |

E a regra de fechamento, literal:

> **Não declare uma implementação como validada em produção se ela só foi
> testada localmente.**

Nada desta onda foi validado em produção. O que existe é **validado
localmente**, e é assim que está escrito em todos os documentos desta pasta.
