// O seletor de escopo do catálogo: os seis destinos que o motor aceita, o
// corpo que cada um monta e a frase que a tela mostra antes de instalar.
//
// O que estes casos impedem:
//  · a tela oferecer só contato e grupo enquanto o motor aceita seis;
//  · um destino abrangente sair com `id` (o schema o recusa) ou um contato sair
//    sem (o motor o recusa);
//  · "nenhuma escolha" virar "todos" em silêncio;
//  · a frase de revisão esconder que o comando vale para TODOS os grupos.
// O corpo é conferido contra o MESMO schema que a instalação usa, e não contra
// uma segunda lista.
import {
  OPCOES_DE_ESCOPO, montarEscopo, descreverEscopo,
  escopoExigeBusca, escopoExigeVariavel, escopoAceitaExcecao, excecoesDoAlcance, escopoEhAbrangente
} from '../src/web/public/logic/escopo.js'
import { lerPerfil } from '../src/engine/server/perfilDeProvisionamento.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const grupo = { id: '1203@g.us', label: 'Time', kind: 'group' }
const contato = { id: '5511@s.whatsapp.net', label: 'Ana', kind: 'contact' }

check('a tela oferece os seis destinos do motor',
  OPCOES_DE_ESCOPO.map((o) => o.id).join() === 'contact,group,all_contacts,all_groups,everywhere,tagged')

const valido = (escopo) => { try { lerPerfil({ schemaVersion: 1, profileId: 'x', profileVersion: 1, scope: escopo }); return true } catch { return false } }

for (const [modo, entrada] of [
  ['contact', { alvo: contato }],
  ['group', { alvo: grupo }],
  ['all_contacts', {}],
  ['all_groups', {}],
  ['everywhere', {}],
  ['tagged', { variavel: ' vip ' }],
  ['all_groups', { excecoes: [grupo] }],
  ['everywhere', { excecoes: [grupo, contato] }]
]) {
  const { escopo, problema } = montarEscopo({ modo, ...entrada })
  check(`${modo}${entrada.excecoes ? ' com exceção' : ''}: o corpo passa no schema do motor`, !problema && valido(escopo), problema || JSON.stringify(escopo))
}

check('contato e grupo levam o id da conversa',
  JSON.stringify(montarEscopo({ modo: 'group', alvo: grupo }).escopo.include) === JSON.stringify([{ kind: 'group', id: grupo.id }]))
check('destino abrangente NÃO leva id',
  JSON.stringify(montarEscopo({ modo: 'all_groups' }).escopo.include) === JSON.stringify([{ kind: 'all_groups' }]))
check('a marca é aparada e vira o id do destino "tagged"',
  montarEscopo({ modo: 'tagged', variavel: ' vip ' }).escopo.include[0].id === 'vip')
check('a exceção vai para exclude, sem o rótulo da tela',
  JSON.stringify(montarEscopo({ modo: 'all_groups', excecoes: [grupo] }).escopo.exclude) === JSON.stringify([{ kind: 'group', id: grupo.id }]))
check('exceção repetida entra uma vez só',
  montarEscopo({ modo: 'everywhere', excecoes: [grupo, { ...grupo }] }).escopo.exclude.length === 1)
check('exceção de um destino que não é conversa é descartada',
  montarEscopo({ modo: 'everywhere', excecoes: [{ kind: 'everywhere', id: 'x' }, { kind: 'group' }] }).escopo.exclude.length === 0)
check('contato e grupo não aceitam exceção (já são uma conversa só)',
  montarEscopo({ modo: 'group', alvo: grupo, excecoes: [contato] }).escopo.exclude.length === 0)

// Nada escolhido nunca vira "todos".
for (const [nome, entrada, pedaco] of [
  ['sem modo', {}, 'Escolha onde'],
  ['modo desconhecido', { modo: 'planeta' }, 'Escolha onde'],
  ['grupo sem escolher o grupo', { modo: 'group' }, 'um grupo'],
  ['contato sem escolher o contato', { modo: 'contact' }, 'um contato'],
  ['marcadas sem o nome da marca', { modo: 'tagged', variavel: '   ' }, 'nome da marca']
]) {
  const r = montarEscopo(entrada)
  check(`${nome}: recusa em vez de assumir "todos"`, r.escopo === null && r.problema.includes(pedaco), r.problema)
}

check('só contato e grupo pedem busca', escopoExigeBusca('contact') && escopoExigeBusca('group') && !escopoExigeBusca('everywhere') && !escopoExigeBusca('tagged'))
check('só "marcadas" pede o nome da marca', escopoExigeVariavel('tagged') && !escopoExigeVariavel('all_groups'))
check('exceção só nos destinos abrangentes', escopoAceitaExcecao('all_groups') && escopoAceitaExcecao('tagged') && !escopoAceitaExcecao('contact') && !escopoAceitaExcecao('group'))

// A frase diz o alcance em palavras.
check('contato: "somente"', /somente Ana \(contato\)/.test(descreverEscopo({ modo: 'contact', alvo: contato })))
check('todos os grupos: diz TODOS', /TODOS os grupos/.test(descreverEscopo({ modo: 'all_groups' })))
check('todos os contatos: diz TODOS', /TODOS os contatos no privado/.test(descreverEscopo({ modo: 'all_contacts' })))
check('qualquer conversa: diz QUALQUER', /QUALQUER conversa/.test(descreverEscopo({ modo: 'everywhere' })))
check('marcadas: diz a marca', /marcadas com “vip”/.test(descreverEscopo({ modo: 'tagged', variavel: 'vip' })))
check('a frase lista o que fica de fora', /Menos: Time \(grupo\)/.test(descreverEscopo({ modo: 'all_groups', excecoes: [grupo] })))
check('sem escolha, a frase diz que é obrigatório', /obrigatório/.test(descreverEscopo({ modo: 'group' })) && /obrigatório/.test(descreverEscopo({})))

check('alvo de tipo errado (grupo num alcance de contato) é recusado',
  montarEscopo({ modo: 'contact', alvo: grupo }).escopo === null && montarEscopo({ modo: 'group', alvo: contato }).escopo === null)
check('alvo de tipo errado não é descrito como escolhido', /obrigatório/.test(descreverEscopo({ modo: 'contact', alvo: grupo })))

// Exceção que não pode ter efeito não vira restrição de mentira no resumo.
check('"todos os contatos" descarta exceção de grupo (inócua)',
  montarEscopo({ modo: 'all_contacts', excecoes: [grupo, contato] }).escopo.exclude.length === 1 &&
  montarEscopo({ modo: 'all_contacts', excecoes: [grupo] }).escopo.exclude.length === 0 &&
  !/Menos/.test(descreverEscopo({ modo: 'all_contacts', excecoes: [grupo] })))
check('"todos os grupos" descarta exceção de contato; "qualquer conversa" guarda as duas',
  montarEscopo({ modo: 'all_groups', excecoes: [contato] }).escopo.exclude.length === 0 &&
  excecoesDoAlcance('everywhere', [grupo, contato]).length === 2)
check('só os alcances amplos pedem confirmação',
  ['all_contacts', 'all_groups', 'everywhere'].every(escopoEhAbrangente) &&
  ['contact', 'group', 'tagged'].every((m) => !escopoEhAbrangente(m)))

console.log(falhas === 0 ? '\nO SELETOR OFERECE O QUE O MOTOR ACEITA, E NADA FICA "TODOS" POR ESQUECIMENTO\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
