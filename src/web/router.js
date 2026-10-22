// Módulo 4 da Etapa 4.5 — tabela de rotas do BFF local. TODA a lógica de
// negócio mora em `src/agent/application.js` (instâncias/diretório) ou no
// motor via `aplicacao.motor` (automações/pools/conexões/execuções,
// Módulos 1/2) — este arquivo só faz o mapeamento HTTP → chamada de método,
// de propósito explícito rota por rota (nunca um proxy cru de path pro
// motor) pra manter controlado o que o navegador pode alcançar.
import { criarRoteador, ErroHttp, resposta } from '../engine/server/transport.js'
import { descreverEntradas, descreverResposta, quantosArquivos } from '../engine/server/conexoes/emPortugues.js'
import { compilar, ErroDeSintaxe } from '../lcn/compilar.js'
import { descompilar } from '../lcn/descompilar.js'
import { exemploDeChamada, montarReferencia } from '../lcn/referencia.js'
import * as glossario from './public/logic/acoes.js'
import { respostaBinaria } from './binario.js'

// A referência da linguagem é a MESMA para todo mundo e não depende de nada
// gravado, então é montada uma vez na carga do módulo. O glossário entra aqui,
// e é aqui que ele pode entrar: ele vive em `public/` porque o navegador
// precisa dele (o painel é servido estático, e nada fora de `public` chega ao
// navegador), e `src/lcn` não pode importar de `src/web` sem a linguagem
// passar a depender do painel. O BFF é o único lugar com os dois lados à mão.
const REFERENCIA_DA_LINGUAGEM = montarReferencia({ prosa: glossario })

function queryObjeto (query) {
  return Object.fromEntries(query.entries())
}

export function criarRoteadorWeb (aplicacao) {
  const roteador = criarRoteador()
  const automacoes = () => aplicacao.motor.automacoes
  const pools = () => aplicacao.motor.pools
  const conexoes = () => aplicacao.motor.conexoes
  const execucoes = () => aplicacao.motor.execucoes
  const entidades = () => aplicacao.motor.entidades
  const meta = () => aplicacao.motor.meta
  const retencao = () => aplicacao.motor.retencao
  const templates = () => aplicacao.motor.templates
  const donos = () => aplicacao.motor.donos
  const menu = () => aplicacao.motor.menu

  // Saúde do BFF em si + do motor por trás — nunca lança 500 só porque o
  // motor está fora do ar (mesmo espírito de "motor não está rodando" que
  // o client.js já trata em vez de travar/quebrar).
  roteador.get('/api/v1/health', async () => {
    try {
      await aplicacao.motor.saude()
      return { web: 'ok', engine: 'ok' }
    } catch (erro) {
      return resposta(200, { web: 'ok', engine: 'down', reason: erro.message })
    }
  })

  // --- instâncias: ciclo de vida real e otimização (agente/data plane) ---
  roteador.get('/api/v1/instances', () => aplicacao.instancias.listar())

  // Acervo de arquivos. `/content` é a única rota do painel que devolve bytes
  // em vez de JSON — os cabeçalhos que protegem isso estão em binario.js.
  roteador.get('/api/v1/media', () => aplicacao.acervo.listar())
  roteador.post('/api/v1/media', ({ body }) => aplicacao.acervo.enviar(body))
  roteador.get('/api/v1/media/:id/content', ({ params }) => respostaBinaria(aplicacao.acervo.conteudo(params.id)))
  // Uma rota, duas intenções distintas: descrever e mover. Separadas pelo campo
  // que veio, para "mover para a raiz" (pasta vazia) não ser confundido com
  // "não mexi na pasta".
  roteador.put('/api/v1/media/:id', ({ params, body }) => (
    Object.hasOwn(body || {}, 'folder')
      ? aplicacao.acervo.mover(params.id, body.folder)
      : aplicacao.acervo.descrever(params.id, body?.description)
  ))
  // O CONTEÚDO, não o rótulo. `PUT /media/:id` (acima) mexe em pasta e
  // descrição; este troca os bytes e mantém o id — sem ele, editar um arquivo
  // significava perder a referência de todo comando que apontava para ele.
  roteador.put('/api/v1/media/:id/content', ({ params, body }) => aplicacao.acervo.reescrever(params.id, body))
  roteador.delete('/api/v1/media/:id', ({ params }) => aplicacao.acervo.remover(params.id))
  roteador.post('/api/v1/instances', ({ body }) => resposta(201, aplicacao.instancias.criar(body?.nome)))
  roteador.get('/api/v1/instances/:id', ({ params }) => aplicacao.instancias.obter(params.id))
  // Remover apaga dados E sessão: o número não volta sozinho. O motor recusa
  // enquanto o processo estiver vivo — ver instanceService.remover.
  roteador.delete('/api/v1/instances/:id', ({ params }) => aplicacao.instancias.remover(params.id))
  // `pairNumber` no corpo pede o código de pareamento daquele telefone — é o
  // que fecha a última porta que só o terminal abria.
  roteador.post('/api/v1/instances/:id/start', ({ params, body }) => aplicacao.instancias.iniciar(params.id, { pairNumber: body?.pairNumber }))
  roteador.post('/api/v1/instances/:id/stop', ({ params }) => aplicacao.instancias.parar(params.id))
  roteador.post('/api/v1/instances/:id/restart', ({ params }) => aplicacao.instancias.reiniciar(params.id))
  roteador.get('/api/v1/instances/:id/pairing', ({ params }) => aplicacao.instancias.pareamento(params.id))
  roteador.get('/api/v1/instances/:id/optimization', ({ params }) => aplicacao.instancias.obterOtimizacao(params.id))
  roteador.put('/api/v1/instances/:id/optimization', ({ params, body }) => aplicacao.instancias.definirOtimizacao(params.id, body))
  roteador.get('/api/v1/instances/:id/usage', ({ params }) => aplicacao.instancias.obterUso(params.id))
  roteador.get('/api/v1/instances/:id/logs', ({ params, query }) => aplicacao.instancias.obterLogs(params.id, Number(query.get('lines'))))
  roteador.get('/api/v1/instances/:id/directory', ({ params, query }) => aplicacao.diretorio.listar(params.id, queryObjeto(query)))

  // --- automações (Módulo 1) ---
  roteador.get('/api/v1/meta/automation-editor', () => automacoes().obterMeta())
  roteador.get('/api/v1/automations', () => automacoes().listar())
  roteador.get('/api/v1/automations/conflicts', () => automacoes().conflitos())
  // As famílias existentes, para a tela de uma conversa poder oferecer os
  // interruptores sem inventar um cadastro paralelo.
  roteador.get('/api/v1/automations/families', () => automacoes().familias())
  // Quais comandos usam um arquivo do acervo. O arquivo vem daqui (o motor não
  // enxerga o acervo) e o cruzamento acontece lá, que é onde estão os
  // documentos publicados.
  roteador.post('/api/v1/media/:id/usage', async ({ params }) => {
    const acervo = await aplicacao.acervo.listar()
    const arquivo = (acervo?.files || []).find((f) => f.id === params.id)
    if (!arquivo) throw new ErroHttp(404, `Arquivo não encontrado: ${params.id}.`)
    return automacoes().usosDeArquivo({ id: arquivo.id, path: arquivo.path, folder: arquivo.folder })
  })
  roteador.post('/api/v1/automations', ({ body }) => automacoes().criar(body))
  roteador.get('/api/v1/automations/:id', ({ params }) => automacoes().obter(params.id))
  roteador.delete('/api/v1/automations/:id', ({ params }) => automacoes().remover(params.id))
  roteador.get('/api/v1/automations/:id/revisions', ({ params }) => automacoes().listarRevisoes(params.id))
  roteador.get('/api/v1/automations/:id/revisions/:rev', ({ params }) => automacoes().obterRevisao(params.id, params.rev))
  roteador.put('/api/v1/automations/:id/draft', ({ params, body, req }) => automacoes().salvarRascunho(params.id, body, req?.headers?.['if-match']))
  roteador.post('/api/v1/automations/:id/validate', ({ params, body }) => automacoes().validar(params.id, body))
  roteador.post('/api/v1/automations/:id/publish', ({ params, body }) => automacoes().publicar(params.id, body?.revision))
  roteador.post('/api/v1/automations/:id/unpublish', ({ params }) => automacoes().despublicar(params.id))
  roteador.put('/api/v1/automations/:id/enabled', ({ params, body }) => automacoes().definirHabilitada(params.id, body?.enabled))
  roteador.put('/api/v1/automations/:id/deployment-mode', ({ params, body }) => automacoes().definirModo(params.id, body?.mode))
  roteador.get('/api/v1/automations/:id/provenance', ({ params }) => automacoes().obterProvenance(params.id))

  // O formulário de configuração DEPOIS da instalação. Como no /lcn, o id vem
  // da rota e nunca do corpo — o corpo traz só os valores.
  roteador.get('/api/v1/automations/:id/reconfigure', ({ params }) => automacoes().obterReconfiguracao(params.id))
  roteador.put('/api/v1/automations/:id/reconfigure', ({ params, body }) => automacoes().reconfigurar(params.id, body?.parameters))

  // --- a automação como TEXTO ---------------------------------------------
  //
  // O motor nunca ouve falar da linguagem: ele continua recebendo e guardando
  // documento. A tradução mora aqui porque é apresentação — a mesma automação,
  // numa forma que uma pessoa lê.
  //
  // É isto que destrava a edição. O assistente do painel monta UMA forma (um
  // comando que responde um texto), e as automações instaladas estão todas
  // fora dela. Elas abriam em somente leitura não porque editar fosse
  // perigoso, mas porque a tela não conseguia REPRESENTÁ-LAS.
  roteador.get('/api/v1/automations/:id/lcn', async ({ params }) => {
    // `obter` fala com o motor por socket, então é assíncrono. Ler o resultado
    // sem esperar devolve a Promise, e `atual?.draft` vira undefined — a rota
    // respondia "automação sem rascunho" para automações que têm rascunho.
    const atual = await automacoes().obter(params.id)
    const documento = atual?.draft?.document
    if (!documento) throw new ErroHttp(404, `Automação sem rascunho: ${params.id}.`)
    try {
      return { texto: descompilar(documento), etag: atual.draft.etag, revision: atual.draft.revision }
    } catch (erro) {
      // Documento que a linguagem ainda não sabe escrever não pode virar 500:
      // a tela precisa conseguir dizer POR QUE não dá para editar.
      throw new ErroHttp(422, `Esta automação ainda não vira texto: ${erro.message}`)
    }
  })

  // --- a linguagem explicada ----------------------------------------------
  //
  // A referência fica no BFF, e não no motor, por um motivo prático: ela tem de
  // abrir COM O MOTOR CAÍDO. É justamente quando algo está quebrado que alguém
  // vai ler o que a linguagem aceita. Esta rota não toca em banco, em socket
  // nem em disco.
  roteador.get('/api/v1/meta/linguagem', () => REFERENCIA_DA_LINGUAGEM)

  // O CATÁLOGO DAS FUNÇÕES DE CONEXÃO.
  //
  // É o pedido do dono: "quem for fazer não precisa entender como funciona por
  // baixo do pano, só saber que tal função cria um carrossel com botões".
  // `chama <conexão>.<função>` é a única ação de campos abertos da linguagem, e
  // até aqui se escrevia às cegas.
  //
  // Nenhum dado novo: `listar()` já devolve a config inteira sem o segredo, e
  // a frase é derivada dela. O exemplo sai da tabela da ação `chama`, então o
  // trecho que o painel oferece não tem como divergir do que o compilador lê.
  roteador.get('/api/v1/meta/funcoes-de-conexao', async () => {
    const montar = (conexao, funcoes, instalada) => {
      const config = conexao?.config || {}
      return funcoes.map((funcao) => {
        const entradas = descreverEntradas(funcao)
        return {
          conexao: conexao.id,
          instalada,
          titulo: conexao.titulo || config.titulo || conexao.id,
          funcao: funcao.nome,
          descricao: funcao.descricao || null,
          devolve: descreverResposta(funcao.resposta),
          forma: funcao.resposta?.forma || null,
          arquivos: quantosArquivos(funcao),
          esperaSegundos: funcao.esperaSegundos ?? null,
          entradas,
          exemplo: exemploDeChamada({ conexao: conexao.id, funcao: { nome: funcao.nome, entradas } })
        }
      })
    }
    // As prontas entram marcadas como NÃO instaladas, em vez de ficarem de
    // fora: saber que a função existe é metade do caminho para alguém decidir
    // configurar a conexão. Esconder até lá seria esconder o que o sistema sabe
    // fazer de quem está justamente tentando descobrir isso.
    //
    // E a conta é por FUNÇÃO, não por conexão: a pronta de mídia ganhou
    // `musica` e `buscar` depois, e quem já tinha a conexão ficou só com
    // `baixar`. Marcar a conexão inteira como instalada ofereceria duas
    // funções que aquela instalação não tem — `funcoesQueFaltam` é a lista que
    // a própria rota de prontas já calcula para esse caso.
    const instaladas = await conexoes().listar()
    const prontas = await conexoes().prontas()
    // Numa pronta já cadastrada, as que valem listar são só as que faltam —
    // as outras já saíram na volta das instaladas.
    const queFaltam = (c) => {
      const todas = c.config?.funcoes || []
      if (!c.jaCadastrada) return todas
      const faltando = new Set(c.funcoesQueFaltam || [])
      return todas.filter((f) => faltando.has(f.nome))
    }
    return [
      ...(instaladas || []).flatMap((c) => montar(c, c.config?.funcoes || [], true)),
      ...(prontas || []).flatMap((c) => montar(c, queFaltam(c), false))
    ]
  })

  // CONFERIR O TEXTO SEM GRAVAR NADA.
  //
  // Até aqui "compilar" e "salvar" eram a mesma ação: a pessoa só descobria o
  // erro ao clicar em salvar, um erro por vez. Esta rota separa as duas coisas
  // e não escreve em lugar nenhum — é o que permite conferir enquanto se
  // escreve, sem criar rascunho a cada tecla.
  roteador.post('/api/v1/lcn/validar', ({ body }) => {
    const texto = String(body?.texto ?? '')
    let compilado
    try {
      compilado = compilar(texto)
    } catch (erro) {
      if (!(erro instanceof ErroDeSintaxe)) throw erro
      // 200, e não 422: aqui o erro de escrita é o RESULTADO esperado da
      // conferência, não falha do pedido. Devolver 422 faria o painel tratar
      // "ainda estou escrevendo" como pedido quebrado.
      return { ok: false, erro: { mensagem: erro.message, linha: erro.linha ?? null } }
    }
    const documento = compilado.template ? compilado.documentTemplate : compilado
    const gatilho = documento?.flow?.nodes?.[0]
    return {
      ok: true,
      tipo: compilado.template ? 'template' : 'automação',
      resumo: {
        nome: documento?.name || compilado.template?.name || null,
        gatilho: gatilho?.type || null,
        comando: gatilho?.config?.command || null,
        acoes: Math.max((documento?.flow?.nodes?.length || 1) - 1, 0)
      }
    }
  })

  // CRIAR uma automação escrevendo a linguagem.
  //
  // Antes, criar era o assistente de seis passos — que monta exatamente uma
  // forma (um comando que responde um texto) e chama de "resumo" tudo o que não
  // cabe nela. Quem criava assim não conseguia expressar nada do que o catálogo
  // já faz, e depois abria a própria automação e via duas linhas no lugar dela.
  //
  // Aqui o id vem do TEXTO, e é a única rota em que isso vale: não há automação
  // ainda, então não há nada que o texto possa renomear por engano.
  roteador.post('/api/v1/automations/lcn', ({ body }) => {
    let compilado
    try {
      compilado = compilar(String(body?.texto ?? ''))
    } catch (erro) {
      if (!(erro instanceof ErroDeSintaxe)) throw erro
      throw new ErroHttp(422, erro.message, { linha: erro.linha })
    }
    if (compilado.template) {
      throw new ErroHttp(422, 'Isto é um template, não uma automação. Instale pelo Catálogo.')
    }
    if (!compilado.id) {
      throw new ErroHttp(422, 'Falta a linha "id:" — é por ela que a automação passa a existir.')
    }
    return automacoes().criar(compilado)
  })

  roteador.put('/api/v1/automations/:id/lcn', ({ params, body, req }) => {
    let documento
    try {
      documento = compilar(String(body?.texto ?? ''))
    } catch (erro) {
      if (!(erro instanceof ErroDeSintaxe)) throw erro
      // 422 com a linha: erro de escrita é do texto, não do servidor.
      throw new ErroHttp(422, erro.message, { linha: erro.linha })
    }
    if (documento.template) {
      throw new ErroHttp(422, 'Isto é um template, não uma automação. Instale pelo Catálogo.')
    }
    // O id vem da ROTA, não do texto: deixar o texto renomear a automação
    // criaria uma segunda pelo caminho de salvar a primeira.
    documento.id = params.id
    return automacoes().salvarRascunho(params.id, documento, req?.headers?.['if-match'])
  })

  // --- donos ---
  //
  // O motor tem isto inteiro desde sempre (`routes/owners.js`), e o BFF nunca
  // repassou: `GET /api/v1/owners` respondia "Rota não encontrada". O efeito
  // era um beco sem saída para quem aluga o sistema — `chavesReservadas.js`
  // manda usar "a tela de Donos", a tela não existia, e `__owner__` é chave
  // reservada, então nem pela aba Dados dava para contornar. Sobrava cadastrar
  // dono por mensagem de WhatsApp de si para si, ou HTTP direto no motor —
  // justamente o que quem não tem terminal não alcança.
  roteador.get('/api/v1/owners', () => donos().listar())
  roteador.post('/api/v1/owners', ({ body }) => donos().adicionar(body?.contactId))
  roteador.delete('/api/v1/owners/:contactId', ({ params }) => donos().remover(params.contactId))

  // --- configuração do menu ---
  //
  // Mesma história: CRUD pronto no motor (`routes/menu.js`), incluindo a
  // pré-visualização que a própria rota diz existir "para a UI", e nenhuma
  // rota aqui. Até hoje o menu só se configurava de dentro do WhatsApp, pelo
  // comando de configuração, um campo por mensagem.
  //
  // `effective` é o que de fato vale numa conversa, já resolvida a cascata
  // (config da conversa > padrão do tipo > padrão do código): é o que permite
  // a tela mostrar o resultado em vez de a pessoa deduzir qual camada ganhou.
  roteador.get('/api/v1/menu-config/effective', ({ query }) => menu().obterEfetivo(query.get('chatId'), query.get('chatKind')))
  roteador.get('/api/v1/menu-config/:kind', ({ params, query }) => menu().obter(params.kind, query.get('id')))
  roteador.put('/api/v1/menu-config/:kind', ({ params, query, body }) => menu().salvar(params.kind, query.get('id'), body))
  roteador.delete('/api/v1/menu-config/:kind', ({ params, query }) => menu().remover(params.kind, query.get('id')))

  // --- pools (coordenação multi-bot) ---
  roteador.get('/api/v1/pools', () => pools().listar())
  roteador.post('/api/v1/pools', ({ body }) => pools().criar(body))
  roteador.get('/api/v1/pools/:id', ({ params }) => pools().obter(params.id))
  roteador.put('/api/v1/pools/:id', ({ params, body }) => pools().atualizar(params.id, body))
  roteador.delete('/api/v1/pools/:id', ({ params }) => pools().remover(params.id))
  roteador.put('/api/v1/pools/:id/members/:instanceId', ({ params, body }) => pools().salvarMembro(params.id, params.instanceId, body))
  roteador.delete('/api/v1/pools/:id/members/:instanceId', ({ params }) => pools().removerMembro(params.id, params.instanceId))

  // --- conexões (segredos de integração — nunca devolvidos em claro pelo motor) ---
  roteador.get('/api/v1/connections', () => conexoes().listar())
  // As declarações prontas: servem de exemplo de como se declara uma conexão,
  // e de atalho para recadastrar uma que foi apagada.
  roteador.get('/api/v1/connections-prontas', () => conexoes().prontas())
  roteador.post('/api/v1/connections', ({ body }) => conexoes().criar(body))
  roteador.get('/api/v1/connections/:id', ({ params }) => conexoes().obter(params.id))
  roteador.put('/api/v1/connections/:id', ({ params, body }) => conexoes().atualizar(params.id, body))
  roteador.delete('/api/v1/connections/:id', ({ params }) => conexoes().remover(params.id))

  // --- execuções (Módulo 2, histórico/erros pro painel) ---
  roteador.get('/api/v1/executions', ({ query }) => execucoes().listar(queryObjeto(query)))
  roteador.get('/api/v1/executions/:runId', ({ params }) => execucoes().obter(params.runId))

  // --- retenção: por quanto tempo o histórico de execução fica guardado ---
  roteador.get('/api/v1/retention', () => retencao().obter())
  roteador.put('/api/v1/retention', ({ body }) => retencao().salvar(body?.horas))
  roteador.post('/api/v1/retention/sweep', ({ body }) => retencao().varrer(body))

  // --- variáveis (Parte C, Módulo 1) ---
  roteador.get('/api/v1/meta/variables', () => meta().obterVariaveis())
  roteador.get('/api/v1/entities/:kind/:id/attributes', ({ params }) => entidades().listar(params.kind, params.id))
  roteador.put('/api/v1/entities/:kind/:id/attributes/:key', ({ params, body }) => entidades().definir(params.kind, params.id, params.key, body?.value))
  roteador.delete('/api/v1/entities/:kind/:id/attributes/:key', ({ params }) => entidades().remover(params.kind, params.id, params.key))

  // --- catálogo de comandos/templates (Parte C, Módulo 4) ---
  roteador.get('/api/v1/templates', () => templates().listar())
  roteador.get('/api/v1/templates/updates', () => templates().atualizacoes())
  roteador.get('/api/v1/templates/:id', ({ params }) => templates().obter(params.id))
  roteador.post('/api/v1/templates/:id/install', ({ params, body }) => templates().instalar(params.id, body))

  return roteador
}
