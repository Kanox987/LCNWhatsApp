import { ErroHttp } from '../transport.js'
import { adicionarNaLista, aplicarImportacao, exportarLista, lerArquivoDeLista, limparLista, listasExistentes, membrosDaLista, normalizarNomeDeLista, planejarImportacao, removerDaLista } from '../listas.js'

// Mesmo formato dos donos: só dígitos antes do domínio. Um id inventado viraria
// uma linha que parece autorizar alguém e nunca corresponde a ninguém.
const JID_CONTATO = /^\d{5,20}@s\.whatsapp\.net$/

function exigirNome (valor) {
  const nome = normalizarNomeDeLista(decodeURIComponent(String(valor ?? '')))
  if (!nome) throw new ErroHttp(400, 'Nome de lista inválido: use letras minúsculas, números e "_", começando por letra (até 32).')
  return nome
}

function exigirJid (valor) {
  if (typeof valor !== 'string' || !JID_CONTATO.test(valor)) {
    throw new ErroHttp(400, 'Informe o contato no formato 5511999999999@s.whatsapp.net.')
  }
  return valor
}

// O plano interno carrega as listas de quem entra e sai; quem chama só precisa
// dos números e do estado.
const resumoDoPlano = ({ adicionar, jaEstavam, remover, totalFinal, estado }) => ({ adicionar, jaEstavam, remover, totalFinal, estado })

export function registrarRotasListas (roteador, db) {
  roteador.get('/listas', () => ({ lists: listasExistentes(db) }))

  roteador.get('/listas/:nome', ({ params }) => {
    const nome = exigirNome(params.nome)
    return { name: nome, members: membrosDaLista(db, nome) }
  })

  roteador.post('/listas/:nome/membros', ({ params, body }) => {
    const nome = exigirNome(params.nome)
    const contactId = exigirJid(body?.contactId)
    const r = adicionarNaLista(db, nome, contactId)
    return { name: nome, contactId, changed: r.mudou }
  })

  roteador.delete('/listas/:nome/membros/:contactId', ({ params }) => {
    const nome = exigirNome(params.nome)
    const contactId = exigirJid(decodeURIComponent(params.contactId))
    const r = removerDaLista(db, nome, contactId)
    return { name: nome, contactId, changed: r.mudou }
  })

  roteador.delete('/listas/:nome', ({ params }) => {
    const nome = exigirNome(params.nome)
    return { name: nome, removed: limparLista(db, nome).removidos }
  })

  // Lista como arquivo. O nome do arquivo não manda: a lista afetada é a da URL.
  roteador.get('/listas/:nome/exportar', ({ params }) => {
    const nome = exigirNome(params.nome)
    return exportarLista(db, nome)
  })

  // modo: 'merge' (só acrescenta) ou 'replace' (a lista passa a ser o arquivo).
  // `simular` (padrão: true) só conta. Para gravar é preciso pedir `simular: false`,
  // e o 'replace' ainda exige o `estado` que a prévia devolveu: se a lista mudou
  // no meio do caminho, recusa em vez de tirar gente que ninguém viu.
  roteador.post('/listas/:nome/importar', ({ params, body }) => {
    const nome = exigirNome(params.nome)
    const modo = body?.modo
    if (modo !== 'merge' && modo !== 'replace') throw new ErroHttp(400, 'Escolha o modo: "merge" (acrescentar) ou "replace" (substituir).')
    const lido = lerArquivoDeLista(body?.dados)
    if (!lido.ok) throw new ErroHttp(400, `Arquivo recusado: ${lido.erros.join(' ')}`)

    if (body?.simular !== false) {
      return { name: nome, mode: modo, applied: false, repeated: lido.repetidos, ...resumoDoPlano(planejarImportacao(db, nome, lido.membros, modo)) }
    }
    if (modo === 'replace' && typeof body?.estado !== 'string') {
      throw new ErroHttp(400, 'Para substituir, simule antes e envie o "estado" que a prévia devolveu.')
    }
    const r = aplicarImportacao(db, nome, lido.membros, modo, { estado: body?.estado })
    if (!r.ok) throw new ErroHttp(409, 'A lista mudou desde a prévia. Simule de novo antes de substituir.')
    return { name: nome, mode: modo, applied: true, repeated: lido.repetidos, ...resumoDoPlano(r.plano) }
  })
}
