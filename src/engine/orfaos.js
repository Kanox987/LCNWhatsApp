// Fecha os comandos que ficaram sem resposta quando o gateway caiu no meio.
//
// Quem executa comando de uma conta é UM processo só. Então, se este gateway
// acabou de subir, nada dele está em andamento: o que sobrou `pending` foi
// interrompido — reinício, queda, deploy.
//
// Ficavam presos para sempre, invisíveis na aba Execuções. E o pior caso é o
// download, que manda "⏳ Baixando…" ANTES de baixar: a pessoa fica esperando
// uma mídia que nunca vem, sem nada dizendo que falhou. Foi o que aconteceu
// quatro vezes num deploy.
//
// O estado é `outcome_unknown`, nunca `failed`: o invariante 3 diz que
// resultado ambíguo não pode virar falha — o comando PODE ter sido executado
// antes da queda, e registrar falha faria alguém desfazer à mão algo que já
// aconteceu.

// Só avisa quem estava esperando de verdade. Um comando sem promessa feita
// (uma resposta que nunca saiu) não ganha mensagem nenhuma: quem mandou o
// comando não viu nada acontecer, e um aviso do nada, minutos depois, confunde
// mais do que ajuda.
function prometeuAlgo (comando) {
  return comando?.commandType === 'media.download' && Boolean(comando?.payload?.ackText)
}

const AVISO_PADRAO = '⚠️ Não consegui terminar o download — o serviço reiniciou no meio. Mande o link de novo.'

export async function fecharOrfaos (client, clienteEngine, accountId, { log, avisar = true, agora = Date.now(), idadeMaximaMs = 60 * 60 * 1000 } = {}) {
  if (!accountId) return { fechados: 0, avisados: 0 }

  let pendentes
  try {
    pendentes = await clienteEngine.execucoes.pendentes(accountId)
  } catch (erro) {
    // Falha aqui não pode impedir o gateway de subir: ficar sem fechar órfão é
    // ruim, não subir é pior.
    log?.(`[engine] não consegui listar comandos pendentes: ${erro?.message || erro}`)
    return { fechados: 0, avisados: 0 }
  }

  let fechados = 0
  let avisados = 0
  for (const comando of Array.isArray(pendentes) ? pendentes : []) {
    // Aviso só para o que caiu há pouco. Ressuscitar uma conversa de ontem
    // para dizer que um download falhou não ajuda ninguém — mas o registro é
    // fechado de qualquer jeito, senão continua invisível.
    const recente = !comando.createdAt || (agora - new Date(comando.createdAt).getTime()) < idadeMaximaMs

    if (avisar && recente && prometeuAlgo(comando) && comando.payload?.chatId) {
      try {
        await client.message.send(comando.payload.chatId, {
          type: 'text',
          text: comando.payload.errorText
            ? String(comando.payload.errorText).replaceAll('{{erro}}', 'o serviço reiniciou no meio do download')
            : AVISO_PADRAO
        })
        avisados++
      } catch (erro) {
        log?.(`[engine] não consegui avisar sobre o comando ${comando.id}: ${erro?.message || erro}`)
      }
    }

    try {
      await clienteEngine.execucoes.confirmar(comando.id, { status: 'outcome_unknown' })
      fechados++
    } catch (erro) {
      log?.(`[engine] não consegui fechar o comando ${comando.id}: ${erro?.message || erro}`)
    }
  }

  if (fechados) log?.(`[engine] ${fechados} comando(s) interrompido(s) foram fechados, ${avisados} aviso(s) enviado(s)`)
  return { fechados, avisados }
}
