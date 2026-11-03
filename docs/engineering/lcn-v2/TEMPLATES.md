# TEMPLATES — o catálogo, e o que um `.lcn` tem de cumprir

Escrito em 01/11/2026. Cada afirmação aponta arquivo e linha, conferida por
comando nesta árvore (`v3`, a partir de `onda1`).

Este documento NÃO repete a linguagem. A referência de vocabulário, ações,
operadores e campos está em `LCN_FUNCTION_REFERENCE.md` (56 KB, gerado da
fonte única). Aqui está o que o **catálogo** exige de um arquivo, por que cada
exigência existe, e o que a bateria prova sobre eles.

---

## 1. O que o catálogo é

Uma pasta de arquivos `.lcn` lida para um `Map`
(`src/engine/templates/catalog.js:53-62`):

```js
export function carregarCatalogo ({ pastaCatalogo = PASTA_CATALOGO } = {}) {
  if (!fs.existsSync(pastaCatalogo)) return new Map()
  const catalogo = new Map()
  for (const nomeArquivo of fs.readdirSync(pastaCatalogo).filter((n) => n.endsWith('.lcn')).sort()) {
    const template = carregarArquivo(pastaCatalogo, nomeArquivo)
    if (catalogo.has(template.templateId)) throw new Error(`templateId duplicado no catálogo: ${template.templateId}`)
    catalogo.set(template.templateId, template)
  }
  return catalogo
}
```

**Estado medido:** 121 arquivos em `src/engine/templates/catalog/`,
distribuídos em três categorias:

| categoria | arquivos |
|---|---|
| `utilitarios` | 86 |
| `modulos-especializados` | 30 |
| `configuracoes` | 5 |

### 1.1 Pôr no catálogo NÃO ativa nada — por construção

`GET /templates` lista. Um template só vira automação por
`POST /templates/:id/install` (`src/engine/server/routes/templates.js:159`),
que é o dono clicando no painel.

Então **acrescentar arquivo em `src/engine/templates/catalog/` adiciona à
biblioteca e não liga nada.** A restrição do dono ("não ativa, só adiciona")
está satisfeita pelo desenho, não por disciplina — e a prova de que nada foi
ativado é `git status` mostrar só arquivos novos naquela pasta e nenhuma
chamada a `/install` no diff.

---

## 2. A anatomia de um arquivo

Modelo canônico: `src/engine/templates/catalog/figurinha-api.lcn`. É o mais
completo do catálogo (cabeçalho de template, `se`/`senão`, `chama` com bloco
`com`, `configurável` inteiro), e é por isso que ele é o arquivo citado em
todo briefing.

### 2.1 Três blocos, nesta ordem

```
template figurinha-api v3          ← identidade
  nome: Figurinha
  descrição: ...
  categoria: utilitarios

automação                          ← o que o motor executa
  nome: Figurinha
  tipo: comando
  dispara com: {{params.command}}
  ...
  se evento message.args == "{{params.letraEsticar}}"
    chama {{params.conexao}}.figurinha
      com
        arquivo: a mídia
        ...

configurável                       ← o formulário que o painel desenha
  command: texto = "/fig"
    rótulo: Comando
    ajuda: A palavra que a pessoa digita. ...
  modo: opção (transparente, quadrado, esticar) = "transparente"
    rótulo: Como encaixar no quadrado (padrão)
```

### 2.2 O bloco `configurável` é o formulário, e é do autor do comando

Quem **escreve** o template declara o formulário. O painel não adivinha: ele
desenha o que o bloco diz, com o `rótulo` e a `ajuda` escritos ali. É o que
torna o comando editável pelo painel, sem abrir o terminal.

Tipos de parâmetro de instalação, e o que cada um entrega:

| escrito no `.lcn` | tipo interno | entrega |
|---|---|---|
| `texto = "..."` | `string` | texto |
| `número = 5` | `number` | número (`src/lcn/compilar.js:605`) |
| `opção (a, b, c) = "a"` | `enum` | **TEXTO**, sempre |

E os campos do **fluxo** (dentro da `automação`) têm outro conjunto de tipos,
`TIPOS_DE_CAMPO` em `src/lcn/compilar.js:105`:

```js
const TIPOS_DE_CAMPO = new Set(['texto', 'palavra', 'booleano', 'numero', 'operando'])
```

**A armadilha que custou tempo e virou teste:** um parâmetro de `opção`
entrega texto. Num campo **numérico** ou **booleano** do fluxo, isso quebra a
ida e volta — o render devolve a string `"não"` e a recompilação devolve
`false`. As duas regras que saíram disso:

- campo numérico do fluxo quer parâmetro `número`, nunca `opção`;
- campo booleano se escreve **literal** no fluxo (`nunca o dono: sim`, como em
  `rebaixar.lcn`), e se muda em Programar. `booleano` **não é** tipo de
  parâmetro de instalação.

Houve também um defeito do compilador consertado nesta linha: `tipo: 'número'`
(com acento) não casava com `'numero'`, caía no ramo de texto **em silêncio** e
virava string. Hoje `TIPOS_DE_CAMPO` recusa tipo que não existe, com a linha
(`src/lcn/compilar.js:547`).

---

## 3. OS PORTÕES — o que derruba um arquivo, e o que ele derruba junto

Cada linha é uma exigência conferida por teste. A coluna "derruba" é o que
importa: no catálogo, **um arquivo torto não falha sozinho**.

| exigência | onde | o que derruba |
|---|---|---|
| **o arquivo compila** | `carregarArquivo` | **o catálogo INTEIRO**, e com ele muitos testes |
| **`templateId` único** | `catalog.js:58` | **o carregamento inteiro** — `throw` imediato |
| **tem `categoria`** | cabeçalho | o próprio arquivo |
| **todo `{{params.x}}` tem entrada no `configurável`** | `tests/engine-templates-render.test.mjs:60-62` | o próprio arquivo, **no render** |
| **ida e volta perfeita** | `tests/lcn-ida-e-volta.test.mjs:38-54` | o próprio arquivo |
| **ação declarada existe no runtime** | `tests/templates-contra-schema.test.mjs` | o próprio arquivo — **antes** de a instalação recusar com 422 |
| **o documento renderizado passa no JSON Schema** | `tests/templates-contra-schema.test.mjs` | o próprio arquivo |

### 3.1 `templateId` duplicado é a restrição dura da divisão entre IAs

`catalog.js:58` lança na hora. Dois agentes escolhendo o mesmo id derrubam o
catálogo inteiro — e com ele a bateria quase toda. Por isso a regra de
despacho é a mesma das migrações (`MIGRATION.md` §2.3):

> os `templateId` são **fixados por quem despacha**, antes do despacho, numa
> tabela fechada. Nenhum agente escolhe o próprio id.

Foi assim nas 21 ondas da `onda1`, e nenhum template foi escrito duas vezes.

### 3.2 Placeholder sem parâmetro declarado NÃO vira string vazia

`tests/engine-templates-render.test.mjs:60-62`:

```js
try { renderizarTemplate({ parameters: [], documentTemplate: { t: '{{params.naoexiste}}' } }, {}) }
catch { lancouPlaceholderDesconhecido = true }
check('placeholder params.* sem parâmetro declarado correspondente lança erro (nunca vira string vazia)', ...)
```

A escolha de **lançar** em vez de interpolar vazio é deliberada: um comando que
sai com um buraco no texto funciona na aparência e falha no ar, e quem instalou
não tem como saber.

### 3.3 A ida e volta é o portão principal

`tests/lcn-ida-e-volta.test.mjs:38-54` renderiza **TODOS** os templates do
catálogo com os padrões e exige `compilar(descompilar(documento))` idêntico ao
documento. Um `.lcn` torto quebra ali.

E o princípio que justifica esse teste existir, dito pelo ChatGPT num painel
anterior e guardado porque é exato:

> o descompilador jamais deveria entregar um texto aparentemente editável que,
> ao ser salvo, altere silenciosamente o documento.

### 3.4 O portão que a bateria não cobria — **coberto em 01/11/2026**

A ida e volta conhece o catálogo **renderizado**, não o catálogo
**instalado**. Um template podia passar nela e ser **recusado com 422** no
clique de instalar, porque a instalação encara três recusas que a ida e volta
nunca exercita:

| portão da instalação | onde | o que recusa |
|---|---|---|
| `normalizarDocumento` | `automationsService.js:47-54` | `schemaVersion` diferente de 1, id divergente |
| `validarAutomacao` | `automationsService.js:158-159` | o Ajv contra `schema/automation.v1.schema.json`, mais nó órfão, ciclo e referência quebrada |
| nó executável pelo runtime | `automationsService.js:165-177` | `type` fora de `ACOES_SUPORTADAS` / `GATILHOS_SUPORTADOS` / `CONDICOES_SUPORTADAS` |

```js
if (node.type.startsWith('action.')) return !ACOES_SUPORTADAS.includes(node.type)
...
throw new ErroHttp(422, `Nó "${tipo}" ainda não é executável pelo motor.`, ...)
```

**A guarda existe agora:** `tests/templates-contra-schema.test.mjs`. Ela
renderiza **cada** template do catálogo com os mesmos padrões da ida e volta
(parâmetro sem padrão recebe um valor qualquer; parâmetro com padrão fica com
o dele) e submete o documento **como o instalador o monta** — inclusive o
`scope`, que `routes/templates.js:90` sobrescreve com o escolhido na tela e que
o documento renderizado não carrega. Sem isso a guarda validaria uma forma que
a instalação nunca submete.

Três detalhes de desenho, para quem for editá-la:

- **Chama `validarAutomacao(documento)` sem banco.** A função troca os
  argumentos quando recebe um só (`validate.js`), e a única checagem que
  depende de banco é a existência do `poolId` — que é dado instalado, não
  propriedade do template.
- **Confere o portão 3 por conta própria**, repetindo a lista de
  `automationsService.js:165-177`. Uma ação escrita certo que o runtime desta
  versão não executa passa pelo schema e cai só na publicação.
- **Duas checagens negativas no fim**, com documentos deliberadamente tortos
  (um sem gatilho, um com campo que o schema não conhece). Sem elas, a guarda
  ficaria verde se a validação parasse de rodar — a armadilha que este projeto
  já pagou duas vezes (`trigger.watcher`, e a leitura do acervo com 4288
  checagens verdes e nenhuma executando a ação).

---

## 4. Erros reais que os templates já produziram

Não é lista hipotética. Cada um foi medido, consertado, e a razão está escrita
dentro do próprio `.lcn` em `avisa nota` — porque quem editar em Programar vai
querer "simplificar" de volta.

| defeito | por que passava | forma correta |
|---|---|---|
| guarda de ausência escrita `== ""` | `compararValores` (`src/engine/server/evaluator.js:643`) compara ausente com vazio e devolve **falso**; o fluxo caía no `senão`, que é o ramo que **executa** | `contém ""` — todo texto contém o vazio, então é verdadeiro para qualquer valor gravado e falso quando não há nada. **Falha fechado** |
| separador colidindo com operando | `argumentos: num1 / op / num2` usa a barra, e a barra é o sinal de dividir: `/calc 10 / / / 2` era partido nos lugares errados | operador aceita sinal **e** palavra; dividir é `:` ou `dividido` |
| conexão com função não declarada | `conexao: "imagem"` no template de QR, e `imagem` não tem `gerar_qr` — teria falhado no ar por uma função que nunca existiu | `tests/conexao-imagem.test.mjs:139` confere que todo template aponte função **declarada**. Padrão trocado para `qr` |
| `soAdmins: booleano` como parâmetro | recusado na compilação; `opção (não, sim)` compila mas quebra a ida e volta | booleano **literal** no fluxo |
| guarda de admin ausente em `advertir` | nada no fluxo exigia admin: qualquer membro advertia e, na terceira, **removia** outro membro | guarda explícita no fluxo |
| `onde: todos os grupos` declarado | nenhum dos templates declara `onde` — o escopo vem da **instalação** | remover o campo |

As duas últimas são minhas, não de agente, e estão aqui pelo mesmo motivo que
as outras.

---

## 5. O limite honesto do catálogo

A bateria **renderiza** template; ela **não executa** fluxo. Isso já custou
dois defeitos que 4288 checagens verdes não viram:

- `documento is not defined` no caso novo do avaliador para leitura de acervo;
- `separarIdMembro` devolve `{ groupId, memberId }` e o código lia `pessoaId` —
  devolvia `undefined`, **todas** as linhas caíam no `continue`, e o ranking
  ficava vazio para sempre, sem erro nenhum.

A formulação está em `TEST_RESULTS.md` e vale repetir aqui:

> **Verde não é prova de que a regra existe — é prova de que nenhum teste a
> contradiz.**

E o limite de catálogo, que não é técnico: **14 comandos esperam endereço de
serviço** (`efeitos`, `clima`, `cotacao`, `traducao`, `encurtador`, `qr`,
`navegador`). `validarEndereco` (`src/engine/server/conexoes/declaracao.js:681`)
recusa conexão sem endereço, e com razão — conexão sem endereço cria algo que
**parece** configurado e não está. O contrato de cada função já está escrito no
`avisa exige` do template correspondente. Falta o endereço, e endereço é do
dono. Registrado na parte J do `FINAL_REPORT.md`.

---

## 6. Estado nesta árvore

| | |
|---|---|
| templates no catálogo | **121** |
| templates escritos nesta onda | **nenhum** |
| automações criadas nesta onda | **nenhuma** |
| guarda de validação contra o JSON Schema | **existe** — `tests/templates-contra-schema.test.mjs`, 366 checagens |

Nenhum template foi acrescentado, editado ou instalado neste trabalho.
