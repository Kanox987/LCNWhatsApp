// A janela de retenção: o que ela apaga, o que ela se recusa a apagar, e o que
// a tela mostra. O pedido do dono foi "msg com mais de 72h vai de F"; o risco
// de errar aqui é apagar o que uma cadeia de chamadas ainda precisa.
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'
import {
  CHAVE_RETENCAO, HORAS_PADRAO, compactar, contar, gravarRetencao,
  iniciarVarredura, lerRetencao, varrer
} from '../src/engine/server/retencao.js'
import { ID_GLOBAL } from '../src/engine/server/attributeScopes.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

const AGORA = Date.parse('2026-10-15T12:00:00.000Z')
const horasAtras = (h) => new Date(AGORA - h * 3600 * 1000).toISOString()

function bancoComHistorico () {
  const db = abrirBanco(':memory:')
  db.prepare(`INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at)
    VALUES ('aut', 1, 1, 'live', ?, ?)`).run(horasAtras(200), horasAtras(200))
  const revisao = Number(db.prepare(`INSERT INTO automation_revisions
    (automation_id, revision, status, doc_json, created_at) VALUES ('aut', 1, 'active', '{}', ?)`)
    .run(horasAtras(200)).lastInsertRowid)

  // Cada registro nasce com a IDADE que o nome diz: é a idade que decide.
  const inserir = (nome, idadeHoras, { statusDoComando = 'sent', comComando = true } = {}) => {
    const quando = horasAtras(idadeHoras)
    db.prepare(`INSERT INTO inbound_events
      (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at)
      VALUES (?, 'conta', 'chat', 'direct', 'alguem', 'text', ?, 0, '{}', ?)`).run(nome, nome, quando)
    const runId = Number(db.prepare(`INSERT INTO automation_runs
      (event_id, automation_id, automation_revision_id, deployment_mode, status, detail_json, created_at)
      VALUES (?, 'aut', ?, 'live', 'matched_live', NULL, ?)`).run(nome, revisao, quando).lastInsertRowid)
    if (comComando) {
      db.prepare(`INSERT INTO outbound_commands
        (id, run_id, target_account_id, command_type, payload_json, status, created_at, resolved_at)
        VALUES (?, ?, 'conta', 'whatsapp.reply', '{}', ?, ?, ?)`)
        .run(`cmd-${nome}`, runId, statusDoComando, quando, statusDoComando === 'pending' ? null : quando)
    }
    return runId
  }

  inserir('velho', 100)
  inserir('velho-sem-comando', 100, { comComando: false })
  inserir('velho-dormindo', 100, { statusDoComando: 'pending' })
  inserir('novo', 10)
  return { db, inserir }
}

// --- o padrão, e a configuração vinda do painel ---
{
  const db = abrirBanco(':memory:')
  check('sem configuração, a janela é o padrão de 72h', lerRetencao(db).horas === HORAS_PADRAO && lerRetencao(db).padrao === true)
  check('gravar 720 passa a valer', gravarRetencao(db, { horas: 720 }).horas === 720 && lerRetencao(db).horas === 720)
  check('gravar 0 é "guardar para sempre"', gravarRetencao(db, { horas: 0 }).horas === 0)

  let recusou = false
  try { gravarRetencao(db, { horas: -1 }) } catch { recusou = true }
  check('janela negativa é recusada', recusou)
  recusou = false
  try { gravarRetencao(db, { horas: 'muito tempo' }) } catch { recusou = true }
  check('janela que não é número é recusada', recusou)

  // Valor adulterado no banco não vira varredura com janela inventada.
  db.prepare('UPDATE entity_attributes SET value_json = ? WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .run('{nao e json', 'global', ID_GLOBAL, CHAVE_RETENCAO)
  check('valor ilegível volta ao padrão', lerRetencao(db).horas === HORAS_PADRAO)
  db.close()
}

// --- o que a varredura apaga ---
{
  const { db } = bancoComHistorico()
  const antes = contar(db, { agora: AGORA })
  check('a contagem mostra o total guardado', antes.total.execucoes === 4 && antes.total.eventos === 4)
  // Três execuções velhas, mas só um comando velho JÁ RESOLVIDO: o pendente
  // não conta porque não é candidato a sair.
  check('a contagem separa o que está fora da janela', antes.vencidos.execucoes === 3 && antes.vencidos.comandos === 1)

  const feito = varrer(db, { agora: AGORA })
  check('a varredura usa a janela de 72h por padrão', feito.horas === 72)
  check('apagou o comando resolvido e velho', feito.comandos === 1)
  check('apagou as duas execuções que sobraram sem comando', feito.execucoes === 2)
  check('apagou os dois eventos que sobraram sem execução', feito.eventos === 2)

  const sobrou = (tabela, campo, id) => db.prepare(`SELECT 1 FROM ${tabela} WHERE ${campo} = ?`).get(id)
  check('o evento novo fica', !!sobrou('inbound_events', 'id', 'novo'))
  check('o evento velho sai', !sobrou('inbound_events', 'id', 'velho'))
  check('o evento velho sem comando sai', !sobrou('inbound_events', 'id', 'velho-sem-comando'))

  // O CASO QUE IMPORTA: comando pendente é cadeia dormindo. Apagá-lo — ou
  // apagar o evento de onde a retomada relê a mensagem — fura o fluxo.
  check('o comando pendente fica, mesmo velho', !!sobrou('outbound_commands', 'id', 'cmd-velho-dormindo'))
  check('a execução do comando pendente fica', !!sobrou('automation_runs', 'event_id', 'velho-dormindo'))
  check('o evento do comando pendente fica', !!sobrou('inbound_events', 'id', 'velho-dormindo'))
  db.close()
}

// --- janela 0: não apaga nada ---
{
  const { db } = bancoComHistorico()
  gravarRetencao(db, { horas: 0 })
  const feito = varrer(db, { agora: AGORA })
  check('janela 0 não apaga nada', feito.eventos === 0 && feito.execucoes === 0 && feito.comandos === 0)
  check('janela 0 não conta vencidos', contar(db, { agora: AGORA }).vencidos.execucoes === 0)
  check('com janela 0 tudo continua no banco', db.prepare('SELECT COUNT(*) n FROM inbound_events').get().n === 4)
  db.close()
}

// --- janela pedida na chamada ganha da gravada ---
{
  const { db } = bancoComHistorico()
  const feito = varrer(db, { agora: AGORA, horas: 5 })
  check('janela de 5h apaga também o registro de 10h', feito.eventos === 3)
  db.close()
}

// --- a varredura periódica ---
{
  const { db } = bancoComHistorico()
  const relogio = iniciarVarredura(db, { intervaloMs: 60000 })
  check('a varredura roda na subida', relogio.primeira && relogio.primeira.horas === 72)
  relogio.parar()
  db.close()
}

// --- devolver o disco ---
{
  const { db } = bancoComHistorico()
  varrer(db, { agora: AGORA })
  const disco = compactar(db)
  check('compactar responde o tamanho antes e depois', disco.antes > 0 && disco.depois > 0 && disco.liberado >= 0)
  db.close()
}

// --- devolver o disco de um banco EM ARQUIVO, com diário ------------------
//
// O caso que a primeira limpeza de verdade revelou: o banco encolheu e a pasta
// não, porque o diário (WAL) de 266 MB ficou lá. Em banco de memória isso não
// aparece — por isso este caso usa arquivo.
{
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-retencao-'))
  const arquivo = path.join(pasta, 'engine.sqlite')
  const db = abrirBanco(arquivo)
  db.prepare(`INSERT INTO automations (id, schema_version, enabled, deployment_mode, created_at, updated_at)
    VALUES ('aut', 1, 1, 'live', ?, ?)`).run(horasAtras(200), horasAtras(200))
  const revisao = Number(db.prepare(`INSERT INTO automation_revisions
    (automation_id, revision, status, doc_json, created_at) VALUES ('aut', 1, 'active', '{}', ?)`)
    .run(horasAtras(200)).lastInsertRowid)
  const grande = 'x'.repeat(2000)
  for (let i = 0; i < 400; i++) {
    db.prepare(`INSERT INTO inbound_events
      (id, account_id, chat_id, chat_kind, sender_id, message_kind, message_text, replay, raw_json, received_at)
      VALUES (?, 'conta', 'chat', 'direct', 'alguem', 'text', ?, 0, ?, ?)`)
      .run(`e${i}`, grande, JSON.stringify({ lixo: grande }), horasAtras(100))
    db.prepare(`INSERT INTO automation_runs
      (event_id, automation_id, automation_revision_id, deployment_mode, status, detail_json, created_at)
      VALUES (?, 'aut', ?, 'live', 'no_match', ?, ?)`).run(`e${i}`, revisao, JSON.stringify({ lixo: grande }), horasAtras(100))
  }
  varrer(db, { agora: AGORA })
  const disco = compactar(db)
  const noDisco = fs.statSync(arquivo).size + (fs.existsSync(`${arquivo}-wal`) ? fs.statSync(`${arquivo}-wal`).size : 0)
  check('compactar conta o banco MAIS o diário', disco.depois === noDisco, `${disco.depois} vs ${noDisco}`)
  check('e devolve espaço de verdade', disco.liberado > 0, String(disco.liberado))
  // O diário é o que sobrava: sem o truncamento, ele ficava com o tamanho de
  // tudo o que foi apagado.
  const wal = fs.existsSync(`${arquivo}-wal`) ? fs.statSync(`${arquivo}-wal`).size : 0
  check('o diário é devolvido ao sistema, não só reaproveitado', wal < 100 * 1024, `${wal} bytes`)
  db.close()
  fs.rmSync(pasta, { recursive: true, force: true })
}

// --- as rotas do motor ---
{
  const { db } = bancoComHistorico()
  const api = criarApi(db)
  const contexto = (body = null) => ({ body, query: new URLSearchParams(''), req: { headers: {} } })

  const estado = await api.resolver('GET', '/retencao', contexto())
  check('GET /retencao traz a janela e o tamanho do histórico', estado.horas === 72 && estado.total.execucoes === 4)

  const salvo = await api.resolver('PUT', '/retencao', contexto({ horas: 24 }))
  check('PUT /retencao grava a janela', salvo.horas === 24 && salvo.padrao === false)

  let status = null
  try { await api.resolver('PUT', '/retencao', contexto({ horas: -3 })) } catch (erro) { status = erro.status }
  check('PUT /retencao recusa janela inválida com 400', status === 400)

  const varrido = await api.resolver('POST', '/retencao/varrer', contexto({}))
  check('POST /retencao/varrer apaga com a janela gravada', varrido.apagado.execucoes === 2)
  check('POST /retencao/varrer não compacta sem pedir', varrido.disco === undefined)

  const comDisco = await api.resolver('POST', '/retencao/varrer', contexto({ compactar: true }))
  check('POST /retencao/varrer compacta quando pedido', !!comDisco.disco)
  db.close()
}

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`)
  process.exit(1)
}
console.log('\nretenção: tudo certo')
