// Chamar uma FUNÇÃO declarada numa conexão — lado do motor.
//
// Substitui, a prazo, a ação dedicada por integração. Hoje cada serviço novo
// exigiria uma ação nova no motor e uma palavra nova na linguagem; o dono
// apontou isso com o exemplo do `baixa "{{message.link}}"`: "baixar aí aparece
// no código interno e não como configurável pelo dono".
//
// A fronteira é a mesma do download: o motor NÃO fala com a rede. Ele resolve
// as entradas, diz qual conexão e qual função, e passa adiante. Quem monta a
// requisição e espera a resposta é o gateway — e é isso que faz funcionar agora
// enquanto o `action.http` segue parado: aquele era chamada SÍNCRONA no meio do
// fluxo, e o gateway desiste de esperar o motor em 1,5 s.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { validarAutomacao } from '../src/engine/server/validate.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
criarApi(db) // semeia a conexão pronta "midia"
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)

const doc = (config) => ({
  schemaVersion: 1,
  // `validarAutomacao` exige os dois: sem eles, TODO caso que espera zero erros
  // falharia por um motivo que não tem nada a ver com conexão.
  id: 'chamar',
  revision: 1,
  enabled: true,
  name: 'Chamar',
  scope: { include: [{ kind: 'everywhere' }], exclude: [] },
  inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
  responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
  flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: '/baixa', match: 'exact_or_args', allowFrom: 'any' } },
      { id: 'c', type: 'action.connection.call', config }
    ],
    edges: [{ from: 'g', to: 'c', on: 'matched' }]
  }
})

const erros = (config) => validarAutomacao(db, doc(config))
const mensagens = (config) => erros(config).map((e) => `${e.path}: ${e.message}`).join(' | ')

// --- o portão da publicação ----------------------------------------------
// `validarAutomacao` confere schema e grafo; a lista do invariante 7 é imposta
// depois, no publish. Estes casos exercitam o primeiro.

check('chamada válida publica', erros({
  connectionRef: 'midia', function: 'baixar', inputs: { url: '{{message.link}}' }
}).length === 0, mensagens({ connectionRef: 'midia', function: 'baixar', inputs: { url: '{{message.link}}' } }))

check('conexão inexistente é recusada',
  /conexão inexistente/.test(mensagens({ connectionRef: 'nao-existe', function: 'baixar', inputs: { url: 'x' } })))

// Nome de função trocado só apareceria quando alguém usasse o comando, e o
// serviço recusaria com uma mensagem que ninguém liga à automação.
const funcaoErrada = mensagens({ connectionRef: 'midia', function: 'baixarr', inputs: { url: 'x' } })
check('função que a conexão não tem é recusada', /não tem a função "baixarr"/.test(funcaoErrada), funcaoErrada)
check('e o erro LISTA as funções declaradas', /Declaradas: baixar/.test(funcaoErrada), funcaoErrada)

check('entrada obrigatória faltando é recusada',
  /precisa da entrada "url"/.test(mensagens({ connectionRef: 'midia', function: 'baixar', inputs: {} })))

// Entrada que a função não declara seria descartada em silêncio, e quem
// escreveu ficaria esperando um efeito que nunca vem.
check('entrada que a função não recebe é recusada',
  /não recebe "qualidade"/.test(mensagens({
    connectionRef: 'midia', function: 'baixar', inputs: { url: 'x', qualidade: 'alta' }
  })))

check('valor fixo fora da lista de um "opção" é recusado',
  /não é uma escolha de "modo"/.test(mensagens({
    connectionRef: 'midia', function: 'baixar', inputs: { url: 'x', modo: 'gif' }
  })))
check('mas valor com variável passa — só dá para conferir em execução',
  erros({ connectionRef: 'midia', function: 'baixar', inputs: { url: 'x', modo: '{{var.chat.modo}}' } }).length === 0)
// `modo` tem padrão declarado, então não informá-lo é legítimo.
check('entrada opcional com padrão pode ficar de fora',
  erros({ connectionRef: 'midia', function: 'baixar', inputs: { url: 'x' } }).length === 0)

// --- o comando que sai do motor -------------------------------------------
// Publicar passa pelo portão do invariante 7 (`ACOES_SUPORTADAS`), e
// `action.connection.call` ainda NÃO está lá de propósito: o gateway não sabe
// executá-la, e declarar deixaria publicar algo que morre na entrega.
//
// Então a revisão entra direto no banco, como já faz o teste de revisão torta.
// Isto exercita o AVALIADOR, que é o que esta fatia entrega — e o dia em que a
// ação for declarada, trocar isto por `criarEPublicar` é uma linha.
function publicarDireto (id, config) {
  servico.criarEPublicar({ id, document: { ...doc({ connectionRef: 'midia', function: 'baixar', inputs: { url: 'x' } }), id, flow: {
    nodes: [
      { id: 'g', type: 'trigger.command', config: { command: '/baixa', match: 'exact_or_args', allowFrom: 'any' } },
      { id: 'r', type: 'action.whatsapp.reply', config: { text: 'provisório' } }
    ],
    edges: [{ from: 'g', to: 'r', on: 'matched' }]
  } } })
  const rev = db.prepare('SELECT active_revision_id FROM automations WHERE id = ?').get(id).active_revision_id
  const documento = { ...doc(config), id }
  db.prepare('UPDATE automation_revisions SET doc_json = ? WHERE id = ?').run(JSON.stringify(documento), rev)
  db.prepare('UPDATE automations SET deployment_mode = ? WHERE id = ?').run('live', id)
}

publicarDireto('chamar', {
  connectionRef: 'midia',
  function: 'baixar',
  inputs: { url: '{{quoted.link}} {{message.link}}', modo: 'video' },
  ackText: '⏳ Baixando…',
  errorText: 'Não consegui: {{erro}}'
})

let n = 0
const evento = (texto) => ({
  provider: 'zapo',
  accountId: 'conta',
  eventId: `conta:c:s:m${++n}`,
  occurredAt: agora,
  replay: false,
  chat: { id: '5511@s.whatsapp.net', kind: 'direct' },
  sender: { id: '5511@s.whatsapp.net', authoredBySelf: false, authoredByBot: false },
  message: { kind: 'text', text: texto, link: texto.includes('http') ? texto.split(' ').find((p) => p.startsWith('http')) : undefined },
  providerRef: { provider: 'zapo', id: `m${n}` }
})

{
  const r = avaliarEvento(db, evento('/baixa https://instagram.com/p/abc'))
  const cmd = (r.results || []).flatMap((x) => x.commands || [])[0]
  check('o motor emite connection.call', cmd?.commandType === 'connection.call', JSON.stringify(cmd))
  check('dizendo QUAL conexão e QUAL função', cmd?.payload.conexao === 'midia' && cmd?.payload.funcao === 'baixar')
  check('com as entradas resolvidas', cmd?.payload.entradas.url === 'https://instagram.com/p/abc', JSON.stringify(cmd?.payload.entradas))
  check('e o valor fixo intacto', cmd?.payload.entradas.modo === 'video')

  // O motor não fala com a rede: nada de endereço, token ou cabeçalho no
  // comando. Quem resolve isso é o gateway, lendo a conexão.
  const cru = JSON.stringify(cmd)
  check('o comando NÃO carrega endereço do serviço', !cru.includes('8765') && !cru.includes('http://127.0.0.1'), cru)
  check('nem credencial', !/token|Bearer|authorization/i.test(cru), cru)

  // O que a função RECEBE fica separado de como a resposta é APRESENTADA.
  check('o aviso de início acompanha, já interpolado', cmd?.payload.ackText === '⏳ Baixando…')
  check('e não vira entrada da função', cmd?.payload.entradas.ackText === undefined)
}

// --- placeholder que não resolveu é apagado, não enviado ------------------
//
// É o que permite uma entrada aceitar as duas formas: responder uma mensagem
// com link OU colar o link junto do comando. Mandar "{{quoted.link}}" para o
// serviço seria mandar lixo.
{
  const r = avaliarEvento(db, evento('/baixa https://youtu.be/xyz'))
  const cmd = (r.results || []).flatMap((x) => x.commands || [])[0]
  check('o marcador não resolvido não viaja para o serviço',
    !String(cmd?.payload.entradas.url).includes('{{'), cmd?.payload.entradas.url)
}

// --- sem nada para mandar, avisa em vez de chamar -------------------------
publicarDireto('chamar-vazio', {
  connectionRef: 'midia',
  function: 'baixar',
  inputs: { url: '{{quoted.link}}' },
  notFoundText: 'Manda um link junto.'
})
{
  const r = avaliarEvento(db, evento('/baixa'))
  const comandos = (r.results || []).filter((x) => x.automationId === 'chamar-vazio').flatMap((x) => x.commands || [])
  check('sem link, responde em vez de chamar o serviço com entrada vazia',
    comandos[0]?.commandType === 'whatsapp.reply', JSON.stringify(comandos))
  check('e a chamada NÃO acontece', !comandos.some((c) => c.commandType === 'connection.call'))
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CHAMADA DE CONEXÃO PASSARAM')
process.exit(falhas ? 1 : 0)
