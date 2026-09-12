// Classifica o motivo real de um evento 'connection'/status:'close' do Zapo,
// pra decidir se vale reconectar sozinho ou não. Vocabulário confirmado em
// node_modules/zapo-js/dist/protocol/stream.d.ts (WA_DISCONNECT_REASONS) —
// não é suposição.
//
// A causa raiz de um incidente real de produção foi tratar TODO fechamento
// de conexão com o mesmo retry genérico — inclusive stream_error_replaced,
// que significa "outra sessão assumiu esta conexão" e nunca deveria
// reconectar sozinho (só piora a disputa). Este módulo existe pra separar
// isso do resto, testável sem precisar de um client Zapo de verdade.
import { EXIT_LOGOUT_REPAIR_NEEDED, EXIT_CONFLICT, EXIT_FATAL_ACCOUNT } from './exitCodes.js'

// Só stream_error_replaced é conflito de verdade. stream_error_force_logout
// não entra aqui — no Zapo instalado ele já chega com isLogout:true, cai no
// bucket 'logout' abaixo; mantê-lo aqui seria código morto.
const MOTIVOS_CONFLITO = new Set([
  'stream_error_replaced'
])

// stream_error_force_login (515): o PRÓPRIO Zapo reconecta o MESMO client
// internamente (WaStreamControlCoordinator.restartBackendAfterStreamControl,
// confirmado lendo o código real, não só os tipos) — loga "reconnecting,
// keeping credentials". Precisa de classe própria, DIFERENTE de transiente:
// se tratássemos como transiente, o app agendaria seu próprio
// setTimeout(conectar, ...) por cima da reconexão interna do Zapo, criando
// um SEGUNDO WaClient pro mesmo sessionId/store enquanto o primeiro ainda
// está se recuperando sozinho — recriando exatamente o tipo de disputa de
// sessão que este módulo existe pra evitar (achado em revisão de código).
// A ação certa aqui é não fazer nada: nem contar como falha, nem agendar
// retry — só esperar o próximo evento do MESMO client (open, se a
// reconexão interna do Zapo funcionar, ou outro close se não).
const MOTIVOS_AUTO_GERENCIADOS = new Set([
  'stream_error_force_login'
])

// failure_not_authorized entra aqui (não em transiente): é 401, indica
// credencial/token inválido — retry cego pode piorar (rate limit, ban).
//
// IMPORTANTE: no Zapo 1.8.2 instalado, todos esses motivos já chegam com
// isLogout:true (confirmado lendo o código real, não só os tipos —
// dist/client/events/incoming.js trata 401/403/406 como logout, e
// primary_identity_key_change também é emitido com isLogout:true). Por
// isso este conjunto é checado ANTES do isLogout genérico logo abaixo —
// senão isLogout:true venceria primeiro e todo mundo cairia em 'logout'
// (ação final igual, mas motivo/mensagem/código de saída errados,
// escondendo que era especificamente conta banida/bloqueada/etc, não só
// "sessão encerrada no celular").
const MOTIVOS_FATAL_ACCOUNT = new Set([
  'failure_locked',
  'failure_banned',
  'failure_not_authorized',
  'primary_identity_key_change',
  'stream_error_device_removed'
])

// Retorna 'logout' | 'conflito' | 'fatal_account' | 'auto_gerenciado' | 'transiente'.
export function classificarFechamento ({ reason, isLogout }) {
  if (MOTIVOS_CONFLITO.has(reason)) return 'conflito'
  if (MOTIVOS_FATAL_ACCOUNT.has(reason)) return 'fatal_account'
  if (MOTIVOS_AUTO_GERENCIADOS.has(reason)) return 'auto_gerenciado'
  if (isLogout) return 'logout'
  return 'transiente'
}

const MENSAGENS = {
  logout: () => 'Sessão encerrada no celular. Apague a pasta ./sessao e reconecte.',
  conflito: (motivo) => `Conflito de sessão detectado (${motivo}) — outra conexão assumiu esta sessão. Não reconectando sozinho.`,
  fatal_account: (motivo) => `Problema de conta (${motivo}) — retry automático não resolve. Verifique o status da conta.`
}

export function mensagemParaClasse (classe, motivo) {
  const f = MENSAGENS[classe]
  return f ? f(motivo) : `Conexão caiu (motivo ${motivo})`
}

const CODIGOS = {
  logout: EXIT_LOGOUT_REPAIR_NEEDED,
  conflito: EXIT_CONFLICT,
  fatal_account: EXIT_FATAL_ACCOUNT
}

export function codigoParaClasse (classe) {
  return CODIGOS[classe] ?? 1
}
