import { createHash } from 'node:crypto'

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

// --- importar e exportar ---------------------------------------------------
//
// Uma lista inteira como arquivo. Pôr gente numa lista é dar permissão, então a
// importação trata o arquivo como DADO e é tudo-ou-nada: qualquer entrada que
// não seja uma pessoa de verdade recusa o arquivo inteiro, antes de gravar.
// O nome da lista vem de quem pede (URL ou tela), nunca de dentro do arquivo —
// um arquivo exportado de "vip" não pode, por engano, sobrescrever "autorizados".
export const FORMATO_DE_LISTA = 'lcn-lista'
export const VERSAO_DE_LISTA = 1
const LIMITE_DE_IMPORTACAO_PADRAO = 5000
const JID_DE_PESSOA = /^\d{5,20}@s\.whatsapp\.net$/
const SO_DIGITOS = /^\d{5,20}$/

// Padrão, não teto do sistema: quem precisa de lista maior ajusta o ambiente.
export function limiteDeImportacao () {
  const n = Number(process.env.LCN_LISTA_IMPORT_MAX)
  return Number.isInteger(n) && n > 0 ? n : LIMITE_DE_IMPORTACAO_PADRAO
}

export function exportarLista (db, nome) {
  const normal = normalizarNomeDeLista(nome)
  if (!normal) return null
  return { formato: FORMATO_DE_LISTA, versao: VERSAO_DE_LISTA, nome: normal, membros: membrosDaLista(db, normal) }
}

// Uma impressão digital do que está na lista agora: a prévia a devolve e o
// "substituir" a exige de volta. Se alguém entrou ou saiu entre uma coisa e
// outra, o número muda e a substituição é recusada em vez de apagar às cegas.
export function estadoDaLista (db, nome) {
  const membros = [...membrosDaLista(db, nome)].sort()
  return createHash('sha256').update(membros.join('\n')).digest('hex').slice(0, 16)
}

// A impressão digital da IMPORTAÇÃO: a lista de agora, o modo e as pessoas do
// arquivo. Assim a prévia só vale para aquele arquivo — simular o A e aplicar o
// B devolve outro número e é recusado.
function estadoDaImportacao (db, nome, membros, modo) {
  return createHash('sha256')
    .update(`${nome}\n${modo}\n${estadoDaLista(db, nome)}\n${[...membros].sort().join('\n')}`)
    .digest('hex').slice(0, 16)
}

const rotuloDaEntrada = (entrada) => (typeof entrada === 'string' ? `"${entrada.slice(0, 40)}"` : String(typeof entrada))

// { ok:true, membros, repetidos } ou { ok:false, erros }. Aceita o arquivo
// exportado ou um array simples; número só com dígitos vira jid de telefone.
export function lerArquivoDeLista (dados, { limite = limiteDeImportacao() } = {}) {
  let bruto = dados
  if (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) {
    if (bruto.formato !== FORMATO_DE_LISTA) return { ok: false, erros: [`O arquivo não é uma lista do LCN (formato "${FORMATO_DE_LISTA}").`] }
    if (bruto.versao !== VERSAO_DE_LISTA) return { ok: false, erros: [`Versão ${rotuloDaEntrada(String(bruto.versao))} do arquivo não é suportada (use ${VERSAO_DE_LISTA}).`] }
    bruto = bruto.membros
  }
  if (!Array.isArray(bruto)) return { ok: false, erros: ['Esperava uma lista de pessoas ("membros").'] }
  if (bruto.length === 0) return { ok: false, erros: ['O arquivo não tem ninguém. Para esvaziar uma lista use “Apagar a lista”.'] }
  if (bruto.length > limite) return { ok: false, erros: [`O arquivo tem ${bruto.length} entradas e o limite é ${limite}.`] }

  const erros = []
  const vistos = new Set()
  let repetidos = 0
  bruto.forEach((entrada, i) => {
    let jid = null
    if (typeof entrada === 'string') {
      const limpo = entrada.trim()
      if (JID_DE_PESSOA.test(limpo)) jid = limpo
      else if (SO_DIGITOS.test(limpo)) jid = `${limpo}@s.whatsapp.net`
    }
    if (!jid) { erros.push(`Entrada ${i + 1} (${rotuloDaEntrada(entrada)}) não é um número de WhatsApp válido.`); return }
    if (vistos.has(jid)) { repetidos++; return }
    vistos.add(jid)
  })
  if (erros.length) {
    const resto = erros.length > 5 ? [`… e mais ${erros.length - 5} entrada(s) inválida(s).`] : []
    return { ok: false, erros: [...erros.slice(0, 5), ...resto] }
  }
  return { ok: true, membros: [...vistos], repetidos }
}

// O que a importação faria, sem fazer.
export function planejarImportacao (db, nome, membros, modo) {
  const atuais = new Set(membrosDaLista(db, nome))
  const novos = new Set(membros)
  const adicionar = membros.filter((m) => !atuais.has(m))
  const jaEstavam = membros.length - adicionar.length
  const remover = modo === 'replace' ? [...atuais].filter((m) => !novos.has(m)) : []
  return {
    adicionar: adicionar.length,
    jaEstavam,
    remover: remover.length,
    totalFinal: modo === 'replace' ? novos.size : atuais.size + adicionar.length,
    estado: estadoDaImportacao(db, nome, membros, modo),
    _adicionar: adicionar,
    _remover: remover
  }
}

// Grava numa transação só: ou a lista fica como o plano disse, ou como estava.
export function aplicarImportacao (db, nome, membros, modo, { estado } = {}) {
  const gravar = db.transaction(() => {
    const plano = planejarImportacao(db, nome, membros, modo)
    // Substituir exige o estado da prévia; acrescentar só o confere se vier.
    if ((modo === 'replace' || estado !== undefined) && estado !== plano.estado) return { ok: false, motivo: 'mudou' }
    for (const jid of plano._remover) removerDaLista(db, nome, jid)
    for (const jid of plano._adicionar) adicionarNaLista(db, nome, jid)
    return { ok: true, plano }
  })
  return gravar()
}
