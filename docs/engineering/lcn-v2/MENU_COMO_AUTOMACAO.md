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
instalado como automação comum. O boot semeia uma vez
(`src/engine/server/menuPadrao.js`, `garantirMenuPadrao`) e nunca mais: o
marcador em `menu_padrao_semeadura` é o que faz a remoção sobreviver ao
reinício.

O documento semeado é escrito **em linha** (`documentoDoMenu()`) em vez de ler
o catálogo, porque `carregarCatalogo()` custa ~63 ms e isso rodaria a cada
`abrirBanco()`. A guarda contra defasagem entre os dois não é confiança: é
`tests/menu-padrao.test.mjs`, que renderiza o template de verdade e exige
documento idêntico.

A única diferença legítima entre os dois é o `scope`, e é de propósito: nenhum
dos 121 templates declara `onde:` — quem instala pelo painel escolhe o escopo na
tela, e o menu semeado, que não passa por essa tela, nasce com
`em todo lugar` (escopo vazio não significa "em tudo": `escopoCasa` recusa, e o
menu ficaria mudo em toda conversa).

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

A lacuna real é mais estreita, e é esta:

### `configura menu` não alcança a numeração

`action.menu.config` existe para o dono trocar o menu **de dentro do WhatsApp**,
por comando. O `field` dele é um enum de **cinco** valores no schema
(`definitions/actionMenuConfig`): `header`, `footer`, `emptyText`,
`buttonTitle`, `format`. **`numbered` não está lá**, e
`src/lcn/vocabulario.js:489` espelha os mesmos cinco.

Mas `limpar()` em `menuConfig.js:44` aceita `numbered`, e a aba Menu do painel
ganhou o controle nesta frente (`src/web/public/pages/menu-config.js:71`). Então
**a numeração por conversa é alterável pelo painel e não por comando** — nem com
um `.lcn` escrito à mão, porque a palavra não existe no enum.

Não eliminei: é um valor a mais no enum do schema e no `palavras` do
vocabulário, mais a entrada no avaliador. Fica registrado como lacuna porque
acrescentar enum ao schema mexe na validação de documento guardado, e isso é
mudança de frente J, não de C.

### E uma assimetria que não é lacuna, mas parece

A aba Menu configura o menu **por conversa** e **por tipo de conversa** (todos
os grupos / todo o privado), guardando em `entity_attributes` sob
`__menu_config__`, `__menu_default_group__` e `__menu_default_direct__`. O
`.lcn` não declara isso, e **não deveria**: é dado de execução por conversa, do
mesmo tipo que uma variável, não estrutura de automação. O caminho pelo `.lcn`
existe e é o `configura menu` — que grava exatamente aquela linha
(`evaluator.js:2008-2010`). O que o `.lcn` não faz é declarar o valor por
conversa de forma estática; para isso usam-se dois menus com `onde:` diferentes.

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
- **O salvamento em bloco do painel.** A aba Menu gravava os seis campos
  sempre, então quem mudasse só o formato zerava os quatro textos. Medido e
  consertado; `''` continua sendo valor legítimo guardado, de propósito.
- **O controle de numeração ausente** na aba, que o motor sempre aceitou.

## Prova

`npm test` → **5077 checagens, zero falhas** (a linha de base da frente era
5046). Arquivos da frente: `migrations/012_menu_padrao.sql`,
`menuPadrao.js`, `tests/menu-padrao.test.mjs`,
`tests/cabecalho-sem-linha-vazia.test.mjs`, mais as edições em `evaluator.js`,
`conflitos.js`, `db.js`, `automationsService.js`, `routes/automations.js`,
`schema/automation.v1.schema.json`, os três arquivos de `src/lcn/` e
`src/web/public/pages/menu-config.js`.
