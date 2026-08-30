# Solução de problemas

## A visu única não chegou sozinha — use o comando `/recover`

Na maioria dos casos, o WhatsApp **não entrega** o conteúdo da visualização única
diretamente ao bot (é o cenário `view_once_unavailable_fanout`, comum em contas
multi-device) — a Baileys nem chega a emitir o evento pro bot processar, e não existe
nenhuma tentativa automática que recupere isso sozinha (evidência real de produção:
0% de sucesso em qualquer automação testada) — é sempre preciso você responder
citando a mensagem, de algum dispositivo logado na conta. O comando `/recover`
faz isso manualmente, em qualquer conversa; conversas marcadas em "Download
automático" (ver [DOWNLOAD-AUTOMATICO.md](DOWNLOAD-AUTOMATICO.md)) dispensam o
texto exato do comando — qualquer resposta sua já revela — mas o gesto de
responder continua sendo obrigatório.

O jeito confiável de recuperar é:

1. **Não abra** a mídia de visualização única recebida (abrir consome/revoga ela).
2. Na mesma conversa, **responda/cite** essa mensagem com o texto `/recover`, a
   partir de qualquer dispositivo logado na conta conectada (celular ou WhatsApp Web).
3. O bot reconhece o comando, extrai o conteúdo que veio embutido na citação
   (`contextInfo.quotedMessage` — o WhatsApp inclui uma cópia decriptável da mídia
   original ali, já que ela ainda não foi "aberta") e captura normalmente.

## Mandei uma visu única e nada aconteceu (nem no log)

Ligue o **modo debug** no painel: `lcn` > Configurações > Hardware > "Modo debug".
Com ele, cada mensagem recebida aparece no log, mesmo as que não são visu única:

```
messages.upsert type=notify n=1
↳ msg de=...@lid fromMe=false tipo=viewOnceMessageV2 isViewOnce=true stub=undefined
```

Interprete assim:
- **Nenhuma linha `upsert`** ao enviar → a mensagem não chega ao bot (entrega/conexão).
- **`fromMe=true`** → mensagem enviada pela própria conta do bot. É ignorada, exceto
  quando é o comando `/recover` citando uma visu única, ou (em conversas marcadas em
  "Download automático") qualquer citação enquanto houver uma visu única pendente
  nessa conversa (ver seção acima).
- **`tipo=null`** (sem conteúdo) → a mensagem chegou mas **não descriptografou**.
  Quase sempre é problema de **mapeamento LID** — veja abaixo.
- **`tipo` diferente do esperado** → formato novo; abra uma issue com o DUMP.

Para ver o log:
```
docker logs -f LCNWhatsApp          # container
pm2 logs LCNWhatsApp                 # PM2 / seco
```

## `message: null` / remetente `@lid` (mapeamento LID)

No WhatsApp atual, os remetentes chegam como `@lid` (ex: `1224...@lid`, com o número
real em `remoteJidAlt`). A Baileys precisa do **sync inicial** pra obter os
mapeamentos LID; sem eles, a descriptografia de PV falha e o `message` vem nulo.

O LCNWhatsApp **não** desabilita esse sync (mantém `syncFullHistory:false`, que já é
leve). Se você ligou uma versão antiga que desabilitava, ou a sessão do contato
ficou num estado ruim:

1. `lcn` > **Serviço** > **4. Apagar dados do número (desconectar e reparear)**.
2. Isso desloga, limpa a sessão e reinicia o bot pedindo **novo QR/pareamento**.
3. Acompanhe o novo login em `docker logs -f LCNWhatsApp` (ou no terminal do bot).
4. Após reparear, o sync inicial popula os LID e a captura passa a funcionar.

## Quero trocar o número do bot / reconectar do zero

Mesma função: **Serviço > 4. Apagar dados do número**. Ela remove a sessão salva em
`sessao/` e reinicia pedindo login — aí você pareia o número que quiser.

## Reconexões frequentes / quedas (código 440, 515…)

- 440/conflito costuma ser **outra sessão** conectada com o mesmo número (WhatsApp
  Web aberto em outro lugar, ou duas instâncias do bot). Deixe só uma.
- Quedas seguidas por muito tempo podem indicar **mudança de protocolo** do
  WhatsApp: atualize (`lcn` > Atualizar) pra pegar uma Baileys mais nova. Veja
  [ATUALIZACAO.md](ATUALIZACAO.md).

## O bot aparece "online" pra quem me manda a foto

Deixe `markOnline` desligado (padrão): `lcn` > Configurações > Hardware. Assim o bot
não marca presença nem confirma leitura da visu única.
