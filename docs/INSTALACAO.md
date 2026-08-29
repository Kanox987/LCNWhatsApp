# Instalação

O instalador é interativo e decide o modo de execução.

## Fluxo
1. Detecta engine de container: `docker`, `podman` ou `nerdctl`.
2. **Se houver engine:** pergunta *container (recomendado)* ou *seco (nativo)*.
3. **Se não houver:** pergunta se quer *instalar o Docker* (dá o link/comando) ou
   *seguir no seco*.
4. Grava `runtime.json` com `{ mode, engine }`.
5. Prepara o app (build da imagem, ou `npm install`) e instala o comando `lcn`.

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
`/usr/local/bin` (todos os usuários do sistema) — só esse passo, opcional,
pede sua senha.

## Windows
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```
Cria `lcn.cmd` em `%LOCALAPPDATA%\LCNWhatsApp\bin` e adiciona ao PATH do usuário
(reabra o terminal depois).

## Requisitos
- **Modo seco:** Node.js 20+ (e Python 3 se for usar faster-whisper). Se
  faltar algum na hora de instalar, o instalador tenta instalar sozinho
  (winget no Windows; apt/dnf/pacman/brew no Linux/macOS) antes de desistir
  e pedir pra você instalar manualmente.
- **Modo container:** Docker ou Podman (ou nerdctl). Nada de Node no host é
  necessário — o painel roda dentro do container (`bin/lcn`/`bin/lcn.cmd` não
  dependem de Node pra isso). Se nenhum engine existir na hora de subir o
  container (`run.sh`/`run.ps1`), eles também tentam instalar o Docker antes
  de abortar com erro.
- **Provedor `codex` da transcrição:** exige Codex CLI instalado e logado no
  host (`codex login`) — ver [TRANSCRICAO.md](TRANSCRICAO.md) e, em modo
  container, [CONTAINER.md](CONTAINER.md).
