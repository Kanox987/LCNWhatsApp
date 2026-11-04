// O trabalho de publicar os membros de um provisionamento, num lugar só.
//
// POR QUE ISTO EXISTE, e não é refatoração por gosto: o §8 pede provisionamento
// por PACOTE, e `POST /templates/:id/install` provisiona por TEMPLATE (D-38).
// São duas rotas, e o miolo das duas é idêntico — ler o estado de cada membro
// pelos cinco leitores, publicar os `novo`, republicar os `despublicado`,
// gravar proveniência e declarar as variáveis.
//
// Duplicar esse miolo é exatamente a divergência de camadas que este projeto já
// pagou caro mais de uma vez (o escopo `local` em metade das camadas; `local`
// ausente de três listas). Dois laços de publicação significam que o dia em que
// um deles aprender algo — uma coluna nova, uma guarda nova — o outro continua
// sem saber, em silêncio, e a bateria fica verde porque nenhum teste afirma que
// os dois concordam.
//
// ALTERNATIVA RECUSADA: escrever a rota de pacote com o laço próprio e deixar
// `templates.js` intacto. Era mais barato AGORA — não mexe em rota que está no
// ar e testada — e mais caro depois, pela razão acima. A refatoração é guardada
// por `tests/provisionamento-idempotente.test.mjs`, que exercita a rota de
// template de ponta a ponta sobre `abrirBanco(':memory:')`.
import { ErroHttp } from './transport.js'
import { renderizarTemplate, renderizarVariaveisDeclaradas } from '../templates/render.js'
import { declararDoTemplate } from './declaredVariables.js'

// Os cinco leitores que `classificarOrdem` exige. Ficam juntos porque a
// diferença entre `lerDocumento` e `lerUltimoDocumento` é a sutileza que decide
// se um membro é `modificado` ou `despublicado`, e ela precisa ser escrita UMA
// vez.
export function leitoresDeClassificacao ({ db, servicoAutomacoes, obterProvenance }) {
  // `obterRevision` do serviço recebe (automation_id, número da revisão), não o
  // id da linha — então a revisão ATIVA é lida por id aqui mesmo, como a rota
  // de template já fazia.
  const obterRevisaoPorId = db.prepare('SELECT doc_json FROM automation_revisions WHERE id = ?')
  return {
    lerAutomacao: (id) => servicoAutomacoes.obterAutomation.get(id) || null,
    lerProveniencia: (id) => obterProvenance.get(id) || null,
    lerDocumento: (id) => {
      const automacao = servicoAutomacoes.obterAutomation.get(id)
      if (!automacao?.active_revision_id) return null
      const revisao = obterRevisaoPorId.get(automacao.active_revision_id)
      return revisao ? servicoAutomacoes.jsonOuNull(revisao.doc_json) : null
    },
    // A revisão mais recente INDEPENDENTE de status: é exatamente a que
    // `publicar` republicaria.
    lerUltimoDocumento: (id) => {
      const revisao = servicoAutomacoes.obterUltimaRevision.get(id)
      return revisao ? servicoAutomacoes.jsonOuNull(revisao.doc_json) : null
    },
    renderizar: renderizarTemplate
  }
}

// Publica o que precisa nascer e devolve ao ar o que estava despublicado.
// Pressupõe que `decidirProvisionamento` já aprovou a classificação: aqui não
// se decide nada, só se executa.
export function publicarMembros ({
  db, catalogo, servicoAutomacoes, inserirProvenance,
  classificacao, scope, deploymentMode, parametrosPorTemplate = {}
}) {
  const jaInstalados = classificacao.filter((m) => m.estado === 'instalado').map((m) => ({
    templateId: m.templateId, automationId: m.automationId
  }))

  const instaladas = []
  for (const membro of classificacao) {
    if (membro.estado !== 'novo') continue
    const template = catalogo.get(membro.templateId)
    const automationId = membro.automationId
    const parametrosFornecidos = parametrosPorTemplate[membro.templateId] || {}
    let documento
    try {
      documento = renderizarTemplate(template, parametrosFornecidos)
    } catch (erro) {
      throw new ErroHttp(400, `Falha ao montar o template "${membro.templateId}": ${erro.message}`)
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

  // Membro que estava despublicado volta ao ar republicando a revisão que já
  // existe — o documento e o histórico são preservados, nada é recriado. O
  // `deployment_mode` da automação NÃO é reescrito: ele é escolha de quem
  // administra, e restaurar não é instalar de novo.
  const restauradas = []
  for (const membro of classificacao) {
    if (membro.estado !== 'despublicado') continue
    restauradas.push(servicoAutomacoes.publicar(membro.automationId))
  }

  return { instaladas, restauradas, jaInstalados }
}
