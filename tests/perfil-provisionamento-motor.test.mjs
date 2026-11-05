// Perfil de provisionamento contra o MOTOR real (rotas /perfis/*), em banco
// temporário. A camada pura está em `perfil-provisionamento.test.mjs`.
//
// O que estes casos impedem:
//  · "atômico" só no nome: um pool criado e um membro que falha deixando o
//    pool órfão;
//  · `--check` que deixa rastro (pool, automação ou linha de estado);
//  · perfil bloqueado sendo reaplicado a cada reinício;
//  · a mesma versão com outro conteúdo passando em silêncio;
//  · política ilegível sendo ignorada (falha aberta).
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { abrirBanco } from '../src/engine/server/db.js'
import { criarApi } from '../src/engine/server/api.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const contexto = (body = null) => ({ body, query: new URLSearchParams(), req: { headers: {} } })
const chamar = (api, metodo, caminho, body) => api.resolver(metodo, caminho, contexto(body))
const tentar = async (fn) => { try { return { ok: await fn() } } catch (erro) { return { erro } } }
const contar = (db, tabela) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get().n
// O motor já nasce com o pool "padrao"; o que o perfil cria é medido à parte.
const temPool = (db, id) => !!db.prepare('SELECT 1 FROM pools WHERE id = ?').get(id)
const estados = (db) => db.prepare('SELECT * FROM provisioning_profile_applications ORDER BY profile_version').all()

const TUDO = { include: [{ kind: 'everywhere' }], exclude: [] }
const perfil = (extra = {}) => ({
  schemaVersion: 1, profileId: 'gb', profileVersion: 1,
  templateIds: ['x9', 'apagar'], scope: TUDO,
  pools: [{ id: 'principal', label: 'Principal' }],
  parametrosComuns: { poolId: 'principal' },
  ...extra
})
const aplicar = (api, p, opcoes = {}) => chamar(api, 'POST', '/perfis/aplicar', { perfil: p, ...opcoes })
const validar = (api, p, opcoes = {}) => chamar(api, 'POST', '/perfis/validar', { perfil: p, ...opcoes })

// ------------------------------------------------ 1. perfil vazio
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  const r = await aplicar(api, { schemaVersion: 1, profileId: 'limpo', profileVersion: 1 })
  check('1. perfil vazio aplica sem instalar nada', r.acao === 'aplicado' && contar(db, 'automations') === 0)
  check('1. e fica registrado como aplicado', estados(db).length === 1 && estados(db)[0].status === 'applied')
  const de_novo = await aplicar(api, { schemaVersion: 1, profileId: 'limpo', profileVersion: 1 })
  check('1. repetir não faz nada', de_novo.acao === 'ja-aplicado')
  db.close()
}

// ------------------------------------------------ 2. templates avulsos + pool
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  const r = await aplicar(api, perfil())
  check('2. aplica e cria o pool do perfil', r.acao === 'aplicado' && r.poolsCriados.join() === 'principal' && temPool(db, 'principal'))
  check('2. instala os templates pedidos', contar(db, 'automations') >= 2, `n=${contar(db, 'automations')}`)
  const antes = contar(db, 'automations')
  const r2 = await aplicar(api, perfil())
  check('2. segunda subida: nada muda', r2.acao === 'ja-aplicado' && contar(db, 'automations') === antes)
  const est = await chamar(api, 'GET', '/perfis/estado')
  check('2. GET /perfis/estado lista a aplicação', est.aplicacoes.length === 1 && est.aplicacoes[0].status === 'applied')
  check('2. o estado não guarda parâmetros nem corpo', !JSON.stringify(est).includes('principal'))
  db.close()
}

// ------------------------------------------------ 3. pacote
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  const r = await aplicar(api, perfil({ profileId: 'pk', packageIds: ['basico'], templateIds: [] }))
  check('3. pacote do catálogo é instalado', r.acao === 'aplicado' && r.escolhas[0].kind === 'pacote' && r.escolhas[0].instaladas.length > 0)
  db.close()
}

// ------------------------------------------------ 4. --check não deixa rastro
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  const r = await validar(api, perfil())
  check('4. validar mostra o plano', r.acao === 'aplicar' && r.simulado === true && r.poolsCriados.join() === 'principal')
  check('4. e não deixa pool, automação nem estado',
    !temPool(db, 'principal') && contar(db, 'automations') === 0 && estados(db).length === 0)
  const real = await aplicar(api, perfil())
  check('4. depois de validar, aplicar funciona normalmente', real.acao === 'aplicado')
  db.close()
}

// ------------------------------------------------ 5. rollback: pool não fica órfão
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  // O pacote falha por falta de parâmetro (poolId) DEPOIS de o pool ter sido criado.
  const ruim = perfil({ profileId: 'ruim', parametrosComuns: {} })
  const { erro } = await tentar(() => aplicar(api, ruim))
  check('5. parâmetro faltando é 400', erro?.status === 400, String(erro?.status))
  check('5. o pool criado antes foi desfeito', !temPool(db, 'principal'))
  check('5. nenhuma automação ficou', contar(db, 'automations') === 0)
  check('5. a falha ficou registrada como blocked, sem parâmetros', estados(db)[0]?.status === 'blocked' && estados(db)[0].error_code === 'http_400')
  db.close()
}

// ------------------------------------------------ 6. bloqueado não repete
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  const ruim = perfil({ profileId: 'ruim', parametrosComuns: {} })
  await tentar(() => aplicar(api, ruim))
  const r = await aplicar(api, ruim)
  check('6. perfil bloqueado não é repetido sozinho', r.acao === 'bloqueado' && r.estado.status === 'blocked')
  const retry = await tentar(() => aplicar(api, ruim, { retry: true }))
  check('6. --retry tenta de novo', retry.erro?.status === 400)
  db.close()
}

// ------------------------------------------------ 7. versões
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  await aplicar(api, perfil())
  const outro = await tentar(() => aplicar(api, perfil({ templateIds: ['x9'] })))
  check('7. mesma versão com outro conteúdo é recusada (409)', outro.erro?.status === 409 && /outro conteúdo/.test(outro.erro.message))
  check('7. e o registro do que foi aplicado não é apagado', estados(db)[0].status === 'applied')
  const nova = await aplicar(api, perfil({ profileVersion: 2, templateIds: ['x9', 'apagar', 'ping'] }))
  check('7. versão maior sem --reconcile só avisa', nova.acao === 'versao-nova-pendente' && nova.versaoAplicada === 1)
  const rec = await aplicar(api, perfil({ profileVersion: 2, templateIds: ['x9', 'apagar', 'ping'] }), { reconcile: true })
  check('7. versão maior com --reconcile aplica (aditivo)', rec.acao === 'aplicado')
  const velha = await aplicar(api, perfil())
  check('7. versão menor que a aplicada é ignorada', velha.acao === 'ja-aplicado' || velha.acao === 'versao-antiga')
  db.close()
}

// ------------------------------------------------ 8. catálogo e forma
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  const a = await tentar(() => aplicar(api, perfil({ templateIds: ['nao-existe'] })))
  check('8. template inexistente é 400 e não grava estado', a.erro?.status === 400 && estados(db).length === 0)
  const b = await tentar(() => chamar(api, 'POST', '/perfis/aplicar', {}))
  check('8. corpo sem perfil é 400', b.erro?.status === 400)
  db.close()
}

// ------------------------------------------------ 9. pool ausente / conexão: 409 do próprio provisionar
{
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  const r = await tentar(() => aplicar(api, perfil({ profileId: 'sempool', pools: [] })))
  check('9. pool que não existe no motor é 409', r.erro?.status === 409, String(r.erro?.status))
  check('9. e o perfil fica blocked', estados(db)[0]?.status === 'blocked')
  db.close()
}

// ------------------------------------------------ 10. política
{
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-politica-'))
  const arquivo = path.join(pasta, 'politica.json')
  fs.writeFileSync(arquivo, JSON.stringify({ schemaVersion: 1, allowedTemplateIds: ['x9'] }))
  const db = abrirBanco(':memory:'); const api = criarApi(db, { env: { LCN_PROVISION_POLICY: arquivo } })
  const fora = await tentar(() => aplicar(api, perfil()))
  check('10. template fora da política recusa o perfil inteiro (409)', fora.erro?.status === 409 && fora.erro.detalhes?.politica === true)
  check('10. nada foi instalado', contar(db, 'automations') === 0 && !temPool(db, 'principal'))
  const dentro = await aplicar(api, perfil({ profileId: 'so-x9', templateIds: ['x9'] }))
  check('10. o que a política permite passa', dentro.acao === 'aplicado')

  fs.writeFileSync(arquivo, '{ quebrado')
  const dbB = abrirBanco(':memory:'); const apiB = criarApi(dbB, { env: { LCN_PROVISION_POLICY: arquivo } })
  const ilegivel = await tentar(() => aplicar(apiB, perfil()))
  check('10. política ilegível recusa a aplicação (falha fechada)', ilegivel.erro?.status === 409 || ilegivel.erro?.status === 400, String(ilegivel.erro?.status))
  check('10. e não instala nada', contar(dbB, 'automations') === 0)
  const saude = await chamar(apiB, 'GET', '/health')
  check('10. o motor segue de pé', saude.ok === true)

  const dbC = abrirBanco(':memory:')
  const ausente = await aplicar(criarApi(dbC, { env: { LCN_PROVISION_POLICY: path.join(pasta, 'nao-existe.json') } }), perfil())
    .then(() => null, (e) => e)
  check('10. caminho de política inexistente também falha fechado', ausente?.status === 409, String(ausente?.status))
  const semPolitica = await aplicar(criarApi(abrirBanco(':memory:'), { env: {} }), perfil())
  check('10. sem LCN_PROVISION_POLICY permite tudo', semPolitica.acao === 'aplicado')
  fs.rmSync(pasta, { recursive: true, force: true })
  db.close(); dbB.close(); dbC.close()
}

// ------------------------------------------------ 11. os exemplos publicados funcionam
{
  const pasta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'deployment', 'perfis')
  const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.json'))
  check('11. há exemplos publicados', arquivos.length >= 3, String(arquivos.length))
  for (const arquivo of arquivos) {
    const db = abrirBanco(':memory:'); const api = criarApi(db)
    const r = await tentar(() => aplicar(api, JSON.parse(fs.readFileSync(path.join(pasta, arquivo), 'utf8'))))
    check(`11. ${arquivo} aplica num motor limpo, sem avisos`,
      r.ok?.acao === 'aplicado' && r.ok.escolhas.every((e) => e.avisos.length === 0), r.erro?.message)
    db.close()
  }
  const db = abrirBanco(':memory:'); const api = criarApi(db)
  await aplicar(api, JSON.parse(fs.readFileSync(path.join(pasta, 'recuperar-x9.json'), 'utf8')))
  const ids = db.prepare('SELECT id FROM automations').all().map((r) => r.id)
  check('11. recuperar-x9 instala as seis automações', ids.length === 6, ids.join())
  db.close()
}

console.log(falhas === 0
  ? '\nO PERFIL ENTRA POR INTEIRO OU NÃO ENTRA, E O MOTOR CONTA O QUE ACONTECEU\n'
  : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
