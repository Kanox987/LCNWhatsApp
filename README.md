# LCNWhatsApp

Plataforma de automação de WhatsApp que roda na **sua** máquina. Você cria
comandos por um painel web, sem escrever código, e o bot responde por eles.

O projeto começou como uma automação só: recuperar mídia de **visualização
única** e transcrever áudio. Isso continua funcionando exatamente como antes —
virou um dos comandos do catálogo, ao lado de vários outros.

Usa a biblioteca **zapo-js** para falar com o WhatsApp. Roda em Docker/Podman
ou direto na máquina, em Linux e macOS.

> ⚠️ **Você precisa responder a mensagem.** Na maioria dos casos o WhatsApp não
> entrega o conteúdo de uma visualização única direto para o bot — ele só chega
> se você **responder a mensagem** com o comando (de qualquer aparelho logado na
> sua conta). Em conversas marcadas em "Download automático", qualquer resposta
> sua já revela. Ver [docs/DOWNLOAD-AUTOMATICO.md](docs/DOWNLOAD-AUTOMATICO.md).

---

## O que dá para fazer

**Comandos prontos.** Um catálogo com comandos já configurados: `/ping`,
`/menu`, figurinha, recuperar visualização única, anti-link, anti-imagem,
anti-áudio, e outros. Você escolhe, preenche os campos e instala — o comando
passa a valer nos contatos e grupos que você marcar.

**Comandos seus.** Um assistente monta o comando passo a passo: quando executa,
onde vale, o que responde. Por baixo é sempre uma sequência de ações
auditadas — nunca código solto rodando no seu servidor.

**Regras automáticas.** Nem todo comando precisa de alguém digitar. Uma regra
pode reagir sozinha a um link, a uma foto ou a uma palavra: apagar a mensagem,
avisar, contar a infração e, depois de N vezes, remover a pessoa do grupo —
sendo que esse N é você quem escolhe.

**Memória por pessoa e por grupo.** Contadores e variáveis que você cria e o bot
atualiza: avisos, nível, saldo, "cliente VIP". Valem por contato, por grupo, por
pessoa dentro de um grupo específico, por categoria ou para o sistema todo.

**Menu diferente em cada conversa.** Cada grupo pode ter o próprio menu, com
texto próprio, em lista simples ou com botões. E dá para mudar esse texto pelo
próprio WhatsApp, sem abrir o painel.

**Dono do bot.** Você marca contatos como donos, e alguns comandos só respondem
a eles. Serve para o caso comum de uma empresa: o número da empresa roda o bot,
e o seu contato pessoal configura tudo de fora.

**Vários números.** Cada número roda isolado, em seu próprio container, com
limite de banda e recuperação automática quando a sessão cai.

---

## Instalação

```bash
cd LCNWhatsApp
sh install.sh
```

> ⚠️ **Não rode com `sudo`.** O instalador roda como o seu usuário —
> `config.json`, `sessao/`, `midia/`, `data/`, `node_modules` e o venv do
> faster-whisper ficam com o seu dono, não do root. O comando `lcn` vai para
> `~/.local/bin`. Só o que realmente mexe no sistema (instalar um pacote,
> criar link em `/usr/local/bin`) usa `sudo` pontualmente.

O instalador detecta se há Docker ou Podman e pergunta se você quer rodar em
container (recomendado) ou direto na máquina. Sem engine de container, segue
no modo direto.

No modo direto ele valida `node` e `npm` antes do `npm install`: recomendado
**Node.js 24 LTS**, mínimo **Node.js 22**. Se precisar, tenta preparar uma
versão compatível conforme a distribuição (Debian/Ubuntu, Fedora, RHEL, Arch,
openSUSE, Alpine, Amazon Linux, macOS via Homebrew), com `nvm` como último
recurso. Em Docker/Podman, o host não precisa de Node.

Detalhes e casos específicos: [docs/INSTALACAO.md](docs/INSTALACAO.md).

### Alguns comandos exigem mais

Figurinha precisa do **ffmpeg** instalado. Apagar mensagem e remover pessoas de
grupo exigem que o número seja **administrador** do grupo. O painel avisa isso
em cada comando, antes de você instalar.

---

## Os dois painéis

**No terminal**, o comando `lcn` abre o painel de sempre: parear o número,
configurar, ligar e desligar, ver o estado da conexão.

**Na web**, `lcn web start` sobe o painel em `http://127.0.0.1:4780` — é onde
você cria automações, instala comandos do catálogo, vê o histórico de execuções
e edita as variáveis de cada contato e grupo.

```bash
lcn engine start      # motor de automação
lcn web start         # painel web (porta 4780)
lcn instances list    # números administrados nesta máquina
```

> 🔒 O painel web escuta **somente em 127.0.0.1** e não tem login. Ele foi feito
> para a sua máquina, não para a internet — não exponha essa porta sem colocar
> autenticação na frente.

---

## Como funciona

1. **Um processo por número.** Cada número conectado roda isolado, com a própria
   sessão. Ele recebe as mensagens do WhatsApp e nunca compartilha sessão com
   ninguém.

2. **Um motor de automação separado.** O número repassa cada mensagem, já
   normalizada, para o motor local — que decide o que fazer comparando com as
   automações publicadas. O motor nunca abre uma sessão de WhatsApp e nunca
   recebe conteúdo de mídia: só uma referência que apenas o processo do número
   consegue resolver.

3. **A decisão volta como ordem.** Se alguma automação combinou, o motor devolve
   o que fazer, e o processo do número executa: responder, apagar, gerar
   figurinha, remover do grupo. Tudo fica registrado no histórico.

4. **Nada é executado duas vezes.** A mesma mensagem, reprocessada, não gera
   ação repetida. Quando o resultado de um envio fica ambíguo, o sistema marca
   como incerto em vez de reenviar por conta própria.

---

## Documentação

| Arquivo | Assunto |
|---|---|
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Instalação em detalhe, modos e requisitos |
| [docs/AUTOMACOES.md](docs/AUTOMACOES.md) | Comandos, regras automáticas, variáveis e donos |
| [docs/DASHBOARD.md](docs/DASHBOARD.md) | Painel do terminal |
| [docs/CONFIG.md](docs/CONFIG.md) | Todos os campos do `config.json` |
| [docs/TRANSCRICAO.md](docs/TRANSCRICAO.md) | Transcrição de áudio, local ou por API |
| [docs/DOWNLOAD-AUTOMATICO.md](docs/DOWNLOAD-AUTOMATICO.md) | Recuperar sem digitar comando |
| [docs/CONTAINER.md](docs/CONTAINER.md) | Docker e Podman |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Uso de recursos e limites |
| [docs/HARDWARE.md](docs/HARDWARE.md) | Limites de mídia e banda |
| [docs/ATUALIZACAO.md](docs/ATUALIZACAO.md) | Como atualizar |
| [docs/SOLUCAO-DE-PROBLEMAS.md](docs/SOLUCAO-DE-PROBLEMAS.md) | Quando algo não funciona |
| [docs/API.md](docs/API.md) | API local do motor |

---

## Testes

```bash
npm test
```

Roda a suíte inteira sem depender de WhatsApp real: banco em memória, servidor
HTTP local e dependências injetadas.

> Não deixe o bot rodando (`node index.js`) enquanto roda os testes — os dois
> escrevem nos mesmos arquivos em `data/` e atrapalham um ao outro.

---

## Aviso

Este projeto usa uma biblioteca não oficial para falar com o WhatsApp. Isso
não é homologado pela Meta e, em tese, pode levar a bloqueio da conta. Use com
o seu próprio número e por sua conta e risco.

Recuperar mídia de visualização única contorna uma expectativa de privacidade
de quem enviou. Use com responsabilidade e dentro da lei — a
responsabilidade pelo uso é sua.
