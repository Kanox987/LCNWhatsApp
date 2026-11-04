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

A segunda superfície nomeada pelo pedido.

### 2.1 O que é

`pool:` é a linha de cabeçalho que diz **qual conjunto de números responde** por
aquela automação. É o único campo do cabeçalho cujo valor não é uma palavra da
linguagem: é o **id de uma fila cadastrada na aba Automações**, criada pelo dono.

O documento compilado guarda isso em `responder`, e o schema exige o bloco
inteiro (`src/engine/server/schema/automation.v1.schema.json`):

```json
"responder": {
  "type": "object", "additionalProperties": false,
  "required": ["strategy", "poolId"],
  "properties": {
    "strategy": { "const": "weighted_rendezvous" },
    "poolId":   { "type": "string", "minLength": 1 }
  }
}
```

`responder` está no `required` do documento, então **toda automação declara um
pool**, queira ou não. O `strategy` tem **um único valor legal** e é escrito pelo
compilador, nunca pela pessoa.

### 2.2 Onde aparece

| arquivo:linha | o que faz |
|---|---|
| `src/lcn/vocabulario.js:835` | a única entrada de vocabulário: `{ chave: 'pool', vale: 'todos', ajuda: '…' }` |
| `src/lcn/compilar.js:740` | escreve `responder` com o `strategy` fixo |
| `src/lcn/compilar.js:998` | lê a linha `pool:` do cabeçalho |
| `src/lcn/descompilar.js:252` | escreve a linha de volta |
| `src/lcn/referencia.js:116` | entra na referência servida ao painel |
| `src/engine/server/validate.js:293-296` | **o único lugar que de fato cobra algo** |
| `src/engine/server/menuPadrao.js:71` | repete o `strategy` fixo (era `nativeAutomations.js`, removido na frente C) |
| `src/engine/server/routes/pools.js` | o CRUD da aba |
| `src/engine/server/migrations/001_init.sql:23` | a DDL de `pool_members` |
| `src/web/public/pages/pools.js:125,175-177` | o `weight`, que só existe no painel |
| `src/web/public/pages/automations.js:652,659` | o esqueleto que o painel oferece |
| `src/web/public/logic/parametros.js:72` | preenche `{{params.poolId}}` na instalação |

### 2.3 O comportamento real: existência, e nada além

A cobrança inteira são quatro linhas (`validate.js:293-296`):

```js
const poolId = documento?.responder?.poolId
if (typeof poolId === 'string' && poolId && db?.prepare) {
  const poolExiste = db.prepare('SELECT 1 FROM pools WHERE id = ?').get(poolId)
  if (!poolExiste) erros.push({ path: '/responder/poolId', message: `pool inexistente: ${poolId}` })
}
```

Isso é **tudo**. E as três coisas que a aba apresenta ao lado do pool não decidem
nada no caminho de entrega — medido, procurando leitor por leitor:

| peça | quem lê |
|---|---|
| `pool_members` (a lista de números) | **ninguém** no caminho de entrega: só o CRUD da própria rota |
| `weight` (o peso por membro) | **ninguém**: aparece só em `pools.js:125,175-177`, no painel |
| `strategy: weighted_rendezvous` | **ninguém**: é escrito nos dois lugares e lido em nenhum |

Ou seja: **hoje o pool é um NOME que precisa existir para a publicação passar.**
O painel já diz isso, e diz honestamente — `src/web/public/pages/pools.js:135-150`
registra em comentário que oferecer "pôr um número" como se mudasse o atendimento
"seria prometer um comportamento que não existe", e o texto visível termina em
"…e, hoje, a lista de membros não decide quem atende".

### 2.4 Valores aceitos e recusados, medidos

**O compilador aceita TODOS**, e isso está certo: `src/lcn` não pode alcançar o
banco (é a regra de injeção que mantém a linguagem independente do motor), então
ele não tem como saber se um pool existe.

| escrito | compila? | valor em `responder.poolId` |
|---|---|---|
| `pool: pool-local` | sim | `"pool-local"` |
| `pool: nao-existe-em-lugar-nenhum` | sim | o próprio texto |
| `pool: com espaço no meio` | sim | o próprio texto |
| `pool: POOL-MAIUSCULO` | sim | o próprio texto |
| `pool: 123` | sim | `"123"` |
| `pool: ` (linha vazia) | sim | `""` |
| linha **ausente** | sim | `""` |

As duas últimas linhas são o defeito do §2.6. A recusa só aparece na
**publicação**, e com a mensagem certa: `pool inexistente: <id>`.

### 2.5 O catálogo, medido

**121 de 121 templates declaram `pool: {{params.poolId}}`** — a linha é idêntica
em todos. Não é escolha de quem escreveu o template: é um parâmetro preenchido na
instalação, a partir da lista de pools vivos (`parametros.js:72`). Ninguém digita
um id à mão.

Então, na prática: **a linha existe em 100% dos documentos e seu valor nunca é
escolhido por quem escreve o comando.** É cabeçalho obrigatório que o usuário
comum nunca decide.

### 2.6 O defeito achado aqui, e consertado

`descompilar.js` emitia `pool:` **sem condição nenhuma**. Documento sem pool —
o que acontece sempre que o campo chega vazio — produzia a linha `  pool: `, vazia.

Medido antes de mexer: para `nome:` e `pool:`, **omitir a linha devolve o mesmo
documento que a linha vazia** (os dois compilam para `""`), então omitir é
comprovadamente sem perda. E o mesmo defeito em `acessa:` era pior que cosmético:
recompilar `  acessa: ` **quebrava**, com um erro que nem nomeia o campo
(`tipo de mensagem desconhecido: ""`).

O princípio que autoriza o conserto **já estava escrito no próprio arquivo**,
vinte linhas abaixo, no bloco de fila: linha de cabeçalho que não decide nada
enche o cabeçalho e some no meio do que decide, e o compilador repõe o padrão na
volta. As três linhas passaram a ser condicionais, e nasceu
`tests/cabecalho-sem-linha-vazia.test.mjs` para que a ida e volta não possa
voltar a produzir texto que ela mesma recusa.

**E o defeito era uma classe, não três instâncias.** Despachei um agente
(Gemini, `gemini-3.8-flash-high` pelo rodízio do agy, em modo somente-leitura)
para varrer o resto do emissor de cabeçalho procurando o mesmo padrão. Ele
apontou dois campos, e os dois se confirmaram por medição minha:
`precisa de um link:` e `precisa de uma mídia:` saíam sempre que
`inputPolicy.requires` existisse, com o local vindo de `(exige.from || [])` — com
a lista vazia o join dá `""` e a linha sai vazia. Recompilar essa linha
**quebra**: `não sei procurar ""`.

Duas coisas que a medição mostrou e o relatório do agente não podia ver:

1. **O conserto óbvio trocaria um erro por outro.** A primeira ideia era tornar
   condicional só a linha `precisa de …`. Sondado antes de editar: `sem ele:`
   **não para de pé sozinho** — o compilador recusa com `"sem ele" precisa vir
   depois de "precisa de ..."`. Então o bloco inteiro passou a ser condicional.
2. **O schema já proíbe esse documento.** `requires` tem `required: ["kind","from"]`
   e `from` tem `minItems: 1`, então — diferente do `acessa:` — o caminho não é
   alcançável por documento validado. É a rede embaixo da rede. Consertado de
   todo jeito: é a mesma classe, custa três linhas, e o `acessa:` *também* era
   proibido pelo schema e ainda assim quebrava o editor antes do publish.

A guarda cresceu de 17 para **27 checagens** com essa seção.

### 2.7 O nome é apropriado?

**Não, e por uma razão diferente da do `casa`.** `casa` é uma palavra portuguesa
que engana; `Pool` é uma palavra inglesa que não traduz nada para quem instala um
bot. Pior: ela promete **balanceamento** — "pool com pesos" é vocabulário de
infraestrutura — e o sistema não balanceia nada hoje.

Proposta, pela mesma forma do §1.8: **`atende por:`** na linguagem e **"Fila de
atendimento"** na aba, mantendo `pool:` como forma aceita. O precedente é o
`de:` → `quem:`, que já foi feito neste projeto sem quebrar documento guardado.

**O que NÃO propor, e é o ponto mais importante desta seção:** não se conserta o
nome prometendo o que não existe. Enquanto `pool_members`, `weight` e `strategy`
não tiverem leitor, qualquer nome que sugira distribuição de carga mente —
inclusive "Fila de atendimento", se a tela não disser que a lista não decide quem
atende. A ajuda contextual tem de repetir o que o painel já diz.

### 2.8 As consequências de renomear, mapeadas

O pedido proíbe renomear estrutura interna, API ou dado persistido sem mapear as
consequências. Mapa:

| camada | o que mudaria | risco |
|---|---|---|
| a palavra `pool:` no `.lcn` | aceitar `atende por:` como sinônimo | **nenhum**, se a antiga continuar aceita |
| `responder.poolId` no documento | — | **não tocar**: é dado persistido em 90+ revisões |
| tabelas `pools` / `pool_members` | — | **não tocar**: migração de dado vivo |
| rota `/pools` | — | **não tocar**: é API |
| rótulo da aba e ajuda | "Fila de atendimento" | nenhum: é texto |
| os 121 templates | nada: o valor vem de `{{params.poolId}}` | nenhum |

**Proposta em duas etapas**, igual à do `casa`:
1. **Agora, sem autorização nova:** a ajuda contextual passa a dizer o que o pool
   decide (existência) e o que ele **não** decide (quem atende), no mesmo texto
   honesto que o painel já usa. Nenhum rename.
2. **Só com autorização do dono:** o sinônimo `atende por:` na linguagem e o
   rótulo novo na aba. Nada de tocar em `poolId`, nas tabelas ou na rota.

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

**A linha 3 é lacuna, e é a mesma do `casa`.** 46 dos 154 campos juntados não
têm explicação técnica, então ela chega vazia na tela para eles — exatamente o
que acontecia com `match` (§1.6) antes do conserto. Não é uma segunda lista a
escrever: é escrever a `description` na fonte que já valida o documento, campo
por campo, e a tela recebe de graça.

**Três números medidos, que contam conjuntos diferentes** — vale registrar para
que a próxima medição não pareça contradizer esta:

| conjunto | total | sem explicação |
|---|---|---|
| campos **juntados** (o que a tela mostra) | 154 | **46** |
| campos de **ação no schema** (`properties.config`) | 168 | **51** |
| **todas** as famílias do schema (ação, gatilho, condição) | 186 | **59** |

O schema tem mais campos de ação que o join entrega, e 4 dos 51 têm chave que
nem aparece no join. Então consertar os 46 buracos da tela é escrever
`description` em campos do schema, e o trabalho completo da fonte de verdade são
os 59 — uma linha de schema cada.

**Os 46 estão escritos, e o buraco fechou — medido, não declarado.** Com as
`description` no schema, a referência que a IDE serve passa de
`campo.explicacaoTecnica 108/154` para **154/154**: nenhum campo de ação chega à
tela sem explicação técnica. Os 13 restantes dos 59 são campos de gatilho e de
condição que o join não entrega, e seguem como trabalho em aberto.

Os três números que continuam baixos — `valoresAceitos 24/154`, `padrao 4/154`,
`limites 30/154` — **não são buracos**: só existem onde o schema de fato declara
`enum`, `default` ou faixa. Preenchê-los exigiria inventar valor, que é
exatamente o que §23 proíbe.

---

## Estado

Nada aqui foi implantado. O trabalho está na branch `v3`, sem commit e sem
implantação. Os consertos de §1.6 e §2.6 estão aplicados no código; as propostas
de nome de §1.8 e §2.7 **não** estão aplicadas, e nada da etapa 2 de §1.9 nem de
§2.8 foi tocado.

As duas guardas foram executadas, não declaradas:

| guarda | arquivo | checagens | bateria depois |
|---|---|---|---|
| ajuda do cabeçalho × schema (§1.6) | `tests/cabecalho-contra-schema.test.mjs` | 17 | **5019 ✅ / 0 ❌** |
| nenhuma linha de cabeçalho vazia (§2.6) | `tests/cabecalho-sem-linha-vazia.test.mjs` | **27** | **5046 ✅ / 0 ❌** |

Em todas as rodadas `npm test` terminou em **exit 0**, e o número subiu exatamente
pelas checagens novas (5002 → 5019 → 5036 → 5046) — nenhuma regressão e nada
contado duas vezes.

A primeira foi provada por **mutação**: reintroduzindo cada um dos dois defeitos,
o arquivo acusa exatamente 2 ❌, uma da comparação de listas e outra do
compilador, com a mensagem de erro dele.

A segunda não precisa de mutação para valer, porque sua terceira seção fixa uma
**equivalência medida**: omitir `nome:` ou `pool:` devolve byte a byte o mesmo
documento que escrever a linha vazia. Se um dia isso deixar de valer, omitir a
linha passaria a MUDAR o documento — e a falha aparece na bateria em vez de
aparecer numa automação salva torta.

### O que a ajuda contextual ganhou de fato

| onde | o que entrou | conferido como |
|---|---|---|
| 46 campos de ação no schema | `description`, inseridas cirurgicamente no arquivo (sem reformatar: `json.dump` não devolve o schema byte a byte) | toda chave existe e estava sem `description`; **todo valor citado entre aspas simples está no `enum` do próprio campo**; nenhuma alegação de "padrão X" contradiz o `default` do schema — e nenhuma delas recai sobre campo cujo schema não declara `default`. Resultado: `verificados: 46, problemas: 0` |
| ajuda de `pool:` | a segunda frase diz que a lista de membros e os pesos **não escolhem quem atende** | bate com §2.3, que mediu os três leitores mortos, e com o que a própria aba Automações já admite |

As descrições foram escritas por agente (Gemini, `gemini-3.8-flash-high` pelo
rodízio do agy, somente-leitura) a partir do código leitor de cada campo, e
**nenhuma entrou sem a conferência acima**. O agente devolveu 51 entradas e
marcou 5 como `NAO_ENCONTREI_LEITOR` — as cinco são `actionHttp.config.*`,
exatamente a definição que o projeto já lista em
`DIVERGENCIA_CONHECIDA = ['action.http']`. Essas 5 foram descartadas, não
adivinhadas.

Medido localmente. **Nada disto está validado em produção.**
