# Filas por recurso e admissão

O gateway separa três recursos: `socket`, `rede` e `cpu`. Cada fila tem seu
próprio limite de execução e de espera. O custo em bytes continua no orçamento
de mídia; não entra no cálculo da urgência.

## Configuração por instância

```json
{
  "hardware": {
    "comandosSimultaneos": 2,
    "downloadConcorrencia": 2,
    "cpuConcorrencia": 1,
    "maxPendentes": 256,
    "agingMs": 10000,
    "esperaMaximaMs": 180000
  }
}
```

Esses são padrões, não tetos. Os limites são inteiros positivos;
`maxPendentes` também aceita zero, para recusar quando todas as vagas ativas
estiverem ocupadas. Valores inválidos usam o padrão. `maxPendentes`, `agingMs`
e `esperaMaximaMs` são aplicados separadamente a cada fila, não à soma delas.
`limitesDeMidia(cfg).downloadConcorrencia` alimenta a concorrência de rede.
A exposição dos controles no painel pertence à metade de configuração.

O conjunto nasce na primeira execução daquele cliente e é reutilizado.
Mudanças de configuração de filas valem no próximo arranque; não substituem
uma fila com tarefas admitidas. O orçamento de bytes conserva a atualização
já existente na próxima execução.

## Ordem e recusa

`payload.scheduling.priority` é autoritativa para todas as operações do comando.
Ausência usa `normal`. A escala é `low=0`, `normal=1`, `high=2`, `very_high=3`.
A cada seleção e admissão calcula-se:

```text
prioridadeEfetiva = prioridadeBase + floor(tempoEsperandoMs / agingMs)
```

O relógio padrão é monotônico. Prioridades efetivas não têm teto. Empates
atendem a menor sequência de entrada. Com o padrão de 10 segundos, uma baixa
que esperou 30 segundos empata com uma muito alta recém-chegada e passa antes.
Isso não promete prazo máximo de execução: tarefas iniciadas não são interrompidas.

Quando a espera está cheia, a nova só entra se sua prioridade efetiva for
**maior** que a da pior pendente. Entre piores empatadas, sai a mais recente.
A vítima recebe `LCN_SEM_VAGA`, com `recurso`, `prioridade` e
`motivo: 'deslocada'`. Recusa na porta usa `motivo: 'fila_cheia'`.
Nenhuma dessas tarefas começou. Uma tarefa em curso nunca é deslocada.

A capacidade é reservada antes de agendar a execução assíncrona. No teste
com 10 mil tarefas instantâneas, duas vagas e 32 pendências, entram 34 e são
recusadas 9.966. Somente as 32 pendentes criam timers. O chamador deve consumir
as rejeições; a fila não guarda tarefas recusadas para tentar novamente.

O vencimento do prazo de espera conserva o contrato anterior: `LCN_TIMEOUT`.
Ele tem contador próprio (`expiradas`) e não é uma recusa de capacidade.

## Fronteiras

- `socket`: apenas `client.message.send()` e `client.message.upload()`.
  O relógio de envio fica pausado durante a espera e começa ao obter vaga.
- `rede`: cada requisição HTTP externa, incluindo leitura ou descarte do corpo,
  e o download de mídia do WhatsApp solicitado pelos executores do gateway.
  O timeout HTTP começa depois da admissão. Pausas entre consultas de um job
  não ocupam rede. Resolver a declaração no motor continua fora dessa fila.
- `cpu`: a decodificação de arquivos base64 retornados por conexões, e a API
  genérica para outros trabalhos locais. Conversões feitas por serviços
  externos pertencem à rede. Esta fila não cria threads nem torna JavaScript
  síncrono preemptável; novos trabalhos pesados devem usar processo ou worker.

`connection.call` e `media.download` completos não ocupam o socket. Um `/ping`
continua saindo durante trabalho externo. O teste original dessa fronteira
permanece intacto.

O contexto assíncrono de prioridade é independente do relógio de envio.
`executarComandos()` abre o contexto por comando. Envio, upload e executores
de recursos o consultam. A fila captura o contexto na admissão, pois iniciar
uma pendente dentro da conclusão de outro comando herdaria o contexto errado.

## Política do gateway

`LCN_SEM_VAGA` termina como `failed`, nunca como timeout ou `outcome_unknown`.
O gateway registra a recusa por recurso/prioridade e confirma um `detail` com
código, recurso, motivo, prioridade e decisão, persistido pelo motor.

- `discard`: fecha sem aviso.
- `notify`: tenta o texto declarado uma única vez pela mesma fila de socket,
  com a prioridade do comando e citação da mensagem original quando presente.
  Se esse aviso for recusado, registra `aviso: 'recusado'` e seu código, mantendo
  o erro original. Outra falha usa `aviso: 'falhou'`; sucesso usa `'enviado'`.
- `retry` ou outra política desconhecida: registra que o compilador deveria
  tê-la barrado e aplica descarte. Não há reexecução nem timer de retry.

Recusa não aciona fallbacks de formato nem o avisador legado de download.
Se um ACK for recusado, o comando também encerra pela política declarada.
Uma nota informativa após entrega já concluída continua sendo melhor esforço.
Comandos com várias operações podem já ter enviado um ACK ou parte da mídia;
`failed` descreve a operação recusada, sem desfazer efeitos anteriores.

## API para quem fará a admissão de eventos

`src/connection.js` não foi alterado. O encaixe deve criar **uma** fila para a
instância e usar a mesma fila em todas as chegadas; criar uma fila por evento
eliminaria o limite compartilhado.

```js
import { criarFila } from './engine/fila.js'

const admissao = criarFila({
  recurso: 'eventos',
  limite: 2,
  maxPendentes: cfg.hardware.maxPendentes,
  agingMs: cfg.hardware.agingMs,
  esperaMaximaMs: cfg.hardware.esperaMaximaMs,
  aoMudar: (estado) => publicarEstadoDaAdmissao(estado)
})

async function admitirEvento (evento) {
  try {
    // Antes do avaliador ainda não há cabeçalho compilado: não inferir
    // urgência pelo tipo de mídia ou pelo tamanho do evento.
    return await admissao.executar(() => processarEvento(evento), {
      prioridade: 'normal'
    })
  } catch (erro) {
    if (erro.code !== 'LCN_SEM_VAGA') throw erro
    registrarRecusaDoEvento(evento, erro)
  }
}
```

`processarEvento`, `publicarEstadoDaAdmissao` e `registrarRecusaDoEvento` no
exemplo representam o encaixe do consumidor. A API entregue é
`criarFila(opcoes).executar(tarefa, { prioridade })`, que devolve o valor ou
erro da tarefa, e o getter `estado`. O observador é opcional e não pode
interromper a fila. `agora: () => milissegundos` permite testes determinísticos.
O chamador deve passar uma função, sem começar o trabalho antes da admissão.
Não deve adquirir a mesma fila de novo enquanto segura sua vaga.

Para operações do gateway, `criarFilasDeRecursos(cfg)` fornece `socket`, `rede`,
`cpu`, `executar(recurso, tarefa, { prioridade })` e `estado`.
`comContextoDeComando(scheduling, filas, tarefa)` propaga a política sem repetir
argumentos. `executoresDeRecursos(cfg)` fornece `rede(tarefa)` e `cpu(tarefa)`:
usam o conjunto do contexto ou um conjunto local reutilizado pelo construtor
quando executados fora do gateway. Construtores independentes fora do contexto
não compartilham limites; para compartilhá-los, abra o contexto com um conjunto
comum. Testes podem injetar esse conjunto em `deps.filas` do gateway.

## Observação

O batimento de `state.js` publica `recursos` no arquivo de estado do gateway,
sem um timer de escrita por admissão. Cada processo de instância publica seu
conjunto de filas e orçamento. O getter permite observar imediatamente:

- `filas.<recurso>`: execução atual, espera atual, limites, pico ativo e pico
  pendente, iniciadas, concluídas, recusas, deslocadas, expiradas e recusas por
  prioridade **base da vítima**, nunca do comando que a deslocou.
- `esperaTotalMs`, `esperaMaximaMs`, `esperasMedidas`: soma, maior espera e
  número de itens medidos quando saem da espera ou são recusados; incluem zero
  de admissões imediatas e recusas na porta. Não guardam amostras por tarefa.
- `recusasDeComandos.<recurso>.<prioridade>`: comandos fechados por recusa.
  Não some com o contador da fila: são perspectivas distintas da mesma recusa.
- `avisos` e `politicasInvalidas`: tentativas de notificação e contrato inválido.
- `memoria`: bytes reservados atuais, pico, total reservado, total liberado e
  recusas de orçamento. A ressalva sobre Content-Length mentiroso continua em
  [MEMORIA-DE-MIDIA.md](MEMORIA-DE-MIDIA.md).

Verificação: `node tests/fila-prioridade.test.mjs` e
`node tests/filas-recursos.test.mjs`, também incluídos em `npm test`.
