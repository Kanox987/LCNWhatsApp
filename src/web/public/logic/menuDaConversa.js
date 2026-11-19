// O MENU NUMA CONVERSA, EM LINHAS QUE UMA PESSOA LÊ.
//
// A aba Menu saiu do painel; mudar o menu é pelo comando `configura menu`.
// O que sobrou no painel é ver o que vale numa conversa (sem mandar /menu
// nela, o que num grupo publicaria o menu para todo mundo) e apagar a
// configuração própria dela. Esta parte não toca o DOM, para dar teste.

const ROTULOS = [
  ['format', 'Formato'],
  ['header', 'Cabeçalho'],
  ['footer', 'Rodapé'],
  ['emptyText', 'Texto quando não há comando'],
  ['buttonTitle', 'Título do botão'],
  ['numbered', 'Numeração'],
  ['families', 'Famílias']
]

function valorLegivel (campo, valor) {
  if (campo === 'format') return valor === 'interactive' ? 'com botões' : 'texto'
  if (campo === 'numbered') return valor ? 'sim' : 'não'
  if (campo === 'families') {
    if (valor === '*') return 'todas'
    if (Array.isArray(valor)) return valor.length ? valor.join(', ') : 'nenhuma'
    return 'todas'
  }
  if (valor === '') return '(em branco)'
  return String(valor)
}

/**
 * O nível "todos os grupos" ou "todo o privado" de uma conversa: o alvo que a
 * rota de apagar entende e o nome que a tela mostra.
 */
export function nivelDoTipo (chatKind) {
  return chatKind === 'group'
    ? { kind: 'group_default', nome: 'Padrão de todos os grupos', curto: 'todos os grupos' }
    : { kind: 'direct_default', nome: 'Padrão de todo o privado', curto: 'todo o privado' }
}

/**
 * De onde veio um campo do menu como ele sai, na mesma ordem da cascata do
 * motor (`resolverConfigDeMenu`): conversa > padrão do tipo > documento do
 * menu > padrão do sistema. Campo a campo, porque a cascata é campo a campo.
 */
export function origemDoCampo (campo, { propria, padraoDoTipo, doDocumento, chatKind } = {}) {
  if (propria && Object.hasOwn(propria, campo)) return 'desta conversa'
  if (padraoDoTipo && Object.hasOwn(padraoDoTipo, campo)) return `de ${nivelDoTipo(chatKind).curto}`
  if (doDocumento && Object.hasOwn(doDocumento, campo)) return 'do comando de menu'
  return 'padrão do sistema'
}

/**
 * Uma linha por campo presente na configuração, na ordem em que o menu sai.
 * Campo ausente não aparece: na configuração própria, ausente quer dizer
 * "herda". Com `fontes`, cada linha diz também de onde o valor veio.
 */
export function linhasDoMenu (config, fontes = null) {
  const linhas = []
  for (const [campo, rotulo] of ROTULOS) {
    if (!config || !Object.hasOwn(config, campo)) continue
    const linha = { campo, rotulo, valor: valorLegivel(campo, config[campo]) }
    if (fontes) linha.origem = origemDoCampo(campo, fontes)
    linhas.push(linha)
  }
  return linhas
}

/** O texto da linha de famílias quando ninguém configurou: mostra todas. */
export function semFamiliasConfiguradas (config) {
  return !config || !Object.hasOwn(config, 'families')
}

/**
 * Número ou id digitado → conversa da aba Dados. Mesmas regras do comando
 * `configura menu` com "outra conversa" (`alvoDaConversa` no motor): id com
 * @g.us é grupo; @s.whatsapp.net ou @lid é contato; só dígitos (8 ou mais,
 * com +, espaço, parênteses, ponto ou hífen) viram contato. O resto, null.
 */
export function conversaPeloId (texto) {
  const bruto = String(texto ?? '').trim()
  if (!bruto) return null
  if (/^[^\s@]+@g\.us$/i.test(bruto)) return { kind: 'group', id: bruto }
  if (/^[^\s@]+@(s\.whatsapp\.net|lid)$/i.test(bruto)) return { kind: 'contact', id: bruto }
  if (/^\+?[\d\s().-]+$/.test(bruto)) {
    const digitos = bruto.replace(/\D/g, '')
    if (digitos.length >= 8) return { kind: 'contact', id: `${digitos}@s.whatsapp.net` }
  }
  return null
}
