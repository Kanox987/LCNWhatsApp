# Painel (`lcn`)

Porta de entrada do app. Funciona igual em container ou seco (fala com o bot só
por arquivos: `config.json`, `data/state.json`, `data/archive.json`, `midia/`).

## Cabeçalho
- Conexão (conectado?, número, nome, tempo online).
- Serviço (rodando/parado) e modo (docker/seco).
- Total de mídias e nº de remetentes.

## Menu
1. **Dados de uso e conexões** — uptime, memória, reconexões, quedas, capturas,
   ignoradas, última captura, e contagem por remetente. Avisa se há flag de
   update da Baileys.
2. **Galeria** — lista os arquivos (tipo, remetente, quando, tamanho, 📝 se tem
   transcrição). Abrir um item = abre no visualizador padrão do SO; `p` abre a
   pasta `midia/`.
3. **Limpeza** — apagar por seleção, por remetente, por período (mais antigos que
   N dias) ou tudo. Remove arquivo físico e entrada do índice.
4. **Configurações** — ver [CONFIG.md](CONFIG.md). Inclui um **Modo debug**
   (Hardware) que loga cada mensagem recebida, pra diagnosticar captura.
5. **Serviço**:
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
6. **Atualizar** — roda `update.sh`/`update.ps1`.

> Recuperar visu única "já vista": como o WhatsApp apaga a mídia após a
> visualização, a recuperação é a releitura do **arquivo local** que o bot já
> salvou no momento em que a mensagem chegou. Use a Galeria.
