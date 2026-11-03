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
  ACOES, ACOES_DE_GRUPO, BLOCOS_DE_TEMPLATE, CAMPOS_DO_CABECALHO, CAMPOS_DO_TEMPLATE, CASAMENTOS, CLASSES,
  DESTINOS, EXIGENCIAS, MARCAS_DO_CABECALHO, NIVEIS_DE_AVISO, ONDE_PROCURAR, OPERADORES,
  ORIGENS, PALAVRAS_DE_OPERANDO, PRIORIDADES, RECUSAS_SEM_VAGA, TIPOS_DE_CONFIG, TIPOS_DE_MENSAGEM, TIPOS_DE_VALOR,
  BLOCOS_DE_CONDICAO, PROFUNDIDADE_CONDICOES_PADRAO
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
    chave: 'calcular-total',
    rotulo: 'Calcular com duas variáveis',
    quando: 'O resultado local serve à resposta e às próximas ações sem gravar uma variável de usuário.',
    onde: 'corpo',
    texto: [
      'calcula local total = var chat preco * var chat quantidade',
      'calcula local metade = evento local.total / 2',
      'responde "Total: {{local.total}}; metade: {{local.metade}}"'
    ].join('\n')
  },
  {
    chave: 'lista-numerada',
    rotulo: 'Numerar uma lista montada pelo comando',
    quando: 'Cada linha não vazia recebe o próximo número depois da substituição das variáveis.',
    onde: 'corpo',
    texto: 'responde "{{var.chat.resultados}}"\n  numeração: sim'
  },
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
      '  quem: qualquer um',
      '',
      '  responde "pacote: {{argumentos.pacote}} · autor: {{argumentos.autor}}"'
    ].join('\n')
  },
  {
    chave: 'porteiro-remover-intruso',
    rotulo: 'Porteiro: remover quem não está na lista',
    quando: 'Dispara quando alguém entra no grupo e remove quem não tiver autorização.',
    onde: 'arquivo',
    texto: [
      'automação porteiro',
      '  id: porteiro',
      '  nome: Porteiro',
      '  tipo: porteiro',
      '  quando for: entrou',
      '  pool: pool-local',
      '',
      '  se var target_group_member autorizado != "sim"',
      '    remove do grupo',
      '      quem: quem foi marcado',
      '      nunca o dono: sim'
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
      '  quem: qualquer um',
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
    quando: 'Cada ramo fica dois espaços adentro. Pode haver outros se dentro dos ramos ou depois deles; pelo menos um ramo precisa ter ação.',
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
  '  quem: qualquer um',
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
  '  quem: qualquer um',
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
    return Array.isArray(vale) ? vale.includes(CLASSES[g.tipo]) : CLASSES[g.tipo] === vale
  })
  for (const g of [...daClasse, ...gatilhos]) {
    const achado = (g.campos || []).find((c) => c.chave === doc)
    if (achado) return achado
  }
  return null
}

// `doc` é a chave do DOCUMENTO, e pode depender da classe: `quando for` escreve
// `messageKinds` num vigia e `actions` num porteiro. Uma string vale para todas as
// classes do campo; um objeto diz a chave de cada uma.
// Exportada para a guarda: um teste que copiasse esta resolução estaria provando
// a cópia, não a derivação.
export function docDaClasse (campo, classe) {
  if (!campo.doc) return null
  return typeof campo.doc === 'string' ? campo.doc : (campo.doc[classe] ?? null)
}

// As palavras escritas que correspondem a um enum do schema. Devolve null se
// faltar palavra para algum valor: meia lista mentiria por omissão.
function palavrasDoEnum (palavras, valores) {
  if (!palavras || !Array.isArray(valores)) return null
  const escritas = valores.map((v) => palavras[v])
  return escritas.every(Boolean) ? escritas : null
}

// A prosa de UMA classe. Sem laço de reserva: quando a chave é por classe, aceitar a
// descrição de outra classe é exatamente o erro que se está consertando.
function prosaDaClasse (prosa, doc, classe) {
  const gatilhos = prosa?.GATILHOS || []
  for (const g of gatilhos) {
    if (CLASSES[g.tipo] !== classe) continue
    const achado = (g.campos || []).find((c) => c.chave === doc)
    if (achado) return achado
  }
  return null
}

// A reversa de CLASSES: do nome escrito no cabeçalho para o tipo de gatilho do schema.
export const GATILHO_DA_CLASSE = Object.freeze(
  Object.fromEntries(Object.entries(CLASSES).map(([tipo, classe]) => [classe, tipo]))
)

function classesDoCampo (vale) {
  if (!vale || vale === 'ambos' || vale === 'todos') return Object.keys(GATILHO_DA_CLASSE)
  return (Array.isArray(vale) ? vale : [vale]).filter((c) => GATILHO_DA_CLASSE[c])
}

// Um campo do cabeçalho vale em uma ou mais CLASSES, e cada classe tem a sua definição
// de gatilho no schema. Vale aqui a mesma regra de `juntarAcao`: tipo, obrigatoriedade,
// valores aceitos, padrão e limites saem do schema que a instalação usa, nunca de uma
// lista escrita à mão — senão a ajuda promete o que o 422 recusa.
// Onde as definições DIVERGEM eu não escolho uma: `allowFrom` é exigido no comando e no
// vigia, mas só o vigia declara padrão, e prometer "external" para comando seria
// prometer o que a instalação não garante.
function doSchemaDoCabecalho (campo, prosa, schema) {
  if (!campo.doc || !schema || typeof prosa?.acharDefinicao !== 'function') return null
  const classes = classesDoCampo(campo.vale)
  const achados = []
  for (const classe of classes) {
    const doc = docDaClasse(campo, classe)
    if (!doc) continue
    const definicao = prosa.acharDefinicao(schema, GATILHO_DA_CLASSE[classe])
    const doCampo = definicao ? prosa.campoDoSchema(definicao, doc) : null
    if (doCampo) achados.push({ classe, doc, ...doCampo })
  }
  if (!achados.length) return null
  const concordam = (ler) => {
    const primeiro = JSON.stringify(ler(achados[0]) ?? null)
    if (!achados.every((a) => JSON.stringify(ler(a) ?? null) === primeiro)) return null
    return ler(achados[0]) ?? null
  }
  // Obrigatoriedade não é média nem maioria: o campo é obrigatório nas classes onde o
  // schema o exige. Exigido em todas as classes em que vale -> `true`; só em algumas ->
  // o nome delas, que é o vocabulário que a tela de referência já desenha.
  const exigem = achados.filter((a) => a.obrigatorio).map((a) => a.classe)
  let obrigatorio = false
  if (exigem.length === classes.length) obrigatorio = true
  else if (exigem.length === 1) obrigatorio = exigem[0]
  else if (exigem.length) obrigatorio = exigem
  return {
    obrigatorio,
    tipo: concordam((a) => a.tipo),
    valoresAceitos: concordam((a) => a.valores),
    padrao: concordam((a) => a.padrao),
    limites: concordam((a) => a.limites),
    explicacaoTecnica: concordam((a) => a.descricaoDoSchema),
    // Onde as classes DIVERGEM, `concordam` devolve null — e null sozinho esconde a
    // resposta em vez de dar. `porClasse` é a resposta inteira: a lista de valores que
    // cada classe aceita, com a prosa daquela classe, derivada do mesmo schema.
    porClasse: achados.map((a) => {
      const prosaDela = prosaDaClasse(prosa, a.doc, a.classe)
      return Object.freeze({
        classe: a.classe,
        campoDoDocumento: a.doc,
        obrigatorio: a.obrigatorio,
        tipo: a.tipo,
        valoresAceitos: a.valores ?? null,
        padrao: a.padrao ?? null,
        limites: a.limites ?? null,
        explicacaoTecnica: a.descricaoDoSchema ?? null,
        // O enum do schema está em inglês; o que se ESCREVE na linha é a palavra
        // em português. O mapa `palavras` do campo cobre as duas classes juntas,
        // então aqui ele é filtrado pelo enum DAQUELA classe: é essa a lista que
        // a pessoa pode digitar num vigia, e a outra num porteiro.
        palavras: palavrasDoEnum(campo.palavras, a.valores),
        rotulo: prosaDela?.rotulo ?? null,
        ajuda: prosaDela?.ajuda ?? null
      })
    })
  }
}

function juntarCampoDoCabecalho (campo, prosa, schema) {
  const docUnico = typeof campo.doc === 'string' ? campo.doc : null
  const encontrada = docUnico ? prosaDoCampoDeGatilho(prosa, docUnico, campo.vale) : null
  const doSchema = doSchemaDoCabecalho(campo, prosa, schema)
  return Object.freeze({
    chave: campo.chave,
    vale: campo.vale,
    obrigatorio: doSchema ? doSchema.obrigatorio : (campo.obrigatorio ?? false),
    tipo: doSchema?.tipo ?? null,
    valoresAceitos: doSchema?.valoresAceitos ?? null,
    padrao: doSchema?.padrao ?? null,
    limites: doSchema?.limites ?? null,
    explicacaoTecnica: doSchema?.explicacaoTecnica ?? null,
    // Só os campos cuja chave do documento depende da classe trazem o detalhe por
    // classe; nos outros a lista acima já é a resposta inteira.
    porClasse: doSchema?.porClasse?.length > 1 && typeof campo.doc !== 'string'
      ? doSchema.porClasse
      : null,
    repetivel: campo.repetivel ?? false,
    depende: campo.depende ?? null,
    palavras: campo.palavras ? Object.values(campo.palavras) : null,
    rotulo: encontrada?.rotulo ?? null,
    // A prosa do glossário tem precedência: é onde ela já estava sendo mantida.
    // `ajuda` local só existe nos campos que nunca tiveram descrição.
    ajuda: encontrada?.ajuda ?? campo.ajuda ?? null
  })
}

function juntarAcao (acao, prosa, schema) {
  const descrita = (prosa?.ACOES || []).find((a) => a.tipo === acao.tipo) || null
  // A definição desta ação DENTRO do JSON Schema — a mesma que o Ajv usa na
  // instalação. É daqui que saem tipo, obrigatoriedade, valores aceitos,
  // padrão e limites de cada campo: a ajuda não redeclara nenhum dos cinco,
  // senão ela promete o que a instalação recusa com 422.
  //
  // A ponte (`acharDefinicao`/`campoDoSchema`) mora no glossário porque o
  // navegador também precisa dela, e por isso chega aqui pelo mesmo `prosa`
  // injetado — nada novo é importado, e `src/lcn` continua sem depender de
  // `src/web`. Sem schema, ou sem glossário, cada um destes sai `null`, que é
  // o certo quando a referência é montada fora do painel.
  const definicao = (schema && prosa?.acharDefinicao) ? prosa.acharDefinicao(schema, acao.tipo) : null
  const campos = (acao.campos || []).map((c) => {
    const prosaDoCampo = (descrita?.campos || []).find((p) => p.chave === c.chave) || null
    const doSchema = (definicao && prosa?.campoDoSchema) ? prosa.campoDoSchema(definicao, c.chave) : null
    return Object.freeze({
      // Como o campo APARECE no texto: o primeiro inline vai na mesma linha da
      // palavra; o resto é linha indentada "rótulo: valor".
      escrita: c.inline ? 'na mesma linha' : `${c.rotulo || c.chave}:`,
      chave: c.chave,
      palavras: c.palavras ? Object.values(c.palavras) : null,
      rotulo: prosaDoCampo?.rotulo ?? null,
      ajuda: prosaDoCampo?.ajuda ?? null,
      tipo: doSchema?.tipo ?? null,
      obrigatorio: doSchema?.obrigatorio ?? null,
      valoresAceitos: doSchema?.valores ?? null,
      padrao: doSchema?.padrao ?? null,
      limites: doSchema?.limites ?? null,
      // A explicação técnica do campo escrita NO schema. Quando existe, ela é
      // a que vale: está ao lado da regra que valida.
      explicacaoTecnica: doSchema?.descricaoDoSchema ?? null
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
    // O que esta ação PRECISA ter antes de rodar, o que ela DEVOLVE e o que
    // mais dá errado com ela. Os três são prosa, e prosa só se escreve num
    // lugar: o glossário. Não há campo no schema que diga "o bot tem de ser
    // admin do grupo" — validação estrutural não garante condição operacional.
    dependencias: descrita?.dependencias ?? null,
    resultado: descrita?.resultado ?? null,
    errosComuns: descrita?.errosComuns ?? null,
    // A lista exata que o schema EXIGE, no nível da ação. Serve para a ajuda
    // listar o que falta sem percorrer campo por campo.
    obrigatorios: definicao?.properties?.config?.required
      ? Object.freeze([...definicao.properties.config.required])
      : null,
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
    CLASSES, CASAMENTOS, ORIGENS, TIPOS_DE_MENSAGEM, ACOES_DE_GRUPO, EXIGENCIAS, ONDE_PROCURAR,
    DESTINOS, TIPOS_DE_CONFIG, TIPOS_DE_VALOR, NIVEIS_DE_AVISO, PRIORIDADES, RECUSAS_SEM_VAGA
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
    estrutura: Object.freeze([...Object.values(BLOCOS_DE_CONDICAO), 'com']),
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
 * @param {object} [opcoes.schema] O JSON Schema do documento de automação, o
 *   mesmo que o motor valida na instalação. Entra INJETADO pela mesma razão do
 *   glossário: ele vive em `src/engine`, e importá-lo aqui faria a linguagem
 *   depender do motor. Com ele, cada campo de cada ação sai com tipo,
 *   obrigatoriedade, valores aceitos, padrão e limites derivados da fonte que
 *   recusa o documento — nunca de uma segunda lista escrita à mão.
 */
export function montarReferencia ({ prosa = null, schema = null } = {}) {
  return Object.freeze({
    cabecalho: Object.freeze(CAMPOS_DO_CABECALHO.map((c) => juntarCampoDoCabecalho(c, prosa, schema))),
    marcas: Object.freeze(MARCAS_DO_CABECALHO.map((m) => juntarCampoDoCabecalho(m, prosa, schema))),
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
    acoes: Object.freeze(ACOES.map((a) => juntarAcao(a, prosa, schema))),
    condicao: Object.freeze({
      forma: 'se <o que> <operador> <o que>',
      ajuda: `Use dois espaços por nível. Condições no mesmo nível executam em sequência; condições dentro de um ramo só executam quando ele é escolhido. "senão se" testa outra condição no ramo falso. Um ramo pode ficar vazio, mas pelo menos um precisa ter ação. O limite padrão é ${PROFUNDIDADE_CONDICOES_PADRAO} condições aninhadas (cada "senão se" conta mais um nível), ajustável por LCN_MAX_PROFUNDIDADE_CONDICOES ou pela opção maxProfundidade do compilador.`,
      operadores: Object.freeze(Object.values(OPERADORES)),
      origens: Object.freeze((prosa?.ORIGENS_DE_OPERANDO || []).map((o) => Object.freeze({ ...o })))
    }),
    enums: Object.freeze({
      classes: Object.freeze(Object.values(CLASSES)),
      casamentos: Object.freeze(Object.values(CASAMENTOS)),
      origens: Object.freeze(Object.values(ORIGENS)),
      tiposDeMensagem: Object.freeze(Object.values(TIPOS_DE_MENSAGEM)),
      acoesDeGrupo: Object.freeze(Object.values(ACOES_DE_GRUPO)),
      exigencias: Object.freeze(Object.values(EXIGENCIAS)),
      ondeProcurar: Object.freeze(Object.values(ONDE_PROCURAR)),
      destinos: Object.freeze(Object.values(DESTINOS)),
      tiposDeConfig: Object.freeze(Object.values(TIPOS_DE_CONFIG)),
      tiposDeValor: Object.freeze(Object.values(TIPOS_DE_VALOR)),
      niveisDeAviso: Object.freeze(Object.values(NIVEIS_DE_AVISO)),
      prioridades: Object.freeze(Object.values(PRIORIDADES)),
      recusasSemVaga: Object.freeze(Object.values(RECUSAS_SEM_VAGA))
    }),
    trechos: TRECHOS,
    palavras: palavrasParaRealce()
  })
}
