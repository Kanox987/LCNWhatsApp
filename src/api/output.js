// Ponto de extensão da API de saída de mídia. DESLIGADO por padrão.
//
// O evento interno por captura de visualização única (`emitirCaptura`) saiu
// junto com a recuperação: não tinha quem emitisse. Sobra o ponto de partida
// pra plugar no futuro um servidor HTTP/webhook. Não abre porta nem envia nada
// enquanto config.outputApi.enabled for false. Ver docs/API.md.

// Inicializa a saída conforme o config. Enquanto desligado, é no-op.
export function iniciarSaida (cfg) {
  if (!cfg?.outputApi?.enabled) return null
  // STUB: quando o usuário quiser expor, implementar aqui um servidor HTTP nativo
  // (127.0.0.1:porta) com token e/ou um webhook. Ver docs/API.md.
  console.warn('outputApi.enabled=true, mas o servidor de saída ainda é um stub. Ver docs/API.md.')
  return null
}
