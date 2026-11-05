// Rotas das listas: criar, ver, tirar e limpar pelo painel/CLI. As mesmas regras da
// escrita pelo WhatsApp: nome validado, contato no formato certo, lista vazia = ninguém.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import { estaNaLista } from '../src/engine/server/listas.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const db = abrirBanco(':memory:')
const api = criarApi(db)
const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const chamar = async (method, pathname, body) => {
  try { return { ok: true, dado: await api.resolver(method, pathname, contexto(body)) } } catch (erro) { return { ok: false, status: erro.status, erro } }
}

const ANA = '5511911111111@s.whatsapp.net'
const BIA = '5511922222222@s.whatsapp.net'
const enc = encodeURIComponent

check('sem listas, a listagem vem vazia', (await chamar('GET', '/listas')).dado?.lists?.length === 0)
const add = await chamar('POST', '/listas/Autorizados/membros', { contactId: ANA })
check('adicionar pelo painel entra na lista (nome normalizado)', add.ok && add.dado.name === 'autorizados' && add.dado.changed === true && estaNaLista(db, 'autorizados', ANA))
check('adicionar de novo não muda nada', (await chamar('POST', '/listas/autorizados/membros', { contactId: ANA })).dado?.changed === false)
await chamar('POST', '/listas/autorizados/membros', { contactId: BIA })
const ver = await chamar('GET', '/listas/autorizados')
check('ver a lista traz os dois', ver.dado?.members?.length === 2 && ver.dado.members.includes(ANA) && ver.dado.members.includes(BIA))
check('a listagem conta os membros', JSON.stringify((await chamar('GET', '/listas')).dado?.lists) === JSON.stringify([{ nome: 'autorizados', membros: 2 }]))
check('nome inválido: 400', (await chamar('POST', '/listas/9x/membros', { contactId: ANA })).status === 400)
check('contato fora do formato: 400', (await chamar('POST', '/listas/autorizados/membros', { contactId: 'qualquer' })).status === 400)
check('sem contato: 400', (await chamar('POST', '/listas/autorizados/membros', {})).status === 400)
const tirar = await chamar('DELETE', `/listas/autorizados/membros/${enc(ANA)}`)
check('tirar um membro', tirar.dado?.changed === true && !estaNaLista(db, 'autorizados', ANA) && estaNaLista(db, 'autorizados', BIA))
check('tirar quem não está não quebra', (await chamar('DELETE', `/listas/autorizados/membros/${enc(ANA)}`)).dado?.changed === false)
const limpar = await chamar('DELETE', '/listas/autorizados')
check('limpar esvazia a lista', limpar.dado?.removed === 1 && !estaNaLista(db, 'autorizados', BIA) && (await chamar('GET', '/listas')).dado.lists.length === 0)
check('limpar não toca em outra lista', await (async () => {
  await chamar('POST', '/listas/vip/membros', { contactId: ANA })
  await chamar('DELETE', '/listas/autorizados')
  return estaNaLista(db, 'vip', ANA)
})())

process.exit(falhas ? 1 : 0)
