# Perfis de provisionamento

Um **perfil** é um arquivo JSON que diz o que uma instância já nasce tendo:
quais pacotes e modelos de comando ficam ativos, em quais conversas, com quais
parâmetros. Quem usa a instância só conecta o número. Sem perfil (ou com
`vazio.json`) a instância sobe limpa e a pessoa configura tudo pelo painel.

## Usar

No container, aponte o arquivo — só o **caminho** vai por variável de ambiente:

```bash
./run.sh --profile deployment/perfis/recuperar-x9.json
```

Com `docker compose`, a pasta `deployment/` já é montada em
`/run/lcn/provisioning`; escolha o perfil no `.env`:

```
LCN_PROVISION_PROFILE=/run/lcn/provisioning/perfis/recuperar-x9.json
```

Sem container (motor rodando):

```bash
lcn engine provisionar --perfil deployment/perfis/recuperar-x9.json --check   # só mostra o plano
lcn engine provisionar --perfil deployment/perfis/recuperar-x9.json
```

## Como se comporta

- **Primeira subida:** aplica. **Reinício:** o motor vê que o perfil já foi
  aplicado e não mexe em nada (o que o dono editou fica como está).
- **Tudo ou nada:** pools, pacotes e modelos do perfil entram numa transação só.
  Se um item falha, nada do perfil fica.
- **Só acrescenta:** nunca despublica nem reescreve parâmetro alterado pelo dono.
- **Versão nova:** suba `profileVersion` e rode com `--reconcile`. A mesma
  versão com outro conteúdo é recusada.
- **Perfil com erro não derruba o container:** o motivo aparece no log. O perfil
  fica marcado como bloqueado e não é repetido a cada reinício; corrija e suba a
  versão, ou use `--retry`.
- **Estado:** `GET /perfis/estado` no motor lista o que foi aplicado.

Código de saída da CLI: `0` aplicado ou nada a fazer; `2` arquivo ilegível;
`3` perfil recusado ou bloqueado; `1` falha do motor.

## Formato

```json
{
  "schemaVersion": 1,
  "profileId": "recuperar-x9",
  "profileVersion": 1,
  "packageIds": [],
  "templateIds": ["x9", "apagar"],
  "scope": { "include": [{ "kind": "everywhere" }], "exclude": [] },
  "deploymentMode": "live",
  "pools": [{ "id": "principal", "label": "Principal" }],
  "parametrosComuns": { "poolId": "padrao" },
  "parameters": { "apagar": { "allowFrom": "any" } }
}
```

- `packageIds` / `templateIds` vazios = instância limpa. Um modelo que já faz
  parte de um pacote do perfil não vai também em `templateIds`.
- `scope.include` é obrigatório quando há algo a instalar, e **lista vazia nunca
  significa "todos"**. Para todos: `{ "kind": "everywhere" }`. Também aceita
  `all_groups`, `all_contacts`, `contact`, `group` e `tagged`. `exclude` vence.
- `parametrosComuns` vale para todos os itens; `parameters.<modelo>` vale só
  para um e tem prioridade. Todo modelo exige `poolId`. O pool `padrao` já existe
  em todo motor; outro pool só existe se estiver em `pools`.
- Sem segredos no arquivo. Conexões externas entram por id e precisam existir.

## Limitar o que um perfil pode pedir

Arquivo opcional, apontado por `LCN_PROVISION_POLICY`:

```json
{ "schemaVersion": 1, "allowedPackageIds": ["basico"], "allowedTemplateIds": ["x9"] }
```

Se o perfil pedir algo fora da lista, **o perfil inteiro** é recusado (nada é
cortado em silêncio). Sem o arquivo, tudo é permitido. Política ilegível também
recusa — nunca é ignorada.

## Perfis de exemplo

| arquivo | o que instala |
|---|---|
| `vazio.json` | nada; instância limpa |
| `recuperar-x9.json` | x9, recuperação de visualização única (manual e automática), destino do recover e apagar mensagem citada |
| `administracao-protecao.json` | pacotes de administração e proteção, só em grupos |

`recuperar-x9.json` deixa de fora `anti-visualizacao-unica` (ela pode remover o
autor de um grupo): quem quiser acrescenta em `templateIds`. Ele **não**
recupera mensagem apagada — isso não existe no LCN.

Para testar: `config-recover` e `config-auto-recover` são "só dono". Enquanto
nenhum dono estiver cadastrado, o próprio número do bot consegue usá-los.
