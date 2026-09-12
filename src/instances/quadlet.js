import {
  EXIT_LOGOUT_REPAIR_NEEDED,
  EXIT_CONFLICT,
  EXIT_FATAL_ACCOUNT,
  EXIT_QUARANTINED
} from '../exitCodes.js'
import { PASTA_MODELOS_COMPARTILHADA } from './paths.js'

const CODIGOS_TERMINAIS = [
  EXIT_LOGOUT_REPAIR_NEEDED,
  EXIT_CONFLICT,
  EXIT_FATAL_ACCOUNT,
  EXIT_QUARANTINED
]

function descricaoSegura (valor) {
  return String(valor || '').replace(/[\r\n]+/g, ' ').trim()
}

export function gerarQuadlet (instancia) {
  const imagem = instancia.transcricaoLocal?.instalada
    ? 'localhost/lcnwhatsapp:whisper'
    : 'localhost/lcnwhatsapp:latest'
  const argsRecursos = []
  if (instancia.resources?.memory != null) argsRecursos.push(`--memory=${instancia.resources.memory}`)
  if (instancia.resources?.cpus != null) argsRecursos.push(`--cpus=${instancia.resources.cpus}`)

  const linhas = [
    '[Unit]',
    `Description=LCNWhatsApp instance ${instancia.instanceId} (${descricaoSegura(instancia.label)})`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Container]',
    `Image=${imagem}`,
    `ContainerName=${instancia.containerName}`,
    'Exec=/app/bin/lock-and-run.sh /app/data/instance.lock node index.js',
    'Environment=LCN_SUPERVISED=systemd',
    `Environment=LCN_INSTANCE_ID=${instancia.instanceId}`,
    `Volume=${instancia.dataDir}/sessao:/app/sessao`,
    `Volume=${instancia.dataDir}/midia:/app/midia`,
    `Volume=${instancia.dataDir}/data:/app/data`,
    `Volume=${instancia.dataDir}/config.json:/app/config.json`
  ]

  if (instancia.transcricaoLocal?.instalada) {
    linhas.push(`Volume=${PASTA_MODELOS_COMPARTILHADA}:/opt/lcn-modelos:ro`)
  }
  if (argsRecursos.length) linhas.push(`PodmanArgs=${argsRecursos.join(' ')}`)

  linhas.push(
    '',
    '[Service]',
    'Restart=on-failure',
    'RestartSec=5',
    'StartLimitIntervalSec=600',
    'StartLimitBurst=8',
    `RestartPreventExitStatus=${CODIGOS_TERMINAIS.join(' ')}`,
    'TimeoutStopSec=30',
    '',
    '[Install]',
    'WantedBy=default.target'
  )

  return linhas.join('\n') + '\n'
}
