import { interpolar } from '../src/engine/server/interpolate.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const contexto = {
  message: { text: '/ping agora', kind: 'text' },
  sender: { id: '5511999@s.whatsapp.net', name: 'Ana Maria', isAdmin: true, authoredBySelf: false },
  chat: { id: '120363000@g.us', kind: 'group', name: 'Turma do Churrasco', size: 12, onlyAdmins: false },
  quoted: { sender: '5511888@s.whatsapp.net' },
  bot: { id: '5511777@s.whatsapp.net', isAdmin: false },
  now: { greeting: 'Bom dia', date: '14/09/2026', time: '10:31' },
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

// --- nome, citação, bot e relógio ----------------------------------------
check('substitui o nome de exibição de quem enviou', interpolar('{{now.greeting}}, {{sender.name}}!', contexto) === 'Bom dia, Ana Maria!')
check('substitui quem escreveu a mensagem respondida', interpolar('{{quoted.sender}}', contexto) === '5511888@s.whatsapp.net')
check('substitui o número do próprio bot', interpolar('fale comigo em {{bot.id}}', contexto) === 'fale comigo em 5511777@s.whatsapp.net')
check('substitui data e hora', interpolar('{{now.date}} às {{now.time}}', contexto) === '14/09/2026 às 10:31')

// authoredBySelf viaja no evento mas NÃO é endereçável: expor a barreira do
// gatilho automático como texto convidaria a montar comando em cima dela.
check('campo do remetente fora da lista permitida fica literal', interpolar('{{sender.authoredBySelf}}', contexto) === '{{sender.authoredBySelf}}')
check('campo de relógio inexistente fica literal', interpolar('{{now.semana}}', contexto) === '{{now.semana}}')

// Nome ausente é o caso comum, e precisa aparecer em vez de sumir.
const semNome = { ...contexto, sender: { id: '5511999@s.whatsapp.net' } }
check('sem nome de exibição o placeholder fica visível, não vira vazio', interpolar('Oi, {{sender.name}}!', semNome) === 'Oi, {{sender.name}}!')

// --- dados do grupo ------------------------------------------------------
check('substitui o nome do grupo', interpolar('Bem-vindo ao {{chat.name}}!', contexto) === 'Bem-vindo ao Turma do Churrasco!')
check('substitui o tamanho do grupo', interpolar('somos {{chat.size}}', contexto) === 'somos 12')
check('substitui se quem enviou é admin', interpolar('admin={{sender.isAdmin}}', contexto) === 'admin=true')
check('substitui se o próprio bot é admin', interpolar('eu sou admin? {{bot.isAdmin}}', contexto) === 'eu sou admin? false')

// "Não consegui saber" e "não é admin" são coisas diferentes: sem o campo o
// texto fica visível, em vez de um false inventado decidir permissão.
const semGrupo = { ...contexto, sender: { id: '5511999@s.whatsapp.net' }, chat: { id: '5511999@s.whatsapp.net', kind: 'direct' } }
check('fora de grupo isAdmin fica literal, nunca vira false', interpolar('{{sender.isAdmin}}', semGrupo) === '{{sender.isAdmin}}')
check('fora de grupo o nome do grupo fica literal', interpolar('{{chat.name}}', semGrupo) === '{{chat.name}}')

check('nunca toca no placeholder de latência sem ponto', interpolar('pong ({{latencyMs}}ms)', contexto) === 'pong ({{latencyMs}}ms)')
check('substitui múltiplas ocorrências no mesmo texto', interpolar('{{var.chat.apelido}}/{{var.chat.apelido}}/{{chat.kind}}', contexto) === 'Ana/Ana/group')
check('texto sem placeholder passa direto', interpolar('texto simples', contexto) === 'texto simples')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE INTERPOLAÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
