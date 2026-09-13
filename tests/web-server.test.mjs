// Módulo 4 da Etapa 4.5: transporte HTTP local do painel (src/web/server.js
// + src/web/router.js). Sobe um servidor real numa porta efêmera
// (port: 0) com uma `aplicacao` FALSA (nunca toca no motor/socket real nem
// em systemctl) — cobre roteamento, mapeamento de erro e a trava de host.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { iniciarServidorWeb } from '../src/web/server.js'

let falhas = 0
const check = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}`) }

function criarAplicacaoFake () {
  const chamadas = []
  const registrar = (nome, retorno) => (...args) => {
    chamadas.push({ nome, args })
    if (retorno instanceof Error) throw retorno
    return retorno
  }
  return {
    chamadas,
    instancias: {
      listar: registrar('instancias.listar', [{ instanceId: 'wa-000001' }]),
      obter: registrar('instancias.obter', { instanceId: 'wa-000001' }),
      iniciar: registrar('instancias.iniciar', { ok: true }),
      pareamento: registrar('instancias.pareamento', { qr: null }),
      obterOtimizacao: registrar('instancias.obterOtimizacao', { bandwidthLimit: {} }),
      definirOtimizacao: registrar('instancias.definirOtimizacao', { ok: true })
    },
    diretorio: {
      listar: registrar('diretorio.listar', { items: [], nextCursor: null })
    },
    motor: {
      saude: registrar('motor.saude', { ok: true }),
      automacoes: {
        obterMeta: registrar('automacoes.obterMeta', { schemaVersion: 1 }),
        listar: registrar('automacoes.listar', []),
        salvarRascunho: registrar('automacoes.salvarRascunho', { id: 1 }),
        obterProvenance: registrar('automacoes.obterProvenance', { installedFromTemplate: false })
      },
      templates: {
        listar: registrar('templates.listar', [{ templateId: 'ping' }]),
        obter: registrar('templates.obter', { templateId: 'ping', documentTemplate: {} }),
        instalar: registrar('templates.instalar', { installed: [{ id: 'ping' }] })
      },
      execucoes: {
        listar: registrar('execucoes.listar', { items: [], nextCursor: null })
      },
      meta: {
        obterVariaveis: registrar('meta.obterVariaveis', { builtIn: [], reserved: [] })
      },
      entidades: {
        listar: registrar('entidades.listar', [{ key: 'vip', value: true }]),
        definir: registrar('entidades.definir', { key: 'vip', value: true }),
        remover: registrar('entidades.remover', { removed: true, key: 'vip' })
      }
    }
  }
}

const aplicacao = criarAplicacaoFake()
const { fechar, port } = await iniciarServidorWeb({ host: '127.0.0.1', port: 0, aplicacao })
const base = `http://127.0.0.1:${port}`

try {
  const r1 = await fetch(`${base}/api/v1/instances`)
  check('GET /api/v1/instances: status 200', r1.status === 200)
  check('GET /api/v1/instances: delega pra aplicacao.instancias.listar', aplicacao.chamadas.some((c) => c.nome === 'instancias.listar'))
  check('GET /api/v1/instances: corpo bate com o retorno da aplicação', JSON.stringify(await r1.json()) === JSON.stringify([{ instanceId: 'wa-000001' }]))

  const r2 = await fetch(`${base}/api/v1/instances/wa-000001/start`, { method: 'POST' })
  check('POST .../start: chama instancias.iniciar com o id certo', aplicacao.chamadas.some((c) => c.nome === 'instancias.iniciar' && c.args[0] === 'wa-000001'))
  check('POST .../start: status 200', r2.status === 200)

  const r3 = await fetch(`${base}/api/v1/instances/wa-000001/directory?kind=contact&q=maria`)
  const chamadaDiretorio = aplicacao.chamadas.find((c) => c.nome === 'diretorio.listar')
  check('GET .../directory: repassa query como objeto', chamadaDiretorio?.args[1]?.kind === 'contact' && chamadaDiretorio?.args[1]?.q === 'maria')
  check('GET .../directory: status 200', r3.status === 200)

  const r4 = await fetch(`${base}/api/v1/automations/ping/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': 'etag-123' },
    body: JSON.stringify({ document: { id: 'ping' } })
  })
  const chamadaDraft = aplicacao.chamadas.find((c) => c.nome === 'automacoes.salvarRascunho')
  check('PUT .../draft: repassa If-Match pro terceiro argumento', chamadaDraft?.args[2] === 'etag-123')
  check('PUT .../draft: status 200', r4.status === 200)

  const r5 = await fetch(`${base}/api/v1/health`)
  const corpoSaude = await r5.json()
  check('GET /api/v1/health: motor ok reflete no corpo', corpoSaude.engine === 'ok')

  const r404 = await fetch(`${base}/api/v1/rota-que-nao-existe`)
  check('rota inexistente: 404', r404.status === 404)

  const r6 = await fetch(`${base}/api/v1/meta/variables`)
  check('GET /api/v1/meta/variables: delega pro motor', aplicacao.chamadas.some((c) => c.nome === 'meta.obterVariaveis') && r6.status === 200)

  const r7 = await fetch(`${base}/api/v1/entities/contact/5511999@s.whatsapp.net/attributes`)
  check('GET .../attributes: repassa kind e id certos', aplicacao.chamadas.some((c) => c.nome === 'entidades.listar' && c.args[0] === 'contact' && c.args[1] === '5511999@s.whatsapp.net') && r7.status === 200)

  const r8 = await fetch(`${base}/api/v1/entities/contact/5511999@s.whatsapp.net/attributes/vip`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: true })
  })
  const chamadaDefinir = aplicacao.chamadas.find((c) => c.nome === 'entidades.definir')
  check('PUT .../attributes/:key: repassa kind/id/key/value corretos', chamadaDefinir?.args[0] === 'contact' && chamadaDefinir?.args[1] === '5511999@s.whatsapp.net' && chamadaDefinir?.args[2] === 'vip' && chamadaDefinir?.args[3] === true && r8.status === 200)

  const r9 = await fetch(`${base}/api/v1/entities/contact/5511999@s.whatsapp.net/attributes/vip`, { method: 'DELETE' })
  check('DELETE .../attributes/:key: repassa kind/id/key corretos', aplicacao.chamadas.some((c) => c.nome === 'entidades.remover' && c.args[2] === 'vip') && r9.status === 200)

  const r10 = await fetch(`${base}/api/v1/templates`)
  check('GET /api/v1/templates: delega pro motor', aplicacao.chamadas.some((c) => c.nome === 'templates.listar') && r10.status === 200)

  const r11 = await fetch(`${base}/api/v1/templates/ping`)
  check('GET /api/v1/templates/:id: repassa o id certo', aplicacao.chamadas.some((c) => c.nome === 'templates.obter' && c.args[0] === 'ping') && r11.status === 200)

  const r12 = await fetch(`${base}/api/v1/templates/ping/install`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: { include: [] } })
  })
  const chamadaInstalar = aplicacao.chamadas.find((c) => c.nome === 'templates.instalar')
  check('POST .../install: repassa id e corpo pro motor', chamadaInstalar?.args[0] === 'ping' && chamadaInstalar?.args[1]?.scope?.include?.length === 0 && r12.status === 200)

  const r13 = await fetch(`${base}/api/v1/automations/ping/provenance`)
  check('GET .../provenance: repassa o id certo', aplicacao.chamadas.some((c) => c.nome === 'automacoes.obterProvenance' && c.args[0] === 'ping') && r13.status === 200)

  // --- erro do motor vira status HTTP correto, não 500 genérico ---
  const erroMotor = new Error('Automação já cadastrada: ping.')
  erroMotor.status = 409
  const aplicacaoComErro = criarAplicacaoFake()
  aplicacaoComErro.motor.automacoes.listar = () => { throw erroMotor }
  const servidorErro = await iniciarServidorWeb({ host: '127.0.0.1', port: 0, aplicacao: aplicacaoComErro })
  try {
    const rErro = await fetch(`http://127.0.0.1:${servidorErro.port}/api/v1/automations`)
    check('erro do motor com .status: repassa o status HTTP correto (409, não 500)', rErro.status === 409)
    const corpoErro = await rErro.json()
    check('erro do motor: mensagem repassada no corpo', corpoErro.error === 'Automação já cadastrada: ping.')
  } finally {
    await servidorErro.fechar()
  }

  // --- motor inalcançável (sem .status numérico) vira 502, não 500 ---
  const erroConexao = new Error('motor não está rodando — lcn engine start')
  const aplicacaoMotorFora = criarAplicacaoFake()
  aplicacaoMotorFora.motor.automacoes.listar = () => { throw erroConexao }
  const servidorMotorFora = await iniciarServidorWeb({ host: '127.0.0.1', port: 0, aplicacao: aplicacaoMotorFora })
  try {
    const rFora = await fetch(`http://127.0.0.1:${servidorMotorFora.port}/api/v1/automations`)
    check('motor inalcançável (sem .status): 502, não 500', rFora.status === 502)
  } finally {
    await servidorMotorFora.fechar()
  }
} finally {
  await fechar()
}

// --- arquivos estáticos (Módulo 5 vai popular src/web/public/ de verdade;
// aqui só cobrimos o mecanismo de serving em si, com uma pasta fixture) ---
const pastaPublicFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-web-public-'))
fs.writeFileSync(path.join(pastaPublicFixture, 'index.html'), '<!doctype html><title>painel</title>')
fs.mkdirSync(path.join(pastaPublicFixture, 'pages'))
fs.writeFileSync(path.join(pastaPublicFixture, 'pages', 'app.js'), 'console.log("ok")')

const servidorEstatico = await iniciarServidorWeb({ host: '127.0.0.1', port: 0, aplicacao: criarAplicacaoFake(), pastaPublic: pastaPublicFixture })
try {
  const rIndex = await fetch(`http://127.0.0.1:${servidorEstatico.port}/`)
  check('GET /: serve index.html', (await rIndex.text()).includes('painel'))
  check('GET /: content-type html', rIndex.headers.get('content-type').includes('text/html'))

  const rAsset = await fetch(`http://127.0.0.1:${servidorEstatico.port}/pages/app.js`)
  check('GET /pages/app.js: serve o arquivo real', (await rAsset.text()).includes('console.log'))
  check('GET /pages/app.js: content-type javascript', rAsset.headers.get('content-type').includes('javascript'))

  const rFallback = await fetch(`http://127.0.0.1:${servidorEstatico.port}/qualquer/rota/do/spa`)
  check('GET rota desconhecida sem /api/: cai pro index.html (fallback de SPA)', (await rFallback.text()).includes('painel'))

  const rTraversal = await fetch(`http://127.0.0.1:${servidorEstatico.port}/../../../../etc/passwd`)
  check('tentativa de path traversal não escapa da pasta public', rTraversal.status !== 200 || !(await rTraversal.clone().text()).includes('root:'))

  const rApiAindaFunciona = await fetch(`http://127.0.0.1:${servidorEstatico.port}/api/v1/instances`)
  check('rotas /api/ continuam passando pelo roteador normal mesmo com static habilitado', rApiAindaFunciona.status === 200)
} finally {
  await servidorEstatico.fechar()
  fs.rmSync(pastaPublicFixture, { recursive: true, force: true })
}

// --- pasta public inexistente: erro claro, não crash ---
const servidorSemPublic = await iniciarServidorWeb({
  host: '127.0.0.1', port: 0, aplicacao: criarAplicacaoFake(), pastaPublic: path.join(os.tmpdir(), 'lcn-pasta-que-nao-existe-nunca')
})
try {
  const rSemPublic = await fetch(`http://127.0.0.1:${servidorSemPublic.port}/`)
  check('painel não instalado: erro claro em vez de crash', rSemPublic.status === 404)
} finally {
  await servidorSemPublic.fechar()
}

// --- trava de host: nunca 0.0.0.0 sem autenticação ---
let lancouHostProibido = false
try {
  await iniciarServidorWeb({ host: '0.0.0.0', port: 0, aplicacao: criarAplicacaoFake() })
} catch {
  lancouHostProibido = true
}
check('recusa escutar em 0.0.0.0 (regra fixa do plano)', lancouHostProibido)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS CASOS DO SERVIDOR WEB PASSARAM')
process.exit(falhas ? 1 : 0)
