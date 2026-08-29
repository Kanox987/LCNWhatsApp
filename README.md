# LCNWhatsApp

Captura mídias em **visualização única** recebidas no PV do WhatsApp e **reenvia
como mídia normal** para o destino que você escolher (por padrão, a sua própria
conversa — "Mensagens salvas"). Também salva uma cópia local, com galeria,
limpeza e transcrição de áudio opcional. Roda em **Docker/Podman** ou **no seco**
(nativo), em Linux, Windows e macOS. Usa a **Baileys oficial**
(`github:WhiskeySockets/Baileys`).

O comando **`lcn`** abre o painel (dashboard) da aplicação.

---

## Instalação rápida

**Linux/macOS**
```bash
cd LCNWhatsApp
sh install.sh
```
**Windows (PowerShell)**
```powershell
cd LCNWhatsApp
powershell -ExecutionPolicy Bypass -File install.ps1
```

O instalador **detecta** se há Docker/Podman e pergunta se você quer rodar em
container (recomendado) ou no seco. Se não houver engine, oferece instalar o
Docker ou seguir no seco. No fim, instala o comando `lcn`.

Depois, faça o login lendo o QR / código de pareamento:
- **Container:** `docker logs -f LCNWhatsApp` (ou `podman logs -f ...`)
- **Seco:** `npm start` (QR) ou `npm run code` (código de pareamento)

## O painel: `lcn`
Abre um menu de terminal com:
- **Status** no topo: conectado?, qual número, mídias salvas e por remetente.
- **Dados de uso e conexões** (uptime, quedas, capturas, memória).
- **Galeria** dos arquivos locais (abre no visualizador do SO, revela a pasta).
- **Limpeza** por seleção ou em lote (por remetente, período, ou tudo).
- **Configurações** por tópicos (destino, contatos, grupos, transcrição,
  hardware, atualização).
- **Serviço** (iniciar/parar/logs) e **Atualizar**.

## Como funciona (resumo)
1. `shouldIgnoreJid` descarta grupos/status/canais **antes de descriptografar** —
   é o que evita processar milhares de msgs de grupo só pra pegar visu única de PV.
   Ver [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
2. Ao chegar uma visu única de um contato permitido, o bot baixa a mídia
   (`downloadContentFromMessage`), salva em `midia/`, arquiva o metadado e
   **reenvia como mídia normal** (payload sem `viewOnce`).
3. Se for áudio e a transcrição estiver ligada, anexa o texto.

## Documentação
- [INSTALACAO.md](docs/INSTALACAO.md) — instalador e modos
- [CONTAINER.md](docs/CONTAINER.md) — Docker/Podman e rodar no seco
- [DASHBOARD.md](docs/DASHBOARD.md) — o painel `lcn`
- [CONFIG.md](docs/CONFIG.md) — todas as opções do `config.json`
- [PERFORMANCE.md](docs/PERFORMANCE.md) — descarte pré-crypto e baixo consumo
- [HARDWARE.md](docs/HARDWARE.md) — ajustes de consumo
- [TRANSCRICAO.md](docs/TRANSCRICAO.md) — provedores de transcrição
- [ATUALIZACAO.md](docs/ATUALIZACAO.md) — atualizar app + Baileys
- [API.md](docs/API.md) — ponto de extensão da API de saída (desligado)
- [SOLUCAO-DE-PROBLEMAS.md](docs/SOLUCAO-DE-PROBLEMAS.md) — visu única não capturada, LID, reconectar, debug

## Testes
```bash
npm test
```

## Aviso
Ferramenta para uso pessoal/autorizado. Respeite a privacidade das pessoas e os
termos do WhatsApp. Revelar visualização única de terceiros pode violar a
expectativa de privacidade de quem enviou — use com responsabilidade.
