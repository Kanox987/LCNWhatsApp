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
O comando `lcn` é linkado em `~/.local/bin` (ou `/usr/local/bin`). Se `~/.local/bin`
não estiver no PATH, adicione:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Windows
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```
Cria `lcn.cmd` em `%LOCALAPPDATA%\LCNWhatsApp\bin` e adiciona ao PATH do usuário
(reabra o terminal depois).

## Requisitos
- **Modo seco:** Node.js 20+ (e Python 3 se for usar faster-whisper).
- **Modo container:** Docker ou Podman. Nada de Node no host é necessário — o
  painel roda dentro do container.
