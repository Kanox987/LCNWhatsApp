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
