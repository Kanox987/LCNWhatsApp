// Autenticação por chave de API: criação, validação, revogação e escopo.
//
// O risco real aqui é silencioso: se a validação deixar passar um token
// revogado ou não atualizar last_used_at, o operador perde visibilidade
// sobre quem está usando a API e não consegue cortar acesso comprometido.
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { criarChave, gerarChaveApi, listarChavesDoOwner, revogarChave, validarChave } from '../src/engine/server/apiKeys.js'
import { definirDono } from '../src/engine/server/owners.js'
import { rodarMigrations } from '../src/engine/server/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PASTA_MIGRACOES = path.join(__dirname, '..', 'src', 'engine', 'server', 'migrations')

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

function abrirBancoTeste () {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  rodarMigrations(db, PASTA_MIGRACOES)
  return db
}

// --- geração de chave -------------------------------------------------------
{
  const { raw, hash } = gerarChaveApi()
  check('chave gerada tem prefixo lcn_', raw.startsWith('lcn_'), raw.slice(0, 8))
  check('hash é hex de 64 caracteres (SHA-256)', /^[0-9a-f]{64}$/.test(hash), hash.length.toString())
  check('raw e hash são diferentes', raw !== hash)
}

// --- criação exige owner ----------------------------------------------------
{
  const db = abrirBancoTeste()
  let erro
  try { criarChave(db, { ownerContactId: 'contato-qualquer', label: 'teste' }) } catch (e) { erro = e }
  check('não-owner não consegue criar chave', !!erro, erro?.message)
  check('mensagem menciona owners', /owner/i.test(erro?.message || ''), erro?.message)
  db.close()
}

// --- criação bem-sucedida armazena hash, não raw ----------------------------
{
  const db = abrirBancoTeste()
  definirDono(db, 'owner-1', true)
  const resultado = criarChave(db, { ownerContactId: 'owner-1', label: 'producao' })
  check('criação devolve id com prefixo', resultado.id.startsWith('lcn_'), resultado.id)
  check('criação devolve chave raw', resultado.key.startsWith('lcn_'), resultado.key.slice(0, 8))
  check('label é ecoado', resultado.label === 'producao')
  check('createdAt é ISO8601', /^\d{4}-\d{2}-\d{2}T/.test(resultado.createdAt))

  const linha = db.prepare('SELECT key_hash, owner_contact_id, label FROM api_keys WHERE id = ?').get(resultado.id)
  check('hash armazenado não é o raw', linha.key_hash !== resultado.key)
  check('hash armazenado tem 64 chars hex', /^[0-9a-f]{64}$/.test(linha.key_hash))
  check('owner correto no banco', linha.owner_contact_id === 'owner-1')
  check('label persistido', linha.label === 'producao')
  db.close()
}

// --- validação com token válido ---------------------------------------------
{
  const db = abrirBancoTeste()
  definirDono(db, 'owner-2', true)
  const { key, id } = criarChave(db, { ownerContactId: 'owner-2', label: 'validacao' })
  const auth = validarChave(db, key)
  check('token válido retorna contextoAuth', auth !== null)
  check('keyId bate com o criado', auth?.keyId === id)
  check('ownerContactId bate', auth?.ownerContactId === 'owner-2')
  db.close()
}

// --- token inválido ou ausente retorna null ----------------------------------
{
  const db = abrirBancoTeste()
  check('token null retorna null', validarChave(db, null) === null)
  check('token vazio retorna null', validarChave(db, '') === null)
  check('token sem prefixo retorna null', validarChave(db, 'abc123') === null)
  check('token inventado retorna null', validarChave(db, 'lcn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') === null)
  db.close()
}

// --- last_used_at atualiza na validação -------------------------------------
{
  const db = abrirBancoTeste()
  definirDono(db, 'owner-3', true)
  const { key, id } = criarChave(db, { ownerContactId: 'owner-3', label: 'timestamp' })
  const antes = db.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(id)
  check('last_used_at começa nulo', antes.last_used_at === null)
  validarChave(db, key)
  const depois = db.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(id)
  check('last_used_at preenchido após validação', typeof depois.last_used_at === 'string' && depois.last_used_at.length > 0)
  db.close()
}

// --- revogação impede validação subsequente ---------------------------------
{
  const db = abrirBancoTeste()
  definirDono(db, 'owner-4', true)
  const { key, id } = criarChave(db, { ownerContactId: 'owner-4', label: 'revogar' })
  check('chave funciona antes de revogar', validarChave(db, key) !== null)
  const resultado = revogarChave(db, id, 'owner-4')
  check('revogação confirma', resultado.revoked === true)
  check('chave revogada retorna null', validarChave(db, key) === null)
  db.close()
}

// --- revogar duas vezes dá erro ---------------------------------------------
{
  const db = abrirBancoTeste()
  definirDono(db, 'owner-5', true)
  const { id } = criarChave(db, { ownerContactId: 'owner-5', label: 'dupla' })
  revogarChave(db, id, 'owner-5')
  let erro
  try { revogarChave(db, id, 'owner-5') } catch (e) { erro = e }
  check('revogar já revogada lança erro', !!erro, erro?.message)
  db.close()
}

// --- listagem escopada ao owner autenticado ---------------------------------
{
  const db = abrirBancoTeste()
  definirDono(db, 'owner-A', true)
  definirDono(db, 'owner-B', true)
  criarChave(db, { ownerContactId: 'owner-A', label: 'chave-a1' })
  criarChave(db, { ownerContactId: 'owner-A', label: 'chave-a2' })
  criarChave(db, { ownerContactId: 'owner-B', label: 'chave-b1' })
  const listaA = listarChavesDoOwner(db, 'owner-A')
  const listaB = listarChavesDoOwner(db, 'owner-B')
  check('owner-A vê exatamente 2 chaves', listaA.length === 2, `${listaA.length} chaves`)
  check('owner-B vê exatamente 1 chave', listaB.length === 1, `${listaB.length} chaves`)
  check('chaves de A não vazam para B', listaB.every((k) => k.label !== 'chave-a1' && k.label !== 'chave-a2'))
  check('listagem inclui label', listaA.every((k) => typeof k.label === 'string'))
  check('listagem inclui created_at', listaA.every((k) => typeof k.created_at === 'string'))
  db.close()
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DE API KEYS PASSARAM')
process.exit(falhas ? 1 : 0)