// A referência da linguagem, montada a partir do próprio vocabulário.
//
// POR QUE ISTO NÃO É UM TEXTO ESCRITO À MÃO: a linguagem tem 13 ações, 20
// campos de cabeçalho, 5 linhas soltas, 3 blocos de fim e 11 listas de
// palavras. Um documento escrito à mão descreve isso uma vez e envelhece na
// primeira ação nova — foi assim que a lista de variáveis do interpolador
// divergiu da lista da condição nesta base, e é o que o cabeçalho de
// `vocabulario.js` conta. Aqui a referência é DERIVADA: palavra nova no
// vocabulário aparece sozinha no painel, no realce e no erro.
//
// A DIVISÃO, que é o ponto:
//
//   vocabulario.js   diz QUAIS SÃO AS PALAVRAS   (e como saem no texto)
//   o glossário      diz O QUE ELAS SIGNIFICAM   (rótulo, resumo, exemplo)
//   este arquivo     JUNTA os dois, por `tipo` e por `chave`
//
// Nenhuma descrição nova se escreve aqui. Uma terceira tabela de prosa é
// exatamente o que não pode acontecer.
//
// O glossário entra INJETADO (`montarReferencia({ prosa })`) e não importado:
// ele vive em `src/web/public/logic/acoes.js` porque o navegador precisa dele,
// e o painel é servido estático — nada fora de `public` chega ao navegador. Se
// este arquivo o importasse, `src/lcn` passaria a depender de `src/web`, e a
// linguagem deixaria de compilar sozinha. Quem junta é o BFF, que já tem os
// dois lados à mão.
import {
  ACOES, BLOCOS_DE_TEMPLATE, CAMPOS_DO_CABECALHO, CAMPOS_DO_TEMPLATE, CASAMENTOS, CLASSES,
  DESTINOS, EXIGENCIAS, MARCAS_DO_CABECALHO, NIVEIS_DE_AVISO, ONDE_PROCURAR, OPERADORES,
  ORIGENS, PALAVRAS_DE_OPERANDO, TIPOS_DE_CONFIG, TIPOS_DE_MENSAGEM, TIPOS_DE_VALOR
} from './vocabulario.js'

// --- trechos prontos ------------------------------------------------------
//
// O que o dono pediu com "deixar formato já pronto de forma simples": a pessoa
// não monta um carrossel a partir do zero, ela insere o trecho que já faz um e
// troca o que quiser.
//
// `onde` diz o que o trecho é, e é o que permite TESTAR que ele compila sem
// pregar um arquivo inteiro em cada entrada:
//
//   'arquivo'  — um arquivo completo, compila sozinho
//   'corpo'    — ação ou condição, compila dentro do molde de comando
//   'blocos'   — bloco do fim do arquivo, compila dentro do molde de template
//
// Nenhum trecho escreve número de resultado, de card ou de item. Quem decide
// quantos é quem declara a conexão, e o padrão é "todos os que vieram".
export const TRECHOS = Object.freeze([
  {
    chave: 'comando-texto',
    rotulo: 'Comando que responde um texto',
    quando: 'O menor comando que existe. Bom primeiro arquivo.',
    onde: 'arquivo',
    texto: [
      'automação meu-comando',
      '  id: meu-comando',
      '  nome: Meu comando',
      '  tipo: comando',
      '  dispara com: /oi',
      '  menu: /oi — Responde uma saudação',
      '  acessa: texto',
      '  casa: exato',
      '  quem: qualquer um',
      '',
      '  responde "oi, {{sender.name}}!"'
    ].join('\n')
  },
  {
    chave: 'comando-com-argumentos',
    rotulo: 'Comando que recebe texto depois da palavra',
    quando: 'Quando o comando precisa do que a pessoa digitou junto, em partes com nome.',
    onde: 'arquivo',
    texto: [
      'automação renomear',
      '  id: renomear',
      '  nome: Renomear',
      '  tipo: comando',
      '  dispara com: /renomear',
      '  argumentos: pacote / autor',
      '  acessa: texto',
      '  casa: exato ou com argumentos',
      '',
      '  responde "pacote: {{argumentos.pacote}} · autor: {{argumentos.autor}}"'
    ].join('\n')
  },
  {
    chave: 'carrossel-de-busca',
    rotulo: 'Busca que volta em carrossel com botão',
    quando: 'Um card por resultado, com um botão embaixo de cada que manda o comando daquele item. A forma do carrossel é da conexão, não daqui — aqui só se chama a função.',
    onde: 'corpo',
    texto: [
      'se evento message.args != ""',
      '  chama midia.buscar',
      '    com',
      '      busca: "{{message.args}}"',
      '    avisa: "🔎 Procurando…"',
      '    erro: "Não consegui buscar: {{erro}}"',
      'senão',
      '  responde "Escreve o que procurar depois do comando."'
    ].join('\n')
  },
  {
    chave: 'baixar-de-link',
    rotulo: 'Baixar a mídia de um link',
    quando: 'O "precisa de um link" resolve antes do fluxo começar, e responde sozinho quando não acha.',
    onde: 'arquivo',
    texto: [
      'automação baixar',
      '  id: baixar',
      '  nome: Baixar de link',
      '  tipo: comando',
      '  dispara com: /baixar',
      '  acessa: texto',
      '  casa: exato ou com argumentos',
      '  precisa de um link: na mensagem ou na citada',
      '  sem ele: "Manda o link junto com o comando, ou responde a mensagem que tem o link."',
      '',
      '  baixa "{{precisa.link}}"',
      '    modo: automático',
      '    entrega: carrossel',
      '    avisa: "⬇️ Baixando…"',
      '    erro: "Não consegui baixar: {{erro}}"'
    ].join('\n')
  },
  {
    chave: 'figurinha-de-midia',
    rotulo: 'Chamar um serviço com a foto que chegou',
    quando: 'A linha "a mídia" é o que entrega o arquivo à função sem o texto do comando nunca ver os bytes.',
    onde: 'corpo',
    texto: [
      'chama imagem.figurinha',
      '  com',
      '    arquivo: a mídia',
      '    pacote: "Meu pacote"',
      '  avisa: "🎨 Convertendo…"',
      '  erro: "Não consegui fazer a figurinha: {{erro}}"'
    ].join('\n')
  },
  {
    chave: 'duas-fotos',
    rotulo: 'Chamar um serviço com duas fotos',
    quando: 'Quando a função recebe duas: a respondida é o assunto, a anexada é o acessório.',
    onde: 'corpo',
    texto: [
      'chama imagem.trocar_fundo',
      '  com',
      '    arquivo: a mídia citada',
      '    fundo: a mídia anexada',
      '  avisa: "🖼️ Trocando o fundo…"',
      '  erro: "Não consegui trocar o fundo: {{erro}}"'
    ].join('\n')
  },
  {
    chave: 'se-com-contador',
    rotulo: 'Contar e agir no limite',
    quando: 'Uma automação tem UMA condição, no fim do que vem antes dela. Os dois ramos são as linhas indentadas.',
    onde: 'corpo',
    texto: [
      'soma member avisos = 1',
      'se var member avisos >= 3',
      '  remove do grupo',
      '    quem: quem enviou',
      '    nunca o dono: sim',
      'senão',
      '  responde "aviso {{var.member.avisos}} de 3"'
    ].join('\n')
  },
  {
    chave: 'configuravel',
    rotulo: 'Formulário de instalação, com os quatro tipos',
    quando: 'Quem escreve declara; quem instala preenche pelo painel. O valor entra onde estiver {{params.chave}}.',
    onde: 'blocos',
    texto: [
      'configurável',
      '  command: texto = "/oi"',
      '    rótulo: Comando',
      '    ajuda: A palavra que a pessoa digita.',
      '  modo: opção (transparente, quadrado) = "transparente"',
      '    rótulo: Como encaixar',
      '    ajuda: O que vale quando ninguém escolhe.',
      '  pesoMaximoBytes: número = 1048576',
      '    rótulo: Peso máximo (bytes)',
      '    ajuda: 1048576 é 1 MB, o que o WhatsApp costuma aceitar.',
      '  removerFundo: liga/desliga = não',
      '    rótulo: Remover o fundo',
      '    ajuda: Leva alguns segundos a mais.'
    ].join('\n')
  },
  {
    chave: 'declara',
    rotulo: 'Guardar um valor entre mensagens',
    quando: 'Contador por pessoa, por conversa ou por grupo. As linhas embaixo são a descrição.',
    onde: 'blocos',
    texto: [
      'declara',
      '  member avisos: número',
      '    Quantos avisos esta pessoa já levou neste grupo.'
    ].join('\n')
  },
  {
    chave: 'avisa',
    rotulo: 'Recado na hora de instalar',
    quando: '"exige" é o que precisa estar configurado antes; "nota" é o detalhe que evita uma surpresa.',
    onde: 'blocos',
    texto: [
      'avisa exige',
      '  Exige o serviço de imagem configurado na aba Conexões, com o endereço e a chave.'
    ].join('\n')
  }
])

// Os moldes que fecham um trecho parcial num arquivo que compila. Ficam aqui,
// e não no teste, porque é a referência que sabe o que cada `onde` significa —
// e porque o painel usa o mesmo molde para conferir um trecho antes de inserir.
const MOLDE_DE_CORPO = [
  'automação exemplo',
  '  id: exemplo',
  '  tipo: comando',
  '  dispara com: /exemplo',
  '  acessa: texto, foto',
  '  casa: exato ou com argumentos',
  '',
  '···'
].join('\n')

const MOLDE_DE_BLOCOS = [
  'template exemplo v1',
  '  nome: Exemplo',
  '  categoria: utilitarios',
  '',
  'automação exemplo',
  '  id: exemplo',
  '  tipo: comando',
  '  dispara com: /exemplo',
  '  acessa: texto',
  '  casa: exato',
  '',
  '  responde "oi"',
  '',
  '···'
].join('\n')

// Indenta um trecho de corpo para o nível 1, que é onde uma ação vive.
function indentar (texto, niveis) {
  const espacos = '  '.repeat(niveis)
  return texto.split('\n').map((l) => (l === '' ? l : espacos + l)).join('\n')
}

// O trecho como arquivo inteiro, pronto para passar por `compilar()`.
export function trechoCompilavel (trecho) {
  if (trecho.onde === 'arquivo') return trecho.texto
  if (trecho.onde === 'corpo') return MOLDE_DE_CORPO.replace('···', indentar(trecho.texto, 1))
  if (trecho.onde === 'blocos') return MOLDE_DE_BLOCOS.replace('···', trecho.texto)
  throw new Error(`trecho "${trecho.chave}": não sei montar "${trecho.onde}"`)
}

// --- o exemplo de uma chamada --------------------------------------------
//
// Gerado a partir da tabela da ação `chama`, e não escrito à mão: a palavra, o
// formato do alvo, o nome do bloco de entradas e as palavras de arquivo saem
// todos de `ACOES`. Escrito à mão, o trecho que o painel oferece poderia
// divergir do que o compilador aceita — e o trecho que não compila é pior do
// que nenhum, porque a pessoa confia nele.
//
// `funcao` chega como DADO (nome e entradas), não importado: quem conhece as
// conexões é o motor, e esta camada não pode depender dele.
export function exemploDeChamada ({ conexao, funcao }) {
  const chama = ACOES.find((a) => a.palavra === 'chama')
  const palavrasDeArquivo = (chama.arquivos || []).map((a) => a.palavra)
  // "a mídia" sem dizer de onde: a da mensagem e, se não houver, a da citada.
  // É o que quase todo comando quer, então é o que o exemplo usa — a escolha
  // entre citada e anexada só importa quando a função recebe duas.
  const semOrigem = palavrasDeArquivo[0]
  const comOrigem = palavrasDeArquivo.slice(1, 3)

  const linhas = [`${chama.palavra} ${conexao}.${funcao.nome}`]
  // SÓ AS OBRIGATÓRIAS no exemplo. A função de figurinha declara dezessete
  // entradas e exige uma: despejar as dezessete produz um trecho que ninguém
  // lê e que parece exigir tudo. As opcionais não desaparecem — o catálogo
  // lista todas, com tipo, escolhas e padrão, ao lado do exemplo. O exemplo é
  // o mínimo que já funciona, não o inventário.
  const entradas = (funcao.entradas || []).filter((e) => e.obrigatoria !== false)
  if (entradas.length) {
    linhas.push(`  ${chama.mapa.bloco}`)
    let arquivosVistos = 0
    for (const e of entradas) {
      if (e.recebeArquivo) {
        // Duas entradas de arquivo precisam de origens DIFERENTES, senão as
        // duas apontam para o mesmo arquivo e a função recebe o acessório no
        // lugar do assunto.
        const temDuas = entradas.filter((x) => x.recebeArquivo).length > 1
        const palavra = temDuas ? comOrigem[arquivosVistos] || semOrigem : semOrigem
        arquivosVistos++
        linhas.push(`    ${e.nome}: ${palavra}`)
      } else {
        linhas.push(`    ${e.comoEscrever}`)
      }
    }
  }
  // Os campos da ação que todo comando quer: o aviso da espera e o texto de
  // falha. Os rótulos vêm da tabela, pela chave, para não haver "erro:" aqui e
  // outra palavra no compilador.
  const rotulo = (chaveDoCampo) => chama.campos.find((c) => c.chave === chaveDoCampo)?.rotulo
  linhas.push(`  ${rotulo('ackText')}: "⏳ Um instante…"`)
  linhas.push(`  ${rotulo('errorText')}: "Não consegui: {{erro}}"`)
  return linhas.join('\n')
}

// --- a junção -------------------------------------------------------------

// Acha a prosa de um campo de gatilho pela chave do DOCUMENTO. Os dois gatilhos
// descrevem campos de mesmo nome (`allowFrom` em comando e em vigia), então a
// classe desempata; sem classe, vale o primeiro que descrever.
function prosaDoCampoDeGatilho (prosa, doc, vale) {
  const gatilhos = prosa?.GATILHOS || []
  const daClasse = gatilhos.filter((g) => {
    if (vale === 'ambos' || !vale) return true
    return CLASSES[g.tipo] === vale
  })
  for (const g of [...daClasse, ...gatilhos]) {
    const achado = (g.campos || []).find((c) => c.chave === doc)
    if (achado) return achado
  }
  return null
}

function juntarCampoDoCabecalho (campo, prosa) {
  const encontrada = campo.doc ? prosaDoCampoDeGatilho(prosa, campo.doc, campo.vale) : null
  return Object.freeze({
    chave: campo.chave,
    vale: campo.vale,
    obrigatorio: campo.obrigatorio ?? false,
    repetivel: campo.repetivel ?? false,
    depende: campo.depende ?? null,
    palavras: campo.palavras ? Object.values(campo.palavras) : null,
    rotulo: encontrada?.rotulo ?? null,
    // A prosa do glossário tem precedência: é onde ela já estava sendo mantida.
    // `ajuda` local só existe nos campos que nunca tiveram descrição.
    ajuda: encontrada?.ajuda ?? campo.ajuda ?? null
  })
}

function juntarAcao (acao, prosa) {
  const descrita = (prosa?.ACOES || []).find((a) => a.tipo === acao.tipo) || null
  const campos = (acao.campos || []).map((c) => {
    const prosaDoCampo = (descrita?.campos || []).find((p) => p.chave === c.chave) || null
    return Object.freeze({
      // Como o campo APARECE no texto: o primeiro inline vai na mesma linha da
      // palavra; o resto é linha indentada "rótulo: valor".
      escrita: c.inline ? 'na mesma linha' : `${c.rotulo || c.chave}:`,
      chave: c.chave,
      palavras: c.palavras ? Object.values(c.palavras) : null,
      rotulo: prosaDoCampo?.rotulo ?? null,
      ajuda: prosaDoCampo?.ajuda ?? null
    })
  })
  return Object.freeze({
    palavra: acao.palavra,
    tipo: acao.tipo,
    familia: descrita?.familia ?? null,
    rotulo: descrita?.rotulo ?? null,
    resumo: descrita?.resumo ?? null,
    exemplo: descrita?.exemplo ?? null,
    ressalva: descrita?.ressalva ?? null,
    // Só `chama` tem isto: o alvo "conexão.função" e as palavras de arquivo.
    alvo: acao.alvo ? Object.freeze({ forma: 'conexão.função' }) : null,
    blocoDeEntradas: acao.mapa?.bloco ?? null,
    arquivos: acao.arquivos ? acao.arquivos.map((a) => a.palavra) : null,
    campos
  })
}

// As listas de palavras, já achatadas. É o que o realce do editor consome: ele
// não deve conhecer a forma das tabelas, só receber as palavras que existem —
// qualquer outra coisa seria a quarta cópia do vocabulário.
function palavrasParaRealce () {
  const enums = [
    CLASSES, CASAMENTOS, ORIGENS, TIPOS_DE_MENSAGEM, EXIGENCIAS, ONDE_PROCURAR,
    DESTINOS, TIPOS_DE_CONFIG, TIPOS_DE_VALOR, NIVEIS_DE_AVISO
  ]
  return Object.freeze({
    blocos: Object.freeze(['template', 'automação', 'configurável', 'declara', 'avisa']),
    campos: Object.freeze([
      ...CAMPOS_DO_CABECALHO.map((c) => c.chave),
      ...CAMPOS_DO_TEMPLATE.map((c) => c.chave),
      ...BLOCOS_DE_TEMPLATE.flatMap((b) => (b.filhos || []).map((f) => f.chave)),
      // Os rótulos dos campos das ações: "legenda", "avisa", "erro", "modo"…
      ...ACOES.flatMap((a) => (a.campos || []).map((c) => c.rotulo || c.chave))
    ].filter((v, i, todas) => todas.indexOf(v) === i)),
    marcas: Object.freeze(MARCAS_DO_CABECALHO.map((m) => m.chave)),
    acoes: Object.freeze(ACOES.map((a) => a.palavra)),
    // `se`, `senão` e `com` ABREM A LINHA, e só valem ali.
    estrutura: Object.freeze(['se', 'senão', 'com']),
    // `var` e `evento` abrem o operando DENTRO do `se`, no meio da linha —
    // por isso são um grupo separado. Juntá-los ao de cima faria a palavra
    // "com" acender no meio de um texto livre ("baixa com legenda"), que é
    // texto da pessoa e não palavra da linguagem.
    operandos: Object.freeze(Object.values(PALAVRAS_DE_OPERANDO)),
    arquivos: Object.freeze(
      ACOES.flatMap((a) => (a.arquivos || []).map((f) => f.palavra))
        .filter((v, i, todas) => todas.indexOf(v) === i)
    ),
    operadores: Object.freeze(Object.values(OPERADORES)),
    valores: Object.freeze(
      enums.flatMap((e) => Object.values(e)).filter((v, i, todas) => todas.indexOf(v) === i)
    )
  })
}

/**
 * A referência inteira, num objeto só.
 *
 * @param {object} opcoes
 * @param {object} [opcoes.prosa] O glossário do painel. Sem ele, a referência
 *   sai com as palavras e sem as explicações — que é o certo quando o painel
 *   não está por perto (gerar documento, por exemplo), e nunca um erro.
 */
export function montarReferencia ({ prosa = null } = {}) {
  return Object.freeze({
    cabecalho: Object.freeze(CAMPOS_DO_CABECALHO.map((c) => juntarCampoDoCabecalho(c, prosa))),
    marcas: Object.freeze(MARCAS_DO_CABECALHO.map((m) => juntarCampoDoCabecalho(m, prosa))),
    template: Object.freeze(CAMPOS_DO_TEMPLATE.map((c) => Object.freeze({
      chave: c.chave, repetivel: c.repetivel ?? false, ajuda: c.ajuda ?? null
    }))),
    blocos: Object.freeze(BLOCOS_DE_TEMPLATE.map((b) => Object.freeze({
      bloco: b.bloco,
      forma: b.forma,
      palavras: b.palavras ? Object.values(b.palavras) : null,
      ajuda: b.ajuda ?? null,
      filhos: Object.freeze((b.filhos || []).map((f) => Object.freeze({ chave: f.chave, ajuda: f.ajuda })))
    }))),
    acoes: Object.freeze(ACOES.map((a) => juntarAcao(a, prosa))),
    condicao: Object.freeze({
      forma: 'se <o que> <operador> <o que>',
      operadores: Object.freeze(Object.values(OPERADORES)),
      origens: Object.freeze((prosa?.ORIGENS_DE_OPERANDO || []).map((o) => Object.freeze({ ...o })))
    }),
    enums: Object.freeze({
      classes: Object.freeze(Object.values(CLASSES)),
      casamentos: Object.freeze(Object.values(CASAMENTOS)),
      origens: Object.freeze(Object.values(ORIGENS)),
      tiposDeMensagem: Object.freeze(Object.values(TIPOS_DE_MENSAGEM)),
      exigencias: Object.freeze(Object.values(EXIGENCIAS)),
      ondeProcurar: Object.freeze(Object.values(ONDE_PROCURAR)),
      destinos: Object.freeze(Object.values(DESTINOS)),
      tiposDeConfig: Object.freeze(Object.values(TIPOS_DE_CONFIG)),
      tiposDeValor: Object.freeze(Object.values(TIPOS_DE_VALOR)),
      niveisDeAviso: Object.freeze(Object.values(NIVEIS_DE_AVISO))
    }),
    trechos: TRECHOS,
    palavras: palavrasParaRealce()
  })
}
