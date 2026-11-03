# Limites e concessões por instância

Gerado por `npm run docs:limites` a partir de `src/agent/concessoes.js`.
Não editar à mão: `tests/docs-limites.test.mjs` falha se este arquivo
divergir da tabela do código.

## A hierarquia

Quatro camadas, da mais forte para a mais fraca, e a verdade fica sempre
no backend — nunca só na tela:

| # | camada | onde mora | quem escreve |
|---|---|---|---|
| 1 | padrão do código | `src/config.js` (`PADRAO`) | ninguém em runtime |
| 2 | concessão do administrador | `registry.json`, mapa `grants` no TOPO | administração |
| 3 | preferência do cliente | `config.json` DENTRO da pasta da instância | o cliente |
| 4 | limite efetivo | calculado a cada leitura | o runtime obedece |

**Por que a concessão mora no registro, e não na instância.**
`registry.json` fica FORA da pasta da instância; `config.json` fica DENTRO.
Quem controla a instância reescreve o próprio `config.json`. Guardar o teto
no mesmo arquivo que o valor seria guardar a chave dentro do cofre.
O mapa fica no topo do registro, e não em `instances[id]`, por dois motivos:
a instância do modo simples (`bare`) não tem entrada no registro e também
precisa de teto; e `validar()` descarta chave que não conhece, então uma
concessão escondida dentro da instância se perderia na primeira gravação.

**Herança.** Não há herança entre instâncias: cada uma lê só a própria
entrada de `grants`. Sem concessão, a preferência do cliente vale inteira
(padrão sensato sim, teto no código não).

**Atualização.** A concessão é lida do registro a cada resolução, então
mudança administrativa passa a valer na leitura seguinte, sem reiniciar.

**Validação na gravação E na leitura.** Gravação validada protege de quem
usa a tela. Validar na leitura protege também de quem editou o JSON à mão,
importou configuração, trocou o arquivo ou chamou a rota direto. Defesa em
profundidade: as duas, não uma. A recusa na gravação devolve
`LCN_ACIMA_DA_CONCESSAO` com o campo e o permitido — gravar um número e
devolver outro calado é o que faz a pessoa achar que a tela está quebrada.

**Ao reduzir uma quota**, o `config.json` do cliente NÃO é reescrito: o
valor configurado fica guardado e o efetivo é cortado na leitura. Assim,
quando a administração devolve a quota, o cliente recupera a escolha dele
sem reconfigurar nada. Em troca, a tela TEM de mostrar os dois números — é
o que `explicar()` serve, e o que a seção "O que a tela mostra" exige.

## Não é `Math.min()` em tudo

O pedido proíbe expressamente resolver todos os campos com `Math.min()`.
São quatro regras distintas, e em dois casos `Math.min` dá a resposta errada:

| regra | por que `Math.min` não serve |
|---|---|
| `teto onde zero é ilimitado` | **perigoso**: 0 quer dizer "sem limite", então `Math.min(0, teto)` = 0 e o cliente ELEVA o limite a infinito pedindo zero |
| `teto com piso` | há mínimo obrigatório; zero trancaria a fila inteira |
| `lista` | valor não numérico: não existe "menor que" |
| `travável` | booleano: ou a administração fixa, ou a preferência vale |

## Os parâmetros

### `hardware.bandwidthLimit.downloadBytesPerSecond`

**Banda de download** — Quanto a instância pode baixar por segundo. 0 = sem limite.

| | |
|---|---|
| tipo | inteiro, bytes por segundo |
| padrão | `0` (de `src/config.js`) |
| intervalo válido | inteiro ≥ 0; 0 significa SEM LIMITE |
| regra de resolução | `teto onde zero é ilimitado` |
| fonte do limite | a administração desta instalação |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Recusa valor acima do teto. **Zero não passa por comparação de grandeza**: como zero quer dizer "sem limite", `Math.min(0, teto)` devolveria 0 e ELEVARIA o limite a infinito passando por uma checagem que parece correta. Pedir zero contra um teto concedido é tratado como tentativa de elevação e vira o teto. |
| enforcement no runtime | src/bandwidth.js, pelo valor efetivo que obterOtimizacao devolve |
| ao reduzir a quota | O valor configurado é preservado; o efetivo é cortado na leitura. Se o cliente tinha 0 (sem limite), passa a valer o teto concedido. |
| efeito prático | Download mais lento, memória e rede mais previsíveis. |

### `hardware.bandwidthLimit.uploadBytesPerSecond`

**Banda de upload** — Quanto a instância pode enviar por segundo. 0 = sem limite.

| | |
|---|---|
| tipo | inteiro, bytes por segundo |
| padrão | `0` (de `src/config.js`) |
| intervalo válido | inteiro ≥ 0; 0 significa SEM LIMITE |
| regra de resolução | `teto onde zero é ilimitado` |
| fonte do limite | a administração desta instalação |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Recusa valor acima do teto. **Zero não passa por comparação de grandeza**: como zero quer dizer "sem limite", `Math.min(0, teto)` devolveria 0 e ELEVARIA o limite a infinito passando por uma checagem que parece correta. Pedir zero contra um teto concedido é tratado como tentativa de elevação e vira o teto. |
| enforcement no runtime | src/bandwidth.js, pelo valor efetivo que obterOtimizacao devolve |
| ao reduzir a quota | O valor configurado é preservado; o efetivo é cortado na leitura. Se o cliente tinha 0 (sem limite), passa a valer o teto concedido. |
| efeito prático | Envio mais lento, socket menos sujeito a engasgo. |

### `hardware.comandosSimultaneos`

**Comandos ao mesmo tempo** — Quantos comandos a instância executa em paralelo.

| | |
|---|---|
| tipo | inteiro |
| padrão | `2` (de `src/config.js`) |
| intervalo válido | inteiro entre 1 e o teto concedido (sem concessão, sem teto) |
| regra de resolução | `teto com piso` |
| fonte do limite | a administração desta instalação |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Recusa valor acima do teto concedido. O mínimo obrigatório vence tanto a preferência do cliente quanto a concessão: conceder abaixo do mínimo é recusado na origem, porque a instância não conseguiria obedecer. |
| enforcement no runtime | src/engine/filasDeRecursos.js (fila socket) |
| ao reduzir a quota | O valor configurado é preservado; o efetivo é cortado na leitura, nunca abaixo do mínimo obrigatório. |
| efeito prático | Mais alto responde mais rápido em rajada e aperta o socket. |

### `hardware.maxMidiaMB`

**Tamanho máximo de mídia** — Maior arquivo que a instância aceita processar.

| | |
|---|---|
| tipo | inteiro, MB |
| padrão | `60` (de `src/config.js`) |
| intervalo válido | inteiro entre 1 e o teto concedido (sem concessão, sem teto) |
| regra de resolução | `teto com piso` |
| fonte do limite | o WhatsApp/provedor impõe um máximo próprio; a concessão só pode ser mais apertada |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Recusa valor acima do teto concedido. O mínimo obrigatório vence tanto a preferência do cliente quanto a concessão: conceder abaixo do mínimo é recusado na origem, porque a instância não conseguiria obedecer. |
| enforcement no runtime | src/mediaLimits.js (limitesDeMidia), pelo teto que chega no ambiente LCN_CONCESSOES |
| ao reduzir a quota | O valor configurado é preservado; o efetivo é cortado na leitura, nunca abaixo do mínimo obrigatório. |
| efeito prático | Acima disso a mídia é recusada antes de ocupar memória. |

### `hardware.cacheSqliteMB`

**Cache do banco** — Páginas de banco que cada conexão mantém em memória.

| | |
|---|---|
| tipo | inteiro, MB |
| padrão | `4` (de `src/config.js`) |
| intervalo válido | inteiro entre 1 e o teto concedido (sem concessão, sem teto) |
| regra de resolução | `teto com piso` |
| fonte do limite | a administração desta instalação |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Recusa valor acima do teto concedido. O mínimo obrigatório vence tanto a preferência do cliente quanto a concessão: conceder abaixo do mínimo é recusado na origem, porque a instância não conseguiria obedecer. |
| enforcement no runtime | src/engine/server/db.js (abrirBanco), pelo teto que chega no ambiente LCN_CONCESSOES |
| ao reduzir a quota | O valor configurado é preservado; o efetivo é cortado na leitura, nunca abaixo do mínimo obrigatório. |
| efeito prático | Mais alto consulta mais rápido e custa RAM por processo. |

### `hardware.modoEconomia`

**Modo economia** — Reduz trabalho de fundo e verbosidade.

| | |
|---|---|
| tipo | booleano |
| padrão | `true` (de `src/config.js`) |
| intervalo válido | `true` ou `false` |
| regra de resolução | `travável` |
| fonte do limite | a administração desta instalação |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Não há "menor que" em booleano. Enquanto o administrador não fixa, a preferência do cliente vale inteira; fixado, a preferência é ignorada. |
| enforcement no runtime | lido de config.json por quem consome modoEconomia |
| ao reduzir a quota | Fixar passa a valer na leitura seguinte. A preferência do cliente fica guardada e volta a valer quando o administrador soltar. |
| efeito prático | Travado pelo administrador, o cliente não desliga. |

### `hardware.aparelho.navegador`

**Aparelho anunciado** — Como a instância se apresenta ao WhatsApp.

| | |
|---|---|
| tipo | opção |
| padrão | `"chrome"` (de `src/config.js`) |
| intervalo válido | `chrome`, `firefox`, `safari`, `edge`, `opera`, `ie`, `desktop`, `ipad`, `android tablet` |
| regra de resolução | `lista` |
| fonte do limite | a administração desta instalação |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Campo não numérico: não existe "menor que". O valor está na lista concedida ou é recusado. Conceder opção que não existe na lista fechada do código é recusado. |
| enforcement no runtime | src/aparelho.js:resolverAparelho, que recusa valor fora da lista fechada |
| ao reduzir a quota | Se a opção em uso sai da lista concedida, o efetivo passa a ser a primeira opção concedida, e a tela diz qual valor foi pedido e quais estão disponíveis. |
| efeito prático | Aparece na lista de aparelhos conectados do celular. |

### `confiabilidade.falhasConsecutivasParaQuarentena`

**Falhas até a quarentena** — Quantas falhas seguidas antes de a instância ser posta de lado.

| | |
|---|---|
| tipo | inteiro |
| padrão | `15` (de `src/config.js`) |
| intervalo válido | inteiro entre 1 e o teto concedido (sem concessão, sem teto) |
| regra de resolução | `teto com piso` |
| fonte do limite | a administração desta instalação |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Recusa valor acima do teto concedido. O mínimo obrigatório vence tanto a preferência do cliente quanto a concessão: conceder abaixo do mínimo é recusado na origem, porque a instância não conseguiria obedecer. |
| enforcement no runtime | src/state.js, pelo valor efetivo que obterOtimizacao devolve |
| ao reduzir a quota | O valor configurado é preservado; o efetivo é cortado na leitura, nunca abaixo do mínimo obrigatório. |
| efeito prático | Mais alto insiste mais antes de desistir. |

### `download.limiteMB`

**Limite de download** — Maior arquivo que o serviço de download entrega.

| | |
|---|---|
| tipo | inteiro, MB |
| padrão | `64` (de `src/config.js`) |
| intervalo válido | inteiro entre 1 e o teto concedido (sem concessão, sem teto) |
| regra de resolução | `teto com piso` |
| fonte do limite | o WhatsApp/provedor impõe um máximo próprio; a concessão só pode ser mais apertada |
| quem altera a concessão | administração, por `PUT /api/v1/instances/:id/grants` |
| quem altera o valor | o cliente, por `PUT /api/v1/instances/:id/optimization` |
| herança | nenhuma; só a entrada de `grants` desta instância |
| validação no backend | Recusa valor acima do teto concedido. O mínimo obrigatório vence tanto a preferência do cliente quanto a concessão: conceder abaixo do mínimo é recusado na origem, porque a instância não conseguiria obedecer. |
| enforcement no runtime | src/mediaLimits.js (limitesDeMidia), cortado também pelo teto geral de mídia |
| ao reduzir a quota | O valor configurado é preservado; o efetivo é cortado na leitura, nunca abaixo do mínimo obrigatório. |
| efeito prático | Acima disso o download é recusado na origem. |

## Um limite por instância que NÃO é concessão

### `hardware.pareamentoIntervaloSegundos`

**Intervalo entre pedidos de código** — Quanto tempo esperar antes de
pedir outro código de pareamento para a mesma instância.

**Este parâmetro é diferente dos de cima, e a diferença importa: ele NÃO
tem concessão.** Não há entrada em `src/agent/concessoes.js`, não passa por
`valorEfetivo`, não viaja em `LCN_CONCESSOES` e não tem teto do
administrador. `pedirCodigo` lê direto o `config.json` da instância. Está
documentado aqui porque é um limite por instância que a frente **E** manda
declarar — não porque entre na hierarquia acima.

| | |
|---|---|
| tipo | inteiro, segundos |
| padrão | `180` (de `src/config.js`) — é o `PAIRING_CODE_MAX_AGE_SECONDS` da zapo-js, a validade real do código |
| intervalo válido | qualquer inteiro; `0` ou negativo **desliga** a guarda |
| regra de resolução | nenhuma — valor único, sem teto e sem piso |
| fonte do limite | a própria instância |
| quem altera a concessão | **ninguém; não existe concessão para este campo** |
| quem altera o valor | quem edita o `config.json` da instância |
| herança | nenhuma |
| validação no backend | Valor não finito cai no padrão; `0` ou negativo desliga; `config.json` ilegível cai no padrão, em vez de trancar o pareamento. |
| enforcement no runtime | `esperaDePareamento`, terceira guarda de `pedirCodigo` (`src/agent/instanceService.js`) |
| ao reduzir o valor | Vale no pedido seguinte; não há estado a migrar — a conta é sobre `codigoPareamentoEm`, que já existe no estado. |
| efeito prático | Impede que um segundo clique **invalide** o código que a pessoa ainda está digitando: a biblioteca troca a chave efêmera e descarta a tentativa anterior. Detalhado em `PAIRING.md` e `SECURITY_REVIEW.md` §5. |

**Ainda não tem tela.** O campo não aparece em
`src/web/public/logic/optimization.js`, então hoje só se altera editando o
`config.json`. Isso contraria a regra de interface do projeto (todo ajuste
montável pelo painel) e fica registrado como pendência, não como entrega.

## O que a tela mostra

`explicar()` devolve, por parâmetro, tudo o que o pedido exige da interface:
o valor configurado, o limite permitido, o que está em vigor, de onde vem o
limite, o significado, o efeito, a razão de um valor estar indisponível, e
se o limite é do provedor em vez de nosso. `obterOtimizacao` entrega isso
no campo `limites`.

## O que falta, dito de forma honesta

**1. O teto chega ao runtime pelo AMBIENTE, e isso tem uma consequência.**
Os nove campos são obedecidos na leitura pelo consumidor real — não falta
nenhum. Mas o caminho tem um custo que precisa estar dito: `registry.json`
NÃO é montado no container (`src/instances/quadlet.js`), de propósito, para
a instância não poder ler nem reescrever o próprio teto. Então a concessão
viaja em `LCN_CONCESSOES`, escrito pelo lado do administrador na unit do
quadlet (e no ambiente do processo, no modo bare).

Consequência honesta: **mudar a concessão de uma instância gerenciada em pé
não vale até ela reiniciar.** `PUT /api/v1/instances/:id/grants` grava no
registro, reescreve a unit e devolve `precisaReiniciar`. Ele NÃO reinicia
sozinho: derrubar o serviço de um cliente sem ninguém pedir seria pior que
o atraso. Na tela isso tem de aparecer, senão o administrador reduz uma
cota, vê o número novo no painel e acha que já está valendo.

**2. A metade de segurança da frente E depende de autenticação, que não existe.**
O pedido exige que o cliente não consiga elevar o próprio limite por
requisição HTTP direta nem por endpoint administrativo sem autorização. Hoje
o painel não tem autenticação nem papéis: `src/web/server.js:15` só aceita
`127.0.0.1`/`localhost`/`::1`, e a linha 53 registra a regra fixa de NUNCA
expor em `0.0.0.0` sem autenticação — as linhas 56-57 lançam se tentarem.
Então **quem alcança a porta JÁ é o administrador**, e as duas rotas de
concessão são a camada de concessão, não um controle de acesso.

O que está entregue dentro dessa realidade: o limite resiste a config
editado à mão, a configuração importada, a arquivo trocado e a gravação pela
rota — porque a leitura também valida. O que NÃO está, e não é implementável
como especificado sem uma camada de identidade: distinguir "o cliente" de "o
administrador" na mesma porta. Isso é da frente **J**, e é pré-requisito real
para alugar o sistema a terceiros.

