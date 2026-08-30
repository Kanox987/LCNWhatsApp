# Download automático (sem `/recover` manual)

Extra opcional, só pra conversas marcadas em `lcn` > Configurações > Download
automático (`captura.downloadAutomatico.conversas`). Automatiza o que hoje só o
comando `/recover` faz manualmente — sem nenhum comando, sem interação humana.

## Como funciona

Quando a visualização única chega **com conteúdo** (o caso normal, já capturado
direto hoje — não é o `view_once_unavailable_fanout`, ver abaixo), pra conversas
marcadas o bot:

1. **Encaminha** a mídia, ainda trancada como visualização única, pra sua própria
   conversa (`sock.sendMessage(self, { forward: mensagem })`). Isso é seguro: o
   encaminhamento do Baileys nunca baixa nem decripta a mídia — só reencapsula a
   estrutura da mensagem (`mediaKey`, `url`, `fileEncSha256` continuam intocados).
   É só um backup nativo extra, visível no seu próprio WhatsApp.
2. **Revela** a mídia normalmente — a mesma captura de sempre (baixa, salva,
   arquiva, reenvia como mídia normal pro destino configurado), sem precisar de
   `/recover`.

Se o encaminhamento falhar por qualquer motivo, a captura normal segue de
qualquer jeito (best-effort — nunca derruba a captura).

Com `autoDelete` ligado, depois que a captura termina com sucesso, **só a
mensagem encaminhada** (a bolha ainda trancada, nunca aberta) é apagada da sua
conversa privada. A mídia revelada — imagem, vídeo ou áudio, já sem
visualização única — **nunca** é apagada.

## O que isso NÃO resolve

Isso só cobre o caso em que a visu única chega com conteúdo pro bot. No caso
`view_once_unavailable_fanout` (o WhatsApp entrega só o marcador, sem conteúdo —
comum em contas multi-device), **não há nada que o bot possa encaminhar**: o
"vazamento" de conteúdo em `contextInfo.quotedMessage` só acontece quando um
cliente de verdade (seu celular) responde citando a mensagem — é uma limitação
real de protocolo, não de implementação. Nesse caso, o único caminho continua
sendo o comando `/recover` manual (ver
[SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md)).

## Riscos

- Encaminhar visualização única é uma capacidade que o WhatsApp **esconde
  deliberadamente** na UI oficial (não existe botão de encaminhar pra visu
  única no app). Funcionar via Baileys não significa que é um comportamento
  oficialmente suportado ou garantido — pode mudar sem aviso em atualizações
  futuras do protocolo.
- Como qualquer uso do Baileys (já avisado no README do projeto como um todo),
  é uma integração não-oficial: hipoteticamente pode chamar atenção de sistemas
  antiabuso do WhatsApp se usado em volume ou de forma repetida — mais um
  motivo pra usar só nas conversas que você realmente quer, não em todas.
