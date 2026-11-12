// Quem usou o quê, e quando: o que deixa escrever limite de uso na linguagem.
//
// Três ações leem e escrevem aqui, todas no motor (sem comando de gateway):
//   anota uso   grava uma linha (regra, pessoa, conversa, agora)
//   conta usos  conta as linhas da regra dentro de uma janela e põe o número
//               numa variável local; o `se` comum decide o que fazer
//   limpa usos  apaga as linhas da regra (de uma pessoa ou de todos)
//
// Limite de uso vira, então, três linhas que a pessoa lê:
//
//   conta usos / regra: downloads / janela: 10 minutos / em: qtd
//   se evento local.qtd >= 3  → responde "Calma, espera um pouco."
//   senão                     → anota uso, e segue para o download
//
// Contar e anotar são duas ações e não uma "checa e anota" atômica de
// propósito: o fluxo pode querer anotar só depois de o comando dar certo. E não
// há corrida entre as duas: o avaliador roda síncrono num processo só
// (better-sqlite3), então nenhuma outra mensagem é avaliada no meio.
import { ID_GLOBAL } from './attributeScopes.js'
import { validarHoras } from './retencao.js'

export const CHAVE_RETENCAO_USOS = '__retencao_usos__'

// Sete dias porque é o maior limite comum ("5 por semana"): com menos, a
// varredura apagaria usos que a janela ainda conta e o limite afrouxaria sem
// ninguém ver. Padrão, não teto: quem conta por mês escreve 744, e 0 guarda
// para sempre.
export const HORAS_PADRAO_USOS = 168

// O mesmo formato de nome das listas: vira parte de uma consulta e de uma tela,
// e "Downloads " e "downloads" têm que ser a mesma regra.
const NOME_VALIDO = /^[a-z][a-z0-9_]{0,31}$/

export function normalizarRegra (nome) {
  if (typeof nome !== 'string') return null
  const limpo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/[\s-]+/g, '_')
  return NOME_VALIDO.test(limpo) ? limpo : null
}

const UNIDADES = {
  segundo: 1, segundos: 1, s: 1,
  minuto: 60, minutos: 60, min: 60, m: 60,
  hora: 3600, horas: 3600, h: 3600,
  dia: 86400, dias: 86400, d: 86400,
  semana: 604800, semanas: 604800
}

// "10 minutos" → 600 (segundos). `null` quando não dá para ler: quem chama
// decide se isso é erro de fluxo. Sem teto: "30 dias" vale, desde que a
// retenção dos usos guarde o bastante (ver HORAS_PADRAO_USOS).
export function lerJanela (texto) {
  const m = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().match(/^(\d+)\s*([a-z]+)$/)
  if (!m) return null
  const fator = UNIDADES[m[2]]
  const n = Number(m[1])
  if (!fator || !Number.isSafeInteger(n) || n <= 0) return null
  return n * fator
}

const iso = (ms) => new Date(ms).toISOString()

export function anotarUso (db, { regra, pessoa, chat = null, agora = Date.now() }) {
  const nome = normalizarRegra(regra)
  if (!nome) return { ok: false, motivo: 'regra' }
  if (typeof pessoa !== 'string' || !pessoa) return { ok: false, motivo: 'pessoa' }
  db.prepare('INSERT INTO usage_records (rule, person_id, chat_id, created_at) VALUES (?, ?, ?, ?)')
    .run(nome, pessoa, chat || null, iso(agora))
  return { ok: true }
}

// `pessoa` e `chat` nulos significam "de todos" e "em qualquer conversa".
export function contarUsos (db, { regra, segundos, pessoa = null, chat = null, agora = Date.now() }) {
  const nome = normalizarRegra(regra)
  if (!nome) return { ok: false, motivo: 'regra' }
  if (!Number.isFinite(segundos) || segundos <= 0) return { ok: false, motivo: 'janela' }
  const filtros = ['rule = ?', 'created_at >= ?']
  const valores = [nome, iso(agora - segundos * 1000)]
  if (pessoa !== null) { filtros.push('person_id = ?'); valores.push(pessoa) }
  if (chat !== null) { filtros.push('chat_id = ?'); valores.push(chat) }
  const { n } = db.prepare(`SELECT COUNT(*) n FROM usage_records WHERE ${filtros.join(' AND ')}`).get(...valores)
  return { ok: true, total: n }
}

export function limparUsos (db, { regra, pessoa = null }) {
  const nome = normalizarRegra(regra)
  if (!nome) return { ok: false, motivo: 'regra' }
  const apagados = pessoa === null
    ? db.prepare('DELETE FROM usage_records WHERE rule = ?').run(nome).changes
    : db.prepare('DELETE FROM usage_records WHERE rule = ? AND person_id = ?').run(nome, pessoa).changes
  return { ok: true, apagados }
}

export function lerRetencaoDeUsos (db) {
  const linha = db.prepare('SELECT value_json FROM entity_attributes WHERE scope_kind = ? AND scope_id = ? AND key = ?')
    .get('global', ID_GLOBAL, CHAVE_RETENCAO_USOS)
  let horas = NaN
  try { horas = Number(JSON.parse(linha?.value_json ?? 'null')?.horas) } catch {}
  if (!Number.isFinite(horas) || horas < 0) return { horas: HORAS_PADRAO_USOS, padrao: true }
  return { horas: Math.round(horas), padrao: false }
}

export function gravarRetencaoDeUsos (db, { horas }) {
  const limpo = { horas: validarHoras(horas) }
  db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET
      value_json = excluded.value_json, updated_at = excluded.updated_at`)
    .run('global', ID_GLOBAL, CHAVE_RETENCAO_USOS, JSON.stringify(limpo), new Date().toISOString())
  return { horas: limpo.horas, padrao: false }
}

export function varrerUsos (db, { agora = Date.now(), horas = null } = {}) {
  const janela = horas === null ? lerRetencaoDeUsos(db).horas : validarHoras(horas)
  if (!janela) return { horas: 0, usos: 0 }
  const usos = db.prepare('DELETE FROM usage_records WHERE created_at < ?')
    .run(iso(agora - janela * 3600 * 1000)).changes
  return { horas: janela, usos }
}
