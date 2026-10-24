# Automações

Como criar comandos e regras no LCNWhatsApp. Tudo aqui é feito pelo painel web
(`lcn web start`, em `http://127.0.0.1:4780`) — não é preciso escrever código.

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

Na aba **Automações**, o assistente pergunta:

1. **Identidade** — nome e como aparece no `/menu`
2. **Quando executa** — a palavra digitada, e se precisa ser exata
3. **Onde vale** — contatos e grupos (obrigatório)
4. **Quem responde** — qual número
5. **O que responde** — o texto, com variáveis se quiser
6. **Revisar** — em português, antes de publicar

---

## Regras automáticas

Nem toda regra precisa de comando digitado. Uma regra pode reagir sozinha a:

- **Tipo de mensagem** — foto, vídeo, áudio, documento
- **Link** — qualquer mensagem com endereço de site
- **Palavras** — uma lista que você define

É assim que funcionam o anti-link, anti-imagem e anti-áudio.

Três proteções valem sempre, e **não dá para desligar**: o bot nunca reage à
própria mensagem, nunca a status ou transmissão, e nunca a canal. Sem isso, dois
bots num mesmo grupo entrariam em laço.

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
automáticas não aparecem, porque ninguém as digita.

Dá para configurar por conversa:

- **Texto** — cabeçalho e rodapé próprios de cada grupo
- **Formato** — lista simples ou com botões
- **Padrão** — um texto para todos os grupos e outro para o privado

O comando de configuração faz isso pelo próprio WhatsApp, sem abrir o painel — e
é restrito ao dono.

---

## Histórico

A aba **Execuções** mostra o que aconteceu: qual automação, em qual conversa,
com qual resultado. Serve para entender por que algo respondeu — ou por que não
respondeu.

Uma automação que já executou não pode ser apagada, porque o histórico dela
depende disso. Para tirá-la do ar sem perder o registro, use **Despublicar**.

---

## O que ainda não existe

- **Reagir a alguém entrando no grupo** (boas-vindas, aceitar automaticamente).
- **Vários números se revezando** para responder o mesmo comando. Hoje responde
  sempre o número que recebeu a mensagem.
