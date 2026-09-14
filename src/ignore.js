// Filtro de jid "genuinamente inerte" (status broadcast e canais) — usado
// dentro do handler de mensagem, DEPOIS que o Zapo já descriptografou.
//
// CORREÇÃO (achado em revisão de código, Parte B do plano de automação): a
// afirmação de que "o Zapo não expõe hook equivalente" ao shouldIgnoreJid da
// Baileys está desatualizada. A versão instalada (zapo-js@1.8.2) TEM
// client.ignoreKey(...) — descarta stanzas ANTES de qualquer handler, por
// remoteJid/participant/fromMe/id, com `only` filtrando por classe de
// stanza (message/receipt/notification/presence/chatstate/call); o servidor
// ainda recebe o ack (ver node_modules/zapo-js/dist/client/WaClient.d.ts).
// A limitação real é outra: isso filtra por CLASSE de stanza, não por tipo
// de mídia — não dá pra saber se uma mensagem é áudio ou foto antes de
// decriptar o payload, então "ignore foto mas deixe passar áudio" não tem
// equivalente pré-decrypt. Ainda não é usado neste arquivo (ver Parte B,
// "Processamento seletivo por grupo/contato" no plano, pra quando isso for
// ligado de verdade) — continua só uma checagem pós-decrypt, redundante com
// a que já existia no pipeline de captura antigo, mantida por
// clareza e porque os testes (ignore.test.mjs) continuam valendo como está.
//
// Ponto de atenção herdado da versão Baileys: bloquear @g.us genericamente
// aqui já causou, no passado, falha silenciosa na captura de PV (a lib
// depende de processar notificações/recibos de grupo pra manter o
// mapeamento PN↔LID e a sessão saudável) — por isso @g.us nunca entra
// nesse filtro. Validar isso de novo com o Zapo durante os testes manuais.
export const ehBroadcast = (jid) => typeof jid === 'string' && jid.endsWith('@broadcast')
export const ehNewsletter = (jid) => typeof jid === 'string' && jid.endsWith('@newsletter')

export function deveIgnorarJid (jid) {
  return ehBroadcast(jid) || ehNewsletter(jid)
}
