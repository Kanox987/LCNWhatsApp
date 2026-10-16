# Conexões — como escrever uma API que o LCN consegue usar

O LCN não acessa a web por conta própria. Toda consulta externa — download,
IA, automação de terceiro, painel de outro sistema — passa por uma **conexão
declarada** na aba Conexões do painel.

Quem declara é o dono: endereço, método, caminho, credencial e **quais funções
aquele serviço oferece**. A automação não monta requisição; ela chama uma
função pelo nome (`chama midia.baixar`). É isso que dispensa proteção contra
SSRF — o comando não escolhe para onde a chamada vai.

Este documento é para quem vai **escrever a API do outro lado**.

---

## O contrato, em uma página

### A requisição que o LCN manda

| | |
|---|---|
| Método | o que a função declarar: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| Corpo | `POST`/`PUT`/`PATCH`: JSON com as entradas declaradas. `GET`/`DELETE`: as entradas vão na query |
| `Content-Type` | `application/json`, ou `multipart/form-data` quando a função recebe arquivo |
| Credencial | `Authorization: Bearer <chave>`, ou um cabeçalho seu, ou um parâmetro na URL — o que a conexão declarar |
| Timeout | **20 s por requisição** |

As entradas são tipadas: `texto`, `número`, `opção` (lista fechada) e
`liga/desliga`. Entrada com padrão declarado é preenchida pelo LCN quando a
automação não informa.

Existe um quinto tipo, diferente dos outros em natureza: **`mídia`**. Ele não
leva um valor, leva o **arquivo da mensagem** — a foto, o vídeo ou o áudio que
chegou pelo WhatsApp, mandado junto com o comando ou numa mensagem respondida.

Quando a função declara uma entrada de mídia, o corpo da requisição deixa de
ser JSON e vira **`multipart/form-data`**: o arquivo no campo declarado, os
outros campos como texto no mesmo corpo. O `Content-Type` carrega o boundary
gerado na hora — não presuma um valor fixo.

Uma entrada de mídia por função (uma mensagem traz uma mídia), e nunca em `GET`
ou `DELETE`, que não têm corpo. As duas coisas são recusadas quando você
declara, não na primeira chamada.

### A resposta que o LCN entende

Cinco formas, declaradas na função:

**`texto`** — a resposta vai para o WhatsApp como mensagem. É o caso de uma IA
ou de uma consulta de preço. O LCN lê um campo do seu JSON (o caminho é
declarado, ex.: `resposta.texto`).

**`trabalho`** — você não devolve o resultado na hora: devolve um
identificador, e o LCN pergunta até terminar. É o que o serviço de download
usa, e é a forma **exercitada em produção**.

**`arquivo`** — **um** arquivo, na própria resposta, em base64 dentro do JSON.
É a forma certa para quem converte em segundos: obrigar um serviço de dois
segundos a devolver identificador e aceitar consulta complicaria o seu lado sem
ganhar nada. Você declara em que campo o conteúdo vem (`arquivo_base64`), em
qual o tipo (`mime`), e, quando a saída é sempre a mesma coisa, **como ela deve
ser enviada** (`figurinha`, `foto`, `vídeo`, `áudio`, `documento`). Sem esse
último, o tipo sai do `mime` — que é o certo para uma função de conversão, onde
a saída depende do formato pedido.

**`mídia`** — vários arquivos, apontados por endereço. Você devolve uma lista no
campo declarado e o LCN busca cada um, com a mesma credencial. É a forma de um
serviço que produz um carrossel.

**`lista`** — a resposta traz **várias opções para a pessoa escolher**, e o LCN
manda um texto numerado. É a forma de uma busca: "evidências" tem a versão do
Chitãozinho, a do Bruno & Marrone e uma dúzia de covers, e mostrar a lista antes
evita gastar um download no resultado errado.

Você devolve a lista num campo e o LCN **não decide quais campos aparecem** —
isso é declarado, porque quem sabe o que o seu serviço devolve é você:

```json
{ "busca": "evidencias",
  "achados": [
    { "titulo": "Evidências", "autor": "Chitãozinho & Xororó",
      "duracao_texto": "4:59", "url": "https://..." }
  ] }
```

```
campo:      achados
linha:      *{{n}}.* {{titulo}}\n_{{autor}} · {{duracao_texto}}_\n{{url}}
cabecalho:  🔎 Achei isto para "{{busca}}":
vazio:      Não achei nada com esse nome.
limite:     5
```

- `{{n}}` é o número do item — é ele que faz "manda o 2" ser uma frase possível.
- Os outros marcadores são campos **do item**; no cabeçalho, campos da resposta
  inteira.
- Marcador que não encontra valor **fica literal** na mensagem (`{{preco}}`).
  É de propósito: quem declarou vê qual campo errou, em vez de uma linha que
  parece certa com um pedaço faltando.
- `vazio` é a frase de "não achei nada". Sem ela, lista vazia responde um padrão
  genérico — e lista vazia é resposta normal de busca, não erro.
- `limite` corta quantos itens aparecem. Vazio mostra todos os que vierem.

### A forma `trabalho`, campo por campo

Cada campo abaixo é declarado na conexão, não fixo no código do LCN — você
escolhe os nomes, e o painel aprende.

```
POST {endereço}{caminho}        -> { "<campoDoTrabalho>": "abc123" }
GET  {endereço}{acompanhamento} -> { "<campoDoEstado>": "...",
                                     "<campoDoResultado>": [ ...arquivos... ],
                                     "<campoDoErro>": "mensagem curta" }
```

- `caminhoDeAcompanhamento` aceita um molde: `/jobs/{job}`. O que estiver entre
  chaves é trocado pelo identificador.
- `estadosEmAndamento` é a lista de estados que significam **"ainda não
  acabou"**. Qualquer estado fora dessa lista **encerra** a espera. Isto é de
  propósito: girar num estado que esta versão não conhece é pior que parar e
  dizer o que veio.
- `campoDoErro` preenchido encerra a chamada como erro, e **o texto vai para a
  pessoa no WhatsApp**. Escreva uma frase curta e útil ("esse link é de um post
  privado"), nunca stack trace nem endereço interno.
- `campoDaDescricao` é de onde sai o **texto que acompanha o que foi entregue**.
  O padrão é `descricao`, que serve a um post (a legenda do post É a descrição
  dele). Em música a mesma chave traz o texto que o YouTube gera sozinho —
  "Provided to YouTube by...", produtor, compositor — e o que a pessoa quer ver
  é o nome da faixa, que está em `titulo`. Declare o campo que serve ao SEU
  caso; quem sabe qual é é você.
- Espera máxima: **5 minutos**. As consultas são de 1,5 s e passam a 5 s depois
  dos primeiros 30 s.

Cada arquivo no resultado:

```json
{ "url": "/arquivos/ab12.webp", "mime": "image/webp", "bytes": 48213, "tipo": "imagem" }
```

- `url` relativa ao endereço da conexão, ou absoluta.
- `bytes` **antes** da transferência — é o que permite recusar um arquivo
  grande sem puxar 300 MB para descobrir no fim. Mande sempre.
- `tipo`: `video`, `audio`, `imagem` ou `figurinha`. O que não for
  classificado vai como documento. **`figurinha` importa**: ela não é "uma
  imagem com outro nome" — é outro tipo de envio no WhatsApp, sem legenda e sem
  miniatura. Sem dizer `figurinha`, o webp chega como foto.
- O LCN busca cada arquivo com a mesma credencial, por `GET`.
- Arquivo grande demais **não leva os outros junto**: num post de dez fotos,
  recusar tudo por causa de um vídeo entregaria zero foto.

---

## Regras que valem para qualquer API deste tipo

**Escute só no loopback.** O serviço de download recusa escutar fora de
`127.0.0.1`, e a razão vale para qualquer um que aceite entrada arbitrária: num
endereço de rede ele vira proxy aberto — alguém usa a sua máquina e a sua banda
para baixar ou converter o que quiser. Os dois containers compartilham o
loopback do host; foi assim que o bot e a API de download se falam hoje.

**Tenha timeout próprio.** O LCN desiste em 20 s por requisição e 5 minutos no
total. Um processo externo (ffmpeg, yt-dlp) sem timeout do seu lado fica
pendurado depois que o LCN já desistiu, e vai empilhando.

**Erro com duas faces.** O que vai no campo de erro declarado é lido por quem
usou o comando no WhatsApp. Diagnóstico (endereço, status, caminho de arquivo) fica no
seu log.

**Não deixe a configuração virar constante sua.** Se a função aceita tamanho,
qualidade ou duração, declare como **entrada** — senão o número só mudou de
dono: saiu do código do LCN e entrou no seu.

**Limpe os arquivos.** O LCN busca cada arquivo uma vez. Apague depois de
servir, ou dê um prazo curto.

---

## O exemplo vivo: a LCNimg

A **LCNimg** (`/home/administrator/LCNimg` na VPS, `http://127.0.0.1:8767`) é o
primeiro serviço declarado nesta forma, e a conexão `imagem` já vem pronta no
sistema. Cinco funções:

| função | o que faz |
|---|---|
| `figurinha` | foto, vídeo ou GIF → figurinha, com nome de pacote e autor |
| `figurinha_de_frase` | uma frase → figurinha (sem arquivo nenhum) |
| `converter` | troca o formato: mp3, png, mp4, ogg, gif… |
| `remover_fundo` | recorta o objeto e apaga o fundo |
| `melhorar` | aumenta resolução e reconstrói detalhe |

O que uma API precisa fazer para encaixar assim, no concreto:

**Receber o arquivo em multipart.** Campo com o nome que a função declarar
(`arquivo`), e os outros parâmetros como campos de texto no mesmo corpo.

**Devolver o arquivo em base64 no JSON**, com o tipo junto:

```json
{ "arquivo_base64": "UklGR…", "mime": "image/webp", "peso": "18,2 KB" }
```

A LCNimg devolve o arquivo cru por padrão e o JSON quando se pede
`resposta=json` — por isso a declaração tem uma entrada `resposta` com lista
fechada de um item (`json`). Lista de um item parece esquisito e é deliberado:
quem editar para outra coisa é recusado na publicação, em vez de descobrir na
primeira chamada.

**Explicar a falha numa frase que sirva a quem usou o comando.** Isto é o que
mais rende: o campo de erro declarado vai direto para o WhatsApp.

```json
{ "erro": "peso_excedido",
  "mensagem": "Ficou com 151,5 KB e o limite é 2,9 KB, mesmo em qualidade 15 e 8 fps. Encurte a mídia." }
```

"O serviço respondeu 422" não diz nada; a frase acima diz o que fazer. A única
exceção é `401`/`403`: credencial é configuração do dono, e a frase do serviço
não vai para a conversa — quem digitou não tem o que fazer com ela.

**Dizer `figurinha` quando for figurinha.** Um `image/webp` pode ser figurinha
ou foto, e o mime não separa os dois. Quem sabe é a função, e por isso ela
declara. Sem isso a figurinha chega como foto, com legenda e miniatura.

### Como o comando chama

```
automação fig
  nome: Figurinha
  tipo: comando
  dispara com: /fig
  acessa: texto, foto, vídeo
  casa: exato ou com argumentos
  quem: só externos
  precisa de uma mídia: na mensagem ou na citada
  sem ela: "Manda uma foto ou vídeo curto junto com o comando."

  chama imagem.figurinha
    com
      arquivo: a mídia
      pacote: LCN Figurinhas
      autor: LCN
      limite_bytes: 1048576
    avisa: "🎨 Convertendo…"
    erro: "Não consegui fazer a figurinha: {{erro}}"
```

`arquivo: a mídia` é o que amarra as duas pontas. O arquivo **não** é escrito
como as outras entradas, e isso não é estilo: as outras passam pelo
interpolador de texto, e a mídia da mensagem é um **token opaco** que o motor
nunca resolve (invariante 4). Quem troca o token por bytes é o gateway, no
momento da chamada. Escrever `arquivo: "{{alguma coisa}}"` é recusado na
publicação, dizendo por quê.

Entre aspas é texto; sem aspas e parecendo número, é número — `limite_bytes:
1048576` chega como número porque a entrada declarada tem tipo. Quem quer a
string escreve `"1048576"`.

A publicação confere que os dois lados concordam: se a entrada de arquivo da
função se chama outra coisa, o comando é recusado com o nome certo na mensagem,
em vez de mandar o arquivo num campo que o serviço ignora.
