// Catálogo de comandos + instalação (Parte C, Módulo 4 do plano). Cada
// template materializa em UMA OU MAIS automações reais, passando pelo
// MESMO caminho de criar+publicar que uma automação feita à mão no wizard
// usa (automationsService.js) — nunca um atalho que pule validação.
import { ErroHttp, resposta } from '../transport.js'
import { criarServicoAutomacoes } from '../automationsService.js'
import { carregarCatalogo, resolverOrdemInstalacao } from '../../templates/catalog.js'
import { renderizarTemplate, renderizarVariaveisDeclaradas } from '../../templates/render.js'
import { declararDoTemplate } from '../declaredVariables.js'

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
      inserirProvenance.run(automationId, template.templateId, template.templateVersion, JSON.stringify(parametrosFornecidos), new Date().toISOString())
      // As variáveis que o comando usa passam a existir no catálogo agora, e
      // não só quando alguma delas receber valor pela primeira vez.
      declararDoTemplate(db, renderizarVariaveisDeclaradas(template, parametrosFornecidos), {
        sourceTemplate: template.templateId,
        sourceAutomation: automationId
      })
      instaladas.push(automacao)
    }
    return { installed: instaladas }
  })

  roteador.get('/templates', () => [...catalogo.values()].map(exporTemplateResumo))
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
