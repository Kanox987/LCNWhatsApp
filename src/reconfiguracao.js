// Reconfigurar um comando sem abrir arquivo nenhum.
//
// O pedido do dono: quem ESCREVE o comando declara o formulário (bloco
// `configurável` do .lcn); quem USA preenche pelo painel, e pode voltar depois
// e mudar — "sem precisar mudar nos arquivos toda vez".
//
// A infraestrutura já existia pela metade e ninguém tinha ligado as pontas:
//   - o esquema do formulário vive no template, no catálogo;
//   - os valores escolhidos na instalação ficam em automation_template_provenance.
// Faltava o caminho de volta: pegar os dois, mostrar o formulário, e regerar o
// documento com os valores novos.
//
// O PERIGO, e é o mesmo que já mordeu esta base duas vezes: regerar o documento
// a partir do template DESCARTA qualquer edição feita à mão depois da
// instalação. Por isso nada é regerado antes de conferir que o documento ainda
// é o que o template produziria — e, quando não é, a tela diz o que mudou em
// vez de apagar em silêncio.

// O que NÃO vem do template: foi escolhido na instalação ou é do sistema.
// Comparar esses campos acusaria diferença em toda automação.
const FORA_DO_TEMPLATE = ['id', 'revision', 'scope']

function semOsDeFora (documento) {
  const copia = { ...documento }
  for (const campo of FORA_DO_TEMPLATE) delete copia[campo]
  return copia
}

// Ordem de chave em objeto JSON não é informação.
function canonico (valor) {
  if (Array.isArray(valor)) return valor.map(canonico)
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, canonico(valor[k])]))
  }
  return valor
}

const iguais = (a, b) => JSON.stringify(canonico(a)) === JSON.stringify(canonico(b))

// Onde os dois documentos divergem, em nomes que fazem sentido para quem lê.
function ondeDiverge (atual, doTemplate) {
  const nomes = {
    name: 'nome', display: 'rótulo do menu', enabled: 'ligada/desligada',
    inputPolicy: 'tipos de mensagem aceitos', responder: 'pool que responde', flow: 'o que a automação faz'
  }
  const campos = new Set([...Object.keys(atual || {}), ...Object.keys(doTemplate || {})])
  const fora = []
  for (const campo of campos) {
    if (FORA_DO_TEMPLATE.includes(campo) || campo === 'schemaVersion') continue
    if (!iguais(atual?.[campo], doTemplate?.[campo])) fora.push(nomes[campo] || campo)
  }
  return fora
}

// Pode reconfigurar pelo formulário?
//
// `renderizar` é injetado para este módulo não depender do motor — e para o
// teste poder exercitar a decisão sem catálogo em disco.
export function analisarReconfiguracao ({ documento, template, valores, renderizar }) {
  if (!template) {
    return { podeReconfigurar: false, motivo: 'Esta automação não veio de um template, então não tem formulário para preencher.' }
  }
  if (!Array.isArray(template.parameters) || !template.parameters.length) {
    return { podeReconfigurar: false, motivo: 'Este template não declara nada configurável.' }
  }

  let doTemplate
  try {
    doTemplate = renderizar(template, valores || {})
  } catch (erro) {
    // Template mudou e os valores guardados já não bastam (parâmetro novo
    // obrigatório, por exemplo). Dizer isso é melhor que mostrar um formulário
    // que não vai salvar.
    return { podeReconfigurar: false, motivo: `Não consegui reconstruir a partir do template: ${erro.message}` }
  }

  const divergencias = ondeDiverge(semOsDeFora(documento), semOsDeFora(doTemplate))
  if (divergencias.length) {
    return {
      podeReconfigurar: false,
      motivo: `Esta automação foi alterada à mão depois de instalada (${divergencias.join(', ')}). Preencher o formulário desfaria essas mudanças, então ele fica fechado — edite pelo texto.`,
      divergencias
    }
  }
  return { podeReconfigurar: true, motivo: null, divergencias: [] }
}

// Gera o documento novo com os valores novos, PRESERVANDO o que não vem do
// template: o id, a revisão e o escopo escolhido na instalação. Regerar o
// escopo do template zeraria a lista de destinos — e lista vazia nunca casa
// com ninguém, então a automação viraria inerte sem ninguém entender por quê.
export function aplicarValores ({ documento, template, valores, renderizar }) {
  const novo = renderizar(template, valores || {})
  for (const campo of FORA_DO_TEMPLATE) {
    if (documento?.[campo] !== undefined) novo[campo] = documento[campo]
  }
  return novo
}
