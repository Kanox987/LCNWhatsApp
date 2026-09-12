// classificarFechamento (src/connectionReasons.js) decide se um fechamento de
// conexão pode reconectar sozinho — é a correção direta do incidente em que
// um retry genérico pra QUALQUER motivo (inclusive conflito de sessão) fez
// duas instâncias brigarem pela mesma sessão do WhatsApp.
import { classificarFechamento, codigoParaClasse, mensagemParaClasse } from '../src/connectionReasons.js'
import { EXIT_LOGOUT_REPAIR_NEEDED, EXIT_CONFLICT, EXIT_FATAL_ACCOUNT } from '../src/exitCodes.js'

let falhas = 0
function check (nome, got, exp) { const ok = got === exp; if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome.padEnd(55)} exp=${exp} got=${got}`) }

// isLogout só decide quando o reason não é um dos motivos específicos
// conhecidos (conflito/fatal_account) — motivo específico sempre vence,
// porque é mais informativo (ver comentário em connectionReasons.js sobre
// por quê: no Zapo real, vários motivos "fatais" já chegam com
// isLogout:true, e checar isLogout primeiro tornaria esses motivos
// inalcançáveis, escondendo a causa raiz atrás de um "logout" genérico).
check('isLogout=true com reason sem classificação específica cai em logout', classificarFechamento({ reason: 'client_disconnected', isLogout: true }), 'logout')
check('reason de conflito vence mesmo com isLogout=true', classificarFechamento({ reason: 'stream_error_replaced', isLogout: true }), 'conflito')

// Conflito — o motivo exato do incidente real. stream_error_replaced chega
// com isLogout:false no Zapo real.
check('stream_error_replaced é conflito', classificarFechamento({ reason: 'stream_error_replaced', isLogout: false }), 'conflito')

// stream_error_force_login (515): o Zapo reconecta o MESMO client sozinho
// internamente. Precisa de classe PRÓPRIA (não transiente!) — se caísse em
// transiente, o app agendaria seu próprio retry por cima da reconexão
// interna do Zapo, criando um segundo client pro mesmo sessionId. Chega com
// isLogout:false no Zapo real.
check('stream_error_force_login é auto_gerenciado (não conflito, não transiente)', classificarFechamento({ reason: 'stream_error_force_login', isLogout: false }), 'auto_gerenciado')

// stream_error_force_logout chega com isLogout:true no Zapo real — cai no
// bucket 'logout' via o isLogout genérico, não precisa estar na lista de
// conflito (ficaria código morto).
check('stream_error_force_logout (isLogout real) é logout', classificarFechamento({ reason: 'stream_error_force_logout', isLogout: true }), 'logout')

// Conta com problema — retry não resolve, pode piorar. Pares (reason,
// isLogout) aqui reproduzem o comportamento REAL do Zapo 1.8.2 (confirmado
// lendo o código-fonte, não só os tipos): todos chegam com isLogout:true,
// e mesmo assim precisam classificar como fatal_account (não logout) pra
// não esconder a causa raiz — daí a ordem de checagem em classificarFechamento
// (motivo específico antes do isLogout genérico).
check('failure_locked é fatal_account mesmo com isLogout real (true)', classificarFechamento({ reason: 'failure_locked', isLogout: true }), 'fatal_account')
check('failure_banned é fatal_account mesmo com isLogout real (true)', classificarFechamento({ reason: 'failure_banned', isLogout: true }), 'fatal_account')
check('failure_not_authorized é fatal_account mesmo com isLogout real (true)', classificarFechamento({ reason: 'failure_not_authorized', isLogout: true }), 'fatal_account')
check('primary_identity_key_change é fatal_account mesmo com isLogout real (true)', classificarFechamento({ reason: 'primary_identity_key_change', isLogout: true }), 'fatal_account')
check('stream_error_device_removed é fatal_account mesmo com isLogout real (true)', classificarFechamento({ reason: 'stream_error_device_removed', isLogout: true }), 'fatal_account')

// Transiente — comportamento de hoje (backoff), sem mudança.
check('client_disconnected é transiente', classificarFechamento({ reason: 'client_disconnected', isLogout: false }), 'transiente')
check('comms_stopped é transiente', classificarFechamento({ reason: 'comms_stopped', isLogout: false }), 'transiente')
check('failure_service_unavailable é transiente', classificarFechamento({ reason: 'failure_service_unavailable', isLogout: false }), 'transiente')
check('motivo desconhecido cai em transiente (nunca trava)', classificarFechamento({ reason: 'algo_que_nao_existe_ainda', isLogout: false }), 'transiente')
check('reason ausente cai em transiente', classificarFechamento({ reason: undefined, isLogout: false }), 'transiente')

// Códigos de saída — usados pelo RestartPreventExitStatus do Quadlet (Parte A).
check('código de logout', codigoParaClasse('logout'), EXIT_LOGOUT_REPAIR_NEEDED)
check('código de conflito', codigoParaClasse('conflito'), EXIT_CONFLICT)
check('código de fatal_account', codigoParaClasse('fatal_account'), EXIT_FATAL_ACCOUNT)
check('classe desconhecida não gera código de terminal (cai em 1 genérico)', codigoParaClasse('transiente'), 1)

// Mensagem — só garante que nunca fica undefined/vazia (o texto exato não é contrato).
check('mensagem de conflito menciona o motivo', mensagemParaClasse('conflito', 'stream_error_replaced').includes('stream_error_replaced'), true)
check('mensagem de classe desconhecida não quebra', typeof mensagemParaClasse('nao_existe', 'x'), 'string')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE CLASSIFICAÇÃO DE FECHAMENTO PASSARAM')
process.exit(falhas ? 1 : 0)
