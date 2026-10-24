// LÓGICA DE TELA DE AUTOMAÇÕES: APAGAR, TIRAR DO AR E HISTÓRICO DE REVISÕES.
//
// Extraída para cá porque o navegador precisa dela e Node puro precisa testá-la
// sem simular DOM. Toda regra de apresentação que decide se o botão é seguro,
// o que perguntar na confirmação e como interpretar o 409 do motor mora aqui.

/**
 * Monta o texto de confirmação exibido antes de apagar uma automação.
 *
 * Apagar é irreversível: apaga documento, rascunhos e avaliações que não casaram.
 * A pergunta precisa nomear o comando (nome e identificador) e, quando o total de
 * execuções for conhecido, dizê-lo com todas as letras.
 *
 * @param {object} params
 * @param {string} params.nome Nome humano do comando.
 * @param {string} params.id Identificador da automação.
 * @param {number|string|null} [params.totalExecucoes] Total de execuções ou null se desconhecido.
 * @returns {string} Mensagem para o pedido de confirmação.
 */
export function mensagemConfirmacaoApagar ({ nome, id, totalExecucoes = null } = {}) {
  const rotulo = nome && nome !== id ? `"${nome}" (${id})` : `"${id || 'sem-id'}"`
  let detalheExec = ''
  if (totalExecucoes !== null && totalExecucoes !== undefined) {
    if (typeof totalExecucoes === 'number') {
      if (totalExecucoes === 0) {
        detalheExec = '\n\nNenhuma execução registrada.'
      } else if (totalExecucoes === 1) {
        detalheExec = '\n\nEsta automação possui 1 execução registrada.'
      } else {
        detalheExec = `\n\nEsta automação possui ${totalExecucoes} execuções registradas.`
      }
    } else {
      detalheExec = `\n\nEsta automação possui ${totalExecucoes} execuções registradas.`
    }
  }

  return `Apagar a automação ${rotulo}?\n\n` +
    'Esta ação é permanente e irreversível. O cadastro e os rascunhos serão excluídos.' +
    detalheExec
}

/**
 * Analisa a resposta de erro ao tentar apagar uma automação.
 *
 * Quando o motor recusa com 409, ele não quebrou: ele está protegendo o
 * histórico de auditoria (`automation_runs` que fizeram algo no WhatsApp).
 * A tela não pode tratar isso como um "erro inesperado", e sim mostrar o que o
 * motor explicou e oferecer "Tirar do ar" no lugar.
 *
 * @param {object} erro Erro retornado pela API.
 * @returns {{ bloqueadoPorHistorico: boolean, podeTirarDoAr: boolean, mensagem: string }}
 */
export function analisarErroApagar (erro) {
  const status = Number(erro?.status)
  const mensagem = erro?.message || 'Falha ao apagar automação.'
  const bloqueadoPorHistorico = status === 409 || /histórico dessas execuções depende dela/i.test(mensagem)

  return {
    bloqueadoPorHistorico,
    podeTirarDoAr: bloqueadoPorHistorico,
    mensagem
  }
}

/**
 * Determina o rótulo e tom do selo de uma revisão no histórico.
 *
 * Uma revisão pode ser a ativa agora, um rascunho mais recente ou uma versão
 * inativa anterior. A tela deixa isso visível de relance para quem olha.
 *
 * @param {object} rev Linha da revisão.
 * @param {number|null} [activeRevisionId] ID da revisão ativa na automação.
 * @returns {{ ehAtiva: boolean, rotulo: string, tom: string }}
 */
export function statusRevisao (rev, activeRevisionId = null) {
  const ehAtiva = Boolean(
    (activeRevisionId !== null && rev?.id === activeRevisionId) ||
    rev?.status === 'active'
  )

  if (ehAtiva) {
    return { ehAtiva: true, rotulo: 'Ativa agora', tom: 'success' }
  }
  if (rev?.status === 'draft') {
    return { ehAtiva: false, rotulo: 'Rascunho', tom: 'info' }
  }
  return { ehAtiva: false, rotulo: 'Inativa', tom: 'neutral' }
}

/**
 * Extrai o texto legível de uma revisão.
 *
 * Prioriza o texto descompilado na linguagem do projeto (.lcn). Se o documento
 * não puder ser descompilado (ex: formato legado ou nó não mapeado), devolve o
 * JSON formatado para leitura sem quebrar a tela.
 *
 * @param {object} dados Dados da revisão devolvidos pela API.
 * @returns {string} Texto para exibição somente leitura.
 */
export function textoDaRevisao (dados) {
  if (typeof dados?.texto === 'string' && dados.texto.trim()) {
    return dados.texto
  }
  if (dados?.document && typeof dados.document === 'object') {
    return JSON.stringify(dados.document, null, 2)
  }
  return 'Sem documento registrado nesta revisão.'
}
