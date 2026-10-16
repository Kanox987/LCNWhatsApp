// Conexões: as APIs externas que as automações podem consultar.
//
// POR QUE ESTA TELA FOI REESCRITA
//
// O dono olhou a aba e disse, com razão: "a conexão ainda está limpa, não está
// aparecendo a API, muito menos a configuração dela. Mesmo que ela seja local,
// a conexão ainda tem que aparecer. Senão tá escondido no código."
//
// Estava mesmo. O comando dizia `baixa "{{message.link}}"` e nada respondia às
// perguntas dele: para ONDE vai essa URL? para QUEM? O serviço morava no
// config.json, invisível, e a tela antiga mostrava um textarea de JSON cru —
// que é esconder com mais passos.
//
// Então o que esta tela precisa deixar óbvio, nesta ordem:
//   1. o ENDEREÇO — para quem a chamada vai;
//   2. as FUNÇÕES — o que dá para pedir a esse serviço, com as entradas à vista;
//   3. a CREDENCIAL — se existe, e para onde ela viaja (ou não).
import { api } from '../api.js'
import { badge, button, el, emptyState, errorState, field, formatDate, notify, setBusy, setPageHeader } from '../ui.js'

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
// `mídia` é entrada de ARQUIVO — a foto, o vídeo, o áudio que chegou pela
// conversa. Faltava nesta lista, e sem ela o serviço de figurinha era
// impossível de declarar pelo painel: quem abrisse a conexão para mexer em
// outra coisa salvava as funções de imagem sem a entrada do arquivo.
const TIPOS = ['texto', 'número', 'opção', 'liga/desliga', 'mídia']
const FORMAS = [
  ['texto', 'Texto — a resposta já vem pronta'],
  ['mídia', 'Mídia — a resposta aponta os arquivos para buscar'],
  ['arquivo', 'Arquivo — o arquivo vem na própria resposta, em base64'],
  ['lista', 'Lista — a resposta traz várias opções para escolher'],
  ['trabalho', 'Trabalho — o serviço devolve um identificador e a gente acompanha']
]
// Como o arquivo que volta é ENVIADO. Vazio deduz do tipo do arquivo, que é o
// certo para uma conversão: a saída depende do formato pedido na chamada.
const TIPOS_DE_ENVIO = [
  ['', 'Deduzir do tipo do arquivo'],
  ['figurinha', 'Figurinha'],
  ['foto', 'Foto'],
  ['vídeo', 'Vídeo'],
  ['áudio', 'Áudio'],
  ['documento', 'Documento']
]

const ehUrlInteira = (caminho) => /^https?:\/\//i.test(String(caminho || ''))

// Para onde a chamada REALMENTE vai, e se a credencial vai junto.
//
// É a mesma regra do motor (`resolverDestino`), repetida aqui só para MOSTRAR.
// Quem edita precisa ver a consequência antes de salvar: trocar o caminho por
// uma URL de outro host faz a credencial ficar para trás, e descobrir isso
// depois, por uma chamada que falha com 401, é caro.
function destinoDe (endereco, funcao) {
  if (!ehUrlInteira(funcao.caminho)) {
    return { url: `${endereco || ''}${funcao.caminho || ''}`, levaSegredo: true }
  }
  try {
    return { url: funcao.caminho, levaSegredo: new URL(endereco).origin === new URL(funcao.caminho).origin }
  } catch {
    return { url: funcao.caminho, levaSegredo: false }
  }
}

// --- editor de uma entrada ------------------------------------------------
function linhaDeEntrada (entrada, aoRemover) {
  const nome = el('input', { type: 'text', value: entrada?.nome || '', placeholder: 'url' })
  const tipo = el('select', {}, TIPOS.map((t) => el('option', { value: t, selected: (entrada?.tipo || 'texto') === t, text: t })))
  const opcoes = el('input', { type: 'text', value: (entrada?.opcoes || []).join(', '), placeholder: 'auto, video, audio' })
  const obrigatoria = el('input', { type: 'checkbox', checked: entrada?.obrigatoria !== false })

  // O PADRÃO TEM DUAS CARAS, e é isso que o dono apontou: onde existe uma lista,
  // ele não pode ser caixa de texto.
  //
  // O `modo` do download tem quatro escolhas, e o padrão dele era campo livre —
  // dava para digitar "gif" e salvar. O motor recusa isso agora, mas oferecer o
  // campo errado transforma uma escolha de três cliques num erro de digitação
  // que só aparece na hora da chamada.
  const padraoTexto = el('input', { type: 'text', value: entrada?.padrao ?? '', placeholder: 'sem padrão' })
  const padraoLista = el('select', {})
  const encherPadraoLista = () => {
    const atual = padraoLista.value || entrada?.padrao || ''
    const escolhas = opcoes.value.split(',').map((o) => o.trim()).filter(Boolean)
    padraoLista.replaceChildren(
      el('option', { value: '', text: 'sem padrão' }),
      ...escolhas.map((o) => el('option', { value: o, selected: o === atual, text: o }))
    )
  }
  opcoes.addEventListener('input', encherPadraoLista)

  const campoOpcoes = field('Escolhas', opcoes, 'Separadas por vírgula.')
  const campoPadraoTexto = field('Padrão', padraoTexto, 'Usado quando a automação não informa.')
  const campoPadraoLista = field('Padrão', padraoLista, 'Usado quando a automação não informa.')
  const ehLista = () => tipo.value === 'opção'
  const atualizarResumoRef = {}
  const sincronizar = () => {
    campoOpcoes.hidden = !ehLista()
    // manter o resumo honesto quando o tipo muda
    if (typeof atualizarResumoRef.fn === 'function') atualizarResumoRef.fn()
    campoPadraoLista.hidden = !ehLista()
    campoPadraoTexto.hidden = ehLista()
    if (ehLista()) encherPadraoLista()
  }
  tipo.addEventListener('change', sincronizar)
  sincronizar()

  // FECHADA POR PADRÃO.
  //
  // O dono olhou este formulário e disse "tem muita coisa aqui, cara". Tinha:
  // cada entrada ocupava um painel inteiro, então uma função com duas entradas
  // enchia a tela de campos que quase nunca se mexe. Uma linha por entrada, que
  // abre quando precisa, mostra a mesma informação sem exigir leitura.
  //
  // O resumo é gerado do estado real e atualizado enquanto se digita — resumo
  // que descola do conteúdo é pior que não ter resumo.
  const resumo = el('summary')
  const atualizarResumo = () => {
    const n = nome.value.trim() || '(sem nome)'
    const detalhe = ehLista()
      ? opcoes.value.split(',').map((o) => o.trim()).filter(Boolean).join(' · ') || 'sem escolhas'
      : tipo.value
    const marca = obrigatoria.checked ? '' : ' · opcional'
    resumo.textContent = `${n} — ${detalhe}${marca}`
  }
  for (const campo of [nome, opcoes, padraoTexto]) campo.addEventListener('input', atualizarResumo)
  for (const campo of [tipo, padraoLista, obrigatoria]) campo.addEventListener('change', atualizarResumo)
  atualizarResumoRef.fn = atualizarResumo

  const linha = el('details', { className: 'panel stack' }, [
    resumo,
    el('div', { className: 'form-grid' }, [
      field('Nome', nome, 'É por ele que a automação passa o valor.'),
      field('Tipo', tipo)
    ]),
    campoOpcoes,
    el('div', { className: 'form-grid' }, [
      campoPadraoTexto,
      campoPadraoLista,
      field('Obrigatória', obrigatoria)
    ]),
    el('div', { className: 'button-row' }, [button('Remover entrada', { variant: 'danger-quiet', onClick: () => aoRemover(linha) })])
  ])
  atualizarResumo()
  // Entrada nova nasce ABERTA: quem acabou de clicar em "adicionar" quer
  // preencher, não abrir de novo.
  if (!entrada) linha.open = true
  linha.ler = () => {
    const saida = { nome: nome.value.trim(), tipo: tipo.value, obrigatoria: obrigatoria.checked }
    const padrao = (ehLista() ? padraoLista.value : padraoTexto.value).trim()
    if (ehLista()) saida.opcoes = opcoes.value.split(',').map((o) => o.trim()).filter(Boolean)
    if (padrao) saida.padrao = padrao
    return saida
  }
  return linha
}

// --- editor de uma função -------------------------------------------------
function editorDeFuncao (funcao, { endereco, aoRemover }) {
  const nome = el('input', { type: 'text', value: funcao?.nome || '', placeholder: 'baixar' })
  const descricao = el('input', { type: 'text', value: funcao?.descricao || '', placeholder: 'O que esta função faz' })
  const metodo = el('select', {}, METODOS.map((m) => el('option', { value: m, selected: (funcao?.metodo || 'POST') === m, text: m })))
  const caminho = el('input', { type: 'text', value: funcao?.caminho || '', placeholder: '/download' })

  const entradas = el('div', { className: 'stack' })
  const removerEntrada = (linha) => linha.remove()
  for (const e of funcao?.entradas || []) entradas.append(linhaDeEntrada(e, removerEntrada))

  const forma = el('select', {}, FORMAS.map(([v, rotulo]) => el('option', { value: v, selected: (funcao?.resposta?.forma || 'texto') === v, text: rotulo })))
  const campoDoTrabalho = el('input', { type: 'text', value: funcao?.resposta?.campoDoTrabalho || '', placeholder: 'job' })
  const caminhoDeAcompanhamento = el('input', { type: 'text', value: funcao?.resposta?.caminhoDeAcompanhamento || '', placeholder: '/jobs/{job}' })
  const campoDoEstado = el('input', { type: 'text', value: funcao?.resposta?.campoDoEstado || '', placeholder: 'estado' })
  const estadosEmAndamento = el('input', { type: 'text', value: (funcao?.resposta?.estadosEmAndamento || []).join(', '), placeholder: 'na_fila, baixando' })
  const campoDoResultado = el('input', { type: 'text', value: funcao?.resposta?.campoDoResultado || '', placeholder: 'midias' })
  const campoDoErro = el('input', { type: 'text', value: funcao?.resposta?.campoDoErro || '', placeholder: 'erro' })  // do acompanhamento de trabalho
  const campoDaDescricao = el('input', { type: 'text', value: funcao?.resposta?.campoDaDescricao || '', placeholder: 'descricao' })
  // Um input por bloco, e não um compartilhado: `field()` ANEXA o nó, e o
  // mesmo nó em dois blocos desapareceria do primeiro.
  const campoSimples = el('input', { type: 'text', value: funcao?.resposta?.campo || '', placeholder: 'resposta' })
  const erroSimples = el('input', { type: 'text', value: funcao?.resposta?.campoDoErro || '', placeholder: 'erro' })
  const campoDoArquivo = el('input', { type: 'text', value: funcao?.resposta?.campo || '', placeholder: 'arquivo_base64' })
  const erroDoArquivo = el('input', { type: 'text', value: funcao?.resposta?.campoDoErro || '', placeholder: 'mensagem' })
  const campoDaLista = el('input', { type: 'text', value: funcao?.resposta?.campo || '', placeholder: 'achados' })
  const erroDaLista = el('input', { type: 'text', value: funcao?.resposta?.campoDoErro || '', placeholder: 'detail' })
  const campoDoMime = el('input', { type: 'text', value: funcao?.resposta?.campoDoMime || '', placeholder: 'mime' })
  const tipoDeEnvio = el('select', {}, TIPOS_DE_ENVIO.map(([v, rotulo]) => el('option', { value: v, selected: (funcao?.resposta?.tipo || '') === v, text: rotulo })))
  const linhaDaLista = el('input', { type: 'text', value: funcao?.resposta?.linha || '', placeholder: '{{n}}. {{titulo}} — {{autor}}' })
  const cabecalhoDaLista = el('input', { type: 'text', value: funcao?.resposta?.cabecalho || '', placeholder: 'Achei isto:' })
  const vazioDaLista = el('input', { type: 'text', value: funcao?.resposta?.vazio || '', placeholder: 'Não achei nada com esse nome.' })
  const limiteDaLista = el('input', { type: 'number', min: '1', step: '1', value: funcao?.resposta?.limite ?? '' })
  // QUANTO ESPERAR por esta função. Estava só na declaração, invisível na tela:
  // quem trocasse o serviço de melhoria de foto por outro não tinha como dizer
  // que ele demora dois minutos, e a chamada morria aos vinte segundos.
  const espera = el('input', { type: 'number', min: '1', max: '900', step: '1', value: funcao?.esperaSegundos ?? '' })

  const blocoSimples = el('div', { className: 'form-grid' }, [
    field('Campo da resposta', campoSimples, 'Opcional: de qual campo tirar o resultado.'),
    field('Campo do erro', erroSimples, 'Opcional: a frase que o serviço escreve para quem usou o comando.')
  ])
  // O protocolo de acompanhamento também nasce fechado. Nas conexões prontas
  // ele já vem correto, e quem está ligando uma IA nunca precisa abri-lo — mas
  // ele fica ali, à mão, que era o ponto: não pode estar escondido no código.
  const blocoTrabalho = el('details', { className: 'panel stack' }, [
    el('summary', { text: 'Como acompanhar o trabalho até terminar' }),
    el('p', { className: 'muted compact', text: 'O serviço não devolve o resultado na hora: ele devolve um identificador e a gente pergunta até terminar. É assim que o serviço de download funciona.' }),
    el('div', { className: 'form-grid' }, [
      field('Campo do identificador', campoDoTrabalho, 'Onde vem o id do trabalho na primeira resposta.'),
      field('Caminho para acompanhar', caminhoDeAcompanhamento, 'Use {job} onde o id entra.')
    ]),
    el('div', { className: 'form-grid' }, [
      field('Campo do estado', campoDoEstado),
      field('Estados de "ainda não acabou"', estadosEmAndamento, 'Separados por vírgula. Sem isto não se sabe quando parar de perguntar.')
    ]),
    el('div', { className: 'form-grid' }, [
      field('Campo do resultado', campoDoResultado),
      field('Campo do erro', campoDoErro, 'Opcional.')
    ]),
    field('Campo da legenda', campoDaDescricao, 'Opcional: de onde sai o texto que acompanha o que foi entregue. Vazio usa "descricao".')
  ])
  const blocoArquivo = el('div', { className: 'stack' }, [
    el('p', { className: 'muted compact', text: 'O serviço converte em segundos e devolve o arquivo na resposta, em base64. É a forma das funções de figurinha e de conversão.' }),
    el('div', { className: 'form-grid' }, [
      field('Campo do arquivo', campoDoArquivo, 'Onde vem o conteúdo em base64.'),
      field('Campo do tipo do arquivo', campoDoMime, 'Opcional: de onde sai o mime.')
    ]),
    el('div', { className: 'form-grid' }, [
      field('Como enviar', tipoDeEnvio, 'Figurinha não é foto com outro nome: é outro tipo de envio, sem legenda.'),
      field('Campo do erro', erroDoArquivo, 'Opcional: a frase que o serviço escreve para quem usou o comando.')
    ])
  ])

  const blocoLista = el('div', { className: 'stack' }, [
    el('p', { className: 'muted compact', text: 'A resposta traz várias opções e o bot manda um texto numerado. É a forma da busca.' }),
    el('div', { className: 'form-grid' }, [
      field('Campo da lista', campoDaLista, 'Onde vem a lista na resposta.'),
      field('Como escrever cada item', linhaDaLista, 'Use {{n}} para o número e {{campo}} para os campos do item.')
    ]),
    el('div', { className: 'form-grid' }, [
      field('Primeira linha', cabecalhoDaLista, 'Opcional: aceita {{campo}} da resposta.'),
      field('Quando não vier nada', vazioDaLista, 'Opcional.')
    ]),
    el('div', { className: 'form-grid' }, [
      field('Quantos itens mostrar', limiteDaLista, 'Opcional: vazio mostra todos os que vierem.'),
      field('Campo do erro', erroDaLista, 'Opcional.')
    ])
  ])

  const sincronizarForma = () => {
    blocoTrabalho.hidden = forma.value !== 'trabalho'
    blocoArquivo.hidden = forma.value !== 'arquivo'
    blocoLista.hidden = forma.value !== 'lista'
    blocoSimples.hidden = forma.value !== 'texto' && forma.value !== 'mídia'
  }
  forma.addEventListener('change', sincronizarForma)
  sincronizarForma()

  // O aviso de destino, ao vivo: mostra para onde vai e se a credencial segue.
  const aviso = el('div', { className: 'notice notice-info compact' })
  const atualizarAviso = () => {
    const d = destinoDe(endereco(), { caminho: caminho.value })
    aviso.replaceChildren(
      el('strong', { text: `${metodo.value} ${d.url || '(sem caminho)'}` }),
      el('p', {
        text: d.levaSegredo
          ? 'A credencial desta conexão vai junto.'
          : 'Outro serviço: a credencial desta conexão NÃO vai junto — a chamada sai sem autenticação.'
      })
    )
    aviso.className = d.levaSegredo ? 'notice notice-info compact' : 'notice notice-warning compact'
  }
  caminho.addEventListener('input', atualizarAviso)
  metodo.addEventListener('change', atualizarAviso)
  atualizarAviso()

  const cartao = el('article', { className: 'panel stack-lg' }, [
    el('div', { className: 'form-grid' }, [
      field('Nome da função', nome, 'A automação chama por este nome.'),
      field('Método', metodo)
    ]),
    field('Descrição', descricao),
    field('Caminho', caminho, 'Relativo ao endereço da conexão (/download) ou uma URL inteira de outro serviço.'),
    field('Quanto esperar, em segundos', espera, 'Opcional, de 1 a 900. Vazio usa 20 segundos. Função que pensa (melhorar foto, IA) precisa de mais.'),
    aviso,
    el('div', { className: 'section-heading' }, [
      el('div', {}, [el('h3', { text: 'Entradas' }), el('p', { className: 'muted compact', text: 'O que a automação informa ao chamar.' })]),
      button('Adicionar entrada', { onClick: () => entradas.append(linhaDeEntrada(null, removerEntrada)) })
    ]),
    entradas,
    el('h3', { text: 'Resposta' }),
    field('Como a resposta chega', forma),
    blocoSimples,
    blocoArquivo,
    blocoLista,
    blocoTrabalho,
    el('div', { className: 'button-row' }, [button('Remover função', { variant: 'danger-quiet', onClick: () => aoRemover(cartao) })])
  ])

  cartao.atualizarDestino = atualizarAviso
  cartao.ler = () => {
    const saida = {
      nome: nome.value.trim(),
      descricao: descricao.value.trim(),
      metodo: metodo.value,
      caminho: caminho.value.trim(),
      entradas: [...entradas.children].map((l) => l.ler())
    }
    const segundos = Number(espera.value)
    if (Number.isFinite(segundos) && segundos > 0) saida.esperaSegundos = Math.round(segundos)
    if (forma.value === 'trabalho') {
      saida.resposta = {
        forma: 'trabalho',
        campoDoTrabalho: campoDoTrabalho.value.trim(),
        caminhoDeAcompanhamento: caminhoDeAcompanhamento.value.trim(),
        campoDoEstado: campoDoEstado.value.trim(),
        estadosEmAndamento: estadosEmAndamento.value.split(',').map((e) => e.trim()).filter(Boolean),
        campoDoResultado: campoDoResultado.value.trim(),
        campoDaDescricao: campoDaDescricao.value.trim() || null,
        campoDoErro: campoDoErro.value.trim() || null
      }
    } else if (forma.value === 'arquivo') {
      saida.resposta = {
        forma: 'arquivo',
        campo: campoDoArquivo.value.trim(),
        campoDoMime: campoDoMime.value.trim() || null,
        tipo: tipoDeEnvio.value || null,
        campoDoErro: erroDoArquivo.value.trim() || null
      }
    } else if (forma.value === 'lista') {
      const limite = Number(limiteDaLista.value)
      saida.resposta = {
        forma: 'lista',
        campo: campoDaLista.value.trim(),
        linha: linhaDaLista.value.trim(),
        cabecalho: cabecalhoDaLista.value.trim() || null,
        vazio: vazioDaLista.value.trim() || null,
        limite: Number.isFinite(limite) && limite > 0 ? Math.round(limite) : null,
        campoDoErro: erroDaLista.value.trim() || null
      }
    } else {
      saida.resposta = { forma: forma.value, campo: campoSimples.value.trim() || null, campoDoErro: erroSimples.value.trim() || null }
    }
    return saida
  }
  return cartao
}

// --- o formulário da conexão inteira --------------------------------------
function formularioDeConexao ({ conexao = null, modelo = null, fechar, refresh }) {
  const editando = Boolean(conexao)
  const partida = conexao || modelo
  const idInput = el('input', { type: 'text', value: partida?.id || '', placeholder: 'minha-ia', disabled: editando })
  const enderecoInput = el('input', { type: 'text', value: partida?.config?.endereco || '', placeholder: 'https://api.exemplo.com' })

  const funcoes = el('div', { className: 'stack-lg' })
  const removerFuncao = (cartao) => cartao.remove()
  const lerEndereco = () => enderecoInput.value.trim()
  const adicionar = (f) => funcoes.append(editorDeFuncao(f, { endereco: lerEndereco, aoRemover: removerFuncao }))
  for (const f of partida?.config?.funcoes || []) adicionar(f)
  // Trocar o endereço muda para onde TODAS as funções relativas apontam.
  enderecoInput.addEventListener('input', () => {
    for (const c of funcoes.children) c.atualizarDestino?.()
  })

  // A CREDENCIAL, PERGUNTADA DO LADO DE QUEM RESPONDE.
  //
  // Aqui estava escrito "Nome do campo — como o serviço chama a credencial
  // dele?", com "token" preenchido. O dono olhou e disse: "nem eu que sou
  // programador estou entendendo que bagaça é pra fazer aqui".
  //
  // Ele tinha razão, e o defeito era o mesmo do `baixa` escondido no código: o
  // formato INTERNO de armazenamento (as chaves do secret_json) vazando como se
  // fosse pergunta ao usuário. Ninguém tem essa resposta na cabeça.
  //
  // O que a pessoa tem é uma chave na mão e uma documentação dizendo como
  // mandá-la. Então é isso que se pergunta — com as formas descritas pelo que
  // ela RECONHECE na documentação, não pelo nome técnico.
  const AUTENTICACOES = [
    ['nenhuma', 'Não precisa de chave — o serviço é aberto'],
    ['bearer', 'Chave de API — a documentação diz "Bearer" ou "Authorization"'],
    ['cabeçalho', 'Cabeçalho próprio — a documentação mostra algo como  X-API-Key: sua-chave'],
    ['parâmetro', 'Na própria URL — a documentação mostra algo como  ?api_key=sua-chave']
  ]
  const autenticacaoAtual = partida?.config?.autenticacao?.tipo || (editando ? 'nenhuma' : 'bearer')
  const autenticacao = el('select', {}, AUTENTICACOES.map(([v, rotulo]) =>
    el('option', { value: v, selected: autenticacaoAtual === v, text: rotulo })))
  const nomeDoCabecalho = el('input', {
    type: 'text',
    value: partida?.config?.autenticacao?.nome || '',
    placeholder: 'X-API-Key'
  })
  // DE ONDE a chave vem. Colar é o pedido do dono (quem aluga não tem
  // terminal); arquivo é a forma que já existia, e para quem tem terminal ela
  // continua melhor: a chave não entra no banco nem em backup do banco.
  const ORIGENS = [
    ['colada', 'Colar a chave aqui'],
    ['arquivo', 'Ler de um arquivo no servidor']
  ]
  const origemAtual = partida?.config?.autenticacao?.origem || 'colada'
  const origem = el('select', {}, ORIGENS.map(([v, rotulo]) =>
    el('option', { value: v, selected: origemAtual === v, text: rotulo })))
  const arquivoInput = el('input', {
    type: 'text',
    value: partida?.config?.autenticacao?.arquivo || '',
    placeholder: '~/meu-servico/.token'
  })
  const segredoInput = el('input', {
    type: 'password',
    autocomplete: 'new-password',
    placeholder: editando && conexao.segredoDefinido ? '•••••••• (já guardada)' : 'cole a chave aqui'
  })
  const apagarSegredo = el('input', { type: 'checkbox' })
  const campoOrigem = field('De onde vem a chave', origem)
  const campoArquivo = field('Caminho do arquivo', arquivoInput, 'O conteúdo do arquivo é a chave. Ele nunca é copiado para o banco.')

  const campoNome = field('Nome que a documentação usa', nomeDoCabecalho, 'O texto antes dos dois-pontos, ou o nome do parâmetro.')
  const campoValor = field('Sua chave', segredoInput, editando
    ? 'Deixe vazio para manter a que já está guardada. Ela nunca volta para a tela.'
    : 'Enviada uma vez. Depois de salva, nunca mais é devolvida pela API.')
  const exemplo = el('p', { className: 'muted compact' })
  const sincronizarAutenticacao = () => {
    const tipo = autenticacao.value
    const precisaNome = tipo === 'cabeçalho' || tipo === 'parâmetro'
    campoNome.hidden = !precisaNome
    campoOrigem.hidden = tipo === 'nenhuma'
    campoArquivo.hidden = tipo === 'nenhuma' || origem.value !== 'arquivo'
    campoValor.hidden = tipo === 'nenhuma' || origem.value !== 'colada'
    const nome = nomeDoCabecalho.value.trim() || (tipo === 'cabeçalho' ? 'X-API-Key' : 'api_key')
    exemplo.textContent = tipo === 'nenhuma'
      ? 'As chamadas saem sem autenticação nenhuma.'
      : tipo === 'bearer'
        ? 'Vai assim na chamada:  Authorization: Bearer sua-chave'
        : tipo === 'cabeçalho'
          ? `Vai assim na chamada:  ${nome}: sua-chave`
          : `Vai assim na chamada:  ...?${nome}=sua-chave`
  }
  autenticacao.addEventListener('change', sincronizarAutenticacao)
  origem.addEventListener('change', sincronizarAutenticacao)
  nomeDoCabecalho.addEventListener('input', sincronizarAutenticacao)
  sincronizarAutenticacao()

  const mensagem = el('div')
  const salvar = button(editando ? 'Salvar conexão' : 'Criar conexão', { variant: 'primary', type: 'submit' })

  const form = el('form', { className: 'panel stack-lg' }, [
    el('div', { className: 'panel-heading' }, [
      el('div', {}, [
        el('h2', { text: editando ? `Editar ${conexao.id}` : (modelo ? `Nova conexão a partir de "${modelo.id}"` : 'Nova conexão') }),
        el('p', { text: 'Um serviço externo que as automações podem consultar. O LCN não acessa a web sozinho — toda consulta passa por uma conexão declarada aqui.' })
      ]),
      fechar ? button('Fechar', { variant: 'quiet', onClick: fechar }) : null
    ]),
    el('div', { className: 'form-grid' }, [
      field('Identificador', idInput, 'A automação escreve este nome para chamar o serviço.'),
      field('Endereço do serviço', enderecoInput, 'Para onde as chamadas vão. http ou https.')
    ]),
    el('h3', { text: 'Como este serviço pede autenticação' }),
    field('Forma', autenticacao),
    exemplo,
    campoNome,
    campoOrigem,
    campoArquivo,
    campoValor,
    editando && conexao.segredoDefinido
      ? field('Apagar a chave guardada', apagarSegredo, 'Marque para remover. As chamadas passam a sair sem autenticação.')
      : null,
    el('div', { className: 'section-heading' }, [
      el('div', {}, [
        el('h3', { text: 'Funções' }),
        el('p', { className: 'muted compact', text: 'O que dá para pedir a este serviço. Cada função vira algo que uma automação pode chamar.' })
      ]),
      button('Adicionar função', { onClick: () => adicionar(null) })
    ]),
    funcoes,
    mensagem,
    el('div', { className: 'button-row' }, [salvar, fechar ? button('Cancelar', { onClick: fechar }) : null])
  ].filter(Boolean))

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    mensagem.replaceChildren()
    setBusy(salvar, true, 'Salvando…')
    try {
      const id = idInput.value.trim()
      if (!id) throw new Error('Informe o identificador da conexão.')
      const auth = { tipo: autenticacao.value }
      if (auth.tipo === 'cabeçalho' || auth.tipo === 'parâmetro') auth.nome = nomeDoCabecalho.value.trim()
      if (auth.tipo !== 'nenhuma') {
        auth.origem = origem.value
        if (origem.value === 'arquivo') auth.arquivo = arquivoInput.value.trim()
      }
      const corpo = {
        kind: 'http',
        config: { endereco: lerEndereco(), autenticacao: auth, funcoes: [...funcoes.children].map((c) => c.ler()) }
      }
      // As três intenções separadas, como o motor espera: ausente mantém,
      // null apaga, objeto substitui. O nome da chave guardada é sempre
      // `valor` — COMO ela viaja é a declaração, não o nome do campo.
      // Chave de arquivo não tem nada para guardar no banco — o banco só sabe
      // ONDE ela está.
      if (apagarSegredo.checked || auth.tipo === 'nenhuma' || auth.origem === 'arquivo') corpo.secret = null
      else if (segredoInput.value) corpo.secret = { valor: segredoInput.value }

      if (editando) await api.connections.update(conexao.id, corpo)
      else await api.connections.create({ id, ...corpo })
      notify(editando ? 'Conexão atualizada.' : 'Conexão criada.')
      await refresh()
    } catch (erro) {
      mensagem.replaceChildren(errorState(erro))
    } finally {
      setBusy(salvar, false)
    }
  })
  return form
}

// --- o cartão de leitura --------------------------------------------------
function cartaoDeConexao (conexao, { editar, refresh }) {
  const funcoes = conexao.config?.funcoes || []
  const endereco = conexao.config?.endereco || '(sem endereço)'

  const listaDeFuncoes = funcoes.length
    ? funcoes.map((f) => {
        const d = destinoDe(conexao.config?.endereco, f)
        return el('div', { className: 'panel compact stack' }, [
          el('div', { className: 'list-card-main' }, [
            el('div', {}, [
              el('h4', { text: f.nome }),
              f.descricao ? el('p', { className: 'muted compact', text: f.descricao }) : null
            ].filter(Boolean)),
            badge(`${f.metodo} ${d.url}`, d.levaSegredo ? 'info' : 'warning')
          ]),
          f.entradas?.length
            ? el('p', { className: 'muted compact', text: `Recebe: ${f.entradas.map((e) => e.opcoes?.length ? `${e.nome} (${e.opcoes.join(' · ')})` : e.nome).join(', ')}` })
            : el('p', { className: 'muted compact', text: 'Não recebe nada.' }),
          el('p', { className: 'muted compact', text: `Responde: ${f.resposta?.forma || '—'}` })
        ])
      })
    : [el('p', { className: 'muted', text: 'Nenhuma função declarada ainda. Sem função, nada pode ser pedido a este serviço.' })]

  return el('article', { className: 'list-card stack' }, [
    el('div', { className: 'list-card-main' }, [
      el('div', {}, [
        el('p', { className: 'mono overline', text: conexao.id }),
        el('h2', { text: endereco })
      ]),
      // O que importa aqui é COMO ela autentica, não como o campo se chama por
      // dentro. `valor` é detalhe de armazenamento e não diz nada a ninguém.
      // O estado vem do MOTOR, que é quem consegue conferir se a chave de
      // arquivo realmente resolve. A tela dizia "Falta a chave" olhando só o
      // banco — e apontava falta numa chave que existia e funcionava.
      (() => {
        const auth = conexao.config?.autenticacao || { tipo: 'nenhuma' }
        const cred = conexao.credencial || {}
        if (!cred.necessaria) return badge('Sem autenticação', 'neutral')
        if (!cred.resolvida) return badge(cred.motivo || 'Falta a chave', 'warning')
        const comoViaja = auth.tipo === 'bearer'
          ? 'Authorization: Bearer'
          : auth.tipo === 'cabeçalho' ? auth.nome : `?${auth.nome}=`
        const daOnde = cred.origem === 'arquivo' ? ` · do arquivo ${cred.arquivo}` : ''
        return badge(`Chave via ${comoViaja}${daOnde}`, 'success')
      })()
    ]),
    ...listaDeFuncoes,
    el('small', { className: 'muted', text: `Atualizada em ${formatDate(conexao.updatedAt)}` }),
    el('div', { className: 'button-row' }, [
      button('Editar', { variant: 'quiet', onClick: () => editar(conexao) }),
      button('Remover', {
        variant: 'danger-quiet',
        onClick: async (evento) => {
          if (!window.confirm(`Remover a conexão "${conexao.id}"? As automações que a chamam param de funcionar.`)) return
          const controle = evento.currentTarget
          setBusy(controle, true, 'Removendo…')
          try {
            await api.connections.remove(conexao.id)
            notify('Conexão removida.')
            await refresh()
          } catch (erro) {
            notify(erro.message, 'danger')
            setBusy(controle, false)
          }
        }
      })
    ])
  ])
}

export async function renderConnections ({ refresh }) {
  setPageHeader({
    eyebrow: 'Serviços externos',
    title: 'Conexões',
    description: 'As APIs que as automações podem consultar. O LCN não acessa a web sozinho — toda consulta externa passa por uma conexão declarada aqui.',
    actions: [button('Atualizar', { onClick: refresh })]
  })

  const [conexoes, prontas] = await Promise.all([
    api.connections.list(),
    api.connections.prontas().catch(() => [])
  ])

  const raiz = el('div', { className: 'connections-layout' })
  const coluna = el('div', { className: 'stack' })
  const editor = el('div')
  const abrir = (conexao = null, modelo = null) =>
    editor.replaceChildren(formularioDeConexao({ conexao, modelo, fechar: () => editor.replaceChildren(), refresh }))

  coluna.append(el('div', { className: 'section-heading' }, [
    el('div', {}, [
      el('h2', { text: 'Serviços cadastrados' }),
      el('p', { text: conexoes.length === 1 ? '1 serviço.' : `${conexoes.length} serviços.` })
    ]),
    button('Nova conexão', { variant: 'primary', onClick: () => abrir() })
  ]))

  if (!conexoes.length) {
    coluna.append(emptyState(
      'Nenhum serviço cadastrado',
      'Sem conexão, uma automação não tem como consultar nada fora do WhatsApp.',
      button('Criar conexão', { variant: 'primary', onClick: () => abrir() })
    ))
  } else {
    coluna.append(...conexoes.map((c) => cartaoDeConexao(c, { editar: (x) => abrir(x), refresh })))
  }

  // FUNÇÃO NOVA QUE A PRONTA GANHOU e esta conexão ainda não tem.
  //
  // A semente entra uma vez por conexão; função acrescentada depois (foi o caso
  // de `musica` e `buscar`, do comando de tocar música) não chegava a quem já
  // tinha o sistema instalado, e o comando novo falhava com "a conexão não tem
  // a função". Trazer é um clique, e é um clique DE PROPÓSITO: a declaração é
  // do dono, e função que ele apagou não volta sozinha.
  const comNovidade = prontas.filter((p) => p.jaCadastrada && p.funcoesQueFaltam?.length)
  for (const pronta of comNovidade) {
    const trazer = button('Trazer para esta conexão', { variant: 'primary' })
    trazer.addEventListener('click', async () => {
      setBusy(trazer, true, 'Trazendo…')
      try {
        const atual = conexoes.find((c) => c.id === pronta.id)
        const novas = (pronta.config.funcoes || []).filter((f) => pronta.funcoesQueFaltam.includes(f.nome))
        // O que o dono editou FICA: o endereço, a credencial e as funções
        // atuais são as dele. Só entra o que não existe pelo nome.
        await api.connections.update(pronta.id, {
          config: { ...atual.config, funcoes: [...(atual.config?.funcoes || []), ...novas] }
        })
        notify(`${novas.length === 1 ? 'Função' : 'Funções'} ${novas.map((f) => f.nome).join(', ')} adicionada${novas.length === 1 ? '' : 's'} a ${pronta.id}.`)
        await refresh()
      } catch (error) {
        notify(error.message, 'danger')
        setBusy(trazer, false)
      }
    })
    coluna.append(el('section', { className: 'notice notice-info stack' }, [
      el('strong', { text: `A conexão "${pronta.id}" tem função nova disponível` }),
      el('p', { text: `O sistema passou a declarar ${pronta.funcoesQueFaltam.join(', ')} neste serviço, e esta conexão ainda não tem. Sem elas, os comandos que as usam respondem que a função não existe.` }),
      el('div', { className: 'button-row' }, [trazer])
    ]))
  }

  // As prontas que ainda não estão cadastradas viram atalho — e servem de
  // exemplo de como se declara uma conexão do zero.
  const disponiveis = prontas.filter((p) => !p.jaCadastrada)
  if (disponiveis.length) {
    coluna.append(el('section', { className: 'panel stack' }, [
      el('h3', { text: 'Prontas para cadastrar' }),
      el('p', { className: 'muted compact', text: 'Declarações que já vêm com o sistema. Você pode ajustá-las depois como qualquer outra.' }),
      ...disponiveis.map((p) => el('div', { className: 'list-card-main' }, [
        el('div', {}, [el('h4', { text: p.titulo || p.id }), el('p', { className: 'muted compact', text: p.descricao || '' })]),
        button('Cadastrar', { onClick: () => abrir(null, p) })
      ]))
    ]))
  }

  raiz.append(coluna, editor)
  return raiz
}
