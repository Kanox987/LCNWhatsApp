// Monta a função shouldIgnoreJid da Baileys.
//
// A Baileys avalia essa função no nó CRU, antes de descriptografar — mas não só
// para mensagens de chat: ela gate-keia TODO tráfego de protocolo endereçado a um
// jid (message, call, receipt E notification — ver processNode em
// lib/Socket/messages-recv.js). Retornar true descarta o nó inteiro, sem chegar
// nem em handleNotification/handleReceipt.
//
// Isso importa porque notificações de grupo (w:gp2 — sync de participantes) e
// recibos endereçados a @g.us são uma das formas da Baileys manter o mapeamento
// PN↔LID e a saúde da sessão em dia — inclusive pra contatos que só "aparecem"
// pra ela via grupo. Bloquear @g.us genericamente aqui (como fizemos numa versão
// anterior, pensando só em "não processar CONTEÚDO de grupo") também corta esse
// bookkeeping, e isso já causou falha silenciosa na captura de visu única de PV
// (sessão/LID nunca ficava saudável o suficiente). Por isso este filtro só
// descarta tráfego GENUINAMENTE inerte, que não carrega bookkeeping nenhum:
// status broadcast e canais. A filtragem "não quero capturar disso" (grupo
// desligado, contato fora da allowlist) vive inteiramente em passaFiltro(),
// em src/capture.js — DEPOIS da Baileys já ter processado o protocolo direito.
const ehBroadcast = (jid) => typeof jid === 'string' && jid.endsWith('@broadcast')
const ehNewsletter = (jid) => typeof jid === 'string' && jid.endsWith('@newsletter')

export function montarShouldIgnore (_cfg) {
  return function shouldIgnoreJid (jid) {
    return ehBroadcast(jid) || ehNewsletter(jid)
  }
}
