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

Três formas, declaradas na função:

**`texto`** — a resposta vai para o WhatsApp como mensagem. É o caso de uma IA
ou de uma consulta de preço. O LCN lê um campo do seu JSON (o caminho é
declarado, ex.: `resposta.texto`).

**`trabalho`** — você não devolve o resultado na hora: devolve um
identificador, e o LCN pergunta até terminar. É o que o serviço de download
usa, e é a forma **exercitada em produção**.

**`mídia`** — resultado com arquivos **na mesma resposta**, sem protocolo de
acompanhamento. É a forma certa para quem converte em segundos: obrigar um
serviço de dois segundos a devolver identificador e aceitar consulta
complicaria o seu lado sem ganhar nada. Você devolve a lista de arquivos no
campo declarado, e o LCN busca cada um.

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

## O exemplo completo: converter figurinha

Hoje a figurinha é feita com **ffmpeg instalado na mesma máquina do número** —
programa de fora, que o LCN não controla. A Visão geral do painel mostra se ele
está lá, e os números da conversão são configuráveis por comando. Mas a
dependência continua sendo local.

O caminho decidido é outro: **quem quiser o serviço, usa uma API.** O lado do
LCN está pronto; abaixo o contrato do outro lado.

### A função

```
POST /figurinha
Authorization: Bearer <chave>
Content-Type: multipart/form-data

  arquivo       a foto ou o vídeo, em bytes
  tamanho       lado em pixels      (96 a 1024, padrão 512)
  segundos      do vídeo            (1 a 30, padrão 6)
  qualidade     1 a 100             (padrão 80 foto / 50 vídeo)
  pesoMaximoKB  peso da figurinha   (64 a 10240, padrão 1024)
  pacote        nome do pacote      (opcional)
  autor         autor do pacote     (opcional)
```

Resposta, na forma `mídia` — tudo numa resposta só:

```json
{ "arquivos": [ { "url": "/arquivos/ab12.webp",
                  "mime": "image/webp",
                  "bytes": 48213,
                  "tipo": "figurinha" } ] }
```

E quando não der, o campo de erro declarado, com uma frase que serve para quem
usou o comando:

```json
{ "erro": "esse vídeo é longo demais para virar figurinha" }
```

Se a conversão for demorada o bastante para a requisição estourar os 20 s, use
a forma `trabalho` em vez desta — o contrato está acima.

### O que a API precisa garantir

**Saída em WebP, e nada mais.** Figurinha do WhatsApp é WebP: estática para
foto, **animada** para vídeo. Qualquer outro formato é recusado pelo aplicativo.

**512x512 mantendo a proporção.** A sobra entra como **transparência**, não
como esticamento. É o que o ffmpeg faz hoje com
`scale=...:force_original_aspect_ratio=decrease` mais `pad` com
`color=#00000000`.

**Respeitar o peso.** Acima de `pesoMaximoKB`, falhe dizendo **quanto deu e
quanto cabia** — é a diferença entre "tente baixar a qualidade" e "não
funcionou".

**Limite de entrada.** Recuse arquivo de entrada absurdo antes de chamar
ffmpeg, com motivo.

**O ganho que só a API tem:** o nome do pacote e o autor ficam gravados no EXIF
do WebP, e é o que o WhatsApp mostra quando alguém abre a figurinha. O caminho
local **não faz isso hoje** — as figurinhas saem sem pacote e sem autor. Se a
sua API escrever esse pedaço, o `/fig` ganha algo que ele nunca teve.

### Como o comando chama isso

A conexão declarada:

```
endereço:  http://127.0.0.1:8766
autenticação: bearer
função converter
  POST /figurinha
  entradas: arquivo (mídia), tamanho (número), qualidade (número), pacote (texto)
  resposta: mídia, campo "arquivos", erro em "erro"
```

E o comando, em `.lcn`:

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

  chama figurinha.converter
    com
      arquivo: a mídia
      tamanho: 512
      pacote: Meu pacote
    erro: "Não consegui converter: {{erro}}"
```

`arquivo: a mídia` é o que amarra as duas pontas. O arquivo **não** é escrito
como as outras entradas, e isso não é estilo: as outras passam pelo
interpolador de texto, e a mídia da mensagem é um **token opaco** que o motor
nunca resolve (invariante 4). Quem troca o token por bytes é o gateway, no
momento da chamada. Escrever `arquivo: "{{alguma coisa}}"` é recusado na
publicação, dizendo por quê.

A publicação também confere que os dois lados concordam: se a entrada de
arquivo da função se chama outra coisa, o comando é recusado com o nome certo
na mensagem — em vez de mandar o arquivo num campo que o serviço ignora.
