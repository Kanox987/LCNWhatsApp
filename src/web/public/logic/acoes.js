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
      { chave: 'aliases', rotulo: 'Atalhos', ajuda: 'Outras palavras que acionam ESTA MESMA automação — "/p" para "/play". No .lcn se escreve tudo numa linha: "dispara com: /play, /p". A primeira é o nome oficial: é ela que aparece no menu. Cuidado com atalho curto: "/p" pode brigar com "/perfil" se a comparação for "começa com", e a tela de conflitos avisa quando duas automações ligadas disputam a mesma palavra.' },
      {
        chave: 'match',
        rotulo: 'Como comparar',
        ajuda: 'exato = a mensagem tem que ser só isso · começa com = aceita o que vier depois · palavra solta = acha em qualquer posição da frase · exato ou com argumento = igual, ou seguido de um espaço e mais texto (é o que permite "/adv fulano").'
      },
      { chave: 'allowFrom', rotulo: 'Quem pode acionar', ajuda: 'externo = o bot ignora as próprias mensagens (padrão seguro) · qualquer um = responde também quando VOCÊ manda do número onde o bot roda, que é o normal para comando de uso pessoal.' },
      { chave: 'requireOwner', rotulo: 'Só o dono', ajuda: 'Restringe ao dono do bot. Enquanto nenhum dono estiver cadastrado, só o próprio número do bot passa — é assim que se cadastra o primeiro.' },
      { chave: 'args', rotulo: 'Partes do que vem depois', ajuda: 'Divide o texto que a pessoa escreve depois do comando em partes com nome, separadas por um símbolo que você escolhe. Com "pacote / autor", quem digitar "/rename Meu Pacote / Zé" entrega as duas partes separadas, cada uma disponível como {{argumentos.pacote}} e {{argumentos.autor}}. A última parte leva o resto, então o separador pode aparecer dentro dela. Sem isto, o texto inteiro só existe como {{message.args}}.' }
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
      { chave: 'mediaLinkOnly', rotulo: 'Só link de mídia', ajuda: 'Reage só a POST de rede conhecida: reel e foto do Instagram, Shorts e vídeo do YouTube, TikTok, Pinterest, Facebook, X, Reddit. Link de loja, notícia, arquivo em nuvem ou post de comunidade é ignorado em silêncio — sem isso o bot promete "baixando…" antes de descobrir que não há mídia ali.' },
      { chave: 'alsoOnCommands', rotulo: 'Reagir também a comandos', ajuda: 'Normalmente esta regra CEDE quando a mensagem já virou um comando: "/dow <link>" é comando e é mensagem com link ao mesmo tempo, e sem isso o mesmo link era baixado duas vezes. Quem digita um comando endereçou o bot; a regra automática existe para a mensagem que ninguém endereçou a ele. Ligue só se a regra precisa ver tudo que passa — uma automação de auditoria, por exemplo.' },
      { chave: 'keywords', rotulo: 'Contém alguma destas palavras', ajuda: 'Dispara se o texto tiver qualquer uma delas, sem diferenciar maiúscula.' },
      { chave: 'allowFrom', rotulo: 'Quem pode acionar', ajuda: 'A barreira acima vale de qualquer jeito.' },
      { chave: 'requireOwner', rotulo: 'Só o dono', ajuda: 'Restringe ao dono do bot.' }
    ]
  },
  {
    tipo: 'trigger.group',
    rotulo: 'Porteiro: quando o grupo muda',
    resumo: 'A automação observa as entradas, saídas e moderações no grupo (quem entra, quem sai, quem é promovido ou rebaixado, ou quando o nome do grupo muda).',
    exemplo: 'Alguém entra no grupo e o bot confere se está na lista autorizada, removendo quem não estiver.',
    ressalva: {
      level: 'info',
      text: 'O porteiro só atua em grupos autorizados (onde grupo_ativo está ligado). Para expulsar ou moderar membros, o bot precisa ser administrador do grupo.'
    },
    campos: [
      {
        chave: 'actions',
        rotulo: 'Ações observadas',
        ajuda: 'Escolha quais eventos de grupo acionam este porteiro: add (entrou), remove (saiu), promote (promoveu), demote (rebaixou) ou subject (mudou o nome).'
      },
      {
        chave: 'requireOwner',
        rotulo: 'Só o dono',
        ajuda: 'Restringe a execução às ações geradas ou autorizadas pelo dono do bot.'
      }
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
    campos: [
      { chave: 'text', rotulo: 'Texto', ajuda: 'Aceita qualquer variável do sistema. Uma variável que não existe aparece do jeito que está, de propósito — é o sinal de que algo está errado.' },
      { chave: 'numbered', rotulo: 'Numerar a lista', ajuda: 'Numera desde 1 cada linha não vazia depois de substituir as variáveis. Linhas vazias continuam separando os itens. Desligado mantém o texto original.' },
      { chave: 'mentions', rotulo: 'Marcar quem', ajuda: 'A menção de verdade — a que notifica a pessoa e pinta o nome. Ela viaja AO LADO do texto, não dentro dele: escrever "@5511999999999" no texto manda só dígitos, que parecem uma menção e não são. Aceita vários separados por vírgula, e aceita variável: {{sender.id}} marca quem mandou a mensagem.' },
      { chave: 'forward', rotulo: 'Sai como encaminhada', ajuda: 'Põe o selo de "encaminhada" na mensagem. É decoração de contexto; não muda o conteúdo nem quem aparece como autor.' }
    ]
  },
  {
    tipo: 'action.whatsapp.sendFile',
    rotulo: 'Enviar um arquivo do acervo',
    familia: 'midia',
    resumo: 'Manda uma imagem, áudio, vídeo, PDF ou texto que você guardou no Acervo. É como responder com foto de produto ou cardápio sem reenviar o arquivo toda vez.',
    exemplo: 'Alguém digita "/cardapio" e recebe o PDF que você subiu.',
    campos: [
      { chave: 'path', rotulo: 'Caminho do arquivo', ajuda: 'Como "produtos/fotos/capa.jpg" — é o que uma pessoa consegue escrever no WhatsApp. Aceita variáveis: {{message.args}} pega o que foi digitado depois do comando. Sem pasta, o nome sozinho resolve, desde que não haja dois arquivos com o mesmo nome.' },
      { chave: 'fileId', rotulo: 'Arquivo (por identificador)', ajuda: 'O identificador que aparece no cartão do arquivo na aba Acervo — tem um botão "Copiar id" lá. É a referência estável: não muda se o arquivo for renomeado ou movido de pasta.' },
      { chave: 'folder', rotulo: 'Uma pasta inteira', ajuda: 'Em vez de um arquivo, manda tudo que está na pasta, em ordem de nome. É assim que um comando monta o próprio carrossel — ou entrega um conjunto, como um pacote de figurinhas. Aceita variáveis, então a pasta pode vir do que a pessoa escreveu.' },
      { chave: 'delivery', rotulo: 'Como entregar a pasta', ajuda: 'Só vale com a pasta, e só quando ela tem mais de uma mídia. Carrossel manda UMA mensagem com cards que a pessoa desliza; álbum deixa o aplicativo agrupar; separado manda uma por arquivo. O carrossel cai para álbum e o álbum para sequência quando não são aceitos.' },
      { chave: 'caption', rotulo: 'Legenda', ajuda: 'Texto que acompanha o arquivo. Aceita variáveis. Arquivo de texto é enviado como mensagem, então não leva legenda.' },
      { chave: 'viewOnce', rotulo: 'Visualização única', ajuda: 'Pede ao WhatsApp para a mídia (imagem, vídeo ou áudio) desaparecer após aberta. Atenção: é apenas um pedido ao aplicativo de quem recebe, não uma garantia — aplicativos modificados salvam a mídia de qualquer jeito, e o próprio sistema tem comandos (como /x9) que a recuperam.' },
      { chave: 'notFoundText', rotulo: 'Se o arquivo sumiu', ajuda: 'Enviado quando o arquivo foi apagado do acervo depois de o comando ser publicado — melhor avisar que ficar mudo.' }
    ]
  },
  {
    tipo: 'action.acervo.save',
    rotulo: 'Guardar no acervo',
    familia: 'midia',
    resumo: 'Pega a foto, o vídeo, o áudio ou o PDF que chegou na conversa e guarda no acervo do bot, para usar depois em qualquer comando.',
    exemplo: 'Mandar uma foto com "/guardar" na legenda, ou responder um arquivo com o comando.',
    ressalva: {
      level: 'note',
      text: 'A pasta é um RÓTULO do acervo, não uma pasta no disco: o arquivo continua gravado por identificador gerado. É isso que impede um nome vindo do WhatsApp de virar caminho no sistema de arquivos.'
    },
    campos: [
      { chave: 'folder', rotulo: 'Pasta', ajuda: 'Onde organizar, até três níveis ("produtos/fotos"). Aceita variáveis.' },
      { chave: 'name', rotulo: 'Nome', ajuda: 'Vazio usa o nome que veio no WhatsApp.' },
      { chave: 'description', rotulo: 'Descrição', ajuda: 'Ajuda a reconhecer o arquivo daqui a um mês.' },
      { chave: 'okText', rotulo: 'Confirmação', ajuda: '{{caminho}} vira o caminho onde ficou · {{id}} o identificador · {{nome}} o nome.' },
      { chave: 'notFoundText', rotulo: 'Se não houver arquivo', ajuda: 'Quando o comando chega sozinho, sem mídia por perto.' },
      { chave: 'errorText', rotulo: 'Se falhar', ajuda: '{{erro}} vira o motivo: tipo não aceito, arquivo grande demais, acervo cheio.' }
    ]
  },
  {
    tipo: 'action.acervo.read',
    rotulo: 'Ler do acervo',
    familia: 'midia',
    resumo: 'Lê o nome, a descrição, a pasta e o tamanho de um item guardado, para usar na resposta seguinte.',
    exemplo: 'Mostrar o nome e o preço de um produto antes de perguntar se a pessoa quer comprar.',
    ressalva: { level: 'note', text: 'É a única ação do acervo que LÊ — as outras quatro escrevem. Ela devolve METADADO, nunca o arquivo: para enviar o arquivo em si continua sendo "Enviar arquivo". Ponha uma ação depois desta, senão a leitura não serve para nada.' },
    campos: [
      { chave: 'path', rotulo: 'Arquivo', ajuda: 'O caminho dentro do acervo, como "produtos/curso-python", ou só o nome quando não houver outro igual.' },
      { chave: 'notFoundText', rotulo: 'Se o item não existir', ajuda: 'Enviado quando não há nada nesse caminho — por exemplo um produto tirado do ar depois de o comando ser publicado. Sem este texto a execução vira erro no histórico e ninguém recebe nada.' }
    ]
  },
  {
    tipo: 'action.acervo.delete',
    rotulo: 'Apagar do acervo',
    familia: 'midia',
    resumo: 'Remove um arquivo do acervo pelo caminho ou pelo identificador, liberando espaço na cota.',
    exemplo: 'apaga do acervo "produtos/cardapio.pdf"',
    ressalva: {
      level: 'note',
      text: 'Apagar é definitivo e irreversível. O id deixa de existir no acervo e qualquer comando que aponte para ele deixará de encontrá-lo.'
    },
    campos: [
      { chave: 'path', rotulo: 'Caminho do arquivo', ajuda: 'Como "produtos/cardapio.pdf". Aceita variáveis como {{message.args}}.' },
      { chave: 'fileId', rotulo: 'Arquivo (por identificador)', ajuda: 'O identificador único do arquivo no acervo.' },
      { chave: 'okText', rotulo: 'Confirmação', ajuda: 'Resposta enviada após apagar. {{caminho}} vira o caminho do arquivo, {{id}} o identificador e {{nome}} o nome.' },
      { chave: 'notFoundText', rotulo: 'Se o arquivo não existir', ajuda: 'Resposta enviada se o arquivo procurado não for encontrado no acervo.' },
      { chave: 'errorText', rotulo: 'Se falhar', ajuda: 'Resposta enviada se a remoção falhar. {{erro}} vira o motivo.' }
    ]
  },
  {
    tipo: 'action.acervo.createText',
    rotulo: 'Criar texto no acervo',
    familia: 'midia',
    resumo: 'Cria um arquivo de texto no acervo a partir de variáveis ou texto montado pelo comando (como recibos ou relatórios).',
    exemplo: 'cria texto no acervo "relatorios/recibo.txt", com conteúdo "Recibo de {{sender.name}}"',
    ressalva: {
      level: 'note',
      text: 'Texto no acervo tem kind "text": ao ser enviado por comando, é entregue como mensagem de texto comum, e não como documento anexado.'
    },
    campos: [
      { chave: 'path', rotulo: 'Caminho do arquivo', ajuda: 'Caminho completo com pasta e nome (ex: "relatorios/recibo.txt").' },
      { chave: 'text', rotulo: 'Conteúdo do texto', ajuda: 'O texto a gravar no arquivo. Aceita variáveis do sistema como {{var.chat.total}} e {{sender.name}}.' },
      { chave: 'name', rotulo: 'Nome do arquivo', ajuda: 'Nome do arquivo no acervo (ex: "recibo.txt"). Se não informado, deduz do caminho.' },
      { chave: 'folder', rotulo: 'Pasta', ajuda: 'Pasta onde organizar o arquivo (até três níveis). Se não informada, deduz do caminho.' },
      { chave: 'description', rotulo: 'Descrição', ajuda: 'Descrição para identificar o arquivo na listagem do acervo.' },
      { chave: 'okText', rotulo: 'Confirmação', ajuda: 'Resposta enviada após criar o arquivo. Aceita {{caminho}}, {{id}} e {{nome}}.' },
      { chave: 'errorText', rotulo: 'Se falhar', ajuda: 'Resposta enviada se a gravação falhar (ex: falta de espaço na cota ou limite de tamanho). {{erro}} vira o motivo.' }
    ]
  },
  {
    tipo: 'action.acervo.rewrite',
    rotulo: 'Sobrescrever no acervo',
    familia: 'midia',
    resumo: 'Substitui o conteúdo de um arquivo existente mantendo o mesmo identificador, preservando referências de outros comandos.',
    exemplo: 'sobrescreve no acervo "produtos/cardapio.txt", com o novo texto ou mídia recebida.',
    ressalva: {
      level: 'note',
      text: 'O identificador (id) e o tipo do arquivo original são preservados intactos. Se não houver campo de texto, o comando usa a mídia enviada na mensagem.'
    },
    campos: [
      { chave: 'path', rotulo: 'Caminho do arquivo', ajuda: 'Caminho do arquivo a ser sobrescrito (ex: "cardapio.txt").' },
      { chave: 'fileId', rotulo: 'Arquivo (por identificador)', ajuda: 'O identificador estável do arquivo que será reescrito.' },
      { chave: 'text', rotulo: 'Novo conteúdo de texto', ajuda: 'Novo texto para o arquivo. Se deixado vazio, o comando usa a mídia recebida na mensagem do WhatsApp.' },
      { chave: 'okText', rotulo: 'Confirmação', ajuda: 'Resposta enviada após a reescrita. Aceita {{caminho}}, {{id}} e {{nome}}.' },
      { chave: 'notFoundText', rotulo: 'Se o arquivo não existir', ajuda: 'Resposta enviada se o arquivo procurado não for encontrado ou se faltar a mídia nova.' },
      { chave: 'errorText', rotulo: 'Se falhar', ajuda: 'Resposta enviada se a sobrescrita falhar (ex: estouro de cota). {{erro}} vira o motivo.' }
    ]
  },
  {
    tipo: 'action.connection.call',
    rotulo: 'Consultar um serviço externo',
    familia: 'midia',
    resumo: 'Chama uma função declarada na aba Conexões — baixar uma mídia, perguntar a uma IA, consultar qualquer API. O LCN não acessa a web sozinho: toda consulta passa por uma conexão que você declarou.',
    exemplo: 'chama midia.baixar, com o link da mensagem.',
    ressalva: {
      level: 'requirement',
      text: 'A conexão e a função precisam existir na aba Conexões. Quem escolhe o endereço, o método e a credencial é você, ali — o comando só nomeia a função, e é isso que impede uma automação de apontar para onde quiser.'
    },
    campos: [
      { chave: 'connectionRef', rotulo: 'Qual serviço', ajuda: 'O identificador da conexão, como está na aba Conexões.' },
      { chave: 'function', rotulo: 'Qual função', ajuda: 'O nome da função declarada naquela conexão. A publicação recusa uma que não exista, e diz quais existem.' },
      { chave: 'inputs', rotulo: 'O que mandar', ajuda: 'As entradas que a função declarou, por nome. Aceitam variáveis: {{message.link}}, {{sender.name}}. Entrada obrigatória que faltar é recusada na publicação, não na hora da chamada.' },
      { chave: 'mediaFrom', rotulo: 'De onde vem o arquivo', ajuda: 'Da mensagem que acionou o comando (o normal: a mídia anexada e, não havendo, a da mensagem respondida), só da respondida, ou do resultado da chamada ANTERIOR. A última é o que faz duas chamadas em sequência virarem um cano — melhorar a foto e depois virar figurinha — em vez de duas chamadas soltas sobre a mesma mídia. "Só da respondida" existe para desempatar quando a função recebe duas fotos.' },
      { chave: 'mediaInput', rotulo: 'Qual entrada recebe o arquivo', ajuda: 'Só para função que recebe mídia (converter uma figurinha, ler uma imagem). O arquivo é a foto, o vídeo ou o áudio da mensagem — mandado com o comando ou numa mensagem respondida. Fica separado de "O que mandar" porque ali os valores passam por interpolação de texto, e arquivo não é texto.' },
      { chave: 'mediaInput2', rotulo: 'Qual entrada recebe o SEGUNDO arquivo', ajuda: 'Só para função que recebe duas fotos — trocar o fundo recebe a foto da pessoa e a foto que vira o fundo. A mensagem de um comando carrega duas mídias: a que ela responde e a que vem anexada.' },
      { chave: 'mediaFrom2', rotulo: 'De onde vem o segundo arquivo', ajuda: 'Da mensagem respondida ou da anexada, e precisa ser a outra do primeiro — com as duas iguais, os dois campos receberiam a mesma foto.' },
      { chave: 'ackText', rotulo: 'Aviso ao começar', ajuda: 'Consulta externa demora. Sem aviso, parece que o comando não funcionou.' },
      { chave: 'caption', rotulo: 'Legenda', ajuda: 'Quando a resposta vier como arquivo. Vazio usa a descrição que o serviço trouxer.' },
      { chave: 'quoteFrom', rotulo: 'Qual mensagem a resposta marca', ajuda: 'A citada (padrão) é o certo para o download de link: o assunto é a mensagem que trouxe o link. "Quem pediu" é o certo quando o pedido se basta — quem digitou o nome da música, ou tocou o botão do carrossel, espera a resposta no pedido dele e não no card.' },
      { chave: 'notFoundText', rotulo: 'Se faltar o que mandar', ajuda: 'Resposta quando nenhuma entrada resolveu — por exemplo, nenhum link por perto —, e também quando falta uma das fotos que a função pede.' },
      { chave: 'errorText', rotulo: 'Se falhar', ajuda: 'Escreva {{erro}} onde quiser que apareça o motivo. Erro do serviço sobre o link chega inteiro; erro nosso vira uma frase limpa, sem endereço nem credencial.' },
      { chave: 'delivery', rotulo: 'Como entregar quando vem mais de um arquivo', ajuda: 'Carrossel manda UMA mensagem com as mídias em cards que a pessoa desliza — é o que agrupa de verdade. Álbum manda uma mensagem por mídia e deixa o aplicativo juntar num bloco: chega em qualquer cliente, mas continua sendo uma pilha de fotos. Separado manda uma por arquivo. Nos três casos todas as mídias chegam: o carrossel cai para álbum e o álbum cai para sequência quando não são aceitos.' }
    ]
  },
  {
    tipo: 'action.media.download',
    rotulo: 'Baixar mídia de um link',
    familia: 'midia',
    resumo: 'Pega o vídeo, o áudio ou a foto de um link (YouTube, TikTok, Instagram, Facebook…) por um serviço externo e manda no WhatsApp.',
    exemplo: 'Responder uma mensagem que tem link com "/dow", ou deixar a conversa baixando sozinha.',
    ressalva: {
      level: 'requirement',
      text: 'Precisa de um serviço de download configurado em download.api no config.json, com o token num arquivo. O WhatsApp recusa arquivo grande, então há um teto (download.limiteMB, 64 MB por padrão) — acima dele o bot explica em vez de tentar e falhar.'
    },
    campos: [
      { chave: 'url', rotulo: 'O link', ajuda: 'Aceita variável: {{quoted.link}} pega o link da mensagem marcada, {{message.link}} pega o da própria mensagem. Se não houver link, o comando avisa em vez de tentar.' },
      { chave: 'modo', rotulo: 'O que baixar', ajuda: 'auto deixa o serviço escolher · video traz imagem e som · audio traz só a trilha · thumbnail traz só a capa.' },
      { chave: 'delivery', rotulo: 'Como entregar quando vem mais de um arquivo', ajuda: 'Carrossel manda UMA mensagem com as mídias em cards que a pessoa desliza — é o que agrupa de verdade. Álbum manda uma mensagem por mídia e deixa o aplicativo juntar num bloco: chega em qualquer cliente, mas continua sendo uma pilha de fotos. Separado manda uma por arquivo. Nos três casos todas as mídias chegam: o carrossel cai para álbum e o álbum cai para sequência quando não são aceitos.' },
      { chave: 'ackText', rotulo: 'Aviso ao começar', ajuda: 'Enviado na hora, marcando a mensagem do link. Download demora, e silêncio parece que o comando não funcionou.' },
      { chave: 'caption', rotulo: 'Legenda', ajuda: 'Acompanha a mídia. Sem legenda, entra a descrição que o serviço trouxer (título do vídeo, por exemplo).' },
      { chave: 'notFoundText', rotulo: 'Se não houver link', ajuda: 'Enviado quando o comando é usado sem link nenhum por perto.' },
      { chave: 'errorText', rotulo: 'Se o download falhar', ajuda: 'Escreva {{erro}} onde quiser que apareça o motivo que o serviço deu — arquivo grande demais, link não suportado, serviço fora do ar.' }
    ]
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
    tipo: 'action.variable.calculate',
    rotulo: 'Calcular com dois valores',
    familia: 'variavel',
    resumo: 'Soma, subtrai, multiplica ou divide dois números, variáveis ou campos do evento. O resultado pode ser só desta execução ou gravado como número.',
    exemplo: 'calcula local total = var chat preco * var chat quantidade; depois responde "Total: {{local.total}}".',
    ressalva: { level: 'info', text: 'Usa a precisão binária de Number, sem arredondar para inteiro ou centavos: 5 / 2 = 2.5 e 0.1 + 0.2 = 0.30000000000000004. Não é cálculo monetário exato. Divisão por zero, valores ausentes, booleanos, textos não numéricos, inteiros inseguros e resultados não representáveis interrompem a execução com motivo no histórico.' },
    campos: [
      { chave: 'scope', rotulo: 'Onde guardar o resultado', ajuda: 'local mantém só nesta execução, acessível em {{local.nome}} e em outro cálculo com evento local.nome. Os escopos de variável gravam no banco e usam {{var....}}.' },
      { chave: 'categoryKey', rotulo: 'Qual categoria', ajuda: 'Obrigatório só no escopo category.' },
      { chave: 'key', rotulo: 'Nome do resultado', ajuda: 'Em local, use letras sem acento, números e _, começando por letra ou _. O prefixo __ é reservado.' },
      { chave: 'left', rotulo: 'Primeiro valor', ajuda: 'Número decimal com ponto, var chat preco ou evento argumentos.preco. Argumentos numéricos chegam como texto e são conferidos antes da conta.' },
      { chave: 'operator', rotulo: 'Operação', ajuda: '+ soma; - subtrai; * ou × multiplica; / ou ÷ divide. Uma operação por ação; encadeie ações para calcular em etapas.' },
      { chave: 'right', rotulo: 'Segundo valor', ajuda: 'Número, variável ou campo do evento, nas mesmas formas do primeiro valor. Não escreva a conta dentro de {{...}}.' }
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
    tipo: 'action.whatsapp.webview',
    rotulo: 'Mandar uma página',
    familia: 'resposta',
    resumo: 'Manda uma mensagem com um botão que abre um endereço. Com a opção ligada, a página abre numa janela do próprio WhatsApp, em tela cheia por cima da conversa — medido funcionando, embora a Meta documente apenas a abertura no navegador.',
    exemplo: 'Alguém digita "/jogar" e recebe um botão "🎮 Jogar" que abre o jogo.',
    ressalva: {
      level: 'note',
      text: 'Não existe HTML rodando dentro de uma mensagem do WhatsApp: o que existe é este botão, e o site continua hospedado onde você quiser. E o botão NÃO volta para o bot — quem toca abre a página e pronto. Se o comando precisa saber o que a pessoa fez lá, isso tem de vir da própria página falando com o serviço dela.'
    },
    campos: [
      { chave: 'text', rotulo: 'Texto da mensagem', ajuda: 'O que aparece acima do botão. Aceita variáveis.' },
      { chave: 'url', rotulo: 'Endereço', ajuda: 'A página a abrir. Aceita variáveis, então dá para apontar para a página daquele item — "https://seu-site.com/{{message.args}}". Precisa ser http ou https.' },
      { chave: 'buttonLabel', rotulo: 'Texto do botão', ajuda: 'O que a pessoa lê no botão.' },
      { chave: 'footer', rotulo: 'Rodapé', ajuda: 'Opcional, abaixo do texto.' },
      { chave: 'forma', rotulo: 'Forma do botão', ajuda: 'Duas maneiras de pedir a mesma coisa, nenhuma documentada pela Meta. "link" foi medida funcionando num número comum. "janela" é a forma que o bot de referência usa no comando de jogo dele. Aparelho que não desenha uma pode desenhar a outra — por isso são duas, e não uma escolhida por mim.' },
      { chave: 'inApp', rotulo: 'Abrir dentro do WhatsApp', ajuda: 'A página abre numa janela do próprio WhatsApp, em TELA CHEIA por cima da conversa — nunca dentro da bolha da mensagem, que não existe em forma nenhuma. O campo não é documentado pela Meta (ela documenta só a abertura no navegador), mas foi medido funcionando num número comum; por não ser documentado, pode parar sem aviso.' }
    ]
  },
  {
    tipo: 'action.whatsapp.metadata',
    rotulo: 'Mostrar os metadados da mensagem',
    familia: 'resposta',
    resumo: 'Responde com o que de fato chegou: o id da mensagem, quem mandou, o que ela responde, e — quando foi um toque em botão — qual botão, que rótulo a pessoa leu, que posição e qual card do carrossel.',
    exemplo: 'Responder uma mensagem com "/meta" e receber de volta os dados dela.',
    ressalva: {
      level: 'note',
      text: 'Mostra o que o COMANDO consegue ler, que é o mesmo objeto que {{message.…}} enxerga — não o pacote cru do WhatsApp. O pacote cru carrega a chave de download da mídia, e publicá-lo numa conversa entregaria a quem estivesse lendo a capacidade de baixar a mídia de outra pessoa.'
    },
    campos: []
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
      { chave: 'neverRemoveOwner', rotulo: 'Nunca remover um dono', ajuda: 'Ligado por padrão. Desligue só se você quiser de propósito uma regra que vale para todos, dono incluído.' },
      { chave: 'notFoundText', rotulo: 'Quando ninguém foi marcado', ajuda: 'Resposta para quem usou o comando sem marcar nem responder ninguém. Sem este texto o comando não envia nada e a falta só aparece na aba Execuções.' },
      { chave: 'ownerText', rotulo: 'Quando o alvo é um dono', ajuda: 'A trava acima age em SILÊNCIO sem este texto: o comando casa, não envia nada, e quem digitou acha que o bot morreu. Escreva aqui o que responder quando a pessoa marcada for um dono.' }
    ]
  },
  {
    tipo: 'action.whatsapp.react',
    rotulo: 'Reagir com emoji',
    familia: 'resposta',
    resumo: 'Põe uma reação na mensagem respondida.',
    exemplo: 'Marcar com ✅ o pedido que já foi atendido.',
    campos: [
      { chave: 'emoji', rotulo: 'Emoji', ajuda: 'O emoji da reação. DEIXAR VAZIO REVOGA a reação que já estava lá — é assim que o WhatsApp desfaz, e não com um comando separado.' },
      { chave: 'notFoundText', rotulo: 'Quando nada foi respondido', ajuda: 'Reagir precisa de uma mensagem respondida. Sem este texto o comando não envia nada e a falta só aparece na aba Execuções.' }
    ]
  },
  {
    tipo: 'action.variable.rank',
    rotulo: 'Montar um ranking',
    familia: 'variavel',
    resumo: 'Ordena um contador e mostra as primeiras posições, com as pessoas marcadas.',
    exemplo: 'Top 10 de quem mais pontuou no grupo este mês.',
    ressalva: { level: 'note', text: 'É a única ação que lê MUITOS registros. Ela ordena o que outras ações já somaram — então primeiro é preciso existir um comando ou vigia que some alguma coisa, senão o ranking nasce vazio.' },
    campos: [
      { chave: 'scope', rotulo: 'De quem', ajuda: 'dos membros deste grupo conta separado por grupo (o mesmo escopo que a advertência usa) · das pessoas conta a pessoa em qualquer conversa.' },
      { chave: 'key', rotulo: 'Contando o quê', ajuda: 'O nome do contador que vai ser ordenado, como "pontos" ou "mensagens". Tem que ser o MESMO nome que a ação de somar usa.' },
      { chave: 'limit', rotulo: 'Quantas posições', ajuda: 'Quantos aparecem na lista. O teto é 50: acima disso o WhatsApp corta a mensagem e o fim do ranking some.' },
      { chave: 'headerText', rotulo: 'Título', ajuda: 'A primeira linha, antes das posições.' },
      { chave: 'lineFormat', rotulo: 'Como escrever cada linha', ajuda: 'Use {{posicao}}, {{numero}} e {{valor}}. O padrão é "1. @numero — valor". Quem aparece na lista é marcado de verdade, então o nome sai no lugar do número.' },
      { chave: 'emptyText', rotulo: 'Quando ninguém pontuou', ajuda: 'Resposta para ranking vazio — comum logo depois de instalar. Sem este texto a execução vira erro no histórico e ninguém recebe nada.' }
    ]
  },
  {
    tipo: 'action.whatsapp.pin',
    rotulo: 'Fixar a mensagem',
    familia: 'moderacao',
    resumo: 'Prende a mensagem respondida no topo da conversa, ou solta.',
    exemplo: 'Deixar as regras do grupo fixadas por uma semana.',
    ressalva: { level: 'requirement', text: 'Precisa RESPONDER uma mensagem: é ela que vai ser fixada. Em grupo, o WhatsApp costuma exigir que o número seja administrador.' },
    campos: [
      { chave: 'action', rotulo: 'O que fazer', ajuda: 'fixar prende no topo · soltar tira de lá.' },
      { chave: 'durationSecs', rotulo: 'Por quanto tempo', ajuda: 'Em segundos. O WhatsApp oferece 86400 (24 horas), 604800 (7 dias) e 2592000 (30 dias). Deixando em branco vale 24 horas — e é importante que valha algo: sem duração o aparelho de quem recebe descarta o fixo sem avisar ninguém.' },
      { chave: 'notFoundText', rotulo: 'Quando nada foi respondido', ajuda: 'Resposta para quem usou o comando sem responder mensagem nenhuma. Sem este texto o comando não envia nada e a falta só aparece na aba Execuções.' }
    ]
  },
  {
    tipo: 'action.whatsapp.pollResults',
    rotulo: 'Mostrar o resultado da enquete',
    familia: 'resposta',
    resumo: 'Escreve quantos votos cada opção recebeu.',
    exemplo: 'Depois de perguntar o dia da reunião, mostrar qual ganhou.',
    ressalva: { level: 'note', text: 'Conta qualquer enquete que o bot viu NASCER na conversa, inclusive as criadas por outras pessoas — é na criação que os nomes das opções passam em claro, e é esse mapa que traduz os votos depois. A contagem vive na memória e recomeça do zero quando o bot reinicia.' },
    campos: [
      { chave: 'headerText', rotulo: 'Título', ajuda: 'A primeira linha, antes dos totais.' },
      { chave: 'lineFormat', rotulo: 'Como escrever cada linha', ajuda: 'Use {{opcao}} e {{votos}}. O padrão é "• opção: votos".' },
      { chave: 'emptyText', rotulo: 'Quando não há contagem', ajuda: 'Escreva "ainda não tenho contagem" e não "ninguém votou" — são coisas diferentes, e depois de um reinício a segunda seria mentira.' }
    ]
  },
  {
    tipo: 'action.whatsapp.poll',
    rotulo: 'Abrir uma enquete',
    familia: 'resposta',
    resumo: 'Manda uma enquete de verdade, daquelas que o WhatsApp conta sozinho.',
    exemplo: 'Perguntar ao grupo que dia fica melhor para a reunião.',
    ressalva: { level: 'note', text: 'O bot ABRE a enquete e não lê os votos: contar quem votou no quê é outra capacidade, que não existe. Para decidir alguma coisa a partir do resultado, alguém olha e decide.' },
    campos: [
      { chave: 'question', rotulo: 'Pergunta', ajuda: 'O que vai ser perguntado.' },
      { chave: 'options', rotulo: 'Opções', ajuda: 'As alternativas separadas por ponto e vírgula, como "Segunda; Terça; Quarta". Precisa de pelo menos duas. A ordem importa: é por ela que o WhatsApp casa os votos.' },
      { chave: 'selectableCount', rotulo: 'Quantas dá para marcar', ajuda: '1 é voto único. Um número maior deixa a pessoa marcar várias. Nunca passa do total de opções.' }
    ]
  },
  {
    tipo: 'action.whatsapp.profilePicture',
    rotulo: 'Pegar a foto de perfil',
    familia: 'midia',
    resumo: 'Manda na conversa a foto de perfil de quem você marcar.',
    exemplo: 'Ver a foto de quem entrou no grupo.',
    ressalva: { level: 'note', text: 'Quem não tem foto é caso NORMAL, não erro: a consulta volta vazia e o comando responde o texto que você escrever. Sem esse texto ele fica mudo justamente no caso mais comum depois do sucesso.' },
    campos: [
      { chave: 'who', rotulo: 'De quem', ajuda: 'quem enviou a mensagem, ou o alvo (o @mencionado, ou o autor da mensagem respondida).' },
      { chave: 'caption', rotulo: 'Legenda', ajuda: 'Texto que vai junto com a foto.' },
      { chave: 'noPhotoText', rotulo: 'Quando a pessoa não tem foto', ajuda: 'Resposta para o caso de a pessoa não ter foto de perfil, ou de ela estar escondida pela privacidade dela.' },
      { chave: 'notFoundText', rotulo: 'Quando ninguém foi marcado', ajuda: 'Resposta para quem usou o comando sem marcar nem responder ninguém.' }
    ]
  },
  {
    tipo: 'action.group.promote',
    rotulo: 'Promover a administrador',
    familia: 'moderacao',
    resumo: 'Dá admin a alguém no grupo.',
    exemplo: 'Quem entra pela lista branca já sai administrador.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. Confira antes com {{bot.isAdmin}} e avise, em vez de tentar e falhar na frente de todo mundo.' },
    campos: [
      { chave: 'who', rotulo: 'Quem promover', ajuda: 'quem enviou a mensagem, ou o alvo (o @mencionado, ou o autor da mensagem respondida). Marcando vários de uma vez, todos são promovidos.' },
      { chave: 'notFoundText', rotulo: 'Quando ninguém foi marcado', ajuda: 'Resposta para quem usou o comando sem marcar nem responder ninguém. Sem este texto o comando não envia nada e a falta só aparece na aba Execuções.' }
    ]
  },
  {
    tipo: 'action.group.members',
    rotulo: 'Falar com os membros',
    familia: 'moderacao',
    resumo: 'Marca todo mundo, lista o grupo, ou sorteia um membro.',
    exemplo: 'Avisar o grupo inteiro de uma reunião sem escrever número nenhum.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo. É a ÚNICA ação que enumera os membros: um comando normal não enxerga a lista de participantes, então marcar todos, listar e sortear só existem por aqui.' },
    campos: [
      { chave: 'mode', rotulo: 'O que fazer', ajuda: 'marcando todos avisa o grupo inteiro sem escrever os números; listando todos escreve a lista visível; sorteando um escolhe UMA pessoa ao acaso.' },
      { chave: 'text', rotulo: 'Mensagem', ajuda: 'O que vai escrito junto. Sorteando um, escreva {{sorteado}} onde o nome da pessoa escolhida deve aparecer.' },
      { chave: 'onlyAdmins', rotulo: 'Só os administradores', ajuda: 'Limita aos administradores do grupo. Desligado, alcança todo mundo.' },
      { chave: 'notFoundText', rotulo: 'Quando não há ninguém', ajuda: 'Grupo só com o bot, ou "só administradores" num grupo sem outro admin. Sem este texto a execução vira erro no histórico e ninguém recebe nada.' }
    ]
  },
  {
    tipo: 'action.group.demote',
    rotulo: 'Rebaixar de administrador',
    familia: 'moderacao',
    resumo: 'Tira os privilégios de administrador de alguém no grupo.',
    exemplo: 'Rebaixar quem violou as regras de moderação.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. Confira antes com {{bot.isAdmin}} e avise, em vez de tentar e falhar na frente de todo mundo.' },
    campos: [
      { chave: 'who', rotulo: 'Quem rebaixar', ajuda: 'quem enviou a mensagem, ou o alvo (o @mencionado, ou o autor da mensagem respondida). Marcando vários de uma vez, todos são rebaixados.' },
      { chave: 'neverRemoveOwner', rotulo: 'Nunca rebaixar um dono', ajuda: 'Ligado por padrão. Desligue só se você quiser de propósito uma regra que vale para todos, dono incluído.' },
      { chave: 'notFoundText', rotulo: 'Quando ninguém foi marcado', ajuda: 'Resposta para quem usou o comando sem marcar nem responder ninguém. Sem este texto o comando não envia nada e a falta só aparece na aba Execuções.' },
      { chave: 'ownerText', rotulo: 'Quando o alvo é um dono', ajuda: 'A trava acima age em SILÊNCIO sem este texto: o comando casa, não envia nada, e quem digitou acha que o bot morreu. Escreva aqui o que responder quando a pessoa marcada for um dono.' }
    ]
  },
  {
    tipo: 'action.group.add',
    rotulo: 'Adicionar ao grupo',
    familia: 'moderacao',
    resumo: 'Coloca alguém no grupo pelo número de telefone.',
    exemplo: 'adiciona no grupo, com o número digitado.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. O WhatsApp recusa se a pessoa tiver restringido nas configurações de privacidade quem pode adicioná-la a grupos.' },
    campos: [
      { chave: 'phone', rotulo: 'Número a adicionar', ajuda: 'Número de telefone com código do país e DDD (ex: 5511999999999) ou identificador completo. Aceita variáveis como {{message.args}}.' },
      { chave: 'notFoundText', rotulo: 'Quando nenhum número foi informado', ajuda: 'Resposta para quem usou o comando sem digitar o número. Sem este texto o comando não envia nada e a falta só aparece na aba Execuções.' }
    ]
  },
  {
    tipo: 'action.group.setSubject',
    rotulo: 'Mudar o nome do grupo',
    familia: 'moderacao',
    resumo: 'Altera o título ou nome exibido do grupo no WhatsApp.',
    exemplo: 'muda o nome do grupo, definindo o novo nome recebido.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. Confira antes com {{bot.isAdmin}} e avise se faltar permissão.' },
    campos: [
      { chave: 'subject', rotulo: 'Novo nome', ajuda: 'O novo nome do grupo. Aceita variáveis como {{message.args}}.' },
      { chave: 'notFoundText', rotulo: 'Quando o nome estiver vazio', ajuda: 'Resposta para quem usou o comando sem informar o novo nome. Sem este texto a execução vira erro no histórico e o WhatsApp não recebe nada.' }
    ]
  },
  {
    tipo: 'action.group.setDescription',
    rotulo: 'Mudar a descrição do grupo',
    familia: 'moderacao',
    resumo: 'Atualiza o texto da descrição do grupo. Enviar texto vazio limpa a descrição existente.',
    exemplo: 'muda a descrição do grupo com as novas regras.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. Confira antes com {{bot.isAdmin}} e avise se faltar permissão.' },
    campos: [
      { chave: 'description', rotulo: 'Nova descrição', ajuda: 'O novo texto descritivo do grupo. Deixar vazio limpa a descrição. Aceita variáveis.' }
    ]
  },
  {
    tipo: 'action.group.setAnnounce',
    rotulo: 'Fechar ou abrir o grupo',
    familia: 'moderacao',
    resumo: 'Configura o grupo para apenas administradores enviarem mensagens (fechado) ou permite que todos enviem (aberto).',
    exemplo: 'fecha o grupo para manter o chat organizado à noite.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. Confira antes com {{bot.isAdmin}} e avise se faltar permissão.' },
    campos: [
      { chave: 'close', rotulo: 'Fechar o grupo', ajuda: 'sim para fechar o grupo (somente administradores escrevem), não para abrir o grupo a todos os participantes.' }
    ]
  },
  {
    tipo: 'action.group.inviteCode',
    rotulo: 'Mostrar o link do grupo',
    familia: 'moderacao',
    resumo: 'Consulta o link de convite do grupo e responde na conversa, podendo renovar o convite antes.',
    exemplo: 'mostra o link do grupo com o endereço de convite atual.',
    ressalva: { level: 'requirement', text: 'Só funciona em grupo e com o número sendo ADMINISTRADOR. Confira antes com {{bot.isAdmin}} e avise se faltar permissão.' },
    campos: [
      { chave: 'text', rotulo: 'Mensagem', ajuda: 'Texto que acompanha o link enviado na conversa. Use {{link}} onde o link deve entrar e {{codigo}} para o código cru.' },
      { chave: 'renova', rotulo: 'Renovar link', ajuda: 'sim para revogar o convite atual e gerar um novo link antes de responder; não para manter o link existente.' }
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
      { chave: 'numbered', rotulo: 'Numerar os comandos', ajuda: 'Numera só os comandos visíveis, desde 1, no texto e nos rótulos dos botões. Cabeçalho, rodapé e mensagem de vazio não entram na contagem; os IDs dos comandos continuam iguais.' },
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
  },
  {
    tipo: 'action.whatsapp.buttons',
    rotulo: 'Responder com botões',
    familia: 'resposta',
    resumo: 'Manda uma mensagem de texto com até 3 botões de resposta rápida (quick_reply). Cada toque volta para o bot como uma mensagem de texto comum que dispara outro comando.',
    exemplo: 'Alguém digita "/escolha" e recebe uma pergunta com botões "Opção 1" e "Opção 2".',
    ressalva: {
      level: 'compatibility',
      text: 'O botão volta para o bot como uma mensagem de texto comum contendo o comando configurado — é assim que o fluxo continua. Mensagem com botão depende do aplicativo de quem recebe: versões antigas ou WhatsApp Web/Business podem não renderizar. Quando o aplicativo aceita mas não desenha, não há erro em lugar nenhum (a conversa fica vazia); quando o envio falha de verdade, cai para texto comum com as opções listadas.'
    },
    campos: [
      { chave: 'text', rotulo: 'Texto da mensagem', ajuda: 'O texto que aparece acima dos botões. Aceita variáveis.' },
      { chave: 'buttons', rotulo: 'Botões', ajuda: 'Até 3 botões de resposta rápida. Cada botão tem um rótulo que a pessoa lê e o comando/texto que volta para o bot quando tocado.' },
      { chave: 'footer', rotulo: 'Rodapé', ajuda: 'Opcional, texto curto exibido abaixo dos botões.' },
      { chave: 'fallbackText', rotulo: 'Texto de reserva', ajuda: 'Enviado como texto simples quando a mensagem interativa for recusada.' }
    ]
  },
  {
    tipo: 'action.whatsapp.carousel',
    rotulo: 'Mostrar carrossel de fotos',
    familia: 'midia',
    resumo: 'Envia uma mensagem interativa com cards deslizáveis a partir de uma pasta do acervo ou de cards declarados diretamente, com título, imagem, descrição e botão.',
    exemplo: 'Alguém digita "/catalogo" e recebe um carrossel com fotos de produtos e botões para pedir.',
    ressalva: {
      level: 'compatibility',
      text: 'Carrossel de cards é mensagem interativa e depende do aplicativo de quem recebe. Se o aplicativo não renderizar mas aceitar, não há erro visível; se o envio falhar, o bot envia a lista descrita em texto. Os arquivos passam pelo carregador tardio e orçamento de bytes sob demanda.'
    },
    campos: [
      { chave: 'text', rotulo: 'Texto de abertura', ajuda: 'Texto exibido antes ou no cabeçalho do carrossel. Aceita variáveis.' },
      { chave: 'folder', rotulo: 'Pasta do acervo', ajuda: 'Nome da pasta no Acervo com as fotos para montar os cards. Aceita variáveis.' },
      { chave: 'cards', rotulo: 'Cards declarados', ajuda: 'Lista de cards configurados diretamente no comando, cada um com sua imagem do acervo, título, corpo e botão.' },
      { chave: 'buttonText', rotulo: 'Texto do botão padrão', ajuda: 'Rótulo padrão dos botões nos cards da pasta do acervo. Aceita variáveis como {{nome}}.' },
      { chave: 'buttonCommand', rotulo: 'Comando do botão padrão', ajuda: 'Texto que volta ao tocar no botão para cards da pasta. Aceita {{nome}}, {{id}}, {{caminho}} e {{n}}.' },
      { chave: 'footer', rotulo: 'Rodapé', ajuda: 'Opcional, texto curto exibido no rodapé do carrossel.' },
      { chave: 'estilo', rotulo: 'Estilo do carrossel', ajuda: 'Forma da mensagem interativa: completo, simples, semEmbrulho, bizNoStanza, fluxoNoTopo, diagnóstico, botoes ou menu.' },
      { chave: 'fallbackText', rotulo: 'Texto de reserva', ajuda: 'Texto enviado quando o carrossel interativo for recusado pelo aplicativo.' },
      { chave: 'notFoundText', rotulo: 'Se a pasta estiver vazia', ajuda: 'Mensagem enviada quando a pasta do acervo não tiver fotos ou o arquivo não existir.' }
    ]
  },
  {
    tipo: 'action.whatsapp.stickerPack',
    rotulo: 'Enviar pacote de figurinhas',
    familia: 'midia',
    resumo: 'Envia um conjunto de figurinhas do acervo como pacote nativo do WhatsApp ou como arquivo .wastickers para importar em aplicativo de figurinhas.',
    exemplo: 'Alguém digita "/pacote" e recebe as figurinhas da pasta em um pacote só.',
    ressalva: {
      level: 'compatibility',
      text: 'O envio nativo de pacote via protocolo usa o campo da biblioteca (stickerPackMessage), mas ainda NÃO foi medido em número real neste aparelho: se o aplicativo recusar, não há erro em lugar nenhum (o envio é confirmado e a conversa fica vazia). A forma "arquivo" entrega o pacote em formato .wastickers como documento, que pode ser aberto em apps de figurinhas (como o Sticker Maker). A forma "diagnóstico" manda as duas formas numeradas de uma vez para medição.'
    },
    campos: [
      { chave: 'name', rotulo: 'Nome do pacote', ajuda: 'Título do pacote de figurinhas. Aceita variáveis.' },
      { chave: 'folder', rotulo: 'Pasta do acervo', ajuda: 'Nome da pasta no Acervo com as figurinhas. Aceita variáveis.' },
      { chave: 'author', rotulo: 'Autor do pacote', ajuda: 'Nome do criador ou autor do pacote. Aceita variáveis.' },
      { chave: 'forma', rotulo: 'Forma de envio', ajuda: 'pacote = envio nativo pelo protocolo do WhatsApp · arquivo = documento .wastickers para abrir em app terceiro · diagnóstico = manda as duas formas numeradas de uma vez para medir qual chega.' },
      { chave: 'caption', rotulo: 'Legenda', ajuda: 'Texto que acompanha o pacote ou documento. Aceita variáveis.' },
      { chave: 'notFoundText', rotulo: 'Se a pasta estiver vazia', ajuda: 'Mensagem enviada quando a pasta não tiver figurinhas ou o arquivo não existir.' },
      { chave: 'fallbackText', rotulo: 'Texto de reserva', ajuda: 'Texto enviado quando o envio do pacote for recusado.' }
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
  { id: 'not_contains', rotulo: 'não contém', ajuda: 'Como texto, sem diferenciar maiúscula.' },
  { id: 'starts_with', rotulo: 'começa com', ajuda: 'Confere o COMEÇO do texto, não qualquer posição. É a diferença entre "o número começa com 55" e "o número tem 55 em algum lugar" — a segunda deixa passar um número estrangeiro que tenha 55 no meio.' },
  { id: 'not_starts_with', rotulo: 'não começa com', ajuda: 'O contrário do anterior. Sem valor nenhum para comparar, as duas são falsas: "não sei" nunca vira "sim".' }
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
  { id: 'global', rotulo: 'Do sistema todo', ajuda: 'Não pertence a ninguém. Serve para totais gerais e para configuração.', usoNoTexto: '{{var.global.<chave>}}' },
  { id: 'local', rotulo: 'Desta execução (local)', ajuda: 'Vale só durante a execução deste fluxo e não grava atributo no banco: não persiste para a próxima mensagem.', usoNoTexto: '{{var.local.<chave>}}' }
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
