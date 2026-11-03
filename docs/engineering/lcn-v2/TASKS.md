# Tarefas — estado real de cada frente

As onze frentes A–K do pedido, com o que está feito, o que não está, e **onde
está a prova**. Nenhuma linha aqui diz "pronto" sem um documento ou um comando
atrás dela — é o critério 8 (*a documentação corresponder ao comportamento
real*) aplicado à própria lista de tarefas.

Legenda: **feito** = código na árvore e teste verde · **documentado** = a frente
produziu documento, não código · **parado** = bloqueado, com a razão escrita ·
**não começou** = nada feito.

---

## 1. Visão geral

| frente | o que o pedido quer | estado | prova |
|---|---|---|---|
| **A** onboarding | primeiro acesso guiado | **entregue pela `v2`, 4 linhas** — e a cópia dela prometia pareamento que não existia lá | `PAIRING.md` |
| **B** documentação na IDE | ajuda contextual, 14 campos por função | **não começou** | — |
| **C** menu como `.lcn` | menu deixa de ser aba privilegiada | **não começou** | — |
| **D** pacotes de provisionamento | instância vazia/básico/atendimento/… | **não começou** (depende de E e C) | — |
| **E** limites administrativos | hierarquia com verdade no backend | **feito** (metade), **parado** (metade) | `INSTANCE_LIMITS.md`, `UX_CHANGES.md` |
| **F** QR ou código de pareamento | pareamento por número, se a biblioteca permitir | **feito, já na `onda1`** | `PAIRING.md` |
| **G** agendamento | reescrita no motor pelos nove portões | **parado — decisão do dono** | `SCHEDULER.md` |
| **H** recover | recuperação de mensagem, opt-in | **não começou** | — |
| **I** anti-trava | teto por remetente, profundidade, regex | **parcial — a maior parte já na `onda1`** | `PERFORMANCE.md` |
| **J** segurança | revisão **antes de cada integração** | **documentado**, 5 achados, 1 corrigido | `SECURITY_REVIEW.md` |
| **K** medir de novo | comparação antes/depois | **parado** — depende das frentes acima | `PERFORMANCE.md` |

**Dez documentos de engenharia** foram escritos, que é o **Passo 0** do plano —
a investigação que o pedido mandava vir antes do código e que a `v2` entregou em
zero arquivos.

## 2. Frente E — o que ficou feito e o que não

A frente declarada **prioritária** no próprio pedido, e a que a `v2` não
começou. Ela parte em duas metades por uma razão que não é de esforço:

| metade | estado | por quê |
|---|---|---|
| **hierarquia e verdade no backend** | **feito** | concessões no registro (`src/agent/concessoes.js`), entrega por ambiente, limite efetivo calculado no backend, tela que **explica** os quatro números |
| **garantias anti-elevação** | **parado** | o painel **não tem login, nem papel, nem sessão**. Sem isso não existe "o cliente" para tentar subir o próprio limite — existe só *quem alcançou a porta* |

A segunda metade é da frente **J**, não da **E**, e está escrita assim no
`SECURITY_REVIEW.md` §3. O pedido exige testar *"o cliente tentando subir o
próprio limite por HTTP direto, por JSON importado e por automação"*; os três
pressupõem autenticação. **Declarar isso testado seria a proibição mais direta
do §23.**

| entregue na frente E | arquivo |
|---|---|
| concessões fora da pasta da instância | `src/agent/concessoes.js` |
| rotas `GET`/`PUT` `/instances/:id/grants` | `src/web/router.js` |
| entrega por ambiente ao nascer o processo | `src/instances/quadlet.js` |
| limite efetivo, com a divergência preservada | `src/mediaLimits.js`, `src/agent/instanceService.js` |
| painel que mostra os quatro números | `src/web/public/pages/instance.js`, `logic/optimization.js` |
| testes | `tests/concessoes-de-instancia.test.mjs`, `tests/concessoes-entrega.test.mjs`, `tests/docs-limites.test.mjs`, `tests/web-ui-logic.test.mjs` |

E a regra do dono que governou o desenho: **padrão sensato sim, teto no código
não.** Reduzir uma concessão **não** reescreve a escolha do cliente — ela fica
guardada e volta a valer se o teto subir.

## 3. Frente F — já estava entregue, e a verificação era o trabalho

O pedido manda **verificar na biblioteca real se o pareamento por número
existe**, e proíbe expressamente fabricar implementação falsa. Verificado:
existe, e já estava implementado na `onda1`.

| o que foi medido | resultado |
|---|---|
| validade do código | **180 s** (`PAIRING_CODE_MAX_AGE_SECONDS`) |
| tentativas de hello | **3** (`PAIRING_CODE_MAX_PRIMARY_HELLOS`) |
| segundo clique destrói a sessão anterior | **sim** — `requestPairingCode` reatribui `pairingSession` |
| validação de número | tela ≥ 10 dígitos, backend **10–15** |
| limite de frequência | **não existe** → pendência |
| código em log | **estava** → corrigido |

O trabalho real desta frente nesta onda foi **documentar o limite honesto** e
**corrigir o código no log** — não reescrever o que já funcionava.

## 4. Pendências, com próximo passo concreto

Cada linha é da parte **J** do `FINAL_REPORT.md`, e nenhuma é "faltou tempo":

| # | pendência | próximo passo | onde está escrito |
|---|---|---|---|
| 1 | guarda de numeração de migração | teste com três asserções: número único, `^\d+_.+\.sql$`, prefixo de 3 dígitos | `MIGRATION.md` §2.4 |
| 2 | ~~guarda de template contra o JSON Schema~~ | **entregue em 01/11/2026**: `tests/templates-contra-schema.test.mjs` renderiza os 121 e confere os três portões da instalação | `TEMPLATES.md` §3.4 |
| 3 | limite de frequência no pareamento | intervalo mínimo por instância em `pedirCodigo`, piso **180 s**, configurável | `SECURITY_REVIEW.md` §5 |
| 4 | autenticação do painel | login, papel e sessão — **frente J**, não começou | `SECURITY_REVIEW.md` §3 |
| 5 | chaves de API no motor | reescrita com as **três correções** sobre o desenho da `v2` | `SECURITY_REVIEW.md` §4 |
| 6 | filtro de endereço privado na captura de site | no **serviço**, não no template | `SECURITY_REVIEW.md` §6 |
| 7 | 14 comandos sem endereço de serviço | **depende do dono**, não de trabalho | plano |
| 8 | agendamento | **decisão do dono** sobre o contexto sintético | `SCHEDULER.md` §2 |
| 9 | tela de concessões para o administrador | rotas existem, tela não | `UX_CHANGES.md` §7 |
| 10 | renomear `casa` e `Pool` | frente B, e exige adaptador do nome antigo | `UX_CHANGES.md` §7 |

## 5. O que foi recusado, e por quê

Não é omissão: é escolha registrada, cada uma com a razão.

| recusado | razão |
|---|---|
| portar `src/engine/senderRateLimiter.js` da `v2` | derruba `tests/gateway-encaminhamento.test.mjs` em seis tipos de mensagem, e o lugar certo (`filasDeRecursos.js`) já existe |
| portar o `scheduler.js` da `v2` | seis defeitos medidos, e consertar o caminho abriria um **segundo escritor** no banco do motor |
| portar `pool_routing` | tabela com **zero leitores** |
| semeadura de templates em toda conexão | contraria a regra de que só o dono clicando instala |
| merge da `v2` | ela não passa na própria bateria, e as migrações colidem em três vias |

## 6. Verde não é prova

A bateria está em **4543** checagens, zero vermelho, exit 0 — e a linha abaixo
é a que importa mais nesta lista:

> **Verde não é prova de que a regra existe — é prova de que nenhum teste a
> contradiz.**

Já custou duas vezes neste projeto: o escopo `local` em metade das camadas
(com um teste de lista exata **premiando** a divergência) e o
`trigger.watcher`, que virou código morto com a bateria inteira verde. É por
isso que a coluna "prova" desta tabela aponta documento e arquivo, não o número
de checagens.
