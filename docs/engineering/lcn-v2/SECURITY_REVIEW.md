# Revisão de segurança — frente J

Parte **F** do `FINAL_REPORT.md`. Este documento registra o que foi **provado
por execução**, o que foi **corrigido**, e o que **permanece em pé** como risco
conhecido. Nenhuma sessão, credencial, token ou número de telefone aparece aqui
— a regra do pedido é literal: *não exponha sessões ou credenciais nos
relatórios*. Onde um valor seria a prova, o que está escrito é o **caminho** até
ele, nunca o valor.

Nenhum ataque foi executado contra terceiro. Nenhuma infraestrutura de produção
foi tocada. Todas as medições abaixo saíram desta árvore e da biblioteca em
`node_modules`.

---

## 1. A regra que organiza esta revisão

> **Validação na tela não conta como controle.**

É proibição literal do pedido (§23: *não trate validação de frontend como
controle de segurança suficiente*). Toda vez que esta revisão aceita uma
validação, ela aponta **onde no backend** a mesma regra é aplicada de novo. Onde
não houver a segunda aplicação, está escrito que não há.

E a segunda regra, do dono, que decide a forma de toda credencial:

> **Credencial se escreve pelo painel e nunca se lê.**

---

## 2. ACHADO 1 — código de pareamento no log. **Provado e corrigido.**

### A prova

| fato | medição |
|---|---|
| validade do código | **180 segundos** — `PAIRING_CODE_MAX_AGE_SECONDS` em `node_modules/zapo-js/dist/protocol/defaults.js:49` |
| tentativas aceitas | **3** — `PAIRING_CODE_MAX_PRIMARY_HELLOS` (`:50`) |
| onde o código era escrito | `src/connection.js` — a linha de log com os dígitos formatados |
| quanto tempo o log guarda | **semanas.** `src/espelhoLog.js` usa `appendFileSync` com rotação por tamanho, não por tempo |
| quem lê o log | o **painel**, por `logsServico(linhas = 40)` em `src/runtime.js:251`; consumidores em `src/dashboard.js:506` e `src/agent/instanceService.js:30,385,1047` |

A desproporção é a vulnerabilidade: a credencial é válida por **três minutos** e
ficava legível por **semanas**, num arquivo que o painel serve.

O QR tem o mesmo problema e é pior em frequência — rotaciona a cada 20 s
(`QR_ROTATION_TTL_MS`, `:52`), então um log de uma sessão de pareamento guardava
dezenas de imagens de credencial.

### Por que isso importa mesmo com o painel local

O código de pareamento permite **assumir o pareamento da conta** enquanto é
válido. Já havia registro no projeto de que `state.json` carrega QR e código e
por isso ganhou modo `0600` (`src/state.js:109-110`). O log não tinha nenhuma
proteção equivalente, e o painel o entrega como texto.

### O conserto

Os dígitos e o desenho do QR passaram para trás de uma chave de configuração
nova, `hardware.credencialNoLog`, **padrão `false`** (`src/config.js:38`;
guardas em `src/connection.js:594` e `:737`).

Por que uma chave e não a remoção: a regra do dono — *padrão não é teto*. Quem
depura pareamento numa máquina sua liga a chave e vê o código; quem opera não vê
nada. Remover a linha tiraria a capacidade inteira para resolver um padrão
errado.

**O caminho de entrega não mudou e não precisava mudar:** o código chega ao dono
por `state.json`, gravado com `mode: 0o600` e `chmodSync` logo depois
(`src/state.js:109-110`), por `definirCodigoPareamento` (`:163-173`), e é
apagado por `limparCodigoPareamento`. O painel lê de lá e renderiza
(`src/agent/instanceService.js:748-749` → `src/web/public/pages/instance.js:137-141`).
O defeito era a **cópia** no log, não a entrega.

**Guarda:** `tests/parear-por-codigo.test.mjs` ganhou 7 checagens — entre elas a
que prova que com a chave desligada a linha não sai.

---

## 3. ACHADO 2 — o painel não tem autenticação. **Em pé, por desenho declarado.**

A única fronteira hoje é topológica, e isso está escrito no código:

```js
const HOSTS_PERMITIDOS = new Set(['127.0.0.1', 'localhost', '::1'])   // src/web/server.js:15
```

```js
// Regra fixa do plano: NUNCA expor isto em 0.0.0.0 sem autenticação — a
// única fronteira de segurança hoje é "só alcançável localmente". Trocar
// isso por hospedagem pública é outra etapa inteira (control plane/WSS).
```
(`src/web/server.js:53-58`; a função recusa qualquer outro host com erro.)

Medido: `grep -rn "senha\|password\|token\|auth" src/web/server.js` devolve
**vazio**. Não há login, não há papéis, não há sessão.

### O que isso implica, e o que ele segura

| consequência | estado |
|---|---|
| quem alcança `127.0.0.1:4780` é **dono** | aceito hoje; é a premissa do desenho |
| não há como distinguir administrador de cliente | **é o que trava metade da frente E** |
| expor em `0.0.0.0` sem autenticação | impedido por código, não por configuração |

A frente E foi entregue na metade que não depende disto — a hierarquia de
concessões com verdade no backend, enforcement no runtime, comportamento ao
**reduzir** quota e a tela de entrega (`src/agent/concessoes.js`,
`src/web/public/logic/optimization.js`, `src/runtime.js`). A outra metade — as
garantias **anti-elevação**, isto é, o cliente não conseguir subir o próprio
limite por HTTP direto, por JSON importado ou por automação — **não pode ser
provada sem identidade**. Sem login não existe "o cliente"; existe só "quem
alcançou a porta". Por isso ela fica na frente **J**, e não está declarada
pronta.

Isso é aplicação direta de §23: *não diga que está tudo pronto quando existem
recursos simulados ou bloqueados*.

---

## 4. ACHADO 3 — o motor não autentica nada nesta árvore

Medido: `grep -rn "validarChave\|autenticar" src/engine/server/index.js src/engine/server/transport.js`
devolve **vazio**. O subsistema de chaves de API que a `v2` introduziu (e com o
qual ela trancou o próprio motor — T1-3/T1-4) **não existe em `v3`**.

A fronteira do motor é, hoje, o **sistema de arquivos**:

| controle | onde |
|---|---|
| pasta do socket em `0o700` | `src/engine/server/transport.js:107` |
| socket em `0o600` | `transport.js:141` |
| recusa de caminho que não é socket | `transport.js:110` |
| recusa de motor já rodando | `transport.js:111` |
| banco em `~/.local/share/lcnwhatsapp/engine/` | `src/engine/paths.js:7-8` |

Isso é um controle real — só o dono do processo abre o socket — e é
**suficiente para um único operador**, que é o cenário de hoje. Não é suficiente
para multi-inquilino, e é por isso que o subsistema de chaves volta na frente
**J**, com duas correções sobre o desenho da `v2`:

1. **A autenticação só liga quando houver chave configurada.** A `v2` ligou sem
   condição e deixou o motor mudo: todo `POST` devolvia 401, nenhum evento era
   encaminhado, todo comando ficava `pending`.
2. **A primeira chave nasce no painel.** A `v2` exigia
   `contextoAuth?.ownerContactId` inclusive no `POST` que **cria** a chave — a
   primeira chave era impossível por construção. Pelo painel ela é possível, e
   respeita a regra do dono: escreve-se, não se lê.
3. **Quando ligada, vale para `GET` também.** A `v2` liberava `GET`/`HEAD`
   (`req.method !== 'GET' && req.method !== 'HEAD'`), deixando automações,
   variáveis, entidades e execuções abertas a quem alcançasse o socket.

**Nada disso foi implementado nesta onda.** Está registrado aqui e na parte **J**
do `FINAL_REPORT.md` como pendência com próximo passo concreto.

---

## 5. ACHADO 4 — pedido de pareamento sem limite de frequência — **CORRIGIDO em 01/11/2026**

Quando este achado foi escrito,
`grep -rni "throttle\|rateLimit\|ultimoPedido\|cooldown" src/agent/ src/connection.js`
devolvia **vazio**, e as três guardas de `pedirCodigo` não incluíam nenhuma de
frequência. **Agora são quatro**, e a terceira é a que faltava
(`src/agent/instanceService.js:583-620`):

| guarda | o que faz |
|---|---|
| número inválido | recusa, com exemplo de DDI |
| instância **conectada** | recusa — reiniciar em modo código perderia a sessão viva |
| **código pedido há menos que o intervalo** | **recusa, dizendo quantos segundos faltam** |
| instância apenas **rodando** (laço de QR) | para e reinicia em modo código |

A ordem é parte do conserto: a guarda nova entra **antes** do para/sobe, então
uma recusa por espera nunca derruba o processo que guarda a chave efêmera — que
é exatamente o dano descrito abaixo. O teste afirma isso (`feitos.length === 0`
na recusa).

### Por que é problema de **correção**, não de banimento

O argumento não é risco de bloqueio pela plataforma — esse é plausível e **não
está provado** (ver `PAIRING.md`). O argumento é que o segundo clique
**destrói o primeiro pareamento**:

- `requestPairingCode` **reatribui `this.pairingSession` sem condição**
  (`node_modules/zapo-js/dist/auth/pairing/WaPairingFlow.js:69`);
- `handlePrimaryHello` deriva a chave de decifração de
  `pairingSession.companionEphemeralKeyPair.privKey` (`:361`) e confere o `ref`
  em `:346` — na divergência, loga `primary_hello ref mismatch ignored` e
  **retorna**;
- `rotateAdvSecret(credentials)` roda em **todo** pedido (`:44`).

E no nosso caminho é pior: cada clique no painel **respawna o processo inteiro**
(`processoDaInstancia.iniciar()` com `spawn`, `detached: true`), então o que
mata o pareamento é derrubar o processo que guarda a chave efêmera no meio do
caminho.

**Limite honesto:** esse estado vive em `this.pairingSession`, campo de
instância, **não** em `authState.creds` como no Baileys —
`grep -rn "pairingCode" node_modules/zapo-js/dist/*/*.d.ts` é vazio. Então o
dano não sobrevive a reinício; ele **é** o reinício.

### O conserto, como foi feito

`esperaDePareamento` (`src/agent/instanceService.js`) conta sobre
`codigoPareamentoEm`, que `src/state.js` grava **só quando um código realmente
nasceu** — então tentativa que não gerou código (número torto, processo que nem
subiu) não tranca ninguém. A recusa nomeia o mecanismo e dá os segundos que
faltam, em vez de só "espere".

| decisão | valor |
|---|---|
| padrão | **180 s** — `PAIRING_CODE_MAX_AGE_SECONDS` da zapo-js, a validade real do código |
| configurável em | `hardware.pareamentoIntervaloSegundos`, por instância |
| `0` ou negativo | desliga a guarda, assumindo o efeito acima |
| 180 s cravados | **passa** — recusar no instante do vencimento trancaria por mais um ciclo sem proteger nada |
| relógio para trás | passa, para não trancar o pareamento para sempre |
| config ilegível | cai no padrão, em vez de trancar |

**Guarda contra regressão:** 13 checagens em
`tests/parear-por-codigo.test.mjs`, com a fronteira nos **dois** lados (10 s
recusa, 180 s passa, 181 s passa). Bateria inteira depois da entrega: **4564
verdes, zero vermelho, exit 0**.

**O que este conserto NÃO resolve:** o limite do servidor do WhatsApp (429
`rate-overlimit`) continua sem contagem, janela ou resfriamento documentados, e
banimento por pedido repetido segue **plausível e não provado**. O intervalo
reduz pedidos como efeito colateral; a razão dele é correção. E nada disto foi
validado em produção — o pedido proíbe deploy.

---

## 6. ACHADO 5 — SSRF em captura de site. Registrado no próprio template.

`/print http://127.0.0.1:3000` devolveria a foto de uma página que **só o
servidor enxerga**. O serviço de captura, visto de fora, não distingue endereço
público de endereço privado.

Está escrito no `avisa nota` do template `captura-de-site`: quem declarar a
conexão recusa endereço privado **antes** de abrir a página. O lugar certo do
filtro é o serviço, não o template — o template não tem como inspecionar o
endereço, e validação do lado de quem pede é exatamente o que §23 proíbe tratar
como controle.

Mesma classe vale para toda função nova de conexão que receba URL. É item
permanente da frente **J**.

---

## 7. O que a validação dupla já faz certo

Registrado como o padrão a repetir, não como pendência:

| caminho | na tela | no backend |
|---|---|---|
| número de pareamento | `src/web/public/pages/instance.js:95-99` — tira não-dígitos e recusa menos de 10, **sem teto** | `numeroParaParear(bruto)` (`src/agent/processoDaInstancia.js:54`) — tira não-dígitos e exige **10 a 15** dígitos |
| ação de automação não executável | catálogo do painel (`src/web/public/logic/acoes.js:97`) | **422** em `src/engine/server/automationsService.js:165-177`, conferindo `ACOES_SUPORTADAS` / `GATILHOS_SUPORTADOS` / `CONDICOES_SUPORTADAS` |
| endereço de conexão externa | formulário | `validarEndereco` (`src/engine/server/conexoes/declaracao.js:681`) — recusa conexão sem endereço, e **é por isso que 14 comandos esperam o dono** |

Nos três a tela é conveniência e o backend é o controle. É a forma correta.

E o primeiro caso mostra a direção certa da assimetria: a tela é **mais
frouxa** que o backend (não tem limite superior), então nada que a tela aceite
escapa da conferência de baixo. A direção oposta — tela mais estrita que o
backend — é a que produz a falsa sensação de controle.

---

## 8. Riscos aceitos, com a razão escrita

| risco | por que fica |
|---|---|
| painel sem autenticação | fronteira topológica declarada em comentário no código; trocar por hospedagem pública é etapa inteira (control plane/WSS), não ajuste |
| motor autenticado só pelo sistema de arquivos | suficiente para operador único; multi-inquilino depende da frente J |
| `antifake` usa `contém` para código de país | erra para o lado de **deixar passar**, nunca de acusar quem é legítimo; remoção vem desligada de fábrica |
| transcrição fala com `api.groq.com` e OpenAI direto (`src/transcription/`) | segundo caminho de saída, fora da aba Conexões. Está `provedor: 'off'` por padrão e é o dono quem liga — não é conexão clandestina, mas **contraria a regra de isolamento**. Não foi tocado: é decisão do dono |
| 68 automações ligadas | registrado; reverter é um comando, e a decisão é do dono |

---

## 9. Proibições do pedido, conferidas contra o que foi feito

| proibição (§23) | cumprimento |
|---|---|
| não executar ataque contra terceiro | nenhuma requisição saiu desta máquina para serviço de terceiro |
| não expor sessões ou credenciais nos relatórios | nenhum valor de credencial, token, sessão ou telefone neste documento nem nos outros sete |
| não tratar validação de frontend como controle | §7 nomeia o controle de backend de cada caminho; onde não existe, §3 e §4 dizem que não existe |
| não alterar infraestrutura de produção | nenhum deploy, nenhum banco de produção tocado, nenhuma migração escrita ou aplicada |
| não apagar sessões reais | nada apagado. `limparSessaoProblematica` (que eu havia relatado como destrutiva) **não apaga nada aqui** — a autenticação do zapo mora em SQLite, e a função só mexe em arquivos soltos, que não existem nessa pasta |
| não dizer que está pronto com recurso bloqueado | §3, §4 e §5 declaram bloqueado o que está bloqueado |

---

## 10. Estado nesta árvore

| item | estado |
|---|---|
| credencial no log | **corrigido**, com guarda em teste |
| autenticação do painel | **não existe** — risco em pé, declarado |
| autenticação do motor | sistema de arquivos (`0o700`/`0o600`); chaves de API são frente **J** |
| limite de frequência de pareamento | **corrigido** em 01/11/2026, com guarda de fronteira em teste (§5) |
| filtro SSRF | responsabilidade do serviço; aviso no template |
| anti-elevação da frente E | **frente J** — não provável sem identidade |

Nenhuma credencial foi lida, gravada ou alterada neste trabalho.
