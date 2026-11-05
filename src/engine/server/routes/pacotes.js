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
import { carregarCatalogo } from '../../templates/catalog.js'
import { carregarPacotes } from '../../templates/pacotes.js'
import { criarServicoDeProvisionamento } from '../provisionamentoService.js'
import {
  escopoDoMotor, instalacaoViva,
  estadoDosItens, planejarRemocao, marcarRemovida, itensDaInstalacao
} from '../registroDePacotes.js'

export function registrarRotasPacotes (roteador, db, {
  catalogo = carregarCatalogo(),
  pacotes = carregarPacotes()
} = {}) {
  const servico = criarServicoDeProvisionamento(db, { catalogo, pacotes })
  const { servicoAutomacoes, avaliarPacote, lerEstadoDaAutomacao, provisionar } = servico

  roteador.get('/pacotes', () => ({
    pacotes: [...pacotes.values()].map(avaliarPacote)
  }))

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

  return { avaliarPacote, instalacaoViva, itensDaInstalacao, servico }
}
