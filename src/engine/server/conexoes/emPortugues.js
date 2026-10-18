// O que uma função de conexão DEVOLVE, dito em português.
//
// Por que isto existe: `chama <conexão>.<função>` é a única ação de campos
// abertos da linguagem, e quem escreve um comando a escrevia às cegas. Nada no
// painel dizia quais funções existem, o que cada uma recebe, nem — e este era o
// pedido do dono, com estas palavras — "que tal função cria um carrossel com
// botões". O comando de busca tem nove linhas justamente porque a forma da
// resposta é propriedade da CONEXÃO; só faltava alguém dizer isso em voz alta.
//
// A frase é DERIVADA da declaração, não guardada ao lado dela. O painel deixa
// qualquer um trocar `forma`, `botao` e `ordemDosTipos` na aba Conexões: uma
// frase escrita à mão envelhece no primeiro `carrossel` → `lista`, e referência
// que mente é pior do que referência nenhuma. Para o que a derivação não sabe
// existe o campo `resumoDaResposta`, opcional, que entra ANTES da frase e não
// no lugar dela.
//
// A REGRA DOS NÚMEROS, que é uma correção do dono e vale para todo este
// arquivo: "quem decide o número é um usuário, e se ele mesmo não souber
// quantas imagens vai receber? e se ele quiser várias, tipo o comando de
// instagram — definir os limites do WhatsApp é importante, mas nunca definir
// limites sem necessidade."
//
// Então:
//   · a frase descreve a FORMA ("um card por resultado"), nunca uma quantidade;
//   · número só aparece se estiver DECLARADO, e sempre marcado como escolha de
//     hoje, com onde se muda — porque é escolha, não teto;
//   · sem número declarado, a frase diz "quantos vierem", que é o que o motor
//     faz de verdade (conexaoExecutor.js só corta se houver limite);
//   · limite de PLATAFORMA aparece só onde o código sabe de um de verdade — os
//     dez cards do carrossel, que o WhatsApp não desenha. Nenhum número neste
//     arquivo é inventado por mim.
import { FORMAS_DE_RESPOSTA, TIPOS_DE_ENVIO, TIPO_MIDIA } from './declaracao.js'

// Os dez cards são do WhatsApp, não meus: a declaração já diz isso em prosa, no
// comentário do `limite` do carrossel. É a única quantidade que esta camada
// afirma sem alguém ter declarado.
const CARDS_QUE_O_WHATSAPP_DESENHA = 10

function frase (partes) {
  return partes.filter((p) => p && String(p).trim()).join(' ')
}

// "hoje corta nos 5 primeiros" — e nunca "até 5". A diferença não é de estilo:
// a primeira forma diz que alguém escolheu e onde se troca; a segunda soa como
// teto do sistema, e mandaria a pessoa desistir de pedir seis.
function sobreOLimite (limite, oQue) {
  if (!limite) return `Vão todos os ${oQue} que vierem.`
  return `Hoje vão só os ${limite} primeiros ${oQue} — esse número é escolha da conexão, muda na aba Conexões.`
}

function sobreODescarte (descartar) {
  if (!descartar) return null
  const { campo, acima, abaixo } = descartar
  if (acima !== null && acima !== undefined) return `Antes disso, descarta o que tem "${campo}" acima de ${acima}.`
  if (abaixo !== null && abaixo !== undefined) return `Antes disso, descarta o que tem "${campo}" abaixo de ${abaixo}.`
  return null
}

function sobreOVazio (vazio) {
  return vazio ? `Não vindo nada, responde "${vazio}".` : null
}

function descreverCarrossel (r) {
  const botao = r.botao
    ? `Embaixo de cada card vai um botão "${r.botao.texto}", que manda "${r.botao.comando}" com os dados daquele card — então escolher um não depende de nada guardado entre as duas mensagens.`
    : 'Os cards não têm botão: a pessoa desliza e lê, e escolhe digitando.'
  return frase([
    'Devolve um CARROSSEL: uma mensagem só, com um card por resultado, cada um com a sua foto.',
    botao,
    sobreODescarte(r.descartar),
    sobreOLimite(r.limite, 'cards'),
    `O WhatsApp não desenha mais de ${CARDS_QUE_O_WHATSAPP_DESENHA} cards numa mensagem.`,
    // O MESMO padrão da declaração (`igualarAltura !== false && !== 'nao'`), e
    // não `if (r.igualarAltura)`: a declaração pronta não traz o campo, e com a
    // conferência ingênua a frase dizia que os cards sairiam tortos quando
    // saem alinhados. Repetir o padrão aqui é o preço de descrever tanto a
    // declaração normalizada quanto a crua.
    r.igualarAltura !== false && r.igualarAltura !== 'nao'
      ? 'Os cards menores recebem linhas vazias para ficarem da altura do maior.'
      : null,
    sobreOVazio(r.vazio)
  ])
}

function descreverLista (r) {
  return frase([
    'Devolve uma LISTA em texto, numerada, uma linha por item — sem foto e sem botão.',
    `Cada linha sai escrita como "${r.linha}".`,
    sobreOLimite(r.limite, 'itens'),
    sobreOVazio(r.vazio)
  ])
}

function descreverTrabalho (r) {
  const ordem = r.ordemDosTipos?.length
    ? `Entrega em mensagens SEPARADAS, nesta ordem: ${r.ordemDosTipos.join(', ')}.`
    : 'Entrega os arquivos que vierem, na ordem em que o serviço os devolveu.'
  return frase([
    'É um TRABALHO: o serviço responde na hora com um identificador, e o bot acompanha até acabar — serve para o que leva tempo, como baixar e converter.',
    ordem,
    r.modeloDaDescricao
      ? 'A legenda é montada com os campos da resposta, do jeito que a conexão escreveu — linha sem valor desaparece em vez de aparecer crua.'
      : null,
    'Enquanto isso o comando pode avisar que está trabalhando, pela linha "avisa:".'
  ])
}

function descreverArquivo (r) {
  const tipo = r.tipo && Object.hasOwn(TIPOS_DE_ENVIO, r.tipo)
    ? `Vai enviado como ${r.tipo}.`
    : 'O tipo de envio sai do formato do arquivo que voltou — é o certo para conversão, onde a saída depende do que foi pedido.'
  return frase([
    'Devolve O ARQUIVO dentro da própria resposta, pronto para mandar na conversa. É a forma de quem converte em segundos.',
    tipo
  ])
}

function descreverMidia (r) {
  return frase([
    'Devolve os ENDEREÇOS dos arquivos, e o bot busca cada um depois.',
    r.campo ? `A lista vem no campo "${r.campo}".` : null
  ])
}

function descreverTexto (r) {
  return frase([
    'Devolve um TEXTO, que vai na conversa como resposta.',
    r.campo ? `O texto vem no campo "${r.campo}".` : 'A resposta inteira é o texto.'
  ])
}

/**
 * A frase que diz o que a função devolve.
 *
 * Toda forma conhecida tem frase: uma forma sem frase apareceria no painel como
 * um espaço em branco, e um espaço em branco se lê como "não devolve nada".
 */
export function descreverResposta (resposta) {
  if (!resposta?.forma) return 'Esta função não declarou o que devolve.'
  const porForma = {
    [FORMAS_DE_RESPOSTA.carrossel]: descreverCarrossel,
    [FORMAS_DE_RESPOSTA.lista]: descreverLista,
    [FORMAS_DE_RESPOSTA.trabalho]: descreverTrabalho,
    [FORMAS_DE_RESPOSTA.arquivo]: descreverArquivo,
    [FORMAS_DE_RESPOSTA.midia]: descreverMidia,
    [FORMAS_DE_RESPOSTA.texto]: descreverTexto
  }
  const monta = porForma[resposta.forma]
  if (!monta) return `Devolve a forma "${resposta.forma}".`
  // O resumo declarado vem PRIMEIRO e some junto com a função; a frase derivada
  // continua embaixo, porque é ela que acompanha quem mexer na declaração.
  return frase([resposta.resumoDaResposta || null, monta(resposta)])
}

/** As entradas da função, cada uma dita em uma linha. */
export function descreverEntradas (funcao) {
  return (funcao?.entradas || []).map((e) => Object.freeze({
    nome: e.nome,
    tipo: e.tipo,
    obrigatoria: e.obrigatoria !== false,
    opcoes: e.opcoes || null,
    padrao: e.padrao ?? null,
    // A entrada de mídia é a única que não leva valor escrito: leva o arquivo
    // que chegou pela conversa, e no texto do comando ela se escreve com uma
    // das palavras de arquivo ("a mídia", "a mídia citada").
    recebeArquivo: e.tipo === TIPO_MIDIA,
    comoEscrever: e.tipo === TIPO_MIDIA
      ? `${e.nome}: a mídia`
      : `${e.nome}: ${e.tipo === 'número' ? '12' : e.tipo === 'liga/desliga' ? 'sim' : e.opcoes?.length ? e.opcoes[0] : '"o que vai aqui"'}`
  }))
}

/** Quantos arquivos esta função recebe — 0, 1 ou 2. */
export function quantosArquivos (funcao) {
  return (funcao?.entradas || []).filter((e) => e.tipo === TIPO_MIDIA).length
}
