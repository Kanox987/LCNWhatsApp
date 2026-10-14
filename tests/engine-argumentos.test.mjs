// Dividir o que vem DEPOIS do comando, com nome para cada parte.
//
// O PEDIDO: "/rename Pacote do Zé / Zé" tem que virar duas coisas. A primeira
// resposta foi que isso exigiria lógica que a interpolação não tem — e o dono
// recusou: "deve ter sim, nao necessariamente com | mas ao menos com uma /".
//
// Ele está certo, e o lugar certo não é dentro do texto. Enfiar um separador
// numa string interpolada seria a mesma coisa que o `"{{quoted.link}}
// {{message.link}}"` que o `precisa de um link` acabou de matar: uma string
// escondendo um algoritmo. Aqui a divisão vira DECLARAÇÃO no cabeçalho, o
// motor resolve uma vez, e a ação lê partes com nome.
import { abrirBanco } from '../src/engine/server/db.js'
import { avaliarEvento } from '../src/engine/server/evaluator.js'
import { criarServicoAutomacoes } from '../src/engine/server/automationsService.js'
import { compilar, ErroDeSintaxe } from '../src/lcn/compilar.js'
import { descompilar } from '../src/lcn/descompilar.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const CHAT = '5511900000001@s.whatsapp.net'
const db = abrirBanco(':memory:')
const agora = new Date().toISOString()
db.prepare('INSERT INTO pools (id, label, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p', 'Pool', agora, agora)
const servico = criarServicoAutomacoes(db)

function publicar (id, args, texto) {
  servico.criarEPublicar({
    id,
    document: {
      schemaVersion: 1,
      id,
      revision: 1,
      enabled: true,
      name: id,
      scope: { include: [{ kind: 'everywhere' }], exclude: [] },
      inputPolicy: { acceptedMessageKinds: ['text'], historyPolicy: 'live_only' },
      responder: { strategy: 'weighted_rendezvous', poolId: 'p' },
      flow: {
        nodes: [
          { id: 'g', type: 'trigger.command', config: { command: '/rename', match: 'exact_or_args', allowFrom: 'any', ...(args ? { args } : {}) } },
          { id: 'r', type: 'action.whatsapp.reply', config: { text: texto } }
        ],
        edges: [{ from: 'g', to: 'r', on: 'matched' }]
      }
    }
  })
  db.prepare('UPDATE automations SET deployment_mode = ?, enabled = ? WHERE id = ?').run('live', 0, id)
  return id
}

let n = 0
function rodar (id, texto) {
  n++
  db.prepare('UPDATE automations SET enabled = 0').run()
  db.prepare('UPDATE automations SET enabled = 1 WHERE id = ?').run(id)
  const r = avaliarEvento(db, {
    provider: 'zapo',
    accountId: 'conta',
    eventId: `conta:c:s:a${n}`,
    occurredAt: agora,
    replay: false,
    chat: { id: CHAT, kind: 'direct' },
    sender: { id: CHAT, authoredBySelf: false, authoredByBot: false },
    message: { kind: 'text', text: texto },
    providerRef: { provider: 'zapo', id: `a${n}` }
  })
  return (r.results || []).find((x) => x.automationId === id)?.commands[0]?.payload?.text
}

const BARRA = { separator: '/', names: ['pacote', 'autor'] }
publicar('dois', BARRA, 'pacote=[{{argumentos.pacote}}] autor=[{{argumentos.autor}}]')

check('as duas partes chegam separadas',
  rodar('dois', '/rename Meu Pacote / Zé') === 'pacote=[Meu Pacote] autor=[Zé]',
  rodar('dois', '/rename Meu Pacote / Zé'))
check('o espaço em volta do separador não entra no valor',
  rodar('dois', '/rename A/B') === 'pacote=[A] autor=[B]', rodar('dois', '/rename A/B'))

// A ÚLTIMA PARTE LEVA O RESTO. Cortar no primeiro separador descartaria texto
// sem avisar — e nome com barra existe.
check('a última parte leva o resto, com o separador de volta',
  rodar('dois', '/rename Pacote / Zé / da Silva') === 'pacote=[Pacote] autor=[Zé / da Silva]',
  rodar('dois', '/rename Pacote / Zé / da Silva'))

// PARTE QUE NÃO VEIO FICA AUSENTE, e o marcador aparece literal. É o sinal de
// erro desta base: string vazia no meio de um texto some sem deixar rastro, o
// marcador não.
check('faltando a segunda parte, o marcador fica literal',
  rodar('dois', '/rename Só o Pacote') === 'pacote=[Só o Pacote] autor=[{{argumentos.autor}}]',
  rodar('dois', '/rename Só o Pacote'))
check('sem nada escrito, os dois ficam literais',
  rodar('dois', '/rename') === 'pacote=[{{argumentos.pacote}}] autor=[{{argumentos.autor}}]',
  rodar('dois', '/rename'))

// Sem declarar, nada muda: `message.args` continua sendo o texto inteiro.
publicar('sem-declarar', null, 'tudo=[{{message.args}}] parte=[{{argumentos.pacote}}]')
check('sem declarar, não existe parte nenhuma',
  rodar('sem-declarar', '/rename A / B') === 'tudo=[A / B] parte=[{{argumentos.pacote}}]',
  rodar('sem-declarar', '/rename A / B'))

// Outro separador, três partes.
publicar('tres', { separator: '|', names: ['a', 'b', 'c'] }, '[{{argumentos.a}}][{{argumentos.b}}][{{argumentos.c}}]')
check('o separador é o que foi declarado, não a barra',
  rodar('tres', '/rename um | dois | três') === '[um][dois][três]', rodar('tres', '/rename um | dois | três'))
check('e a barra não divide nada quando o separador é outro',
  rodar('tres', '/rename a/b | c | d') === '[a/b][c][d]', rodar('tres', '/rename a/b | c | d'))

// --- a linguagem ---------------------------------------------------------
const fonte = (linha) => [
  'automação r',
  '  nome: R',
  '  tipo: comando',
  '  dispara com: /rename',
  '  pool: p',
  '  acessa: texto',
  linha,
  '  casa: exato ou com argumentos',
  '  quem: qualquer um',
  '',
  '  responde "{{argumentos.pacote}}"',
  ''
].join('\n')

{
  const doc = compilar(fonte('  argumentos: pacote / autor'))
  const cfg = doc.flow.nodes[0].config
  check('"argumentos: pacote / autor" vira separador e nomes',
    cfg.args.separator === '/' && JSON.stringify(cfg.args.names) === '["pacote","autor"]', JSON.stringify(cfg.args))

  const volta = descompilar(doc)
  check('a volta mostra o que a pessoa vai digitar, não a estrutura',
    volta.includes('argumentos: pacote / autor') && !volta.includes('separator'),
    volta.split('\n').find((l) => l.includes('argumentos')))
  check('ida e volta dá o mesmo documento',
    JSON.stringify(compilar(volta).flow) === JSON.stringify(doc.flow))
}
{
  const doc = compilar(fonte('  argumentos: a | b | c'))
  check('outro separador funciona igual', doc.flow.nodes[0].config.args.separator === '|',
    JSON.stringify(doc.flow.nodes[0].config.args))
}

const recusa = (linha) => {
  try { compilar(fonte(linha)); return null } catch (e) { return e instanceof ErroDeSintaxe ? e.message : `OUTRO: ${e.message}` }
}
check('um nome só é recusado — não há o que dividir', !!recusa('  argumentos: pacote'))
check('dois separadores diferentes são recusados', !!recusa('  argumentos: a / b | c'))
check('nome repetido é recusado — o segundo apagaria o primeiro', !!recusa('  argumentos: a / a'))

{
  // Vigia não tem palavra digitada, então não há o que vir depois dela.
  // Aceitar a linha ali criaria um campo que nunca faz nada.
  const vigia = [
    'automação v', '  nome: V', '  tipo: vigia', '  dispara com: qualquer mensagem',
    '  pool: p', '  acessa: texto', '  argumentos: a / b', '  quem: só externos', '',
    '  responde "x"', ''
  ].join('\n')
  let erro = null
  try { compilar(vigia) } catch (e) { erro = e }
  check('"argumentos" num vigia é recusado', erro instanceof ErroDeSintaxe, erro?.message)
}

db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE ARGUMENTOS COM NOME PASSARAM')
process.exit(falhas ? 1 : 0)
