// deveIgnorarJid roda dentro do handler de mensagem, DEPOIS que o Zapo já
// descriptografou (o Zapo não expõe hook pré-decrypt equivalente ao
// shouldIgnoreJid da Baileys) — por isso hoje só descarta tráfego
// genuinamente inerte (broadcast/newsletter). Grupo/allowlist/blocklist são
// filtrados depois, em passaFiltro (ver filtro.test.mjs).
import { deveIgnorarJid } from '../src/ignore.js'

let falhas = 0
function check(nome, got, exp){ const ok=got===exp; if(!ok)falhas++; console.log(`${ok?'✅':'❌'} ${nome.padEnd(42)} exp=${exp} got=${got}`) }

check('status ignorado', deveIgnorarJid('status@broadcast'), true)
check('broadcast ignorado', deveIgnorarJid('123@broadcast'), true)
check('newsletter ignorado', deveIgnorarJid('123@newsletter'), true)
check('grupo NÃO ignorado nessa camada (mesmo com grupos.ativo=false)', deveIgnorarJid('120@g.us'), false)
check('PV NÃO ignorado nessa camada', deveIgnorarJid('5511999@s.whatsapp.net'), false)
check('lid NÃO ignorado nessa camada', deveIgnorarJid('456@lid'), false)

// mesmo com allowlist/blocklist configurados, deveIgnorarJid não filtra PV/grupo
// (allowlist/blocklist não entram mais aqui — nunca dependeu de cfg de verdade)
check('PV fora da allowlist ainda passa aqui (filtrado depois em passaFiltro)', deveIgnorarJid('5511777@s.whatsapp.net'), false)
check('PV na blocklist ainda passa aqui (filtrado depois em passaFiltro)', deveIgnorarJid('5511888@s.whatsapp.net'), false)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE IGNORE PASSARAM')
process.exit(falhas?1:0)
