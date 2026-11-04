// Provisionar um pacote sem duplicar nem sobrescrever o que já está no ar.
//
// O DEFEITO QUE ISTO CONSERTA, medido: instalar um template cujo id de
// automação já existe estourava `409 Automação já cadastrada: <id>.` de dentro
// de `automationsService.criar`, abortando a transação INTEIRA. Como o id
// padrão da automação É o id do template, reprovisionar um pacote em que UM
// único membro já estava instalado não instalava mais nada — e o §8 do pedido
// exige o contrário: "provisionamento idempotente", "reiniciar não pode
// instalar comandos duplicados" e "atualizar o sistema não pode sobrescrever
// alterações personalizadas sem autorização".
//
// Então antes de publicar qualquer coisa, cada membro da ordem é CLASSIFICADO:
//
//   novo           — não existe automação com esse id. É o que se instala
//   instalado      — existe, veio deste template, mesma versão, e o documento
//                    ainda é exatamente o que o template produz. É o estado
//                    desejado: pular, não reinstalar
//   desatualizado  — existe, deste template, mas a versão do catálogo é outra.
//                    Adotar a versão nova é ato de quem opera (o formulário de
//                    reconfigurar), porque regerar descarta edição manual
//   modificado     — existe, deste template, mesma versão, documento diferente:
//                    alguém editou à mão. NUNCA sobrescrever
//   despublicado   — existe, veio deste template, o conteúdo da revisão mais
//                    recente é exatamente o que o template produz, mas não há
//                    revisão ATIVA: foi removido do ar. Republicar, não criar
//   naoVerificavel — existe e veio deste template, mas a origem não se prova:
//                    não tem revisão nenhuma, ou os valores guardados já não
//                    reconstroem o documento
//   conflito       — existe SEM proveniência, ou com proveniência de OUTRO
//                    template. Adotar automaticamente seria o pacote tomar
//                    posse de uma automação que a pessoa fez
//
// E a decisão é tudo-ou-nada: se QUALQUER membro está bloqueado, nada é
// publicado e a resposta diz, membro por membro, o que impede. Instalar só os
// que dão deixaria o pacote pela metade sem ninguém saber quais metades.
import { compararComTemplate } from '../../reconfiguracao.js'

// Os três que impedem o provisionamento de seguir.
const BLOQUEIAM = ['modificado', 'naoVerificavel', 'conflito']

export function classificarOrdem ({
  ordem, catalogo, automationIds = {}, parametrosPorTemplate = {},
  lerAutomacao, lerProveniencia, lerDocumento, lerUltimoDocumento, renderizar
}) {
  return ordem.map((templateId) => {
    const template = catalogo.get(templateId)
    const automationId = automationIds[templateId] || templateId
    const base = { templateId, automationId, nome: template?.name || templateId }

    if (!lerAutomacao(automationId)) return { ...base, estado: 'novo', motivo: null }

    const proveniencia = lerProveniencia(automationId)
    if (!proveniencia) {
      return {
        ...base,
        estado: 'conflito',
        motivo: `Já existe uma automação chamada "${automationId}" que não veio de template nenhum. O pacote não assume o lugar dela; escolha outro id ou remova a automação antes.`
      }
    }
    if (proveniencia.template_id !== templateId) {
      return {
        ...base,
        estado: 'conflito',
        motivo: `A automação "${automationId}" foi instalada pelo template "${proveniencia.template_id}", não por "${templateId}".`
      }
    }

    const guardados = jsonOuVazio(proveniencia.parameters_json)
    const versaoInstalada = proveniencia.template_version ?? null
    const comparar = (doc) => compararComTemplate({ documento: doc, template, valores: guardados, renderizar, versaoInstalada })

    // Despublicar — que é como o painel REMOVE hoje — zera
    // `active_revision_id`, e só por isso o documento ATIVO deixa de existir:
    // as revisões continuam no banco e a proveniência também. Sem olhar para
    // elas, remover um pacote e querer instalá-lo de novo batia em
    // `naoVerificavel` para sempre — beco sem saída, medido por sonda antes de
    // este caso existir. O que se compara é a revisão que `publicar` de fato
    // republicaria (a de número mais alto, de qualquer status), nunca uma
    // qualquer: senão um rascunho escrito à mão depois da remoção voltaria ao
    // ar como se fosse do template.
    const documento = lerDocumento(automationId)
    const maisRecente = documento || (lerUltimoDocumento ? lerUltimoDocumento(automationId) : null)
    if (!maisRecente) {
      return {
        ...base,
        estado: 'naoVerificavel',
        motivo: `A automação "${automationId}" existe mas não tem revisão nenhuma, então não dá para conferir se é o que este template produz.`
      }
    }

    const comparacao = comparar(maisRecente)

    if (comparacao.estado === 'naoReconstroi') {
      return {
        ...base,
        estado: 'naoVerificavel',
        motivo: `Não consegui reconstruir "${automationId}" a partir do template para comparar: ${comparacao.erro}`
      }
    }
    if (comparacao.estado === 'divergente') {
      return {
        ...base,
        estado: 'modificado',
        divergencias: comparacao.divergencias,
        motivo: `"${automationId}" foi alterada à mão depois de instalada (${comparacao.divergencias.join(', ')}). Reinstalar apagaria essas mudanças, então o provisionamento para aqui.`
      }
    }
    if (comparacao.estado === 'outraVersao') {
      return {
        ...base,
        estado: 'desatualizado',
        de: comparacao.versaoInstalada,
        para: comparacao.versaoDoCatalogo,
        motivo: `"${automationId}" foi instalada na versão ${comparacao.versaoInstalada} do template e o catálogo está na ${comparacao.versaoDoCatalogo}. Adotar a versão nova é feito pelo formulário de reconfigurar, que mostra o que muda antes de salvar.`
      }
    }

    // Íntegro. Se é o documento ATIVO que não existe, o membro está apenas
    // DESPUBLICADO: o conteúdo é o do template, falta voltar ao ar. Isso tem
    // estado próprio porque republicar não é instalar — instalar, restaurar e
    // atualizar não podem ficar disfarçados como a mesma operação.
    if (!documento) return { ...base, estado: 'despublicado', motivo: null }

    // Está instalado e íntegro. Falta uma pergunta: o pedido traz valores
    // DIFERENTES dos guardados? Reinstalar por cima é o caminho errado para
    // isso — quem muda valor de uma automação instalada é o formulário de
    // reconfigurar, que avisa o que vai mudar. Compara-se pelo documento
    // produzido, não pelos valores crus, porque dois valores escritos
    // diferentes podem produzir o mesmo comando.
    const pedidos = parametrosPorTemplate[templateId] || {}
    const comOsPedidos = compararComTemplate({
      documento, template, valores: pedidos, renderizar, versaoInstalada
    })
    const valoresDiferem = comOsPedidos.estado !== 'igual'
    return {
      ...base,
      estado: 'instalado',
      valoresDiferem,
      motivo: valoresDiferem
        ? `"${automationId}" já está instalada, e os valores do pedido são outros. Mudar valor de automação instalada é pelo formulário de reconfigurar; o provisionamento não reescreve por cima.`
        : null
    }
  })
}

// Dá para provisionar? Só quando todo membro é novo ou já está no estado
// desejado. `desatualizado` e `instalado com outros valores` também param: os
// dois têm caminho próprio (reconfigurar), e seguir sem eles entregaria um
// pacote diferente do que a pessoa pediu sem dizer.
export function decidirProvisionamento (classificacao) {
  const impedem = classificacao.filter((m) =>
    BLOQUEIAM.includes(m.estado) || m.estado === 'desatualizado' ||
    (m.estado === 'instalado' && m.valoresDiferem))
  return {
    podeInstalar: impedem.length === 0,
    aInstalar: classificacao.filter((m) => m.estado === 'novo').map((m) => m.templateId),
    jaInstalados: classificacao.filter((m) => m.estado === 'instalado').map((m) => m.templateId),
    aRestaurar: classificacao.filter((m) => m.estado === 'despublicado').map((m) => m.templateId),
    impedem
  }
}

function jsonOuVazio (texto) {
  try {
    const valor = JSON.parse(texto)
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {}
  } catch {
    return {}
  }
}
