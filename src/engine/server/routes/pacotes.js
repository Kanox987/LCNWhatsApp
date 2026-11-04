// Provisionamento por PACOTE: a configuração inicial que o §8 pede.
//
// POR QUE ESTA ROTA EXISTE, e não é a de template com outro nome (D-38):
// `POST /templates/:id/install` instala UM template e a árvore `dependsOn`
// dele. O §8 pede o contrário — "permitir que um cliente configure uma
// instância sem precisar criar automações manualmente", escolhendo entre
// instância vazia, pacote básico, de atendimento, de administração, de
// proteção, funcionalidades específicas ou configuração personalizada. Isso é
// uma ESCOLHA DE PROVISIONAMENTO, e é ela que fica registrada
// (`package_installations`), não cada clique de catálogo depois.
//
// O miolo de publicar é o mesmo nas duas rotas e vive em `provisionarMembros.js`
// desde a extração (D-40) — aqui não há segundo laço de publicação.
//
// ALTERNATIVA RECUSADA: aceitar `packageId` como mais um corpo possível de
// `POST /templates/:id/install`. Seria uma rota só, e ela passaria a ter dois
// significados (um template; uma configuração inteira da instância) com dois
// registros diferentes no banco — e `prepararEscolha` lançaria no dia em que um
// template chegasse como `kind: 'pacote'` sem `packageId`. Proveniência
// fictícia é exatamente o que D-29/D-32 proíbem.
import { ErroHttp, resposta } from '../transport.js'
import { criarServicoAutomacoes } from '../automationsService.js'
import { carregarCatalogo, resolverOrdemInstalacao } from '../../templates/catalog.js'
import { carregarPacotes, resolverPacote } from '../../templates/pacotes.js'
import { classificarOrdem, decidirProvisionamento } from '../provisionamento.js'
import { leitoresDeClassificacao, publicarMembros } from '../provisionarMembros.js'
import {
  escopoDoMotor, registrarInstalacao, bindingPorPosse, instalacaoViva,
  estadoDosItens, planejarRemocao, marcarRemovida, itensDaInstalacao
} from '../registroDePacotes.js'

const ESCOLHAS_ACEITAS = ['vazia', 'pacote', 'especificas', 'personalizada']

export function registrarRotasPacotes (roteador, db, {
  catalogo = carregarCatalogo(),
  pacotes = carregarPacotes()
} = {}) {
  const servicoAutomacoes = criarServicoAutomacoes(db)
  const inserirProvenance = db.prepare(`INSERT INTO automation_template_provenance
    (automation_id, template_id, template_version, parameters_json, installed_at)
    VALUES (?, ?, ?, ?, ?)`)
  const obterProvenance = db.prepare('SELECT * FROM automation_template_provenance WHERE automation_id = ?')
  const leitores = leitoresDeClassificacao({ db, servicoAutomacoes, obterProvenance })

  // A mesma consulta que o portão de publicação usa (`validate.js:153`). Ela
  // prova que a conexão foi DECLARADA, não que o serviço atende — e o texto da
  // resposta diz isso, porque prometer alcance que não medimos é o que o §8
  // chama de "apresentar uma funcionalidade como disponível quando ela depende
  // de um serviço ausente".
  const conexaoExiste = db.prepare('SELECT 1 FROM connections WHERE id = ?')
  const faltamConexoes = (exigidas) => (exigidas || []).filter((ref) => !conexaoExiste.get(ref))

  // Os quatro dados que `estadoDosItens` precisa, e por que são quatro: a
  // revisão ativa diz se está publicada, a mais recente diz se o conteúdo foi
  // mexido (é a que `publicar` republicaria), e `enabled`/`deployment_mode`
  // desligam a automação sem criar revisão nenhuma — `routes/automations.js:159`
  // e `:173` escrevem essas duas colunas direto, e `evaluator.js` exige as duas
  // para a automação sequer ser candidata.
  const obterEstadoDaAutomacao = db.prepare(`
    SELECT a.active_revision_id, a.enabled, a.deployment_mode,
           (SELECT MAX(r.id) FROM automation_revisions r WHERE r.automation_id = a.id) AS ultima_revisao_id
      FROM automations a WHERE a.id = ?
  `)
  const lerEstadoDaAutomacao = (id) => {
    const linha = obterEstadoDaAutomacao.get(id)
    if (!linha) return null
    return {
      ativa: linha.active_revision_id ?? null,
      ultima: linha.ultima_revisao_id ?? null,
      enabled: linha.enabled === 1,
      deploymentMode: linha.deployment_mode
    }
  }

  // MEDIDO, e é a razão de este bloco existir: os 121 templates do catálogo
  // declaram `poolId` e NENHUM tem padrão (`render.js:46` lança quando o valor
  // não vem e a definição não tem `default`). Então todo pacote exige pelo
  // menos um parâmetro, e um `GET /pacotes` que dissesse só `instalavel: true`
  // estaria "apresentando uma funcionalidade como disponível" sem dizer o que
  // ela depende — exatamente o que o §8 proíbe. A lista sai do catálogo, não de
  // uma segunda tabela escrita à mão: parâmetro novo num template aparece aqui
  // sozinho.
  const parametrosExigidosDe = (membros) => {
    const porChave = new Map()
    for (const membro of membros) {
      const template = catalogo.get(membro.templateId)
      for (const definicao of template?.parameters || []) {
        if (definicao.default !== undefined) continue
        const existente = porChave.get(definicao.key)
        if (existente) { existente.templates.push(membro.templateId); continue }
        porChave.set(definicao.key, {
          key: definicao.key,
          tipo: definicao.type,
          rotulo: definicao.label ?? null,
          ajuda: definicao.help ?? null,
          templates: [membro.templateId]
        })
      }
    }
    return [...porChave.values()]
  }

  // Verificação de dependência de verdade, e não de forma: `poolId` não é texto
  // livre, é a chave de uma linha em `pools`. Aceitar um pool inexistente
  // publicaria comandos que nunca respondem — o teste "dependência não
  // configurada" do §8 é este caso, e ele existe no catálogo de hoje sem
  // precisar de pacote semeado.
  const poolExiste = db.prepare('SELECT 1 FROM pools WHERE id = ?')

  // Lê o manifesto cru e devolve a composição resolvida, OU a razão de ela não
  // ser oferecível. `resolverPacote` lança de propósito: pacote que não instala
  // por inteiro não deve aparecer como opção instalável.
  function avaliarPacote (manifesto) {
    let resolvido
    try {
      resolvido = resolverPacote(catalogo, manifesto)
    } catch (erro) {
      return {
        packageId: manifesto.packageId,
        packageVersion: manifesto.packageVersion,
        name: manifesto.name,
        instalavel: false,
        motivo: erro.message,
        membros: [],
        conexoesExigidas: [],
        conexoesFaltando: []
      }
    }
    const conexoesFaltando = faltamConexoes(resolvido.conexoesExigidas)
    return {
      packageId: resolvido.packageId,
      packageVersion: resolvido.packageVersion,
      name: resolvido.name,
      instalavel: conexoesFaltando.length === 0,
      motivo: conexoesFaltando.length === 0
        ? null
        : textoConexaoAusente(conexoesFaltando),
      membros: resolvido.membros.map((m) => ({
        itemKey: m.itemKey, templateId: m.templateId, templateVersion: m.templateVersion, origem: m.origem
      })),
      conexoesExigidas: resolvido.conexoesExigidas,
      conexoesFaltando,
      parametrosExigidos: parametrosExigidosDe(resolvido.membros)
    }
  }

  roteador.get('/pacotes', () => ({
    pacotes: [...pacotes.values()].map(avaliarPacote)
  }))

  // Os membros de uma escolha `especificas`/`personalizada`: a mesma resolução
  // de dependência da rota de template, aplicada à lista pedida, com a ordem
  // preservada e sem repetir um template que já entrou como dependência de
  // outro.
  function membrosDaLista (templateIds) {
    const porTemplate = new Map()
    for (const raiz of templateIds) {
      let ordem
      try {
        ordem = resolverOrdemInstalacao(catalogo, raiz)
      } catch (erro) {
        throw new ErroHttp(400, erro.message)
      }
      for (const templateId of ordem) {
        const origem = templateId === raiz ? 'pedido' : 'dependencia'
        const existente = porTemplate.get(templateId)
        if (existente) {
          if (origem === 'pedido') existente.origem = 'pedido'
          continue
        }
        porTemplate.set(templateId, {
          itemKey: templateId,
          templateId,
          templateVersion: catalogo.get(templateId).templateVersion,
          origem
        })
      }
    }
    return [...porTemplate.values()]
  }

  // Monta a escolha e os membros a partir do corpo. Separado da transação de
  // propósito: pedido malformado é recusado antes de qualquer escrita.
  function lerEscolha (body) {
    const kind = body?.kind
    if (!ESCOLHAS_ACEITAS.includes(kind)) {
      throw new ErroHttp(400, `kind inválido: ${kind}. Use ${ESCOLHAS_ACEITAS.join(', ')}.`)
    }

    if (kind === 'vazia') {
      // Instância vazia é estado alcançável DE PROPÓSITO (§8: "uma instância
      // deve poder começar completamente vazia"). O registro com zero membros é
      // o que distingue "escolhi não instalar nada" de "nunca provisionei".
      return { escolha: { kind: 'vazia' }, selecao: {}, membros: [] }
    }

    if (kind === 'pacote') {
      const packageId = body?.packageId
      const manifesto = typeof packageId === 'string' ? pacotes.get(packageId) : null
      if (!manifesto) throw new ErroHttp(404, `Pacote não encontrado: ${packageId}.`)
      const avaliado = avaliarPacote(manifesto)
      if (!avaliado.instalavel) throw new ErroHttp(409, avaliado.motivo)
      const resolvido = resolverPacote(catalogo, manifesto)
      return {
        escolha: { kind: 'pacote', packageId: resolvido.packageId, packageVersion: resolvido.packageVersion },
        selecao: {},
        membros: resolvido.membros.map((m) => ({
          itemKey: m.itemKey, templateId: m.templateId, templateVersion: m.templateVersion, origem: m.origem
        }))
      }
    }

    const templateIds = body?.templateIds
    if (!Array.isArray(templateIds) || templateIds.length === 0) {
      throw new ErroHttp(400, `A escolha "${kind}" precisa de templateIds — e uma lista vazia é a escolha "vazia", que tem nome próprio.`)
    }
    for (const id of templateIds) {
      if (typeof id !== 'string' || !catalogo.get(id)) {
        throw new ErroHttp(400, `Template não encontrado no catálogo: ${id}.`)
      }
    }
    const membros = membrosDaLista(templateIds)
    const faltando = faltamConexoes([...new Set(membros.flatMap((m) => conexoesDoMembro(m, body)))])
    if (faltando.length) {
      throw new ErroHttp(409, textoConexaoAusente(faltando))
    }
    // A seleção é o que a chave da instalação resume: a mesma lista pedida duas
    // vezes é a MESMA escolha, e provisionar de novo não cria instalação nova.
    return { escolha: { kind }, selecao: { templateIds: [...templateIds].sort() }, membros }
  }

  // A conexão que o comando vai chamar sai do fluxo compilado do template. O
  // `connectionRef` é `{{params.x}}`: vale o que o pedido escolheu para x
  // (parâmetro do template, depois o comum) e, na falta, o padrão do template.
  // O LCN não acessa a web: só o WhatsApp e as APIs conectadas pelo painel.
  // Comando como /clima não é função nativa — é uma chamada a um serviço que
  // o dono precisa ter conectado, e a recusa tem de dizer isso.
  function textoConexaoAusente (faltando) {
    return `Depende de conexão que não está declarada: ${faltando.join(', ')}. Isto não é uma função nativa: o LCN só alcança o WhatsApp e as APIs conectadas pelo painel, sem acesso direto à web. Cadastre o serviço na aba Conexões antes de provisionar.`
  }

  function conexoesDoMembro (membro, body) {
    const template = catalogo.get(membro.templateId)
    const escolhidos = { ...(body?.parametrosComuns || {}), ...(body?.parameters?.[membro.templateId] || {}) }
    const exigidas = new Set()
    for (const no of template?.documentTemplate?.flow?.nodes || []) {
      if (no.type !== 'action.connection.call') continue
      const ref = no.config?.connectionRef
      const parametro = typeof ref === 'string' ? /^\{\{params\.([A-Za-z0-9_]+)\}\}$/.exec(ref) : null
      if (!parametro) { if (ref) exigidas.add(ref); continue }
      const padrao = (template.parameters || []).find((p) => p.key === parametro[1])?.default
      const efetivo = escolhidos[parametro[1]] || padrao
      if (typeof efetivo === 'string' && efetivo) exigidas.add(efetivo)
    }
    return [...exigidas]
  }

  const provisionar = db.transaction((body) => {
    const { escolha, selecao, membros } = lerEscolha(body)
    const escopo = escopoDoMotor()

    const scope = body?.scope
    if (membros.length && (!scope || !Array.isArray(scope.include) || scope.include.length === 0)) {
      throw new ErroHttp(400, 'scope.include não pode ser vazio — automação provisionada por pacote também nunca casa com "todos" por padrão.')
    }
    const deploymentMode = body?.deploymentMode === undefined ? 'live' : body.deploymentMode
    if (deploymentMode !== 'live' && deploymentMode !== 'shadow') {
      throw new ErroHttp(400, `deploymentMode inválido: ${deploymentMode}. Use "live" ou "shadow".`)
    }
    // `parametrosComuns` existe porque `poolId` é o MESMO para os 11 membros do
    // pacote de administração, e obrigar o painel a repetir o valor template por
    // template seria transformar uma escolha única em onze. O mapa por template
    // continua valendo e tem precedência: o comum é padrão, não teto.
    const comuns = body?.parametrosComuns && typeof body.parametrosComuns === 'object' ? body.parametrosComuns : {}
    const porTemplateDoCorpo = body?.parameters && typeof body.parameters === 'object' ? body.parameters : {}
    const parametrosPorTemplate = {}
    for (const membro of membros) {
      parametrosPorTemplate[membro.templateId] = { ...comuns, ...(porTemplateDoCorpo[membro.templateId] || {}) }
    }
    const automationIds = body?.automationIds && typeof body.automationIds === 'object' ? body.automationIds : {}

    // Diagnóstico ANTES de publicar, e completo. `renderizarTemplate` recusa um
    // parâmetro de cada vez, do primeiro membro que falha — quem provisiona um
    // pacote de onze comandos descobriria a lista em onze tentativas. Aqui a
    // resposta diz tudo que falta de uma vez, com o rótulo e a ajuda que o
    // template declara, para a tela poder perguntar.
    const faltando = []
    for (const exigido of parametrosExigidosDe(membros)) {
      const semValor = exigido.templates.filter((templateId) => (
        parametrosPorTemplate[templateId]?.[exigido.key] === undefined
      ))
      if (semValor.length) faltando.push({ ...exigido, templates: semValor })
    }
    if (faltando.length) {
      const erro = new ErroHttp(400, `Faltam parâmetros obrigatórios: ${faltando.map((f) => f.key).join(', ')}.`)
      erro.detalhes = { parametrosFaltando: faltando }
      throw erro
    }

    const poolsPedidos = new Set()
    for (const templateId of Object.keys(parametrosPorTemplate)) {
      const valor = parametrosPorTemplate[templateId].poolId
      if (typeof valor === 'string' && valor) poolsPedidos.add(valor)
    }
    const poolsAusentes = [...poolsPedidos].filter((id) => !poolExiste.get(id))
    if (poolsAusentes.length) {
      const erro = new ErroHttp(409, `Pool não cadastrado: ${poolsAusentes.join(', ')}. Crie o pool na aba Pools antes de provisionar.`)
      erro.detalhes = { poolsAusentes }
      throw erro
    }

    const classificacao = classificarOrdem({
      ordem: membros.map((m) => m.templateId),
      catalogo,
      automationIds,
      parametrosPorTemplate,
      ...leitores
    })
    const decisao = decidirProvisionamento(classificacao)
    if (!decisao.podeInstalar) {
      const erro = new ErroHttp(409, decisao.impedem.map((m) => m.motivo).join(' '))
      erro.detalhes = { itens: classificacao }
      throw erro
    }

    const { instaladas, restauradas, jaInstalados } = publicarMembros({
      db, catalogo, servicoAutomacoes, inserirProvenance,
      classificacao, scope, deploymentMode, parametrosPorTemplate
    })

    // O registro vem DEPOIS de publicar, dentro da MESMA transação (D-36):
    // `initial_revision_id` só existe depois do publish, e é ele que permite
    // dizer mais tarde se a automação foi editada à mão.
    const revisaoInicial = new Map(instaladas.map((a) => [a.id, a.activeRevisionId ?? null]))
    const porTemplate = new Map(classificacao.map((c) => [c.templateId, c]))

    const membrosDoRegistro = membros.map((membro) => {
      const classificado = porTemplate.get(membro.templateId)
      const automationId = classificado.automationId
      if (classificado.estado === 'novo') {
        return {
          ...membro,
          automationId,
          binding: 'criada',
          initialRevisionId: revisaoInicial.get(automationId) ?? null
        }
      }
      // Membro que JÁ existia não nasceu deste provisionamento — quem decide o
      // vínculo é a posse registrada, não o republish (D-39). Sem isso, um
      // pacote herdaria a posse de uma automação que outro pacote criou, e a
      // remoção apagaria o que não é dela.
      const posse = bindingPorPosse(db, escopo, escolha, automationId, selecao)
      return {
        ...membro,
        automationId,
        binding: posse.binding,
        initialRevisionId: posse.initialRevisionId,
        motivoDoVinculo: posse.motivo
      }
    })

    const registro = registrarInstalacao(db, {
      escopo,
      escolha,
      selecao,
      membros: membrosDoRegistro.map(({ motivoDoVinculo, ...m }) => m)
    })

    // Provisionar de novo NÃO reescreve o que já está no ar (a instalação é a
    // identidade, não o pedido). Mas silenciar a diferença faria quem pede
    // "agora só neste grupo" acreditar que o escopo mudou. O aviso nomeia a
    // automação que ficou como estava; mudar de fato é reconfigurar.
    const avisos = []
    const pedidoScope = JSON.stringify({ include: scope?.include ?? [], exclude: Array.isArray(scope?.exclude) ? scope.exclude : [] })
    for (const { automationId } of [...jaInstalados, ...restauradas.map((a) => ({ automationId: a.id }))]) {
      const linha = leitores.lerAutomacao(automationId)
      const documento = leitores.lerUltimoDocumento(automationId)
      if (documento?.scope && membros.length) {
        const gravado = JSON.stringify({ include: documento.scope.include ?? [], exclude: documento.scope.exclude ?? [] })
        if (gravado !== pedidoScope) {
          avisos.push({ codigo: 'escopoDivergente', automationId, mensagem: 'O escopo pedido é diferente do que já está instalado; o instalado foi mantido.' })
        }
      }
      if (linha && linha.deployment_mode !== deploymentMode) {
        avisos.push({ codigo: 'modoDivergente', automationId, mensagem: `O modo pedido (${deploymentMode}) é diferente do instalado (${linha.deployment_mode}); o instalado foi mantido.` })
      }
    }

    return {
      installationId: registro.installationId,
      jaExistia: registro.jaExistia,
      acrescentados: registro.acrescentados,
      recriados: registro.recriados,
      ausentes: registro.ausentes,
      avisos,
      kind: escolha.kind,
      packageId: escolha.packageId ?? null,
      installed: instaladas,
      restored: restauradas,
      alreadyInstalled: jaInstalados,
      deploymentMode,
      vinculos: membrosDoRegistro.map((m) => ({
        itemKey: m.itemKey, automationId: m.automationId, binding: m.binding, motivo: m.motivoDoVinculo ?? 'criadaAgora'
      }))
    }
  })

  roteador.post('/pacotes/provisionar', ({ body }) => resposta(201, provisionar(body)))

  // O estado do que foi provisionado, com explicação — §8 exige que automação
  // inativa ou incompatível tenha estado visível e explicado.
  roteador.get('/pacotes/provisionamento', () => {
    const escopo = escopoDoMotor()
    const instalacoes = db.prepare(`
      SELECT * FROM package_installations
       WHERE scope_kind = ? AND scope_id = ? AND removed_at IS NULL
       ORDER BY created_at
    `).all(escopo.kind, escopo.id)
    return {
      escopo,
      instalacoes: instalacoes.map((inst) => ({
        installationId: inst.installation_id,
        kind: inst.kind,
        packageId: inst.package_id,
        packageVersion: inst.package_version,
        selecao: inst.selection_json ? JSON.parse(inst.selection_json) : {},
        criadoEm: inst.created_at,
        itens: estadoDosItens(db, inst.installation_id, lerEstadoDaAutomacao).map((item) => ({
          itemKey: item.item_key,
          automationId: item.automation_id,
          templateId: item.template_id,
          templateVersion: item.template_version,
          origem: item.origin,
          binding: item.binding,
          atividade: item.atividade,
          personalizacao: item.personalizacao,
          // Os dois eixos numa frase, nesta ordem: primeiro se está no ar,
          // depois se o conteúdo é o instalado. Quem lê a tela quer as duas.
          explicacao: [ATIVIDADE[item.atividade], PERSONALIZACAO[item.personalizacao]]
            .filter(Boolean).join(' ') || null
        }))
      }))
    }
  })

  const ATIVIDADE = {
    noAr: 'A automação está no ar.',
    despublicada: 'A automação não tem revisão ativa: ela foi tirada do ar.',
    desligada: 'A automação está desligada, então ela não responde a nada — nem em sombra.',
    sombra: 'A automação está em sombra: ela é avaliada mas não fala no grupo.',
    ausente: 'A automação não existe mais: ela foi apagada por fora do pacote.'
  }

  const PERSONALIZACAO = {
    naoVerificavel: 'Não há como dizer se o conteúdo foi editado: falta a revisão inicial ou a automação.',
    comoInstalada: 'O conteúdo está exatamente como o provisionamento o deixou.',
    editada: 'O conteúdo foi editado depois de instalado. Atualizar o pacote não sobrescreve essa edição sem autorização.'
  }

  // Remover um pacote devolve só o que ELE criou e que ninguém mais reivindica.
  // O plano é calculado e devolvido junto, para quem administra ver o que foi
  // soltado em vez de removido.
  const remover = db.transaction((installationId) => {
    const existe = db.prepare('SELECT * FROM package_installations WHERE installation_id = ? AND removed_at IS NULL').get(installationId)
    if (!existe) throw new ErroHttp(404, `Instalação não encontrada ou já removida: ${installationId}.`)
    const plano = planejarRemocao(db, installationId)
    for (const item of plano.aRemover) {
      servicoAutomacoes.despublicar(item.automation_id)
    }
    marcarRemovida(db, installationId)
    return {
      installationId,
      removidas: plano.aRemover.map((i) => ({ itemKey: i.item_key, automationId: i.automation_id })),
      soltas: plano.aSoltar.map((i) => ({ itemKey: i.item_key, automationId: i.automation_id, motivo: i.motivo }))
    }
  })

  roteador.delete('/pacotes/provisionamento/:installationId', ({ params }) => remover(params.installationId))

  return { avaliarPacote, instalacaoViva, itensDaInstalacao }
}
