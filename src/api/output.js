// Ponto de extensão da API de saída de mídia. DESLIGADO por padrão.
//
// Hoje só emite um evento interno por captura, pra facilitar plugar no futuro um
// servidor HTTP/webhook que leve as mídias pra fora (ex: um site). Não abre porta
// nem envia nada enquanto config.outputApi.enabled for false. Ver docs/API.md.
import { EventEmitter } from 'events'

export const barramento = new EventEmitter()

// Chamado pela captura a cada mídia salva.
export function emitirCaptura (evento) {
  // evento: { id, tipo, numero, nome, caption, arquivo, timestamp, transcricao }
  barramento.emit('captura', evento)
}

// Inicializa a saída conforme o config. Enquanto desligado, é no-op.
export function iniciarSaida (cfg) {
  if (!cfg?.outputApi?.enabled) return null
  // STUB: quando o usuário quiser expor, implementar aqui um servidor HTTP nativo
  // (127.0.0.1:porta) com token, servindo o índice de archive.js e os arquivos de
  // midia/, e/ou um webhook que faça POST de cada `captura`. Ver docs/API.md.
  console.warn('outputApi.enabled=true, mas o servidor de saída ainda é um stub. Ver docs/API.md.')
  return null
}
