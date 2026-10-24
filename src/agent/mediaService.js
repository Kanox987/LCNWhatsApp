// Fachada do acervo para o painel. Fica no agente (não no motor) porque quem
// tem os arquivos em disco é este lado — o motor só conhece ids.
//
// Recebe o conteúdo como base64 porque o transporte do painel é JSON. É
// deliberado: evitar multipart aqui mantém o servidor local com um formato só
// e sem parser de upload, que é código onde bug vira leitura de arquivo
// arbitrário. O custo é ~33% a mais no corpo da requisição, aceitável para um
// painel que roda em 127.0.0.1.
import * as acervo from '../mediaLibrary.js'
import { decodificarBase64 } from '../mediaBase64.js'

export function criarServicoAcervo ({ biblioteca = acervo } = {}) {
  function decodificar (base64) {
    try {
      return decodificarBase64(base64, biblioteca.LIMITE_POR_ARQUIVO_BYTES)
    } catch (erro) {
      throw new biblioteca.ErroDeAcervo(erro.message)
    }
  }

  // Os limites viajam junto com a lista de propósito: a tela precisa deles
  // para montar o `accept` do seletor e recusar arquivo grande ANTES de ler
  // 32 MB em memória. Duplicar esses números no navegador seria criar uma
  // segunda fonte de verdade que sai de sincronia no dia em que um tipo novo
  // for aceito.
  function listar () {
    return {
      files: biblioteca.listar(),
      usage: biblioteca.uso(),
      limits: {
        maxFileBytes: biblioteca.LIMITE_POR_ARQUIVO_BYTES,
        acceptedTypes: Object.keys(biblioteca.TIPOS_ACEITOS)
      }
    }
  }

  // REESCREVER O CONTEÚDO de um arquivo que já existe, mantendo o id.
  //
  // O id é por onde os comandos apontam para o arquivo (`fileId`). Sem esta
  // operação, editar era apagar e subir de novo — id novo, e todo comando que
  // referenciava o antigo passava a não achar nada, em silêncio.
  function reescrever (id, body) {
    const base64 = body?.contentBase64
    if (typeof base64 !== 'string' || !base64) {
      throw new biblioteca.ErroDeAcervo('Envie o novo conteúdo em contentBase64.')
    }
    const buffer = decodificar(base64)
    return biblioteca.reescrever(id, buffer)
  }

  function enviar (body) {
    const base64 = body?.contentBase64
    if (typeof base64 !== 'string' || !base64) {
      throw new biblioteca.ErroDeAcervo('Envie o conteúdo do arquivo em contentBase64.')
    }

    const buffer = decodificar(base64)

    return biblioteca.guardar(buffer, {
      mimetype: body?.mimetype,
      name: body?.name,
      description: body?.description,
      // A pasta é saneada dentro do acervo (`normalizarPasta`), não aqui: o
      // saneamento tem que valer para TODA entrada — o upload do painel e o
      // arquivo que chega pelo WhatsApp —, e deixar cada porta sanear a sua
      // seria convidar as duas a divergirem.
      folder: body?.folder
    })
  }

  // Bytes de volta para o navegador do próprio dono — é o que faz a tela
  // mostrar miniatura em vez de uma lista de nomes. Quem transforma isso em
  // resposta HTTP (e quem decide os cabeçalhos de segurança) é a camada web:
  // aqui só sai o conteúdo com o tipo que o acervo já validou na entrada.
  function conteudo (id) {
    const registro = biblioteca.obter(id)
    if (!registro) throw new biblioteca.ErroDeAcervo('Arquivo não encontrado no acervo.', 404)
    return {
      buffer: biblioteca.lerConteudo(id),
      mimetype: registro.mimetype,
      name: registro.name,
      kind: registro.kind
    }
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

  function mover (id, folder) {
    const atualizado = biblioteca.moverPara(id, folder)
    if (!atualizado) throw new biblioteca.ErroDeAcervo('Arquivo não encontrado no acervo.', 404)
    return atualizado
  }

  // Sem definirCota: o teto do acervo é configuração de quem instala, não
  // ação do painel. Ver o comentário em mediaLibrary.js.
  return { listar, enviar, reescrever, conteudo, remover, descrever, mover }
}
