# Download automático (sem digitar `/recover`)

Extra opcional, só pra conversas marcadas em `lcn` > Configurações > Download
automático (`captura.downloadAutomatico.conversas`). Elimina a necessidade de
digitar `/recover` quando a visu única chega travada — mas ainda depende de
você responder, do seu celular, exatamente como o `/recover` já exige.

## Por que só isso é possível

Quando a visualização única chega como `view_once_unavailable_fanout` (o caso
mais comum em contas multi-device — o WhatsApp entrega só o marcador, sem
conteúdo), não existe nenhuma forma automática de obter a mídia sozinha. A
única forma conhecida é você (o dono da conta) **responder citando** a
mensagem ainda não aberta, de qualquer dispositivo logado — o WhatsApp inclui
em `contextInfo.quotedMessage` da sua resposta uma cópia decriptável do
conteúdo original. É uma limitação real de protocolo, não de implementação:
ver [SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md).

## Como funciona

Nas conversas marcadas:

1. Quando a visu única chega **travada**, o bot marca essa conversa como
   "aguardando sua resposta" (por até 15 minutos).
2. A **próxima mensagem sua** nessa conversa que for uma citação/resposta —
   qualquer texto, mídia ou figurinha, **não precisa ser exatamente
   `/recover`** — já é tratada como uma recuperação: o bot extrai o conteúdo
   vazado em `contextInfo.quotedMessage` e revela a mídia normalmente (baixa,
   salva, arquiva, reenvia como mídia normal pro destino configurado).
3. Se a citação não for a visu única pendente (você respondeu outra coisa sem
   querer), a pendência continua ativa — a próxima citação relevante ainda
   funciona, até o prazo de 15 minutos expirar.

Se passarem 15 minutos sem nenhuma resposta sua, a pendência expira e volta a
valer só o `/recover` explícito.

## O que isso NÃO muda

Isso não elimina a necessidade de você responder manualmente — só elimina a
necessidade de lembrar/digitar o texto exato `/recover`. Continua sendo
obrigatório citar a mensagem a partir de um dispositivo logado na conta (é
esse gesto que faz o WhatsApp "vazar" o conteúdo). O comando `/recover`
explícito continua funcionando normalmente, em qualquer conversa, com ou sem
essa configuração ligada.

## Riscos

Como qualquer uso do Baileys (já avisado no README do projeto como um todo), é
uma integração não-oficial: hipoteticamente pode chamar atenção de sistemas
antiabuso do WhatsApp se usado em volume ou de forma repetida — mais um motivo
pra usar só nas conversas que você realmente quer, não em todas.
