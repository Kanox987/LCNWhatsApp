// Testa o controle de fluxo de src/transcription/preload.py com um stub do
// pacote faster_whisper (sem baixar modelo de verdade / sem precisar de
// rede): sucesso, falha na construção do modelo, pacote ausente, e
// argumento faltando. Confirma os códigos de saída exigidos pelo pré-download.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preload = path.join(__dirname, '..', 'src', 'transcription', 'preload.py')

let falhas = 0
const check = (nome, ok, extra) => { if (!ok) falhas++; console.log(`${ok ? '✅' : '❌'} ${nome}${extra ? ` (${extra})` : ''}`) }

const python3 = spawnSync('python3', ['--version'])
if (python3.error) {
  console.log('⏭️  pulando (python3 não encontrado neste ambiente)')
  console.log('\nPRELOAD OK (pulado)')
  process.exit(0)
}

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcn-preload-stub-'))
fs.writeFileSync(path.join(stubDir, 'faster_whisper.py'), `
import os
class WhisperModel:
    def __init__(self, modelo, device=None, compute_type=None, download_root=None):
        if os.environ.get('LCN_TEST_FALHA') == '1':
            raise RuntimeError('falha simulada de download')
`)

function rodar (args, env) {
  return spawnSync('python3', [preload, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: stubDir, ...env }
  })
}

try {
  const ok = rodar(['tiny'])
  check('sucesso: exit 0', ok.status === 0, `status=${ok.status}`)
  check('sucesso: imprime confirmação com o nome do modelo', ok.stdout.includes('tiny'))

  const falha = rodar(['tiny'], { LCN_TEST_FALHA: '1' })
  check('falha na construção do modelo: exit != 0', falha.status !== 0, `status=${falha.status}`)

  const semPacote = spawnSync('python3', [preload, 'tiny'], { encoding: 'utf8' })
  check('faster_whisper não instalado: exit != 0', semPacote.status !== 0, `status=${semPacote.status}`)

  const semArg = rodar([])
  check('sem argumento de modelo: exit != 0', semArg.status !== 0, `status=${semArg.status}`)
} finally {
  fs.rmSync(stubDir, { recursive: true, force: true })
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nPRELOAD OK')
process.exit(falhas ? 1 : 0)
