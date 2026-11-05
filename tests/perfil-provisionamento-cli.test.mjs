// `lcn engine provisionar` de ponta a ponta: o motor REAL num HOME temporário,
// a CLI real falando com ele pelo socket. É o que o boot do container faz.
//
// O que estes casos impedem:
//  · o primeiro boot não instalar o perfil (ou instalá-lo duas vezes no segundo);
//  · perfil inválido derrubar o motor, ou sair com código 0 sem ninguém notar;
//  · `--check` deixar rastro;
//  · opções malformadas virarem aplicação silenciosa.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { lerOpcoes, executarProvisionar } from '../src/engine/provisionarCli.js'

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- opções
{
  const o = lerOpcoes(['--perfil', 'a.json', '--check', '--reconcile', '--retry', '--aguardar', '5'])
  check('opções: todas lidas', o.perfil === 'a.json' && o.check && o.reconcile && o.retry && o.aguardar === 5)
  const quebra = (argv) => { try { lerOpcoes(argv); return null } catch (e) { return e.message } }
  check('opções: sem --perfil é recusado', /--perfil/.test(quebra([]) ?? ''))
  check('opções: opção desconhecida é recusada', /desconhecida/.test(quebra(['--perfil', 'a', '--x']) ?? ''))
  check('opções: --perfil sem valor é recusado', /precisa de um valor/.test(quebra(['--perfil']) ?? ''))
  check('opções: --aguardar não numérico é recusado', /segundos/.test(quebra(['--perfil', 'a', '--aguardar', 'x']) ?? ''))
}

// ------------------------------------------- saída com cliente de mentira
{
  const saidas = []
  const erros = []
  const roda = (resposta, argv = ['--perfil', '/nao/existe.json']) =>
    executarProvisionar(argv, { cliente: resposta, log: (t) => saidas.push(t), erro: (t) => erros.push(t) })
  check('arquivo inexistente: código 2, sem falar com o motor',
    await roda({ perfis: { aplicar: () => { throw new Error('não devia chamar') } } }) === 2 && /não existe/.test(erros.join()))
}

// ------------------------------------------------------- motor de verdade
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-pe-'))
const perfilOk = path.join(home, 'ok.json')
const perfilRuim = path.join(home, 'ruim.json')
const perfilQuebrado = path.join(home, 'quebrado.json')
fs.writeFileSync(perfilOk, JSON.stringify({
  schemaVersion: 1, profileId: 'gb', profileVersion: 1,
  templateIds: ['x9', 'apagar'], scope: { include: [{ kind: 'everywhere' }], exclude: [] },
  parametrosComuns: { poolId: 'padrao' }
}))
// Falta o poolId: o motor recusa (400) — perfil errado, não motor quebrado.
fs.writeFileSync(perfilRuim, JSON.stringify({
  schemaVersion: 1, profileId: 'ruim', profileVersion: 1,
  templateIds: ['x9'], scope: { include: [{ kind: 'everywhere' }], exclude: [] }
}))
fs.writeFileSync(perfilQuebrado, '{ isto não é json')

const ambiente = { ...process.env, HOME: home, XDG_DATA_HOME: '', XDG_RUNTIME_DIR: '' }
delete ambiente.LCN_ENGINE_SOCKET
delete ambiente.LCN_PROVISION_POLICY
const motor = spawn(process.execPath, [path.join(RAIZ, 'src/engine/server/index.js')], { env: ambiente, stdio: 'ignore' })
const cli = (...args) => spawnSync(process.execPath, [path.join(RAIZ, 'src/engine/cli.js'), 'provisionar', ...args], { env: ambiente, encoding: 'utf8' })
const bancoDoMotor = () => path.join(home, '.local/share/lcnwhatsapp/engine/engine.sqlite')

try {
  const primeira = cli('--perfil', perfilOk, '--aguardar', '30')
  check('primeiro boot: o motor sobe e o perfil é aplicado (saída 0)', primeira.status === 0 && /Aplicado: gb v1/.test(primeira.stdout), `${primeira.status} ${primeira.stderr}`)
  const segunda = cli('--perfil', perfilOk)
  check('segundo boot: nada muda', segunda.status === 0 && /já aplicado/.test(segunda.stdout), segunda.stdout)

  const { abrirBanco } = await import('../src/engine/server/db.js')
  const db = abrirBanco(bancoDoMotor())
  const instaladas = db.prepare('SELECT COUNT(*) AS n FROM automations').get().n
  check('o banco do motor tem as automações do perfil', instaladas >= 2, String(instaladas))
  db.close()

  const check_ = cli('--perfil', perfilRuim, '--check')
  check('--check de perfil inválido sai ≠ 0 e explica', check_.status !== 0 && /poolId|pool/i.test(check_.stderr), check_.stderr)
  const ruim = cli('--perfil', perfilRuim)
  check('perfil inválido sai ≠ 0', ruim.status !== 0, String(ruim.status))
  const repetido = cli('--perfil', perfilRuim)
  check('perfil bloqueado não é reaplicado sozinho', repetido.status !== 0 && /bloqueado/.test(repetido.stdout), repetido.stdout)
  const quebrado = cli('--perfil', perfilQuebrado)
  check('JSON quebrado sai com 2', quebrado.status === 2, String(quebrado.status))
  const vivo = cli('--perfil', perfilOk)
  check('depois de tudo isso o motor segue de pé', vivo.status === 0 && motor.exitCode === null)
} finally {
  motor.kill('SIGTERM')
  await new Promise((r) => (motor.exitCode !== null ? r() : motor.once('exit', r)))
  fs.rmSync(home, { recursive: true, force: true })
}

console.log(falhas === 0
  ? '\nO PRIMEIRO BOOT APLICA O PERFIL, O SEGUNDO NÃO MEXE, E O ERRO NÃO DERRUBA O MOTOR\n'
  : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
