// Conexões: funções declaradas pelo dono, não palavras do compilador.
//
// O defeito que isto conserta, no exemplo do próprio dono:
//
//     baixa "{{quoted.link}} {{message.link}}"
//
// Nada ali é explícito. O argumento não tem rótulo, os dois marcadores colados
// são um truque interno, e QUEM baixa não aparece — o serviço mora no
// config.json, invisível. A crítica dele foi exata: "baixar aí aparece no
// código interno e não como configurável pelo dono".
//
// O que estes casos guardam é a fronteira que faz isso ser seguro: a automação
// chama uma função DECLARADA, com entradas tipadas e destino fixo. Ela nunca
// escolhe endereço — quem escolhe é o dono, na conexão. É por isso que isto não
// reabre o invariante 5, e é o que torna desnecessária a proteção contra SSRF
// que travava o `action.http` genérico.
import {
  ErroDeDeclaracao, FORMAS_DE_RESPOSTA,
  resolverDestino, validarAutenticacao, validarConfiguracao, validarEndereco, validarFuncao
} from '../src/engine/server/conexoes/declaracao.js'
import { CONEXOES_PRONTAS } from '../src/engine/server/conexoes/prontas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }
const recusa = (fn) => { try { fn(); return null } catch (e) { return e } }

// --- o endereço: só http/https -------------------------------------------
check('endereço http passa', validarEndereco('http://127.0.0.1:8765') === 'http://127.0.0.1:8765')
check('a barra final é aparada, para o caminho da função não virar barra dupla',
  validarEndereco('https://api.exemplo.com/') === 'https://api.exemplo.com')

// file:// aqui viraria leitura de disco pelo processo do gateway.
const arquivo = recusa(() => validarEndereco('file:///etc/passwd'))
check('file:// é recusado', arquivo instanceof ErroDeDeclaracao, arquivo?.message)
check('e a recusa diz o que veio', /file:/.test(arquivo?.message || ''))
check('texto que não é URL é recusado com exemplo', /127\.0\.0\.1/.test(recusa(() => validarEndereco('meu-servidor'))?.message || ''))
check('endereço vazio é recusado', recusa(() => validarEndereco('')) instanceof ErroDeDeclaracao)

// --- a função -------------------------------------------------------------
const base = {
  nome: 'baixar',
  metodo: 'POST',
  caminho: '/download',
  entradas: [{ nome: 'url', tipo: 'texto' }],
  resposta: { forma: FORMAS_DE_RESPOSTA.texto }
}
check('uma função mínima passa', validarFuncao(base).nome === 'baixar')
check('o método vira maiúsculo', validarFuncao({ ...base, metodo: 'post' }).metodo === 'POST')
check('o padrão do método é POST', validarFuncao({ ...base, metodo: undefined }).metodo === 'POST')

// O nome vira parte da linguagem (`chama midia.baixar`), então precisa ser
// escrevível sem aspas.
check('nome com espaço é recusado', recusa(() => validarFuncao({ ...base, nome: 'baixar tudo' })) instanceof ErroDeDeclaracao)
check('nome começando com número é recusado', recusa(() => validarFuncao({ ...base, nome: '2baixar' })) instanceof ErroDeDeclaracao)
check('mas baixar2 é um nome legítimo — o dono pediu exatamente isso',
  validarFuncao({ ...base, nome: 'baixar2' }).nome === 'baixar2')

check('método desconhecido é recusado, com a lista do que vale',
  /GET, POST/.test(recusa(() => validarFuncao({ ...base, metodo: 'TELEPORT' }))?.message || ''))
// Caminho solto não é nem relativo nem URL — é engano, e o erro diz as duas
// formas aceitas.
check('caminho sem barra e sem esquema é recusado', recusa(() => validarFuncao({ ...base, caminho: 'download' })) instanceof ErroDeDeclaracao)
check('e a recusa mostra as duas formas válidas',
  /relativo ao endereço da conexão.*URL http/.test(recusa(() => validarFuncao({ ...base, caminho: 'download' }))?.message || ''),
  recusa(() => validarFuncao({ ...base, caminho: 'download' }))?.message)

// --- endereço próprio na função ------------------------------------------
//
// O dono pediu, e o argumento é certo: uma API em outro servidor é caso
// legítimo. O que não acompanha é o segredo — ver o bloco de resolverDestino.
check('função pode ter URL inteira', validarFuncao({ ...base, caminho: 'https://outra.com/v1/x' }).enderecoProprio === true)
check('caminho relativo não é endereço próprio', validarFuncao(base).enderecoProprio === false)
// A URL da função passa pela MESMA validação do endereço da conexão.
check('URL da função com esquema proibido é recusada',
  recusa(() => validarFuncao({ ...base, caminho: 'file:///etc/passwd' })) instanceof ErroDeDeclaracao)

// --- entradas tipadas -----------------------------------------------------
const comOpcao = validarFuncao({
  ...base,
  entradas: [{ nome: 'modo', tipo: 'opção', opcoes: ['auto', 'video'], padrao: 'auto' }]
})
check('entrada do tipo opção guarda as escolhas', JSON.stringify(comOpcao.entradas[0].opcoes) === '["auto","video"]')
check('e o padrão declarado', comOpcao.entradas[0].padrao === 'auto')
// Padrão fora da lista nasceria válido e falharia só na chamada, com o serviço
// recusando um valor que ninguém lembra de onde veio.
const padraoForaDaLista = recusa(() => validarFuncao({
  ...base, entradas: [{ nome: 'modo', tipo: 'opção', opcoes: ['auto', 'video'], padrao: 'gif' }]
}))
check('padrão fora das escolhas é recusado', padraoForaDaLista instanceof ErroDeDeclaracao)
check('e a recusa mostra as escolhas válidas', /auto, video/.test(padraoForaDaLista?.message || ''), padraoForaDaLista?.message)
check('sem padrão continua válido',
  validarFuncao({ ...base, entradas: [{ nome: 'modo', tipo: 'opção', opcoes: ['auto'] }] }).entradas[0].padrao === undefined)
// Uma "escolha" sem lista é caixa de texto com outro nome.
check('opção sem lista é recusada', recusa(() => validarFuncao({ ...base, entradas: [{ nome: 'modo', tipo: 'opção' }] })) instanceof ErroDeDeclaracao)
check('tipo desconhecido é recusado com a lista válida',
  /texto, número/.test(recusa(() => validarFuncao({ ...base, entradas: [{ nome: 'x', tipo: 'blob' }] }))?.message || ''))
check('entrada repetida é recusada',
  recusa(() => validarFuncao({ ...base, entradas: [{ nome: 'url' }, { nome: 'url' }] })) instanceof ErroDeDeclaracao)
check('entrada é obrigatória por padrão', validarFuncao(base).entradas[0].obrigatoria === true)

// --- resposta assíncrona: o protocolo do download, declarado --------------
const trabalho = {
  forma: FORMAS_DE_RESPOSTA.trabalho,
  campoDoTrabalho: 'job',
  caminhoDeAcompanhamento: '/jobs/{job}',
  campoDoEstado: 'estado',
  estadosEmAndamento: ['na_fila', 'baixando'],
  campoDoResultado: 'midias'
}
check('o protocolo de trabalho passa', validarFuncao({ ...base, resposta: trabalho }).resposta.campoDoTrabalho === 'job')
// Sem saber quais estados significam "ainda não acabou", o acompanhamento
// giraria para sempre num estado desconhecido.
const semEstados = recusa(() => validarFuncao({ ...base, resposta: { ...trabalho, estadosEmAndamento: [] } }))
check('trabalho sem os estados de andamento é recusado', semEstados instanceof ErroDeDeclaracao)
check('e a recusa diz por quê', /ainda não acabou/.test(semEstados?.message || ''))
check('trabalho sem caminho de acompanhamento é recusado',
  recusa(() => validarFuncao({ ...base, resposta: { ...trabalho, caminhoDeAcompanhamento: '' } })) instanceof ErroDeDeclaracao)
check('forma de resposta desconhecida é recusada',
  recusa(() => validarFuncao({ ...base, resposta: { forma: 'telepatia' } })) instanceof ErroDeDeclaracao)

// --- para onde vai, e se o segredo vai junto ------------------------------
//
// Esta é a regra que sustenta o endereço próprio. Segredo pertence a um
// SERVIÇO, não à conexão como objeto: se a função aponta para outra origem,
// mandar o Authorization da conexão entregaria a chave de um serviço a outro —
// e sem ataque nenhum, bastaria editar um campo de caminho sem perceber o que
// mudou junto.
{
  const CONEXAO = 'https://api.exemplo.com'
  const comCaminho = (caminho) => validarFuncao({ ...base, caminho })
  const destino = (caminho) => resolverDestino(CONEXAO, comCaminho(caminho))

  check('caminho relativo monta a URL a partir da conexão',
    destino('/v1/chat').url === 'https://api.exemplo.com/v1/chat')
  check('e leva o segredo', destino('/v1/chat').enviaSegredo === true)

  check('URL inteira no MESMO serviço também leva o segredo',
    destino('https://api.exemplo.com/outro').enviaSegredo === true)

  check('host diferente NÃO leva o segredo', destino('https://outra.com/x').enviaSegredo === false)
  check('mas a chamada acontece mesmo assim, no endereço pedido',
    destino('https://outra.com/x').url === 'https://outra.com/x')

  // Origem é esquema + host + porta. Porta diferente é outro serviço, e o
  // mesmo host em http no lugar de https é rebaixamento de transporte —
  // mandar credencial em claro por causa disso é o mesmo vazamento com outra
  // roupa.
  check('porta diferente é outro serviço: sem segredo',
    destino('https://api.exemplo.com:8443/x').enviaSegredo === false)
  check('https virando http não leva credencial em claro',
    destino('http://api.exemplo.com/x').enviaSegredo === false)
}

// --- a conexão inteira ----------------------------------------------------
check('duas funções com o mesmo nome são recusadas',
  recusa(() => validarConfiguracao({ endereco: 'http://x.com', funcoes: [base, base] })) instanceof ErroDeDeclaracao)
check('baixar e baixar2 convivem na mesma conexão',
  validarConfiguracao({ endereco: 'http://x.com', funcoes: [base, { ...base, nome: 'baixar2' }] }).funcoes.length === 2)
check('conexão sem função nenhuma é válida — cadastrar o serviço antes de declarar o que pedir a ele é legítimo',
  validarConfiguracao({ endereco: 'http://x.com' }).funcoes.length === 0)

// --- como a credencial VIAJA, não como ela se chama -----------------------
//
// A tela pedia "o nome do campo" e trazia "token" preenchido. O dono, que é
// programador, disse não entender o que fazer ali — e estava certo: era o
// formato interno de armazenamento vazando como pergunta. Saber o NOME não
// permite montar requisição nenhuma; o que falta é saber se a chave vai em
// Authorization, num cabeçalho próprio ou na URL.
check('sem autenticação é o padrão quando nada é dito', validarAutenticacao(undefined).tipo === 'nenhuma')
check('bearer não precisa de nome — ele já sabe onde vai', validarAutenticacao({ tipo: 'bearer' }).nome === undefined)
check('cabeçalho próprio guarda o nome', validarAutenticacao({ tipo: 'cabeçalho', nome: 'X-API-Key' }).nome === 'X-API-Key')
check('parâmetro na URL guarda o nome', validarAutenticacao({ tipo: 'parâmetro', nome: 'api_key' }).nome === 'api_key')
check('cabeçalho sem nome é recusado', recusa(() => validarAutenticacao({ tipo: 'cabeçalho' })) instanceof ErroDeDeclaracao)
check('forma desconhecida é recusada com a lista',
  /nenhuma, bearer/.test(recusa(() => validarAutenticacao({ tipo: 'magia' }))?.message || ''))

// Header livre deixaria alguém mexer no TRANSPORTE da requisição em vez de só
// dizer quem é — que é o motivo de o projeto ter decidido por credencial
// tipada.
for (const proibido of ['Host', 'Cookie', 'Content-Length', 'connection']) {
  const erro = recusa(() => validarAutenticacao({ tipo: 'cabeçalho', nome: proibido }))
  check(`cabeçalho "${proibido}" não pode carregar credencial`, erro instanceof ErroDeDeclaracao, erro?.message)
}
check('nome de cabeçalho com caractere estranho é recusado',
  recusa(() => validarAutenticacao({ tipo: 'cabeçalho', nome: 'X-Key: extra' })) instanceof ErroDeDeclaracao)

// --- as prontas são de verdade -------------------------------------------
//
// Elas existem para ser o EXEMPLO de como se declara uma conexão. Se não
// passarem pela própria validação, o exemplo estaria mentindo.
for (const conexao of CONEXOES_PRONTAS) {
  const erro = recusa(() => validarConfiguracao(conexao.config))
  check(`a conexão pronta "${conexao.id}" passa na própria validação`, erro === null, erro?.message)
}
const midia = CONEXOES_PRONTAS.find((c) => c.id === 'midia')
const baixar = midia.config.funcoes.find((f) => f.nome === 'baixar')
// Estes valores são o protocolo que hoje vive fixo dentro de src/downloader.js.
// Se alguém mudar um sem mudar o outro, o download para de funcionar.
check('a função pronta de download bate com o protocolo real do serviço',
  baixar.metodo === 'POST' && baixar.caminho === '/download' &&
  baixar.resposta.campoDoTrabalho === 'job' && baixar.resposta.campoDoResultado === 'midias',
  JSON.stringify({ m: baixar.metodo, c: baixar.caminho }))
check('e os estados de andamento são os que o downloader conhece',
  JSON.stringify(baixar.resposta.estadosEmAndamento) === '["na_fila","baixando"]')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE DECLARAÇÃO DE CONEXÃO PASSARAM')
process.exit(falhas ? 1 : 0)
