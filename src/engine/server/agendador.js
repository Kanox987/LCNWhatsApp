// O RELÓGIO DO MOTOR.
//
// Uma automação `agendado` não tem mensagem, remetente nem conversa de entrada:
// ela acorda porque o tempo chegou. Este módulo é quem faz o tempo chegar — e
// só ele. Não existe segundo agendador (o do gateway era um placebo e foi
// descartado): o disparo vira um evento INTERNO e passa por `avaliarEvento`,
// ou seja, pelos mesmos portões, fila, limites e permissões de qualquer outro.
//
// O DESENHO, em três frases:
//   1. `reconciliar` olha as automações publicadas e LIGADAS e garante que cada
//      revisão agendada tenha o seu primeiro disparo na tabela; e cancela o que
//      ficou órfão (desligada, despublicada, revisão substituída). Como compara
//      o estado a cada passada, não depende de ninguém avisar "publiquei": vale
//      para publicar, instalar template, pacote e edição, sem fiação em cada um.
//   2. `tick` pega os disparos vencidos, reivindica cada um com um UPDATE
//      atômico (`WHERE status = 'pending'`, confere `changes === 1`) e entrega
//      ao avaliador. O eventId é determinístico, então repetir é inofensivo.
//   3. O relógio é INJETADO (`agora`): teste não espera tempo passar.
//
// POLÍTICA DE TEMPO PARADO. Se o motor ficou fora do ar e um disparo venceu:
//   - dentro da tolerância, dispara (atraso curto é o motor reiniciando);
//   - além dela, vira `perdido`, com o motivo. Mandar "bom dia" às 16h porque o
//     motor caiu às 8h é pior que não mandar.
//   - recorrente NUNCA dispara em rajada: a próxima ocorrência é calculada a
//     partir de AGORA, então três dias parado deixam um `perdido`, não três
//     mensagens.
import { instanteDe, primeiroDisparo, proximaOcorrencia } from '../../lcn/tempo.js'
import { avaliarEvento } from './evaluator.js'

// Parâmetros, não tetos: quem monta o motor passa outro valor.
export const TOLERANCIA_PADRAO_MS = 5 * 60 * 1000
export const INTERVALO_PADRAO_MS = 15 * 1000
export const LOTE_PADRAO = 50
// Reivindicado há mais que isto e nunca concluído = o processo morreu no meio.
export const ORFAO_APOS_MS = 2 * 60 * 1000

export const REMETENTE_DO_RELOGIO = '__schedule__'

const jsonOuNull = (v) => { try { return JSON.parse(v) } catch { return null } }

export function eventIdDoDisparo (job) {
  return `schedule:${job.automation_id}:${job.revision}:${job.chat_id}:${job.scheduled_for}`
}

/** O gatilho agendado de um documento, ou null. */
function agendaDoDocumento (documento) {
  const gatilho = documento?.flow?.nodes?.find((n) => n?.type === 'trigger.schedule')
  const agenda = gatilho?.config?.schedule
  if (!agenda || typeof agenda !== 'object') return null
  return { agenda, fuso: gatilho.config.timezone || 'America/Sao_Paulo' }
}

/** Primeiro disparo de uma agenda, a partir de `agora`. null = não calculável. */
function primeiro (agenda, fuso, agora) {
  try {
    if (agenda.tipo === 'unico') {
      return agenda.modo === 'relativo'
        ? new Date(agora.getTime() + agenda.ms)
        : instanteDe(agenda.local, fuso)
    }
    if (agenda.tipo === 'recorrente') return proximaOcorrencia(agenda.regra, agora, fuso, agora)
    return primeiroDisparo(agenda, { agora })
  } catch {
    return null
  }
}

/** Destinos de uma revisão: os grupos e contatos do `onde:`. */
function destinos (db, revisionId) {
  return db.prepare(`SELECT kind, ref_id FROM automation_scopes
    WHERE automation_revision_id = ? AND direction = 'include' AND kind IN ('group', 'contact') AND ref_id != ''`)
    .all(revisionId)
    .map((r) => ({ chatId: r.ref_id, chatKind: r.kind === 'group' ? 'group' : 'direct' }))
}

/**
 * Garante o primeiro disparo de cada revisão agendada ligada e cancela o que
 * ficou sem dono. Idempotente: chamar duas vezes seguidas não muda nada.
 */
export function reconciliar (db, agora = new Date()) {
  const iso = agora.toISOString()
  const vivas = db.prepare(`SELECT a.id AS automation_id, r.id AS revision_id, r.revision, r.doc_json
    FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id
    WHERE a.enabled = 1`).all()
  // `cancelado` não conta como semeado: desligar e religar uma automação a
  // retoma (o diário volta a disparar; o "daqui N" recomeça a contar).
  const existe = db.prepare("SELECT 1 FROM schedule_jobs WHERE automation_id = ? AND revision = ? AND chat_id = ? AND status != 'cancelado' LIMIT 1")
  // Mesma ocorrência cancelada antes (data absoluta, por exemplo): reabre a
  // linha em vez de esbarrar na chave única e ficar sem disparo para sempre.
  const inserir = db.prepare(`INSERT INTO schedule_jobs
    (automation_id, revision, chat_id, chat_kind, scheduled_for, anchor, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT (automation_id, revision, chat_id, scheduled_for)
    DO UPDATE SET status = 'pending', detail = NULL, anchor = excluded.anchor, updated_at = excluded.updated_at
    WHERE schedule_jobs.status = 'cancelado'`)
  let criados = 0
  db.transaction(() => {
    for (const viva of vivas) {
      const doc = jsonOuNull(viva.doc_json)
      const a = agendaDoDocumento(doc)
      if (!a) continue
      for (const d of destinos(db, viva.revision_id)) {
        // Qualquer linha viva da série (pendente, feita, perdida) prova que esta
        // revisão já foi semeada: não semeia de novo, senão "daqui 30 minutos"
        // recomeçaria a cada reinício e um disparo único voltaria a ocorrer.
        if (existe.get(viva.automation_id, viva.revision, d.chatId)) continue
        const quando = primeiro(a.agenda, a.fuso, agora)
        if (!quando) continue
        criados += inserir.run(viva.automation_id, viva.revision, d.chatId, d.chatKind, quando.toISOString(), iso, iso, iso).changes
      }
    }
  })()
  const cancelados = db.prepare(`UPDATE schedule_jobs SET status = 'cancelado', detail = 'automação desligada, despublicada ou editada', updated_at = ?
    WHERE status = 'pending' AND NOT EXISTS (
      SELECT 1 FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id
      WHERE a.id = schedule_jobs.automation_id AND a.enabled = 1 AND r.revision = schedule_jobs.revision)`).run(iso).changes
  return { criados, cancelados }
}

/**
 * A conta que vai falar. Vem do `responder` da automação (pool → membro ligado
 * de maior peso, desempate pelo id); sem pool, vale a única instância
 * registrada. Ambíguo ou vazio devolve null, e o disparo vira `ignorado` com o
 * motivo — escolher uma conta ao acaso mandaria a mensagem pelo número errado.
 */
export function contaDoDisparo (db, documento) {
  const poolId = documento?.responder?.poolId
  if (poolId) {
    const membro = db.prepare(`SELECT i.account_id FROM pool_members m JOIN instances i ON i.id = m.instance_id
      WHERE m.pool_id = ? AND m.enabled = 1 ORDER BY m.weight DESC, i.account_id LIMIT 1`).get(poolId)
    return membro?.account_id ?? null
  }
  const todas = db.prepare('SELECT account_id FROM instances LIMIT 2').all()
  return todas.length === 1 ? todas[0].account_id : null
}

/**
 * Toma o disparo para este worker E semeia a próxima ocorrência, numa
 * transação só: ou as duas coisas acontecem ou nenhuma, e a série recorrente
 * nunca fica sem próximo. O `WHERE status = 'pending'` é o que decide quem
 * leva a linha quando dois workers a viram pendente ao mesmo tempo; o que
 * perde recebe `false` e não faz nada. `job` pode ser uma leitura velha.
 */
export function reivindicar (db, job, agora, { tarde = false, atrasoMs = 0, toleranciaMs = TOLERANCIA_PADRAO_MS } = {}) {
  const iso = agora.toISOString()
  return db.transaction(() => {
    const r = db.prepare("UPDATE schedule_jobs SET status = ?, detail = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(tarde ? 'perdido' : 'claimed', tarde ? `perdido: venceu há ${Math.round(atrasoMs / 1000)}s (tolerância ${Math.round(toleranciaMs / 1000)}s)` : null, iso, job.id)
    if (r.changes !== 1) return false
    const viva = db.prepare(`SELECT r.doc_json FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id
      WHERE a.id = ? AND a.enabled = 1 AND r.revision = ?`).get(job.automation_id, job.revision)
    const a = viva && agendaDoDocumento(jsonOuNull(viva.doc_json))
    if (a?.agenda?.tipo === 'recorrente') {
      const proxima = proximaOcorrencia(a.agenda.regra, agora, a.fuso, new Date(job.anchor))
      if (proxima) {
        db.prepare(`INSERT OR IGNORE INTO schedule_jobs
          (automation_id, revision, chat_id, chat_kind, scheduled_for, anchor, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .run(job.automation_id, job.revision, job.chat_id, job.chat_kind, proxima.toISOString(), job.anchor, iso, iso)
      }
    }
    return true
  })()
}

/**
 * Uma passada: reconcilia, recupera órfãos e dispara o que venceu.
 * @param {object} [opcoes]
 * @param {number} [opcoes.toleranciaMs] atraso máximo aceito para ainda disparar
 * @param {number} [opcoes.lote] máximo de disparos por passada
 * @param {Function} [opcoes.avaliar] avaliador (injetável em teste)
 */
export function tick (db, agora = new Date(), { toleranciaMs = TOLERANCIA_PADRAO_MS, lote = LOTE_PADRAO, avaliar = avaliarEvento } = {}) {
  const iso = agora.toISOString()
  const resumo = { reconciliar: reconciliar(db, agora), disparados: 0, perdidos: 0, ignorados: 0, erros: 0, recuperados: 0 }

  // Órfão: reivindicado e nunca concluído. Se o evento já entrou no banco, o
  // avaliador chegou a rodar e só faltou marcar; senão volta para a fila.
  const limiteOrfao = new Date(agora.getTime() - ORFAO_APOS_MS).toISOString()
  for (const o of db.prepare("SELECT * FROM schedule_jobs WHERE status = 'claimed' AND updated_at < ?").all(limiteOrfao)) {
    const jaRodou = db.prepare('SELECT 1 FROM inbound_events WHERE id = ?').get(eventIdDoDisparo(o))
    db.prepare('UPDATE schedule_jobs SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
      .run(jaRodou ? 'done' : 'pending', iso, o.id, 'claimed')
    resumo.recuperados++
  }

  const vencidos = db.prepare("SELECT * FROM schedule_jobs WHERE status = 'pending' AND scheduled_for <= ? ORDER BY scheduled_for, id LIMIT ?").all(iso, lote)
  for (const job of vencidos) {
    const atrasoMs = agora.getTime() - Date.parse(job.scheduled_for)
    const tarde = atrasoMs > toleranciaMs

    const reivindicou = reivindicar(db, job, agora, { tarde, atrasoMs, toleranciaMs })
    if (!reivindicou) continue
    if (tarde) { resumo.perdidos++; continue }

    const marcar = (status, detail = null) => db.prepare('UPDATE schedule_jobs SET status = ?, detail = ?, fired_at = ?, updated_at = ? WHERE id = ?')
      .run(status, detail, iso, iso, job.id)
    try {
      const viva = db.prepare(`SELECT r.doc_json FROM automations a JOIN automation_revisions r ON r.id = a.active_revision_id
        WHERE a.id = ? AND a.enabled = 1 AND r.revision = ?`).get(job.automation_id, job.revision)
      if (!viva) { marcar('cancelado', 'automação desligada antes do disparo'); continue }
      const conta = contaDoDisparo(db, jsonOuNull(viva.doc_json))
      if (!conta) { marcar('ignorado', 'sem conta para falar: a automação não tem pool e não há exatamente uma instância'); resumo.ignorados++; continue }
      const resultado = avaliar(db, {
        eventId: eventIdDoDisparo(job),
        accountId: conta,
        chat: { id: job.chat_id, kind: job.chat_kind },
        sender: { id: REMETENTE_DO_RELOGIO },
        schedule: { id: `job-${job.id}`, automationId: job.automation_id, firedAt: iso, scheduledFor: job.scheduled_for }
      }, { interno: true })
      if (resultado.results.length === 0) { marcar('ignorado', 'portão fechado (grupo não ativo, atendimento humano ou fora do escopo)'); resumo.ignorados++ } else { marcar('done'); resumo.disparados++ }
    } catch (erro) {
      marcar('erro', String(erro?.message ?? erro).slice(0, 300))
      resumo.erros++
    }
  }
  return resumo
}

/** Liga o relógio. O intervalo não impede o processo de encerrar. */
export function iniciarAgendador (db, { intervaloMs = INTERVALO_PADRAO_MS, ...opcoes } = {}) {
  const passada = () => {
    try {
      const r = tick(db, new Date(), opcoes)
      if (r.disparados || r.perdidos || r.erros) {
        console.log(`[engine] agendador: ${r.disparados} disparo(s), ${r.perdidos} perdido(s), ${r.erros} erro(s)`)
      }
      return r
    } catch (erro) {
      // Relógio quebrado não derruba o motor: o pior é não disparar, e o
      // próximo tick tenta de novo.
      console.warn(`[engine] o agendador falhou: ${erro.message}`)
      return null
    }
  }
  const primeira = passada()
  const relogio = setInterval(passada, intervaloMs)
  relogio.unref?.()
  return { primeira, parar: () => clearInterval(relogio) }
}
