import { interpolar } from '../src/engine/server/interpolate.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const contexto = {
  message: { text: '/ping agora', kind: 'text' },
  sender: { id: '5511999@s.whatsapp.net' },
  chat: { id: '120363000@g.us', kind: 'group' },
  var: { chat: { vip: true, apelido: 'Ana', perfil: { nivel: 3 } } }
}

check(
  'substitui as variáveis embutidas de mensagem, remetente e chat',
  interpolar('{{message.text}}|{{message.kind}}|{{sender.id}}|{{chat.id}}|{{chat.kind}}', contexto) ===
    '/ping agora|text|5511999@s.whatsapp.net|120363000@g.us|group'
)
check('substitui variável de texto sem acrescentar aspas', interpolar('Oi, {{var.chat.apelido}}!', contexto) === 'Oi, Ana!')
check('representa booleano como texto JSON', interpolar('VIP={{var.chat.vip}}', contexto) === 'VIP=true')
check('representa objeto como texto JSON', interpolar('{{var.chat.perfil}}', contexto) === '{"nivel":3}')
check('mantém variável ausente literalmente', interpolar('VIP={{var.chat.ausente}}', contexto) === 'VIP={{var.chat.ausente}}')
check('mantém campo embutido desconhecido literalmente', interpolar('{{message.name}}', contexto) === '{{message.name}}')
check('mantém namespace desconhecido literalmente', interpolar('{{sistema.valor}}', contexto) === '{{sistema.valor}}')

// Variável de usuário tem um endereço só. Um apelido que resolvesse para o
// mesmo valor com outro nome esconderia o escopo — e o escopo é justamente o
// que diz de quem é aquele valor.
check('não existe apelido de escopo: {{custom.X}} fica literal', interpolar('VIP={{custom.vip}}', contexto) === 'VIP={{custom.vip}}')

check('nunca toca no placeholder de latência sem ponto', interpolar('pong ({{latencyMs}}ms)', contexto) === 'pong ({{latencyMs}}ms)')
check('substitui múltiplas ocorrências no mesmo texto', interpolar('{{var.chat.apelido}}/{{var.chat.apelido}}/{{chat.kind}}', contexto) === 'Ana/Ana/group')
check('texto sem placeholder passa direto', interpolar('texto simples', contexto) === 'texto simples')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE INTERPOLAÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
