// A TELA DE CONEXÕES PRECISA OFERECER TUDO QUE O MOTOR ACEITA.
//
// Este arquivo existe por causa de um sintoma que se repetiu duas vezes nesta
// base, e que o dono resume numa frase: "quero a api conectada pelo painel, de
// uma forma que outras pessoas poderiam colocar sem mexer no sistema de
// código".
//
// Primeira vez: a forma `arquivo` e a entrada `mídia` existiam no motor e não
// na tela — o serviço de imagem inteiro era impossível de declarar sem editar
// arquivo, e quem abrisse a conexão para mexer em outra coisa salvava as
// funções de figurinha SEM a entrada do arquivo.
//
// Segunda: a forma `carrossel`. Eu criei a busca em cards com botão e só EU
// conseguia criar outra igual.
//
// A conferência é contra a DECLARAÇÃO do motor, nunca contra uma segunda
// lista: duas cópias da mesma definição saem de sincronia, que foi como a
// lista de variáveis do interpolador divergiu da lista da condição.
import fs from 'fs'
import { FORMAS_DE_RESPOSTA, TIPOS_DE_ENTRADA, TIPOS_DE_ENVIO } from '../src/engine/server/conexoes/declaracao.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const tela = fs.readFileSync(new URL('../src/web/public/pages/connections.js', import.meta.url), 'utf8')

// A lista de formas da tela, lida do próprio arquivo: ele é um módulo de
// navegador (usa `document`), então importar aqui exigiria um DOM inteiro para
// conferir duas listas.
const bloco = tela.match(/const FORMAS = \[([\s\S]*?)\n\]/)
check('a tela declara as formas de resposta', !!bloco)
const naTela = [...(bloco?.[1] || '').matchAll(/\['([^']+)',/g)].map((m) => m[1])

for (const forma of Object.values(FORMAS_DE_RESPOSTA)) {
  check(`a tela oferece a forma "${forma}"`, naTela.includes(forma), naTela.join(', '))
}
for (const forma of naTela) {
  // O outro sentido: a tela não pode oferecer o que a publicação recusa.
  check(`a forma "${forma}" da tela existe no motor`, Object.values(FORMAS_DE_RESPOSTA).includes(forma))
}

// Cada forma precisa de um bloco de campos próprio, senão ela aparece no
// seletor e não tem onde preencher nada.
for (const forma of ['carrossel', 'lista', 'arquivo', 'trabalho']) {
  const nome = forma[0].toUpperCase() + forma.slice(1)
  check(`a forma "${forma}" tem bloco de campos na tela`, tela.includes(`bloco${nome}`))
  check(`e o bloco aparece só na forma dela`, new RegExp(`bloco${nome}\\.hidden = forma\\.value !== '${forma}'`).test(tela))
}

// Os tipos de entrada, inclusive `mídia` — foi o que faltou da primeira vez.
const blocoTipos = tela.match(/const TIPOS = \[([^\]]*)\]/)
const tiposNaTela = [...(blocoTipos?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1])
for (const tipo of TIPOS_DE_ENTRADA) {
  check(`a tela oferece a entrada do tipo "${tipo}"`, tiposNaTela.includes(tipo), tiposNaTela.join(', '))
}

// E os tipos de envio da forma `arquivo`: é o que decide se o webp chega como
// figurinha ou como foto.
const blocoEnvio = tela.match(/const TIPOS_DE_ENVIO = \[([\s\S]*?)\n\]/)
const enviosNaTela = [...(blocoEnvio?.[1] || '').matchAll(/\['([^']*)',/g)].map((m) => m[1])
for (const tipo of Object.keys(TIPOS_DE_ENVIO)) {
  check(`a tela oferece enviar como "${tipo}"`, enviosNaTela.includes(tipo), enviosNaTela.join(', '))
}

// Campos que o motor passou a aceitar e que a tela precisa saber escrever.
for (const campo of ['esperaSegundos', 'modeloDaDescricao', 'ordemDosTipos', 'campoDaDescricao', 'estilo']) {
  check(`a tela sabe escrever "${campo}"`, tela.includes(campo))
}
// O botão do card: rótulo e comando são o que fazem o carrossel ser mais que
// uma galeria.
check('a tela deixa escrever o rótulo e o comando do botão do card',
  tela.includes('textoDoBotao') && tela.includes('comandoDoBotao'))
// A forma da mensagem precisa ser trocável PELA TELA: é a única saída de quem
// recebe "nada" sem nenhum erro em lugar nenhum.
for (const estilo of ['completo', 'simples', 'semEmbrulho', 'botoes', 'menu', 'diagnóstico']) {
  check(`a tela oferece a forma de carrossel "${estilo}"`, tela.includes(`'${estilo}'`))
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\ncobertura da tela de conexões: tudo certo')
