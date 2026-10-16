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

// O VALOR GUARDADO QUE A VERSÃO NOVA NÃO CONHECE MAIS.
//
// Uma escolha pode sair da lista quando o template muda: o /melhorar guardava
// `modo: "4k"`, e a versão nova separou o tratamento (auto, classico, ia,
// ambos) de até onde a foto cresce (4k, original, 2x, 4x). Com o valor velho,
// reconstruir a partir do template LANÇA — e o formulário fechava dizendo
// "não consegui reconstruir", que é um beco sem saída: o comando fica preso na
// versão antiga, e quem aluga o sistema não tem terminal para sair dele.
//
// Então o valor que não existe mais vira o PADRÃO da versão nova, e isso é
// DITO. Trocar calado seria pior que o beco.
export function sanearValores ({ template, valores }) {
  const definicoes = Array.isArray(template?.parameters) ? template.parameters : []
  const porChave = new Map(definicoes.map((d) => [d.key, d]))
  const limpos = {}
  const ajustes = []

  for (const [chave, valor] of Object.entries(valores || {})) {
    const definicao = porChave.get(chave)
    // Parâmetro que a versão nova não tem mais: some, e quem lê fica sabendo.
    if (!definicao) {
      ajustes.push({ chave, de: valor, para: null, motivo: 'não existe mais nesta versão' })
      continue
    }
    if (definicao.type === 'enum') {
      const opcoes = Array.isArray(definicao.options) ? definicao.options : []
      if (!opcoes.includes(String(valor))) {
        ajustes.push({ chave, de: valor, para: definicao.default ?? null, motivo: `não está mais entre as escolhas (${opcoes.join(', ')})` })
        if (definicao.default !== undefined) limpos[chave] = definicao.default
        continue
      }
    }
    limpos[chave] = valor
  }
  return { valores: limpos, ajustes }
}

function frasesDeAjuste (ajustes) {
  return ajustes.map((a) => a.para === null
    ? `"${a.chave}" (${a.motivo})`
    : `"${a.chave}": ${a.de} vira ${a.para} (${a.motivo})`)
}

// Pode reconfigurar pelo formulário?
//
// `renderizar` é injetado para este módulo não depender do motor — e para o
// teste poder exercitar a decisão sem catálogo em disco.
export function analisarReconfiguracao ({ documento, template, valores, renderizar, versaoInstalada = null }) {
  if (!template) {
    return { podeReconfigurar: false, motivo: 'Esta automação não veio de um template, então não tem formulário para preencher.' }
  }
  if (!Array.isArray(template.parameters) || !template.parameters.length) {
    return { podeReconfigurar: false, motivo: 'Este template não declara nada configurável.' }
  }

  const saneado = sanearValores({ template, valores })
  let doTemplate
  try {
    doTemplate = renderizar(template, saneado.valores)
  } catch (erro) {
    // Template mudou e os valores guardados já não bastam (parâmetro novo
    // obrigatório, por exemplo). Dizer isso é melhor que mostrar um formulário
    // que não vai salvar.
    return { podeReconfigurar: false, motivo: `Não consegui reconstruir a partir do template: ${erro.message}` }
  }

  const divergencias = ondeDiverge(semOsDeFora(documento), semOsDeFora(doTemplate))
  // O TEMPLATE MUDOU, e isso não é culpa de quem instalou.
  //
  // A comparação sozinha não distingue "foi editado à mão" de "o template é
  // outro agora" — e por isso a tela acusava sempre a pessoa. Medido: o
  // `figurinha` passou de v1 para v2 quando ganhou tamanho, segundos,
  // qualidade e peso, e o formulário fechou dizendo "você alterou à mão". O
  // efeito foi pior que o texto: os campos NOVOS ficaram inalcançáveis
  // justamente para quem já tinha o comando instalado.
  //
  // A versão da instalação está guardada (automation_template_provenance), e
  // compará-la responde o que a diferença de documento não responde. O que NÃO
  // dá para saber é se, além da versão nova, também houve edição à mão: o
  // template antigo não existe mais no catálogo para comparar. Então aqui não
  // se adivinha — abre o formulário e diz exatamente o que salvar vai fazer.
  const versaoDoCatalogo = template.templateVersion ?? null
  const trocouDeVersao = versaoInstalada !== null && versaoDoCatalogo !== null &&
    versaoInstalada !== versaoDoCatalogo
  if (trocouDeVersao) {
    return {
      podeReconfigurar: true,
      motivo: null,
      divergencias,
      versaoInstalada,
      versaoDoCatalogo,
      ajustes: saneado.ajustes,
      aviso: `Este comando foi instalado na versão ${versaoInstalada} do template e o catálogo já está na ${versaoDoCatalogo}. ` +
        (divergencias.length
          ? `Salvar aqui adota a versão nova, e com ela o que mudou: ${divergencias.join(', ')}. Se você também editou algo à mão depois de instalar, essa edição se perde — confira pelo texto antes de salvar.`
          : 'Salvar aqui adota a versão nova. O que a automação faz hoje continua igual ao template, então nada seu se perde.') +
        (saneado.ajustes.length
          ? ` Uma coisa muda sozinha, porque a versão nova não conhece mais o valor guardado: ${frasesDeAjuste(saneado.ajustes).join('; ')}.`
          : '')
    }
  }
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
  // Aqui NÃO se saneia. O que chega é o que a pessoa acabou de escolher no
  // formulário, e um valor fora da lista precisa ser recusado — é a diferença
  // entre resgatar o que ficou guardado numa versão antiga (o saneamento, na
  // análise) e aceitar calado uma escolha errada de agora.
  const novo = renderizar(template, valores || {})
  for (const campo of FORA_DO_TEMPLATE) {
    if (documento?.[campo] !== undefined) novo[campo] = documento[campo]
  }
  return novo
}
