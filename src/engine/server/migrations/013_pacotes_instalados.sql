-- §8 exige que "a configuração selecionada persista" e que "o usuário possa
-- editar ou remover as automações instaladas". Nenhuma das duas coisas é
-- derivável do que o banco já guarda: `automation_template_provenance` diz de
-- qual TEMPLATE cada automação veio, e não diz nada sobre o PACOTE que a trouxe
-- nem sobre a escolha que a pessoa fez no provisionamento. Sem este registro,
-- "remover o pacote de atendimento" não tem lista de membros para remover, e
-- "instância vazia" não se distingue de "instância que nunca foi provisionada".
--
-- O ESCOPO É EXPLÍCITO, E É AÍ QUE ESTE ARQUIVO SE SEGURA (D-30, D-31).
-- Hoje todas as instâncias gerenciadas compartilham UM motor
-- (`LCN_ENGINE_SOCKET=/run/lcn-engine/engine.sock`), então este banco não
-- consegue distinguir instância de instância. Escrever uma coluna
-- `instance_id` agora seria gravar uma identidade que ninguém prova: a tabela
-- `instances` existe desde a 001 e o ciclo de vida da instância gerenciada
-- NUNCA insere linha nela (é o mesmo defeito que faz "adicionar membro ao
-- pool" devolver 404 para toda instância).
--
-- Então o escopo é um par declarado, não uma suposição:
--   scope_kind = 'engine'    o escopo é este motor. É o que se pode provar hoje
--   scope_kind = 'instance'  o escopo é uma instância, quando o modelo de
--                            implantação passar a dar a cada uma o seu motor
--                            ou uma identidade que falhe fechada
-- Os dois campos são NOT NULL e o CHECK recusa vazio: um registro de pacote não
-- pode ser mais confiável que a identidade que ele carrega, e identidade que
-- "cai no padrão" quando não se resolve é pior que recusa.
--
-- `removed_at` em vez de DELETE: "remoção de pacote" é um dos dez casos
-- obrigatórios de §8, e remover a linha apagaria a prova de que o pacote
-- esteve lá — que é justamente o que distingue "nunca instalei" de "instalei e
-- tirei", a mesma lição da 012_menu_padrao.
CREATE TABLE package_installations (
  installation_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('engine', 'instance')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('vazia', 'pacote', 'especificas', 'personalizada')),
  package_id TEXT,
  package_version INTEGER,
  -- A IDENTIDADE da instalação, calculada em `registroDePacotes.js`. Para
  -- `pacote` é o pacote; para `vazia` é a própria escolha; para
  -- "funcionalidades específicas" e "configuração personalizada" é o HASH da
  -- seleção — porque nelas não há pacote, e sem isto todas colidiriam num
  -- `COALESCE(package_id, '')` vazio: o operador que escolhesse um segundo
  -- conjunto de funcionalidades receberia calado a instalação do primeiro, com
  -- o segundo pedido jogado fora. Medido por sonda antes desta coluna existir.
  selection_key TEXT NOT NULL CHECK (length(selection_key) > 0),
  selection_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  -- Só a escolha de PACOTE tem pacote. "Instância vazia", "funcionalidades
  -- específicas" e "configuração personalizada" são escolhas persistidas, não
  -- pacotes (D-29) — e deixar o campo preenchível nelas abriria caminho para
  -- uma automação feita à mão receber proveniência fictícia de template.
  CHECK ((kind = 'pacote') = (package_id IS NOT NULL)),
  CHECK ((package_id IS NULL) = (package_version IS NULL))
);

-- Uma instalação viva por escopo e por IDENTIDADE. Provisionar a mesma escolha
-- duas vezes no mesmo escopo é o caso "repetição acidental do provisionamento":
-- a segunda vez tem de reconhecer a primeira, não criar uma instalação paralela
-- que ninguém consegue remover inteira depois. Escolha DIFERENTE, por outro
-- lado, é outra instalação — e é por isso que a chave é `selection_key` e não
-- o pacote.
CREATE UNIQUE INDEX package_installations_vivas
  ON package_installations (scope_kind, scope_id, kind, selection_key)
  WHERE removed_at IS NULL;

-- `item_key` é a chave que o manifesto do pacote usa, e é a mesma que
-- `resolverPacote` devolve em cada membro — inclusive para dependência
-- resolvida, que usa o próprio templateId como chave. Por isso a junção é por
-- (installation_id, item_key) e não por automation_id: o pacote conhece os
-- itens dele por nome de item, e o nome da automação pode ser outro.
--
--   origin   'pedido'      o manifesto nomeia este item
--            'dependencia' `resolverOrdemInstalacao` trouxe pelo `dependsOn`
--   binding  'criada'       esta instalação criou a automação. Remover o pacote
--                           pode remover esta
--            'compartilhada' a automação já existia e foi ADOTADA com
--                           autorização explícita de quem opera. Remover o
--                           pacote NÃO a remove — ela não nasceu aqui
--            'avulsa'       a automação deixou de ser governada por este
--                           pacote (reconfigurada à mão e assumida pela pessoa)
--
-- `initial_revision_id` é o que torna "atualização de template sem perda de
-- personalização" verificável em vez de opinável: se a revisão ativa já não é
-- a que a instalação publicou, alguém editou, e a atualização precisa de
-- autorização antes de regerar.
CREATE TABLE package_installation_items (
  installation_id TEXT NOT NULL
    REFERENCES package_installations(installation_id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('pedido', 'dependencia')),
  binding TEXT NOT NULL CHECK (binding IN ('criada', 'compartilhada', 'avulsa')),
  initial_revision_id INTEGER,
  removed_at TEXT,
  PRIMARY KEY (installation_id, item_key)
);

-- Duas instalações VIVAS não podem ser DONAS da mesma automação: senão remover
-- um pacote apagaria automação que o outro conta como sua. O índice é parcial em
-- DUAS dimensões, e as duas foram medidas:
--
--   · `removed_at IS NULL` — instalação removida pode ter deixado a mesma
--     automation_id no histórico, e isso é registro, não conflito;
--   · `binding = 'criada'` — exclusividade é de POSSE, não de referência. Sem
--     esta metade o índice proibia exatamente o que `binding = 'compartilhada'`
--     existe para descrever: dois pacotes dependendo da mesma automação adotada
--     batiam em UNIQUE, e a palavra do schema nomeava um estado inalcançável.
CREATE UNIQUE INDEX package_installation_items_automacao_viva
  ON package_installation_items (automation_id)
  WHERE removed_at IS NULL AND binding = 'criada';

CREATE INDEX package_installation_items_por_automacao
  ON package_installation_items (automation_id);
