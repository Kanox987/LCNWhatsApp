// Scheduler de mensagens agendadas.
//
// O motor guarda o agendamento (é dono do banco), mas o gateway é quem envia
// (é dono da conexão WhatsApp). O fluxo:
//
//   1. Automação usa `action.whatsapp.schedule` → motor insere em
//      `scheduled_messages` com status 'pending'.
//   2. Gateway chama `buscarPendentes()` periodicamente → recebe os vencidos.
//   3. Gateway envia cada um como mensagem normal via Zapo.
//   4. Gateway chama `marcarEnviado()` ou `marcarFalha()` para fechar.
//
// Por que não usar outbound_commands? Porque ele nasce atrelado a um
// automation_run (evento que disparou), e o scheduler dispara SEM evento —
// é o relógio, não uma mensagem chegando. Tentar encaixar ali exigiria
// fabricar eventos sintéticos e quebraria a deduplicação por eventId.
// Tabela própria é mais limpa e não compete com o fluxo normal.

export function criarScheduler (db) {
  const inserir = db.prepare(`INSERT INTO scheduled_messages
    (id, automation_id, target_account_id, chat_id, payload_json, scheduled_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)

  const buscarPendentes = db.prepare(`SELECT * FROM scheduled_messages
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
    LIMIT ?`)

  const marcarEnviado = db.prepare(`UPDATE scheduled_messages
    SET status = 'sent', sent_at = ? WHERE id = ?`)

  const marcarFalha = db.prepare(`UPDATE scheduled_messages
    SET status = 'failed', error_text = ? WHERE id = ?`)

  // Reagendar: volta pra pending com novo horário. Útil quando o gateway
  // estava desconectado e perdeu a janela — melhor tentar de novo do que
  // perder a mensagem pra sempre.
  const reagendar = db.prepare(`UPDATE scheduled_messages
    SET status = 'pending', scheduled_at = ?, error_text = NULL WHERE id = ?`)

  return {
    agendar ({ id, automationId, targetAccountId, chatId, payload, scheduledAt }) {
      if (!id || !targetAccountId || !chatId || !payload || !scheduledAt) {
        throw new Error('campos obrigatórios: id, targetAccountId, chatId, payload, scheduledAt')
      }
      const agora = new Date().toISOString()
      inserir.run(id, automationId || null, targetAccountId, chatId, JSON.stringify(payload), scheduledAt, agora)
      return { ok: true, id }
    },

    buscarPendentes ({ agora = new Date().toISOString(), limite = 50 } = {}) {
      return buscarPendentes.all(agora, limite)
    },

    marcarEnviado (id) {
      return marcarEnviado.run(new Date().toISOString(), id)
    },

    marcarFalha (id, erro) {
      return marcarFalha.run(String(erro || 'desconhecido'), id)
    },

    reagendar (id, novoHorario) {
      return reagendar.run(novoHorario, id)
    }
  }
}