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

- **Chamar uma API externa** dentro de um comando. Está desenhado, mas ainda não
  implementado.
- **Reagir a alguém entrando no grupo** (boas-vindas, aceitar automaticamente).
- **Vários números se revezando** para responder o mesmo comando. Hoje responde
  sempre o número que recebeu a mensagem.
