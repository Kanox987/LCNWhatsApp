# Orçamento de mídia no gateway

O limite por arquivo não protege a soma de um álbum nem chamadas simultâneas.
O gateway compartilha um orçamento entre downloader, respostas de conexão e
leituras do acervo. A reserva acontece antes de carregar o conteúdo e dura
enquanto o conteúdo ainda pode ser usado.

Configuração em `config.json`:

```json
{
  "hardware": {
    "maxMidiaMB": 60,
    "orcamentoMidiaMB": 256
  },
  "download": {
    "limiteMB": 64
  }
}
```

- `hardware.maxMidiaMB` é o teto geral por arquivo. A configuração padrão do
  aplicativo já fornece 60 MB; para dependências sem configuração válida,
  o runtime conserva a proteção de 64 MB.
- `download.limiteMB` limita especificamente o downloader: vale o menor
  entre ele e o teto geral. Seu padrão é 64 MB.
- `hardware.orcamentoMidiaMB` limita a soma dos conteúdos retidos nesses
  caminhos. O padrão é 256 MB, alterável por configuração. Valores ausentes,
  não finitos ou não positivos usam o padrão; nunca significam sem limite.
- O painel continua usando o limite de sua própria biblioteca para base64.

Uma alteração de orçamento é lida na próxima execução. Reduzir abaixo do
uso atual recusa novas reservas até os envios em curso devolverem memória;
não cancela envios que já começaram. A exposição dos controles no painel
continua pertencendo à etapa de configuração.

## Posse dos bytes

`criarOrcamentoDeMidia(bytes)` expõe `adquirir(bytes)`, `liberar(bytes)`,
`ajustarLimite(bytes)` e `estado()`. Aquisição é imediata: falta de espaço
lança `LCN_SEM_VAGA`. Esperar segurando metade de um álbum poderia impedir
que os próprios álbuns terminassem e devolvessem espaço.

Os resultados de `baixar()` e `executar()` carregam `liberar()`. O consumidor
deve chamá-la em `finally`, depois da entrega ou do descarte. Ela também apaga
as referências aos buffers. O gateway já faz isso. Um timeout não encerra
necessariamente o socket; a mídia em uso conserva a reserva até a operação
real terminar. Em uma cadeia, a primeira mídia transfere a posse ao cache e
é liberada ao expirar a referência; as demais são descartadas imediatamente.

O acervo entrega referências `{ id, nome, mime, tipo, bytes, carregar() }`.
A escolha entre carrossel, álbum e sequência usa apenas metadados. Cada
envio lê um arquivo de forma assíncrona; uma queda de formato relê pelo id.
Não existe uma segunda lista de buffers guardada para a queda. A leitura
confere o tamanho atual no disco antes de alocar um buffer limitado.

## Limite desta etapa

Respostas binárias HTTP precisam de `Content-Length` válido e de espaço
livre antes de `arrayBuffer()`. Ausência de tamanho recusa o corpo. Um arquivo
acima do teto individual pode ser omitido do álbum, como antes; falta de
orçamento encerra e libera o lote. Capas inválidas podem ser omitidas ou
substituídas pelo candidato seguinte. Corpos comprimidos são recusados,
pois o comprimento comprimido não limita o tamanho após descompressão.

**Leitura em fluxo com aborto por estouro ainda não está implementada.**
Se o serviço mentir no comprimento, a divergência só será detectada depois
da leitura. O orçamento contabiliza conteúdo declarado e retido; não é um
teto de RSS do processo. Strings JSON, cópias internas do transporte,
criptografia e miniaturas do provedor também consomem memória. Os testes
medem reservas e ordem de alocação dos caminhos modificados, não RSS total.
