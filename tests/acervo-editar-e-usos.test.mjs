// EDITAR UM ARQUIVO, E SABER QUEM O USA.
//
// Duas faltas que se agravavam uma à outra:
//
//   1. Não havia como REESCREVER o conteúdo de um arquivo. A biblioteca tinha
//      `guardar`, `remover`, `atualizarDescricao` e `moverPara`, e nada que
//      trocasse os bytes. "Editar" era apagar e subir de novo — com ID NOVO.
//   2. Não havia como saber QUE COMANDOS usam um arquivo. O vínculo mora
//      solto dentro do documento, em três campos alternativos, e ninguém o
//      indexava.
//
// Juntas: editar um arquivo quebrava, em silêncio, todo comando que apontava
// para ele por `fileId` — e não havia como nem descobrir quais eram. O aviso
// de apagar dizia "Comandos que usam este arquivo deixam de encontrá-lo" sem
// poder dizer quais, e o schema tem um `notFoundText` que existe justamente
// porque isso não dava para saber antes.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { usosDoArquivo } from '../src/engine/server/usosDeArquivo.js'

const pastaTeste = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-acervo-editar-'))

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const acervo = await import('../src/mediaLibrary.js')
acervo._usarPastaParaTeste(pastaTeste)

// --- reescrever: o ID sobrevive ------------------------------------------
const original = acervo.guardar(Buffer.from('conteúdo original'), {
  mimetype: 'text/plain', name: 'nota.txt', folder: 'notas', description: 'a nota'
})
const depois = acervo.reescrever(original.id, Buffer.from('conteúdo novo, bem maior do que o anterior'))

// O ID É O PONTO: é por ele que um comando aponta para o arquivo (`fileId`).
check('o id não muda', depois.id === original.id, `${original.id} -> ${depois.id}`)
check('o caminho não muda', depois.path === original.path, depois.path)
check('a pasta não muda', depois.folder === original.folder)
check('a descrição não muda', depois.description === original.description)
// O tipo também fica: trocar o conteúdo de um .html por um .png mudaria como
// o arquivo é ENVIADO (documento contra foto) sem ninguém pedir.
check('o tipo não muda', depois.mimetype === original.mimetype && depois.kind === original.kind)
check('o tamanho é atualizado', depois.sizeBytes === Buffer.byteLength('conteúdo novo, bem maior do que o anterior'), String(depois.sizeBytes))
check('os bytes no disco são os novos', fs.readFileSync(path.join(pastaTeste, 'arquivos', `${original.id}.txt`), 'utf8') === 'conteúdo novo, bem maior do que o anterior')

// `updatedAt` só existe em arquivo editado — inventá-lo igual a `createdAt`
// faria todo arquivo parecer editado.
check('ganha data de edição', Boolean(depois.updatedAt))
check('e o arquivo recém-criado não tem', original.updatedAt === undefined)

// Reescrever com MENOS bytes tem de caber: a conta da cota desconta o que o
// próprio arquivo já ocupa. Somar sem descontar recusaria encolher um arquivo
// por falta de um espaço que ele mesmo está devolvendo.
const menor = acervo.reescrever(original.id, Buffer.from('oi'))
check('dá para encolher', menor.sizeBytes === 2)
check('e o uso acompanha', acervo.uso().usedBytes === 2, String(acervo.uso().usedBytes))

let erroVazio = null
try { acervo.reescrever(original.id, Buffer.from('')) } catch (e) { erroVazio = e.message }
check('conteúdo vazio é recusado', /vazio/i.test(erroVazio || ''), erroVazio)

let erroSumido = null
try { acervo.reescrever('f'.repeat(24), Buffer.from('x')) } catch (e) { erroSumido = e.message }
check('arquivo inexistente é recusado', /não encontrado/i.test(erroSumido || ''), erroSumido)

// --- quem usa o arquivo ---------------------------------------------------
//
// A separação entre "certo" e "talvez" é o ponto do módulo: misturar os dois
// mentiria nas duas direções — afirmar uso que não há, ou esconder que existe
// um comando capaz de pegar aquele arquivo.
const arquivo = { id: 'abc123', path: 'produtos/fotos/capa.jpg', folder: 'produtos/fotos' }

const comando = (id, config) => ({
  id,
  nome: id,
  documento: { flow: { nodes: [{ type: 'action.whatsapp.sendFile', config }] } }
})

const resultado = usosDoArquivo(arquivo, [
  comando('por-id', { fileId: 'abc123' }),
  comando('por-caminho', { path: 'produtos/fotos/capa.jpg' }),
  comando('pela-pasta-exata', { folder: 'produtos/fotos' }),
  comando('pela-pasta-acima', { folder: 'produtos' }),
  comando('outro-arquivo', { fileId: 'outro' }),
  comando('outra-pasta', { folder: 'servicos' }),
  comando('dinamico', { path: 'produtos/{{message.args}}' })
])

const certos = resultado.certos.map((c) => c.automationId)
check('acha pelo identificador', certos.includes('por-id'))
check('acha pelo caminho exato', certos.includes('por-caminho'))
check('acha pela pasta exata', certos.includes('pela-pasta-exata'))
// Um comando que manda a pasta "produtos" alcança o que está em
// "produtos/fotos" — a pasta é um rótulo com níveis, não uma gaveta fechada.
check('acha pela pasta acima', certos.includes('pela-pasta-acima'))
check('não acha quem aponta para outro arquivo', !certos.includes('outro-arquivo'))
check('não acha quem aponta para outra pasta', !certos.includes('outra-pasta'))
check('e diz COMO achou', resultado.certos.find((c) => c.automationId === 'por-id')?.como === 'pelo identificador')

// Caminho montado na hora alcança qualquer arquivo. Dizer "não usa" seria tão
// errado quanto dizer "usa".
const talvez = resultado.talvez.map((c) => c.automationId)
check('o caminho dinâmico entra como "talvez"', talvez.includes('dinamico'))
check('e não entra como certo', !certos.includes('dinamico'))

// Automação sem nó de arquivo nenhum não aparece em lugar nenhum.
const semArquivo = usosDoArquivo(arquivo, [
  { id: 'so-responde', nome: 'so-responde', documento: { flow: { nodes: [{ type: 'action.whatsapp.reply', config: { text: 'oi' } }] } } }
])
check('comando que não manda arquivo fica de fora', semArquivo.certos.length === 0 && semArquivo.talvez.length === 0)

// Documento torto não derruba a consulta: ela é uma AJUDA na hora de apagar,
// e falhar por causa de uma revisão estranha seria pior que não informar.
const torto = usosDoArquivo(arquivo, [{ id: 'x', documento: null }, { id: 'y', documento: { flow: null } }])
check('documento sem fluxo não quebra', torto.certos.length === 0 && torto.talvez.length === 0)

// --- a tela ---------------------------------------------------------------
const tela = fs.readFileSync(new URL('../src/web/public/pages/acervo.js', import.meta.url), 'utf8')
check('a tela deixa escrever um arquivo do zero', tela.includes('painelDeTextoNovo'))
check('a tela deixa editar o conteúdo', tela.includes('api.media.rewrite'))
check('a tela pergunta quem usa ANTES de apagar', tela.includes('nomesDeQuemUsa'))
// Vídeo e documento recebiam só um glifo: não havia link de download em lugar
// nenhum da tela, embora o motor já servisse os bytes como anexo.
check('vídeo e documento ganham link de baixar', tela.includes("download: arquivo.name"))
// `btoa` sozinho quebra em acento — ele só aceita latin-1.
check('o texto com acento passa pelo caminho de UTF-8', tela.includes('encodeURIComponent(conteudo.value)'))

fs.rmSync(pastaTeste, { recursive: true, force: true })
console.log(falhas === 0 ? '\nacervo: editar e saber quem usa — tudo certo' : `\nacervo: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
