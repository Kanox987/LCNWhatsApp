// Como a conexão se apresenta em "Aparelhos conectados".
//
// O risco real aqui é silencioso: a biblioteca traduz qualquer valor que não
// conheça para UNKNOWN, sem erro. Um erro de digitação viraria um aparelho sem
// nome no celular de quem conectou, e nada no log diria por quê.
import fs from 'fs'
import { APARELHOS, APARELHO_PADRAO, acharAparelho, ehAparelhoValido, resolverAparelho } from '../src/aparelho.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

// --- o padrão não muda o que já existia -----------------------------------
const padrao = resolverAparelho({})
check('sem escolha, continua Chrome como sempre foi', padrao.deviceBrowser === 'chrome', padrao.deviceBrowser)
check('e com um sistema preenchido, nunca vazio', padrao.deviceOsDisplayName === 'Ubuntu', padrao.deviceOsDisplayName)
check('o padrão declarado existe na lista', ehAparelhoValido(APARELHO_PADRAO))

// --- escolher funciona ----------------------------------------------------
const tablet = resolverAparelho({ navegador: 'android tablet' })
check('tablet Android é aceito', tablet.deviceBrowser === 'android tablet')
check('e traz o sistema próprio dele', tablet.deviceOsDisplayName === 'Android', tablet.deviceOsDisplayName)

check('maiúscula e espaço sobrando não quebram', resolverAparelho({ navegador: '  SAFARI ' }).deviceBrowser === 'safari')

// Sistema explícito vence o padrão do aparelho, mesmo sendo esquisito: quem
// digitou tinha um motivo, e inventar um teto aqui não protegeria ninguém.
check('sistema escrito à mão é respeitado', resolverAparelho({ navegador: 'safari', sistema: 'meu pc' }).deviceOsDisplayName === 'meu pc')
check('sistema só com espaços cai no padrão', resolverAparelho({ navegador: 'safari', sistema: '   ' }).deviceOsDisplayName === 'macOS')

// --- inválido é RECUSADO, não vira UNKNOWN em silêncio --------------------
let erro
try { resolverAparelho({ navegador: 'androide' }) } catch (e) { erro = e }
check('aparelho desconhecido é recusado', !!erro)
check('e o erro diz o que foi digitado', /androide/.test(erro?.message || ''), erro?.message)
check('e lista as opções válidas junto', /chrome.*android tablet/.test(erro?.message || ''), erro?.message)

check('valor vazio não é erro — é "não escolhi"', resolverAparelho({ navegador: '' }).deviceBrowser === 'chrome')
check('nulo também cai no padrão', resolverAparelho({ navegador: null }).deviceBrowser === 'chrome')
check('acharAparelho devolve null em vez de inventar', acharAparelho('nada disso') === null)

// --- toda entrada é utilizável -------------------------------------------
check('todo aparelho tem rótulo humano', APARELHOS.every((a) => typeof a.rotulo === 'string' && a.rotulo.length > 1))
check('todo aparelho tem um sistema padrão', APARELHOS.every((a) => typeof a.sistemaPadrao === 'string' && a.sistemaPadrao.length > 1))
check('nenhum id repetido', new Set(APARELHOS.map((a) => a.id)).size === APARELHOS.length)

// --- a lista não pode prometer o que a biblioteca não entende ------------
// Este é o caso que justifica o arquivo. A biblioteca decide o tipo de
// plataforma num `switch` sobre o mesmo texto; o que não casa cai no `default`
// e vira UNKNOWN. Se ela mudar esse switch numa atualização, a nossa lista
// passa a oferecer um aparelho que aparece sem nome — e ninguém saberia.
const fonte = fs.readFileSync(
  new URL('../node_modules/zapo-js/dist/esm/transport/noise/WaClientPayload.js', import.meta.url), 'utf8'
)
const trecho = fonte.slice(fonte.indexOf('resolveDevicePropsPlatformType'))
const aceitosPelaLib = new Set([...trecho.matchAll(/case '([^']+)':/g)].map((m) => m[1]))

check('a biblioteca ainda tem a tradução de aparelhos', aceitosPelaLib.size > 5, `${aceitosPelaLib.size} casos`)
const naoEntendidos = APARELHOS.map((a) => a.id).filter((id) => !aceitosPelaLib.has(id))
check('todo aparelho que oferecemos é entendido pela biblioteca',
  naoEntendidos.length === 0,
  naoEntendidos.length ? `viram UNKNOWN: ${naoEntendidos.join(', ')}` : '')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE APARELHO PASSARAM')
process.exit(falhas ? 1 : 0)
