// O catálogo humano do que dá para montar num comando.
//
// Por que este arquivo existe: o motor executa 2 gatilhos, 11 ações e 1 condição
// com 8 operadores, e o painel não mostrava NENHUM deles. A única forma de um
// usuário descobrir que `action.whatsapp.sendFile` existe era abrir o JSON cru de
// um template — e nem lá aparecia, porque nenhum template a usava.
//
// A DIVISÃO DE RESPONSABILIDADE, que é o ponto do desenho:
//
//   runtimeCapabilities.js  diz O QUE EXISTE      (nomes técnicos, nada mais)
//   documentSchema          diz QUE CAMPOS ACEITA (tipos, enums, obrigatórios)
//   este arquivo            diz O QUE ISSO SIGNIFICA (rótulo, resumo, exemplo)
//
// Aqui NUNCA se redeclara tipo de campo. Tipo vem do schema, em tempo de
// execução, via `campoDoSchema()`. Duas cópias da mesma definição saem de
// sincronia — foi exatamente assim que a lista de variáveis do interpolador
// divergiu da lista da condição, e `{{sender.isAdmin}}` passou a existir num
// lugar e não no outro.
//
// Um teste cruza as chaves daqui com `runtimeCapabilities.js` NOS DOIS SENTIDOS:
// a tela não pode oferecer o que o publish rejeita, nem esconder ação nova.

export const FAMILIAS = Object.freeze({
  resposta: 'Responder',
  midia: 'Mídia',
  variavel: 'Variáveis e contadores',
  moderacao: 'Moderação',
  configuracao: 'Configuração pelo WhatsApp'
})

// --- GATILHOS: o que faz a automação começar ------------------------------

export const GATILHOS = Object.freeze([
  {
    tipo: 'trigger.command',
    rotulo: 'Quando alguém digita um comando',
    resumo: 'A automação começa quando a mensagem é (ou começa com) uma palavra que você escolhe.',
    exemplo: 'Alguém digita "/ping" e o bot responde.',
    campos: [
      { chave: 'command', rotulo: 'A palavra', ajuda: 'O que a pessoa digita. A barra não é obrigatória — "menu" funciona igual a "/menu".' },
      {
        chave: 'match',
        rotulo: 'Como comparar',
        ajuda: 'exato = a mensagem tem que ser só isso · começa com = aceita o que vier depois · palavra solta = acha em qualquer posição da frase · exato ou com argumento = igual, ou seguido de um espaço e mais texto (é o que permite "/adv fulano").'
      },
      { chave: 'allowFrom', rotulo: 'Quem pode acionar', ajuda: 'externo = o bot ignora as próprias mensagens (padrão seguro) · qualquer um = responde também quando VOCÊ manda do número onde o bot roda, que é o normal para comando de uso pessoal.' },
      { chave: 'requireOwner', rotulo: 'Só o dono', ajuda: 'Restringe ao dono do bot. Enquanto nenhum dono estiver cadastrado, só o próprio número do bot passa — é assim que se cadastra o primeiro.' }
    ]
  },
  {
    tipo: 'trigger.message',
    rotulo: 'Quando chega uma mensagem (sem comando)',
    resumo: 'A automação começa sozinha, olhando toda mensagem que chega. É o que faz um anti-link ou uma recuperação automática existirem.',
    exemplo: 'Chega uma mensagem com link e o bot apaga.',
    ressalva: {
      level: 'info',
      text: 'Três barreiras valem SEMPRE aqui e não têm como desligar: o bot nunca reage às próprias mensagens, nem a status/transmissão, nem a canal. Sem isso, dois bots se respondendo viram um laço infinito.'
    },
    campos: [
      { chave: 'messageKinds', rotulo: 'Só nestes tipos', ajuda: 'Deixe vazio para qualquer tipo. Marque para reagir só a foto, só a áudio, só a visualização única…' },
      { chave: 'containsLink', rotulo: 'Tem link?', ajuda: 'sim = só mensagens com link · não = só mensagens SEM link. O detector é fechado: não aceita expressão sua, e não marca "etc..." nem "3.5" como link.' },
      { chave: 'keywords', rotulo: 'Contém alguma destas palavras', ajuda: 'Dispara se o texto tiver qualquer uma delas, sem diferenciar maiúscula.' },
      { chave: 'allowFrom', rotulo: 'Quem pode acionar', ajuda: 'A barreira acima vale de qualquer jeito.' },
      { chave: 'requireOwner', rotulo: 'Só o dono', ajuda: 'Restringe ao dono do bot.' }
    ]
  }
])

// --- AÇÕES: o que a automação faz ------------------------------------------

export const ACOES = Object.freeze([
  {
    tipo: 'action.whatsapp.reply',
    rotulo: 'Responder com texto',
    familia: 'resposta',
    resumo: 'Manda uma mensagem de texto na mesma conversa. Aceita variáveis.',
    exemplo: '"{{now.greeting}}, {{sender.name}}! Você é admin? {{sender.isAdmin}}"',
    campos: [{ chave: 'text', rotulo: 'Texto', ajuda: 'Aceita qualquer variável do sistema. Uma variável que não existe aparece do jeito que está, de propósito — é o sinal de que algo está errado.' }]
  },
  {
    tipo: 'action.whatsapp.sendFile',
    rotulo: 'Enviar um arquivo do acervo',
    familia: 'midia',
    resumo: 'Manda uma imagem, áudio, vídeo, PDF ou texto que você guardou no Acervo. É como responder com foto de produto ou cardápio sem reenviar o arquivo toda vez.',
    exemplo: 'Alguém digita "/cardapio" e recebe o PDF que você subiu.',
    campos: [
      { chave: 'fileId', rotulo: 'Arquivo', ajuda: 'O identificador que aparece no cartão do arquivo na aba Acervo — tem um botão "Copiar id" lá.' },
      { chave: 'caption', rotulo: 'Legenda', ajuda: 'Texto que acompanha o arquivo. Aceita variáveis. Arquivo de texto é enviado como mensagem, então não leva legenda.' },
      { chave: 'notFoundText', rotulo: 'Se o arquivo sumiu', ajuda: 'Enviado quando o arquivo foi apagado do acervo depois de o comando ser publicado — melhor avisar que ficar mudo.' }
    ]
  },
  {
    tipo: 'action.whatsapp.sticker',
    rotulo: 'Transformar em figurinha',
    familia: 'midia',
    resumo: 'Pega a imagem ou vídeo da mensagem e devolve como figurinha. Funciona com a mídia enviada junto com o comando OU respondendo uma mídia já enviada.',
    exemplo: 'Mandar a foto com "/fig" escrito na legenda, ou responder uma foto com "/fig".',
    ressalva: { level: 'requirement', text: 'Precisa de ffmpeg instalado no computador onde o bot roda.' },
    campos: [{ chave: 'notFoundText', rotulo: 'Se não achar mídia', ajuda: 'Enviado quando o comando é usado sem imagem nem vídeo por perto.' }]
  },
  {
    tipo: 'action.whatsapp.recover',
    rotulo: 'Recuperar visualização única',
    familia: 'midia',
    resumo: 'Reenvia como mídia normal algo que foi mandado para ver uma vez só. Funciona respondendo a mídia, ou automaticamente quando ela chega.',
    exemplo: 'Responder uma visualização única com "/recover", ou deixar a conversa marcada para recuperar sozinho.',
    ressalva: { level: 'info', text: 'Só funciona com visualização única de verdade. Foto comum respondida não é recuperada — reenviar o que todo mundo ainda vê não é recuperar nada.' },
    campos: [
      { chave: 'destination', rotulo: 'Para onde mandar', ajuda: 'mesma conversa = entrega ali, à vista de quem está · mensagens salvas = só para você · configurado = usa a conversa que o comando de configuração gravou, e cai para mensagens salvas enquanto ninguém configurou · fixo = um endereço que você escreve.' },
      { chave: 'destinationId', rotulo: 'Endereço', ajuda: 'Aceita variável: escrever {{var.global.recover_destino}} faz o destino vir da tabela, e um comando de configuração pode trocar sem mexer no comando.' },
      { chave: 'caption', rotulo: 'Legenda', ajuda: 'Acompanha a mídia recuperada. {{media.kind}} diz se é foto, vídeo ou áudio.' },
      { chave: 'notFoundText', rotulo: 'Se não achar', ajuda: 'Enviado quando não há visualização única para recuperar.' }
    ]
  },
  {
    tipo: 'action.whatsapp.rich',
    rotulo: 'Responder com código colorido',
    familia: 'resposta',
    resumo: 'Manda texto formatado como bloco de código ou fórmula matemática.',
    exemplo: 'Responder um trecho de JavaScript com a cor certa.',
    ressalva: {
      level: 'unofficial',
      text: 'Depende de a mensagem viajar marcada como conteúdo da Meta AI. Não é documentado e pode parar de funcionar sem aviso — por isso a queda para texto comum é automática e obrigatória.'
    },
    campos: [
      { chave: 'text', rotulo: 'Conteúdo', ajuda: 'O código ou a fórmula.' },
      { chave: 'richKind', rotulo: 'Tipo', ajuda: 'código, fórmula (LaTeX) ou texto.' },
      { chave: 'language', rotulo: 'Linguagem', ajuda: 'Para colorir: javascript, python, sql…' },
      { chave: 'fallbackText', rotulo: 'Se não renderizar', ajuda: 'O que sai como texto comum quando o formato rico for recusado.' }
    ]
  },
  {
    tipo: 'action.variable.set',
    rotulo: 'Gravar uma variável',
    familia: 'variavel',
    resumo: 'Guarda um valor ligado a alguém, a uma conversa, a um grupo ou ao sistema todo. É o que marca um contato como VIP, ou guarda em que etapa de um atendimento a pessoa está.',
    exemplo: 'Gravar "vip" = sim em quem usou o comando.',
    campos: [
      { chave: 'scope', rotulo: 'De quem é o valor', ajuda: 'O escopo decide a quem aquele valor pertence — ver a lista de escopos abaixo. É estrutural: nunca coloque o nome do grupo dentro do nome da variável.' },
      { chave: 'categoryKey', rotulo: 'Qual categoria', ajuda: 'Só quando o escopo é "categoria".' },
      { chave: 'key', rotulo: 'Nome da variável', ajuda: 'Como você vai chamá-la depois em {{var....}}.' },
      { chave: 'value', rotulo: 'Valor', ajuda: 'Aceita variáveis — gravar {{message.args}} guarda o que a pessoa escreveu depois do comando, que é como um comando de configuração funciona.' }
    ]
  },
  {
    tipo: 'action.variable.increment',
    rotulo: 'Somar num contador',
    familia: 'variavel',
    resumo: 'Soma (ou subtrai) de um contador. A soma acontece dentro do banco, então duas mensagens no mesmo instante não viram uma.',
    exemplo: 'Somar 1 no contador de avisos daquela pessoa naquele grupo.',
    ressalva: { level: 'info', text: 'Contador que nunca existiu NÃO vale zero: uma condição "avisos maior ou igual a 0" não pode punir quem nunca fez nada.' },
    campos: [
      { chave: 'scope', rotulo: 'De quem é o contador', ajuda: 'Ver a lista de escopos abaixo.' },
      { chave: 'categoryKey', rotulo: 'Qual categoria', ajuda: 'Só quando o escopo é "categoria".' },
      { chave: 'key', rotulo: 'Nome do contador', ajuda: 'Como você vai lê-lo depois em {{var....}}.' },
      { chave: 'by', rotulo: 'Quanto somar', ajuda: 'Número inteiro. Negativo subtrai.' }
    ]
  },
  {
    tipo: 'action.whatsapp.delete',
    rotulo: 'Apagar a mensagem',
    familia: 'moderacao',
    resumo: 'Apaga para todos a mensagem que acionou a automação.',
    exemplo: 'Apagar a mensagem que tinha link.',
    ressalva: { level: 'requirement', text: 'Num grupo, o número precisa ser ADMINISTRADOR. Sem isso o WhatsApp recusa e a ação aparece como falha no histórico. Dá para conferir antes com {{bot.isAdmin}}.' },
    campos: []
  },
  {
    tipo: 'action.group.remove',
    rotulo: 'Remover do grupo',
    familia: 'moderacao',
    resumo: 'Tira alguém do grupo.',
    exemplo: 'Remover quem mandou link pela terceira vez.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. Confira antes com {{bot.isAdmin}} e avise, em vez de tentar e falhar na frente de todo mundo.' },
    campos: [
      { chave: 'who', rotulo: 'Quem remover', ajuda: 'quem enviou a mensagem, ou o alvo (o @mencionado, ou o autor da mensagem respondida).' },
      { chave: 'neverRemoveOwner', rotulo: 'Nunca remover um dono', ajuda: 'Ligado por padrão. Desligue só se você quiser de propósito uma regra que vale para todos, dono incluído.' }
    ]
  },
  {
    tipo: 'action.menu.render',
    rotulo: 'Mostrar o menu de comandos',
    familia: 'resposta',
    resumo: 'Lista os comandos que funcionam naquela conversa. Só aparecem os que têm rótulo de menu definido.',
    exemplo: 'Alguém digita "/menu" e recebe a lista.',
    ressalva: { level: 'compatibility', text: 'O formato com botões depende do aplicativo de quem recebe. Quando não renderiza, o menu cai para texto sozinho — então ele sempre chega de algum jeito.' },
    campos: [
      { chave: 'format', rotulo: 'Formato', ajuda: 'lista de texto, ou mensagem com botões.' },
      { chave: 'header', rotulo: 'Cabeçalho', ajuda: 'A frase que abre o menu.' },
      { chave: 'footer', rotulo: 'Rodapé', ajuda: 'Texto ao final.' },
      { chave: 'emptyText', rotulo: 'Se não houver comando', ajuda: 'O que responder quando nenhum comando vale naquela conversa.' },
      { chave: 'buttonTitle', rotulo: 'Título do botão', ajuda: 'Só no formato com botões.' }
    ]
  },
  {
    tipo: 'action.menu.config',
    rotulo: 'Configurar o menu pelo WhatsApp',
    familia: 'configuracao',
    resumo: 'Muda o texto do menu daquela conversa sem abrir o painel. O valor novo é o que a pessoa escreveu depois do comando.',
    exemplo: '"/configmenu Comandos da loja:" troca o cabeçalho só daquele grupo.',
    campos: [
      { chave: 'field', rotulo: 'O que mudar', ajuda: 'cabeçalho, rodapé, texto de menu vazio, título do botão ou formato.' },
      { chave: 'usageText', rotulo: 'Se vier sem texto', ajuda: 'Explica como usar quando alguém manda o comando sozinho.' },
      { chave: 'confirmText', rotulo: 'Confirmação', ajuda: 'Resposta depois de gravar.' }
    ]
  }
])

// --- CONDIÇÃO: o que faz o comando ter dois caminhos ----------------------

export const CONDICOES = Object.freeze([
  {
    tipo: 'condition.compare',
    rotulo: 'Se… senão',
    resumo: 'Compara dois valores e separa o comando em dois caminhos. É o único nó que bifurca.',
    exemplo: 'Se os avisos daquela pessoa chegaram a 3, remover; senão, avisar.',
    ressalva: { level: 'info', text: 'A comparação é por valor, não por texto: 10 é maior que 3. Se qualquer lado de uma comparação numérica não for número, o resultado é falso.' },
    campos: [
      { chave: 'left', rotulo: 'Valor da esquerda', ajuda: 'Pode ser um valor fixo, uma variável sua, ou um campo do evento.' },
      { chave: 'operator', rotulo: 'Comparação', ajuda: 'Ver a lista de comparações abaixo.' },
      { chave: 'right', rotulo: 'Valor da direita', ajuda: 'Mesmas três origens.' }
    ]
  }
])

export const ORIGENS_DE_OPERANDO = Object.freeze([
  { id: 'literal', rotulo: 'Um valor fixo', ajuda: 'Você escreve: um número, um texto, sim/não.' },
  { id: 'variable', rotulo: 'Uma variável sua', ajuda: 'As que você cria — escolhendo o escopo e o nome.' },
  { id: 'event', rotulo: 'Um dado da mensagem', ajuda: 'O mesmo caminho que você escreveria entre chaves, sem as chaves: sender.isAdmin, chat.kind, now.hour, media.kind…' }
])

export const OPERADORES = Object.freeze([
  { id: 'eq', rotulo: 'é igual a', ajuda: 'Dois números comparam como número; o resto, como texto.' },
  { id: 'neq', rotulo: 'é diferente de', ajuda: '' },
  { id: 'gt', rotulo: 'é maior que', ajuda: 'Só entre números.' },
  { id: 'gte', rotulo: 'é maior ou igual a', ajuda: 'Só entre números.' },
  { id: 'lt', rotulo: 'é menor que', ajuda: 'Só entre números.' },
  { id: 'lte', rotulo: 'é menor ou igual a', ajuda: 'Só entre números.' },
  { id: 'contains', rotulo: 'contém', ajuda: 'Como texto, sem diferenciar maiúscula.' },
  { id: 'not_contains', rotulo: 'não contém', ajuda: 'Como texto, sem diferenciar maiúscula.' }
])

// --- ESCOPOS: de quem é aquele valor --------------------------------------

export const ESCOPOS = Object.freeze([
  { id: 'chat', rotulo: 'Desta conversa', ajuda: 'No privado é do contato; no grupo é do grupo inteiro.', usoNoTexto: '{{var.chat.<chave>}}' },
  { id: 'sender', rotulo: 'De quem enviou', ajuda: 'Vale em qualquer conversa onde essa pessoa apareça.', usoNoTexto: '{{var.sender.<chave>}}' },
  { id: 'group', rotulo: 'Do grupo', ajuda: 'Do grupo como um todo, independente de quem falou.', usoNoTexto: '{{var.chat.<chave>}}' },
  { id: 'group_member', rotulo: 'De quem enviou, NESTE grupo', ajuda: 'É o que serve para punição: 3 avisos no grupo A não somam com os do grupo B.', usoNoTexto: '{{var.member.<chave>}}' },
  { id: 'target', rotulo: 'De quem o comando mira', ajuda: 'O @mencionado, ou o autor da mensagem respondida.', usoNoTexto: '{{var.target.<chave>}}' },
  { id: 'target_group_member', rotulo: 'Do alvo, NESTE grupo', ajuda: 'A combinação que "/adv @fulano" usa.', usoNoTexto: '{{var.targetMember.<chave>}}' },
  { id: 'category', rotulo: 'De uma categoria', ajuda: 'Compartilhado por um grupo de pessoas que você marca na aba Dados.', usoNoTexto: '{{var.category.<categoria>.<chave>}}' },
  { id: 'global', rotulo: 'Do sistema todo', ajuda: 'Não pertence a ninguém. Serve para totais gerais e para configuração.', usoNoTexto: '{{var.global.<chave>}}' }
])

// --- DESTINOS: onde a automação pode rodar --------------------------------

export const DESTINOS = Object.freeze([
  { id: 'contact', rotulo: 'Uma conversa específica', ajuda: 'Você escolhe o contato.' },
  { id: 'group', rotulo: 'Um grupo específico', ajuda: 'Você escolhe o grupo.' },
  { id: 'all_contacts', rotulo: 'Todos os contatos no privado', ajuda: 'Qualquer conversa direta. Canal e transmissão ficam de fora.' },
  { id: 'all_groups', rotulo: 'Todos os grupos', ajuda: 'Qualquer grupo.' },
  { id: 'everywhere', rotulo: 'Qualquer conversa', ajuda: 'Contatos e grupos. Canal e transmissão continuam de fora.' },
  { id: 'tagged', rotulo: 'Conversas marcadas', ajuda: 'Só onde a variável que você escolher estiver preenchida — o mesmo mecanismo do marcador VIP. É como se liga algo conversa por conversa.' }
])

// --- ponte com o schema ---------------------------------------------------

// Acha a definição de um nó dentro do documentSchema pelo próprio `type`.
// Sem mapa fixo de nome: as definições se identificam, então uma ação nova
// aparece aqui sozinha.
export function acharDefinicao (documentSchema, tipo) {
  const defs = documentSchema?.definitions
  if (!defs) return null
  for (const def of Object.values(defs)) {
    if (def?.properties?.type?.const === tipo) return def
  }
  return null
}

// O tipo de um campo, lido do schema — nunca declarado aqui. Devolve também se
// ele é obrigatório e, quando existe, a lista fechada de valores aceitos.
export function campoDoSchema (definicao, chave) {
  const config = definicao?.properties?.config
  const prop = config?.properties?.[chave]
  if (!prop) return null
  const valores = prop.enum || prop.const ? (prop.enum || [prop.const]) : null
  return {
    tipo: prop.type || (valores ? 'enum' : 'desconhecido'),
    obrigatorio: Array.isArray(config?.required) && config.required.includes(chave),
    valores,
    padrao: prop.default,
    descricaoDoSchema: prop.description || null
  }
}

// Tudo que o catálogo conhece, em uma lista só — usado pelo teste de
// cruzamento e por quem precisa procurar por tipo.
export function todosOsTipos () {
  return {
    gatilhos: GATILHOS.map((g) => g.tipo),
    acoes: ACOES.map((a) => a.tipo),
    condicoes: CONDICOES.map((c) => c.tipo),
    operadores: OPERADORES.map((o) => o.id),
    escopos: ESCOPOS.map((e) => e.id),
    destinos: DESTINOS.map((d) => d.id)
  }
}
