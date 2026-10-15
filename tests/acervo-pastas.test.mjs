// Acervo com pastas, e os dois comandos que ele destrava: guardar o que chega
// pelo WhatsApp, e enviar pelo caminho.
//
// A DECISÃO QUE ESTES CASOS GUARDAM: pasta é RÓTULO, não diretório.
//
// O acervo gera o id aleatório e nunca deriva caminho do nome que veio de
// fora — é o que fecha travessia ("../../config.json" vira "9f2a..."). Criar
// diretório de verdade a partir de texto que chega pelo WhatsApp reabriria
// exatamente esse buraco, e com a pior origem possível. Então a pasta vive no
// índice, e o arquivo continua gravado plano, por id.
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as acervo from '../src/mediaLibrary.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-acervo-'))
acervo._usarPastaParaTeste(pasta)

const foto = (nome, folder) => acervo.guardar(Buffer.from('bytes-da-foto'), { mimetype: 'image/jpeg', name: nome, folder })

// --- pasta é rótulo saneado ----------------------------------------------
check('caminho relativo é desmontado', acervo.normalizarPasta('../../etc') === 'etc')
check('barras repetidas e vazios somem', acervo.normalizarPasta('produtos//fotos/') === 'produtos/fotos')
check('"." e ".." não viram nível', acervo.normalizarPasta('a/./b/../c') === 'a/b/c')
// Árvore infinita criada por mensagem de WhatsApp não é organização, é ruído.
check('no máximo três níveis', acervo.normalizarPasta('a/b/c/d/e') === 'a/b/c')
check('pasta vazia vira nenhuma', acervo.normalizarPasta('   ') === null)
// Escapado de propósito: byte de controle LITERAL no fonte torna o arquivo
// binário para o git e cega o grep — foi o que aconteceu com mediaLibrary.js.
check('byte de controle é removido', acervo.normalizarPasta('produtos') === 'produtos')

// --- guardar com pasta ----------------------------------------------------
const capa = foto('capa.jpg', 'produtos/fotos')
check('o arquivo guarda a pasta', capa.folder === 'produtos/fotos')
check('e expõe o caminho pronto', capa.path === 'produtos/fotos/capa.jpg', capa.path)

// O ponto central: NADA disso virou diretório no disco.
const noDisco = fs.readdirSync(path.join(pasta, 'arquivos'))
check('no disco continua plano, sem pasta nenhuma',
  noDisco.every((n) => !n.includes('/')) && !fs.existsSync(path.join(pasta, 'arquivos', 'produtos')),
  noDisco.join(', '))
check('e o arquivo está gravado pelo id gerado, não pelo nome',
  noDisco.some((n) => n.startsWith(capa.id)), noDisco.join(', '))

// Travessia pelo NOME também não passa — isso já valia, e continua valendo.
const malicioso = acervo.guardar(Buffer.from('x'), { mimetype: 'image/png', name: '../../config.json' })
check('nome com caminho vira só rótulo', !malicioso.name.includes('/'), malicioso.name)
check('e não escapou da pasta do acervo', fs.existsSync(path.join(pasta, 'arquivos', `${malicioso.id}.png`)))

// --- achar por caminho ----------------------------------------------------
check('acha pelo caminho completo', acervo.porCaminho('produtos/fotos/capa.jpg')?.id === capa.id)
// Quem digita no WhatsApp não vai acertar a caixa.
check('sem diferenciar maiúscula', acervo.porCaminho('Produtos/Fotos/CAPA.JPG')?.id === capa.id)
check('barra sobrando não atrapalha', acervo.porCaminho('/produtos/fotos/capa.jpg')?.id === capa.id)
check('nome sozinho resolve quando é único', acervo.porCaminho('capa.jpg')?.id === capa.id)
check('caminho que não existe devolve nada', acervo.porCaminho('nao/existe.jpg') === null)
check('caminho vazio devolve nada', acervo.porCaminho('') === null)

// --- nome ambíguo NÃO chuta ----------------------------------------------
//
// Devolver "um dos dois" calado faria a pessoa mandar o arquivo errado e nunca
// entender por quê. Este é o caso que mais importa aqui.
const outraCapa = foto('capa.jpg', 'banners')
check('duas capas em pastas diferentes convivem', outraCapa.path === 'banners/capa.jpg')
check('nome ambíguo NÃO devolve um dos dois', acervo.porCaminho('capa.jpg') === null)
check('mas com a pasta junto, desempata', acervo.porCaminho('banners/capa.jpg')?.id === outraCapa.id)
check('e a outra continua alcançável', acervo.porCaminho('produtos/fotos/capa.jpg')?.id === capa.id)

// --- as pastas que existem ------------------------------------------------
check('lista as pastas em uso', JSON.stringify(acervo.listarPastas()) === '["banners","produtos/fotos"]',
  JSON.stringify(acervo.listarPastas()))

// --- arquivo sem pasta ----------------------------------------------------
const solto = foto('solto.jpg')
check('arquivo sem pasta fica na raiz', solto.folder === null && solto.path === 'solto.jpg')
check('e é achado pelo nome', acervo.porCaminho('solto.jpg')?.id === solto.id)

// --- a pasta como CONJUNTO ----------------------------------------------
//
// É o que faz um comando mandar um carrossel próprio: a pasta é a unidade, e
// não o arquivo. Sem isto, "envia arquivo" só sabia mandar um.
{
  const lista = acervo.listarDaPasta('produtos/fotos')
  check('lista o que está na pasta', lista.length === 1 && lista[0].id === capa.id, JSON.stringify(lista.map((r) => r.name)))
  check('pasta que não existe devolve lista vazia', acervo.listarDaPasta('nao/existe').length === 0)
  check('sem pasta, lista vazia — não é "tudo"', acervo.listarDaPasta('').length === 0)
  // "Tudo" seria o pior padrão possível aqui: um comando mal preenchido
  // despejaria o acervo inteiro na conversa.

  // ORDEM É A DO NOME, não a da subida: quem monta um conjunto nomeia os
  // arquivos para ler na ordem, e a ordem de upload é acidente.
  foto('10.jpg', 'album')
  foto('2.jpg', 'album')
  foto('1.jpg', 'album')
  const ordenada = acervo.listarDaPasta('album').map((r) => r.name)
  check('a ordem é a do nome, e 10 vem depois de 2',
    JSON.stringify(ordenada) === '["1.jpg","2.jpg","10.jpg"]', JSON.stringify(ordenada))
  check('maiúscula na pasta não atrapalha', acervo.listarDaPasta('ALBUM').length === 3)
}

fs.rmSync(pasta, { recursive: true, force: true })
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE PASTA NO ACERVO PASSARAM')
process.exit(falhas ? 1 : 0)
