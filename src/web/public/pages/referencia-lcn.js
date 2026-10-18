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

function campoDoCabecalho (campo) {
  const marcas = [
    campo.obrigatorio === true ? 'obrigatório' : null,
    campo.obrigatorio === 'comando' ? 'obrigatório num comando' : null,
    campo.repetivel ? 'pode repetir' : null,
    campo.vale === 'comando' ? 'só comando' : null,
    campo.vale === 'vigia' ? 'só vigia' : null,
    campo.depende ? `vem depois de "${campo.depende}"` : null
  ].filter(Boolean)
  return dobravel(`${campo.chave}:`, campo.rotulo || marcas[0] || null, [
    campo.ajuda ? el('p', { text: campo.ajuda }) : null,
    marcas.length ? el('p', { className: 'lcn-ref-marcas', text: marcas.join(' · ') }) : null,
    listaDePalavras(campo.palavras)
  ])
}

function acao (a) {
  return dobravel(a.palavra, a.rotulo, [
    a.resumo ? el('p', { text: a.resumo }) : null,
    a.exemplo ? el('p', { className: 'lcn-ref-exemplo', text: a.exemplo }) : null,
    a.ressalva ? el('div', { className: 'notice notice-info' }, [el('p', { text: a.ressalva.text })]) : null,
    a.alvo ? el('p', { text: `Escreve-se "${a.palavra} ${a.alvo.forma}".` }) : null,
    a.blocoDeEntradas ? el('p', { text: `As entradas vão num bloco "${a.blocoDeEntradas}" indentado embaixo.` }) : null,
    a.arquivos?.length
      ? el('p', {}, [el('span', { text: 'Para o arquivo que chegou na conversa: ' }), ...a.arquivos.map((p, i) => [i ? el('span', { text: ' · ' }) : null, el('code', { text: p })]).flat()])
      : null,
    a.campos?.length
      ? el('ul', { className: 'lcn-ref-campos' }, a.campos.map((c) => el('li', {}, [
        el('code', { text: c.escrita }),
        c.rotulo ? el('span', { text: ` ${c.rotulo}` }) : null,
        c.ajuda ? el('p', { text: c.ajuda }) : null,
        listaDePalavras(c.palavras)
      ])))
      : null
  ])
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
        dobravel(ref.condicao.forma, 'uma por automação, no fim', [
          el('p', { text: 'Uma automação tem uma condição, depois do que vem antes dela. Os dois ramos são as linhas indentadas sob "se" e sob "senão".' }),
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
