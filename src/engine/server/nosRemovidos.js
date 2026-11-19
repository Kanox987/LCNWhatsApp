// NÓS QUE O MOTOR JÁ EXECUTOU E DEIXOU DE EXECUTAR.
//
// Tirar um tipo de nó do schema e do avaliador não tira ele do banco: a
// automação instalada antes continua lá, com a revisão ativa apontando para
// um nó que ninguém mais sabe rodar. Sem esta lista, cada caminho que esbarra
// nela devolvia uma mensagem diferente e crua (erro do Ajv no publish, "Nó …
// não é executável" no avaliador, nada no botão de ligar).
//
// Aqui fica o motivo legível, uma vez só. A migração que desliga essas
// automações (018 para o recover) cuida do estado; isto cuida do que a pessoa
// lê e de não deixar ligar de novo.
//
// Arquivo próprio, e não em runtimeCapabilities.js, porque aquela lista diz o
// que o motor EXECUTA; esta diz o que ele executava e não executa mais.

const MOTIVO_RECOVER = 'A recuperação de visualização única foi retirada: o WhatsApp mudou o tratamento desses arquivos.'

export const NOS_REMOVIDOS = Object.freeze({
  'action.whatsapp.recover': MOTIVO_RECOVER
})

// MODELOS DO CATÁLOGO QUE SAÍRAM JUNTO COM O RECURSO.
//
// O nó não basta: o config-auto-recover (/autorecover) e o config-recover
// (/configrecover) não têm o `action.whatsapp.recover`, só gravam uma
// variável e respondem. Ligados, seguiriam prometendo uma recuperação que não
// existe mais. A proveniência (`automation_template_provenance`) diz de qual
// modelo a automação veio; a 018 usa a mesma lista.
export const MODELOS_REMOVIDOS = Object.freeze({
  x9: MOTIVO_RECOVER,
  'auto-recover': MOTIVO_RECOVER,
  'config-auto-recover': MOTIVO_RECOVER,
  'recuperar-visu-unica': MOTIVO_RECOVER,
  'config-recover': MOTIVO_RECOVER
})

const TIPOS = Object.keys(NOS_REMOVIDOS)

function montarMensagem (motivo) {
  return `${motivo} Esta automação foi desligada e não pode ser ligada de novo. ` +
    'Use "Tirar do ar" para retirá-la sem perder o histórico.'
}

function montarBloqueio (tipo) {
  const motivo = NOS_REMOVIDOS[tipo]
  return {
    tipo,
    motivo,
    mensagem: montarMensagem(motivo)
  }
}

// `{ tipo: null, modelo, motivo, mensagem }` quando a automação veio de um
// modelo retirado, ou null. `tipo` nulo porque não há nó a apontar.
export function bloqueioDoModelo (templateId) {
  if (typeof templateId !== 'string' || !Object.hasOwn(MODELOS_REMOVIDOS, templateId)) return null
  const motivo = MODELOS_REMOVIDOS[templateId]
  return { tipo: null, modelo: templateId, motivo, mensagem: montarMensagem(motivo) }
}

// `{ tipo, motivo, mensagem }` do primeiro nó removido do documento, ou null.
export function bloqueioDoDocumento (documento) {
  const nos = documento?.flow?.nodes
  if (!Array.isArray(nos)) return null
  for (const no of nos) {
    const tipo = no?.type
    if (typeof tipo === 'string' && Object.hasOwn(NOS_REMOVIDOS, tipo)) return montarBloqueio(tipo)
  }
  return null
}

// O mesmo, a partir do `doc_json` gravado. A listagem chama isto para cada
// automação, então quem nem cita um tipo removido sai antes do parse.
export function bloqueioDoTexto (docJson) {
  if (typeof docJson !== 'string') return null
  if (!TIPOS.some((tipo) => docJson.includes(`"${tipo}"`))) return null
  try {
    return bloqueioDoDocumento(JSON.parse(docJson))
  } catch {
    return null
  }
}
