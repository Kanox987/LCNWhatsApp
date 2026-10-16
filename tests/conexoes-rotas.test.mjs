// As rotas de conexão: declaração validada, e o segredo que ENTRA mas não SAI.
//
// A regra antiga era o token viver num arquivo, fora do painel (src/config.js).
// O dono reverteu com motivo concreto: "vai ter que colar pelo painel, os
// clientes não vão ter acesso ao terminal se eu ou outra pessoa alugar o
// sistema".
//
// Isso torna o segredo GRAVÁVEL. Não torna legível — e é isso que estes casos
// guardam. Um painel que devolve a credencial de volta transforma qualquer
// leitura da tela (uma aba aberta, um print, um log de rede) em vazamento.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })

async function erroDe (method, pathname, body) {
  try { await api.resolver(method, pathname, contexto(body)); return null } catch (e) { return e }
}

const FUNCAO = {
  nome: 'perguntar',
  metodo: 'POST',
  caminho: '/v1/chat/completions',
  entradas: [{ nome: 'pergunta', tipo: 'texto' }],
  resposta: { forma: 'texto', campo: 'choices' }
}

try {
  // --- as prontas aparecem sozinhas --------------------------------------
  const inicial = await api.resolver('GET', '/connections', contexto())
  const midia = inicial.find((c) => c.id === 'midia')
  check('a conexão pronta de download já vem cadastrada', Boolean(midia), JSON.stringify(inicial.map((c) => c.id)))
  check('com a função baixar declarada e visível', midia?.config?.funcoes?.[0]?.nome === 'baixar')
  check('e as entradas dela à vista — era isso que estava escondido no código',
    JSON.stringify(midia.config.funcoes[0].entradas.map((e) => e.nome)) === '["url","modo"]',
    JSON.stringify(midia.config.funcoes[0].entradas))
  // Semear um segredo seria inventar uma credencial que ninguém deu.
  check('ela nasce SEM segredo', midia.segredoDefinido === false)

  const prontas = await api.resolver('GET', '/connections-prontas', contexto())
  check('o catálogo de prontas existe, para servir de exemplo', prontas.length >= 1)
  check('e marca a que já está cadastrada', prontas.find((p) => p.id === 'midia')?.jaCadastrada === true)

  // --- o segredo entra e NÃO sai ------------------------------------------
  const criada = await api.resolver('POST', '/connections', contexto({
    id: 'ia',
    kind: 'http',
    config: { endereco: 'https://api.openai.com', funcoes: [FUNCAO] },
    secret: { token: 'sk-SEGREDO-QUE-NAO-PODE-VAZAR' }
  }))
  check('criar uma conexão de IA funciona', criada.body.id === 'ia', JSON.stringify(criada.body).slice(0, 120))

  const corpoDaCriacao = JSON.stringify(criada.body)
  check('a resposta da criação NÃO contém o segredo', !corpoDaCriacao.includes('SEGREDO-QUE-NAO-PODE-VAZAR'), corpoDaCriacao)
  check('mas diz que existe um', criada.body.segredoDefinido === true)
  // O NOME do campo não é o segredo, e a tela precisa dele para dizer qual
  // credencial a conexão guarda.
  check('e diz QUAL credencial ela guarda', JSON.stringify(criada.body.camposDeSegredo) === '["token"]')

  const lida = await api.resolver('GET', '/connections/ia', contexto())
  check('ler a conexão NÃO devolve o segredo', !JSON.stringify(lida).includes('SEGREDO-QUE-NAO-PODE-VAZAR'))
  const listada = await api.resolver('GET', '/connections', contexto())
  check('listar TODAS também não devolve o segredo', !JSON.stringify(listada).includes('SEGREDO-QUE-NAO-PODE-VAZAR'))

  // --- editar as funções não pode apagar a credencial ---------------------
  //
  // Este é o caso que mais dói na prática: quem edita as funções não lê o
  // segredo, então não teria como reenviá-lo. Se o PUT o zerasse, a conexão
  // pararia de funcionar por causa de uma edição que não tinha nada a ver.
  await api.resolver('PUT', '/connections/ia', contexto({
    config: { endereco: 'https://api.openai.com', funcoes: [FUNCAO, { ...FUNCAO, nome: 'perguntar2' }] }
  }))
  const depois = await api.resolver('GET', '/connections/ia', contexto())
  check('editar as funções PRESERVA o segredo', depois.segredoDefinido === true)
  check('e a função nova entrou', depois.config.funcoes.length === 2)

  await api.resolver('PUT', '/connections/ia', contexto({ secret: null }))
  check('mandar secret: null apaga de propósito',
    (await api.resolver('GET', '/connections/ia', contexto())).segredoDefinido === false)

  // --- a declaração é validada na porta -----------------------------------
  const enderecoRuim = await erroDe('POST', '/connections', {
    id: 'ruim', kind: 'http', config: { endereco: 'file:///etc/passwd', funcoes: [] }
  })
  check('endereço file:// é recusado na rota -> 400', enderecoRuim?.status === 400, enderecoRuim?.message)

  const funcaoRuim = await erroDe('POST', '/connections', {
    id: 'ruim2', kind: 'http', config: { endereco: 'https://x.com', funcoes: [{ ...FUNCAO, caminho: 'chat' }] }
  })
  check('caminho sem barra nem esquema é recusado -> 400', funcaoRuim?.status === 400, funcaoRuim?.message)
  check('e a mensagem do erro chega inteira para quem está editando',
    /relativo ao endereço da conexão/.test(funcaoRuim?.message || ''), funcaoRuim?.message)

  const segredoRuim = await erroDe('POST', '/connections', {
    id: 'ruim3', kind: 'http', config: { endereco: 'https://x.com' }, secret: { token: 12345 }
  })
  check('segredo que não é texto é recusado', segredoRuim?.status === 400, segredoRuim?.message)

  const nadaCriado = await api.resolver('GET', '/connections', contexto())
  check('nenhuma das tentativas inválidas criou conexão',
    !nadaCriado.some((c) => c.id.startsWith('ruim')), JSON.stringify(nadaCriado.map((c) => c.id)))

  // --- a normalização é guardada ------------------------------------------
  const comBarra = await api.resolver('POST', '/connections', contexto({
    id: 'barra', kind: 'http', config: { endereco: 'https://x.com/', funcoes: [] }
  }))
  check('a barra final do endereço é aparada ANTES de guardar',
    comBarra.body.config.endereco === 'https://x.com', comBarra.body.config.endereco)

  // --- função nova numa pronta já cadastrada -------------------------------
  //
  // A semente entra uma vez por id. Quando a pronta ganha uma função depois
  // (foi o caso de `musica` e `buscar`), quem já tinha o sistema ficava sem
  // ela — e o comando novo falhava com "a conexão não tem a função". A rota
  // precisa DIZER o que falta, para a tela poder oferecer.
  const soComBaixar = (await api.resolver('GET', '/connections-prontas', contexto())).find((p) => p.id === 'midia')
  check('a pronta cadastrada e completa não acusa função faltando',
    Array.isArray(soComBaixar?.funcoesQueFaltam) && soComBaixar.funcoesQueFaltam.length === 0,
    JSON.stringify(soComBaixar?.funcoesQueFaltam))

  const atual = await api.resolver('GET', '/connections/midia', contexto())
  await api.resolver('PUT', '/connections/midia', contexto({
    config: { ...atual.config, funcoes: (atual.config.funcoes || []).filter((f) => f.nome === 'baixar') }
  }))
  const faltando = (await api.resolver('GET', '/connections-prontas', contexto())).find((p) => p.id === 'midia')
  check('com função de menos, a rota diz QUAIS faltam',
    faltando.funcoesQueFaltam.includes('musica') && faltando.funcoesQueFaltam.includes('buscar'),
    JSON.stringify(faltando.funcoesQueFaltam))
  check('e não acusa a que está lá', !faltando.funcoesQueFaltam.includes('baixar'))

  // --- apagar tem que COLAR ------------------------------------------------
  //
  // Sem a marca de "prontas já semeadas", a conexão apagada voltaria no próximo
  // arranque — o sistema desfazendo a decisão da pessoa em silêncio.
  await api.resolver('DELETE', '/connections/midia', contexto())
  criarApi(db)
  const depoisDeApagar = await api.resolver('GET', '/connections', contexto())
  check('a pronta apagada NÃO ressuscita no próximo arranque',
    !depoisDeApagar.some((c) => c.id === 'midia'), JSON.stringify(depoisDeApagar.map((c) => c.id)))
  check('e ela continua disponível no catálogo, para recadastrar quando quiser',
    (await api.resolver('GET', '/connections-prontas', contexto())).find((p) => p.id === 'midia')?.jaCadastrada === false)
} catch (erro) {
  falhas++
  console.error('❌ erro inesperado:', erro)
} finally {
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DAS ROTAS DE CONEXÃO PASSARAM')
process.exit(falhas ? 1 : 0)
