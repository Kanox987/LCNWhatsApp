// passaFiltro (src/capture.js) é a única linha de defesa hoje pra "não quero
// capturar disso" — grupo desligado, contato fora da allowlist, grupo fora da
// allowlist de grupos, contato bloqueado. Roda depois da Baileys decriptar.
import { passaFiltro } from '../src/capture.js'

let falhas = 0
function check(nome, got, exp){ const ok=got===exp; if(!ok)falhas++; console.log(`${ok?'✅':'❌'} ${nome.padEnd(50)} exp=${exp} got=${got}`) }

// grupos desligado (padrão): qualquer grupo é barrado
const cfgPadrao = { captura: { contatos:'todos', blocklist:[], grupos:{ativo:false,allowlist:[]} } }
check('grupo barrado quando grupos.ativo=false', passaFiltro(cfgPadrao, '5511999', true, '120@g.us'), false)
check('PV passa quando contatos=todos', passaFiltro(cfgPadrao, '5511999', false, '5511999@s.whatsapp.net'), true)

// allowlist de contatos
const cfgAllow = { captura: { contatos:['5511999'], blocklist:[], grupos:{ativo:false,allowlist:[]} } }
check('PV alvo passa (allowlist)', passaFiltro(cfgAllow, '5511999', false, 'x@s.whatsapp.net'), true)
check('PV fora da allowlist barrado', passaFiltro(cfgAllow, '5511888', false, 'x@s.whatsapp.net'), false)

// blocklist
const cfgBlock = { captura: { contatos:'todos', blocklist:['5511888'], grupos:{ativo:false,allowlist:[]} } }
check('PV bloqueado barrado', passaFiltro(cfgBlock, '5511888', false, 'x@s.whatsapp.net'), false)
check('PV fora da blocklist passa', passaFiltro(cfgBlock, '5511777', false, 'x@s.whatsapp.net'), true)

// grupos ligado, com allowlist de grupos
const cfgGrupoAllow = { captura: { contatos:'todos', blocklist:[], grupos:{ativo:true,allowlist:['120@g.us']} } }
check('grupo permitido passa', passaFiltro(cfgGrupoAllow, '5511999', true, '120@g.us'), true)
check('grupo fora da allowlist barrado', passaFiltro(cfgGrupoAllow, '5511999', true, '999@g.us'), false)

// grupos ligado, sem allowlist de grupos = qualquer grupo passa
const cfgGrupoTodos = { captura: { contatos:'todos', blocklist:[], grupos:{ativo:true,allowlist:[]} } }
check('qualquer grupo passa sem allowlist de grupos', passaFiltro(cfgGrupoTodos, '5511999', true, '999@g.us'), true)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE FILTRO PASSARAM')
process.exit(falhas?1:0)
