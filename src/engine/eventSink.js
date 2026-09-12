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
