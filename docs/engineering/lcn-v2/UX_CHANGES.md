# Mudanças de interface — parte E

Parte **E** das doze do `FINAL_REPORT.md`. Registra o que mudou na tela nesta
onda, por quê, e o que **não** mudou de propósito.

Medido por `git diff --numstat` na `v3`:

| arquivo | linhas |
|---|---|
| `src/web/public/pages/instance.js` | +51 / −1 |
| `src/web/public/logic/optimization.js` | +33 |
| `src/web/public/styles.css` | +16 |
| `src/web/router.js` | +4 |
| `tests/web-ui-logic.test.mjs` | +24 / −1 |

Uma mudança só, e ela é a entrega visível da frente E.

---

## 1. O defeito: a tela buscava os limites e os jogava fora

Antes desta onda, `obterOtimizacao` já devolvia um campo `limites` com **nove
informações por parâmetro**: valor configurado, limite permitido, o que está em
vigor, de onde o limite vem, o que o campo significa, o que ele faz, e por que
um valor não está disponível.

**A tela não mostrava nenhuma delas.** Mostrava quatro caixas editáveis com o
valor que o cliente escolheu.

A consequência é o motivo pelo qual isto era obrigatório e não cosmético:

> quem tivesse uma **cota reduzida** veria o número **dele** na caixa e
> acreditaria que aquilo estava valendo.

Reduzir uma concessão **não** reescreve o `config.json` do cliente — de
propósito, para que a escolha dele volte a valer se a cota for devolvida. Então
`configurado` e `emVigor` divergem por desenho. Divergência sem explicação na
tela é exatamente a reclamação que o pedido manda evitar.

## 2. O que a tela mostra agora

Um painel novo, **"Limites desta instância"**, com a linha de apoio *"O que você
escolheu, o que o administrador permite e o que está valendo agora."* Por campo:

| elemento | o que diz |
|---|---|
| cabeça | o rótulo e, à direita, **o que está em vigor** |
| sentido | `significado` + `efeito` — o que o campo é e o que ele faz |
| quatro números | *Você escolheu* (ou **"Padrão, ninguém mudou"**), *Permitido*, *Padrão*, *Fonte do limite* |
| aviso de divergência | só quando há divergência |
| aviso de provedor | só quando o teto não é nosso |

Três decisões dentro disso, cada uma consertando uma forma de a tela mentir:

**"Padrão, ninguém mudou" em vez de repetir o número.** O rótulo do primeiro
número muda conforme `foiEscolhido`. Sem isso, um padrão de fábrica aparece como
escolha do cliente.

**"sem teto do administrador" em vez de um número.** Quando `temConcessao` é
falso, não existe limite para exibir, e preencher o campo com o próprio valor
configurado afirmaria um teto que ninguém pôs.

**"não escolhido" nunca vira "sem limite".** `formatarValorDeLimite` trata
ausente antes de qualquer unidade, porque **zero em banda significa sem
limite** — então campo em branco exibido como zero inverteria o sentido.

### O texto de divergência

`explicarDivergencia` devolve `null` quando não há nada a explicar, e, quando
há, a frase inteira:

> Você escolheu X; vale Y. \<por que\>. **Sua escolha continua guardada e volta a
> valer se o limite subir.**

A última oração é a parte que importa: sem ela, o cliente vê o número dele
ignorado e conclui que foi apagado.

### O aviso que impede o administrador de se enganar

O teto do administrador viaja **por ambiente** até a instância
(`src/instances/quadlet.js`), e ambiente só é lido quando o processo **nasce**.
Então mudar a concessão de uma instância **ligada** não muda nada até ela
reiniciar. A tela diz isso, e só quando há concessão:

> Os limites do administrador chegam na instância quando ela liga. Mudança de
> concessão só passa a valer depois de reiniciar a instância.

É o que impede o administrador de baixar uma cota, ver o número novo na tela e
achar que já está valendo.

### O teto que não é nosso

Quando `limiteDoProvedor` está marcado:

> O WhatsApp também impõe um teto próprio aqui; subir este número não passa do
> que ele aceita.

Isto cumpre a regra do dono — *padrão sensato sim, teto no código não* — sem
prometer o impossível: o administrador manda no limite **dele**, e a tela diz
quando o limite é de fora.

## 3. Onde a formatação mora, e por quê

As três unidades (bytes por segundo, MB, contagem) são formatadas em
`src/web/public/logic/optimization.js`, não na marcação. Razão escrita no
próprio arquivo: formatar na marcação repetiria a regra de unidade em três
lugares; ali é **um lugar só, e testável em Node puro** — e é o que permite as
24 checagens novas em `tests/web-ui-logic.test.mjs`.

`formatarValorDeLimite` também trata **lista**: num campo de opções o
"permitido" é a lista liberada, não um número, e vazio é *"nenhuma opção
liberada"*, não `0`.

## 4. O CSS, e a única razão dele

Dezesseis linhas. Cada linha de limite carrega quatro números de **unidades
diferentes**; a grade existe para eles não virarem parágrafo.
`font-variant-numeric: tabular-nums` nos valores, para que colunas de dígitos
alinhem. Abaixo de 720 px a grade de duas colunas vira uma. Nenhuma cor nova,
nenhuma fonte nova — tudo pelos tokens que já existem (`--border`,
`--text-muted`, `--text`).

## 5. As rotas novas

```
GET  /api/v1/instances/:id/grants
PUT  /api/v1/instances/:id/grants
```

As concessões moram no **registro**, fora da pasta da instância
(`src/agent/concessoes.js`) — a instância não pode editar o próprio teto, e é
por isso que o arquivo não fica com ela.

## 6. O que NÃO mudou, de propósito

| item | por quê |
|---|---|
| as quatro caixas editáveis | continuam. O painel novo **explica**; não substitui a edição |
| a tela de pareamento | já estava correta na `onda1`. A validação dela é mais **frouxa** que a do backend, que é a direção segura — ver `SECURITY_REVIEW.md` §7 |
| nenhuma tela de login | o painel não tem autenticação. A metade anti-elevação da frente E depende disso e está na parte **J** |
| `casa` e `Pool` | o nome de nenhum dos dois foi trocado. `casa` está investigado e tem proposta com mapa de consequências em `LCN_UX_AUDIT.md` §1, **não aplicada**; `Pool` segue sem investigação |
| nenhum valor de credencial na tela | regra do dono: **credencial se escreve pelo painel e nunca se lê** |

## 7. Pendências de interface

| # | o que falta | por quê não foi feito |
|---|---|---|
| 1 | tela de concessões para o administrador | as rotas existem; a tela que as usa, não. O administrador configura por `PUT` hoje |
| 2 | renomear `casa` | a proposta e as consequências estão medidas em `LCN_UX_AUDIT.md` §1.8-1.9. A etapa 1 (explicar o nome na ajuda) está feita; a etapa 2 (aceitar e emitir o nome novo) **espera autorização do dono**, porque muda o texto que o descompilador entrega |
| 3 | ajuda contextual com os 14 campos por função | montada e medida: `LCN_UX_AUDIT.md` §3. Falta a `description` de **46 dos 154 campos** de ação no schema, que é o que deixa a explicação técnica vazia |
| 4 | dizer na tela que o pareamento tem intervalo mínimo | o intervalo não existe ainda (`SECURITY_REVIEW.md` §5) |
| 5 | investigar `Pool` | frente B. `LCN_UX_AUDIT.md` §2 está aberta esperando a medição |

Nada nesta onda alterou tela de produção: o trabalho está na branch `v3`, sem
commit e sem implantação.
