// Listas nomeadas de pessoas ("autorizados", "vip"): quem está numa lista pode
// ser consultado por uma condição e, depois, usado como escopo.
//
// Guardadas como os donos (`owners.js`): uma linha de entity_attributes no
// escopo 'contact', chave reservada `__lista__<nome>`, valor true. Sem tabela
// nova, e o prefixo `__` já barra `action.variable.*` e a rota genérica de
// atributos — só este módulo escreve.
//
// Três regras que não se negociam:
//  - lista vazia, ou que nunca existiu, não tem ninguém (nunca vira "todos");
//  - quem não foi identificado (jid ausente) NÃO é membro;
//  - o nome é validado aqui, porque ele vira parte de uma chave.
export const PREFIXO_LISTA = '__lista__'

// Sem hífen e começando por letra: o nome também é um pedaço de caminho,
// `sender.lists.autorizados`, e o campo de evento do schema só aceita identificador.
const NOME_VALIDO = /^[a-z][a-z0-9_]{0,31}$/

// "Autorizados " e "autorizados" são a mesma lista; acento vira letra simples e
// espaço ou hífen viram "_", para o dono não errar por digitação.
export function normalizarNomeDeLista (nome) {
  if (typeof nome !== 'string') return null
  const limpo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/[\s-]+/g, '_')
  return NOME_VALIDO.test(limpo) ? limpo : null
}

export const chaveDaLista = (nome) => {
  const normal = normalizarNomeDeLista(nome)
  return normal ? `${PREFIXO_LISTA}${normal}` : null
}

const idValido = (id) => typeof id === 'string' && id.length > 0

export function estaNaLista (db, nome, pessoaId) {
  const chave = chaveDaLista(nome)
  if (!chave || !idValido(pessoaId)) return false
  const linha = db.prepare("SELECT value_json FROM entity_attributes WHERE scope_kind = 'contact' AND scope_id = ? AND key = ?")
    .get(pessoaId, chave)
  if (!linha) return false
  try { return JSON.parse(linha.value_json) === true } catch { return false }
}

// { ok:false, motivo } quando o nome ou a pessoa não servem; o chamador decide
// se isso é erro de fluxo ou "ignora".
export function adicionarNaLista (db, nome, pessoaId) {
  const chave = chaveDaLista(nome)
  if (!chave) return { ok: false, motivo: 'nome' }
  if (!idValido(pessoaId)) return { ok: false, motivo: 'pessoa' }
  const jaEstava = estaNaLista(db, nome, pessoaId)
  db.prepare(`INSERT INTO entity_attributes (scope_kind, scope_id, key, value_json, updated_at)
    VALUES ('contact', ?, ?, 'true', ?)
    ON CONFLICT(scope_kind, scope_id, key) DO UPDATE SET value_json = 'true', updated_at = excluded.updated_at`)
    .run(pessoaId, chave, new Date().toISOString())
  return { ok: true, mudou: !jaEstava }
}

export function removerDaLista (db, nome, pessoaId) {
  const chave = chaveDaLista(nome)
  if (!chave) return { ok: false, motivo: 'nome' }
  if (!idValido(pessoaId)) return { ok: false, motivo: 'pessoa' }
  const r = db.prepare("DELETE FROM entity_attributes WHERE scope_kind = 'contact' AND scope_id = ? AND key = ?")
    .run(pessoaId, chave)
  return { ok: true, mudou: r.changes > 0 }
}

export function membrosDaLista (db, nome) {
  const chave = chaveDaLista(nome)
  if (!chave) return []
  return db.prepare("SELECT scope_id FROM entity_attributes WHERE scope_kind = 'contact' AND key = ? ORDER BY updated_at, scope_id")
    .all(chave)
    .map((linha) => linha.scope_id)
    .filter((id) => estaNaLista(db, nome, id))
}

// Esvazia a lista inteira. Uma lista vazia não libera ninguém, então "limpar" é
// o jeito seguro de fechar o acesso de todos de uma vez.
export function limparLista (db, nome) {
  const chave = chaveDaLista(nome)
  if (!chave) return { ok: false, motivo: 'nome' }
  const r = db.prepare("DELETE FROM entity_attributes WHERE scope_kind = 'contact' AND key = ?").run(chave)
  return { ok: true, removidos: r.changes }
}

// Listas que têm pelo menos uma pessoa, com a contagem.
export function listasExistentes (db) {
  return db.prepare(`SELECT key, COUNT(*) AS n FROM entity_attributes
    WHERE scope_kind = 'contact' AND key LIKE ? ESCAPE '\\' AND value_json = 'true'
    GROUP BY key ORDER BY key`)
    .all(`${PREFIXO_LISTA.replace(/_/g, '\\_')}%`)
    .map((linha) => ({ nome: linha.key.slice(PREFIXO_LISTA.length), membros: linha.n }))
}

// As listas em que a pessoa está, como mapa `{ autorizados: true }`: é o que o
// evento expõe em `sender.lists` e `target.lists`, para a condição comum
// `evento sender.lists.autorizados == true` funcionar sem sintaxe nova.
// Uma consulta indexada por (scope_kind, scope_id); quem não está em lista
// nenhuma recebe um mapa vazio, e lista ausente é "não é membro".
export function listasDa (db, pessoaId) {
  const mapa = {}
  if (!db || !idValido(pessoaId)) return mapa
  const linhas = db.prepare("SELECT key, value_json FROM entity_attributes WHERE scope_kind = 'contact' AND scope_id = ? AND key LIKE ? ESCAPE '\\'")
    .all(pessoaId, `${PREFIXO_LISTA.replace(/_/g, '\\_')}%`)
  for (const linha of linhas) {
    try { if (JSON.parse(linha.value_json) === true) mapa[linha.key.slice(PREFIXO_LISTA.length)] = true } catch {}
  }
  return mapa
}
