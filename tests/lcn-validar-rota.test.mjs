// As três rotas que o editor consome, e o que cada uma NÃO pode fazer.
//
//   GET  /meta/linguagem           a referência — tem de abrir com o motor fora
//   GET  /meta/funcoes-de-conexao  o catálogo de funções — sem segredo nenhum
//   POST /lcn/validar              conferir o texto — sem gravar nada
//
// Por que "sem gravar nada" é um caso de teste e não um detalhe: até aqui
// compilar e salvar eram a MESMA ação, e o painel só descobria o erro ao
// clicar em salvar. Conferir enquanto se escreve só é possível se a conferência
// não tiver efeito — senão cada tecla deixaria um rascunho atrás.
import { criarRoteadorWeb } from '../src/web/router.js'
import { CONEXOES_PRONTAS } from '../src/engine/server/conexoes/prontas.js'
// O NÚMERO DE AÇÕES VEM DA TABELA, não escrito aqui. Escrito, este teste
// falharia na próxima ação nova dizendo "a referência traz as ações" — uma
// falha que não aponta defeito nenhum e ensina a mexer no teste até passar.
import { ACOES } from '../src/lcn/vocabulario.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// O que o motor recebeu. Qualquer chamada de escrita aqui é falha de teste.
const escritas = []
const registrar = (nome) => (...args) => { escritas.push({ nome, args }); return {} }

// Uma conexão instalada, com segredo definido — para conferir que o catálogo
// de funções não deixa escapar nem o nome do campo de segredo nem a credencial.
const conexaoInstalada = {
  id: 'meuservico',
  kind: 'http',
  segredoDefinido: true,
  camposDeSegredo: ['apiKey'],
  credencial: { estado: 'definida', valor: 'nunca-deveria-sair' },
  config: {
    titulo: 'Meu serviço',
    endereco: 'https://exemplo.invalid',
    chaveSecreta: 'nunca-deveria-sair',
    funcoes: [{
      nome: 'procurar',
      descricao: 'Procura coisas.',
      metodo: 'POST',
      caminho: '/procurar',
      entradas: [{ nome: 'busca', tipo: 'texto', obrigatoria: true }],
      resposta: { forma: 'lista', campo: 'achados', linha: '{{titulo}}' }
    }]
  }
}

const motorFalso = {
  saude: async () => ({ ok: true }),
  automacoes: {
    criar: registrar('automacoes.criar'),
    salvarRascunho: registrar('automacoes.salvarRascunho'),
    obter: async () => null,
    listar: async () => []
  },
  pools: {}, execucoes: {}, entidades: {}, meta: {}, retencao: {}, templates: {},
  conexoes: {
    listar: async () => [conexaoInstalada],
    prontas: async () => CONEXOES_PRONTAS.map((c) => ({
      id: c.id, kind: c.kind, titulo: c.titulo, descricao: c.descricao,
      config: c.config, jaCadastrada: false, funcoesQueFaltam: []
    })),
    criar: registrar('conexoes.criar'),
    atualizar: registrar('conexoes.atualizar')
  }
}

const roteador = criarRoteadorWeb({ motor: motorFalso, instancias: {}, diretorio: {} })
const chamar = (method, caminho, body) => roteador.resolver(method, caminho, { body, query: new URLSearchParams(), req: { headers: {} } })

// --- GET /meta/linguagem --------------------------------------------------
const ref = await chamar('GET', '/api/v1/meta/linguagem')
check('a referência responde', Boolean(ref))
check('a referência traz todas as ações', Array.isArray(ref.acoes) && ref.acoes.length === ACOES.length, `${ref.acoes?.length} de ${ACOES.length}`)
check('a referência traz os campos do cabeçalho', ref.cabecalho.length > 15, `${ref.cabecalho?.length}`)
check('a referência traz os trechos prontos', ref.trechos.length > 5, `${ref.trechos?.length}`)
check('a referência traz as palavras do realce', Boolean(ref.palavras?.acoes?.length))
check('a referência não escreveu nada', escritas.length === 0, escritas.map((e) => e.nome).join(', '))

// Ela não pode depender do motor: é justamente quando algo está quebrado que
// alguém abre a referência para ver o que a linguagem aceita.
const semMotor = criarRoteadorWeb({
  motor: { saude: async () => { throw new Error('motor fora') } },
  instancias: {}, diretorio: {}
})
const refSemMotor = await semMotor.resolver('GET', '/api/v1/meta/linguagem', { query: new URLSearchParams() })
check('a referência abre com o motor fora do ar', refSemMotor.acoes.length === ACOES.length)

// --- GET /meta/funcoes-de-conexao ----------------------------------------
const funcoes = await chamar('GET', '/api/v1/meta/funcoes-de-conexao')
check('o catálogo de funções responde uma lista', Array.isArray(funcoes) && funcoes.length > 5, `${funcoes?.length}`)

const minha = funcoes.find((f) => f.conexao === 'meuservico' && f.funcao === 'procurar')
check('a função da conexão instalada aparece', Boolean(minha))
check('e vem marcada como instalada', minha?.instalada === true)
check('com a frase do que devolve', /LISTA em texto/.test(minha?.devolve || ''), minha?.devolve)
check('com as entradas', minha?.entradas?.[0]?.nome === 'busca')
check('e com um exemplo pronto', /^chama meuservico\.procurar/.test(minha?.exemplo || ''), minha?.exemplo)

const buscarMusica = funcoes.find((f) => f.conexao === 'midia' && f.funcao === 'buscar')
check('a função pronta aparece mesmo sem conexão cadastrada', Boolean(buscarMusica))
check('e vem marcada como NÃO instalada', buscarMusica?.instalada === false)
check('com a frase do carrossel com botão', /CARROSSEL/.test(buscarMusica?.devolve || '') && /botão/.test(buscarMusica?.devolve || ''))

// NENHUM segredo pode sair aqui. A rota monta a resposta a partir da config já
// exposta, mas a config da conexão guarda campos próprios dela — e o teste
// olha o JSON inteiro, não campo por campo, porque campo novo entra sem avisar.
const comoTexto = JSON.stringify(funcoes)
check('nenhuma credencial vaza no catálogo', !comoTexto.includes('nunca-deveria-sair'))
check('nenhum nome de campo de segredo vaza', !comoTexto.includes('apiKey'))
check('nenhuma chave secreta vaza', !comoTexto.includes('chaveSecreta'))
check('o catálogo de funções não escreveu nada', escritas.length === 0, escritas.map((e) => e.nome).join(', '))

// --- POST /lcn/validar ----------------------------------------------------
const textoBom = [
  'automação oi',
  '  id: oi',
  '  nome: Oi',
  '  tipo: comando',
  '  dispara com: /oi',
  '  acessa: texto',
  '  casa: exato',
  '',
  '  responde "oi"'
].join('\n')

const bom = await chamar('POST', '/api/v1/lcn/validar', { texto: textoBom })
check('texto válido: ok', bom.ok === true)
check('texto válido: diz que é automação', bom.tipo === 'automação', bom.tipo)
check('texto válido: resume o nome', bom.resumo.nome === 'Oi', bom.resumo?.nome)
check('texto válido: resume o comando', bom.resumo.comando === '/oi', bom.resumo?.comando)
check('texto válido: conta as ações', bom.resumo.acoes === 1, `${bom.resumo?.acoes}`)

// Erro de escrita é o RESULTADO esperado de uma conferência, não falha do
// pedido: devolver 422 faria o painel tratar "ainda estou escrevendo" como
// pedido quebrado, e a tela mostraria erro de rede no meio da digitação.
const ruim = await chamar('POST', '/api/v1/lcn/validar', {
  texto: 'automação oi\n  tipo: comando\n  dispara com: /oi\n  nomee: Oi\n\n  responde "oi"'
})
check('texto inválido: ok=false em vez de erro de rota', ruim.ok === false)
check('texto inválido: diz a linha', ruim.erro.linha === 4, `${ruim.erro?.linha}`)
check('texto inválido: a mensagem ensina os campos', /Conheço:/.test(ruim.erro.mensagem))

// Um arquivo de template é reconhecido como tal, e não recusado: é o que
// permite ao editor oferecer o caminho certo em vez de só dizer "não".
const comoTemplate = await chamar('POST', '/api/v1/lcn/validar', {
  texto: [
    'template meu v1',
    '  nome: Meu',
    '  categoria: utilitarios',
    '',
    'automação oi',
    '  id: oi',
    '  tipo: comando',
    '  dispara com: {{params.command}}',
    '  acessa: texto',
    '  casa: exato',
    '',
    '  responde "oi"',
    '',
    'configurável',
    '  command: texto = "/oi"',
    '    rótulo: Comando'
  ].join('\n')
})
check('texto de template: ok', comoTemplate.ok === true)
check('texto de template: reconhecido como template', comoTemplate.tipo === 'template', comoTemplate.tipo)

const vazio = await chamar('POST', '/api/v1/lcn/validar', { texto: '' })
check('texto vazio: ok=false sem explodir', vazio.ok === false)
check('texto vazio: tem mensagem', Boolean(vazio.erro?.mensagem))

// O caso que dá nome ao arquivo.
check('NADA foi gravado em nenhuma das rotas', escritas.length === 0, escritas.map((e) => e.nome).join(', '))

console.log(falhas === 0 ? '\nrotas da linguagem: tudo certo' : `\nrotas da linguagem: ${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
