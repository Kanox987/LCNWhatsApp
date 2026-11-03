# Auditoria de interface da linguagem — os nomes que confundem

Frente B do pedido, parte de investigação. O pedido nomeia duas superfícies
como confusas e exige, para cada uma, a mesma coisa: **o que representa, onde
aparece, que comportamento produz, que valores aceita, que valores recusa,
exemplos válidos e inválidos, e se o nome é apropriado** — com a regra
literal *"não atribua um significado por suposição"*.

Este documento responde isso por medição. Cada valor aceito e cada recusa
abaixo saiu de uma execução real do compilador, e a mensagem de erro está
citada como ele a emite. Nada aqui foi inferido do nome.

Regra que vale do começo ao fim, também literal do pedido: **não renomear
estruturas internas, APIs ou dados persistidos sem mapear as consequências.**
Nenhuma proposta deste documento renomeia chave de schema, coluna de banco ou
campo de API. O que se propõe é a palavra que a pessoa escreve e lê.

---

## 1. `casa`

### 1.1 O que é

É a linha de cabeçalho que diz **como a mensagem é comparada com o comando**.
O nome vem de *casamento* (de texto), não da construção: é a terceira pessoa
do verbo *casar*. `casa: exato` lê-se "casa de forma exata".

A definição está em `src/lcn/vocabulario.js:774`:

```js
{ chave: 'casa', vale: 'comando', palavras: CASAMENTOS, doc: 'match' }
```

`vale: 'comando'` significa que a linha só existe na classe `comando`.
`doc: 'match'` é a chave que ela escreve no documento compilado:
`flow.nodes[0].config.match`, dentro de `trigger.command`.

Os quatro valores escritos estão em `vocabulario.js:620-625`:

```js
export const CASAMENTOS = Object.freeze({
  exact: 'exato',
  exact_or_args: 'exato ou com argumentos',
  prefix: 'começa com',
  keyword: 'palavra solta'
})
```

### 1.2 Onde aparece

| arquivo | o que faz ali |
|---|---|
| `src/lcn/vocabulario.js:774` | a definição do campo |
| `src/lcn/vocabulario.js:620-625` | `CASAMENTOS`, as quatro palavras |
| `src/lcn/compilar.js:1032` | `case 'casa':` — traduz a palavra para o enum |
| `src/lcn/compilar.js:1070` | a recusa quando a linha falta |
| `src/lcn/compilar.js:48` | a recusa quando um **porteiro** declara a linha |
| `src/lcn/descompilar.js:294` | `h(\`casa: ${CASAMENTOS[cfg.match] || cfg.match}\`)` — a volta |
| `src/engine/server/evaluator.js:550-564` | `casaUmaPalavra`, onde o comportamento acontece |
| `src/web/public/logic/acoes.js` | o rótulo *"Como comparar"* e a ajuda contextual |
| `src/web/public/pages/automations.js:661` | exemplo na tela de automações |
| `src/lcn/referencia.js:80, 99, 152, 260, 276` | os trechos de exemplo da referência |
| `src/engine/templates/catalog/*.lcn` | 105 dos 121 templates declaram a linha |
| `src/web/public/logic/realce.js:34` | o realce do editor **já teve de se defender do nome** |

Essa última linha é a evidência mais direta de que o nome incomoda alguém
além do leitor humano. O comentário, literal:

> `// Palavra inteira: "casa" não pode acender dentro de "casamento". Fim de`

O realce precisou de uma regra de palavra inteira porque `casa` é prefixo de
`casamento`. É um nome curto e genérico o bastante para colidir com texto
comum.

### 1.3 O comportamento que cada valor produz

Medido em `src/engine/server/evaluator.js:550-564`. `casaUmaPalavra(texto,
comando, match)` recebe a mensagem já com `trim()`, e **as quatro comparações
são indiferentes a maiúsculas**:

| palavra | enum | o que faz | dispara com `/ping`? |
|---|---|---|---|
| `exato` | `exact` | `alvo.toLowerCase() === comando.toLowerCase()` | `/ping` sim; `/ping agora` não; `/pingue` não |
| `exato ou com argumentos` | `exact_or_args` | igual, **ou** `startsWith(comando + ' ')` | `/ping` sim; `/ping agora` sim; `/pingue` não |
| `começa com` | `prefix` | `startsWith(comando)`, sem exigir o espaço | `/ping` sim; `/ping agora` sim; **`/pingue` sim** |
| `palavra solta` | `keyword` | `RegExp('(^|\\s)' + comando + '(\\s|$)', 'i')` | **`oi /ping tudo bem` sim** |

Duas consequências que o nome não comunica e a ajuda precisa dizer:

1. **`exato ou com argumentos` é o único modo que recebe argumento com
   segurança.** É ele que permite `/adv fulano`. `começa com` também aceita o
   texto depois, mas por não exigir o espaço ele captura `/advogado` como se
   fosse `/adv` com argumento `ogado`.
2. **`palavra solta` é o único modo que dispara sem a pessoa começar a
   mensagem com o comando.** Um comando assim reage no meio de uma frase. É o
   modo mais surpreendente dos quatro, e nenhum template do catálogo o usa.

### 1.4 Valores aceitos e recusados, medidos

Compilados de verdade, um a um, numa fonte mínima de classe `comando`:

| escrito | resultado |
|---|---|
| `exato` | **compila** |
| `exato ` (com espaço à direita) | **compila** — o valor é aparado |
| `exato ou com argumentos` | **compila** |
| `começa com` | **compila** |
| `palavra solta` | **compila** |
| `Exato` | **recusado** |
| `comeca com` (sem cedilha) | **recusado** |
| `exato ou com argumento` (singular) | **recusado** |
| `prefix` (a chave do schema) | **recusado** |
| `parecido` | **recusado** |

A mensagem de recusa, literal, com o número da linha:

```
linha 4: modo de casamento desconhecido: "exato ou com argumento".
Use: exato, exato ou com argumentos, começa com, palavra solta.
```

Note a assimetria, que é real e vale registrar: **a palavra escrita é
sensível a maiúsculas e exige o acento**, enquanto a comparação que ela
configura é indiferente a maiúsculas. São duas camadas diferentes — uma é o
vocabulário da linguagem, a outra é o comportamento em tempo de execução.

**A linha é obrigatória.** Sem ela, `compilar.js:1070`:

```
falta "casa:" — como comparar a mensagem.
Use: exato, exato ou com argumentos, começa com, palavra solta
```

O compilador **não inventa padrão**, e isso é decisão registrada no próprio
código: o schema não declara `default` para `match`, então escolher um aqui
mudaria em silêncio o alcance de todo comando que esquecesse a linha. Recusar
no editor é mais barato que um 422 na instalação, longe de quem escreveu.

E a linha **não existe em porteiro**. `compilar.js:48`:

> `"casa" não se aplica a porteiro: modo de casamento é exclusivo de comandos digitados.`

### 1.5 Exemplos

Válido — o comando que recebe argumento:

```
automação advertir
  tipo: comando
  dispara com: /adv
  casa: exato ou com argumentos
  quem: qualquer um

  responde "advertência registrada"
```

Inválido, e por quê:

```
  casa: exato ou com argumento      -> linha N: modo de casamento desconhecido
  casa: prefix                      -> linha N: modo de casamento desconhecido
  (linha ausente)                   -> falta "casa:" — como comparar a mensagem
  casa: exato   (em tipo: porteiro) -> "casa" não se aplica a porteiro
```

### 1.6 Dois defeitos achados aqui, e consertados

O pedido exige, como teste desta frente: *"verifique que as explicações
realmente correspondem aos valores aceitos pelo sistema"*. Ao fazer isso
contra o compilador, a ajuda que já estava no ar **falhou em dois campos** —
e um deles é justamente `casa`.

| campo | a ajuda dizia | o compilador aceita | consertado em |
|---|---|---|---|
| `casa` | `exato ou com argumento` (singular) | `exato ou com argumentos` | `src/web/public/logic/acoes.js` |
| `quem` | `externo` | `só externos` | `src/web/public/logic/acoes.js` |

As duas eram do mesmo tipo: a tela ensinava uma palavra que a linha recusa.
Quem seguisse a ajuda ao pé da letra recebia um erro de sintaxe apontando
para a linha que a própria ajuda mandou escrever.

**A guarda que impede a volta** está em
`tests/cabecalho-contra-schema.test.mjs`. A ajuda desses campos enumera os
valores no formato `palavra = o que faz`, separados por ` · `; então o lado
esquerdo de cada ` = ` é uma afirmação sobre o que se pode escrever. O teste
exige que cada uma dessas palavras (a) esteja na lista fechada do campo e
(b) **compile de verdade** na classe onde o campo vale, mais o par negativo
de que uma palavra inventada é recusada com número de linha. Comparar listas
sozinho não bastaria: se a lista estivesse errada nos dois lados, a
comparação passaria. Cada um dos dois defeitos acima é pego duas vezes por
essa guarda, confirmado por mutação.

E um terceiro, menor, da mesma família: **`match` era a única propriedade de
`triggerCommand.properties.config` sem `description` no schema** — `command`,
`aliases`, `allowFrom`, `args` e `args.separator` todas tinham. Por isso o
campo 3 dos 14 pedidos (explicação técnica) chegava **vazio** na tela
exatamente no campo que o pedido chama de confuso. A `description` foi
escrita em `src/engine/server/schema/automation.v1.schema.json`, e a ajuda
passa a ter explicação técnica derivada da mesma fonte que valida o
documento — que é o que a frente B pede, em vez de uma segunda lista escrita
à mão.

### 1.7 O catálogo, medido

Dos 121 templates, 105 declaram a linha (os 16 restantes são vigias e
porteiros, onde ela não existe):

| valor | templates |
|---|---|
| `exato ou com argumentos` | 79 |
| `exato` | 26 |
| `começa com` | **0** |
| `palavra solta` | **0** |

Dois dos quatro modos não têm um só exemplo na vitrine. Isso importa para a
ajuda: `palavra solta` é o modo de comportamento mais surpreendente — dispara
no meio da frase — e a pessoa que o escolher não tem nenhum template para
copiar. A explicação contextual é, hoje, a única coisa que ela vai ler sobre
ele.

### 1.8 O nome é apropriado?

**Não, e por três razões medidas, não por gosto.**

1. **É ambíguo fora de contexto.** `casa` é substantivo comum em português.
   Lido na coluna de um cabeçalho, sem a frase ao redor, parece dizer *onde*
   algo acontece — não *como* um texto é comparado. O pedido nomeia este
   campo entre as superfícies confusas, o que já é um dado de uso.
2. **O próprio projeto teve de se defender dele.** `realce.js:34` existe
   porque `casa` é prefixo de `casamento`.
3. **Não há precedente de leitura.** As outras linhas do cabeçalho são
   perguntas com resposta óbvia: `dispara com:`, `quem:`, `acessa:`,
   `quando for:`. `casa:` é a única que exige saber de antemão que se trata
   de casamento de texto.

**Proposta: `quando o texto:`**, com `casa:` mantido como forma aceita.

`quando o texto: for exato` / `quando o texto: começar com` lê-se sozinho e
segue o padrão das outras linhas, que são perguntas. A alternativa
`casamento:` conserta a ambiguidade de substantivo mas continua exigindo o
jargão; fica como segunda opção.

**Há precedente no projeto para esta troca**, e está escrito logo acima de
`ORIGENS`, em `vocabulario.js`:

> `// Quem pode acionar. Renomeado de 'de:' para 'quem:' — a pergunta que a`
> `// pessoa faz é "quem pode usar isso?", não "de onde vem".`

Uma linha de cabeçalho já foi renomeada neste projeto, pelo mesmo critério:
a palavra tem de ser a pergunta que a pessoa faz.

### 1.9 As consequências de renomear, mapeadas

O pedido proíbe renomear sem mapear. Mapeado:

| camada | muda? |
|---|---|
| schema (`match`), banco, API, documento compilado | **não muda nada** — a troca é só na palavra escrita |
| `vocabulario.js` | entra a chave nova; `casa` fica como **apelido aceito** |
| `compilar.js` | o `case` passa a aceitar as duas formas |
| `descompilar.js:294` | escolhe **uma** forma para emitir — e é aqui que mora a decisão |
| 105 arquivos `.lcn` do catálogo | continuam compilando pelo apelido |
| 90 revisões guardadas | nenhuma guarda o texto `.lcn`; são documentos JSON. **Nada a migrar** |
| `tests/lcn-ida-e-volta.test.mjs` | é o portão: recompilar o descompilado tem de dar o mesmo documento |

**O risco real não é o compilador, é a ida e volta.** Se `descompilar` passar
a emitir `quando o texto:` e o apelido continuar aceito, nada quebra; mas
todo `.lcn` que alguém tenha salvo fora do sistema passa a divergir do que o
painel mostra ao reabrir a mesma automação. É o aviso que o ChatGPT deu neste
projeto e que ficou registrado: *o descompilador jamais deveria entregar um
texto aparentemente editável que, ao ser salvo, altere silenciosamente o
documento.* Trocar a forma emitida não altera o documento — altera o texto —
mas confunde pelo mesmo mecanismo.

Por isso a proposta é **em duas etapas, e a segunda é decisão do dono**:

1. **agora, sem risco:** `casa:` continua a forma emitida e a ajuda
   contextual passa a explicar o nome (*"casa" vem de casamento de texto*),
   o que já tira a maior parte da confusão e é reversível;
2. **só com autorização:** aceitar `quando o texto:` como entrada e, num
   segundo momento, passar a emiti-la, renumerando os 105 templates de uma
   vez para que catálogo e emissão não divirjam.

Nada da etapa 2 foi aplicado.

---

## 2. `Pool`

A segunda superfície nomeada pelo pedido. Investigação em curso — este
documento recebe a seção quando a medição estiver feita, pelo mesmo formato:
o que é, onde aparece, comportamento, valores aceitos e recusados, exemplos,
e o veredito sobre o nome com o mapa de consequências.

---

## 3. Os 14 campos por função — o que já chega, medido

A frente B pede, para cada função, ajuda contextual com 14 campos. Eles não são
uma lista nova a escrever: `montarReferencia({ prosa, schema })`
(`src/lcn/referencia.js`) já junta o vocabulário, a prosa do painel e o schema
numa só árvore, servida em `/api/v1/meta/linguagem`. Medido contra as 38 ações:

| campo do pedido | de onde sai | preenchido |
|---|---|---|
| 1. nome | `rotulo` | 38/38 |
| 2. explicação curta | `resumo` | 38/38 |
| 3. explicação técnica | `description` do schema | **108/154 campos** |
| 4. utilidade prática | `resumo` + `exemplo` | 38/38 |
| 5. parâmetros | `campos` | 36/38 (duas ações não têm parâmetro) |
| 6. tipos aceitos | `campo.tipo` | 154/154 |
| 7. valores possíveis | `campo.valoresAceitos` | 24/154 (só os campos de lista fechada têm) |
| 8. valores padrão | `campo.padrao` | 4/154 (só 4 campos declaram `default`) |
| 9. campos obrigatórios | `obrigatorios` | 14/38 (as outras 24 não têm campo obrigatório) |
| 10. dependências | `dependencias` | 38/38 |
| 11. exemplo válido | `exemplo` | 38/38 |
| 12. resultado esperado | `resultado` | 38/38 |
| 13. erros comuns | `errosComuns` | 38/38 |
| 14. limitações | `ressalva` | 33/38 |

As linhas 7, 8 e 9 não são lacunas: um campo de texto livre não tem lista de
valores, e uma ação sem campo obrigatório é informação, não ausência.

**A linha 3 é lacuna, e é a mesma do `casa`.** 46 dos 154 campos de ação não
têm `description` no schema, então a explicação técnica chega vazia para eles —
exatamente o que acontecia com `match` (§1.6) antes do conserto. Não é uma
segunda lista a escrever: é escrever a `description` na fonte que já valida o
documento, campo por campo, e a tela recebe de graça. São 46 ocorrências do
mesmo defeito, e o conserto de cada uma é uma linha no schema.

---

## Estado

Nada aqui foi implantado. O trabalho está na branch `v3`, sem commit e sem
implantação. Os consertos de §1.6 estão aplicados no código; a proposta de nome
de §1.8 **não** está aplicada, e nada da etapa 2 de §1.9 foi tocado.

A guarda de §1.6 foi executada, não declarada: `npm test` completo terminou em
**exit 0, 5019 checagens ✅, zero ❌** (eram 5002 antes dela — a guarda
acrescenta 17). E ela foi provada por mutação: reintroduzindo cada um dos dois
defeitos, o arquivo acusa exatamente 2 ❌, uma da comparação de listas e outra
do compilador, com a mensagem de erro dele.

Medido localmente. **Nada disto está validado em produção.**
