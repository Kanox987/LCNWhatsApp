# Painel (`lcn`)

Porta de entrada do app. Funciona igual em container ou seco (fala com o bot só
por arquivos: `config.json`, `data/state.json`, `data/archive.json`, `midia/`).

## Cabeçalho
- Conexão (conectado?, número, nome, tempo online).
- Serviço (rodando/parado) e modo (docker/seco).

## Menu
1. **Dados de uso e conexões** — uptime, memória, reconexões e quedas. Avisa
   se há flag de update da Baileys.
2. **Limpar capturas antigas** — a recuperação de visualização única foi
   retirada, e nada mais grava em `data/archive.json`. Esta tela só apaga o que
   ficou de instalações antigas: por seleção, por remetente, por período (mais
   antigos que N dias) ou tudo. Remove arquivo físico e entrada do índice.
3. **Configurações** — ver [CONFIG.md](CONFIG.md). Inclui um **Modo debug**
   (Hardware) que loga cada mensagem recebida, pra diagnosticar recebimento.
4. **Serviço**:
   - **1. Conectar / mostrar QR** — renderiza o QR **dentro do painel** pra
     escanear (o bot salva o QR gerado; a tela mostra e informa a idade dele).
     Quando já conectado, avisa.
   - **2. Reiniciar bot** — pede reinício sem apagar a sessão (o restart policy do
     container / PM2 recolocam de pé).
   - **3. Ver logs** — últimas linhas (lê `data/bot.log`, funciona inclusive dentro
     do container).
   - **4. Apagar dados do número (desconectar e reparear)** — desloga, limpa a
     sessão em `sessao/` e reinicia pedindo novo QR/pareamento; use pra trocar de
     número ou reconectar do zero. Ver [SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md).

   > Não há "iniciar/parar" aqui: no modo container o painel roda dentro do próprio
   > container e não controla o Docker do host. Pra parar de vez, use no host
   > `docker stop LCNWhatsApp`; o serviço em si vive pelo restart policy.
5. **Atualizar** — roda `update.sh`. Em modo container, só funciona
   rodado no host (fora do `docker exec`) — o painel avisa se detectar que está
   rodando de dentro do container. Ver [ATUALIZACAO.md](ATUALIZACAO.md).
