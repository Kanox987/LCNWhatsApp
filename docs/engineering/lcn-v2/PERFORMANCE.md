# PERFORMANCE — linha de base medida, e o que ela não autoriza prometer

Parte **G** do relatório final. O pedido manda dar antes e depois **quando
houver**; onde não há segunda medição, este documento diz que não há, em vez de
extrapolar.

**Não confundir com [`docs/PERFORMANCE.md`](../../PERFORMANCE.md)**, que trata
de outra coisa: o descarte cedo na captura (`shouldIgnoreJid`, `passaFiltro`) e
as duas otimizações que já quebraram a captura. Aquele documento continua
valendo e não foi reescrito — este cobre a medição de consumo sob carga, que
não existia lá.

## A regra que vale acima de qualquer número aqui

> **Medir primeiro, prometer depois.**

Nenhum valor deste documento vai para `README.md`, para `docs/` de produto ou
para o painel. O arnês imprime esse aviso ele mesmo, no cabeçalho:

> "MEDIÇÃO DESTA MÁQUINA, COM ESTE NODE, SEM WHATSAPP REAL. Isto é um arnês
> comparativo interno, NÃO uma promessa de RAM para o produto."

A razão é do dono e segue de pé: existe um número conectado, e ele não está em
trabalho pesado. Número de repouso não autoriza promessa de pico.

## Como se mede, e com o que

| ferramenta | o que dá | o que NÃO dá |
|---|---|---|
| `npm run soak` | consumo sob carga sintética, com GC exposto, nesta máquina | nada do WhatsApp real |
| leitura de cgroup (`docker stats`) | o que o container de fato consome | atribuição por processo |
| `/proc/<pid>/status` por SSH | qual dos processos está crescendo | o total do container |

**Nenhum número de catálogo.** Nenhum "costuma usar X MB".

### E por que as duas primeiras discordam — 1,74x, provado

Medido em produção, lendo `/proc/<pid>/status` de cada processo Node dentro dos
containers:

| | soma dos RSS | cgroup | razão |
|---|---|---|---|
| LCNWhatsApp (3 processos) | 297,9 MiB | 142,3 MiB | 2,09x |
| LCNWhatsApp-pessoal (1 processo) | 202,9 MiB | 144,9 MiB | 1,40x |
| os dois | **500,7 MiB** | **287,2 MiB** | **1,74x** |

É o que o comentário em `src/state.js:92-98` já avisava, agora com número: três
processos Node compartilham o mesmo binário, a mesma V8, a mesma libc e as
mesmas páginas de `node_modules`. RSS conta página compartilhada **uma vez por
processo**; o cgroup conta cada página física uma vez.

**Consequência de desenho, e é o que o painel precisa dizer:** a soma por
processo serve para **atribuição** — saber qual dos três cresce. Ela **não** é a
resposta para "quanto este container consome". Essa é a do cgroup.

## O soak de 30 minutos, executado nesta leva

Ambiente: Node v22.23.4, V8 12.4.254.21, linux x64, `--expose-gc` ativo.
Duração planejada 30 min. Log: `soak-v3.log`. **Saída 0.**

### Os seis vereditos, todos PASSOU

| veredito | resultado |
|---|---|
| saldo do orçamento de mídia | **0 bytes retidos** — 1.512.960 MiB reservados, 1.512.960 MiB liberados em 14.184 operações; saldo fechou |
| mapa de esteiras por conversa | **0 chaves retidas após 59.355.312 conversas distintas** |
| `arrayBuffers` pós-GC | 0,10 → pico **280,11** → **0,10 MiB** (delta 0,0 KiB) |
| heap usado pós-GC | 24,25 → pico 44,42 → **22,52 MiB** (delta **−1,73 MiB**) |
| drenagem das filas | 0 pendentes, 0 em curso, 0 expiradas nas quatro filas |
| integridade | nenhum erro interno no motor nem no gateway |

### O número que mais importa não é o pico, é a inclinação

**Tendência linear do heap, após aquecimento: −0,511 MiB/min.** Negativa, ao
longo de 30 minutos e 59 milhões de conversas distintas.

Não é reta plana por sorte de amostra curta: em **todas** as amostras de minuto,
`chaves=0` e `orcamento=0 B`. O heap termina **menor** que começou.

### RSS ao longo do tempo, e por que ele oscila tanto

| momento | rss |
|---|---|
| 01m00s | 178,11 MiB |
| 09m00s | 425,61 MiB |
| 19m01s | 146,36 MiB |
| 28m06s | 406,39 MiB |
| final pós-GC | **146,71 MiB** |

A oscilação de 146 a 426 MiB acompanha o cenário em curso (`album-80`,
`instantaneas`, `50-grupos`, `motor-lento`), não uma deriva. O `ab`
(`arrayBuffers`) explica: 0,10 MiB nos vales, 200,10 MiB nos picos de álbum.

### O pico é escolha, não destino

Isto apareceu em medições anteriores e se confirma aqui: `arrayBuffers` bate
**exatamente** no orçamento configurado — 40 MiB de orçamento dão 40 MiB de
pico; 80 dão 80; 200 dão 200.

Então o teto de memória de mídia **é** o ajuste `hardware.orcamentoMidiaMB`, e
o que ele vale determina o pico. Isso inverte a pergunta: não é "quanto o
sistema consome", é **"quanto você quer deixar ele consumir"** — que é
exatamente a forma da frente E, e a razão de o teto ser do administrador e não
do código.

## O que o soak NÃO prova — impresso por ele mesmo

1. Não mede o gateway real falando com o WhatsApp, nem tráfego TCP/TLS de
   produção.
2. Não inclui outros processos (SQLite em disco, transcrição, SO) nem
   criptografia real.
3. Não garante devolução imediata de páginas de RSS pelo alocador C ao sistema
   operacional.
4. **Não constitui promessa de RAM de produto.**

## Segunda medição (frente K), 07/11/2026, código da `v3` em `e0e3735` (depois só mudou documentação)

Mesma máquina, mesmo Node (v22.23.4), mesmo arnês, 30 min, saída 0. Log:
`soak-v3c.log`. Uma primeira tentativa foi interrompida por engano (sinal 143) e **não conta**.

| veredito | 1ª medição (04/11) | 2ª medição (07/11) |
|---|---|---|
| saldo do orçamento de mídia | 0 B em 14.184 operações | **0 B em 11.958 operações** |
| mapa de esteiras | 0 chaves após 59.355.312 conversas | **0 chaves após 50.040.244** |
| `arrayBuffers` pós-GC | 0,10 → 280,11 → 0,10 MiB | **0,10 → 280,11 → 0,10 MiB** |
| heap pós-GC | 24,25 → 44,42 → 22,52 (−1,73) | **24,37 → 45,15 → 22,63 (−1,74)** |
| tendência linear do heap | −0,511 MiB/min | **−0,047 MiB/min** (estável) |
| drenagem das filas | 0/0/0 nas quatro | **0/0/0 nas quatro** |
| integridade | sem erro interno | **sem erro interno** |

**O que se lê daqui, e o que não.** Os seis vereditos passam nas duas medições e o pico de `arrayBuffers` bate no
orçamento (280 MiB) nas duas. A tendência do heap mudou de −0,51 para −0,05 MiB/min: as duas são "sem vazamento
linear"; a diferença de inclinação não é ganho nem perda, provavelmente é ruído de série curta com GC (não foi investigado). O número de conversas e de
operações foi **menor** (−16% e −16%) com o mesmo tempo de relógio: a máquina esteve ocupada com outras coisas
durante parte da segunda rodada (acesso por SSH e testes pontuais), então **não há base para dizer que a `v3` ficou
mais lenta ou mais rápida**. Esta leva não otimizou desempenho; a medição serve para provar que as frentes novas
(agendador, listas, cotas) não introduziram retenção. Continua valendo: nenhum destes números vai para promessa de
produto.

## Antes e depois: o que existe e o que não existe

| frente | antes | depois | comparável? |
|---|---|---|---|
| orçamento de bytes de mídia | não existia em forma nenhuma antes da `onda1` | 0 bytes retidos em 14.184 operações | **não** — não há "antes" para comparar, e dizer que houve ganho seria inventar |
| mapa de esteiras por conversa | — | 0 chaves após 59 M conversas | **não**, mesma razão |
| frente E (limites administrativos) | — | não mede desempenho; mede governança | não se aplica |
| frente F (pareamento) | — | não mede desempenho | não se aplica |

**Declarado:** esta leva **não** produziu um par antes/depois de desempenho,
porque não otimizou desempenho — consertou governança de limites e pareamento.
O pedido manda dar o antes e o depois "quando disponível". Aqui não está, e
por isso não há número de economia neste documento.

A frente **K** do pedido é a segunda medição, no mesmo cenário, na mesma máquina,
com a mesma metodologia. Foi feita em 07/11/2026 (seção acima). Ela confirma a
ausência de retenção; não produz par de economia, porque nada foi otimizado.

## O que já é sabido sobre lentidão, e não é desempenho

Medido antes: entrada 0,70 s de mediana, avaliação de 40 automações em
**18–20 ms**, containers abaixo de 1% de CPU, zero recusa por sobrecarga. E
ainda assim viu-se um `/ping` de **32 segundos**.

A causa não é consumo. É `src/engine/fila.js:179`:

```js
const podeIniciar = emCurso < teto && (chave == null || !chaves.has(chave))
```

A chave da admissão é a **conversa**. Uma tarefa por grupo, em série. Um
download esperando a API externa segura todo o resto daquele grupo atrás dele.

Não é defeito: é preservação de ordem. Mas o incômodo é legítimo — um `/ping`
não disputa recurso com um download, só está atrás dele na fila. O conserto
possível é soltar a serialização para comandos que **não** dependem de ordem,
mantendo-a para o que mexe em estado da conversa. É mudança no coração da
admissão, onde o projeto já errou uma vez tentando acertar. **Pendência, com
decisão do dono antes de código.**

## Como reproduzir

```
npm run soak
```

Para a duração padrão de 30 min. O arnês imprime os seis vereditos, a série
temporal por minuto e a tendência linear do heap no fim.
