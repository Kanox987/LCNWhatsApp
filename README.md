# LCNWhatsApp

Captura mídias em **visualização única** recebidas no PV do WhatsApp e **reenvia
como mídia normal** para o destino que você escolher (por padrão, a sua própria
conversa — "Mensagens salvas"). Também salva uma cópia local, com galeria,
limpeza e transcrição de áudio opcional. Roda em **Docker/Podman** ou **no seco**
(nativo), em Linux, Windows e macOS. Usa a **Baileys oficial**
(`github:WhiskeySockets/Baileys`).

O comando **`lcn`** abre o painel (dashboard) da aplicação.

> ⚠️ **O comando `/recover` é necessário.** Na grande maioria dos casos o
> WhatsApp não entrega o conteúdo da visualização única direto pro bot — ele só
> chega se você **responder a mensagem ainda não aberta com `/recover`** (de
> qualquer dispositivo logado na sua conta). Sem isso, a automação não consegue
> capturar o arquivo. Ver item 3 de [Como funciona](#como-funciona-resumo) e
> [docs/SOLUCAO-DE-PROBLEMAS.md](docs/SOLUCAO-DE-PROBLEMAS.md).

---

## Instalação rápida

**Linux / macOS**
```bash
cd LCNWhatsApp
sh install.sh
```

> ⚠️ **Não rode com `sudo`.** O instalador roda como o seu usuário normal —
> `config.json`, `sessao/`, `midia/`, `data/`, `node_modules` e o venv do
> faster-whisper ficam com o seu dono, não root. O comando `lcn` é instalado
> em `~/.local/bin` (sem privilégio). Só se você quiser também disponibilizar
> `lcn` pra todos os usuários do sistema (`/usr/local/bin`) o instalador pede
> sua senha — só nesse passo, opcional, no fim.

**Windows (PowerShell)**
```powershell
cd LCNWhatsApp
powershell -ExecutionPolicy Bypass -File install.ps1
```

O instalador **detecta** se há Docker/Podman e pergunta se você quer rodar em
container (recomendado) ou no seco. Se não houver engine, oferece instalar o
Docker ou seguir no seco. No fim, instala o comando `lcn` (em qualquer sistema,
funciona independente de onde você clonou o projeto — só evite mover/renomear
a pasta depois de instalado, senão precisa reinstalar o comando).

Depois de instalar, conecte pelo próprio painel — é o jeito padrão, funciona
igual em container ou no seco:
```bash
lcn
```
Escolha **5 Serviço** > **1 Conectar / mostrar QR** e escaneie no WhatsApp
(Aparelhos conectados > Conectar aparelho). O painel atualiza a tela sozinho
até conectar.

## O painel: `lcn`
Abre um menu de terminal com:
- **Status** no topo: conectado?, qual número, mídias salvas e por remetente.
- **Dados de uso e conexões** (uptime, quedas, capturas, memória).
- **Galeria** dos arquivos locais (abre no visualizador do SO, revela a pasta).
- **Limpeza** por seleção ou em lote (por remetente, período, ou tudo).
- **Configurações** por tópicos (destino, destino próprio por contato,
  contatos, grupos, transcrição — geral e por conversa —, hardware,
  atualização), com seleção por lista em vez de digitar JID/número de cabeça.
- **Serviço** — é por aqui que você **conecta** (QR/código de pareamento),
  reinicia, vê logs ou desconecta pra trocar de número. **Atualizar** puxa
  updates do app/Baileys.

## Como funciona (resumo)
1. `shouldIgnoreJid` descarta grupos/status/canais **antes de descriptografar** —
   é o que evita processar milhares de msgs de grupo só pra pegar visu única de PV.
   Ver [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
2. Quando a visu única chega **inline** (nem sempre acontece — depende do
   WhatsApp), o bot baixa a mídia (`downloadContentFromMessage`), salva em
   `midia/`, arquiva o metadado e **reenvia como mídia normal** (payload sem
   `viewOnce`) pro destino configurado.
3. Quando não chega inline (o caso mais comum), **responda a mensagem ainda não
   aberta com `/recover`** — o bot recupera a mídia pela citação e segue o
   mesmo fluxo do item 2. Contatos marcados em "destino próprio" recebem a
   mídia de volta na própria conversa, em vez do destino padrão. Ver
   [docs/SOLUCAO-DE-PROBLEMAS.md](docs/SOLUCAO-DE-PROBLEMAS.md).
4. Se for áudio e a transcrição estiver ligada, anexa o texto — também dá pra
   transcrever áudio comum (não visu única), automaticamente numa conversa
   configurada ou sob demanda com `/transcrever`. Ver
   [docs/TRANSCRICAO.md](docs/TRANSCRICAO.md).

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
