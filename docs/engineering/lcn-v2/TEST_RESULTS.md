# TEST_RESULTS — o que a bateria provou, o que ela não prova

Parte **H** do relatório final. Tudo aqui é resultado de execução; nenhum número
foi estimado. O pedido proíbe declarar teste executado sem executar, e proíbe
apagar teste para esconder falha — as duas regras valem linha por linha deste
documento.

## Como a bateria é executada neste projeto

Não há descoberta automática. `npm test` é **uma cadeia explícita de `&&`** no
`package.json`, com cerca de 130 invocações `node tests/<nome>.test.mjs`.

Duas consequências que mudam como se lê o resultado:

1. **Arquivo novo de teste é invisível até entrar na cadeia.** Criar
   `tests/foo.test.mjs` não o faz rodar. Quem escreve teste novo acrescenta a
   invocação no `package.json`, ou o teste não existe na prática.
2. **A cadeia `&&` ABORTA no primeiro arquivo que falha.** Uma falha no meio
   trunca a contagem: o número de verdes cai não porque houve regressão em
   massa, mas porque os arquivos seguintes nunca rodaram. **Contagem baixa com
   `exit != 0` não é "muitas regressões", é parada antecipada.**

O projeto **não** usa `node:test`. Cada arquivo é um executor escrito à mão:
`let falhas = 0`, um ajudante `check(...)` que imprime `✅` ou `❌`, um
`console.log` final e `process.exit(falhas ? 1 : 0)`.

Portanto a contagem de verdes é:

```
grep -c '✅' <log>
```

### A armadilha de contar só os ❌

Alguns arquivos — `tests/memoria-runtime.test.mjs` é o exemplo — montam o
`check` sobre `assert`, que **lança** em vez de imprimir `❌`. Nesses, uma
falha produz `exit=1` com **zero** `❌` no log: o processo morreu na exceção.

**Regra:** com `exit != 0`, ler a cauda do log. Contar `❌` não basta.

## Os números, medidos

| marco | verdes | vermelhos | saída | log |
|---|---|---|---|---|
| linha de base (`onda1`, antes de qualquer mudança da `v3`) | **4394** | 0 | 0 | `base-v3.log` |
| fim da frente E (limites administrativos) | **4536** | 0 | 0 | `v3-frenteE-fim2.log` |
| fim da frente F (pareamento + credencial fora do log) | **4543** | 0 | 0 | `v3-frenteF.log` |

A linha de base é o contrato: **qualquer queda abaixo de 4394 é regressão**,
não "ajuste de expectativa". O saldo da `v3` até aqui é **+149 checagens**, das
quais +7 vieram da mudança de credencial no log (frente F) e +142 da frente E.

Para comparação honesta, o que o pedido mandou auditar: a própria bateria da
`v2` terminava com **6 falhas**. A `v3` não herdou nenhuma delas, porque a `v2`
não entrou por merge (ver DECISIONS).

## O que a bateria PROVA

- **Ida e volta da linguagem.** `tests/lcn-ida-e-volta.test.mjs:41-52` renderiza
  **todos** os templates do catálogo e exige que recompilar o texto
  descompilado devolva o mesmo documento. É o portão principal: um `.lcn`
  torto derruba isto e, com isto, muita coisa atrás.
- **Carregamento do catálogo.** `templateId` duplicado lança erro
  (`src/engine/templates/catalog.js:58`) e derruba o catálogo inteiro.
- **Contratos de lista exata.** `tests/engine-editor-contract.test.mjs` afirma a
  lista exata de ações e de escopos. Isso tem dois lados, e os dois já
  aconteceram neste projeto: impede divergência entre as camadas **e** pode
  premiar divergência, se alguém puser a palavra nova onde não há asserção e
  omitir onde há. Foi exatamente assim que o escopo `local` passou.
- **Fronteira de encaminhamento.** `tests/gateway-encaminhamento.test.mjs` prova
  que mensagem legítima chega ao motor. É a guarda que o limitador de envio da
  `v2` derrubava para seis tipos de mensagem.
- **Admissão sob carga.** `tests/fila-admissao.test.mjs` prova que evento
  recusado por sobrecarga **não é tocado**.
- **Pareamento por código.** `tests/parear-por-codigo.test.mjs`, com as 7
  checagens novas desta leva (ver PAIRING).

## O que a bateria NÃO prova — e isto importa mais

**A bateria RENDERIZA template; ela não EXECUTA o fluxo.** Essa frase foi
comprada com defeito real duas vezes nesta base:

1. `documento is not defined` no caso novo do avaliador para leitura de acervo:
   **4288 checagens verdes** e nenhuma delas executava a ação.
2. `separarIdMembro` devolve `{ groupId, memberId }` e o código lia `pessoaId`.
   Não quebrava nada: devolvia `undefined`, todas as linhas caíam no
   `continue`, e o ranking ficava **vazio para sempre, sem erro nenhum**.

E o caso que resume a lição inteira, do outro lado: o ramo do vigia escrito
como `tipoDoGatilho === 'trigger.watcher'` — classe que **não existe**
(em `vocabulario.js` o vigia é `trigger.message`). O ramo virou código morto, um
vigia com gatilho qualquer passou a compilar calado, e **a bateria inteira
ficou verde**, porque nenhum teste afirmava aquela recusa.

> **Verde não é prova de que a regra existe — é prova de que nenhum teste a
> contradiz.**

Outras coisas que a bateria não cobre, declaradas:

- **Nada foi validado em produção.** Nenhum resultado deste documento vem do
  servidor; tudo é local. O pedido é explícito: não declarar implementação
  validada em produção se só foi testada localmente. Nenhuma foi.
- **Não há teste de pareamento contra o WhatsApp real.** O que se testa é o
  caminho do painel até a chamada da biblioteca, com a biblioteca dublada.
  Pedir código de verdade exige um número e uma conta, e isso não se faz em
  bateria automática.
- **Não há teste de autenticação de painel, porque não há autenticação de
  painel.** Ver SECURITY_REVIEW.

## Guardas que o plano exige e que AGORA EXISTEM

| guarda | arquivo | checagens |
|---|---|---|
| numeração única de migração | `tests/migracoes-numeracao.test.mjs` | **8** — três delas provam que a guarda reprova o caso real da `v2` (dois arquivos `011`), um prefixo de dois dígitos e um arquivo sem número |
| intervalo mínimo entre pedidos de código de pareamento | `tests/parear-por-codigo.test.mjs` | **13** — as duas bordas (180 s cravados passa, 181 s passa, 10 s recusa dizendo quantos segundos faltam), mais relógio para trás, primeiro pedido, e o intervalo configurado para mais e para menos |
| template renderizado contra o JSON Schema e contra os portões da instalação | `tests/templates-contra-schema.test.mjs` | **366** — os 121 templates do catálogo, cada um conferido em `schemaVersion`, no Ajv contra `automation.v1.schema.json` (com nó órfão, ciclo e referência quebrada) e na lista de nós executáveis pelo runtime; mais **duas negativas** com documento torto, para a guarda falhar se a validação parar de rodar |

As três eram pendência nesta tabela até 01/11/2026. Saíram dela por entrega
medida — `npm test` em **4930 verdes, zero vermelho, exit 0** —, não por
reclassificação.

A terceira fecha o furo que o `TEMPLATES.md` §3.4 descrevia: a ida e volta
prova a **linguagem**, não a **instalação**. Um template verde na bateria podia
ser recusado com **422** no clique de instalar, e a vitrine prometia o que a
instalação negava.

## Guardas que o plano exige e que AINDA NÃO EXISTEM

Declaradas como pendência, não como feitas:

| guarda | por que ela precisa existir |
|---|---|
| todo estado da conexão alcançável a partir de `idle` | o defeito T1-1 da branch principal: sem isso, instalação existente boota em `idle` e não sai |
| ETag muda quando a conexão muda | `"v${versao}-${estado}"` com 304 em `src/web/router.js:93`: duas mudanças dentro do mesmo estado são invisíveis para o painel |
| ciclo evento→comando com e sem chave de API | o defeito T1-3: a `v2` deixou o motor mudo porque exigia Bearer que o cliente interno nunca manda |

## Como reproduzir

```
npm test
```

Verdes: `grep -c '✅'` na saída. Com saída diferente de zero, **ler a cauda** —
pela razão da seção "a armadilha de contar só os ❌".
