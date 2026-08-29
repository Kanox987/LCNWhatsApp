// Testes do runtime.json: migração de arquivo antigo, montagem de argumentos
// de Docker (perfis econômico/personalizado/sem limites), escolha de
// Dockerfile, e persistência via save/lerRuntime.
import fs from 'fs'
import {
  normalizarRuntime,
  argsRecursos,
  dockerfileEscolhido,
  argMontagemModelos,
  composeOverride,
  lerRuntime,
  salvarRuntime
} from '../src/runtime.js'
import { ARQ_RUNTIME } from '../src/paths.js'

let falhas = 0
const eq = (nome, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp)
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}${ok ? '' : ` exp=${JSON.stringify(exp)} got=${JSON.stringify(got)}`}`)
}

// --- migração de runtime.json antigo (sem container/transcricaoLocal) ---
eq(
  'runtime.json antigo (só mode/engine) ganha defaults econômico + transcrição desligada',
  normalizarRuntime({ mode: 'docker', engine: 'docker' }),
  { mode: 'docker', engine: 'docker', container: { memory: '512m', cpus: '1.0' }, transcricaoLocal: { instalada: false, modelo: 'base' } }
)
eq(
  'runtime.json vazio/inexistente vira o padrão bare',
  normalizarRuntime({}),
  { mode: 'bare', engine: null, container: { memory: '512m', cpus: '1.0' }, transcricaoLocal: { instalada: false, modelo: 'base' } }
)
eq(
  'migração preserva memory/cpus null explícito ("sem limites") em vez de resetar pro padrão',
  normalizarRuntime({ mode: 'docker', container: { memory: null, cpus: null } }),
  { mode: 'docker', engine: null, container: { memory: null, cpus: null }, transcricaoLocal: { instalada: false, modelo: 'base' } }
)
eq(
  'migração não reseta modelo/instalada já configurados (update não pisa na escolha)',
  normalizarRuntime({ mode: 'docker', transcricaoLocal: { instalada: true, modelo: 'small' } }),
  { mode: 'docker', engine: null, container: { memory: '512m', cpus: '1.0' }, transcricaoLocal: { instalada: true, modelo: 'small' } }
)

// --- montagem de argumentos Docker ---
eq('perfil econômico (512m/1 CPU)', argsRecursos({ memory: '512m', cpus: '1.0' }), ['--memory', '512m', '--cpus', '1.0'])
eq('perfil personalizado (768m/1.5)', argsRecursos({ memory: '768m', cpus: '1.5' }), ['--memory', '768m', '--cpus', '1.5'])
eq('sem limites: não inclui --memory nem --cpus', argsRecursos({ memory: null, cpus: null }), [])
eq('sem limites nunca vira 0 (não confunde ausente com zero)', argsRecursos({ memory: null, cpus: null }).includes('0'), false)
eq('só memory definida: inclui só --memory', argsRecursos({ memory: '1g', cpus: null }), ['--memory', '1g'])

// --- escolha de Dockerfile ---
eq('transcrição local desligada -> Dockerfile', dockerfileEscolhido({ transcricaoLocal: { instalada: false } }), 'Dockerfile')
eq('transcrição local ligada -> Dockerfile.whisper', dockerfileEscolhido({ transcricaoLocal: { instalada: true } }), 'Dockerfile.whisper')

// --- montagem do volume de modelos ---
eq('sem transcrição local: sem mount de modelos', argMontagemModelos({ instalada: false }, '/raiz'), [])
eq('com transcrição local: monta ./modelos:/opt/lcn-modelos', argMontagemModelos({ instalada: true }, '/raiz'), ['-v', '/raiz/modelos:/opt/lcn-modelos'])

// --- override de compose ---
const overrideComLimites = composeOverride({ container: { memory: '2g', cpus: '2.0' }, transcricaoLocal: { instalada: true, modelo: 'small' } })
eq('override inclui dockerfile.whisper', overrideComLimites.includes('dockerfile: Dockerfile.whisper'), true)
eq('override inclui limites quando definidos', overrideComLimites.includes('memory: 2g') && overrideComLimites.includes('cpus: "2.0"'), true)
eq('override inclui mount de modelos quando instalada', overrideComLimites.includes('./modelos:/opt/lcn-modelos'), true)

const overrideSemLimites = composeOverride({ container: { memory: null, cpus: null }, transcricaoLocal: { instalada: false, modelo: 'base' } })
eq('override "sem limites" não tem bloco deploy', overrideSemLimites.includes('deploy:'), false)
eq('override sem transcrição local não monta volumes', overrideSemLimites.includes('volumes:'), false)

// --- persistência real: save/lerRuntime não reseta modelo após "update" ---
const backup = fs.readFileSync(ARQ_RUNTIME, 'utf8')
try {
  salvarRuntime({ mode: 'docker', engine: 'docker', container: { memory: '2g', cpus: '2.0' }, transcricaoLocal: { instalada: true, modelo: 'small' } })
  const lido1 = lerRuntime()
  eq('salvarRuntime + lerRuntime: modelo persistido', lido1.transcricaoLocal.modelo, 'small')

  // Simula um "update" que só regrava mode/engine (sem tocar em transcricaoLocal) —
  // o modelo/instalada não podem ser resetados.
  const rt2 = lerRuntime()
  rt2.engine = 'podman'
  salvarRuntime(rt2)
  const lido2 = lerRuntime()
  eq('após "update" só de engine, modelo continua small', lido2.transcricaoLocal.modelo, 'small')
  eq('após "update", instalada continua true', lido2.transcricaoLocal.instalada, true)
  eq('após "update", engine foi atualizado', lido2.engine, 'podman')
} finally {
  fs.writeFileSync(ARQ_RUNTIME, backup)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nRUNTIME OK')
process.exit(falhas ? 1 : 0)
