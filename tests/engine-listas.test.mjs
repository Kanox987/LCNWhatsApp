// Listas nomeadas de pessoas (2A): o serviço que guarda quem está em "autorizados".
// Mesma forma dos donos — uma linha de entity_attributes com chave reservada —,
// então a lista herda a trava de `__` sem regra nova.
import { abrirBanco } from '../src/engine/server/db.js'
import {
  adicionarNaLista, chaveDaLista, estaNaLista, listasExistentes, membrosDaLista,
  listasDa, normalizarNomeDeLista, removerDaLista
} from '../src/engine/server/listas.js'
import { ehChaveReservada } from '../src/engine/server/chavesReservadas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const ANA = '5511900000001@s.whatsapp.net'
const BIA = '5511900000002@s.whatsapp.net'
const LID = '123456789@lid'

check('lista que nunca existiu não tem ninguém', estaNaLista(db, 'autorizados', ANA) === false && membrosDaLista(db, 'autorizados').length === 0)
check('adicionar põe a pessoa e avisa que mudou', adicionarNaLista(db, 'autorizados', ANA).mudou === true && estaNaLista(db, 'autorizados', ANA))
check('adicionar de novo é inofensivo e diz que nada mudou', adicionarNaLista(db, 'autorizados', ANA).mudou === false)
check('outra pessoa continua fora', estaNaLista(db, 'autorizados', BIA) === false)
check('LID e telefone são pessoas diferentes para o serviço (a conversão é da borda)', (adicionarNaLista(db, 'autorizados', LID), estaNaLista(db, 'autorizados', LID) && !estaNaLista(db, 'autorizados', '123456789@s.whatsapp.net')))
check('a mesma pessoa em duas listas não mistura', (adicionarNaLista(db, 'vip', BIA), estaNaLista(db, 'vip', BIA) && !estaNaLista(db, 'autorizados', BIA) && !estaNaLista(db, 'vip', ANA)))
check('remover tira e avisa; remover quem não está não muda', removerDaLista(db, 'autorizados', ANA).mudou === true && !estaNaLista(db, 'autorizados', ANA) && removerDaLista(db, 'autorizados', ANA).mudou === false)
check('esvaziar a lista não vira "todos"', (removerDaLista(db, 'autorizados', LID), membrosDaLista(db, 'autorizados').length === 0 && !estaNaLista(db, 'autorizados', ANA) && !estaNaLista(db, 'autorizados', BIA)))

check('remetente sem identificação nunca é membro', [undefined, null, '', 42].every((id) => estaNaLista(db, 'vip', id) === false))
check('adicionar sem pessoa ou sem nome válido recusa, sem gravar', adicionarNaLista(db, 'vip', '').ok === false && adicionarNaLista(db, '../x', ANA).ok === false && adicionarNaLista(db, '', ANA).ok === false)

check('nome: caixa, acento e espaço viram a mesma lista', normalizarNomeDeLista('  Autorizados ') === 'autorizados' && normalizarNomeDeLista('Só Amigos') === 'so_amigos' && normalizarNomeDeLista('so-amigos') === 'so_amigos')
check('nome: caractere perigoso ou comprido demais é recusado', [' ', 'a/b', 'a%b', 'a_b%', 'x'.repeat(33), 5, null, '-x', '1lista', '_x'].every((n) => normalizarNomeDeLista(n) === null))
check('a chave é reservada: nem automação nem a rota genérica escrevem nela', ehChaveReservada(chaveDaLista('vip')) && chaveDaLista('vip') === '__lista__vip')
check('LIKE não vaza: "_" do prefixo não casa qualquer coisa', (db.prepare("INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES ('contact', ?, ?, 'true', ?)").run(ANA, 'xxlistaxxfalsa', new Date().toISOString()), listasExistentes(db).every((l) => l.nome !== 'falsa')))
check('valor que não é true não conta como membro', (db.prepare("INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at) VALUES ('contact', ?, ?, '\"true\"', ?)").run(ANA, '__lista__texto', new Date().toISOString()), !estaNaLista(db, 'texto', ANA) && membrosDaLista(db, 'texto').length === 0))
const existentes = listasExistentes(db)
check('listasExistentes devolve só as que têm gente, com a contagem', existentes.length === 1 && existentes[0].nome === 'vip' && existentes[0].membros === 1, JSON.stringify(existentes))
check('listasDa devolve o mapa das listas da pessoa, vazio para quem não está em nenhuma',
  JSON.stringify(listasDa(db, BIA)) === '{"vip":true}' && JSON.stringify(listasDa(db, ANA)) === '{}' && JSON.stringify(listasDa(db, null)) === '{}')
check('listas não confundem com dono', (db.prepare("SELECT COUNT(*) AS n FROM entity_attributes WHERE key = '__owner__'").get().n === 0))

console.log(falhas === 0 ? '\nAS LISTAS GUARDAM QUEM ESTÁ DENTRO, E LISTA VAZIA NUNCA É "TODOS"' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
