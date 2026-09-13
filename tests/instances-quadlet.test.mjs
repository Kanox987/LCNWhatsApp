import { gerarQuadlet } from '../src/instances/quadlet.js'
import { PASTA_MODELOS_COMPARTILHADA } from '../src/instances/paths.js'
import { PASTA_RUN as PASTA_RUN_ENGINE } from '../src/engine/paths.js'

let falhas = 0
const check = (nome, ok) => {
  if (!ok) falhas++
  console.log(`${ok ? '✅' : '❌'} ${nome}`)
}

function instancia (sobrescritas = {}) {
  return {
    instanceId: 'wa-000001',
    label: 'Suporte',
    expectedPhoneE164: '+5511999999999',
    dataDir: '/home/teste/.local/share/lcnwhatsapp/instances/wa-000001',
    unitFile: '/home/teste/.config/containers/systemd/lcn-wa-000001.container',
    containerName: 'lcn-wa-000001',
    resources: { memory: null, cpus: null },
    transcricaoLocal: { instalada: false, modelo: 'base' },
    createdAt: '2026-09-05T12:00:00.000Z',
    ...sobrescritas
  }
}

const semRecursos = gerarQuadlet(instancia())
check('recursos null omitem PodmanArgs por inteiro', !semRecursos.includes('PodmanArgs='))
check('imagem base é usada sem transcrição local', semRecursos.includes('Image=localhost/lcnwhatsapp:latest'))

const comRecursos = gerarQuadlet(instancia({ resources: { memory: '768m', cpus: '1.5' } }))
check('recursos definidos aparecem na sintaxe do Quadlet', comRecursos.includes('PodmanArgs=--memory=768m --cpus=1.5'))

const soCpu = gerarQuadlet(instancia({ resources: { memory: null, cpus: '2.0' } }))
check('cada recurso é independente quando o outro é null', soCpu.includes('PodmanArgs=--cpus=2.0') && !soCpu.includes('--memory='))

const comWhisper = gerarQuadlet(instancia({ transcricaoLocal: { instalada: true, modelo: 'small' } }))
check('imagem Whisper é usada com transcrição local', comWhisper.includes('Image=localhost/lcnwhatsapp:whisper'))
check('modelos compartilhados são montados read-only com Whisper', comWhisper.includes(`Volume=${PASTA_MODELOS_COMPARTILHADA}:/opt/lcn-modelos:ro`))
check('volume de modelos não aparece sem Whisper', !semRecursos.includes(PASTA_MODELOS_COMPARTILHADA))

const blocoContainer = semRecursos.split('[Container]\n')[1].split('\n\n[Service]')[0]
check('bloco Container não tem nenhuma política de restart', !/(^|\n)Restart=/m.test(blocoContainer) && !/--restart(?:=|\s|$)/m.test(blocoContainer))
check('restart existe somente sob Service', semRecursos.includes('[Service]\nRestart=on-failure'))

// Achado real de revisão de segurança: StartLimitIntervalSec/StartLimitBurst
// são diretivas de [Unit] (systemd.unit(5)), não de [Service] — sob
// [Service] o systemd as ignora silenciosamente ("chave desconhecida") e o
// limite de tentativas nunca é aplicado de verdade.
const blocoUnit = semRecursos.split('[Unit]\n')[1].split('\n\n[Container]')[0]
const blocoService = semRecursos.split('[Service]\n')[1].split('\n\n[Install]')[0]
check('StartLimitIntervalSec está sob [Unit], não [Service]', blocoUnit.includes('StartLimitIntervalSec=600') && !blocoService.includes('StartLimitIntervalSec='))
check('StartLimitBurst está sob [Unit], não [Service]', blocoUnit.includes('StartLimitBurst=8') && !blocoService.includes('StartLimitBurst='))
check('RestartPreventExitStatus contém os quatro códigos terminais', semRecursos.includes('RestartPreventExitStatus=21 22 23 24'))
check('LCN_SUPERVISED é definido', semRecursos.includes('Environment=LCN_SUPERVISED=systemd'))
check('LCN_INSTANCE_ID é definido', semRecursos.includes('Environment=LCN_INSTANCE_ID=wa-000001'))
check('socket do motor usa o caminho montado dentro do container', semRecursos.includes('Environment=LCN_ENGINE_SOCKET=/run/lcn-engine/engine.sock'))
check('diretório do socket do motor é montado no gateway', semRecursos.includes(`Volume=${PASTA_RUN_ENGINE}:/run/lcn-engine`))
check('Exec sempre passa pelo lock', semRecursos.includes('Exec=/app/bin/lock-and-run.sh /app/data/instance.lock node index.js'))

for (const volume of [
  'sessao:/app/sessao',
  'midia:/app/midia',
  'data:/app/data',
  'config.json:/app/config.json'
]) {
  check(`volume básico sempre aparece: ${volume}`, semRecursos.includes(`Volume=/home/teste/.local/share/lcnwhatsapp/instances/wa-000001/${volume}`))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nQUADLET OK')
process.exit(falhas ? 1 : 0)
