# Instalação

O instalador é interativo e decide o modo de execução.

## Fluxo
1. Detecta engine de container: `docker`, `podman` ou `nerdctl`.
2. **Se houver engine:** pergunta *container (recomendado)* ou *seco (nativo)*.
3. **Se não houver:** pergunta se quer *instalar o Docker* (dá o link/comando) ou
   *seguir no seco*.
4. Grava `runtime.json` com `{ mode, engine }`.
5. Prepara o app (build da imagem, ou valida Node/npm e executa `npm install`) e
   instala o comando `lcn`.

## Linux/macOS
```bash
sh install.sh
```
Rode como usuário normal — **nunca com `sudo`** (o instalador recusa e aborta
se detectar que foi chamado via sudo de um usuário comum). O comando `lcn` é
sempre linkado em `~/.local/bin` (sem privilégio). Se não estiver no PATH,
adicione:
```bash
export PATH="$HOME/.local/bin:$PATH"
```
No fim, o instalador pergunta se você também quer linkar `lcn` em
`/usr/local/bin` (todos os usuários do sistema). Operações que realmente
alteram o sistema usam `sudo` ou `doas` pontualmente; os arquivos do projeto,
`node_modules`, sessão, mídias, configurações e venv continuam pertencendo ao
usuário normal.

## Windows

> ⚠️ **Empacotamento em `.exe` ainda é experimental.** No modo "no seco",
> depois do `npm install`, o instalador roda `build-exe.ps1` e gera um
> `lcn.exe` standalone (Node SEA) na raiz do projeto — sem ele, o dia a dia
> continua exigindo Node instalado. Validado de ponta a ponta (bundle,
> blob SEA, injeção via `postject`, execução real) num ambiente Linux com um
> Node oficial equivalente ao que o `winget` instala, mas **sem teste de
> campo numa máquina Windows real ainda**. Se a geração falhar ou o
> `lcn.exe` não funcionar direito, o painel/bot continuam disponíveis do
> jeito de sempre: `npm run dashboard` e `npm start` (ou `npm run code`).

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```
Cria `lcn.cmd` em `%LOCALAPPDATA%\LCNWhatsApp\bin` e adiciona ao PATH do usuário.
O instalador recarrega o PATH da própria sessão depois de instalar Node/Python ou
o comando `lcn`. Se ele tiver sido iniciado a partir de outro PowerShell usando
`powershell -File`, o processo pai continua com o PATH antigo; nesse caso,
reabra o terminal pai antes de usar os comandos recém-instalados.

## Verificar dependências do sistema

Há dois verificadores somente de diagnóstico. Eles não instalam, removem ou
atualizam dependências.

Linux/macOS:
```bash
sh check-deps.sh
```

Windows:
```powershell
powershell -ExecutionPolicy Bypass -File check-deps.ps1
```

O script usa `runtime.json` para adaptar o teste ao modo instalado:

- **Modo nativo:** verifica Node.js 22+, npm e se os módulos principais do
  projeto podem ser resolvidos (`@hapi/boom`, Baileys, `pino` e
  `qrcode-terminal`).
- **Modo container:** verifica o engine configurado, acesso ao daemon/serviço,
  existência/estado do container `LCNWhatsApp` e se o Node responde dentro do
  container. Node no host não é exigido nesse modo.
- **Ambos:** verifica se `lcn` está no PATH, existência e permissão de escrita
  de `sessao/`, `midia/`, `data/` e `config.json`, além das dependências do
  provedor de transcrição efetivamente configurado.

Para transcrição, o diagnóstico testa apenas o que estiver ativo:

- `faster-whisper`: Python configurado/disponível e import do módulo
  `faster_whisper`;
- `openai`: presença da chave configurada, sem imprimir seu valor;
- `comando`: presença de um comando externo configurado.

No Windows, `check-deps.ps1` começa recarregando o PATH persistente de
**Machine + User**. Isso é útil logo após instalações feitas via `winget`, já
que uma janela do PowerShell aberta antes da instalação pode continuar com uma
cópia antiga do PATH.

Os verificadores imprimem `[OK]`, `[AVISO]` e `[ERRO]`, mostram um resumo no fim
e retornam:

```text
exit 0  -> nenhuma falha crítica encontrada
exit 1  -> uma ou mais falhas críticas encontradas
```

Avisos não tornam o diagnóstico inválido sozinhos; por exemplo, um container
instalado mas parado pode aparecer como aviso quando o restante do ambiente
está íntegro.

## Requisitos

### Modo nativo

- **Recomendado:** Node.js 24 LTS.
- **Mínimo aceito pelo instalador Linux/macOS:** Node.js 22 com npm disponível.
- Python 3 só é necessário para o provedor `faster-whisper`.

Antes de executar `npm install`, `install.sh` verifica `node`, `npm` e a major
do Node. Se o runtime estiver ausente ou abaixo do mínimo, tenta preparar uma
versão compatível e valida novamente antes de continuar.

A estratégia automática depende da plataforma:

| Sistema/família | Estratégia usada |
| --- | --- |
| Debian, Ubuntu, Mint, Pop!_OS e derivados | Node.js 24 LTS via NodeSource, com confirmação antes de adicionar o repositório; depois valida e pode cair para `nvm` |
| Fedora | tenta os pacotes versionados de Node.js 24; fallback para os aliases `nodejs`/`npm` da distro |
| RHEL, CentOS, Rocky, AlmaLinux, Oracle Linux | tenta Node.js 24 quando disponível, depois stream Node.js 22/AppStream e por fim pacotes genéricos |
| Arch, Manjaro, EndeavourOS | `nodejs-lts-krypton` + `npm`; não usa `pacman -Sy` isolado |
| openSUSE/SLES | tenta `nodejs24` + `npm24`; se a release não oferecer, a validação falha e o instalador tenta `nvm` |
| Alpine | `apk add --no-cache nodejs npm` |
| Amazon Linux | `nodejs24` + `nodejs24-npm`, com tentativa de ajustar `alternatives` quando aplicável |
| macOS | Homebrew `node@24`, adicionando o prefixo ao PATH; se Homebrew não estiver disponível ou a instalação falhar, tenta `nvm` |
| distro desconhecida | não inventa comando de package manager; tenta `nvm` como fallback por usuário |

O fallback `nvm` é instalado no usuário atual, nunca via `sudo`, e o instalador
carrega `nvm.sh` na própria execução para não depender de abrir outro terminal
antes de continuar.

> O modo Docker/Podman continua sem exigir Node.js no host. Node só é necessário
> dentro do container.

### Por que Node.js 24/22?

Em agosto de 2026, Node.js 24 e Node.js 22 estão em LTS, enquanto Node.js 20 já
está EOL. Algumas distribuições estáveis ainda entregam Node 20 nos repositórios
padrão — Debian 13/Trixie, por exemplo — então simplesmente fazer
`apt install nodejs` não garante uma versão adequada para uma instalação nova.
Por isso o instalador recomenda Node 24 LTS e só aceita Node 22+ no fluxo nativo.

### Privilégios

Use:
```bash
sh install.sh
```

Não use:
```bash
sudo sh install.sh
```

A elevação é restrita a operações do sistema (`apt-get`, `dnf`, `pacman`,
`zypper`, `apk` ou o link opcional em `/usr/local/bin`). Homebrew e `nvm` nunca
são executados com `sudo`.

### Arch/Manjaro e `pacman`

O instalador não usa mais `pacman -Sy` para instalar dependências, porque Arch
não suporta *partial upgrades*. O fluxo usa:
```bash
sudo pacman -S --needed nodejs-lts-krypton npm
```
Se o banco local de pacotes estiver antigo e a instalação falhar, atualize o
sistema normalmente e tente de novo:
```bash
sudo pacman -Syu
sh install.sh
```
A mesma regra vale para a instalação opcional de Python/faster-whisper.

### Debian/Ubuntu e NodeSource

Quando Node/npm estão ausentes ou inadequados, o instalador pode oferecer
Node.js 24 LTS via NodeSource. Como isso adiciona um repositório de terceiros ao
sistema, a ação pede confirmação antes de continuar.

Fluxo manual equivalente:
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
rm -f /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
```
O instalador baixa o script para um arquivo temporário em vez de executar um
`curl | sudo bash` diretamente.

### Fedora

Em Fedora recente, o instalador tenta primeiro:
```bash
sudo dnf install -y nodejs24-bin nodejs24-npm-bin
```
Se esses nomes não existirem naquela release, tenta:
```bash
sudo dnf install -y nodejs npm
```
Depois disso, `node` e `npm` são validados de novo; sucesso do `dnf` sozinho não
é considerado suficiente.

### RHEL/CentOS e derivados

O catálogo varia bastante entre releases. O instalador tenta, nesta ordem:
```bash
sudo dnf install -y nodejs24
sudo dnf module install -y nodejs:22
sudo dnf install -y nodejs npm
```
Cada tentativa é seguida pela validação global do runtime; se ainda não houver
Node 22+ com npm, o fallback por `nvm` pode assumir.

### openSUSE

Em releases que oferecem os pacotes versionados:
```bash
sudo zypper --non-interactive install nodejs24 npm24
```
Leap e Tumbleweed podem ter catálogos diferentes. O instalador não adiciona
repositórios comunitários do OBS automaticamente; se os pacotes não existirem,
segue para o fallback por usuário.

### Alpine

```bash
apk add --no-cache nodejs npm
```
O `npm` é tratado como pacote separado.

### Amazon Linux 2023

```bash
sudo dnf install -y nodejs24 nodejs24-npm
```
Como majors diferentes podem coexistir, o instalador tenta ajustar
`alternatives` para Node 24 quando o mecanismo e o executável versionado estão
disponíveis.

### macOS com Homebrew

```bash
brew install node@24
export PATH="$(brew --prefix node@24)/bin:$PATH"
```
`node@24` é uma fórmula versionada (*keg-only*), então o instalador adiciona o
prefixo ao PATH da sessão atual e ao arquivo de perfil do usuário quando ainda
não estiver presente. Não use `sudo brew`.

### Erros de módulos nativos

O instalador não instala compiladores antecipadamente em toda máquina. Se
`npm install` falhar mencionando `node-gyp`, compilador, `make`, Python ou
headers, pode ser necessário instalar uma toolchain nativa. Em Unix,
`node-gyp` normalmente precisa de Python, `make` e compilador C/C++; no macOS,
as Xcode Command Line Tools podem ser instaladas com:
```bash
xcode-select --install
```
Não tente resolver esse tipo de erro com `sudo npm install`.

### Modo container

Docker, Podman ou nerdctl podem ser usados. Nada de Node no host é necessário —
o painel roda dentro do container (`bin/lcn`/`bin/lcn.cmd` não dependem de Node
para descobrir o modo). Se nenhum engine existir na hora de subir o container
(`run.sh`/`run.ps1`), eles tentam preparar o Docker antes de abortar com uma
mensagem clara.
