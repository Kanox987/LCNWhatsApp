# Arquitetura do Sistema LCNWhatsApp

Mapa de arquitetura técnica do LCNWhatsApp, descrevendo os componentes centrais, suas fronteiras de execução, o ciclo de vida dos eventos e o processo de homologação de novas ações.

---

## 1. As Três Partes do Sistema

O sistema é estruturado em três processos com responsabilidades estritamente delimitadas: o **Motor**, o **Painel** e o **Gateway**. Em ambiente de container compartilhado, os três são inicializados pelo script coordenador `bin/lcn-container.sh`.

```
                      ┌────────────────────────────────────────┐
                      │                 PAINEL                 │
                      │         (src/web/runServer.js)         │
                      └──────────────────┬─────────────────────┘
                                         │ HTTP via Unix Socket
                                         ▼
┌─────────────────────────┐   HTTP /events    ┌────────────────────────┐
│         GATEWAY         │ ────────────────> │         MOTOR          │
│       (index.js)        │ <──────────────── │ (src/engine/server/    │
│  [src/connection.js]    │   Pending Cmds    │        index.js)       │
└────────────┬────────────┘                   └───────────┬────────────┘
             │                                            │
             │ WebSocket/TLS                              │ SQLite
             ▼                                            ▼
       WhatsApp Web                             engine.sqlite (XDG)
```

### 1.1. O Motor (`src/engine/server/`)
* **Ponto de Entrada**: `src/engine/server/index.js`, gerenciado via CLI por `src/engine/cli.js`.
* **O que faz**:
  * Abre, migra e mantém o banco de dados central SQLite (`engine.sqlite`) via `src/engine/server/db.js:80-112`.
  * Expõe a API HTTP local sobre UNIX Domain Socket em `SOCKET_PATH` (`~/.local/share/lcnwhatsapp/engine/run/engine.sock`) via `src/engine/server/transport.js:115,139` e `src/engine/server/api.js:17-34`.
  * Avalia eventos canônicos contra automações ativas e regras de disparo (DAG de nós de fluxo) em `src/engine/server/evaluator.js:1-100`.
  * Executa deduplicação de eventos (*at-most-once*) em `inbound_events` (`src/engine/server/retencao.js:28-33`).
  * Executa mutações de dados no banco (variáveis de escopo, contadores, enquetes, votos, donos e configurações de menu).
  * Gera comandos de saída com status `pending` na tabela `outbound_commands` e atualiza seus status com base na confirmação do gateway (`src/engine/server/routes/executions.js:52-67`).
  * Executa varredura periódica de retenção de dados a cada hora (`src/engine/server/retencao.js:48`) e limpa comandos pendentes antigos na inicialização (`src/engine/server/index.js:29-30`).
* **O que NÃO faz**:
  * **NÃO fala com a rede externa nem com o WhatsApp**: o motor não realiza requisições externas nem baixa mídias (conforme documentado explicitamente em `src/engine/server/evaluator.js:1093-1096` e `src/engine/server/evaluator.js:1150`).
  * **NÃO aloca buffers de arquivos**: criação e manipulação de bytes de arquivos do acervo ou fotos pertencem exclusivamente ao gateway (`src/engine/server/evaluator.js:1003-1004`).
  * **NÃO gerencia conexões de mensageria nem autenticação QR/código**.

### 1.2. O Painel (`src/web/`)
* **Ponto de Entrada**: `src/web/runServer.js` (que executa `iniciarServidorWeb` de `src/web/server.js:52-95`), despachado via CLI por `src/web/cli.js`.
* **O que faz**:
  * Sobe o servidor HTTP local restrito a `127.0.0.1` / `localhost` na porta 4780 (`src/web/server.js:52`, `src/web/server.js:56-58`).
  * Serve os arquivos estáticos da SPA local em `src/web/public/` (`src/web/server.js:32-50`).
  * Fornece rotas de API REST em `/api/v1` via `src/web/router.js` para gerenciar instâncias, pareamento, acervo e histórico.
  * Fornece o catálogo humano de automações e metadados visuais de nós em `src/web/public/logic/acoes.js`.
  * Comunica-se com o motor exclusivamente através do cliente HTTP Unix Socket (`src/engine/client.js:20-60`).
* **O que NÃO faz**:
  * **NÃO escuta em interfaces públicas (`0.0.0.0`)**: bloqueado explicitamente por segurança (`src/web/server.js:53-58`).
  * **NÃO acessa o banco `engine.sqlite` diretamente**: não importa better-sqlite3 nem roda queries de banco; toda consulta é delegada ao motor via socket.
  * **NÃO avalia eventos de mensagens nem despacha comandos ao WhatsApp**.

### 1.3. O Gateway (`index.js` + `src/connection.js`)
* **Ponto de Entrada**: `index.js` (gerenciador de PID, batimento em `src/state.js` e espelho de log) + `src/connection.js`.
* **O que faz**:
  * Estabelece e supervisiona a conexão WebSocket/TLS com o WhatsApp via `zapo-js` (`src/connection.js:11-37`).
  * Cuida do fluxo de autenticação via QR Code ou código de pareamento (`src/connection.js:59-92`).
  * Controla a fila de admissão de eventos para proteção contra sobrecarga (`src/connection.js:98-185`).
  * Converte stanzas brutas em eventos canônicos (`src/engine/zapoAdapter.js`) e encaminha ao motor com fail-open (`src/engine/gatewaySink.js:14-48`).
  * Executa comandos pendentes devolvidos pelo motor através de `src/engine/gatewayExecutor.js:2233-2307`, gerenciando filas de socket, rede e CPU (`src/engine/filasDeRecursos.js`).
  * Relata enquetes criadas e votos recebidos na conversa para o motor via HTTP (`src/connection.js:217-218`, `src/connection.js:256-258`).
  * Confirma o status de execução de volta ao motor via `/commands/:id/result` (`src/engine/gatewayExecutor.js:109-124`).
* **O que NÃO faz**:
  * **NÃO possui banco de dados relacional próprio**: não persiste automações, histórico ou estado de enquetes localmente (`src/engine/client.js:78-80`).
  * **NÃO decide regras de negócio nem compila fluxos**: atua apenas como camada de protocolo e execução orientada a comandos.

---

## 2. A Fronteira: "O Gateway RELATA, o Motor GRAVA"

A divisão entre o protocolo do WhatsApp e o estado do sistema segue uma separação rigorosa registrada em múltiplos pontos do código:

### 2.1. Ocorrências no Código
1. **`src/engine/client.js:78-80`**:
   ```javascript
   // O gateway RELATA enquete e voto; quem grava é o motor, que tem banco.
   // A fronteira é de propósito: a alternativa era dar um SQLite próprio ao
   // gateway, com dois bancos para manter, migrar e sincronizar.
   ```
2. **`src/engine/server/routes/enquetes.js:3-11`**:
   ```javascript
   // O gateway RELATA; o motor GRAVA.
   //
   // Estas duas rotas existem para manter a fronteira de pé. O gateway é quem vê
   // a enquete nascer e os votos chegarem — é ele que está no socket. Mas quem
   // tem banco é o motor, e a alternativa em cima da mesa era dar um SQLite
   // próprio ao gateway: dois bancos para manter, migrar e sincronizar, com a
   // camada de protocolo virando aplicação.
   //
   // Então o gateway conta o que viu, e não escreve nada.
   ```
3. **`tests/enquetes-persistidas.test.mjs:8-12`**:
   ```javascript
   // Havia duas propostas de conserto. A que perdeu dava um SQLite PRÓPRIO ao
   // gateway — dois bancos para manter, migrar e sincronizar, com a camada de
   // protocolo virando aplicação. A que venceu mantém a fronteira: o gateway
   // RELATA pelo socket, o motor GRAVA.
   ```
4. **`src/paths.js:23-26`**:
   ```javascript
   // O motor NÃO é dividido de propósito: ele é central, e cada gateway se
   // identifica pelo próprio accountId (data/instance-id.txt, que agora nasce
   // diferente por instância). É assim que o mesmo comando vale para os dois
   // números sem cada um ter o seu banco.
   ```

### 2.2. O que Acontece Quando a Fronteira é Violada
Os comentários do projeto relatam as consequências das tentativas de violar essa fronteira:
* **Proliferação de Bancos e Desalinhamento**: A violação exigiria conceder um SQLite próprio a cada gateway, gerando "dois bancos para manter, migrar e sincronizar, com a camada de protocolo virando aplicação" (`src/engine/server/routes/enquetes.js:7-9`).
* **Perda de Dados por Estado em Memória**: Quando o gateway tentava manter estado internamente em memória (como na versão original das enquetes), o estado desaparecia a cada reinício do processo do bot (ex.: enquetes de reuniões abertas à noite perdiam os votos após o reinício matinal, conforme `tests/enquetes-persistidas.test.mjs:3-6`).
* **Contagem Duplicada de Votos**: O WhatsApp envia o estado completo da escolha do usuário a cada interação, e não um incremento delta. Tratar isso fora do motor com soma cumulativa causava contagens que excediam a quantidade total de membros do grupo (`tests/enquetes-persistidas.test.mjs:13-17`).

---

## 3. Ciclo de Vida: Do Evento ao Comando Executado

A cadeia de processamento percorre os seguintes arquivos, na ordem estrita:

```
[ WhatsApp ]
     │
     ▼
1. index.js / src/connection.js (Listener socket & Fila de Admissão)
     │
     ▼
2. src/engine/zapoAdapter.js (Construção do CanonicalEvent)
     │
     ▼
3. src/engine/canonicalEvent.js (Validação e tipoPodeCasar)
     │
     ▼
4. src/engine/groupInfo.js (Enriquecimento assíncrono de grupo)
     │
     ▼
5. src/engine/gatewaySink.js (Envio HTTP POST /events ao motor)
     │
     ▼
6. src/engine/server/transport.js (Recepção no Unix Domain Socket)
     │
     ▼
7. src/engine/server/routes/events.js (Despacho da rota /events)
     │
     ▼
8. src/engine/server/evaluator.js (Deduplicação, DAG, criação de pendências)
     │
     ▼
9. src/engine/gatewayExecutor.js (Despacho com filas de socket/recursos)
     │
     ▼
10. zapo-js client.message.send / upload (Saída para o WhatsApp)
     │
     ▼
11. src/enviadas.js (Anotação de ID para supressão de eco)
     │
     ▼
12. src/engine/gatewayExecutor.js -> src/engine/server/routes/executions.js
    (Confirmação POST /commands/:id/result ao motor)
```

1. **`index.js:60` -> `src/connection.js:227-229`**: Os listeners do `WaClient` (`message`, `group`, `message_unavailable`) capturam a mensagem crua.
2. **`src/connection.js:142-155`**: `admissao.admitir()` acolhe a mensagem respeitando o limite de concorrência por chat.
3. **`src/engine/zapoAdapter.js:203-218`**: Converte a estrutura da `zapo-js` em `CanonicalEvent`.
4. **`src/engine/canonicalEvent.js:28` e `src/connection.js:313`**: `tipoPodeCasar()` descarta esboços não decifrados e stanzas ignoradas antes de onerar o motor.
5. **`src/engine/groupInfo.js:329`**: `enriquecerEvento()` anexa assincronamente metadados do grupo (nome, admins) sem bloquear o recebimento.
6. **`src/engine/gatewaySink.js:14-48`**: `enviarEventoAoMotor()` despacha o evento via POST `/events` ao socket Unix do motor com timeout de 1500 ms e fail-open.
7. **`src/engine/server/transport.js:41-51`**: Servidor do motor faz parsing do JSON e resolve a rota registrada.
8. **`src/engine/server/routes/events.js:13-33`**: Rota repassa o evento para `avaliarEvento()`.
9. **`src/engine/server/evaluator.js:1-100`**: Avalia o evento no grafo de automações, deduplica em `inbound_events`, processa condições e nós de ação, persistindo comandos com status `pending` em `outbound_commands`. Retorna a lista de comandos na resposta HTTP.
10. **`src/connection.js:340-353`**: Recebe a resposta e, havendo comandos pendentes, invoca `executarComandos()`.
11. **`src/engine/gatewayExecutor.js:2233-2287`**: `executarComandos()` resolve o executor correspondente (`executarResposta`, `executarDownload`, etc.) e submete a operação às filas de recursos (`src/engine/filasDeRecursos.js`) com timeout monitorado.
12. **`src/engine/gatewayExecutor.js:196-203`**: `enviarERegistrar()` dispara a mensagem via `client.message.send()` e grava o identificador em `src/enviadas.js`.
13. **`src/engine/gatewayExecutor.js:109-124`**: `confirmarFailOpen()` chama POST `/commands/:id/result` (`src/engine/server/routes/executions.js:52-67`), atualizando o status do comando para `sent` ou `failed` no banco SQLite.

---

## 4. Os NOVE Portões de uma Nova Ação

Conforme estabelecido pelo projeto (ver comentários em `src/engine/server/runtimeCapabilities.js:57-58`: *"a biblioteca saber ENVIAR não é a linguagem saber PEDIR. Cada uma custou as mesmas nove camadas de qualquer ação nova"*), toda nova ação suportada pelo sistema precisa transpor rigorosamente **nove portões**:

| Portão | Função | Arquivo |
| :--- | :--- | :--- |
| **1. Vocabulário da Linguagem** | Mapeia a palavra-chave em português (ex: `responde`, `baixa`, `apaga do acervo`) para a ação técnica (`action.*`) e declara como os campos são serializados no texto `.lcn`. | `src/lcn/vocabulario.js:19-129` |
| **2. Schema JSON de Automação** | Define o contrato formal do nó no JSON Schema (propriedades aceitas no `config`, enums, restrições de formato e campos obrigatórios). | `src/engine/server/schema/automation.v1.schema.json:5` e definições sob `definitions` |
| **3. Lista de Capacidades do Runtime** | Registra o tipo da ação na constante `ACOES_SUPORTADAS`. O motor expõe essa lista em `/meta/capabilities` e impõe que apenas ações listadas aqui são executáveis. | `src/engine/server/runtimeCapabilities.js:13-129` |
| **4. Validação de Publicação (Publish Enforcement)** | Durante a publicação (`publicar()`), inspeciona cada nó e rejeita com erro HTTP 422 qualquer fluxo com ação ausente de `ACOES_SUPORTADAS`. | `src/engine/server/automationsService.js:165-177` |
| **5. Avaliador do Motor (Evaluator)** | Implementa o bloco `case 'action...':` no laço do fluxo: interpola argumentos, efetua mutações no SQLite se houver estado e gera o comando outbound pendente. | `src/engine/server/evaluator.js:1000-1450` |
| **6. Executor no Gateway** | Mapeia o `commandType` no despachante do gateway e implementa a chamada real ao WhatsApp via `zapo-js` sob timeout e fila de recursos. | `src/engine/gatewayExecutor.js:2244-2275` |
| **7. Catálogo do Painel Web** | Documenta a ação para o usuário: rótulo em português, família, resumo descritivo, explicação dos campos e exemplo funcional na UI. | `src/web/public/logic/acoes.js:97-750` |
| **8. Teste de Sincronia Catálogo/Runtime/Schema** | Teste automatizado que valida bidirecionalmente: catálogo ⊆ motor, motor ⊆ catálogo e presença obrigatória de todos os campos no schema. | `tests/web-catalogo-acoes.test.mjs:34-89` |
| **9. Teste de Ida e Volta da Linguagem (.lcn)** | Teste automatizado que garante a simetria perfeita entre o documento estruturado e o texto compilado/descompilado (`compilar(descompilar(doc))`). | `tests/lcn-ida-e-volta.test.mjs:32-63` e `tests/lcn-ida-e-volta.test.mjs:260-285` |

---

## 5. Localização do Banco de Dados e Restrições de Armazenamento

### 5.1. Onde Mora o Banco de Dados de Verdade
O banco de dados central (`engine.sqlite`) reside estritamente sob a convenção XDG Base Directory no diretório do usuário:
* **Definição em código**:
  * `src/engine/paths.js:7`: `PASTA_ENGINE = path.join(os.homedir(), '.local', 'share', 'lcnwhatsapp', 'engine')`
  * `src/engine/paths.js:8`: `ARQ_DB = path.join(PASTA_ENGINE, 'engine.sqlite')`
* **Caminho real no Host**: `~/.local/share/lcnwhatsapp/engine/engine.sqlite`.
* **Caminho dentro do Container**: `/home/node/.local/share/lcnwhatsapp/engine/engine.sqlite` (onde `node` é o usuário do container).

### 5.2. Caminhos que NÃO Devem ser Usados e Comentários sobre Volumes
* **O banco NÃO mora em `/app/...`**:
  O arquivo `Dockerfile:36-40` adverte formalmente:
  ```dockerfile
  # Volumes de dados persistentes (montados pelo compose/run). O banco do motor
  # NÃO mora aqui: ele segue a convenção XDG, em
  # $HOME/.local/share/lcnwhatsapp — monte esse caminho também, senão as
  # automações publicadas somem a cada recriação do container.
  VOLUME ["/app/sessao", "/app/midia", "/app/data", "/home/node/.local/share/lcnwhatsapp"]
  ```
  Colocar o banco de dados dentro de `/app/data`, `/app/sessao`, `/app/midia` ou diretórios locais como um suposto `/app/engine-home` é terminantemente proibido.
* **Isolamento de Instâncias e Quadlet**:
  Conforme estabelecido em `src/paths.js:23-26`, o motor é unificado e central para que comandos e automações sejam compartilhados entre diferentes instâncias. Nas configurações de container do Podman/Quadlet (`src/instances/quadlet.js:62-66`), o container da instância monta apenas `sessao`, `midia`, `data`, `config.json` e o socket de comunicação (`PASTA_RUN_ENGINE:/run/lcn-engine`). O container do gateway **nunca** recebe acesso direto ao arquivo `engine.sqlite`.
* *(Nota sobre `/app/engine-home`: não conferido comentário histórico contendo a menção literal exata a `/app/engine-home` no repositório atual, mantendo-se a confirmação baseada no `Dockerfile:36-40` e `src/engine/paths.js:7-8`)*.
