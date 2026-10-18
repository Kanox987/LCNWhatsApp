// O catálogo de funções de conexão, e principalmente A REGRA DOS NÚMEROS.
//
// O pedido do dono era "quem for fazer não precisa entender como funciona por
// baixo do pano, só saber que tal função cria um carrossel com botões". Ao
// descrever isso eu escrevi "carrossel de até 5 cards", e ele corrigiu:
//
//   "quem decide o número é um usuário, e se ele mesmo não souber quantas
//   imagens vai receber? e se ele quiser várias img tipo o comando de
//   instagram — definir os limites do WhatsApp é importante, mas nunca definir
//   limites sem necessidade."
//
// Ele está certo inclusive sobre o código que já existia: não há teto de cards.
// `limiteDeLista` devolve null quando ausente e o executor só corta se houver
// limite declarado. O 5 do buscar-musica é escolha daquela conexão, não teto do
// sistema — e uma frase que diz "até 5" mandaria alguém desistir de pedir seis.
//
// Então o que estes casos guardam é: a frase descreve a FORMA, número só
// aparece quando foi DECLARADO e sempre marcado como escolha de hoje, e o
// único número que a frase afirma sozinha é o limite real do WhatsApp.
import { compilar } from '../src/lcn/compilar.js'
import {
  descreverEntradas, descreverResposta, quantosArquivos
} from '../src/engine/server/conexoes/emPortugues.js'
import { FORMAS_DE_RESPOSTA } from '../src/engine/server/conexoes/declaracao.js'
import { CONEXOES_PRONTAS } from '../src/engine/server/conexoes/prontas.js'
import { exemploDeChamada, trechoCompilavel } from '../src/lcn/referencia.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const funcaoPronta = (idConexao, nomeFuncao) =>
  CONEXOES_PRONTAS.find((c) => c.id === idConexao)?.config?.funcoes?.find((f) => f.nome === nomeFuncao)

// --- toda forma conhecida tem frase --------------------------------------
//
// Forma sem frase apareceria no painel como espaço em branco, e espaço em
// branco se lê como "não devolve nada". O cruzamento é sobre FORMAS_DE_RESPOSTA
// para que uma forma nova não entre invisível.
const exemplosDeResposta = {
  texto: { forma: 'texto', campo: 'mensagem' },
  'mídia': { forma: 'mídia', campo: 'arquivos' },
  arquivo: { forma: 'arquivo', tipo: 'figurinha' },
  lista: { forma: 'lista', campo: 'achados', linha: '{{titulo}} — {{autor}}' },
  carrossel: {
    forma: 'carrossel',
    campo: 'achados',
    botao: { texto: '⬇️ Baixar esta', comando: '/musica {{url}}' }
  },
  trabalho: {
    forma: 'trabalho',
    campoDoTrabalho: 'job',
    ordemDosTipos: ['foto', 'áudio']
  }
}

for (const forma of Object.values(FORMAS_DE_RESPOSTA)) {
  const resposta = exemplosDeResposta[forma]
  check(`tenho exemplo da forma "${forma}"`, Boolean(resposta))
  if (!resposta) continue
  const frase = descreverResposta(resposta)
  check(`a forma "${forma}" tem frase`, typeof frase === 'string' && frase.trim().length > 20, `${frase?.length} letras`)
  // Buraco na frase aparece assim, e aparece em produção antes de aparecer aqui.
  const sujeira = /undefined|null|\[object Object\]|NaN/.test(frase)
  check(`a frase da forma "${forma}" não tem buraco`, !sujeira, sujeira ? frase : undefined)
}

check('sem forma declarada, a frase diz isso em vez de ficar vazia', descreverResposta({}).length > 10)

// --- A REGRA DOS NÚMEROS -------------------------------------------------

// Sem limite declarado: nenhum número, e a frase diz o que o motor faz de
// verdade — vão quantos vierem. É o caso do "comando de instagram" que o dono
// citou: um post com dezessete fotos manda dezessete.
const listaSemLimite = descreverResposta(exemplosDeResposta.lista)
check('lista sem limite: diz que vão todos', /todos os (cards|itens) que vierem/.test(listaSemLimite), listaSemLimite)
check('lista sem limite: não inventa número nenhum', !/\d/.test(listaSemLimite), listaSemLimite)

// Com limite declarado: o número aparece, marcado como escolha, com onde se
// troca. Nunca "até N".
const listaComLimite = descreverResposta({ ...exemplosDeResposta.lista, limite: 5 })
check('lista com limite: cita o 5', /\b5\b/.test(listaComLimite))
check('lista com limite: diz que é escolha e onde se muda', /escolha da conexão.*Conexões/s.test(listaComLimite), listaComLimite)
check('lista com limite: NÃO diz "até 5"', !/até 5/i.test(listaComLimite), listaComLimite)

// O único número que a frase afirma sem ninguém ter declarado é o do WhatsApp,
// e ele está escrito em prosa na própria declaração.
const carrosselSemLimite = descreverResposta(exemplosDeResposta.carrossel)
check('carrossel: fala de um card por resultado, não de quantidade', /um card por resultado/.test(carrosselSemLimite))
check('carrossel sem limite: vão todos', /todos os (cards|itens) que vierem/.test(carrosselSemLimite))
check('carrossel: diz o limite real do WhatsApp', /WhatsApp não desenha mais de 10 cards/.test(carrosselSemLimite), carrosselSemLimite)

// --- os dois casos que o dono montou -------------------------------------
const buscar = funcaoPronta('midia', 'buscar')
check('a função midia.buscar existe', Boolean(buscar))
const fraseDoBuscar = descreverResposta(buscar.resposta)
check('buscar: diz que é carrossel', /CARROSSEL/.test(fraseDoBuscar))
check('buscar: fala do botão embaixo de cada card', /botão/.test(fraseDoBuscar) && /cada card/.test(fraseDoBuscar))
check('buscar: diz qual comando o botão manda', /\/musica/.test(fraseDoBuscar))
check('buscar: um card por resultado', /um card por resultado/.test(fraseDoBuscar))
check('buscar: cita o 5 como escolha de hoje', /Hoje vão só/.test(fraseDoBuscar) && /\b5\b/.test(fraseDoBuscar))
check('buscar: NÃO apresenta o 5 como teto', !/até 5/i.test(fraseDoBuscar), fraseDoBuscar)
check('buscar: conta do descarte de 15 min', /descarta/.test(fraseDoBuscar) && /900/.test(fraseDoBuscar))
check('buscar: conta que os cards são alinhados', /altura do maior/.test(fraseDoBuscar))

const musica = funcaoPronta('midia', 'musica')
check('a função midia.musica existe', Boolean(musica))
const fraseDaMusica = descreverResposta(musica.resposta)
check('musica: é trabalho, não resposta na hora', /TRABALHO/.test(fraseDaMusica))
check('musica: entrega em mensagens separadas', /SEPARADAS/.test(fraseDaMusica))
// A ordem é o pedido do dono: a capa com a legenda e, logo abaixo, o áudio.
const ordem = fraseDaMusica.match(/nesta ordem: ([^.]+)\./)?.[1]
check('musica: a capa vem antes do áudio', ordem === 'foto, áudio', ordem)
check('musica: conta que a legenda é montada', /legenda é montada/.test(fraseDaMusica))

// --- o resumo declarado não substitui a frase ----------------------------
//
// Guardado no LUGAR da frase, bastava alguém trocar `carrossel` por `lista` na
// aba Conexões para o painel passar a mentir. Então ele entra antes, e a frase
// derivada continua embaixo.
const comResumo = descreverResposta({ ...exemplosDeResposta.carrossel, resumoDaResposta: 'Só acha vídeo do YouTube.' })
check('o resumo declarado aparece', comResumo.startsWith('Só acha vídeo do YouTube.'))
check('e a frase derivada continua depois dele', /CARROSSEL/.test(comResumo))

// --- entradas e exemplos de TODAS as funções prontas ---------------------
let quantas = 0
for (const conexao of CONEXOES_PRONTAS) {
  for (const funcao of (conexao.config?.funcoes || [])) {
    quantas++
    const onde = `${conexao.id}.${funcao.nome}`
    const entradas = descreverEntradas(funcao)
    check(`${onde}: toda entrada tem nome e tipo`, entradas.every((e) => e.nome && e.tipo))
    check(`${onde}: no máximo duas entradas de arquivo`, quantosArquivos(funcao) <= 2, `${quantosArquivos(funcao)}`)

    const frase = descreverResposta(funcao.resposta)
    check(`${onde}: tem frase sem buraco`, frase.length > 20 && !/undefined|\[object Object\]/.test(frase))

    // O exemplo é gerado da tabela da ação `chama`. Se ele não compilar, o
    // painel está oferecendo um trecho que falha na mão de quem confiou nele.
    const exemplo = exemploDeChamada({ conexao: conexao.id, funcao: { nome: funcao.nome, entradas } })
    let erro = null
    try { compilar(trechoCompilavel({ onde: 'corpo', texto: exemplo })) } catch (e) { erro = e.message }
    check(`${onde}: o exemplo compila`, erro === null, erro || undefined)

    // O exemplo é o MÍNIMO que funciona, não o inventário: a figurinha declara
    // dezessete entradas e exige uma, e despejar as dezessete produz um trecho
    // que ninguém lê e que parece exigir tudo.
    const opcionais = entradas.filter((e) => !e.obrigatoria).map((e) => e.nome)
    const vazaram = opcionais.filter((nome) => new RegExp(`^\\s+${nome}:`, 'm').test(exemplo))
    check(`${onde}: o exemplo não enche de entrada opcional`, vazaram.length === 0, vazaram.join(', '))
  }
}
check('passei por todas as funções prontas', quantas >= 10, `${quantas}`)

// A entrada de arquivo se escreve com a palavra da linguagem, nunca com um
// valor entre aspas: é o que mantém os bytes fora do interpolador.
const figurinha = funcaoPronta('imagem', 'figurinha')
const entradaDeArquivo = descreverEntradas(figurinha).find((e) => e.recebeArquivo)
check('a entrada de mídia se escreve com "a mídia"', entradaDeArquivo?.comoEscrever === 'arquivo: a mídia', entradaDeArquivo?.comoEscrever)

console.log(falhas === 0 ? '\ncatálogo de funções: tudo certo' : `\ncatálogo de funções: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
