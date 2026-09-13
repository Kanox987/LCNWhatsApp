import { interpolar } from '../src/engine/server/interpolate.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const contexto = {
  message: { text: '/ping agora', kind: 'text' },
  sender: { id: '5511999@s.whatsapp.net' },
  chat: { id: '120363000@g.us', kind: 'group' },
  custom: { vip: true, apelido: 'Ana', perfil: { nivel: 3 } }
}

check(
  'substitui as variáveis embutidas de mensagem, remetente e chat',
  interpolar('{{message.text}}|{{message.kind}}|{{sender.id}}|{{chat.id}}|{{chat.kind}}', contexto) ===
    '/ping agora|text|5511999@s.whatsapp.net|120363000@g.us|group'
)
check('substitui string customizada sem acrescentar aspas', interpolar('Oi, {{custom.apelido}}!', contexto) === 'Oi, Ana!')
check('representa booleano customizado como texto JSON', interpolar('VIP={{custom.vip}}', contexto) === 'VIP=true')
check('representa objeto customizado como texto JSON', interpolar('{{custom.perfil}}', contexto) === '{"nivel":3}')
check('mantém variável customizada ausente literalmente', interpolar('VIP={{custom.ausente}}', contexto) === 'VIP={{custom.ausente}}')
check('mantém campo embutido desconhecido literalmente', interpolar('{{message.name}}', contexto) === '{{message.name}}')
check('mantém namespace desconhecido literalmente', interpolar('{{sistema.valor}}', contexto) === '{{sistema.valor}}')
check('nunca toca no placeholder de latência sem ponto', interpolar('pong ({{latencyMs}}ms)', contexto) === 'pong ({{latencyMs}}ms)')
check('substitui múltiplas ocorrências no mesmo texto', interpolar('{{custom.apelido}}/{{custom.apelido}}/{{chat.kind}}', contexto) === 'Ana/Ana/group')
check('texto sem placeholder passa direto', interpolar('texto simples', contexto) === 'texto simples')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE INTERPOLAÇÃO PASSARAM')
process.exit(falhas ? 1 : 0)
