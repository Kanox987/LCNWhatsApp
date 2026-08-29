// shouldIgnoreJid roda ANTES da Baileys descriptografar e vale pra message, call,
// receipt E notification (não só chat) — por isso hoje só descarta tráfego
// genuinamente inerte (broadcast/newsletter). Grupo/allowlist/blocklist são
// filtrados depois, em passaFiltro (ver filtro.test.mjs) — senão a Baileys perde
// bookkeeping de protocolo (sync de grupo, recibos) que mantém a sessão saudável.
import { montarShouldIgnore } from '../src/ignore.js'

let falhas = 0
function check(nome, got, exp){ const ok=got===exp; if(!ok)falhas++; console.log(`${ok?'✅':'❌'} ${nome.padEnd(42)} exp=${exp} got=${got}`) }

const s = montarShouldIgnore({ captura: { contatos:'todos', blocklist:[], grupos:{ativo:false,allowlist:[]} } })

check('status ignorado', s('status@broadcast'), true)
check('broadcast ignorado', s('123@broadcast'), true)
check('newsletter ignorado', s('123@newsletter'), true)
check('grupo NÃO ignorado nessa camada (mesmo com grupos.ativo=false)', s('120@g.us'), false)
check('PV NÃO ignorado nessa camada', s('5511999@s.whatsapp.net'), false)
check('lid NÃO ignorado nessa camada', s('456@lid'), false)

// mesmo com allowlist/blocklist configurados, shouldIgnoreJid não filtra mais PV/grupo
const s2 = montarShouldIgnore({ captura: { contatos:['5511999'], blocklist:['5511888'], grupos:{ativo:false,allowlist:[]} } })
check('PV fora da allowlist ainda passa aqui (filtrado depois em passaFiltro)', s2('5511777@s.whatsapp.net'), false)
check('PV na blocklist ainda passa aqui (filtrado depois em passaFiltro)', s2('5511888@s.whatsapp.net'), false)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE IGNORE PASSARAM')
process.exit(falhas?1:0)
