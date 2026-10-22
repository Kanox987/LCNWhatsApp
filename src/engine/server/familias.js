// FAMÍLIAS DE COMANDO, E O QUE ESTÁ LIGADO EM CADA CONVERSA.
//
// O pedido, nas palavras do dono: "devem existir comandos de fig e manipulação
// de imagem, comandos de compra e venda, comandos de download e etc; o menu
// config deveria escolher quais comandos ou famílias de comandos são ativos em
// cada grupo ou de forma global pra grupos de pessoas no pv, e assim mudar o
// menu de acordo".
//
// O QUE JÁ EXISTIA, e por que não bastava:
//
//   `categoria`   — do TEMPLATE, e morria na instalação. Servia para agrupar a
//                   vitrine do catálogo e não chegava ao comando instalado.
//   `scope`       — por comando, mas só se edita reescrevendo `onde:`/`menos:`
//                   no texto, e instalar aceita um destino só.
//   `grupo_ativo` — TUDO OU NADA: diz se o bot existe naquele grupo, não o que
//                   ele faz lá. É outra pergunta, e continua sendo.
//
// DESLIGAR, E NÃO LIGAR — a escolha que define o resto deste arquivo.
//
// A marca guardada é a do que está DESLIGADO. Uma lista do que está ligado
// seria mais fácil de ler e teria um defeito grave: instalar um comando novo o
// deixaria inerte em toda conversa até alguém ir lá ligar, uma por uma. Com a
// lista do desligado, o comando novo já vale onde o escopo dele diz que vale —
// e quem desligou uma família continua com ela desligada, inclusive para os
// comandos que entrarem nela depois. É o comportamento que não exige trabalho
// de manutenção a cada instalação.
//
// As duas marcas são atributos comuns da conversa, no mesmo lugar onde
// `grupo_ativo` e `auto_download` já vivem. Nenhum mecanismo novo.

export const CHAVE_FAMILIAS_DESLIGADAS = 'familias_desligadas'
export const CHAVE_COMANDOS_DESLIGADOS = 'comandos_desligados'

// A família de um comando, ou null. Vive em `display` junto do rótulo de menu,
// porque é da mesma natureza: como o comando se apresenta e se agrupa.
export function familiaDoDocumento (documento) {
  const familia = documento?.display?.family
  return typeof familia === 'string' && familia.trim() ? familia.trim() : null
}

// Comparação de família sem pegadinha de maiúscula ou espaço: quem digita
// "Download" numa tela e "download" noutra está falando da mesma família, e
// descobrir que não estava seria uma caça ao fantasma.
const normalizar = (texto) => String(texto ?? '').trim().toLowerCase()

function listaDaConversa (db, chat, chave) {
  if (!db || !chat?.id) return []
  const kind = chat.kind === 'group' ? 'group' : 'contact'
  const linha = db.prepare(
    'SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?'
  ).get(kind, chat.id, chave)
  if (!linha) return []
  try {
    const valor = JSON.parse(linha.value_json)
    // Aceita lista ou texto separado por vírgula: a tela grava lista, e quem
    // escreveu à mão pela aba Dados provavelmente escreveu texto. Recusar o
    // texto faria a marca existir e não valer, que é o pior dos dois.
    if (Array.isArray(valor)) return valor.map(normalizar).filter(Boolean)
    if (typeof valor === 'string') return valor.split(',').map(normalizar).filter(Boolean)
    return []
  } catch {
    return []
  }
}

/**
 * Este comando está desligado NESTA conversa?
 *
 * @returns {{desligado: boolean, porFamilia: string|null}}
 */
export function desligadoNaConversa (db, chat, { automationId, documento } = {}) {
  const familia = familiaDoDocumento(documento)
  const comandos = listaDaConversa(db, chat, CHAVE_COMANDOS_DESLIGADOS)
  if (automationId && comandos.includes(normalizar(automationId))) {
    return { desligado: true, porFamilia: null }
  }
  if (familia) {
    const familias = listaDaConversa(db, chat, CHAVE_FAMILIAS_DESLIGADAS)
    if (familias.includes(normalizar(familia))) return { desligado: true, porFamilia: familia }
  }
  return { desligado: false, porFamilia: null }
}

// O QUE RESPONDER, e por que depende de onde.
//
// Em GRUPO, silêncio. Um comando desligado que responde é barulho que qualquer
// pessoa do grupo pode provocar de propósito, e serve de lista do que existe
// para quem estiver bisbilhotando.
//
// No PRIVADO, uma frase. Ali a pessoa está falando com o bot, e silêncio se lê
// como defeito: ela repete o comando, acha que não chegou, e desiste sem nunca
// saber que ele existe e está desligado.
export function avisoDeDesligado (chat, { porFamilia } = {}) {
  if (chat?.kind === 'group') return null
  return porFamilia
    ? `Os comandos de ${porFamilia} estão desligados nesta conversa.`
    : 'Este comando está desligado nesta conversa.'
}
