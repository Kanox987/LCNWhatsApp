# Frente C — o menu deixou de ser privilegiado

O pedido (§7): *"Menu não deve ser obrigatório nem possuir privilégios
arquiteturais desnecessários."* O dono tem de poder instalar um menu pronto,
editá-lo em `.lcn`, construir outro do zero, trocar o comando que o abre,
desativá-lo, removê-lo, e rodar a instância **sem menu nenhum**.

E, no fim: *"Se alguma função da aba Menu não puder ser representada em `.lcn`,
registre a lacuna e não a elimine silenciosamente."* Este documento é esse
registro.

## O que o privilégio era, e onde ele morava

Antes desta frente, o menu era uma automação semeada no arranque com a coluna
`native = 1` em `automations`, por `src/engine/server/nativeAutomations.js`
(removido). Isso lhe dava cinco coisas que nenhuma automação do painel tem:

| privilégio | onde estava | estado |
|---|---|---|
| escopo ignorado no avaliador | `evaluator.js` | **removido** |
| pool reservado `__native__` | semeadura | **vira pool comum `padrao`** |
| ausência das três rotas de listagem (não editável pelo painel) | `routes/automations.js` | **removido** — o menu aparece em `GET /automations` |
| palavra do gatilho fora da checagem de conflito | `conflitos.js` | **removido** — dois comandos com a mesma palavra são conflito de verdade |
| ressurreição a cada arranque | `nativeAutomations.js` | **removido** — marcador `menu_padrao_semeadura` (migração `012`) |

`grep -n "native" src/engine/server/evaluator.js` não devolve nada. A coluna
`native` continua existindo (migração `007`, não se apaga migração), e o único
`__native__` que resta no painel é a lógica de **pool** reservado, que é outra
coisa.

## O que o menu é agora

O template `menu` do catálogo (`src/engine/templates/catalog/menu.lcn`, v2),
instalado como automação comum, pelo mesmo
`POST /templates/menu/install` que qualquer outro template do painel usa.

**Instância nova não ganha menu nenhum.** A primeira versão desta frente
semeava o menu em todo banco recém-criado, e isso tornava impossível o primeiro
requisito da frente D — "uma instância deve poder começar completamente vazia".
Hoje `src/engine/server/menuPadrao.js` exporta `migrarMenuLegado`, que só faz
duas coisas na abertura do banco: garante um pool comum (pool é infraestrutura;
sem nenhum pool nada é instalável, porque `responder.poolId` é obrigatório no
schema) e **converte** o `__native_menu__` de quem já tinha menu nativo. Quem
quer menu instala o template — pelo painel, ou pelo pacote escolhido no
provisionamento.

O marcador em `menu_padrao_semeadura` continua gravado nos dois casos, com
`automation_id` NULO quando nada foi semeado. É o que faz a remoção sobreviver
ao reinício e impede que uma versão futura leia "não tem menu" como "nunca
passou por aqui".

Quando o menu é instalado pelo painel, quem instala escolhe o escopo na tela —
e escopo vazio não significa "em tudo" (`escopoCasa` recusa, e o menu ficaria
mudo em toda conversa). A conversão do menu legado preenche `em todo lugar`
quando o documento antigo vinha com escopo vazio, porque era isso que o bypass
de `native` fazia de fato.

## Os dez testes obrigatórios do §7

`tests/menu-padrao.test.mjs` — **32 checagens, zero falhas**, na cadeia do
`npm test`. Substitui `tests/engine-native-automations.test.mjs`, cujas duas
afirmações foram **invertidas e preservadas**, não apagadas:

| antes | agora |
|---|---|
| `coluna native marca a automação corretamente` (`native === 1`) | `o menu nasce como automação comum` (`native === 0`) |
| `GET /automations NUNCA inclui a automação nativa` | `GET /automations INCLUI o menu (é editável pelo painel comum)` |

| # | cenário | o que o teste faz |
|---|---|---|
| 1 | instalar menu padrão | semeia e confere `native=0`, pool comum, presença em `GET /automations`, e `/menu` respondendo |
| 2 | editar | descompila o menu ativo para `.lcn`, muda o cabeçalho, republica, confere o texto novo no ar |
| 3 | criar menu alternativo | clona o documento, **reescreve `doc.id`**, publica como `meu-menu`, confere que os dois respondem pelas próprias palavras |
| 4 | alterar gatilho | troca `/menu` por `/ajuda`; `/menu` deixa de casar |
| 5 | desativar | `automations.enabled = 0` e o menu fica mudo |
| 6 | remover | a rota comum `DELETE /automations/:id` apaga (`{"removed":true}`) e a linha sai do banco |
| 7 | não possuir menu | nenhuma automação com `action.menu.render` sobra, e `/menu` não casa com nada |
| 8 | migrar menu antigo | forja o estado legado por SQL cru (`native=1`, pool `__native__`, escopo vazio, nome com `(nativo)`) e confere que `converterMenuNativo` tira o privilégio **preservando a exclusão do dono** |
| 9 | reiniciar | segunda passada idempotente; a edição do dono sobrevive; o menu removido **não ressuscita** |
| 10 | conflitos de comando | `conflitosDeComando` devolve `[]` ao instalar |

## A lacuna que o §7 manda registrar

Fui atrás dela supondo que estava nos campos do `mostra menu`: o schema e
`src/engine/server/menuConfig.js` carregam **seis** (`format`, `header`,
`footer`, `emptyText`, `buttonTitle`, `numbered`) e o template `menu.lcn` escreve
só três. **A suposição estava errada**, e desfaço: o template não usar um campo
não é a linguagem não ter palavra para ele. `src/lcn/vocabulario.js:475-484`
declara os seis, com as palavras `numeração`, `formato`, `cabeçalho`, `rodapé`,
`vazio` e `botão`, e a ida e volta fecha nos seis — medido, não suposto:

```
  mostra menu
    numeração: false
    formato: com botões
    cabeçalho: "Comandos disponíveis:"
    rodapé: "rodapé de teste"
    vazio: "Nenhum comando disponível por aqui ainda."
    botão: "Abrir lista"
```

`compilar(descompilar(doc))` devolve os seis valores idênticos (só a ordem das
chaves difere, que é indiferente). **Não há lacuna no `mostra menu`.**

A lacuna real era mais estreita, e **está fechada** (ver "A aba Menu saiu",
abaixo):

### `configura menu` não alcançava a numeração — FECHADA

`action.menu.config` existe para o dono trocar o menu **de dentro do WhatsApp**,
por comando. O `field` dele era um enum de **cinco** valores no schema
(`definitions/actionMenuConfig`): `header`, `footer`, `emptyText`,
`buttonTitle`, `format`, e `src/lcn/vocabulario.js` espelhava os mesmos cinco,
enquanto `limpar()` em `menuConfig.js` aceitava `numbered` e só a aba Menu do
painel mexia nele.

Agora o enum tem também `numbered` (palavra `numeração`), `families`
(`famílias`) e `reset` (`volta ao padrão`), e há um campo opcional `target`
(`onde vale`: `nesta conversa`, `todos os grupos`, `todo o privado`). Os cinco
valores antigos continuam válidos, então documento guardado não muda. O
avaliador lê a numeração com `lerNumeracao()` (sim/não, liga/desliga, 1/0) e
responde explicando quando o valor não é reconhecido.

### Por conversa e por tipo de conversa

O menu é configurado **por conversa** e **por tipo de conversa** (todos os
grupos / todo o privado), guardado em `entity_attributes` sob
`__menu_config__`, `__menu_default_group__` e `__menu_default_direct__`. O
`.lcn` não declara esse valor de forma estática, e **não deveria**: é dado de
execução por conversa, do mesmo tipo que uma variável, não estrutura de
automação. O caminho é o `configura menu`, que grava exatamente aquela linha —
na conversa onde o comando foi enviado (o padrão) ou, com `onde vale`, no
padrão de todos os grupos ou de todo o privado. Para valores fixos por
conversa, usam-se dois menus com `onde:` diferentes.

A cascata, do mais específico para o mais geral (`menuConfig.js:66`), é
`PADRAO → nó do documento → padrão do tipo → aquela conversa`. Conferi a
suspeita de que a ordem estivesse invertida: **não está**, o mais específico é o
último do spread e por isso ganha.

## Três mudanças de comportamento aceitas de propósito

Nenhuma é defeito, e cada uma tem teste que a fixa:

1. **O menu lista a si mesmo.** Sem o privilégio, `/menu` é um comando como
   outro e aparece na própria lista. É honesto, e quem não quiser escreve
   `menu: não` na automação — a primitiva de esconder nasceu nesta frente, nas
   cinco camadas (schema `menuHidden`, `vocabulario.js`, `compilar`,
   `descompilar`, avaliador). Antes disso era impossível: o avaliador fazia
   `menuLabel || trigger.config.command`, então o rótulo vazio caía no comando e
   a automação reaparecia.
2. **Dois comandos com a mesma palavra são conflito.** `conflitos.js` deixou de
   filtrar o menu, então a tela passa a acusar o que antes escondia.
3. **Menu sem nada a mostrar e com `vazio` em branco fica calado.** Era o
   caminho de mensagem vazia; agora é silêncio explícito.

## O que esta frente consertou sem estar no pedido

- **A ressurreição.** O menu removido voltava a cada arranque. É o que a
  migração `012` e o marcador resolvem.
- **O salvamento em bloco do painel** (histórico; a aba saiu depois). A aba
  Menu gravava os seis campos sempre, então quem mudasse só o formato zerava os
  quatro textos. Foi consertado na época; `''` continua sendo valor legítimo
  guardado, de propósito — e hoje o comando chega nele com `em branco` (ou
  aspas vazias).
- **O controle de numeração ausente** na aba (histórico), que o motor sempre
  aceitou. Hoje a numeração é pelo `configura menu`.

## A aba Menu saiu

O menu é uma automação comum (o comando `/menu`, que aparece em Automações),
então a aba própria virou redundante e foi retirada:

- o link "☰ Menu" saiu da navegação (`src/web/public/index.html`);
- `src/web/public/pages/menu-config.js` foi apagado;
- quem abrir `/menu` (favorito antigo) é levado para `/automations`, trocando o
  endereço no histórico (`main.js`, `replace: true`);
- a gravação pelo painel saiu: o BFF não repassa `PUT /menu-config`, e mudar o
  menu é só pelo comando;
- **ver e apagar voltaram**, na aba Dados de cada conversa (seção "Menu nesta
  conversa"): o BFF repassa só `GET /api/v1/menu-config/effective` e
  `DELETE /api/v1/menu-config/:kind`, com `menuConfig.effective/removeOwn` em
  `src/web/public/api.js` e `menu.efetivo/apagar` em `src/engine/client.js`.
  Ver serve para conferir o resultado sem mandar `/menu` num grupo (o que
  publicaria o menu para todo mundo); apagar serve para conversa onde o
  comando não roda mais (o bot saiu do grupo, id errado), já que a chave é
  reservada e a lista de variáveis não a apaga. A mesma seção mostra o padrão
  de todos os grupos / todo o privado (ou "Nada configurado neste nível") com
  o botão de apagá-lo (`menuConfig.removeDefault`), e cada linha do "Como sai
  aqui" diz de onde o valor veio: desta conversa, do padrão do tipo, do
  comando de menu ou padrão do sistema. A aba Dados também abre uma
  conversa pelo número ou id, para quem não aparece mais na busca;
- `GET /menu-config/effective` do motor passou a trazer, além da cascata de
  sempre (`config`), a configuração própria (`propria`), o padrão do tipo
  (`padraoDoTipo`), se o bot está ativo no grupo (`grupoAtivo`) e uma entrada
  por automação de menu no ar **que responde naquela conversa** (`menus`): o
  escopo da automação precisa casar e ela não pode estar desligada ali — as
  mesmas perguntas do avaliador (`automacaoRespondeNaConversa`). Cada entrada
  traz o menu já com a cascata (`config`) e o que o documento dela define
  (`doDocumento`);
- as rotas do motor (`src/engine/server/routes/menu.js`) **ficaram**, como API
  do motor, inclusive o PUT.

O que a aba fazia, e como se faz agora:

| Na aba | Pelo comando (`configura menu`) |
|---|---|
| cabeçalho, rodapé, texto de vazio, título do botão, formato | `campo: cabeçalho` etc. (já existia) |
| formato texto / com botões | `campo: formato`, argumento `texto` ou `com botões` (os códigos `text`/`interactive` também valem) |
| texto em branco | argumento `em branco` (ou `""`); no texto de vazio, deixa o `/menu` mudo |
| "Herdar" em um campo só | argumento `herdar`: tira só aquele campo; se era o último, a linha sai do banco |
| numeração liga/desliga | `campo: numeração`, argumento sim/não |
| famílias mostradas | `campo: famílias`, argumento com as famílias (`todas` desfaz a restrição de cima; `herdar` volta a segui-la) |
| padrão de todos os grupos / todo o privado | `onde vale: todos os grupos` / `todo o privado` |
| voltar ao padrão (apagar a config) | `campo: volta ao padrão` (não precisa de argumento); o padrão de todos os grupos / todo o privado também se apaga pelo botão na aba Dados |
| configurar a conversa X | enviar o comando dentro da conversa X, ou `onde vale: outra conversa` com o número ou id de X logo depois do comando (nada é enviado em X) |
| apagar a config de conversa onde o bot não está | `volta ao padrão` com `onde vale: outra conversa`, ou o botão na aba Dados |
| prévia do menu efetivo | aba Dados → a conversa → "Menu nesta conversa" |

Para quem instala pelo catálogo, o template `config-menu` (v2) pergunta o que o
comando muda (`campo`, inclusive formato, numeração, famílias e volta ao
padrão) e onde vale (`ondeVale`, inclusive outra conversa). Sem `como usar`
fixo, o motor explica o que escrever conforme o campo.

## Prova

Frente original: `npm test` → 5077 checagens, zero falhas (linha de base 5046),
com `migrations/012_menu_padrao.sql`, `menuPadrao.js`,
`tests/menu-padrao.test.mjs`, `tests/cabecalho-sem-linha-vazia.test.mjs` e as
edições em `evaluator.js`, `conflitos.js`, `db.js`, `automationsService.js`,
`routes/automations.js`, schema e `src/lcn/`.

Fechamento da lacuna e saída da aba: `npm test` → **6347 checagens, zero
falhas** (linha de base 6296). Teste novo `tests/menu-configura-por-comando.test.mjs`
(`.lcn` → automação → execução → numeração mudada, ida e volta
compilar/descompilar, documentos antigos válidos, famílias, padrão por tipo,
volta ao padrão); `tests/painel-donos-e-menu.test.mjs` passou a conferir que a
aba, o link e as rotas do BFF sumiram e que `/menu` redireciona.

Revisão (herdar por campo, em branco, formato por palavra, outra conversa,
template v2, ver e apagar na aba Dados): `tests/menu-configura-por-comando.test.mjs`
foi a 132 checagens e `tests/painel-donos-e-menu.test.mjs` passou a conferir a
corrente de ver/apagar e a ausência do PUT no BFF. `npm test` → **6435
checagens, zero falhas**.
