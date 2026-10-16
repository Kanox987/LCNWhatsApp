// Etapa 1 é estritamente aditiva e observável só via log — não existe motor
// de verdade rodando ainda (isso é Etapa 2+), então este "sink" só serve
// pra visibilidade durante o desenvolvimento/teste manual: confirmar que o
// evento canônico está saindo certo, sem afetar em nada o pipeline real
// (aoReceber() continua sendo o único consumidor de verdade).
function truncar (valor, max = 600) {
  const texto = JSON.stringify(valor)
  return texto.length > max ? `${texto.slice(0, max)}…` : texto
}

export function emitirEventoDebug (evento, cfg, log = console.log) {
  const ativo = cfg?.hardware?.debug === true || cfg?.engine?.emitDebugEvents === true
  if (!ativo) return
  log('[engine] evento canônico:', truncar(evento))
}

// O QUE VEIO, QUANDO NÃO SE SABE O QUE É.
//
// `unknown` é o tipo que o motor descarta antes de avaliar qualquer coisa — e
// é onde cai tudo o que o sistema ainda não aprendeu a ler. Enquanto ele não
// dissesse QUE FORMA tinha a mensagem, "o botão não faz nada" não tinha como
// ser investigado: o log mostrava `kind: unknown` e mais nada.
//
// Só os NOMES dos campos saem daqui, nunca o conteúdo: o que vem numa mensagem
// é conversa de alguém.
export function emitirDesconhecidoDebug (mensagemBruta, cfg, log = console.log) {
  const ativo = cfg?.hardware?.debug === true || cfg?.engine?.emitDebugEvents === true
  if (!ativo) return
  const bruta = mensagemBruta?.message || mensagemBruta
  const nomes = (objeto, nivel = 0) => {
    if (!objeto || typeof objeto !== 'object' || nivel > 2) return []
    return Object.keys(objeto).flatMap((chave) => [
      chave,
      ...nomes(objeto[chave], nivel + 1).map((dentro) => `${chave}.${dentro}`)
    ])
  }
  log(`[engine] mensagem desconhecida, campos: ${nomes(bruta).slice(0, 40).join(', ') || '(vazia)'}`)
}
