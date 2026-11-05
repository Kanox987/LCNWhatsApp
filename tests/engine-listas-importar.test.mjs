// Lista como arquivo: exportar, e importar com prévia. Pôr gente numa lista é dar
// permissão, então a importação é tudo-ou-nada e a substituição só vale para o
// estado que a pessoa viu na prévia.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { estaNaLista, membrosDaLista } from '../src/engine/server/listas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const chamar = async (method, pathname, body) => {
  try { return { ok: true, dado: await api.resolver(method, pathname, contexto(body)) } } catch (erro) { return { ok: false, status: erro.status, erro } }
}
const j = (n) => `55119${String(n).padStart(8, '0')}@s.whatsapp.net`
const [ANA, BIA, CAI, DEA] = [j(1), j(2), j(3), j(4)]
const importar = (nome, corpo) => chamar('POST', `/listas/${nome}/importar`, corpo)

await chamar('POST', '/listas/autorizados/membros', { contactId: ANA })
await chamar('POST', '/listas/autorizados/membros', { contactId: BIA })

// --- exportar ---------------------------------------------------------------
const exp = await chamar('GET', '/listas/Autorizados/exportar')
check('exportar traz formato, versão, nome e membros', exp.dado?.formato === 'lcn-lista' && exp.dado.versao === 1 && exp.dado.nome === 'autorizados' && exp.dado.membros.length === 2)
check('exportar lista que não existe devolve vazia, sem erro', (await chamar('GET', '/listas/nada/exportar')).dado?.membros?.length === 0)
check('exportar com nome inválido: 400', (await chamar('GET', '/listas/9x/exportar')).status === 400)

// --- prévia não grava -------------------------------------------------------
const antes = JSON.stringify(membrosDaLista(db, 'autorizados'))
let r = await importar('autorizados', { dados: [CAI, BIA], modo: 'merge' })
check('sem "simular" a resposta é só prévia', r.ok && r.dado.applied === false && r.dado.adicionar === 1 && r.dado.jaEstavam === 1 && r.dado.remover === 0 && r.dado.totalFinal === 3)
check('prévia não grava', JSON.stringify(membrosDaLista(db, 'autorizados')) === antes && !estaNaLista(db, 'autorizados', CAI))
check('prévia não vaza listas internas', !('_adicionar' in r.dado) && !('_remover' in r.dado))

// --- merge ------------------------------------------------------------------
r = await importar('autorizados', { dados: [CAI, BIA], modo: 'merge', simular: false })
check('merge acrescenta e mantém quem já estava', r.ok && r.dado.applied === true && estaNaLista(db, 'autorizados', ANA) && estaNaLista(db, 'autorizados', CAI))
check('merge não mexe em quem já estava', JSON.stringify(membrosDaLista(db, 'autorizados').slice(0, 2)) === antes)

// --- formatos aceitos -------------------------------------------------------
r = await importar('novos', { dados: { formato: 'lcn-lista', versao: 1, nome: 'outra', membros: [ANA] }, modo: 'merge', simular: false })
check('o nome dentro do arquivo não manda: vale o da URL', r.ok && r.dado.name === 'novos' && estaNaLista(db, 'novos', ANA) && !estaNaLista(db, 'outra', ANA))
r = await importar('digitos', { dados: ['5511900000009', ` ${DEA} `], modo: 'merge', simular: false })
check('só dígitos viram jid de telefone; espaços nas pontas saem', r.ok && estaNaLista(db, 'digitos', '5511900000009@s.whatsapp.net') && estaNaLista(db, 'digitos', DEA))
r = await importar('rep', { dados: [ANA, ANA, BIA], modo: 'merge' })
check('repetidas no arquivo são contadas, não duplicadas', r.dado?.repeated === 1 && r.dado.adicionar === 2)

// --- recusas: tudo ou nada --------------------------------------------------
const antesRecusa = JSON.stringify(membrosDaLista(db, 'autorizados'))
const recusas = [
  ['entrada inválida no meio', { dados: [DEA, 'qualquer coisa', BIA], modo: 'merge', simular: false }],
  ['jid de LID', { dados: ['123456789012345@lid'], modo: 'merge', simular: false }],
  ['entrada que não é texto', { dados: [{ a: 1 }], modo: 'merge', simular: false }],
  ['__proto__', { dados: ['__proto__'], modo: 'merge', simular: false }],
  ['arquivo vazio', { dados: [], modo: 'merge', simular: false }],
  ['objeto de outro formato', { dados: { formato: 'outro', membros: [ANA] }, modo: 'merge' }],
  ['versão desconhecida', { dados: { formato: 'lcn-lista', versao: 99, membros: [ANA] }, modo: 'merge' }],
  ['dados que não são lista', { dados: 'texto', modo: 'merge' }],
  ['sem dados', { modo: 'merge' }],
  ['modo ausente', { dados: [ANA] }],
  ['modo desconhecido', { dados: [ANA], modo: 'apagar' }]
]
for (const [nome, corpo] of recusas) {
  const x = await importar('autorizados', corpo)
  check(`recusa: ${nome}`, !x.ok && x.status === 400, String(x.status))
}
check('nada foi gravado por nenhuma recusa', JSON.stringify(membrosDaLista(db, 'autorizados')) === antesRecusa)
r = await importar('autorizados', { dados: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'], modo: 'merge' })
check('lista os primeiros erros e conta o resto', !r.ok && r.erro.message.includes('Entrada 1') && r.erro.message.includes('Entrada 5') && !r.erro.message.includes('Entrada 6') && r.erro.message.includes('mais 2'))
check('nome de lista inválido: 400', (await importar('9x', { dados: [ANA], modo: 'merge' })).status === 400)

process.env.LCN_LISTA_IMPORT_MAX = '3'
r = await importar('autorizados', { dados: [ANA, BIA, CAI, DEA], modo: 'merge' })
check('o limite de tamanho é configurável e recusa acima dele', !r.ok && r.status === 400 && r.erro.message.includes('limite é 3'))
delete process.env.LCN_LISTA_IMPORT_MAX

// --- replace ----------------------------------------------------------------
const previa = (await importar('autorizados', { dados: [BIA, DEA], modo: 'replace' })).dado
check('prévia do replace diz quem sai', previa.adicionar === 1 && previa.jaEstavam === 1 && previa.remover === 2 && previa.totalFinal === 2 && typeof previa.estado === 'string')
r = await importar('autorizados', { dados: [BIA, DEA], modo: 'replace', simular: false })
check('replace sem "estado" é recusado', !r.ok && r.status === 400)
r = await importar('autorizados', { dados: [BIA, DEA], modo: 'replace', simular: false, estado: 'palpite' })
check('replace com estado errado: 409 e nada muda', !r.ok && r.status === 409 && JSON.stringify(membrosDaLista(db, 'autorizados')) === antesRecusa)

// a lista muda entre a prévia e a aplicação (mesma quantidade a sair!)
await chamar('DELETE', `/listas/autorizados/membros/${encodeURIComponent(ANA)}`)
await chamar('POST', '/listas/autorizados/membros', { contactId: j(7) })
r = await importar('autorizados', { dados: [BIA, DEA], modo: 'replace', simular: false, estado: previa.estado })
check('lista mudou depois da prévia: 409 mesmo com igual número de saídas', !r.ok && r.status === 409)

const nova = (await importar('autorizados', { dados: [BIA, DEA], modo: 'replace' })).dado
r = await importar('autorizados', { dados: [BIA, DEA], modo: 'replace', simular: false, estado: nova.estado })
const finais = membrosDaLista(db, 'autorizados').sort()
check('replace com o estado certo deixa a lista exatamente como o arquivo', r.ok && r.dado.applied === true && JSON.stringify(finais) === JSON.stringify([BIA, DEA].sort()), JSON.stringify(finais))
check('replace não mexe em outras listas', estaNaLista(db, 'novos', ANA) && estaNaLista(db, 'digitos', DEA))
check('quem saiu deixou de estar na lista', !estaNaLista(db, 'autorizados', CAI) && !estaNaLista(db, 'autorizados', j(7)))

// o mesmo arquivo de novo: nada a fazer
const igual = (await importar('autorizados', { dados: [BIA, DEA], modo: 'replace' })).dado
check('importar o mesmo arquivo não muda nada', igual.adicionar === 0 && igual.remover === 0 && igual.jaEstavam === 2)

// ida e volta: o que sai do export entra no import sem perda
const arquivo = (await chamar('GET', '/listas/autorizados/exportar')).dado
const copia = await importar('copia', { dados: arquivo, modo: 'merge', simular: false })
check('o arquivo exportado é aceito na importação', copia.ok && JSON.stringify(membrosDaLista(db, 'copia').sort()) === JSON.stringify(arquivo.membros.slice().sort()))

process.exit(falhas ? 1 : 0)
