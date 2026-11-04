# Decisões — cada uma com a alternativa recusada e o motivo

O pedido manda registrar decisão com a alternativa que foi descartada. Isso é o
que separa decisão de omissão: quem ler em seis meses tem de poder reabrir a
escolha, não adivinhar se ela foi feita.

---

## D-1. A `v2` não entra por merge

**Decidido:** branch `v3` a partir de `onda1`. A `v2` fica como leitura em
`/home/kanox/auditoria-v2`; dela se reaproveita **ideia**, nunca commit.

**Alternativa recusada:** merge ou cherry-pick da `v2`.

**Por quê, em três fatos medidos:** ela não passa na própria bateria (6 falhas);
o motor dela fica **mudo** (autenticação sem condição + cliente sem header, 401
em tudo que não é GET), então nem roda para ser testada; e as migrações colidem
em **três** vias no mesmo número 011 — `version` é `INTEGER PRIMARY KEY` com
`if (aplicada.get(version)) return`, então a junção **perde arquivos em
silêncio**.

## D-2. A branch principal se conserta por commit novo

**Decidido:** *revert* publicado (`803850a`). Sem force push, sem reescrever
histórico.

**Alternativa recusada:** `git reset` + force push para apagar o push direto.

**Por quê:** force push é proibição literal do pedido, e reescrever a principal
quebraria qualquer clone existente. O histórico fica como registro; o conteúdo
volta ao que funcionava. **As duas decisões foram autorizadas pelo dono por
escrito** antes de executar.

## D-3. Reduzir uma concessão não reescreve a escolha do cliente

**Decidido:** `configurado` e `emVigor` divergem de propósito. O `config.json`
do cliente fica intacto; o efetivo é calculado.

**Alternativa recusada:** gravar o teto novo em cima da preferência do cliente.

**Por quê:** se o teto voltar a subir, a escolha dele volta a valer sozinha.
Sobrescrever perderia a informação para sempre, e a tela passaria a mostrar como
"escolha dele" um número que o administrador impôs. É a regra do dono: **padrão
sensato sim, teto no código não** — e um teto que apaga a preferência é pior que
um teto.

## D-4. A concessão mora no registro, não na pasta da instância

**Decidido:** `src/agent/concessoes.js`, fora da pasta da instância.

**Alternativa recusada:** um campo no `config.json` de cada instância.

**Por quê:** a instância **não pode editar o próprio teto**. Se o arquivo
morasse com ela, editar o teto seria editar um arquivo que ela já escreve.

## D-5. O limite efetivo não é `Math.min()` em tudo

**Decidido:** por parâmetro, com regra própria.

**Alternativa recusada:** uma função genérica de mínimo.

**Por quê:** há campo com **mínimo obrigatório** (reduzir abaixo dele quebra o
runtime), há campo **não numérico** (lista de opções liberadas, onde "permitido"
é a lista), e **zero em banda significa sem limite** — um mínimo cego inverteria
o sentido. É o que `formatarValorDeLimite` trata antes de qualquer unidade.

## D-6. A tela explica, não substitui a edição

**Decidido:** as quatro caixas editáveis ficam; o painel novo mostra os quatro
números ao lado.

**Alternativa recusada:** trocar as caixas por valores só de leitura quando
houver teto.

**Por quê:** a escolha do cliente continua valendo se o teto subir (D-3), então
ele precisa poder escolher mesmo abaixo do teto atual. Travar o campo apagaria a
capacidade inteira para resolver um problema de exibição.

## D-7. Sem teto do administrador, a tela diz isso — não um número

**Decidido:** quando não há concessão, o campo diz *"sem teto do
administrador"*; campo em branco diz *"não escolhido"*, nunca *"sem limite"*.

**Alternativa recusada:** preencher com o valor configurado, ou com zero.

**Por quê:** repetir o configurado **afirmaria um teto que ninguém pôs**, e zero
em banda **significa sem limite** — mostrar branco como zero inverteria a
informação. A tela mentir é o defeito que a frente E existe para consertar; não
se conserta introduzindo outra mentira.

## D-8. O código de pareamento sai do log atrás de uma chave, com padrão `false`

**Decidido:** `hardware.credencialNoLog`, padrão `false`. O caminho de entrega
(`state.json`, modo 0600, lido pelo painel) **não muda**.

**Alternativa recusada:** apagar o log do código sem chave nenhuma.

**Por quê:** o defeito era a **cópia** no log — válido 180 s, legível por
semanas no arquivo que o painel serve. O caminho de entrega nunca foi o defeito.
E a chave existe porque **restrição fixa no código tira a capacidade inteira**:
quem depura pareamento precisa do código no log. Padrão seguro, capacidade
preservada.

## D-9. A tela mais frouxa que o backend fica como está

**Decidido:** a tela recusa menos de 10 dígitos e não tem teto; o backend exige
**10 a 15**.

**Alternativa recusada:** igualar a tela ao backend.

**Por quê:** é a direção **segura** da assimetria. A tela filtra erro de
digitação; a decisão é do backend, como manda o §23 — *validação na tela não
conta como controle*. Se a tela fosse mais **restritiva**, ela recusaria número
que o sistema aceita, e aí a tela estaria decidindo.

## D-10. O agendamento não entra até o dono decidir o contexto sintético

**Decidido:** frente G **parada**, documentada em `SCHEDULER.md`.

**Alternativa recusada:** escrever o worker agora, decidindo o contexto no meio.

**Por quê:** a objeção do Gemini sobreviveu à rodada cruzada — *um worker
temporal acorda sem remetente, sem grupo e sem mensagem de entrada; exige forjar
um contexto sintético*. Tudo no avaliador é construído sobre evento canônico
com remetente, conversa e mensagem, e a chave de serialização da admissão **é a
conversa** (`src/engine/fila.js:179`). Quem é o remetente de um comando que
ninguém mandou, e o que `{{sender.isAdmin}}` responde sobre um momento que já
passou, **não têm resposta óbvia** — e descobrir isso no meio da implementação é
como a `v2` produziu seis defeitos numa frente que nunca rodou.

## D-11. `setTimeout` por agendamento está fora, mesmo quando a frente G voltar

**Decidido:** fila e tabela, nunca temporizador vivo.

**Alternativa recusada:** um `setTimeout` por compromisso.

**Por quê:** já recusado neste projeto com a razão escrita — troca 10 mil itens
na fila por 10 mil temporizadores vivos, e **perde a tentativa num reinício**.
`retomada após reinício` é requisito explícito do pedido.

## D-12. `sem vaga: tenta de novo` fica fora da v1 da linguagem

**Decidido:** o compilador **recusa** a palavra, com erro que diz por quê.

**Alternativa recusada:** aceitar e reenfileirar.

**Por quê:** não existe estado "agendado" no protocolo — `evaluator.js` conhece
`sent`, `failed`, `outcome_unknown`. Aceitar a palavra prometeria um estado que
o motor não sabe representar.

## D-13. O teto por remetente não vem da `v2`

**Decidido:** entra em `src/engine/filasDeRecursos.js` e `fila.js`, por conta,
com a recusa **relatada** — frente I.

**Alternativa recusada:** portar `src/engine/senderRateLimiter.js`.

**Por quê:** ele derruba mensagem legítima em **seis tipos**
(`tests/gateway-encaminhamento.test.mjs`), é singleton de módulo (recarga de
config nunca aplica, e é compartilhado entre contas contra o próprio comentário
acima dele), o `Map` de baldes **não tem evicção**, roda antes do filtro de
rascunho (dois tokens por mensagem) e **descarta em silêncio** — anti-link e
porteiro param sem deixar rastro.

## D-14. Migração errada se conserta com migração nova

**Decidido:** nunca editar migração aplicada; o próximo número livre é **012**.

**Alternativa recusada:** corrigir o `.sql` no lugar.

**Por quê:** o aplicador não tem checksum e faz `if (aplicada.get(version))
return`. **Editar migração já aplicada não tem efeito nenhum** — o banco fica
diferente do arquivo, em silêncio, para sempre.

## D-15. Documentação nova em `docs/engineering/lcn-v2/`, não em `docs/`

**Decidido:** os 15 documentos do §24 numa pasta de engenharia própria.

**Alternativa recusada:** reescrever os `docs/*.md` existentes.

**Por quê:** `docs/` é documentação de **produto** — quem usa o sistema lê. Estes são de
**engenharia**, e um deles (`PERFORMANCE.md`) tem nome que já existe lá com
outro conteúdo, o que a própria abertura dele avisa. O §24 também manda *não
criar arquivo redundante se documento existente puder ser atualizado* — e é por
isso que `TEST_RESULTS.md` **referencia** `npm test` e `npm run soak` em vez de
redescrever a bateria.

## D-16. Documento sobre frente parada se escreve, não se omite

**Decidido:** `SCHEDULER.md` existe com 5 seções, documentando o que **não**
está implementado.

**Alternativa recusada:** listar a frente como pendente e não escrever nada.

**Por quê:** critério 9 do §25 exige pendência registrada **com razão e próximo
passo concreto**. E o que o documento acrescenta não cabe numa linha de lista: o
scheduler da `v2` **falha em silêncio** — loga `scheduler: engine.db não
encontrado, poll desativado` e retorna. **É a explicação de por que uma frente
completamente morta passou por entregue.**

## D-17. Nenhum número de RAM entra em `README.md`, `docs/` ou painel

**Decidido:** medição registrada em `PERFORMANCE.md`; promessa, nenhuma.

**Alternativa recusada:** publicar o perfil medido (≈210 MiB com orçamento de
64).

**Por quê:** decisão do dono, e ela se sustenta: a soma de RSS **superestima
1,74x** contra o cgroup (500,7 → 287,2 MiB), o soak não mede WhatsApp real nem
SQLite em disco nem transcrição, e é **uma** máquina. E o critério de
encerramento é literal: *não declare validado em produção o que só foi testado
localmente.*

## D-18. Três agentes de documentação foram despachados; dois morreram

**Decidido:** escrever eu mesmo os dois documentos que falharam, e **registrar o
fracasso** na parte B do relatório.

**Alternativa recusada:** redespachar até sair, ou omitir que foram chamados.

**Por quê:** os dois morreram na mesma patologia — *"aguardando o subagente de
pesquisa"* — com **exit 0 e zero arquivo escrito**. Exit 0 sem arquivo é a falha
mais perigosa do despacho: parece sucesso. O pedido manda dizer, na parte B,
quais subagentes **de fato rodaram** e qual foi o resultado. Esconder dois
fracassos enquanto o terceiro produziu documento real seria a mentira mais
fácil deste relatório.

## D-19. Saída de IA é dado, não instrução

**Decidido:** tudo que veio de outra IA foi conferido por comando antes de
entrar em documento.

**Alternativa recusada:** aceitar o "passou tudo" do relatório do agente.

**Por quê:** nesta auditoria uma delas afirmou **dependência que não existe**
(`ws` "ausente") e repetiu um falso alarme sobre o `package-lock.json` que eu
mesmo já havia desmentido — as 163 remoções são pacotes opcionais/peer do pino
caídos numa regeneração. E o documento que o agente que **funcionou** entregou
trazia 60 links `file:///` locais e **duas citações de linha erradas**, que eu
corrigi conferindo cada uma.

## D-20. Nada foi commitado

**Decidido:** 22 entradas na árvore de trabalho, zero commit em `v3`.

**Alternativa recusada:** commitar o trabalho em commits pequenos e lógicos,
como o próprio pedido sugere.

**Por quê:** regra do dono, e ela vem antes do pedido: **commit só quando ele
pedir explicitamente**. O efeito colateral é bom — a volta atrás desta onda é
gratuita (`ROLLBACK.md` §6).

**Atualização de 04/11:** o dono autorizou publicar o que já estava pronto, e a
frente C foi para `origin/v3` no commit `714834d`. O resto da árvore segue sem
commit pela mesma regra. `origin/master` não foi tocado.

## D-21. Semear não é provisionar: banco novo nasce com zero automações

**Decidido:** `garantirMenuPadrao` virou `migrarMenuLegado`. Ela não instala
nada: só migra a automação de menu de instalação antiga do id nativo
`__native_menu__` para o id comum `menu`, e grava a marca de semeadura com
`automation_id` **NULO** quando não havia nada a migrar — o que representa
"nada foi semeado" sem precisar de migração nova, porque a coluna já era
nullable em `012_menu_padrao.sql`.

**Alternativa recusada:** manter a semeadura do menu na abertura do banco,
confiando na marca de semeadura para não recriar um menu que o dono apagou.

**Por quê:** a marca impedia a **recriação**, não a **instalação inicial**. Uma
instância nova cujo provisionamento pedisse "vazia" ganhava uma automação de
qualquer forma, e §8 do pedido exige em letra que *"uma instância deve poder
começar completamente vazia"*. Três operações que estavam misturadas passam a
ser distintas: **inicialização** (cria o que o motor precisa para funcionar),
**migração** (preserva o que instalações anteriores já tinham) e
**provisionamento** (instala só o que a escolha inicial autorizou).

**O que continua no boot, de propósito:** o **pool comum**. `responder.poolId`
é obrigatório com `minLength: 1`, então pool é **infraestrutura, não
automação** — instância vazia tem zero automações, não zero pools.

**Prova:** os quatro conjuntos de teste que presumiam o menu semeado foram
**reescritos para instalar** por `POST /templates/menu/install`, não apagados.
Bateria inteira em **5074 checagens, zero falhas**. A queda de 3 contra a base
de 5077 está contabilizada: quatro checagens que só existiam para policiar a
cópia inline do documento de menu que o módulo não carrega mais, menos uma nova
(`instância NOVA nasce SEM automação nenhuma`).

## D-22. Hoje NENHUM modelo de instância isola pacotes: o motor é um só

**Esta decisão substitui a primeira versão de D-22, de 04/11, que dizia que o
pacote independente "se sustenta na gerenciada". Eu havia lido uma linha só do
gerador de unit (`quadlet.js:53`) e concluído que HOME separado implicava motor
separado. Lido o arquivo inteiro, não implica.**

Toda unit gerenciada recebe **o motor central do host**, por montagem:

```
Environment=LCN_ENGINE_SOCKET=/run/lcn-engine/engine.sock   (quadlet.js:54)
Volume=${PASTA_RUN_ENGINE}:/run/lcn-engine                  (quadlet.js:66)
```

E `PASTA_RUN_ENGINE` é **um caminho só**, não um por instância:
`~/.local/share/lcnwhatsapp/engine/run` (`src/engine/paths.js:9`). Então o
container tem sessão, mídia, `data/` e `config.json` próprios — e consulta as
automações do **mesmo processo e do mesmo `engine.sqlite`** que todos os outros.

| modelo | dados próprios | motor consultado | `accountId` distinto |
|---|---|---|---|
| gerenciada (Quadlet) | sim, 4 volumes | **o central do host**, por socket montado | sim, `LCN_INSTANCE_ID` (`quadlet.js:53`) |
| simples (`LCN_INSTANCIA=nome`) | sim, `data/instancias/<nome>/` | o central, pelo `SOCKET_PATH` padrão | sim, mas por UUID de arquivo |
| bare | sim, `data/` | o central | sim, UUID próprio |

As duas variáveis são **diferentes de propósito** e não se encontram:
`processoDaInstancia.js:86` passa `LCN_INSTANCIA: nome` e **não**
`LCN_INSTANCE_ID`, então a instância simples cai no degrau do arquivo e ganha um
UUID. Medido nesta máquina: `data/instancias/bot/instance-id.txt` =
`156c385b-…` para o que o painel chama `simples:bot`, e `data/instance-id.txt`
= `b03ac4d1-…` para a bare. **Nenhuma tabela e nenhum `join` liga um ao
outro.**

E não é descuido: `src/paths.js:15-35` escreve a intenção — *"O motor NÃO é
dividido de propósito: ele é central, e cada gateway se identifica pelo próprio
accountId"*. O que falta é o caminho de volta, do nome do painel para o id do
motor.

**Decidido:** §8 fica **partida em duas**, porque só metade dela depende disso.

| parte da frente D | depende de isolamento? | estado |
|---|---|---|
| instância nasce vazia; instalar pacote; idempotência; conferir dependência; editar, desativar e remover automação instalada; estado visível do que está bloqueado | **não** — valem num motor só | segue agora |
| "instâncias simultâneas com pacotes distintos" (o 10º teste obrigatório de §8) | **sim** | **bloqueada**, e o painel precisa dizer por quê |

O provisionamento age sobre a configuração **compartilhada** daquele motor, em
qualquer um dos três modelos, e a tela afirma isso **antes** de o dono escolher
um pacote. Não existe hoje "pacote de proteção na instância A e de atendimento
na B": existe um conjunto de automações, e os três gateways o consultam.

**Alternativas recusadas, e o motivo de cada uma:**

| alternativa | por que não agora |
|---|---|
| `account_id` em `automations` | `automations` não é a única tabela compartilhada — pools, conexões, atributos de entidade, variáveis e execuções também são. Isolaria a **seleção** sem isolar o **dado**: duas instâncias no mesmo grupo continuariam dividindo atributos de entidade |
| um motor por instância | resolve de verdade, por fronteira de banco, mas **muda o modelo de deploy** (processos, sockets, PID, migração do banco compartilhado, a montagem do Quadlet) e quebra os pools, que existem justamente para coordenar vários gateways sob um motor. É decisão do dono, não minha |
| conta como mais um `kind` de escopo | confunde **identidade de instalação** com **filtro de conversa**. `scope` diz em qual conversa a automação pode agir; a conta diz a qual instalação ela pertence |
| afirmar que a gerenciada já isola | **era o que esta decisão dizia, e é falso.** O socket montado é a prova |

**Como provar, se alguém mudar isto:** não basta contar `engine.sqlite` no
disco. Duas gerenciadas, A e B; o pacote de Proteção só em A, o de Atendimento
só em B; conferir que o motor **efetivamente consultado por A** não lista as
automações exclusivas de B, reiniciar as duas e conferir de novo. Hoje esse
teste falha por construção, porque o motor consultado é o mesmo objeto.

## D-23. A tabela `instances` do motor nunca é povoada — e isso QUEBRA os Pools

`001_init.sql:6-14` cria `instances (id PRIMARY KEY, provider, account_id
UNIQUE, label, capabilities_json, …)`, e
`src/engine/server/routes/instances.js` serve o CRUD inteiro dela.
`src/engine/client.js:148-153` expõe o grupo `instancias` para o cliente.

**E nada chama `criar`.** As quinze referências a `.instancias` em `src/` são
todas de `src/web/router.js`, que fala com `aplicacao.instancias` — o registro
**administrativo** em `instanceService.js`, outro objeto. Medido no banco real
desta máquina: `SELECT id, provider, account_id, label FROM instances` devolve
`[]`, com 6 MB de banco e automações em uso.

Então o motor **nunca soube** quais instâncias existem. Ele só vê o `accountId`
que chega em cada evento (`canonicalEvent.js:112`, campo obrigatório) e o
`target_account_id` que grava em `outbound_commands`.

**Correção de 04/11, levantada pelo ChatGPT e conferida por mim.** O título
original dizia "ninguém escreve nela", e isso é falso: `routes/instances.js:29`
e `:32` têm `INSERT INTO instances` e `UPDATE instances`, servidos por
`POST /instances` e `PUT /instances/:id`. **Os caminhos de escrita existem; é o
ciclo de vida das instâncias gerenciadas que nunca passa por eles.** A conclusão
operacional não muda, a frase mudou.

**E a correção revelou algo que eu não tinha visto: a aba Pools não funciona.**
`routes/pools.js:63` recusa membro cuja instância não esteja na tabela:

```js
if (!db.prepare('SELECT 1 FROM instances WHERE id = ?').get(params.instanceId)) {
  throw new ErroHttp(404, `Instância não encontrada: ${params.instanceId}.`)
}
```

A cadeia inteira existe e está ligada — `pages/pools.js:177` →
`api.pools.saveMember` → `web/router.js:346` → `PUT /pools/:id/members/:id` —
então o botão "adicionar membro" da aba Pools responde **404 para qualquer
instância**, porque a tabela está vazia. O que estava registrado até hoje era
"o peso de `pool_members` não é consumido". É pior: **não há como povoar
`pool_members` pelo painel.** Isto é defeito de produto, não lacuna de
documentação, e entra na frente B com a correção do texto da tela.

**Decidido:** não ligar esse CRUD por enquanto, e **não** usá-lo como destino do
provisionamento. É a mesma classe do `pool_routing` da v2 — tabela com zero
leitores — e ligá-lo agora criaria um segundo registro de instâncias ao lado do
administrativo, com duas verdades para manter em sincronia e nenhum dono claro.

**Alternativa recusada:** registrar a instância no motor na subida do gateway.
Parece barato e resolveria o "caminho de volta" de D-22, mas o gateway não
conhece o nome que o painel deu a ele (`LCN_INSTANCIA` é o nome da pasta, não o
`instanceId` do registro), então ele registraria um vínculo que ele mesmo
inventou. Quem sabe os dois lados é o **administrador**, no host — é lá que a
associação tem de nascer, se nascer.

**Defeito aberto, de passagem:** `resolverAccountId`
(`instanceIdentity.js:18-34`) gera um UUID e tenta persistir em
`instance-id.txt` dentro de `try { … } catch { /* melhor esforço */ }`,
**devolvendo o UUID mesmo quando a escrita falha**. Vale para aquela execução e
muda no reinício seguinte. Para identificar o destino de um provisionamento,
identidade que só existe em memória não serve; o conserto é falhar alto quando
não der para persistir, e está na lista da frente D.

## D-24. Provisionamento idempotente: classificar antes de publicar, e tudo-ou-nada

§8 do pedido exige três coisas que o código não entregava: *"o provisionamento
deve ser idempotente"*, *"reiniciar o sistema não pode instalar comandos
duplicados"* e *"atualizar o sistema não pode sobrescrever alterações
personalizadas sem autorização"*.

**O defeito, medido:** o id padrão da automação **é** o id do template
(`automationIds[templateId] || templateId`). Então reprovisionar um pacote em
que UM membro já existia batia no `409 Automação já cadastrada: <id>.` de dentro
de `automationsService.criar` — e como a instalação toda roda numa única
`db.transaction`, isso derrubava a transação INTEIRA. Um pacote de cinco
comandos com um membro instalado não instalava os outros quatro, e a resposta
não dizia qual membro tinha parado tudo.

**Decidido:** `src/engine/server/provisionamento.js` classifica a ordem inteira
ANTES de publicar qualquer coisa, em seis estados:

| estado | condição | consequência |
|---|---|---|
| `novo` | não existe automação com esse id | instala |
| `instalado` | existe, deste template, mesma versão, documento idêntico ao que o template produz | pula — é o estado desejado |
| `desatualizado` | existe, deste template, versão do catálogo é outra | bloqueia (adotar versão nova é ato do formulário de reconfigurar, que mostra o que muda) |
| `modificado` | existe, deste template, documento diferente: alguém editou à mão | bloqueia, **nunca sobrescrever** |
| `naoVerificavel` | existe e veio deste template, mas a origem não se prova (sem revisão ativa, ou os valores guardados já não reconstroem o documento) | bloqueia |
| `conflito` | existe SEM proveniência, ou com proveniência de OUTRO template | bloqueia, nunca adotar automaticamente |

E a decisão é **tudo-ou-nada**: se qualquer membro bloqueia, nada é publicado e
o 409 carrega o relatório membro por membro em `detalhes.itens`.
**Alternativa recusada:** instalar só os que dão. Deixaria o pacote pela metade
sem ninguém saber quais metades entraram — e foi exatamente o que o ChatGPT
prescreveu contra, no painel sobre arquitetura de pacotes.

**Membro já instalado com valores DIFERENTES também bloqueia.** A conferência é
feita chamando a comparação uma segunda vez com os parâmetros **pedidos** em vez
dos guardados: se o documento produzido não é o mesmo, o pedido quer outra
coisa, e mudar valor de automação instalada é pelo formulário de reconfigurar.
Compara-se pelo documento, não pelos valores crus, porque dois valores escritos
diferentes podem produzir o mesmo comando.

### Duas peças que o painel pediu e que JÁ EXISTIAM — nada de código novo

**Não há migration `013`, e não há coluna de impressão digital do documento.**
O ChatGPT prescreveu um `document_fingerprint` para detectar edição à mão.
`src/reconfiguracao.js` já fazia isso melhor: `compararComTemplate` **renderiza
o template com os parâmetros guardados**, descarta `id`/`revision`/`scope` dos
dois lados, compara canonicamente (ordem de chave em objeto JSON não é
informação) e devolve as divergências com nome humano (`nome`, `rótulo do
menu`, `ligada/desligada`, …). Uma impressão digital diria *que* mudou; isto diz
*o quê*. A função foi extraída de dentro de `analisarReconfiguracao`, que a
usava sem expor, e agora os dois caminhos usam a mesma.

**Recuperação de morte de processo também já está coberta, para o caso de um
motor só.** A árvore inteira da instalação está dentro de uma `db.transaction`
sem nenhum efeito fora daquele SQLite, então uma queda no meio faz rollback e
não deixa nada publicado pela metade. A tabela de operação-e-recuperação que o
ChatGPT desenhou passa a ser necessária quando o provisionamento tocar estado
FORA daquele banco (containers, `state.json`, mais de um motor) — o que hoje
não acontece, e por D-22 não pode acontecer. Fica registrada como pendência
condicionada, não construída por antecipação.

### Prova

`tests/provisionamento-idempotente.test.mjs`, 21 checagens, cobrindo quatro dos
dez testes obrigatórios do §8: *provisionamento com pacote*, *repetição
acidental do provisionamento*, *instalação parcial e recuperação*, e
*atualização de template sem perda de personalização*. Bateria inteira em
**5095 verdes, saída 0** (eram 5074 antes destas 21).

## D-25 — Remover pacote é despublicar, e restaurar é operação PRÓPRIA

**Decisão:** `classificarOrdem` ganhou um sétimo estado, `despublicado`, que
NÃO bloqueia o provisionamento: o membro volta ao ar republicando a revisão que
já existe. Instalar, restaurar e atualizar ficam sendo três coisas distintas no
relatório da operação (`installed`, `restored`, `alreadyInstalled`).

**O defeito, medido antes de consertar.** Uma sonda instalou o par do menu,
despublicou os dois pela rota real (`POST /automations/:id/unpublish`) e pediu o
pacote de novo. Saída:

```
REINSTALAR FALHOU: 409 A automação "config-menu" existe mas não tem revisão
publicada, então não dá para conferir se é o que este template produz. (…)
itens: [{ "t": "config-menu", "e": "naoVerificavel" }, { "t": "menu", "e": "naoVerificavel" }]
```

Isto é mais grave do que parecia: **o pacote removido ficava impossível de
reinstalar**, e a recusa culpava uma origem não verificável em vez de dizer o
que de fato havia acontecido. A proveniência sobrevive (2 linhas), as revisões
sobrevivem como `inactive`, e só `active_revision_id` é zerado — `lerDocumento`
lia apenas a revisão ATIVA, então o documento aparecia como nulo.

**Por que o conserto é barato.** `publicar(id)` sem `revisaoAlvo` já republica
`obterUltimaRevision` — a revisão de número mais alto, de QUALQUER status — e já
re-deriva `enabled` de `documento.enabled`. Não houve SQL novo, nem migration,
nem coluna nova. Faltava só reconhecer o caso.

**A sutileza que torna o conserto seguro, e é o motivo de ele comparar antes de
restaurar.** Como `publicar` pega a revisão mais recente, e essa pode ser um
rascunho salvo DEPOIS da remoção, a classificação compara contra exatamente o
documento que `publicar` usaria. Rascunho escrito à mão classifica como
`modificado` e PARA a operação — senão restaurar viraria sobrescrita silenciosa,
que é o que o §8 proíbe.

**`enabled` não precisa de tratamento especial.** Desligar uma automação
publicada não mexe em `active_revision_id`, então ela classifica como
`instalado` e é pulada: continua desligada. `despublicar` zera `enabled` como
parte de tirar do ar, então ali não há escolha deliberada a preservar.
`deployment_mode` também não é reescrito na restauração.

**Alternativa recusada:** tratar reinstalação e restauração como a mesma
operação. Confundiria "este membro nunca existiu" com "este membro existe e foi
tirado do ar", e é o que produzia o beco sem saída.

**Previsão externa corrigida.** O ChatGPT (web, conta Plus, esforço Alta, chat
"Próxima decisão de idempotência") previu que a reinstalação **responderia com
sucesso sem voltar os comandos a funcionar**. Medido, o comportamento é outro:
409 em todos os membros. O diagnóstico dele segue valendo — *"idempotência do
documento não é a mesma coisa que convergência do estado operacional
desejado"* — e a prescrição (estado operacional ortogonal, restauração
explícita) é o que foi implementado.

**Guardas:** dois casos novos em `tests/provisionamento-idempotente.test.mjs`,
9 checagens, cobrindo o quinto dos dez testes obrigatórios do §8 — *remoção de
pacote*. Bateria em **5104 verdes, saída 0** (eram 5095).

## D-26 — O catálogo guarda UMA versão por template, então versão fixada que não existe REPROVA

Medido: `carregarCatalogo` indexa por `templateId` e lança em duplicata
(`catalog.js`), então o par `(templateId, templateVersion)` não é endereçável —
só a versão presente na pasta carrega. E há defasagem real hoje: **112 templates
na versão 1, 7 na 2, 2 na 3**.

Consequência para os manifestos de pacote (D2): fixar `templateVersion` num
manifesto **não garante reprodutibilidade**. A regra adotada, conservadora: se a
versão fixada não estiver disponível, o pacote **reprova na validação** — nunca
substitui em silêncio pela versão nova do catálogo. Trocar a receita por outra
sem dizer é pior do que recusar.

Medido também que **não existe guarda de imutabilidade**: `sha256`/`createHash`
não aparecem em `tests/` nem em `src/engine/templates/`, e só três arquivos
mencionam `templateVersion`. Hoje, editar o conteúdo de um `template@1` sem
subir a versão é indetectável. Uma sonda provou que a guarda é escrevível:
renderizando os 121 templates com a convenção de preenchimento que o próprio
projeto usa em `tests/templates-contra-schema.test.mjs`, o hash agregado saiu
**idêntico em duas execuções consecutivas**.

## D-27 — A dependência de SERVIÇO é derivável do `.lcn`, e não se duplica em manifesto

Censo medido: **35 templates chamam conexão externa**, sempre na forma
`chama {{params.conexao}}.<funcao>`, com o id vindo do bloco `configurável` e
nunca do fluxo. Por conexão: `imagem` 16, `efeitos` 7, `midia` 5, `qr` 2, e
`clima`/`cotacao`/`encurtador`/`navegador`/`traducao` 1 cada. Das conexões
prontas, só `midia` e `imagem` existem (`conexoes/prontas.js`) — logo
**exatamente 14 templates dependem de serviço ausente**.

Decisão: a metade "não apresente uma funcionalidade como disponível quando ela
depender de um serviço ausente" (§8) sai dessa derivação, não de uma lista
escrita à mão no manifesto. Lista à mão envelhece em silêncio; a declaração do
template não. O portão de publicação já faz a conferência equivalente
(`validate.js`, `action.connection.call` contra a declaração da conexão), e é
ele que a frente D4 deve reusar em vez de reinventar.

## D-28 — `scope` fora da comparação com o template está CORRETO

`FORA_DO_TEMPLATE = ['id', 'revision', 'scope']` (`src/reconfiguracao.js`).
Levantado como possível furo: um escopo estreitado à mão poderia ser
sobrescrito por reprovisionamento. **Não procede.** A rota só escreve
`documento.scope` dentro do laço que pula todo membro cujo estado não é `novo`,
então reprovisionar não toca no escopo de quem já está instalado. E excluir o
campo da comparação é o certo: o template não especifica escopo — ele vem da
instalação. O que fica em aberto é a semântica de ATUALIZAÇÃO (D2), não a de
provisionamento.

## D-29 — "Funcionalidades específicas" e "configuração personalizada" são ESCOLHAS persistidas, não pacotes

Dos sete caminhos que o §8 exige no provisionamento, só quatro são pacote de
catálogo. Os outros três não viram manifesto no repositório:

| opção oferecida | representação |
|---|---|
| instância vazia | seleção persistida com **zero** membros |
| básico / atendimento / administração / proteção | manifesto versionado |
| funcionalidades específicas | seleção avulsa persistida |
| configuração personalizada | plano de configuração persistido |

**Decisão:** se alguém escolher `ping`, `menu`, `anti-link` e `clima`, isso
**não** gera pacote distribuído. Gera um registro de seleção com os templates
pedidos, as versões resolvidas, os parâmetros, o escopo e os membros resultantes
— dependências incluídas. A classificação de conflitos, a transação e a
proveniência continuam as mesmas.

**A distinção que precisa existir no registro,** e que é a razão de D-29 não ser
só nomenclatura: *específicas* é escolher templates do catálogo pelos formulários
normais; *personalizada* pode incluir automação criada à mão ou modificada de
propósito. Então um membro é uma de três coisas — administrado a partir de um
template, personalizado pelo usuário, ou apenas **referenciado** pela
configuração sem estar sob gerência do provisionamento. **Automação criada à mão
NUNCA recebe proveniência fictícia de template para caber no modelo.**

**A instância vazia também merece registro.** Há diferença entre *o usuário
escolheu começar sem automações* e *o usuário não concluiu o provisionamento*, e
o painel precisa poder dizer qual dos dois. Não se cria um `vazio.json`:
persiste-se a escolha com zero membros.

**Atualizar uma seleção avulsa gera revisão da ESCOLHA**, não `packageVersion`.
A identidade da instalação e os vínculos anteriores permanecem. E a revisão nova
**não autoriza** sobrescrever automação modificada à mão — continua exigindo
classificação e autorização. Se uma combinação popular virar pacote oficial
depois, é receita nova no catálogo; nada é reclassificado retroativamente.

**Alternativa recusada:** transformar cada combinação escolhida em manifesto no
repositório. Enche o catálogo de receitas que ninguém distribui e faz o
histórico de um cliente depender de um arquivo que pode ser editado depois.

## D-30 — A identidade da instância passa a FALHAR ALTO (fail closed)

D-23 registrou o defeito: `resolverAccountId` devolve o UUID gerado mesmo quando
a escrita de `instance-id.txt` falha, dentro de `catch { }`. O ChatGPT apontou
que a consequência é pior do que "muda no reinício": **a instância opera com
identidade efêmera sem que o resto do sistema saiba.**

**Decidido:** ou a identidade persistente é carregada e validada, ou o
componente **não inicia** operação que dependa dela. Para instância gerenciada,
a identidade vem de quem a criou e tem de sobreviver a reinício, atualização,
restauração e troca de número. Precisa também de política explícita de
**clonagem**: copiar um diretório não pode criar duas instâncias ativas
reivindicando a mesma identidade.

E a advertência que fecha o assunto do isolamento: **coluna `instance_id` não
basta** se quem chama puder informar o identificador de outro cliente. A
identidade tem de vir de contexto de acesso autenticado e ser aplicada
obrigatoriamente a toda operação — senão o socket compartilhado continua sendo
risco mesmo com o esquema perfeito. Isto reforça D-22, não o substitui.

## D-31 — Os invariantes que o D2 tem de provar, e a ordem de implementação

Lista fechada de cenários, com o resultado obrigatório de cada. Os três
primeiros marcados ✅ já existem em
`tests/provisionamento-idempotente.test.mjs`; os demais são a pauta do D2.

| cenário | resultado obrigatório |
|---|---|
| ✅ pacote reinstalado sem diferenças | nada é sobrescrito |
| ✅ pacote reinstalado após despublicação | estado identificado; **nenhuma reativação silenciosa** |
| ✅ membro modificado antes da remoção | 409, transação sem alterações |
| template referenciado foi removido | falha na validação do pacote |
| template mudou sem subir a versão | falha de imutabilidade |
| dependência transitiva acrescentada | divergência detectada no lockfile |
| instalação antiga após atualizar o manifesto | composição histórica **permanece igual** |
| membro mantido por decisão explícita | desvinculado, documento preservado |
| membro compartilhado entre dois pacotes | remover um não despublica o compartilhado |
| pacote com histórico de execuções | remoção operacional preserva o histórico |
| instância vazia escolhida | registro persiste com zero membros |
| configuração personalizada alterada | revisão da seleção preservada |
| falha na gravação da identidade | **provisionamento impedido** (D-30) |
| duas instâncias, mesmo comando e escopo | nenhuma interferência entre clientes |
| duas instalações concorrentes | uma resolução coerente, sem vínculo duplicado |
| exclusão direta de automação vinculada | bloqueio ou reconciliação auditável, nunca perda silenciosa do vínculo |

**Ordem decidida**, e o que pode andar em paralelo: **D2-B** (manifestos,
schema, versões, resolução de dependências, deriva e lockfile) **começa agora**,
porque não publica automação nenhuma e por isso não depende da fronteira de
instância. **D2-A** (identidade estável e decisão de isolamento) é o bloqueio da
liberação multi-cliente e está com o dono (D-22). **D2-C** (registro
persistente) escreve de verdade, então respeita a fronteira do D2-A. **D2-D**
(instalar, consultar, desativar, despublicar, remover, desvincular, restaurar)
reusa o serviço de automações e seus validadores. **D2-E** (painel) oferece os
sete caminhos com prévia de membros, dependências e conflitos, e **não
implementa um segundo resolvedor**.

Veredito externo, registrado: o desenho do D2 é aprovado com uma condição —
*"a associação de pacote a uma instância não pode ser mais confiável que a
própria identidade da instância"* —, recomendando implementar os manifestos e os
testes de deriva **enquanto** a decisão de isolamento é fechada, e não conectar
o provisionamento de pacotes a um fluxo multi-cliente de produção antes disso.

## D-32 — O registro de pacotes guarda um ESCOPO DECLARADO, não um `instance_id`

**Contexto.** §8 exige duas coisas que o banco não derivava de nada que já
guardava: *"a configuração selecionada deve persistir"* e *"o usuário pode
editar ou remover as automações instaladas"*. `automation_template_provenance`
(migração 006) diz de qual **template** cada automação veio; não diz nada sobre
o **pacote** que a trouxe nem sobre a escolha feita no provisionamento. Sem
registro próprio, *"remover o pacote de atendimento"* não tem lista de membros
para remover, e *"instância vazia"* não se distingue de *"instância que nunca
foi provisionada"* — a mesma ambiguidade que obrigou a existir a migração 012
(`migrarMenuLegado` não sabia separar *"o dono apagou o menu"* de *"esta
instância nunca teve menu"*, e o menu ressuscitava a cada reinício).

**A medição que decidiu o desenho.** A tabela `instances` existe desde a
migração 001 e **ninguém a popula**: o único escritor é
`src/engine/server/routes/instances.js:29`, um endpoint de registro explícito, e
o ciclo de vida da instância gerenciada nunca insere linha nela. É exatamente
por isso que `src/engine/server/routes/pools.js:63`, que filtra por
`SELECT 1 FROM instances WHERE id = ?`, devolve **404 para toda instância**
(D-23).

**Decisão.** `package_installations` carrega o par explícito
`scope_kind IN ('engine','instance')` + `scope_id TEXT NOT NULL CHECK (length(scope_id) > 0)`.
Hoje só `'engine'` se prova — todas as instâncias gerenciadas compartilham um
motor (`LCN_ENGINE_SOCKET=/run/lcn-engine/engine.sock`) e um banco. Quando o
modelo de implantação der um motor por instância, ou uma identidade que falhe
fechada, `escopoDoMotor` passa a devolver `{kind:'instance', id}` e **nada mais
no módulo muda**. O `CHECK (length(scope_id) > 0)` é o fail-closed em forma de
esquema, e `escopoDoMotor` **lança** em vez de cair num padrão.

**Alternativas recusadas:**

| alternativa | por que não |
|---|---|
| chave estrangeira para `instances` | nasceria quebrada: a tabela não é populada pelo ciclo de vida. É o defeito que já produz o 404 dos pools |
| coluna `instance_id` crua | gravaria uma identidade que ninguém prova, contrariando D-30 e D-31 (*"a associação de pacote a uma instância não pode ser mais confiável que a própria identidade da instância"*) |
| escopo anulável, preenchido depois | um registro sem escopo é indistinguível de um registro de escopo errado; e `NULL` em índice único parcial não colide, então duas instalações "sem escopo" coexistiriam |

**Outras decisões do mesmo arquivo, com a razão de cada:**

- **`removed_at` em vez de `DELETE`** — "nunca instalei" e "instalei e tirei" são
  estados diferentes, e §8 pede os dois (remoção de pacote **e** instância
  vazia). É a lição da 012.
- **Dois índices únicos parciais**, e não restrições genéricas:
  `package_installations_vivas (scope_kind, scope_id, kind, COALESCE(package_id,''))
  WHERE removed_at IS NULL` faz o provisionamento repetido **reconhecer** a
  instalação viva em vez de bifurcar uma paralela que ninguém remove inteira;
  `package_installation_items_automacao_viva` impede duas instalações vivas de
  reivindicarem a mesma automação — senão remover um pacote apagaria automação
  que o outro conta como sua. **As duas chaves foram corrigidas depois, medidas
  por sonda: ver D-34 (a identidade não é o pacote, é a seleção) e D-35 (a
  exclusividade é de posse, não de referência).**
- **`origin` e `binding` são distinções separadas**, não uma coluna sobrecarregada.
  `origin IN ('pedido','dependencia')` é a `origem` que `resolverPacote` já
  produz; `binding IN ('criada','compartilhada','avulsa')` é **posse**: só
  `'criada'` entra em `planejarRemocao().aRemover`, porque *o pacote não é dono
  do que não nasceu nele*.
- **`CHECK ((kind = 'pacote') = (package_id IS NOT NULL))`** — "instância vazia",
  "funcionalidades específicas" e "configuração personalizada" são **escolhas**
  persistidas, não pacotes (D-29). Deixá-las carregar um `package_id` seria o
  primeiro passo para proveniência fictícia.
- **`initial_revision_id`** é o que torna *"atualização de template sem perda de
  personalização"* verificável: se a revisão ativa não é mais a que a instalação
  publicou, alguém editou e a regeneração exige autorização. Quando é `NULL`, a
  resposta honesta é "não sei" — e **não sei BLOQUEIA** a regeneração em vez de
  autorizá-la, espelhando `naoVerificavel` em `provisionamento.js`.

**Prova.** `tests/registro-de-pacotes.test.mjs`, 40 checagens, contra banco real
(`abrirBanco(':memory:')` com as migrações de verdade). As guardas foram
provadas **negativamente**: tirar o `WHERE removed_at IS NULL` do índice de
automação viva derruba duas checagens, e fazer `escopoDoMotor` cair num padrão
em vez de recusar derruba outras duas. Bateria completa: `exit=0`, **5175 ✅**.

### Alternativa recusada, levantada pelo Gemini depois do fato

Consultado sobre este registro, o Gemini argumentou que `(scope_kind, scope_id)`
é *"uma ficção de multilocação numa tabela de borda"*: nenhuma tabela estrutural
do motor em `001_init.sql:41-66` carrega escopo ou locatário, e `automations.id`
é chave primária GLOBAL. Com isolamento real por processo a coluna vira dívida
redundante; com banco compartilhado, o par polimórfico sem chave estrangeira
impede a integridade referencial que um `instance_id REFERENCES instances(id)`
daria de graça.

**O argumento é bom e fica registrado, não aplicado** — porque é exatamente a
decisão que o D-22/D2-A põe na mão do dono. Enquanto a fronteira de isolamento
não existir, um `instance_id` com chave estrangeira apontaria para `instances`,
que **é tabela que ninguém preenche** (D-23: o único escritor é
`routes/instances.js:29`). Trocar um par sem FK por uma FK para tabela vazia não
compra integridade; compra 404. Quando o modelo de implantação for decidido, esta
é a primeira migração a escrever.

## D-33 — Automação apagada por fora deixa o item ÓRFÃO, e soltá-lo é explícito

**Contexto.** `routes/automations.js:115-150` apaga a automação numa transação
que mexe em `outbound_commands`, `automation_runs` e `automations` — e **não toca
no registro de pacotes**. Não há chave estrangeira de `package_installation_items.automation_id`
para `automations.id`, de propósito: o item é REGISTRO HISTÓRICO do que foi
instalado, e `ON DELETE CASCADE` apagaria a prova de que o pacote um dia criou
aquela automação.

**Decisão.** `conciliarComAutomacoes` classifica cada item vivo como
`vinculo: 'presente' | 'orfao'`, e `liberarItemOrfao` é a **única** saída: ela
recusa item que não está vivo e recusa item cuja automação ainda existe. O órfão
não se dissolve sozinho.

**Por que explícito.** Um item órfão é a diferença entre *"o dono apagou a
automação"* e *"o provisionamento falhou no meio"* — e são recuperações
diferentes. Soltar automaticamente na leitura apagaria essa distinção justamente
no caso de §8 *"instalação parcial e recuperação após falha"*. Depois de liberado,
o `automation_id` volta a poder ser reivindicado, e uma automação recriada com o
mesmo id **não** é readotada pela instalação antiga.

**Alternativa recusada:** fazer a própria rota de exclusão marcar o item
`removed_at` dentro da transação dela. Foi o conserto que o Gemini propôs, "na
origem". Recusado por ora porque põe conhecimento de pacote numa rota que hoje
não sabe que pacotes existem, e porque apagar a automação não decide se o pacote
deve esquecê-la — é o dono que decide. Fica como item do D2-D.

**Prova.** `tests/registro-de-pacotes.test.mjs`, bloco de conciliação, com linhas
reais semeadas em `automations`. Três derivas provadas vermelhas.

## D-34 — A identidade de uma instalação SEM pacote é a própria seleção

**Contexto.** O índice de instalação viva nasceu keyed em
`COALESCE(package_id, '')`. Para `pacote` isso é o pacote; para as outras três
escolhas de §8 é **string vazia** — então "funcionalidades específicas" e
"configuração personalizada" colidiam todas na mesma chave.

**Medição, por sonda, antes de existir conserto:** um segundo conjunto de
funcionalidades no mesmo escopo devolvia `{"jaExistia":true,"itens":1}`. Não era
erro — era **idempotência errada**: o pedido novo era descartado em silêncio e o
operador recebia de volta a instalação do primeiro conjunto.

**Decisão.** A coluna `selection_key`, calculada em JS por `chaveDaSelecao` e
NOT NULL no schema:

| escolha | chave |
|---|---|
| `pacote` | `pacote:<packageId>` |
| `vazia` | `vazia` |
| `especificas` / `personalizada` | `<kind>:<hashCanonico(selecao)>` |

`hashCanonico` (`src/engine/templates/pacotes.js:47`) é o hash da casa e ordena
as chaves do objeto recursivamente, então o MESMO pedido em outra ordem de campos
continua sendo o mesmo pedido.

**E para `pacote` a seleção NÃO entra**, de propósito: reprovisionar o mesmo
pacote com outro parâmetro continua sendo a *"repetição acidental do
provisionamento"* que §8 manda reconhecer. Se a seleção entrasse ali, cada clique
repetido com um parâmetro diferente criaria instalação paralela — exatamente o
defeito que o índice existe para impedir.

**Prova.** Duas seleções `especificas` diferentes produzem duas instalações vivas
(`jaExistia: false`); a mesma seleção reconhece a viva; o mesmo pacote com outro
parâmetro reconhece a viva. Deriva provada vermelha: voltar o índice para
`COALESCE(package_id, '')` derruba o caso com `SQLITE_CONSTRAINT_UNIQUE`.

## D-35 — Exclusividade de automação é POSSE, não referência

**Contexto.** O índice de item vivo era `UNIQUE (automation_id) WHERE removed_at IS NULL`,
sem olhar o vínculo. O schema define `binding = 'compartilhada'` como *"a automação
já existia e foi ADOTADA com autorização explícita de quem opera"* — e o índice
proibia exatamente isso.

**Medição, por sonda:** duas instalações vivas em escopos diferentes referenciando
`config-menu`, a segunda declarando `binding: 'compartilhada'`, davam
`UNIQUE constraint failed: package_installation_items.automation_id`. A palavra
do schema nomeava um estado **inalcançável**.

**Decisão.** O índice é parcial em DUAS dimensões:
`WHERE removed_at IS NULL AND binding = 'criada'`. Instalação removida pode ter
deixado o mesmo `automation_id` no histórico, e isso é registro, não conflito; e
dois pacotes dependendo da mesma automação adotada é desenho, não erro.

**O perigo que abrir o índice cria, e onde ele é fechado.** Com a adoção
permitida, o pacote A pode ser DONO (`criada`) de uma automação que o pacote B,
vivo, adotou (`compartilhada`). Remover A levaria embora o que B conta como
dependência. Então `planejarRemocao` consulta se há outra instalação **viva**
referenciando aquele `automation_id` e, havendo, manda o item para `aSoltar` com
`motivo: 'reivindicadaPorOutraInstalacao'` e `porInstalacao`. **Remover um pacote
nunca quebra o pacote do lado**, e o plano diz por quê em vez de silenciar.

**Prova.** Adoção entre instalações vivas passa; duas posses `criada` sobre a
mesma automação continuam colidindo; remover o dono disputado devolve
`aRemover: []` com o motivo nomeado; e com o vizinho removido o dono volta a
poder remover. Duas derivas provadas vermelhas (tirar `AND binding = 'criada'`,
e cegar a consulta de reivindicação).

**Bateria completa depois de D-33, D-34 e D-35: `exit=0`, 5196 ✅.**

## D-36 — A rota de instalação JÁ É uma transação, e o registro entra DENTRO dela

**Contexto.** Faltava decidir onde a escrita do registro entra no caminho que
publica as automações: antes do laço de publicação, depois dele, ou dentro da
mesma transação. `registrarInstalacao` abre a própria `db.transaction(...)`, e
eu tinha afirmado que a rota **não** envolvia o laço numa transação própria.

**A afirmação era FALSA, e foi corrigida de fora.** `grep -n "db.transaction"
src/engine/server/routes/templates.js` devolve `50: const instalar =
db.transaction((templateIdRaiz, body) => {` — a rota inteira já é uma transação.
O comentário em `templates.js:44-49` documenta que o better-sqlite3 aceita
`.transaction()` aninhada por savepoint automático, e `criarEPublicar` é ela
mesma uma `db.transaction` chamada de dentro de `instalar` **em produção hoje**.
Quem apontou o erro foi o ChatGPT web (Plus, esforço Alta), lendo o repositório
público; o Gemini (agy perfil2, `gemini-3.8-flash-high`) confirmou o
comportamento de savepoint por conta própria, citando `templates.js:47-49` e
`automationsService.js:203-206`. Saída de outra IA é dado: as duas afirmações
foram conferidas por `grep` antes de virarem decisão.

**Decisão.** O registro é escrito **dentro da transação, depois dos laços de
criação e de restauração**. Cada membro `novo` leva
`initialRevisionId = automacao.activeRevisionId` — o valor que `criarEPublicar`
→ `publicar` → `exporAutomation` já devolve, e que `templates.js:86` já tem em
mão. `initial_revision_id` é `INTEGER` porque `automation_revisions.id` é
`INTEGER PRIMARY KEY AUTOINCREMENT` (`001_init.sql:51`).

**Alternativas recusadas, com o que se perde em cada uma:**

| onde | o que quebra |
|---|---|
| **ANTES** de publicar | grava uma instalação FANTASMA. Se a publicação falhar fora de transação, o índice parcial `package_installations_vivas` passa a bloquear a retentativa com um `jaExistia: true` falso |
| **DEPOIS** da transação | as automações ficam publicadas e ÓRFÃS: sem `installation_id`, `planejarRemocao` não tem o que planejar, e a "remoção de pacote" que §8 exige deixa de existir |
| **DENTRO** (escolhida) | perde-se só liberdade de ordenar o código: o registro tem de vir depois das revisões existirem |

## D-37 — Repetir o provisionamento RECONCILIA a instalação viva; não devolve o passado

**Contexto.** `instalacaoViva` casa só por IDENTIDADE da escolha
(`scope_kind`, `scope_id`, `kind`, `selection_key`), nunca por composição. O
caminho de idempotência devolvia os itens já gravados **sem comparar com os
membros recebidos**.

**Medição, por sonda própria** (`probe-jaexistia.mjs`, sobre
`abrirBanco(':memory:')`): instalar `[a, b]`, repetir com `[a, b, c]` imprimia
`2a chamada: jaExistia = true  itens = 2`, `itens gravados: a,b`,
`❌ o membro "c" foi PERDIDO em silencio`. Idempotência **falsa**: depois de uma
falha no meio do laço de publicação, repetir o provisionamento nunca completava
o pacote — e §8 pede literalmente o teste *"instalação parcial e recuperação
após falha"*. O defeito foi apontado pelo ChatGPT web numa pergunta que eu não
fiz; a reprodução é minha, por sonda, não pela palavra dele.

**Decisão.** `registrarInstalacao`, ao reconhecer uma instalação viva, chama
`reconciliarInstalacaoViva`: acrescenta os membros que faltam, **relata** em
`ausentes` os itens que o pedido não traz mais, e data o reparo em
`reconciled_at`. Os dois caminhos passaram a devolver a mesma forma
(`{ installationId, jaExistia, itens, acrescentados, ausentes }`).

**Três regras dentro do reparo:**
1. Item ausente é **relatado, nunca apagado.** Sair do pacote é trabalho de
   `planejarRemocao`/`marcarRemovida`, que têm plano e autorização; apagar por
   efeito colateral de um reprovisionamento seria o oposto de §8.
2. Acrescentar respeita a POSSE do D-35: membro `criada` cuja automação já
   nasceu em outra instalação viva é recusado com **erro legível**, em vez de
   deixar o índice parcial estourar um `SqliteError` cru.
3. A idempotência continua vindo **depois** da validação, de propósito: pedido
   que se contradiz é recusado em qualquer estado do banco.

**`reconciled_at` entrou por migração NOVA (`014_reconciliacao_de_pacotes.sql`),
não editando a 013.** `rodarMigrations` (`db.js:63`) faz
`if (aplicada.get(version)) return`, e `schema_migrations` nesta máquina já
guarda a versão 13: **editar o arquivo aplicado não acrescentaria coluna em
banco nenhum**, em silêncio. A coluna existe porque sem ela "o registro nasceu
assim" e "o registro foi reparado" ficam indistinguíveis, e quem auditar uma
recuperação não tem a data do reparo.

**Alternativa recusada:** comparar a composição e **lançar conflito** quando ela
diverge. Transformaria o reparo legítimo — o caso que §8 manda testar — em erro,
e deixaria a instalação parcial sem nenhuma saída pelo provisionamento.

**Prova.** Nove checagens novas em `tests/registro-de-pacotes.test.mjs`: a
instalação parcial nasce com dois membros e `reconciled_at IS NULL`; repetir
reconhece a mesma `installation_id`, acrescenta `c` e **data** o reparo; um
pedido menor devolve `ausentes: ["b","c"]` e os três itens **continuam vivos**;
e acrescentar a automação de uma vizinha viva é recusado com
*"já é posse da instalação …"*. A sonda, que antes imprimia o membro perdido,
passou a imprimir `itens = 3` / `a,b,c` / `✅ o membro novo entrou`.

## D-38 — `POST /templates/:id/install` NÃO escreve o registro de pacotes

**Contexto.** O plano do D2-D era ligar `registrarInstalacao` na rota de
instalação de template, que era a única rota de instalação existente.

**Medição que desfez o alvo.** `ls src/engine/server/routes/` lista treze
arquivos e **nenhuma rota de pacote**; `grep -rn "pacote\|package"
src/engine/server/routes/*.js` só acerta dois **comentários** em
`templates.js:86` e `:91`; e `grep -rn "resolverPacote" src/ tests/` encontra a
função apenas em `src/engine/templates/pacotes.js:181` e em
`tests/pacotes-manifesto.test.mjs`. **Nada em produção chama `resolverPacote`.**

**Decisão.** A rota de template instala o fechamento de dependências de **UM**
template; um pacote tem manifesto próprio, `packageId`, `packageVersion` e
`itemKey` por membro. Escrever o registro de pacote de dentro dela registraria
uma instalação de pacote pela camada errada. Então o D2-D passa a ser uma
**rota de provisionamento de pacote**, que ainda não existe:
`carregarPacotes`/`resolverPacote` → `classificarOrdem` → `decidirProvisionamento`
(409 com o motivo membro por membro se algo bloqueia) → publicar os `novo` e
republicar os `despublicado` → **UM** `registrarInstalacao` com todos os membros
resolvidos, tudo dentro de uma `db.transaction`. O escopo que ela passa é
`escopoDoMotor()` → `{ kind: 'engine', id: 'engine' }` até o D2-A existir —
nunca `body.scope`, que é filtro de conversa.

O retorno de `resolverPacote` — `{ packageId, packageVersion, name, membros,
conexoesExigidas }`, cada membro `{ itemKey, templateId, templateVersion, origem,
contentHash, conexoesExigidas }` — é exatamente a forma que `membros` espera.

**E a rota de template não ganha `kind: 'pacote'` por atalho:** um template não
tem `packageId`, `prepararEscolha` lançaria, e inventar proveniência é
justamente o que o D-29 e o D-32 proíbem.

**Origem.** O ponto é do Gemini (agy perfil2, `gemini-3.8-flash-high`), numa
pergunta que eu não fiz. Foi aceito **pela medição acima**, não pela afirmação:
na mesma resposta ele repetiu uma cadeia que eu já havia medido falsa — ligar
`initial_revision_id = null` a `naoVerificavel` e daí ao `BLOQUEIAM` de
`provisionamento.js:39`, quando `estadoDosItens` devolve o campo
**`personalizacao`** e `BLOQUEIAM` filtra o campo **`estado`**. Campos
diferentes; a cadeia não existe.

## D-39 — O `binding` de um membro cuja automação já existe é POSSE REGISTRADA, não proveniência

**Contexto.** Ao provisionar um pacote, um membro pode já existir no banco: estado
`instalado` (está no ar como o template manda) ou `despublicado` (foi tirado do ar).
O registro de §8 grava, para cada membro, um `binding` — `criada` quando aquele
pacote criou a automação, `compartilhada` quando apenas a adotou, `avulsa` quando ela
saiu da governança do pacote. A pergunta era qual dos dois dar a um membro que já
existe.

**Duas IAs consultadas DIVERGIRAM, e nenhuma das duas havia rodado o caso.** O
ChatGPT web (conta Plus, esforço Alta): `initialRevisionId: null` e sem `criada`,
porque *"republicar não significa criar uma revisão inicial"* e *"não classifique
automaticamente como criada apenas porque a proveniência aponta para o mesmo
template"*. O Gemini via `agy` perfil2 (`gemini-3.8-flash-high`): `criada` com a
revisão que a republicação acabou de ativar, prevendo que `compartilhada` faria
`planejarRemocao` tratar o item como `naoNasceuAqui` para sempre.

**Medição, por sonda** (`probe-binding.mjs`, sobre `abrirBanco(':memory:')`: instala
`a` como `criada`, chama `marcarRemovida`, reinstala em dois bancos limpos):

```
reinstalado como "compartilhada" -> {"aRemover":[],"aSoltar":[{… "motivo":"naoNasceuAqui"}]}
reinstalado como "criada"        -> {"aRemover":[{…}],"aSoltar":[]}
```

**O defeito previsto pelo Gemini é real**, e o motivo é concreto: `planejarRemocao`
abre com `if (item.binding !== 'criada') { aSoltar.push({ ...item, motivo:
'naoNasceuAqui' }); continue }`. Um `binding` errado na reinstalação faz a automação
nunca mais ser removível pelo pacote que a criou. **E o princípio do ChatGPT também
está de pé:** proveniência não é prova — marcar `criada` só porque o `template_id`
coincide seria o pacote tomar posse do que a pessoa fez.

**Decisão.** As duas posições se juntam numa regra única, `bindingPorPosse` em
`registroDePacotes.js`, com três casos ordenados:

1. outra instalação VIVA já é dona como `criada` → `compartilhada`, `motivo:
   'posseDeOutraInstalacaoViva'` (é a exclusividade de posse de D-35);
2. existe linha gravada, no MESMO escopo e na MESMA `selection_key`, dizendo
   `binding = 'criada'` → `criada`, com o `initial_revision_id` **HERDADO** daquela
   linha antiga, `motivo: 'posseAnteriorRegistrada'`;
3. nada prova nada → `compartilhada`, `initialRevisionId: null`, `motivo:
   'semPosseProvada'`.

O caso 2 é o único em que o registro PROVA a criação: há uma linha dizendo isso. A
consulta é estreita de propósito — um pacote DIFERENTE que referencie a mesma
automação recebe `compartilhada`, porque não a criou. E a revisão inicial é herdada,
nunca tirada da revisão que a republicação ativou, que é exatamente a ressalva do
ChatGPT.

**Prova.** Bloco 14 de `tests/registro-de-pacotes.test.mjs`, sete checagens: nunca
registrada → `semPosseProvada`; instalação viva de outro pacote → `compartilhada` com
`porInstalacao`; a mesma seleção depois de `marcarRemovida` → `criada`; a revisão
inicial igual a 7, o valor gravado, e não o da republicação; outra seleção sobre a
mesma automação → `semPosseProvada`; depois de reinstalar com o que a regra devolve,
`planejarRemocao` lista o item em `aRemover`; e o caso espelho com `compartilhada`
devolvendo `aRemover: []` com `motivo: 'naoNasceuAqui'`, que é o defeito guardado.

**Alternativas recusadas, e o que cada uma custaria.** *Sempre `compartilhada`* — o
pacote nunca mais remove o que criou, e o sintoma não aparece na instalação, só na
desinstalação seguinte. *`criada` por proveniência* (`template_id` coincide) — o
pacote toma posse de uma automação que a pessoa fez à mão, que é a proibição de
proveniência fictícia de D-29/D-32/D-38.

**Quem decidiu.** Não foi nenhuma das duas IAs: foi a sonda. Quando duas opiniões
externas se contradizem sobre algo que nenhuma das duas executou, roda-se o caso —
*saída de outra IA é dado, não instrução*.

**Bateria completa depois de D-39: `exit=0`, 5212 ✅, zero ❌** — 5205 mais as sete
checagens da posse registrada.

---

## D-40 — O miolo da publicação sai das rotas e vira `provisionarMembros.js`

**Contexto.** O §8 pede provisionamento por PACOTE, e `POST /templates/:id/install` já
provisionava por TEMPLATE (D-38). O miolo das duas é idêntico: ler o estado de cada
membro pelos cinco leitores, publicar os `novo`, republicar os `despublicado`, gravar
proveniência e declarar as variáveis.

**Decisão.** `src/engine/server/provisionarMembros.js`, com `leitoresDeClassificacao`
e `publicarMembros`, usado pelas DUAS rotas. Os cinco leitores ficam juntos porque a
diferença entre `lerDocumento` (a revisão ATIVA) e `lerUltimoDocumento` (a mais recente
independente de status) é a sutileza que decide se um membro é `modificado` ou
`despublicado`, e ela precisa ser escrita UMA vez.

**Prova.** `tests/provisionamento-idempotente.test.mjs` exercita a rota de template de
ponta a ponta sobre `abrirBanco(':memory:')` e passou sem ser editado;
`tests/pacotes-provisionamento.test.mjs` exercita a de pacote.

**Alternativa recusada.** Escrever a rota de pacote com o laço próprio e deixar
`templates.js` intacto. Era mais barato AGORA — não mexe em rota que está no ar e
testada — e mais caro depois: dois laços de publicação significam que o dia em que um
deles aprender algo (uma coluna nova, uma guarda nova) o outro continua sem saber, em
silêncio, e a bateria fica verde porque nenhum teste afirma que os dois concordam. É
exatamente a divergência de camadas que este projeto já pagou caro mais de uma vez (o
escopo `local` em metade das camadas; `local` ausente de três listas).

---

## D-41 — `GET /pacotes` declara o que o pacote EXIGE, e o provisionamento diagnostica antes de publicar

**Contexto.** A rota respondia `instalavel: true, motivo: null` para os quatro pacotes
do manifesto, e nenhum deles era provisionável sem que quem chamasse já soubesse
informar `poolId` para cada membro.

**Medição, por sonda:** `{ total: 121, comPool: 121, poolSemPadrao: 121,
outrosSemPadrao: ['responder-com-arquivo:fileId'] }`. Os 121 templates do catálogo
declaram `poolId` e NENHUM tem padrão — `render.js:46` lança quando o valor não vem e a
definição não tem `default`. Não existe campo `required`: parâmetro obrigatório é
`default === undefined`, e a chave é `key`.

**Decisão.** Três peças:

1. `parametrosExigidosDe(membros)` lê o CATÁLOGO e devolve `{ key, tipo, rotulo, ajuda,
   templates[] }` por parâmetro sem padrão, deduplicado por chave e nomeando quais
   templates pedem. `avaliarPacote` passa a devolver `parametrosExigidos`, porque dizer
   só `instalavel: true` é "apresentar uma funcionalidade como disponível" sem dizer do
   que ela depende — o que o §8 proíbe.
2. `parametrosComuns` no corpo do provisionamento, aplicado a todos os membros e
   SOBRESCRITO pelo mapa por template. `poolId` é o mesmo para os onze membros do
   pacote de administração, e obrigar o painel a repetir o valor template por template
   transformaria uma escolha única em onze. O comum é padrão, não teto.
3. Pré-voo: a resposta diz TUDO que falta de uma vez, em um `400` com
   `detalhes.parametrosFaltando`. `renderizarTemplate` recusa um parâmetro de cada vez,
   do primeiro membro que falha — quem provisiona um pacote de onze comandos
   descobriria a lista em onze tentativas.

A lista sai do catálogo, não de uma segunda tabela escrita à mão: parâmetro novo num
template aparece na resposta sozinho.

**Prova.** `tests/pacotes-provisionamento.test.mjs`, casos 1, 3 e 5: os quatro pacotes
declaram `poolId` com rótulo e ajuda; `administracao` sem parâmetro devolve `400` com
os ONZE membros nomeados numa só resposta; e `parametrosComuns` grava `pool-comum` nas
cinco proveniências do `basico` sem repetição no corpo.

**Alternativa recusada.** Uma tabela de "parâmetros do pacote" no manifesto. Duplicaria
o que o template já declara, e no dia em que um template ganhasse parâmetro novo o
manifesto continuaria calado — a mesma divergência de camadas de D-40.

---

## D-42 — `poolId` é verificado contra a tabela `pools`, não aceito como texto

**Contexto.** O §8 exige, entre os dez testes obrigatórios, "dependência não
configurada". `poolId` não é texto livre: é a chave de uma linha em `pools`
(`001_init.sql:16`, servida por `routes/pools.js`).

**Decisão.** Antes de publicar, todo `poolId` pedido é conferido com
`SELECT 1 FROM pools WHERE id = ?`, e um ausente devolve `409 Pool não cadastrado:
<id>. Crie o pool na aba Pools antes de provisionar.` com `detalhes.poolsAusentes`.

**Prova.** `tests/pacotes-provisionamento.test.mjs`, caso 4: `409`, o pool nomeado nos
detalhes, e ZERO automações publicadas. Caso 5 prova o contrário — com o pool criado,
os cinco membros do `basico` vão ao ar.

**Por que não bastava validar formato.** Aceitar um pool inexistente publicaria cinco
comandos que nunca respondem, e o sintoma apareceria no WhatsApp, não na resposta da
API. Validação de forma no lugar de verificação de dependência é a mesma classe de
problema que "validação no frontend como controle de segurança", proibida no §23.

**Detalhe que a sonda pegou de passagem.** A minha mensagem dizia "aba Automações" e os
templates dizem "aba Pools" — ver o texto do `ajuda` do catálogo e o meu `409` lado a
lado na mesma saída. Mandar alguém para a aba errada é o mesmo defeito que o pré-voo
inteiro existe para consertar. Corrigido.

---

**Bateria completa depois de D-42: `exit=0`, 5242 ✅, zero ❌** — 5212 mais as trinta
checagens de `tests/pacotes-provisionamento.test.mjs` (as cinco últimas vêm de rotas que
nunca tinham sido executadas: `GET /pacotes/provisionamento` e
`DELETE /pacotes/provisionamento/:installationId`).

---

## D-43 — O estado de uma automação instalada tem DOIS eixos, não um

**Contexto.** O §8 exige que automação inativa ou incompatível tenha estado visível e
explicado. A listagem tinha um estado só, e a medição mostrou falso negativo: uma
automação desligada, em sombra ou despublicada continuava descrita como "exatamente
como o provisionamento a deixou", e uma edição publicada não aparecia em lugar nenhum.

**Decisão.** `estadoDosItens` devolve `atividade` (`ausente`, `despublicada`,
`desligada`, `sombra`, `noAr`) e `personalizacao` (`comoInstalada`, `editada`,
`naoVerificavel`). São perguntas independentes: desligar, pôr em sombra ou despublicar
muda a primeira e NÃO a segunda; editar e publicar muda a segunda e deixa a primeira em
`noAr`. `personalizacaoDe` compara a revisão mais recente (`ultima ?? ativa`) com
`initial_revision_id`; sem ele, `naoVerificavel`.

**Prova.** `tests/registro-de-pacotes.test.mjs` bloco 10 (unidade) e
`tests/pacotes-provisionamento.test.mjs` bloco 7c (rota real, `noAr/comoInstalada` →
`desligada` → `sombra` → `despublicada` → republicada → editada).

**Alternativa recusada: hash canônico do documento instalado** (sugestão do ChatGPT web).
Verificado por execução que o caso que ela teme não ocorre aqui: salvar rascunho sem
publicar já dá `editada` (a revisão-rascunho tem id diferente do inicial) e salvar de novo
no mesmo rascunho mantém uma linha só. `enabled` e `deployment_mode` não criam revisão,
mas já aparecem no eixo `atividade`. O hash ficaria como reforço se um dia a revisão
inicial puder ser editada no lugar, o que hoje só acontece com revisão em `draft`.

## D-44 — Remover um pacote nunca despublica o que não é dele (dois buracos fechados)

**Contexto.** `package_installation_items` não tem FK para `automations`, de propósito
(preserva o histórico). Consequência dupla, ambas PROVADAS por execução antes do conserto.

**Buraco 1 — automação apagada por fora.** `DELETE /automations/:id` apaga a linha e o
item continua vivo. `planejarRemocao` o mandava a `aRemover`; `despublicar` lançava 404
dentro da `db.transaction` e a instalação nunca saía do estado. Conserto: item cuja
automação não existe vai para `aSoltar` com `motivo: 'automacaoJaNaoExiste'`.

**Buraco 2 — id reaproveitado (apontado pelo ChatGPT web, confirmado por mim).** Apagar
`config-menu`, outra pessoa criar e publicar uma automação nova com o mesmo id, e então
remover o pacote despublicava a automação NOVA: existir bastava. Conserto: a revisão
inicial registrada na instalação precisa ainda pertencer àquele id
(`automation_revisions.id` é AUTOINCREMENT e nada apaga revisões, então ela identifica a
geração). Se não pertence, o item é solto com `motivo: 'outraAutomacaoComOMesmoId'`.
**Limite declarado:** item sem `initial_revision_id` (membro adotado, instalação antiga)
não tem o que comparar e mantém o comportamento anterior.

**Corrida descartada.** O ChatGPT levantou TOCTOU entre consulta e despublicação; não
procede: `remover` é `db.transaction` síncrona do better-sqlite3 e `planejarRemocao` roda
dentro dela.

**Por que sem bucket novo.** `aSoltar` já tem `motivo`, e a resposta da rota já o repassa.
`liberarItemOrfao` continua fora de qualquer rota: soltar o item já fecha a instalação.

**Prova.** Blocos 7b (órfã) e 7e (id reaproveitado) da rota real. Cada um foi visto
FALHAR com o conserto desligado (7e: 3 ❌) e passar com ele.

## D-45 — "Instalação parcial" é provada pela atomicidade, plantando a falha no último passo

**Contexto.** A instalação inteira roda em UMA `db.transaction` (`routes/pacotes.js`),
então um estado parcial não existe por construção; o que tem conteúdo é provar o rollback.
ChatGPT e Gemini concordaram nisso, por caminhos diferentes (gatilho `RAISE(ABORT)` e nó
não suportado no último membro, respectivamente).

**Decisão.** Teste 7d: gatilho `BEFORE INSERT ON package_installations` com
`WHEN (SELECT COUNT(*) FROM automations) = 5`. O gatilho só dispara depois de os cinco
membros estarem publicados dentro da transação, e a mensagem do erro carrega essa
condição — é o que impede o teste de ser vazio (um pré-voo que recusasse antes de
escrever nada passaria sem provar nada). Conferido: zero linhas nas sete tabelas
(`automations`, `automation_revisions`, proveniência, `automation_scopes`,
`declared_variables`, `package_installations`, `package_installation_items`), listagem
vazia, e, removido o gatilho, a reinstalação instala os cinco sem sobra.

**Prova de que detecta.** Com a transação trocada por função comum, o teste falha (5
automações órfãs, 3 ❌); restaurada, passa.

**Limite.** Banco em memória: não prova sobrevivência a morte do processo no meio do
commit. O ChatGPT propôs fechar e reabrir um banco em arquivo; fica como reforço, não
como lacuna do §8.

**Bateria completa depois de D-45: `exit=0`, 5277 ✅, zero ❌.**

## D-46 — Reconfigurar um template instalado nunca destrói rascunho pendente nem edição publicada sem confirmação

**Contexto.** O Gemini levantou três pontos sobre a atualização de template. Conferidos por sonda:
(3.1) rascunho não publicado é apagado — inofensivo no provisionamento (que recusa quando há
divergência), mas **real no reconfigurar**: `reconfigurar` faz `salvarRascunho` + `publicar`, e
`salvarRascunho` regrava a mesma linha se a última revisão já é `draft`, então a edição pendente
virava a ativa com o conteúdo do template. (3.3) `PUT /automations/:id/reconfigure` com a
versão do template diferente da instalada aplicava SEM confirmar, substituindo a edição à mão
(só o GET avisava). (3.2) `FORA_DO_TEMPLATE = ['id','revision','scope']` não é falha: o escopo é
escolhido na instalação e `aplicarValores` o preserva — intencional.

**Decisão.** (A) `analisarReconfiguracao` recebe `rascunhoPendente`; havendo rascunho, o
formulário fecha com o motivo "publique ou descarte" e o PUT dá 409, mesmo com confirmação.
(B) `analisarReconfiguracao` devolve `exigeConfirmacao` quando a versão difere E há divergência;
o servidor só aplica com `"confirmo": true` (409 sem ele); o painel mostra a caixa de
confirmação. A confirmação é do SERVIDOR: validação de tela não é controle suficiente (§23).

**Prova de que detecta.** Sem `exigeConfirmacao` no servidor: 2 ❌ (409 vira `undefined`, a
edição à mão some). Sem `rascunhoPendente`: 4 ❌. Restaurados, `tests/engine-reconfigurar.test.mjs`
passa inteiro.

**Limite.** A checagem de rascunho olha a última revisão no banco; não cobre dois painéis
abertos salvando ao mesmo tempo (a transação serializa, o segundo recebe 409).

**Bateria completa depois de D-46: `exit=0`, 5284 ✅, zero ❌.**

## Consultas externas desta rodada

ChatGPT web (conta logada, esforço High) sobre os três pontos acima; Gemini (agy) sobre o
desenho do teste de atomicidade. As respostas foram tratadas como dados: cada afirmação
usada foi reproduzida por comando antes de virar código. O ChatGPT avisou que só lia a
`v3` publicada, sem `registroDePacotes.js` nem a migração 013, então seus pontos sobre o
registro novo eram inferência; o do id reaproveitado foi o único que procedeu.
