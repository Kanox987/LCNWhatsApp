// A referência da linguagem, ao lado do editor.
//
// Por que ela existe: a linguagem não tinha documentação NENHUMA. Nem em
// docs/, nem em README, nem um arquivo de ajuda — a especificação de fato
// morava nos comentários de três arquivos de código e nos 42 exemplos do
// catálogo. Quem aluga o sistema não tem terminal e não vai ler código: para
// essa pessoa, a linguagem era adivinhação.
//
// E a prosa já existia. `logic/acoes.js` são 371 linhas explicando cada ação em
// português, escritas para isso — e importadas só pela tela de Variáveis. O
// editor nunca mostrou. Aqui ela aparece, junto das palavras que saem do
// vocabulário, numa junção que o servidor faz.
//
// NADA é escrito nesta tela. Toda palavra, todo rótulo, toda frase chega de
// `/meta/linguagem` e `/meta/funcoes-de-conexao`. Escrever aqui faria desta a
// enésima cópia do vocabulário, e a que ninguém lembraria de atualizar.
import { api } from '../api.js'
import { button, el } from '../ui.js'

// Um item dobrável. A referência inteira aberta são centenas de linhas, e a
// pessoa está procurando UMA coisa.
function dobravel (titulo, detalhe, filhos) {
  return el('details', { className: 'lcn-ref-item' }, [
    el('summary', {}, [
      el('code', { text: titulo }),
      detalhe ? el('span', { className: 'lcn-ref-detalhe', text: detalhe }) : null
    ]),
    el('div', { className: 'lcn-ref-corpo' }, filhos)
  ])
}

function grupo (titulo, quantos, filhos) {
  return el('details', { className: 'lcn-ref-grupo' }, [
    el('summary', {}, [
      el('strong', { text: titulo }),
      el('span', { className: 'lcn-ref-conta', text: String(quantos) })
    ]),
    el('div', { className: 'stack-sm' }, filhos)
  ])
}

function listaDePalavras (palavras) {
  if (!palavras?.length) return null
  return el('p', { className: 'lcn-ref-palavras' }, [
    el('span', { text: 'aceita: ' }),
    ...palavras.map((p, i) => [i ? el('span', { text: ' · ' }) : null, el('code', { text: p })]).flat()
  ])
}

// A MESMA linha do cabeçalho vira campos diferentes do documento conforme a
// classe: `quando for` escreve `messageKinds` num vigia e `actions` num porteiro,
// com enums que não se encontram. Mostrar só a união das palavras diria que um
// porteiro aceita `texto`, que o compilador recusa. Cada classe ganha o seu bloco,
// com a lista daquela classe e a prosa daquela classe, tudo derivado do schema.
function porClasseDoCampo (porClasse) {
  if (!porClasse?.length) return null
  return el('div', { className: 'stack-sm' }, porClasse.map((pc) => {
    const marcas = [
      `grava "${pc.campoDoDocumento}"`,
      pc.obrigatorio ? 'obrigatório' : null,
      pc.tipo && pc.tipo !== 'desconhecido' ? `tipo ${pc.tipo}` : null,
      pc.padrao !== null && pc.padrao !== undefined && pc.padrao !== '' ? `padrão: ${pc.padrao}` : null,
      limitesEmTexto(pc.limites)
    ].filter(Boolean)
    return el('div', { className: 'lcn-ref-corpo' }, [
      el('p', {}, [
        el('strong', { text: `num ${pc.classe}` }),
        pc.rotulo ? el('span', { className: 'lcn-ref-detalhe', text: pc.rotulo }) : null
      ]),
      pc.ajuda ? el('p', { text: pc.ajuda }) : null,
      el('p', { className: 'lcn-ref-marcas', text: marcas.join(' \u00b7 ') }),
      // Mesma regra do campo: existe o mapa, mostra a palavra que se digita; não
      // existe, o enum do schema é a resposta mais honesta que se tem.
      pc.palavras?.length ? listaDePalavras(pc.palavras) : (pc.valoresAceitos?.length ? emLinha('valores', pc.valoresAceitos) : null),
      pc.explicacaoTecnica && pc.explicacaoTecnica !== pc.ajuda
        ? el('p', { className: 'lcn-ref-marcas', text: pc.explicacaoTecnica })
        : null
    ])
  }))
}

function campoDoCabecalho (campo) {
  const marcas = [
    campo.obrigatorio === true ? 'obrigatório' : null,
    // `obrigatorio` sai do schema do gatilho: `true` quando toda classe em que o campo
    // vale o exige, e o nome das classes que exigem quando só algumas exigem.
    typeof campo.obrigatorio === 'string' ? `obrigatório num ${campo.obrigatorio}` : null,
    Array.isArray(campo.obrigatorio) ? `obrigatório num ${campo.obrigatorio.join(' e num ')}` : null,
    campo.repetivel ? 'pode repetir' : null,
    campo.vale === 'comando' ? 'só comando' : null,
    campo.vale === 'vigia' ? 'só vigia' : null,
    campo.vale === 'porteiro' ? 'só porteiro' : null,
    campo.depende ? `vem depois de "${campo.depende}"` : null,
    campo.tipo && campo.tipo !== 'desconhecido' ? `tipo ${campo.tipo}` : null,
    campo.padrao !== null && campo.padrao !== undefined && campo.padrao !== '' ? `padrão: ${campo.padrao}` : null,
    limitesEmTexto(campo.limites)
  ].filter(Boolean)
  return dobravel(`${campo.chave}:`, campo.rotulo || marcas[0] || null, [
    campo.ajuda ? el('p', { text: campo.ajuda }) : null,
    marcas.length ? el('p', { className: 'lcn-ref-marcas', text: marcas.join(' · ') }) : null,
    // `palavras` é o que se ESCREVE na linha; `valoresAceitos` é como o schema guarda a
    // mesma escolha, em inglês. Onde há o mapa das duas, mostrar o enum cru ensinaria a
    // escrever `exact` — que o compilador recusa. Onde não há mapa, o schema é a resposta.
    !campo.palavras?.length && campo.valoresAceitos?.length
      ? emLinha('valores', campo.valoresAceitos)
      : null,
    campo.explicacaoTecnica && campo.explicacaoTecnica !== campo.ajuda
      ? el('p', { className: 'lcn-ref-marcas', text: campo.explicacaoTecnica })
      : null,
    listaDePalavras(campo.palavras),
    porClasseDoCampo(campo.porClasse)
  ])
}

// Os LIMITES do campo, como o schema os escreve, ditos em português. Sem isto
// a pessoa descobre o teto pelo 422 na hora de instalar.
function limitesEmTexto (limites) {
  if (!limites) return null
  const partes = []
  if (limites.minLength === 1) partes.push('não pode ficar vazio')
  else if (limites.minLength > 1) partes.push(`no mínimo ${limites.minLength} caracteres`)
  if (limites.maxLength) partes.push(`no máximo ${limites.maxLength} caracteres`)
  if (limites.minimum !== undefined && limites.maximum !== undefined) partes.push(`de ${limites.minimum} a ${limites.maximum}`)
  else if (limites.minimum !== undefined) partes.push(`a partir de ${limites.minimum}`)
  else if (limites.maximum !== undefined) partes.push(`até ${limites.maximum}`)
  return partes.length ? partes.join(' · ') : null
}

function emLinha (rotulo, valores) {
  return el('p', { className: 'lcn-ref-palavras' }, [
    el('span', { text: `${rotulo}: ` }),
    ...valores.map((v, i) => [i ? el('span', { text: ' · ' }) : null, el('code', { text: String(v) })]).flat()
  ])
}

/**
 * UM campo de uma ação, com tudo que o pedido manda saber dele: tipo, valores
 * possíveis, valor padrão, se é obrigatório e qual é o limite.
 *
 * Os cinco vêm do JSON Schema em tempo de execução — o mesmo que o Ajv usa na
 * instalação —, nunca redeclarados aqui.
 */
export function campoDaAcao (c) {
  const marcas = [
    c.obrigatorio === true ? 'obrigatório' : null,
    c.obrigatorio === false ? 'opcional' : null,
    c.tipo && c.tipo !== 'desconhecido' ? `tipo ${c.tipo}` : null,
    c.padrao !== null && c.padrao !== undefined && c.padrao !== '' ? `padrão: ${c.padrao}` : null,
    limitesEmTexto(c.limites)
  ].filter(Boolean)
  return el('li', {}, [
    el('code', { text: c.escrita }),
    c.rotulo ? el('span', { text: ` ${c.rotulo}` }) : null,
    marcas.length ? el('p', { className: 'lcn-ref-marcas', text: marcas.join(' · ') }) : null,
    c.ajuda ? el('p', { text: c.ajuda }) : null,
    c.valoresAceitos?.length ? emLinha('valores', c.valoresAceitos) : null,
    c.explicacaoTecnica && c.explicacaoTecnica !== c.ajuda
      ? el('p', { className: 'lcn-ref-marcas', text: c.explicacaoTecnica })
      : null,
    listaDePalavras(c.palavras)
  ])
}

/**
 * O CORPO da explicação de uma ação: nome, explicação curta, explicação
 * técnica, utilidade, parâmetros, tipos aceitos, valores possíveis, valores
 * padrão, campos obrigatórios, dependências, exemplo válido, resultado
 * esperado, erros comuns e limitações.
 *
 * Exportado porque a ajuda contextual DENTRO do editor mostra exatamente isto.
 * Duas montagens da mesma explicação divergiriam na primeira correção, e aí a
 * aba diria uma coisa e o editor outra sobre a mesma ação.
 */
export function corpoDaAcao (a) {
  return [
    a.resumo ? el('p', { text: a.resumo }) : null,
    a.dependencias ? el('p', {}, [el('strong', { text: 'Depende de: ' }), el('span', { text: a.dependencias })]) : null,
    a.resultado ? el('p', {}, [el('strong', { text: 'Devolve: ' }), el('span', { text: a.resultado })]) : null,
    a.errosComuns ? el('p', {}, [el('strong', { text: 'Costuma errar assim: ' }), el('span', { text: a.errosComuns })]) : null,
    a.exemplo ? el('p', { className: 'lcn-ref-exemplo', text: a.exemplo }) : null,
    a.ressalva ? el('div', { className: 'notice notice-info' }, [el('p', { text: a.ressalva.text })]) : null,
    a.alvo ? el('p', { text: `Escreve-se "${a.palavra} ${a.alvo.forma}".` }) : null,
    a.blocoDeEntradas ? el('p', { text: `As entradas vão num bloco "${a.blocoDeEntradas}" indentado embaixo.` }) : null,
    a.arquivos?.length
      ? el('p', {}, [el('span', { text: 'Para o arquivo que chegou na conversa: ' }), ...a.arquivos.map((p, i) => [i ? el('span', { text: ' · ' }) : null, el('code', { text: p })]).flat()])
      : null,
    a.obrigatorios?.length ? emLinha('o schema exige', a.obrigatorios) : null,
    a.campos?.length ? el('ul', { className: 'lcn-ref-campos' }, a.campos.map(campoDaAcao)) : null,
    a.tipo ? el('p', { className: 'lcn-ref-marcas', text: `No documento guardado esta ação é "${a.tipo}".` }) : null
  ]
}

function acao (a) {
  return dobravel(a.palavra, a.rotulo, corpoDaAcao(a))
}

function funcaoDeConexao (f, inserir) {
  const titulo = `${f.conexao}.${f.funcao}`
  const obrigatorias = f.entradas.filter((e) => e.obrigatoria)
  const opcionais = f.entradas.filter((e) => !e.obrigatoria)
  const entradaEmLista = (e) => el('li', {}, [
    el('code', { text: e.nome }),
    el('span', { text: ` ${e.recebeArquivo ? 'o arquivo da conversa' : e.tipo}` }),
    e.opcoes?.length ? el('span', { className: 'lcn-ref-marcas', text: ` (${e.opcoes.join(', ')})` }) : null,
    e.padrao !== null && e.padrao !== undefined && e.padrao !== ''
      ? el('span', { className: 'lcn-ref-marcas', text: ` padrão: ${e.padrao}` })
      : null
  ])
  return dobravel(titulo, f.instalada ? null : 'conexão não configurada', [
    f.descricao ? el('p', { text: f.descricao }) : null,
    // A FRASE. É o pedido do dono: saber que esta função cria um carrossel com
    // botões sem ter de entender como.
    el('p', { className: 'lcn-ref-devolve', text: f.devolve }),
    !f.instalada
      ? el('div', { className: 'notice notice-warning' }, [
        el('p', { text: 'Esta função existe no catálogo, mas a conexão ainda não está configurada nesta instalação. Configure na aba Conexões antes de usar o comando.' })
      ])
      : null,
    f.arquivos ? el('p', { text: `Recebe ${f.arquivos === 1 ? 'um arquivo' : 'dois arquivos'} da conversa.` }) : null,
    f.esperaSegundos ? el('p', { className: 'lcn-ref-marcas', text: `Espera até ${f.esperaSegundos}s por esta função.` }) : null,
    obrigatorias.length ? el('p', { className: 'lcn-ref-marcas', text: 'Precisa:' }) : null,
    obrigatorias.length ? el('ul', { className: 'lcn-ref-campos' }, obrigatorias.map(entradaEmLista)) : null,
    opcionais.length ? el('p', { className: 'lcn-ref-marcas', text: 'Pode receber também:' }) : null,
    opcionais.length ? el('ul', { className: 'lcn-ref-campos' }, opcionais.map(entradaEmLista)) : null,
    el('pre', { className: 'lcn-ref-trecho', text: f.exemplo }),
    button('Inserir no texto', { onClick: () => inserir(f.exemplo) })
  ])
}

// ONDE o trecho vai. Sem isto, inserir um trecho de corpo no topo do arquivo
// quebra o texto, e a pessoa descobre pelo erro em vez de pelo botão — que é
// exatamente o tipo de adivinhação que esta tela existe para acabar.
const ONDE_VAI = {
  arquivo: 'é um arquivo inteiro — substitui o que está escrito',
  corpo: 'vai DENTRO da automação, abaixo do cabeçalho',
  blocos: 'vai no FIM do arquivo, depois da automação'
}

function trecho (t, inserir) {
  return dobravel(t.rotulo, ONDE_VAI[t.onde] || null, [
    el('p', { text: t.quando }),
    el('pre', { className: 'lcn-ref-trecho', text: t.texto }),
    button('Inserir no texto', { onClick: () => inserir(t.texto) })
  ])
}

/**
 * Monta o painel.
 *
 * @param {object} opcoes
 * @param {Function} opcoes.inserir Recebe o texto do trecho a inserir no editor.
 */
export function referenciaLcn ({ inserir }) {
  const corpo = el('div', { className: 'stack-sm' }, [el('p', { text: 'Carregando a referência…' })])

  const filtro = el('input', {
    type: 'search',
    className: 'input',
    placeholder: 'procurar palavra, campo ou função'
  })

  const elemento = el('aside', { className: 'card lcn-ref' }, [
    el('h2', { text: 'A linguagem' }),
    el('p', { className: 'lcn-ref-marcas', text: 'Tudo que a linguagem aceita, com um exemplo que dá para inserir no texto.' }),
    filtro,
    corpo
  ])

  // O filtro esconde o que não casa, em vez de remontar: assim um grupo que a
  // pessoa abriu continua aberto enquanto ela digita.
  filtro.addEventListener('input', () => {
    const busca = filtro.value.trim().toLowerCase()
    for (const item of corpo.querySelectorAll('.lcn-ref-item')) {
      const casa = !busca || item.textContent.toLowerCase().includes(busca)
      item.hidden = !casa
      if (busca && casa) item.closest('.lcn-ref-grupo')?.setAttribute('open', '')
    }
    for (const g of corpo.querySelectorAll('.lcn-ref-grupo')) {
      const algum = [...g.querySelectorAll('.lcn-ref-item')].some((i) => !i.hidden)
      g.hidden = !algum
    }
  })

  Promise.all([
    api.linguagem.referencia(),
    // O catálogo de funções fala com o motor; a referência não. Se o motor
    // estiver fora, a referência da linguagem continua inteira e só a lista de
    // funções falta — que é bem melhor do que a tela toda não abrir.
    api.linguagem.funcoesDeConexao().catch(() => [])
  ]).then(([ref, funcoes]) => {
    corpo.replaceChildren(
      grupo('Trechos prontos', ref.trechos.length, ref.trechos.map((t) => trecho(t, inserir))),
      grupo('Funções de conexão', funcoes.length, funcoes.length
        ? funcoes.map((f) => funcaoDeConexao(f, inserir))
        : [el('p', { text: 'Nenhuma função declarada. A aba Conexões é onde elas nascem.' })]),
      grupo('Campos do comando', ref.cabecalho.length + ref.marcas.length, [
        ...ref.cabecalho.map(campoDoCabecalho),
        ...ref.marcas.map((m) => dobravel(m.chave, 'linha solta, sem valor', [
          m.ajuda ? el('p', { text: m.ajuda }) : null
        ]))
      ]),
      grupo('Ações', ref.acoes.length, ref.acoes.map(acao)),
      grupo('Condição', 1, [
        dobravel(ref.condicao.forma, 'em sequência ou dentro de outro ramo', [
          el('p', { text: ref.condicao.ajuda }),
          listaDePalavras(ref.condicao.operadores),
          ref.condicao.origens?.length
            ? el('ul', { className: 'lcn-ref-campos' }, ref.condicao.origens.map((o) => el('li', {}, [
              el('code', { text: o.valor || o.chave || o.rotulo }),
              o.ajuda ? el('p', { text: o.ajuda }) : null
            ])))
            : null
        ])
      ]),
      grupo('Template e configuração', ref.template.length + ref.blocos.length, [
        ...ref.template.map((c) => dobravel(`${c.chave}:`, 'no cabeçalho do template', [
          c.ajuda ? el('p', { text: c.ajuda }) : null
        ])),
        ...ref.blocos.map((b) => dobravel(b.bloco, b.forma, [
          b.ajuda ? el('p', { text: b.ajuda }) : null,
          listaDePalavras(b.palavras),
          b.filhos?.length
            ? el('ul', { className: 'lcn-ref-campos' }, b.filhos.map((f) => el('li', {}, [
              el('code', { text: `${f.chave}:` }),
              el('p', { text: f.ajuda })
            ])))
            : null
        ]))
      ])
    )
  }).catch((erro) => {
    corpo.replaceChildren(el('div', { className: 'notice notice-danger' }, [
      el('strong', { text: 'Não consegui carregar a referência.' }),
      el('p', { text: erro.message })
    ]))
  })

  return elemento
}
