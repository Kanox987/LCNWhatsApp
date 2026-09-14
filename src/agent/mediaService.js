// Fachada do acervo para o painel. Fica no agente (não no motor) porque quem
// tem os arquivos em disco é este lado — o motor só conhece ids.
//
// Recebe o conteúdo como base64 porque o transporte do painel é JSON. É
// deliberado: evitar multipart aqui mantém o servidor local com um formato só
// e sem parser de upload, que é código onde bug vira leitura de arquivo
// arbitrário. O custo é ~33% a mais no corpo da requisição, aceitável para um
// painel que roda em 127.0.0.1.
import * as acervo from '../mediaLibrary.js'

// Teto do corpo decodificado, conferido ANTES de alocar o buffer inteiro: sem
// isto, um base64 gigante viraria memória antes de qualquer validação.
const LIMITE_BASE64 = Math.ceil((acervo.LIMITE_POR_ARQUIVO_BYTES * 4) / 3) + 1024

// Buffer.from(x, 'base64') NÃO falha com entrada inválida: ele simplesmente
// ignora os caracteres que não reconhece e devolve o que sobrou. "!!!isto
// não é base64!!!" vira 9 bytes de lixo em vez de erro. Por isso o formato é
// conferido antes — senão lixo entraria no acervo como se fosse arquivo.
const BASE64_VALIDO = /^[A-Za-z0-9+/]+={0,2}$/

function decodificarBase64 (bruto) {
  const limpo = String(bruto).replace(/\s+/g, '')
  if (!limpo || limpo.length % 4 !== 0 || !BASE64_VALIDO.test(limpo)) return null
  const buffer = Buffer.from(limpo, 'base64')
  return buffer.length ? buffer : null
}

export function criarServicoAcervo ({ biblioteca = acervo } = {}) {
  function listar () {
    return { files: biblioteca.listar(), usage: biblioteca.uso() }
  }

  function enviar (body) {
    const base64 = body?.contentBase64
    if (typeof base64 !== 'string' || !base64) {
      throw new biblioteca.ErroDeAcervo('Envie o conteúdo do arquivo em contentBase64.')
    }
    if (base64.length > LIMITE_BASE64) {
      throw new biblioteca.ErroDeAcervo(
        `Arquivo grande demais: o limite por arquivo é ${Math.round(acervo.LIMITE_POR_ARQUIVO_BYTES / 1024 / 1024)} MB.`
      )
    }

    const buffer = decodificarBase64(base64)
    if (!buffer) throw new biblioteca.ErroDeAcervo('Conteúdo do arquivo inválido ou vazio.')

    return biblioteca.guardar(buffer, {
      mimetype: body?.mimetype,
      name: body?.name,
      description: body?.description
    })
  }

  function remover (id) {
    if (!biblioteca.remover(id)) throw new biblioteca.ErroDeAcervo('Arquivo não encontrado no acervo.', 404)
    return { removed: true, id }
  }

  function descrever (id, description) {
    const atualizado = biblioteca.atualizarDescricao(id, description)
    if (!atualizado) throw new biblioteca.ErroDeAcervo('Arquivo não encontrado no acervo.', 404)
    return atualizado
  }

  function definirCota (bytes) {
    return { quotaBytes: biblioteca.definirCota(bytes) }
  }

  return { listar, enviar, remover, descrever, definirCota }
}
