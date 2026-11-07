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

// A rota entrega no máximo 50 por vez, então 30 pendentes de uma queda grande
// não cabiam numa consulta só. Cada lote fechado sai da lista, e a próxima
// consulta traz os seguintes. Para quando não há mais nada, quando um lote não
// fechou ninguém (o motor recusa; insistir giraria para sempre) ou no teto.
const LOTE = 50
const MAXIMO_DE_LOTES = 20

export async function fecharOrfaos (client, clienteEngine, accountId, { log, avisar = true, agora = Date.now(), idadeMaximaMs = 60 * 60 * 1000, antesDe = null } = {}) {
  if (!accountId) return { fechados: 0, avisados: 0, completo: true }

  let fechados = 0
  let avisados = 0
  let completo = false
  for (let lote = 0; lote < MAXIMO_DE_LOTES; lote++) {
    let pendentes
    try {
      pendentes = await clienteEngine.execucoes.pendentes(accountId, LOTE, antesDe)
    } catch (erro) {
      // Falha aqui não pode impedir o gateway de subir: ficar sem fechar órfão é
      // ruim, não subir é pior.
      log?.(`[engine] não consegui listar comandos pendentes: ${erro?.message || erro}`)
      break
    }
    const lista = Array.isArray(pendentes) ? pendentes : []
    if (!lista.length) { completo = true; break }

    let fechadosNoLote = 0
    for (const comando of lista) {
      // Aviso só para o que caiu há pouco. Ressuscitar uma conversa de ontem
      // para dizer que um download falhou não ajuda ninguém — mas o registro é
      // fechado de qualquer jeito, senão continua invisível.
      const recente = !comando.createdAt || (agora - new Date(comando.createdAt).getTime()) < idadeMaximaMs

      // Fecha primeiro: se a confirmação falha, o comando segue pendente e a
      // próxima conexão tenta de novo — avisando antes, a pessoa receberia o
      // mesmo aviso a cada tentativa.
      try {
        await clienteEngine.execucoes.confirmar(comando.id, { status: 'outcome_unknown' })
        fechados++
        fechadosNoLote++
      } catch (erro) {
        log?.(`[engine] não consegui fechar o comando ${comando.id}: ${erro?.message || erro}`)
        continue
      }

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
    }
    // Falha parcial não é limpeza concluída: o que sobrou fica para a próxima conexão.
    if (fechadosNoLote !== lista.length) break
    if (lista.length < LOTE) { completo = true; break }
  }

  if (fechados) log?.(`[engine] ${fechados} comando(s) interrompido(s) foram fechados, ${avisados} aviso(s) enviado(s)`)
  return { fechados, avisados, completo }
}
