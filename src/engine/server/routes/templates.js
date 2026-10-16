// Catálogo de comandos + instalação (Parte C, Módulo 4 do plano). Cada
// template materializa em UMA OU MAIS automações reais, passando pelo
// MESMO caminho de criar+publicar que uma automação feita à mão no wizard
// usa (automationsService.js) — nunca um atalho que pule validação.
import { ErroHttp, resposta } from '../transport.js'
import { criarServicoAutomacoes } from '../automationsService.js'
import { carregarCatalogo, resolverOrdemInstalacao } from '../../templates/catalog.js'
import { renderizarTemplate, renderizarVariaveisDeclaradas } from '../../templates/render.js'
import { declararDoTemplate } from '../declaredVariables.js'
import { analisarReconfiguracao, aplicarValores, sanearValores } from '../../../reconfiguracao.js'

function exporTemplateResumo (template) {
  return {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    name: template.name,
    description: template.description,
    category: template.category,
    dependsOn: template.dependsOn || [],
    requiredCapabilities: template.requiredCapabilities || [],
    variables: template.variables || [],
    warnings: template.warnings || [],
    parameters: template.parameters
  }
}

export function registrarRotasTemplates (roteador, db, { catalogo = carregarCatalogo() } = {}) {
  const servicoAutomacoes = criarServicoAutomacoes(db)
  const inserirProvenance = db.prepare(`INSERT INTO automation_template_provenance
    (automation_id, template_id, template_version, parameters_json, installed_at)
    VALUES (?, ?, ?, ?, ?)`)
  const obterProvenance = db.prepare('SELECT * FROM automation_template_provenance WHERE automation_id = ?')
  // Reconfigurar reescreve os valores da instalação. A tabela só tinha INSERT
  // porque nada voltava atrás; a PK já é automation_id, então o upsert não
  // precisa de migração.
  const gravarProvenance = db.prepare(`INSERT INTO automation_template_provenance
    (automation_id, template_id, template_version, parameters_json, installed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(automation_id) DO UPDATE SET
      template_id = excluded.template_id,
      template_version = excluded.template_version,
      parameters_json = excluded.parameters_json`)

  // Instalação inteira (template + toda a árvore dependsOn) numa única
  // transação: se qualquer automação da árvore falhar validação/publish,
  // nenhuma fica registrada — better-sqlite3 aceita chamar funções já
  // .transaction() (criar/publicar, dentro de criarEPublicar) de dentro
  // desta transação externa via savepoint automático.
  const instalar = db.transaction((templateIdRaiz, body) => {
    let ordem
    try {
      ordem = resolverOrdemInstalacao(catalogo, templateIdRaiz)
    } catch (erro) {
      throw new ErroHttp(400, erro.message)
    }

    const scope = body?.scope
    if (!scope || !Array.isArray(scope.include) || scope.include.length === 0) {
      throw new ErroHttp(400, 'scope.include não pode ser vazio — automação instalada por template também nunca casa com "todos" por padrão.')
    }
    // Em que modo a instalação NASCE.
    //
    // A coluna tem DEFAULT 'shadow' (migração 002) e esta rota nunca definia o
    // campo — então toda automação instalada por template nascia muda: avaliava,
    // registrava "teria executado", e não enviava nada. O controle para trocar
    // existe no painel, mas depois do fato, numa tela que quem acabou de
    // instalar não abriu. Isso já fez anunciarmos duas vezes que um comando
    // estava no ar quando ele estava mudo.
    //
    // Agora quem instala escolhe, e o padrão é o que a pessoa espera ao clicar
    // em "instalar". Sombra continua disponível — é ferramenta boa; o que não
    // pode é ser o padrão invisível.
    const deploymentMode = body?.deploymentMode === undefined ? 'live' : body.deploymentMode
    if (deploymentMode !== 'live' && deploymentMode !== 'shadow') {
      throw new ErroHttp(400, `deploymentMode inválido: ${deploymentMode}. Use "live" ou "shadow".`)
    }
    const automationIds = body?.automationIds && typeof body.automationIds === 'object' ? body.automationIds : {}
    const parametrosPorTemplate = body?.parameters && typeof body.parameters === 'object' ? body.parameters : {}

    const instaladas = []
    for (const templateId of ordem) {
      const template = catalogo.get(templateId)
      const automationId = automationIds[templateId] || templateId
      const parametrosFornecidos = parametrosPorTemplate[templateId] || {}
      let documento
      try {
        documento = renderizarTemplate(template, parametrosFornecidos)
      } catch (erro) {
        throw new ErroHttp(400, `Falha ao montar o template "${templateId}": ${erro.message}`)
      }
      documento.scope = { include: scope.include, exclude: Array.isArray(scope.exclude) ? scope.exclude : [] }
      const automacao = servicoAutomacoes.criarEPublicar({ id: automationId, document: documento })
      db.prepare('UPDATE automations SET deployment_mode = ?, updated_at = ? WHERE id = ?')
        .run(deploymentMode, new Date().toISOString(), automationId)
      automacao.deploymentMode = deploymentMode
      inserirProvenance.run(automationId, template.templateId, template.templateVersion, JSON.stringify(parametrosFornecidos), new Date().toISOString())
      // As variáveis que o comando usa passam a existir no catálogo agora, e
      // não só quando alguma delas receber valor pela primeira vez.
      declararDoTemplate(db, renderizarVariaveisDeclaradas(template, parametrosFornecidos), {
        sourceTemplate: template.templateId,
        sourceAutomation: automationId
      })
      instaladas.push(automacao)
    }
    return { installed: instaladas, deploymentMode }
  })

  roteador.get('/templates', () => [...catalogo.values()].map(exporTemplateResumo))

  // COMANDOS INSTALADOS NUMA VERSÃO ANTIGA DO TEMPLATE.
  //
  // O caminho de adotar a versão nova já existia — é o formulário de
  // reconfigurar, que detecta a troca de versão e avisa o que muda ao salvar.
  // O que faltava era SABER. Ninguém abre o formulário de um comando que está
  // funcionando, então melhoria nenhuma chegava a quem já tinha instalado: o
  // /melhorar ficou sem os modos novos, o /frase sem os temas, e nada na tela
  // dizia isso.
  //
  // Aqui só se INFORMA. Adotar continua sendo um ato de quem opera: regerar o
  // documento descarta edição feita à mão, e isso não pode acontecer sozinho.
  roteador.get('/templates/atualizacoes', () => {
    const linhas = db.prepare(`SELECT p.*, a.id AS existe FROM automation_template_provenance p
      JOIN automations a ON a.id = p.automation_id`).all()
    const pendentes = []
    for (const linha of linhas) {
      const template = catalogo.get(linha.template_id)
      if (!template) continue
      const daInstalacao = linha.template_version ?? null
      const doCatalogo = template.templateVersion ?? null
      if (daInstalacao === null || doCatalogo === null || daInstalacao >= doCatalogo) continue
      pendentes.push({
        automationId: linha.automation_id,
        templateId: linha.template_id,
        nome: template.name,
        de: daInstalacao,
        para: doCatalogo,
        // CAMPOS SEM VALOR GUARDADO nesta instalação.
        //
        // Depois de uma versão nova, são em geral os campos que ela trouxe — e
        // é a resposta mais próxima de "por que eu atualizaria?" que dá para
        // dar sem um changelog que não existe. Mas o nome é esse, e não
        // "novidades", porque a instalação guarda só o que quem instalou
        // informou: um campo deixado no padrão aparece aqui sem ser novidade
        // nenhuma, e prometer o contrário seria a tela mentindo.
        semValorGuardado: (template.parameters || [])
          .filter((d) => !Object.hasOwn(servicoAutomacoes.jsonOuNull(linha.parameters_json) || {}, d.key))
          .map((d) => d.label || d.key)
      })
    }
    return pendentes
  })
  roteador.get('/templates/:id', ({ params }) => {
    const template = catalogo.get(params.id)
    if (!template) throw new ErroHttp(404, `Template não encontrado: ${params.id}.`)
    // Inclui `documentTemplate` cru — é a origem do botão "ver JSON" do
    // catálogo (mockup do usuário), sempre somente-leitura.
    return template
  })
  roteador.post('/templates/:id/install', ({ params, body }) => {
    if (!catalogo.has(params.id)) throw new ErroHttp(404, `Template não encontrado: ${params.id}.`)
    return resposta(201, instalar(params.id, body))
  })
  // --- reconfigurar depois de instalado ------------------------------------
  //
  // O pedido do dono: quem ESCREVE o comando declara o formulário (bloco
  // `configurável` do .lcn); quem USA preenche pelo painel e pode voltar depois
  // para mudar, "sem precisar mudar nos arquivos toda vez".
  //
  // As duas metades já existiam e ninguém tinha ligado: o esquema vive no
  // template, e os valores da instalação em automation_template_provenance.
  // Faltava o caminho de volta.
  function reunir (automationId) {
    const automacao = servicoAutomacoes.obterAutomation.get(automationId)
    if (!automacao) throw new ErroHttp(404, `Automação não encontrada: ${automationId}.`)
    const proveniencia = obterProvenance.get(automationId)
    const template = proveniencia ? catalogo.get(proveniencia.template_id) : null
    const revisaoAtiva = automacao.active_revision_id
      ? db.prepare('SELECT doc_json FROM automation_revisions WHERE id = ?').get(automacao.active_revision_id)
      : null
    const documento = revisaoAtiva ? servicoAutomacoes.jsonOuNull(revisaoAtiva.doc_json) : null
    const valores = proveniencia ? JSON.parse(proveniencia.parameters_json) : {}
    return { automacao, proveniencia, template, documento, valores }
  }

  roteador.get('/automations/:id/reconfigure', ({ params }) => {
    const { proveniencia, template, documento, valores } = reunir(params.id)
    if (!proveniencia) {
      return { podeReconfigurar: false, motivo: 'Esta automação não veio de um template, então não tem formulário para preencher.', parameters: [] }
    }
    if (!template) {
      return { podeReconfigurar: false, motivo: `O template "${proveniencia.template_id}" não está mais no catálogo desta instalação.`, parameters: [] }
    }
    const analise = analisarReconfiguracao({
      documento,
      template,
      valores,
      renderizar: renderizarTemplate,
      // Sem esta linha a análise não tem como saber que o template mudou, e
      // acusa a pessoa de ter editado à mão o que ela nunca tocou.
      versaoInstalada: proveniencia.template_version ?? null
    })
    const saneados = sanearValores({ template, valores }).valores
    return {
      ...analise,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
      // Cada campo já vem com o valor ATUAL, não com o padrão do template:
      // quem abre o formulário quer ver como está, não como nasceria.
      //
      // SANEADO: o valor guardado numa versão antiga pode não existir mais na
      // lista desta (o /melhorar guardava `modo: 4k`, e a versão nova separou
      // tratamento de tamanho). Mostrar o valor morto deixaria o campo vazio na
      // tela e o formulário recusaria ao salvar; o aviso já diz o que mudou.
      parameters: (template.parameters || []).map((definicao) => ({
        ...definicao,
        value: Object.hasOwn(saneados, definicao.key) ? saneados[definicao.key] : definicao.default
      }))
    }
  })

  // Aplicar passa pelo caminho NORMAL de publicação (rascunho -> publish), que
  // é onde validate.js e runtimeCapabilities.js impõem o invariante 7. Escrever
  // doc_json direto seria pular o portão e publicar o que o motor não executa.
  const reconfigurar = db.transaction((automationId, valoresNovos) => {
    const { proveniencia, template, documento, valores } = reunir(automationId)
    if (!proveniencia) throw new ErroHttp(400, 'Esta automação não veio de um template.')
    if (!template) throw new ErroHttp(400, `O template "${proveniencia.template_id}" não está mais no catálogo desta instalação.`)

    const analise = analisarReconfiguracao({
      documento,
      template,
      valores,
      renderizar: renderizarTemplate,
      versaoInstalada: proveniencia.template_version ?? null
    })
    // Recusar aqui, e não só na tela: a tela pode estar desatualizada, e
    // regerar por cima de uma edição manual a apagaria sem perguntar.
    if (!analise.podeReconfigurar) throw new ErroHttp(409, analise.motivo)

    let novo
    try {
      novo = aplicarValores({ documento, template, valores: valoresNovos, renderizar: renderizarTemplate })
    } catch (erro) {
      throw new ErroHttp(400, erro.message)
    }
    servicoAutomacoes.salvarRascunho(automationId, { document: novo })
    const publicada = servicoAutomacoes.publicar(automationId)
    gravarProvenance.run(automationId, template.templateId, template.templateVersion,
      JSON.stringify(valoresNovos), proveniencia.installed_at)
    return publicada
  })

  roteador.put('/automations/:id/reconfigure', ({ params, body }) => {
    const valores = body?.parameters
    if (!valores || typeof valores !== 'object' || Array.isArray(valores)) {
      throw new ErroHttp(400, 'Informe os valores em "parameters".')
    }
    return reconfigurar(params.id, valores)
  })

  roteador.get('/automations/:id/provenance', ({ params }) => {
    const row = obterProvenance.get(params.id)
    if (!row) return { installedFromTemplate: false }
    return {
      installedFromTemplate: true,
      templateId: row.template_id,
      templateVersion: row.template_version,
      parameters: JSON.parse(row.parameters_json),
      installedAt: row.installed_at
    }
  })
}
