// Comandos que ficaram sem resposta quando o gateway caiu no meio.
//
// Existe por causa de um caso real: um deploy reiniciou o container enquanto
// dois downloads rodavam. Os comandos ficaram `pending` para sempre, e como o
// download manda "⏳ Baixando…" ANTES de baixar, quem pediu ficou esperando
// uma mídia que nunca veio — sem nada dizendo que falhou. Quatro vezes.
import { fecharOrfaos } from '../src/engine/orfaos.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

function cenario (pendentes, { falharAoListar = false } = {}) {
  const enviadas = []
  const confirmados = []
  const client = { message: { send: async (chatId, conteudo) => { enviadas.push({ chatId, conteudo }); return { id: 'X' } } } }
  const clienteEngine = {
    execucoes: {
      pendentes: async () => { if (falharAoListar) throw new Error('motor fora'); return pendentes },
      confirmar: async (id, body) => { confirmados.push({ id, body }) }
    }
  }
  return { client, clienteEngine, enviadas, confirmados }
}

const download = (extra = {}) => ({
  id: 'cmd-1',
  commandType: 'media.download',
  status: 'pending',
  payload: { chatId: '5511@s.whatsapp.net', url: 'https://x.com/a', ackText: '⏳ Baixando…', ...extra }
})

// --- o caso que motivou tudo ---------------------------------------------
{
  const c = cenario([download()])
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('quem prometeu "baixando" é avisado de que não vai vir', c.enviadas.length === 1,
    JSON.stringify(c.enviadas))
  check('o aviso vai para a conversa certa', c.enviadas[0]?.chatId === '5511@s.whatsapp.net')
  check('e o comando é fechado', c.confirmados.length === 1)
  // Invariante 3: ambíguo nunca vira falha. O download PODE ter terminado
  // antes da queda, e registrar falha faria alguém refazer à mão o que já foi.
  check('fechado como "não sei", nunca como falha',
    c.confirmados[0]?.body?.status === 'outcome_unknown', JSON.stringify(c.confirmados[0]))
  check('o resultado conta o que fez', r.fechados === 1 && r.avisados === 1, JSON.stringify(r))
}

// --- texto de erro próprio da automação ganha do padrão ------------------
{
  const c = cenario([download({ errorText: 'Deu ruim: {{erro}}' })])
  await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  const texto = c.enviadas[0]?.conteudo?.text || ''
  check('usa o texto de erro configurado na automação', texto.startsWith('Deu ruim:'), texto)
  check('e o {{erro}} é preenchido, nunca deixado cru', !texto.includes('{{erro}}'), texto)
}

// --- quem não prometeu nada não recebe aviso do nada ---------------------
// Uma resposta que nunca saiu não deixou ninguém esperando: um aviso solto,
// minutos depois, confunde mais do que ajuda.
{
  const c = cenario([{ id: 'c2', commandType: 'whatsapp.reply', status: 'pending', payload: { chatId: '55@s.whatsapp.net', text: 'oi' } }])
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('resposta comum interrompida não gera aviso', c.enviadas.length === 0)
  check('mas é fechada mesmo assim, para não ficar invisível', r.fechados === 1)
}

// --- download sem promessa também não avisa ------------------------------
{
  const c = cenario([download({ ackText: undefined })])
  await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('download que não avisou o início também não avisa o fim', c.enviadas.length === 0)
}

// --- queda antiga: fecha, mas não ressuscita a conversa ------------------
{
  const antigo = { ...download(), createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString() }
  const c = cenario([antigo])
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('comando de dois dias atrás não vira mensagem nova', c.enviadas.length === 0)
  check('mas sai de "pending"', r.fechados === 1)
}

// --- falhar em avisar não pode impedir de fechar -------------------------
{
  const c = cenario([download()])
  c.client.message.send = async () => { throw new Error('sem sessão') }
  const r = await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} })
  check('aviso falhando, o comando ainda é fechado', r.fechados === 1 && r.avisados === 0, JSON.stringify(r))
}

// --- motor fora do ar não impede o gateway de subir ----------------------
{
  const c = cenario([], { falharAoListar: true })
  let estourou = false
  try { await fecharOrfaos(c.client, c.clienteEngine, 'conta', { log: () => {} }) } catch { estourou = true }
  check('motor inalcançável não derruba a conexão', estourou === false)
}

// --- sem conta, não faz nada ---------------------------------------------
{
  const c = cenario([download()])
  const r = await fecharOrfaos(c.client, c.clienteEngine, null, { log: () => {} })
  check('sem accountId não sai mensagem nem confirmação', r.fechados === 0 && c.enviadas.length === 0)
}

// --- órfão de conta APOSENTADA ------------------------------------------
// O gateway fecha os órfãos dele por accountId. Mas reparear um número gera um
// accountId NOVO, e os comandos da conta anterior ficam sem ninguém para
// reivindicá-los — presos em `pending` para sempre. Aconteceu de verdade na
// migração para a VPS: três comandos de uma conta que não existe mais.
{
  const { abrirBanco } = await import('../src/engine/server/db.js')
  const { fecharPendentesAntigos } = await import('../src/engine/server/evaluator.js')
  const db = abrirBanco(':memory:')
  const agora = Date.now()
  // O comando aponta para a execução que o gerou, que aponta para o evento e a
  // revisão. Montar essa corrente é o preço de testar contra o banco de
  // verdade, e é o que faz o caso valer: um UPDATE só passa aqui se a tabela
  // for mesmo a que o motor usa.
  const iso = new Date().toISOString()
  db.prepare(`INSERT INTO inbound_events (id, account_id, chat_id, chat_kind, sender_id, message_kind, replay, raw_json, received_at)
    VALUES ('e1','conta','c1','direct','s1','text',0,'{}',?)`).run(iso)
  db.prepare(`INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at)
    VALUES ('a1', 1, 1, 'live', ?, ?)`).run(iso, iso)
  const rev = db.prepare(`INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at)
    VALUES ('a1', 1, 'active', '{}', ?)`).run(iso)
  const run = db.prepare(`INSERT INTO automation_runs
    (event_id, automation_id, automation_revision_id, deployment_mode, status, created_at)
    VALUES ('e1', 'a1', ?, 'live', 'matched_live', ?)`).run(rev.lastInsertRowid, iso)
  const inserir = db.prepare(`INSERT INTO outbound_commands
    (id, run_id, target_account_id, command_type, payload_json, status, created_at)
    VALUES (?, ${run.lastInsertRowid}, ?, ?, ?, 'pending', ?)`)

  const emIso = (ms) => new Date(ms).toISOString()
  inserir.run('velho', 'conta-morta', 'whatsapp.reply', '{}', emIso(agora - 48 * 3600 * 1000))
  inserir.run('recente', 'conta-viva', 'whatsapp.reply', '{}', emIso(agora - 60 * 1000))

  const fechados = fecharPendentesAntigos(db, { agora })
  check('comando antigo de conta aposentada é fechado', fechados === 1, String(fechados))

  const lido = (id) => db.prepare('SELECT status, resolved_at FROM outbound_commands WHERE id = ?').get(id)
  check('fechado como "não sei", nunca como falha', lido('velho').status === 'outcome_unknown')
  check('e ganha o horário em que foi fechado', Boolean(lido('velho').resolved_at))

  // O corte é largo de propósito: um comando de um minuto atrás PODE estar em
  // execução num gateway vivo, e fechá-lo seria o motor contradizendo quem
  // está executando.
  check('comando recente NÃO é tocado', lido('recente').status === 'pending')
}

// --- queda grande: mais pendentes do que cabe numa consulta -----------------
{
  const todos = Array.from({ length: 130 }, (_, i) => ({ id: `p${i}`, commandType: 'whatsapp.reply', status: 'pending', payload: {} }))
  const fechados = new Set()
  let consultas = 0
  const clienteEngine = {
    execucoes: {
      pendentes: async (_conta, limite) => { consultas++; return todos.filter((c) => !fechados.has(c.id)).slice(0, limite) },
      confirmar: async (id) => { fechados.add(id) }
    }
  }
  const r = await fecharOrfaos({ message: { send: async () => ({}) } }, clienteEngine, 'conta', { log: () => {} })
  check('130 pendentes: todos são fechados, não só o primeiro lote', fechados.size === 130 && r.fechados === 130, `fechados=${fechados.size}`)
  check('e a limpeza se diz completa', r.completo === true)
  check('em poucas consultas', consultas <= 4, `consultas=${consultas}`)
}
{
  let consultas = 0
  const clienteEngine = {
    execucoes: {
      pendentes: async () => { consultas++; return [{ id: 'teimoso', commandType: 'whatsapp.reply', status: 'pending', payload: {} }] },
      confirmar: async () => { throw new Error('motor recusou') }
    }
  }
  const r = await fecharOrfaos({ message: { send: async () => ({}) } }, clienteEngine, 'conta', { log: () => {} })
  check('motor que recusa fechar não faz a limpeza girar para sempre', consultas === 1 && r.fechados === 0 && r.completo === false, `consultas=${consultas}`)
}

// --- o que nasceu depois do boot do processo não é órfão ---------------------
// Contra o motor de verdade: os pendentes NOVOS vêm primeiro (rowid DESC) e,
// sendo mais que o lote, esconderiam os órfãos se o corte fosse feito depois do
// LIMIT. O corte tem que acontecer no SQL.
{
  const { abrirBanco } = await import('../src/engine/server/db.js')
  const { criarApi } = await import('../src/engine/server/api.js')
  const db = abrirBanco(':memory:')
  const api = criarApi(db)
  const boot = Date.parse('2026-11-06T10:00:00Z')
  db.prepare(`INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at) VALUES ('a', 1, 1, 'live', 'x', 'x')`).run()
  const revisao = Number(db.prepare(`INSERT INTO automation_revisions (automation_id, revision, status, doc_json, created_at) VALUES ('a', 1, 'active', '{}', 'x')`).run().lastInsertRowid)
  db.prepare(`INSERT INTO inbound_events (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at) VALUES ('e', 'conta', 'c', 'direct', 's', 'text', 't', 0, '{}', 'x')`).run()
  const run = Number(db.prepare(`INSERT INTO automation_runs (event_id, automation_id, automation_revision_id, deployment_mode, status, created_at) VALUES ('e', 'a', ?, 'live', 'ok', 'x')`).run(revisao).lastInsertRowid)
  const inserir = db.prepare(`INSERT INTO outbound_commands (id, run_id, target_account_id, command_type, payload_json, status, created_at) VALUES (?, ?, 'conta', 'whatsapp.reply', '{}', 'pending', ?)`)
  for (let i = 0; i < 30; i++) inserir.run(`velho-${i}`, run, new Date(boot - 60_000 + i).toISOString())
  for (let i = 0; i < 80; i++) inserir.run(`novo-${i}`, run, new Date(boot + 5_000 + i).toISOString())

  const confirmados = []
  const clienteEngine = {
    execucoes: {
      pendentes: async (conta, limite, antesDe) => api.resolver('GET', '/commands/pending', {
        body: null, req: { headers: {} },
        query: new URLSearchParams({ accountId: conta, limit: String(limite), ...(antesDe != null ? { antesDe: new Date(antesDe).toISOString() } : {}) })
      }),
      confirmar: async (id) => {
        confirmados.push(id)
        db.prepare(`UPDATE outbound_commands SET status = 'outcome_unknown' WHERE id = ?`).run(id)
      }
    }
  }
  const r = await fecharOrfaos({ message: { send: async () => ({}) } }, clienteEngine, 'conta', { log: () => {}, antesDe: boot, avisar: false, agora: boot + 10_000 })
  check('fecha os 30 órfãos mesmo com 80 pendentes novos na frente', r.fechados === 30 && confirmados.every((id) => id.startsWith('velho-')), JSON.stringify({ fechados: r.fechados, completo: r.completo }))
  check('não encosta nos pendentes do processo atual', db.prepare(`SELECT COUNT(*) n FROM outbound_commands WHERE status = 'pending'`).get().n === 80)
  check('e termina como completo', r.completo === true)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE COMANDO ÓRFÃO PASSARAM')
process.exit(falhas ? 1 : 0)
