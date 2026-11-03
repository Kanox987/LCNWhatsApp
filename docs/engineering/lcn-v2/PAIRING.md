# Conexão: QR e código de pareamento

Frente **F** do pedido. Escrito em 01/11/2026, na branch `v3`. Cada afirmação
aqui aponta arquivo e linha, e nada foi declarado validado em produção — o que
está medido localmente é dito como local.

## A primeira pergunta: o pareamento por número EXISTE na biblioteca?

O pedido proíbe expressamente fabricar uma implementação falsa, então isto foi
conferido antes de qualquer outra coisa.

**Existe.** `node_modules/zapo-js/dist/auth/WaAuthClient.d.ts:165`:

```ts
requestPairingCode(phoneNumber: string, shouldShowPushNotification?: boolean, customCode?: string): Promise<string>
```

E já é chamada: `src/connection.js:728`. Ou seja, a frente F **não é obra nova
nesta leva** — ela já estava entregue na `onda1`, com teste
(`tests/parear-por-codigo.test.mjs`). O que esta leva fez foi (a) conferir, (b)
documentar, e (c) fechar a exigência "código nunca em log", que estava aberta.

## Como o modo é escolhido

`querPareamentoPorCodigo(argv, env)` — `src/connection.js:59-62`. Devolve
verdadeiro quando:

| gatilho | de onde vem |
|---|---|
| `--code` ou `--code=<numero>` | argumento de linha de comando |
| `LCN_PAIR_NUMBER` com **8 dígitos ou mais** | ambiente |

`numeroDoArgumento()` tira tudo que não é dígito e exige ≥8. Sem nenhum dos
dois, o caminho é QR.

**O prompt de teclado só existe atrás de `process.stdin.isTTY`**
(`numeroParaParear()`). O comentário no código registra a razão: *"Num processo
destacado isso travaria para sempre — e travar em silêncio é pior que
recusar."* Num container ou sob systemd não há TTY, então o número tem de
chegar pelo ambiente — que é exatamente o que o painel faz.

## O caminho pelo painel, que é o que importa

Quem usa só o painel não tem terminal. O caminho inteiro, ponta a ponta:

1. **Tela.** `src/web/public/pages/instance.js:95-99` manda
   `api.instances.action(instanceId, 'start', { pairNumber: numero })`.
2. **Rota.** `src/web/router.js:80` — `POST /api/v1/instances/:id/start`, com
   `pairNumber` no corpo.
3. **Serviço.** `pedirCodigo` (`src/agent/instanceService.js:583`), que é onde
   moram a autorização e o estado — ver a seção seguinte.
4. **Processo.** `src/agent/processoDaInstancia.js` valida o número de novo
   (10 a 15 dígitos) e sobe `node index.js --code` com
   `LCN_PAIR_NUMBER=<numero>` no ambiente do filho.
5. **Gateway.** `conectar()` pede o código à biblioteca e **grava no estado**.
6. **Volta à tela.** `src/agent/instanceService.js:748-749` expõe `pairingCode`
   e `pairingCodeAt`; `instance.js:137-141` mostra o código, um botão
   "Copiar código" e o horário em que foi gerado.

O número de uma instância descoberta (`instancia.nomeSimples`) não tem unidade
de serviço, então o ciclo de vida dela passa pelo arquivo de pid, não pelo
systemd. É o mesmo caminho, outro executor.

## As quatro guardas de `pedirCodigo`, na ordem

`src/agent/instanceService.js:583-620`. A ordem é parte do desenho:

| situação | o que acontece | por quê |
|---|---|---|
| número inválido | recusa: *"Número inválido para pareamento: use só dígitos, com DDI (ex.: 5522999999999)."* | validação no backend, não só na tela |
| instância **conectada** | **recusa** | reiniciar em modo código perderia uma sessão viva — e o comentário no código diz a razão: *"por causa de um clique que a pessoa deu achando que ia conectar outra coisa"* |
| código pedido há menos que o intervalo | **recusa**, dizendo quantos segundos faltam | pedir outro código INVALIDA o que está na tela: a biblioteca troca a chave efêmera e descarta a tentativa anterior. Detalhado na seção do limite de frequência, abaixo |
| instância **rodando** em laço de QR | para e sobe de novo em modo código | *"Um bot esperando conexão fica em laço de QR para sempre — foi o que aconteceu aqui: quinze horas, mil e quinhentos QR. Nesse estado, 'pedir código' só pode significar uma coisa: trocar aquela tentativa por esta."* |

A validação de formato acontece **duas vezes** e nos dois lados: no serviço e
no `processoDaInstancia`. Validação na tela não conta como controle — é só
cortesia para quem digita.

## Renovação, e o que se aprendeu errado antes

Dentro de `conectar()` (`src/connection.js:~720-760`), depois de `await
conexao`, se o modo é código e o cliente não está registrado:

- `solicitarCodigo()` — idempotente por uma trava de promessa (`pedidoCodigo`),
  limpa no `.finally`.
- `renovarCodigo()` — não faz nada depois de registrado.
- `encerrarRenovacao()` — remove os ouvintes de `auth_pairing_required`,
  `auth_paired` e `connection`.
- `aoMudarConexao({ status })` — encerra a renovação em `status === 'close'`.

Ouvintes: `client.on('auth_pairing_required', renovarCodigo)`,
`client.on('connection', aoMudarConexao)`,
`client.once('auth_paired', encerrarRenovacao)`.

**Uma hipótese anterior está registrada no código como errada**, e fica aqui
para ninguém reconstruí-la: *"A hipótese anterior de que `connect()` aguardava
o pareamento estava errada: no Zapo 1.8.2 ele resolve quando o transporte sobe,
mesmo sem `meJid`. `auth_pairing_required` nasce só de `refresh_code` e serve
para renovar o código."*

Consequência prática: a frequência com que o código é renovado **é da
biblioteca**, não nossa. Nós reagimos ao evento dela.

## Código nunca em log — o que estava errado e o conserto

O pedido lista, na frente F, *"código nunca em log"*. Estava **aberto**, e era
exposição de verdade:

- `src/connection.js` escrevia o código formatado no log, e desenhava o QR em
  ASCII no log.
- `src/espelhoLog.js` espelha o stdout em `data/bot.log`, com `appendFileSync`
  e rotação — **arquivo que fica no disco**.
- `logsServico()` (`src/runtime.js:251`) lê esse arquivo e **o painel serve**:
  `src/agent/instanceService.js:30,385,1047` e `src/dashboard.js:506`.
- **O painel não tem autenticação.**

QR e código de pareamento são **credencial**: enquanto valem, quem os lê entra
na conta. O código dura minutos; o log dura semanas.

### O conserto preserva a capacidade em vez de apagá-la

Apagar a linha do log seria tirar uma capacidade: quem só tem `docker logs -f`,
sem painel alcançável, conectava por ali. Padrão não é teto.

Entrou `hardware.credencialNoLog` em `PADRAO.hardware` (`src/config.js`),
**padrão `false`**, e os dois — o desenho do QR e os dígitos do código — ficam
atrás do mesmo knob.

Com o knob desligado (o padrão) **o log continua dizendo que a credencial
saiu**, sem revelá-la:

- `QR gerado — escaneie pelo painel (lcn > Serviço > Conectar).`
- `Código de pareamento gerado — pegue pelo painel (lcn > Serviço > Conectar).`

Isso é deliberado: quem acompanha o log precisa distinguir *"pediram e
chegou"* de *"travou antes de pedir"*.

O caminho de entrega continua existindo e é o certo: `src/state.js:163-173`
grava `codigoPareamento` / `codigoPareamentoEm` em `state.json` (modo 0600) —
e o comentário diz que é *"pro agente conseguir expor via API sem precisar
acompanhar logs"*. `limparCodigoPareamento()` zera os dois.

### Guardas

7 checagens novas em `tests/parear-por-codigo.test.mjs`: o padrão vem
desligado; é campo de config e não restrição no código; o desenho do QR está
**estruturalmente** dentro do `if` do knob (o teste corta a fonte entre
`client.on('auth_qr'` e `qrcode.generate(` e exige que o `if` seja a última
coisa do pedaço, sem nada fechando o bloco no meio — a primeira versão testava
indentação, que não prova nada e sobreviveria a uma reformatação); os dígitos
também; os dois saem do mesmo knob; e o modo seguro ainda anuncia os dois.

## Estados acompanhados

| estado | onde aparece |
|---|---|
| código gerado, com horário | `pairingCode` / `pairingCodeAt`, tela da instância |
| QR gerado | `state.definirQR(qr)`, tela da instância |
| número inválido | recusa de `pedirCodigo`, com a mensagem de exemplo |
| já conectado | recusa de `pedirCodigo` |
| rodando em laço de QR | troca de método, com aviso |
| renovado | `auth_pairing_required` → novo código no estado |
| pareado | `auth_paired` encerra a renovação |
| conexão caiu | `connection` com `status === 'close'` encerra a renovação |

### `src/connectionStateMachine.js` NÃO existe nesta branch

Conferido por `grep`: o arquivo existe só em `origin/master`, no commit
`5d63170`, onde carrega o defeito T1-1 (o estado `CONNECTING` é inalcançável e
o ETag congela). **Nesta branch `PAIRING_CODE_READY` não é um estado**, e a
observação do plano de que "a frente F encosta no T1-1" **não se aplica a
`v3`**.

## O limite de frequência no pareamento — entregue

Era pendência declarada desta frente até 01/11/2026. **O argumento que a
fechou não é risco de ban — é CORREÇÃO**, e a prova está abaixo, medida na
biblioteca. Antes da entrega, `grep` por `throttle`, `rateLimit` e `cooldown`
em `src/agent/` e `src/connection.js` não achava nada: nada impedia clicar em
"pedir código" em sequência, e cada clique parava e subia o processo de novo.

**O que foi medido na própria biblioteca** (`zapo-js`, não copiado de
relatório de IA):

| constante | valor | onde |
|---|---|---|
| `PAIRING_CODE_MAX_AGE_SECONDS` | **180** (3 min) | `node_modules/zapo-js/dist/protocol/defaults.js:49` |
| `PAIRING_CODE_MAX_PRIMARY_HELLOS` | **3** | `defaults.js:50` |
| `QR_INITIAL_TTL_MS` | 60 000 (1 min) | `defaults.js:51` |
| `QR_ROTATION_TTL_MS` | 20 000 (20 s) | `defaults.js:52` |

Então o código de pareamento vale **três minutos** — nove vezes a rotação do
QR. Isso dá número ao conserto do credencial-em-log descrito acima: a
credencial valia 3 minutos, e o log a guardava por semanas.

**O mecanismo que torna o segundo clique destrutivo**, lido em
`node_modules/zapo-js/dist/auth/pairing/WaPairingFlow.js`:

- `requestPairingCode` (linha 69) **reatribui `this.pairingSession` sem
  condição nenhuma** — sem guarda, sem conferir `finished`, sem intervalo
  mínimo. O que é substituído inclui `companionEphemeralKeyPair` e `ref`.
- `handlePrimaryHello` (linha 361) deriva a chave de decifração justamente
  de `pairingSession.companionEphemeralKeyPair.privKey`, e confere o `ref`
  na linha 346. Com a sessão trocada, o `ref` que o celular devolve **não
  casa mais** e a tentativa é descartada (`primary_hello ref mismatch
  ignored`).
- `requestPairingCode` chama `this.rotateAdvSecret(credentials)` (linha 44)
  a **cada** pedido.

Consequência prática: **pedir um código novo invalida em silêncio o código
que a pessoa ainda está digitando.** Não é hipótese de banimento — é a
própria biblioteca recusando o `primary_hello` da tentativa anterior.

**O limite honesto desta prova.** Em `zapo-js` o estado do pareamento vive
em `this.pairingSession`, um campo de instância; `grep -rn "pairingCode"
node_modules/zapo-js/dist/*/*.d.ts` não acha nada, logo **não** fica em
`authState.creds` como no Baileys. E no nosso caminho do painel cada clique
**derruba e sobe o processo inteiro**, então a sobrescrita dentro do processo
não é o que nos atinge: o que nos atinge é matar o processo que guarda a
chave efêmera no meio do pareamento, com o mesmo efeito final — o código
exibido deixa de poder ser concluído.

**O que a pesquisa externa acrescenta, e o que nela segue não comprovado.**
O servidor do WhatsApp tem limite próprio: `<iq type="error"><error
code="429" text="rate-overlimit"/></iq>`, relatado de forma independente em
Baileys #2008 e em whatsapp-web.js #3763 (`CompanionHelloError` /
`IQErrorRateOverlimit`). **Não documentado em lugar nenhum:** quantos
pedidos, em que janela, se conta por número / IP / sessão, quanto dura o
resfriamento, e se QR e código dividem o mesmo limite. Banimento por pedido
repetido é plausível e **não** está provado — limite de taxa, falha de
autenticação e banimento são três eventos diferentes, e um 429 ou 401
isolado não demonstra nenhum deles.

**Entregue em 01/11/2026, exatamente nesses termos.** `esperaDePareamento`
(`src/agent/instanceService.js`) é a terceira guarda de `pedirCodigo`: entra
**depois** do número inválido e da instância conectada, e **antes** do
para/sobe — então uma recusa nunca derruba o processo que guarda a chave
efêmera, e o teste afirma isso (`feitos.length === 0`).

| decisão | valor | por quê |
|---|---|---|
| de onde vem o tempo | `codigoPareamentoEm`, que `src/state.js` grava **só quando um código realmente nasceu** | tentativa que não gerou código (número torto, processo que nem subiu) não tranca ninguém |
| padrão | **180 s** = `PAIRING_CODE_MAX_AGE_SECONDS` da biblioteca | é literalmente o tempo que o código vale |
| onde se configura | `hardware.pareamentoIntervaloSegundos`, no `config.json` da instância | padrão sensato sim, teto no código não |
| `0` ou negativo | **desliga a guarda** | quem quiser assumir o efeito acima, assume |
| 180 s cravados | **passa** | o código acabou de deixar de valer; recusar no instante do vencimento trancaria por mais um ciclo sem proteger nada |
| relógio para trás | passa | ajuste de hora ou estado copiado de outra máquina não pode trancar para sempre |
| config ilegível | cai no padrão | não tranca ninguém por causa de um JSON torto |

A recusa diz o mecanismo e os segundos que faltam, não só "espere": *"Um
código de pareamento foi pedido há pouco e ainda pode estar valendo. Pedir
outro agora INVALIDA o que está na tela — a biblioteca troca a chave efêmera
e descarta a tentativa anterior. Espere 170s."*

**13 checagens** novas em `tests/parear-por-codigo.test.mjs`, incluindo a
fronteira nos **dois** lados (10 s recusa, 180 s passa, 181 s passa) — é o que
impede a guarda de ficar verde por acaso. Bateria inteira medida depois da
entrega: **4564 verdes, zero vermelho, exit 0** (baseline `onda1` 4394).

## Pendências desta frente, declaradas

1. **Autorização é por processo, não por papel.** `pedirCodigo` autoriza pelo
   estado da instância (inválido / conectado / rodando), não por quem pediu,
   porque **o painel não tem autenticação nem papéis**. Enquanto isso for
   verdade, qualquer um que alcance o painel pode pedir um código. Isso está
   registrado no `SECURITY_REVIEW.md` como risco residual, e é o que mantém a
   metade anti-elevação da frente E dentro da frente **J**.
2. **Nada disto foi validado em produção.** A bateria roda local
   (`tests/parear-por-codigo.test.mjs`, verde) e o pedido proíbe deploy.
   Validar o pareamento de ponta a ponta exige um número real e uma decisão de
   implantação que é do dono.

## A cópia da frente A

A frente A (a única que a `v2` entregou) promete o código de pareamento na
tela, em `src/web/public/dashboard.js`. **A promessa é verdadeira** — o
recurso existe e o caminho está descrito acima —, então não há cópia a
corrigir. A instrução do pedido ("se não existir, documentar a limitação e
corrigir a cópia da frente A") não se aplica, porque existe.
