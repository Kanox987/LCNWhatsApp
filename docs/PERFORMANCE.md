# Performance — descartar cedo (com cuidado)

O problema: um número pode receber milhares de mensagens de grupo por minuto.
Baixar/salvar mídia disso à toa seria desperdício. Mas descartar demais, cedo
demais, quebra a própria Baileys — foi exatamente isso que aconteceu aqui (ver
[SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md) para a história completa).

## `shouldIgnoreJid`: só pro que é genuinamente inerte

A Baileys avalia essa função no **nó cru, ANTES de descriptografar**
(`lib/Socket/messages-recv.js`, `processNode`). Retornando `true`, ela só dá
**ACK e descarta** — sem crypto, sem download, sem evento.

**Importante:** essa função vale pra **todo tipo de nó de protocolo** — não só
mensagens de chat, mas também `call`, `receipt` e `notification`. Bloquear um
jid aqui descarta TUDO endereçado a ele, inclusive bookkeeping interno que a
Baileys usa pra manter sessões/mapeamentos PN↔LID saudáveis (ex: `w:gp2`, sync
de participantes de grupo).

Por isso, hoje (`src/ignore.js`) essa camada só descarta o que **nunca** carrega
bookkeeping relevante:
```js
return ehBroadcast(jid) || ehNewsletter(jid)   // status@broadcast, @newsletter
```
**Não** filtra grupo, nem allowlist/blocklist de PV — isso já causou uma falha
real de captura (ver o histórico abaixo).

## `passaFiltro`: a filtragem de "não quero capturar disso"

Grupo desligado, contato fora da allowlist, contato bloqueado, grupo fora da
allowlist de grupos — tudo isso é decidido em `passaFiltro()`
(`src/capture.js`), que roda **depois** da Baileys já ter decriptado a
mensagem normalmente. O trabalho caro de verdade (download de mídia, escrita
em disco) só acontece depois desse filtro passar — então o custo real de
"processar grupo" hoje é só decriptar o envelope (Signal/sender-key), não
baixar/salvar nada.

## Camadas de apoio
- Socket enxuto: `syncFullHistory:false` (sync leve, só recente), `emitOwnEvents:false`,
  sem cache de mídia, logger silencioso, sem fetch de metadados de grupo/foto.
- Guardas baratas no handler antes de qualquer I/O; download só pra visu real.
- Limitador de concorrência + teto de tamanho de mídia.

## ⚠️ Histórico: duas otimizações que quebraram a captura

**1. `shouldSyncHistoryMessage:()=>false`** — desabilitava o sync inicial que a
Baileys usa pra obter mapeamentos LID. Sem eles, PV inteiro parava de
decriptar. Removido; `syncFullHistory:false` já dá o sync leve sem isso.

**2. `shouldIgnoreJid` bloqueando `@g.us` genericamente** — pensado só pra
"não processar CONTEÚDO de grupo", mas como essa função vale pra `notification`
e `receipt` também, bloquear `@g.us` cortava sync de participantes de grupo
(`w:gp2`) e recibos — bookkeeping que a Baileys usa pra manter sessão/LID
saudáveis, inclusive pra contatos de PV. Resultado: visu única chegava sempre
com `message: null` ("view_once_unavailable_fanout"), mesmo com
`sock.requestPlaceholderResend` implementado corretamente. Corrigido movendo
todo o filtro de grupo/contato pra `passaFiltro` (pós-decrypt).

**Moral:** otimização de performance pré-crypto só é segura pra tráfego que
**nunca** carrega bookkeeping de protocolo (broadcast, newsletter). Qualquer
coisa que possa ter efeito colateral em sessão/LID (grupos, especificamente)
tem que ser filtrada depois de decriptar.

## Ressalva
Ligar/desligar `grupos.ativo` no meio da sessão é seguro agora (não depende
mais de reconectar pra "religar" o recebimento de grupo — a Baileys sempre
processa; só a captura em si é que respeita o toggle).
