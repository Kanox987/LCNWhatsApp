// Como esta conexão se apresenta em "Aparelhos conectados" no celular.
//
// É escolha de quem conecta, não decisão do código: uns querem ver "Chrome no
// Ubuntu", outros preferem o ícone de tablet. Nenhuma das opções é melhor
// tecnicamente — muda o rótulo e o ícone, não o que a conexão é.
//
// O QUE ISTO **NÃO** FAZ: não transforma a sessão num cliente Android. A
// conexão continua sendo de aparelho vinculado (companheiro por web), e o
// payload anuncia plataforma WEB de qualquer jeito. Prometer o contrário seria
// mentira útil para ninguém.
//
// O rótulo é gravado NO PAREAMENTO. Trocar depois não renomeia uma sessão que
// já existe — só vale para a próxima conexão nova.

// Lista fechada porque a biblioteca traduz o que não conhece para UNKNOWN, em
// silêncio: um erro de digitação viraria um aparelho sem nome no celular, sem
// nada avisando. Aqui um valor inválido é recusado com a lista junto.
export const APARELHOS = Object.freeze([
  { id: 'chrome', rotulo: 'Chrome', sistemaPadrao: 'Ubuntu' },
  { id: 'firefox', rotulo: 'Firefox', sistemaPadrao: 'Ubuntu' },
  { id: 'safari', rotulo: 'Safari', sistemaPadrao: 'macOS' },
  { id: 'edge', rotulo: 'Edge', sistemaPadrao: 'Windows' },
  { id: 'opera', rotulo: 'Opera', sistemaPadrao: 'Ubuntu' },
  { id: 'ie', rotulo: 'Internet Explorer', sistemaPadrao: 'Windows' },
  { id: 'desktop', rotulo: 'Aplicativo de computador', sistemaPadrao: 'Ubuntu' },
  { id: 'ipad', rotulo: 'iPad', sistemaPadrao: 'iPadOS' },
  { id: 'android tablet', rotulo: 'Tablet Android', sistemaPadrao: 'Android' }
])

export const APARELHO_PADRAO = 'chrome'

export function ehAparelhoValido (id) {
  return APARELHOS.some((a) => a.id === normalizar(id))
}

function normalizar (id) {
  return String(id ?? '').trim().toLowerCase()
}

export function acharAparelho (id) {
  return APARELHOS.find((a) => a.id === normalizar(id)) || null
}

// Resolve o que vai para a biblioteca. `sistema` em branco usa o padrão do
// aparelho escolhido — mas um sistema explícito, mesmo esquisito, é respeitado:
// quem digitou tinha um motivo.
export function resolverAparelho ({ navegador, sistema } = {}) {
  const escolhido = acharAparelho(navegador)
  if (navegador && !escolhido) {
    throw new Error(
      `Aparelho desconhecido: "${navegador}". Use um destes: ${APARELHOS.map((a) => a.id).join(', ')}.`
    )
  }
  const alvo = escolhido || acharAparelho(APARELHO_PADRAO)
  const sistemaLimpo = String(sistema ?? '').trim()
  return {
    deviceBrowser: alvo.id,
    deviceOsDisplayName: sistemaLimpo || alvo.sistemaPadrao,
    rotulo: `${alvo.rotulo} (${sistemaLimpo || alvo.sistemaPadrao})`
  }
}
