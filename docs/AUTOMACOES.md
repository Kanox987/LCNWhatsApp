# Automações

Como criar comandos e regras no LCNWhatsApp. Tudo aqui é feito pelo painel web
(`lcn web start`, em `http://127.0.0.1:4780`) — você escreve a regra em português,
na linguagem do projeto, com a referência ao lado e o erro apontando a linha.

## Antes de começar

Três coisas precisam estar de pé:

```bash
lcn engine start   # o motor que decide o que responder
lcn web start      # o painel, em http://127.0.0.1:4780
```

E o número precisa estar conectado (pelo painel do terminal, `lcn`, ou pela aba
Instâncias do painel web).

---

## Instalar um comando pronto

A aba **Catálogo** lista os comandos já montados. Cada um tem três botões:

- **Ver código** — o que exatamente vai ser criado, sem surpresa
- **Ver informações** — o que faz, o que exige, quais campos pede
- **Adicionar à automação** — instala

Ao instalar, você preenche os campos do comando e escolhe **onde ele vale**:
quais contatos e quais grupos. Essa escolha é obrigatória — uma automação nunca
vale em "todas as conversas" por acidente.

Alguns comandos trazem outros junto. O `/menu`, por exemplo, instala também o
comando que permite configurar o texto do menu pelo WhatsApp. O painel mostra
isso antes.

### Comandos que têm ressalva

Comandos com pegadinha se anunciam já no card, antes de você abrir qualquer
coisa:

- **Tem pré-requisito** — precisa de algo instalado (ffmpeg) ou de o número ser
  administrador do grupo
- **Nem sempre funciona** — não aparece em alguma versão do WhatsApp; no menu
  com botões, por exemplo, o Business não mostra, e o sistema manda em texto
- **Recurso não oficial** — usa um caminho que a Meta pode desativar sem aviso

---

## Modo sombra

Toda automação nasce em **sombra**: ela reconhece a mensagem e registra que
teria respondido, mas não responde de verdade. Isso serve para você conferir se
a regra pega o que deveria antes de soltar.

Quando estiver certo, use **Promover para ao vivo** na aba Automações.

---

## Criar um comando do zero

Na aba **Automações**, o botão **Nova automação** abre a oficina de escrita com um esqueleto funcional na linguagem `.lcn`.

A tela é composta por:

- **Editor com esqueleto inicial** — começa com um comando pronto (`/meucomando`) preenchido com o pool disponível, para você editar a partir dele em vez de uma tela em branco.
- **Referência da linguagem** — painel ao lado do editor com as ações, campos e palavras aceitas, permitindo consultar e inserir direto no texto.
- **O essencial** — resumo abaixo do editor explicando os campos obrigatórios do cabeçalho (`automação`, `tipo`, `acessa`, `onde`, `pool`).

Ao clicar em **Criar automação**, o texto é compilado. Se houver erro de sintaxe, o painel marca a linha exata para correção. Uma vez criada com sucesso, a automação nasce como rascunho e a tela segue direto para a edição, onde o próximo passo é clicar em **Publicar** para colocar no ar.

---

## As três classes: comando, vigia e porteiro

Toda automação começa declarando o que ela **é** no cabeçalho, na linha `tipo:`:

- **`tipo: comando`** — acorda quando alguém digita a palavra configurada (ex.: `/total`, `/menu`, `/opcoes`).
- **`tipo: vigia`** — fica ligado observando as mensagens da conversa (fotos, vídeos, links ou palavras específicas). É assim que funcionam o anti-link, anti-imagem, anti-áudio e o download automático.
- **`tipo: porteiro`** — vigia a **porta do grupo**, reagindo a eventos de moderação e movimentação de participantes, sem depender de nenhuma mensagem digitada.

Três proteções valem sempre para vigias, e **não dá para desligar**: o bot nunca reage à própria mensagem enviada por ele, nunca a mensagens de status ou transmissão, e nunca a canais. Sem isso, dois bots num mesmo grupo entrariam em laço eterno.

### O porteiro e eventos de grupo

Um porteiro observa as ações de grupo declaradas na linha `quando for:`:

- `entrou` — alguém entrou no grupo ou foi adicionado
- `saiu` — alguém saiu por conta própria ou foi expulso
- `promoveu` — participante virou administrador
- `rebaixou` — administrador perdeu o cargo
- `mudou o nome` — o título do grupo foi alterado

Exemplo real de porteiro no `.lcn`:

```lcn
automação porteiro-anti-intruso
  tipo: porteiro
  quando for: entrou
  pool: pool-padrao

  se var target_group_member autorizado != "sim"
    remove do grupo
      quem: quem foi marcado
      nunca o dono: sim
```

No porteiro, as variáveis de alvo (`var.target` e `var.targetMember`) apontam automaticamente para o participante que sofreu a ação. O sistema resolve de forma transparente tanto números de telefone comuns quanto participantes identificados internamente pelo WhatsApp via LID (`lidMap`).

Como um porteiro observa a porta e não mensagens, o compilador **recusa com erro explicativo** qualquer campo de mensagem que alguém tente colocar nele (como `dispara com`, `acessa`, `argumentos`, `com link`, `precisa de um link` ou `menu`).

#### Por que `grupo_ativo` vale para o porteiro

Em conversas coletivas, o bot exige autorização prévia do proprietário através da variável `grupo_ativo = "sim"`.

Essa trava de segurança **vale obrigatoriamente para o porteiro**. O motivo é consequência, não medição: se o porteiro agisse em qualquer grupo sem conferir `grupo_ativo`, bastaria alguém adicionar o número do bot a um grupo qualquer (um grupo de família ou da empresa) para que o bot começasse imediatamente a agir e expulsar pessoas sem que o dono tivesse autorizado sua presença ou operação ali.

---

## Fila de execução, prioridade e recusa

Todas as mensagens e ordens de envio passam pela fila de execução local do socket WhatsApp. O recurso disputado é a própria conexão com a rede, que engasgaria se dezenas de tarefas disputassem o canal ao mesmo tempo.

No cabeçalho da automação, você declara como ela se comporta nessa fila:

### Prioridade (`prioridade:`)

A linha `prioridade:` define quem passa primeiro quando a fila está disputada: `baixa`, `normal` (o padrão se omitido), `alta` e `muito alta`.

A pergunta que decide a prioridade é: **"se este trabalho esperar, o que se perde?"**.

- **Urgência é perecibilidade**: capturar uma visualização única é `muito alta` porque a mídia expira e deixa de existir no servidor do WhatsApp se não for recolhida a tempo; nenhuma repetição posterior resolve.
- **Peso não é urgência**: baixar um vídeo grande é `baixa`. O arquivo é pesado no orçamento de dados, mas o link continuará na internet amanhã — o trabalho pode esperar.

Separar perecibilidade de peso impede uma inversão desastrosa: se arquivo pesado ganhasse prioridade pelo tamanho, um vídeo longo furaria a fila de uma mensagem rápida só por ser pesado.

### Sem vaga na fila (`sem vaga:`)

Quando a fila atinge a capacidade máxima de tarefas pendentes, ela precisa recusar requisições antes de começar a processar. O campo `sem vaga:` define essa reação:

- `descarta` (padrão) — encerra a execução calado, anotando o motivo em Execuções.
- `"texto entre aspas"` — envia uma única mensagem de texto pela mesma fila avisando quem chamou que o sistema está momentaneamente sobrecarregado.

#### Por que `tenta de novo` é recusado pelo compilador

Se você tentar escrever `sem vaga: tenta de novo`, o compilador rejeita o arquivo com erro:

> *"ainda não sei "tenta de novo": reexecutar depende de um agendamento que sobreviva a reinício, e ele não existe. Use "descarta" ou um texto entre aspas para avisar."*

O motivo é honestidade arquitetural: no protocolo de mensagens e no motor, uma execução só termina em **enviado**, **falhou** ou **resultado incerto** — não existe um estado "agendado". Tentar reexecutar com temporizadores soltos na memória (`setTimeout`) apenas trocaria dez mil pedidos esperando na fila por dez mil relógios vivos ocupando memória, gerando a mesma sobrecarga sob outro nome, e qualquer reinício do servidor perderia essas tentativas em silêncio. Primeiro precisará existir um agendador persistido no banco de dados; a palavra na linguagem só nascerá depois dele.

---

## Variáveis e contadores

Variáveis guardam informação entre mensagens: quantos avisos alguém levou, se é
cliente VIP, quantas vezes um comando foi usado.

Você cria e edita na aba **Dados**, buscando o contato ou grupo. E usa nos
comandos escrevendo o nome entre chaves. A aba **Variáveis** lista tudo que
existe, com um botão de copiar em cada.

### Onde a variável mora

Essa é a parte que mais importa acertar:

| Escopo | Vale para | Exemplo |
|---|---|---|
| `var.chat` | a conversa atual | apelido do grupo |
| `var.sender` | quem enviou, em qualquer conversa | nível da pessoa |
| `var.member` | quem enviou, **só naquele grupo** | avisos naquele grupo |
| `var.target` | quem foi mencionado ou respondido | nível de quem levou o `/adv` |
| `var.targetMember` | o mencionado, **só naquele grupo** | avisos que você aplicou nele |
| `var.category` | um grupo de pessoas | consultas usadas pelos VIPs |
| `var.global` | o sistema todo | total de comandos executados |

Para punição quase sempre se quer `member` ou `targetMember`: três avisos num
grupo não devem somar com os de outro.

Um contador que nunca existiu **não vale zero** — ele simplesmente não existe.
Isso é de propósito: uma regra do tipo "avisos maior ou igual a zero" não pode
punir quem nunca fez nada.

### Cálculos e aritmética (`calcula`)

Além de definir e somar números inteiros, uma automação pode realizar contas matemáticas com a ação **`calcula`** (como demonstrado no template `calcular-total.lcn`).

A sintaxe é:

```text
calcula <escopo> <chave> = <operando1> <operador> <operando2>
```

Os operadores permitidos são `+`, `-`, `*` e `/` (também aceita os símbolos `×` e `÷`). A linguagem exige **uma única operação por linha**: sem regras de precedência escondidas em strings complexas.

```lcn
calcula local total = evento argumentos.preco * evento argumentos.quantidade
calcula local metade = evento local.total / 2
responde "Total: {{local.total}} (metade: {{local.metade}})"
```

Os operandos podem ser:
- Números literais: `12.5`, `-3`, `0.5`
- Textos contendo números: `"12.5"`
- Variáveis gravadas: `var chat preco`, `var sender saldo`, `var category:loja desconto`
- Valores do evento ou cálculos anteriores: `evento argumentos.preco`, `evento local.total`

#### O escopo `local`

Ao calcular, você pode gravar o resultado em variáveis persistentes (`chat`, `sender`, `member`, etc.) ou no escopo **`local`**.

O escopo `local` vale **estritamente durante aquela execução**:
- Não grava nenhum atributo no banco de dados.
- Não vaza para mensagens posteriores nem para outras conversas.
- Permite reutilizar o valor em ações seguintes (`{{local.total}}`), em novos cálculos e em condições (`se evento local.total > 100`).
- É repassado inclusive em chamadas externas assíncronas encadeadas (`chama`), permitindo que a resposta retomada use os valores calculados antes da chamada.

#### Divisão por zero e rollback

Se um cálculo tentar dividir por zero (`1 / 0` ou `1 / -0`), usar operandos ausentes ou tentar operar sobre valores não numéricos, a execução é interrompida imediatamente com erro (`status: 'error'`).

O motor executa o fluxo com **rollback**:
- Todas as gravações em variáveis feitas durante aquela execução são canceladas e desfeitas no banco.
- Nenhuma mensagem parcial é enviada para a conversa — inclusive respostas que vinham antes do cálculo no mesmo fluxo são descartadas.
- O motivo exato da falha (ex.: *"divisão por zero"*) fica registrado na aba **Execuções** para diagnóstico.

O interpolador de texto continua sendo uma substituição pura (`{{local.total}}`): ele nunca avalia expressões matemáticas dentro das chaves (como `{{local.a * 2}}`), garantindo previsibilidade absoluta.

### Respostas numeradas (`numeração: sim`)

A ação `responde` aceita o modificador **`numeração: sim`** (como demonstrado no template `lista-numerada.lcn`).

```lcn
responde "{{var.chat.itens}}"
  numeração: sim
```

- **Apresentação, não mutação**: a numeração é aplicada após a montagem do texto e a interpolação das variáveis. Ela não altera o dado gravado na variável.
- **Espaçamento preservado**: linhas em branco são ignoradas pela contagem, preservando o layout visual do texto. Cada linha com conteúdo recebe o prefixo `1. `, `2. `, etc.
- **Sem limite artificial**: não há teto fixo de itens para a numeração no código.

---

## Decidir entre dois caminhos

Uma automação pode comparar um valor e seguir por caminhos diferentes. É o que
permite a moderação progressiva:

> ao detectar um link: apaga a mensagem, soma 1 no contador de avisos daquela
> pessoa naquele grupo, e **se** o contador chegou a 3, remove do grupo; **senão**,
> só avisa.

Quantos avisos até remover é um campo que você preenche na instalação, não algo
fixo no código. Se quiser só apagar e avisar, sem nunca remover, é só usar um
número alto.

A comparação entende número como número: `10` é maior que `3`, e não o
contrário — o que aconteceria se comparasse como texto.

No `.lcn`, dois espaços formam um nível. Um `se` pode conter outro `se`,
e condições no mesmo nível executam em sequência. Ao terminar o ramo escolhido,
o fluxo continua no próximo passo daquele nível:

```text
  se evento message.text contém "link-proibido.example"
    apaga mensagem
    soma group_member avisos = 1
  se var group_member avisos >= 3
    remove do grupo
      quem: quem enviou
      nunca o dono: sim
  senão se var group_member avisos >= 1
    se evento sender.isAdmin == false
      responde "Você já recebeu aviso neste grupo."
```

`senão se` testa outra condição apenas quando as anteriores forem falsas.
Equivale a colocar um `se` dentro do `senão`, com menos indentação. O ramo
falso pode faltar, e o verdadeiro pode ficar vazio se o falso tiver ação;
os dois vazios são recusados. Voltar à indentação anterior encerra o ramo.

O padrão é **32 condições aninhadas**. Cada `senão se` conta mais um nível
lógico; condições em sequência não acumulam profundidade. A instalação pode
ajustar `LCN_MAX_PROFUNDIDADE_CONDICOES` para qualquer inteiro positivo, e
uma chamada ao compilador pode usar `compilar(texto, { maxProfundidade: 64 })`.
O erro informa a linha, a profundidade atingida e o limite configurado.

O grafo continua tendo um único gatilho e nenhum ciclo: os ramos só avançam
ou reencontram a continuação. A publicação mantém a rejeição de ciclos.
Os blocos compostos guardam `flow.structure`, metadado opcional validado contra
as arestas, para preservar a indentação e a escolha entre `senão se` e `senão`
com `se` dentro. O avaliador executa as arestas; o metadado serve à edição.

---

## Botões de resposta rápida (`responde com botões`)

Para conversas em que a pessoa precisa escolher uma opção sem digitar texto longo, o bot pode responder com botões de resposta rápida (template `botoes-escolha.lcn`):

```lcn
responde com botões "Escolha uma das opções abaixo:"
  botão "Opção 1": "/opcao1"
  botão "Opção 2": "/opcao2"
  botão "Opção 3": "/opcao3"
  rodapé: "Toque em uma opção"
  senão: "Opções: 1. Opção 1 (/opcao1), 2. Opção 2 (/opcao2), 3. Opção 3 (/opcao3)"
```

- **Limite da plataforma**: o WhatsApp aceita no máximo **3 botões** de resposta rápida (`quick_reply`). O compilador recusa automações com mais de 3.
- **Texto alternativo (`senão`)**: enviado se o aplicativo de quem recebe não suportar mensagens interativas ou se houver falha de rede.

### Como o comando descobre a escolha

Quem toca no botão **não executa uma ação mágica local**:
1. Ao tocar no botão, o aplicativo do usuário envia o comando configurado (ex.: `/opcao1`) de volta para o chat como uma **mensagem de texto comum**.
2. O bot recebe essa mensagem exatamente como se a pessoa a tivesse digitado no teclado.
3. Essa mensagem casa com o gatilho da automação correspondente (ex.: `dispara com: /opcao1`), que executa a próxima etapa.

Por isso, ao desenhar um fluxo com botões, **crie e publique os comandos de destino antes** de montar a mensagem com os botões.

#### Honestidade sobre renderização de botões

Mensagens interativas dependem diretamente do suporte da versão do WhatsApp do destinatário. Se o WhatsApp aceitar a mensagem mas o celular da pessoa descartar silenciosamente por não conseguir desenhar botões, nenhum erro é retornado pelos servidores da Meta — o envio consta como sucesso e a tela do usuário não mostra nada. O texto alternativo (`senão`) atua como proteção automática nos casos de falha de rede.

---

## Carrossel interativo do acervo (`mostra carrossel`)

Você pode exibir galerias visuais navegáveis com botões individuais em cada item sem depender de nenhuma API ou serviço externo (template `carrossel-fotos.lcn`).

Pode ser montado de duas formas:

### 1. A partir de uma pasta do acervo

Apontando para uma pasta de imagens já existente no acervo local:

```lcn
mostra carrossel "Confira nossas fotos:"
  pasta: "fotos"
  botão: "Ver detalhes"
  comando: "/detalhes {{nome}}"
  rodapé: "Deslize para ver mais"
  estilo: completo
  sem arquivo: "Nenhuma foto encontrada na pasta."
  senão: "Não foi possível exibir o carrossel interativo."
```

O comando do botão aceita variáveis do item, como `{{nome}}`, `{{id}}` e `{{caminho}}`.

### 2. Com cards declarados manualmente

Montando cards individualmente no próprio comando:

```lcn
mostra carrossel "Nossos Destaques:"
  card
    arquivo: "produtos/tenis.jpg"
    título: "Tênis Esportivo"
    corpo: "R$ 299,00"
    rodapé: "Pronta entrega"
    botão: "Comprar": "/comprar tenis"
  card
    arquivo: "produtos/camisa.jpg"
    título: "Camisa Dry"
    corpo: "R$ 89,00"
    botão: "Comprar": "/comprar camisa"
  rodapé: "Deslize para ver os itens"
  estilo: completo
  senão: "Veja nossos produtos no site."
```

### Carregamento tardio e orçamento de memória

As fotos do carrossel são lidas do disco sob demanda uma a uma. O sistema reserva cota no orçamento de mídia antes de alocar memória e libera os bytes imediatamente após o upload para o servidor do WhatsApp. Nenhuma pasta inteira é mantida na memória simultaneamente.

---

## Pacote de figurinhas (`envia pacote`)

Permite empacotar figurinhas do acervo e enviá-las de uma só vez (template `pacote-figurinhas.lcn`):

```lcn
envia pacote "Figurinhas VIP"
  pasta: "figurinhas"
  autor: "Meu Bot"
  forma: pacote
  legenda: "Aqui está o seu pacote de figurinhas!"
  sem arquivo: "Nenhuma figurinha encontrada."
  senão: "Não foi possível entregar o pacote."
```

### As três formas de envio

1. **`forma: pacote`** — tenta o envio nativo via protocolo do WhatsApp (`stickerPackMessage`).
2. **`forma: arquivo`** — gera e envia um arquivo compactado no formato `.wastickers`. O destinatário toca no documento para abrir em aplicativos populares de figurinhas (como o Sticker Maker Studio) e importar no WhatsApp.
3. **`forma: diagnóstico`** — envia as duas formas numeradas em sequência na mesma conversa para que você possa conferir no aparelho qual método funciona melhor.

### Limite de 30 figurinhas e aviso honesto

- O WhatsApp limita pacotes a no máximo **30 figurinhas**.
- **O envio nativo NÃO foi medido em aparelho real neste projeto**: a biblioteca expõe a função de protocolo para envio de pacote nativo, mas ainda não foi aferido em aparelho de usuário se o aplicativo oficial do WhatsApp aceita a instalação direta de pacotes nativos enviados em conversas comuns. Como o WhatsApp costuma descartar em silêncio mensagens interativas não homologadas sem acusar erro, a opção `forma: pacote` tenta o caminho nativo e **cai automaticamente para o arquivo `.wastickers`** caso o envio seja rejeitado.

---

## Ciclo de vida de arquivos no acervo

Pela própria linguagem `.lcn`, comandos podem gerenciar arquivos e notas de texto no acervo local, fechando o ciclo junto de `guarda no acervo`:

### Criar nota de texto (`cria texto no acervo`)

Grava um arquivo de texto a partir do que o usuário digitou ou de variáveis do sistema (template `criar-nota.lcn`):

```lcn
cria texto no acervo "notas/recibo.txt"
  conteúdo: "{{message.args}}"
  descrição: "Criado por {{sender.name}}"
  confirma: "Nota salva em {{caminho}}!"
  erro: "Falha ao salvar: {{erro}}"
```

**Tratamento especial para arquivos de texto**: arquivos salvos com `kind: 'text'` no acervo têm uma característica única: ao serem reenviados por um comando usando `envia arquivo`, eles são entregues como **mensagem de texto comum** no chat do WhatsApp, e não como um anexo de arquivo para download.

### Sobrescrever arquivo mantendo o ID (`sobrescreve no acervo`)

Atualiza o conteúdo de uma nota existente ou de uma mídia (template `atualizar-nota.lcn`):

```lcn
sobrescreve no acervo "notas/recibo.txt"
  conteúdo: "{{message.args}}"
  confirma: "Arquivo atualizado com sucesso!"
  sem arquivo: "Arquivo não encontrado para atualização."
  erro: "Erro ao atualizar: {{erro}}"
```

**Por que manter o ID é indispensável**: outros comandos e rotinas podem referenciar um arquivo pelo seu identificador único estável (`fileId`). Se a atualização apagasse e recriasse o arquivo, geraria um novo ID, quebrando todas as referências existentes em silêncio.

### Apagar arquivo (`apaga do acervo`)

Remove definitivamente um arquivo do acervo pelo caminho ou ID (template `apagar-arquivo.lcn`):

```lcn
apaga do acervo "notas/recibo.txt"
  confirma: "Arquivo removido com sucesso!"
  sem arquivo: "Arquivo inexistente."
  erro: "Não foi possível apagar: {{erro}}"
```

**Sem remoção silenciosa**: se o arquivo não existir, o comando emite o aviso de `sem arquivo` e interrompe com erro. Silêncio diante de um arquivo que não foi apagado é o pior modo de falha. Além disso, o sistema analisa dependências e emite um alerta caso outros comandos publicados dependam daquele arquivo.

### Enviar mídia como visualização única

Ao enviar fotos, vídeos ou áudios com `envia arquivo`, você pode declarar:

```lcn
envia arquivo "segredos/foto.jpg"
  visualização única: sim
```

Isso envia a mídia como efêmera (visualização única) no WhatsApp.

#### O limite honesto da visualização única

Isto é um **PEDIDO** ao aplicativo de quem recebe, e **NÃO uma garantia absoluta de privacidade**:
1. Aplicativos modificados do WhatsApp ignoram o pedido e salvam a mídia no aparelho de qualquer maneira.
2. Este próprio sistema possui comandos como `/x9`, `/recover` e a rotina de download automático construídos justamente para recuperar mídias enviadas dessa forma.

Nunca prometa sigilo inviolável ao usar esse recurso.

---

## Consultar um serviço externo (conexões)

Uma automação pode consultar uma API externa — para baixar uma mídia, pedir uma
resposta a uma IA, converter figurinhas ou buscar opções na internet.

### Por que o endereço não vai no comando

Uma automação nunca escolhe o endereço de internet por conta própria. O endereço,
o método HTTP, a credencial e o formato da resposta vêm da declaração feita na
aba **Conexões** do painel web.

Isso é de propósito por dois motivos:

1. **Segurança**: se o comando pudesse receber qualquer URL para fazer requisições
   HTTP na web, um usuário qualquer na conversa poderia tentar acessar a rede
   interna do servidor (SSRF). Com a conexão declarada pelo dono, o destino é fixo.
2. **Segredo isolado**: a credencial (Bearer, cabeçalho próprio ou parâmetro na URL)
   fica guardada na conexão, não no comando. Quem cria a automação só nomeia a
   função. E se o serviço falhar, o bot não vaza endereços internos nem chaves na
   conversa.

Na linguagem `.lcn`, a ação é escrita com a palavra **`chama`**, apontando para
`<conexão>.<função>`. As entradas vão em um bloco **`com`**:

```lcn
chama midia.musica
  com
    busca: "{{message.args}}"
    audio_ext: "m4a"
  avisa: "🎵 Procurando e baixando…"
  entrega: separado
  cita: quem pediu
  erro: "Não consegui baixar essa música: {{erro}}"
```

Esse é um exemplo real do catálogo: o template `tocar-musica` (comando `/play`).
Ele envia o termo digitado para a função `musica` da conexão pronta `midia`.

Outros exemplos reais no catálogo são o `baixar-midia` (comando `/dow`, que
chama `midia.baixar` passando o link) e o `buscar-musica` (comando `/buscar`,
que chama `midia.buscar` para achar opções).

### O que o executor faz de verdade

Quando a automação executa o `chama`, o executor de conexão (`conexaoExecutor.js`)
assume o trabalho pesado no gateway:

- **Autenticação tipada**: injeta a chave configurada na declaração (Bearer,
  cabeçalho customizado ou parâmetro na URL) e impede que a credencial seja
  enviada a origens externas diferentes da configurada.
- **Envio de arquivos**: se a função declara entradas de mídia (como converter uma
  foto em figurinha ou remover fundo), o corpo vira `multipart/FormData`
  automaticamente. A linguagem permite definir de onde vem cada arquivo (`a mídia`,
  `a mídia citada`, `a mídia anexada` ou `o resultado` de uma chamada anterior em
  sequência).
- **Acompanhamento de tarefas assíncronas (jobs)**: quando o processamento demora
  (como download de vídeos ou conversões pesadas), o serviço devolve um identificador
  de trabalho (`forma: trabalho`). O executor consulta o estado periodicamente
  até terminar ou atingir o tempo limite, sem travar o motor.
- **Orçamento de mídia e envio seguro**: arquivos baixados passam por limites de
  tamanho e memória. Se um post trouxer várias mídias e apenas uma estourar o
  teto do WhatsApp, o executor entrega as que couberem e avisa quantas ficaram
  fora, em vez de falhar a resposta inteira.
- **Carrossel interativo e listas**: para funções que devolvem listas (como o
  `/buscar`), a resposta pode virar um **carrossel** de cards no WhatsApp, com
  capa, título, texto e um botão em cada card. O executor busca as capas, alinha a
  altura dos cards para o carrossel não quebrar a visualização e coloca no botão o
  comando com o link daquele item (ex.: `/musica {{url}}`), permitindo que a pessoa
  toque e baixe sem que o bot precise guardar estado na conversa. Se o aplicativo
  da pessoa não desenhar mensagens interativas, a lista cai de forma transparente
  para texto.
- **Respostas imediatas em arquivo ou texto**: conversões rápidas de segundos
  podem retornar o arquivo direto em base64 (`forma: arquivo`) ou extrair campos
  específicos do JSON (`forma: texto` e `forma: lista`).
- **Diagnóstico sem vazar topologia**: se o serviço externo cair ou recusar a
  credencial (401/403), quem usou o comando recebe uma frase limpa informando a
  instabilidade temporária, sem expor IPs ou caminhos internos. Já mensagens de
  erro informativas geradas pela própria API (como "termo longo demais") chegam
  direto à conversa se a conexão indicar o campo do erro.

---

## Dono do bot

Alguns comandos só devem responder a você. Marque contatos como **donos** e use
a opção de comando restrito.

O caso que isso resolve: o número da empresa roda o bot, e o **seu contato
pessoal** é dono. Aí você configura tudo mandando mensagem para o número da
empresa, sem precisar estar com aquele aparelho.

Enquanto nenhum dono estiver cadastrado, comandos restritos respondem **somente
a mensagens do próprio número** — é assim que se cadastra o primeiro dono pelo
WhatsApp, sem deixar o comando aberto a estranhos nesse meio-tempo.

---

## O menu

O `/menu` mostra os comandos disponíveis **naquela conversa** — cada grupo vê só
o que vale nele.

Um comando só aparece no menu se você tiver dado a ele um rótulo de menu. Regras
automáticas e porteiros não aparecem, porque ninguém os digita.

Dá para configurar por conversa:

- **Texto** — cabeçalho e rodapé próprios de cada grupo
- **Formato** — lista simples ou com botões
- **Numeração** — com `numeração: sim`, os comandos são exibidos como lista numerada (`1. /cmd1`, `2. /cmd2`), mantendo cabeçalho e rodapé limpos. No menu com botões, a numeração entra no rótulo visual preservando o ID do comando para que o toque continue funcionando.
- **Padrão** — um texto para todos os grupos e outro para o privado

O comando de configuração faz isso pelo próprio WhatsApp, sem abrir o painel — e
é restrito ao dono.

---

## Gerenciar automações: Tirar do ar, Apagar e Revisões

A aba **Automações** do painel web oferece controle completo sobre o ciclo de vida de cada regra, e a aba **Execuções** registra o histórico detalhado do que aconteceu (qual automação, em qual conversa e com qual resultado).

### "Tirar do ar"

Ao clicar em **Tirar do ar**, a automação é despublicada e **para de responder imediatamente** nas conversas:
- O histórico de execuções na aba Execuções permanece intacto para fins de auditoria.
- As revisões anteriores continuam guardadas no banco de dados.
- **Por que "Tirar do ar" e não "Despublicar"**: quem usa o painel faz uma pergunta prática de operação: *"o comando para de responder na conversa?"*, e não uma pergunta técnica sobre o estado da linha no banco relacional.

### "Apagar"

Remove permanentemente a automação do sistema:
- **Proteção de histórico (HTTP 409)**: uma automação que já executou com efeito real (`status != 'no_match'`) **não pode ser apagada**, pois os registros da aba Execuções dependem dela para auditoria. Ao tentar apagar, o painel avisa: *"Esta automação já executou X vez(es)... Para tirá-la do ar sem perder o histórico, use 'Tirar do ar' ou desligue a automação."*
- **Avaliações sem casamento (`no_match`) não bloqueiam**: se a automação apenas foi avaliada contra mensagens que não casaram com ela, esses registros são limpos automaticamente na exclusão, liberando a remoção de automações recém-instaladas que nunca agiram.

### "Revisões"

O botão **Revisões** exibe o histórico de versões daquela regra:
- Identifica qual revisão está em vigor (`Ativa agora`), quais são rascunhos (`Rascunho`) e quais estão arquivadas (`Inativa`).
- Permite inspecionar o código `.lcn` e o documento estruturado de cada versão anterior.

---

## O que ainda não existe

- **Vários números se revezando** para responder o mesmo comando. Hoje responde
  sempre o número que recebeu a mensagem.
