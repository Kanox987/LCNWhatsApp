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

Atualizado em 06/11/2026. Os commits citados estão na `v3`.

| frente | o que o pedido quer | estado | prova |
|---|---|---|---|
| **A** onboarding | primeiro acesso guiado | **entregue pela `v2`, 4 linhas** — e a cópia dela prometia pareamento que não existia lá | `PAIRING.md` |
| **B** documentação na IDE | ajuda contextual, 14 campos por função | **feito na maior parte**; 13 campos de gatilho e condição seguem sem descrição; **falta** a explicação "Pool agrupa números e não dá permissão" | `LCN_FUNCTION_REFERENCE.md` |
| **C** menu como `.lcn` | menu deixa de ser aba privilegiada | **feito** | `MENU_COMO_AUTOMACAO.md` |
| **D** pacotes de provisionamento | instância já nasce com comandos | **feito** — pacotes (D-24..D-47) e **perfil de provisionamento** aplicado na primeira subida do container (D-49) | `DECISIONS.md`, `deployment/perfis/` |
| **E** limites administrativos | hierarquia com verdade no backend | **feito** — concessões, e cotas de conexões, automações e fila de ação (D-55); rota de concessões some no painel do container (D-56) | `INSTANCE_LIMITS.md`, `tests/painel-sem-concessoes-no-container.test.mjs` |
| **F** QR ou código de pareamento | pareamento por número | **feito, na `onda1`** | `PAIRING.md` |
| **G** agendamento | reescrita no motor | **feito** (D-48), validado só com relógio injetado, não em produção | `SCHEDULER.md` |
| **H** recover | recuperação de mensagem apagada, opt-in | **não começou**; o dono vai testar junto (evento de revogação chega com o id? o celular devolve o conteúdo?) | plano |
| **I** anti-trava | teto por remetente, profundidade, regex | **parcial** — profundidade existe; regex recusada; teto por remetente **decidido não fazer agora** (D-57), com condição para reabrir | `PERFORMANCE.md` |
| **J** segurança | login no painel | **descartada pelo dono**: o cliente só vê o painel do próprio container (D-56) | `SECURITY_REVIEW.md` |
| **K** medir de novo | comparação antes/depois | **pendente** — `npm run soak` de 30 min ainda não rodou nesta árvore | `PERFORMANCE.md` |

Frentes novas desta leva, fora da lista A–K do pedido:

| frente | estado | decisão |
|---|---|---|
| listas de pessoas, ações `liberar`/`desliberar`, página Listas | **feito** | D-50 |
| campo `acesso` (quem pode usar) | **feito** | D-51 |
| escopo `listed` e comando "quem está na lista" | **feito** (`onde: da lista X`; modelo `quem-esta-na-lista`) | D-52 |
| acervo com JSON e edição, exportar/importar lista | **feito** | D-53 |
| seletor de alcance completo no catálogo | **feito** | D-54 |
| estado do motor persistido no container (`./estado`) | **feito** | D-58 |
| tela de cotas no painel do administrador | **a decidir com o dono** junto do teste da frente H | — |

Bateria completa em 06/11/2026: **6032** checagens, zero vermelho, exit 0.

## 2. Frente E — o que ficou feito e o que não

A frente declarada **prioritária** no próprio pedido, e a que a `v2` não
começou. Ela parte em duas metades por uma razão que não é de esforço:

| metade | estado | por quê |
|---|---|---|
| **hierarquia e verdade no backend** | **feito** | concessões no registro (`src/agent/concessoes.js`), entrega por ambiente, limite efetivo calculado no backend, tela que **explica** os quatro números |
| **garantias anti-elevação** | **resolvido por outro caminho** (06/11/2026) | o painel continua sem login, de propósito: dentro do container o cliente não vê a rota de concessões (D-56) e não tem terminal; quem sobe o limite é quem cria o container |

Quando este texto foi escrito, a segunda metade dependia da frente **J** (login). O
dono descartou a J e fechou o buraco pelo modelo de container (D-56). O que está
abaixo é o raciocínio original, mantido como registro. O pedido exige testar *"o cliente tentando subir o
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
| 4 | ~~autenticação do painel~~ | **descartada** pelo dono (D-56) | `DECISIONS.md` |
| 5 | chaves de API no motor | reescrita com as **três correções** sobre o desenho da `v2` | `SECURITY_REVIEW.md` §4 |
| 6 | filtro de endereço privado na captura de site | no **serviço**, não no template | `SECURITY_REVIEW.md` §6 |
| 7 | 14 comandos sem endereço de serviço | nota de dependência escrita (be5d537); o endereço depende do dono | plano |
| 8 | ~~agendamento~~ | **entregue em 04/11/2026** (D-48) | `SCHEDULER.md` |
| 9 | tela de concessões/cotas para o administrador | rotas existem, tela não; decidir com o dono | `UX_CHANGES.md` §7 |
| 10 | renomear `casa` e `Pool` | frente B, e exige adaptador do nome antigo | `UX_CHANGES.md` §7 |
| 11 | `configura menu` não alcança a numeração | `numbered` no enum `field` do schema, no `palavras` do vocabulário e no avaliador — mexe em validação de documento guardado, então é frente **J** | `MENU_COMO_AUTOMACAO.md` |
| 12 | 13 campos de gatilho e condição sem descrição no schema | mesma forma das 46 já escritas | `LCN_FUNCTION_REFERENCE.md` |

## 5. O que foi recusado, e por quê

Não é omissão: é escolha registrada, cada uma com a razão.

| recusado | razão |
|---|---|
| portar `src/engine/senderRateLimiter.js` da `v2` | derruba `tests/gateway-encaminhamento.test.mjs` em seis tipos de mensagem, e o lugar certo (`filasDeRecursos.js`) já existe |
| portar o `scheduler.js` da `v2` | seis defeitos medidos, e consertar o caminho abriria um **segundo escritor** no banco do motor; o agendador foi reescrito no motor (D-48) |
| portar `pool_routing` | tabela com **zero leitores** |
| semeadura de templates em toda conexão | contraria a regra de que só o dono clicando instala |
| merge da `v2` | ela não passa na própria bateria, e as migrações colidem em três vias |

## 6. Verde não é prova

A bateria chegou a **6032** checagens, zero vermelho, exit 0 — e a linha abaixo
é a que importa mais nesta lista:

> **Verde não é prova de que a regra existe — é prova de que nenhum teste a
> contradiz.**

Já custou duas vezes neste projeto: o escopo `local` em metade das camadas
(com um teste de lista exata **premiando** a divergência) e o
`trigger.watcher`, que virou código morto com a bateria inteira verde. É por
isso que a coluna "prova" desta tabela aponta documento e arquivo, não o número
de checagens.
