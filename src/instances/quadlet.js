import {
  EXIT_LOGOUT_REPAIR_NEEDED,
  EXIT_CONFLICT,
  EXIT_FATAL_ACCOUNT,
  EXIT_QUARANTINED
} from '../exitCodes.js'
import { PASTA_MODELOS_COMPARTILHADA } from './paths.js'
import { CHAVE_DE_AMBIENTE, serializarConcessoes } from '../agent/concessoes.js'
import { PASTA_RUN as PASTA_RUN_ENGINE } from '../engine/paths.js'

const CODIGOS_TERMINAIS = [
  EXIT_LOGOUT_REPAIR_NEEDED,
  EXIT_CONFLICT,
  EXIT_FATAL_ACCOUNT,
  EXIT_QUARANTINED
]

function descricaoSegura (valor) {
  return String(valor || '').replace(/[\r\n]+/g, ' ').trim()
}

// `concessoes` é o teto que o administrador deu a esta instância. Ele entra
// pelo AMBIENTE porque `registry.json` NÃO é montado no container (ver os
// Volume= abaixo): a instância não pode ler nem reescrever o próprio teto, e
// quem escreve a unit é o lado do administrador, no host.
export function gerarQuadlet (instancia, concessoes = {}) {
  const imagem = instancia.transcricaoLocal?.instalada
    ? 'localhost/lcnwhatsapp:whisper'
    : 'localhost/lcnwhatsapp:latest'
  const concessaoSerializada = serializarConcessoes(concessoes)
  const argsRecursos = []
  if (instancia.resources?.memory != null) argsRecursos.push(`--memory=${instancia.resources.memory}`)
  if (instancia.resources?.cpus != null) argsRecursos.push(`--cpus=${instancia.resources.cpus}`)

  const linhas = [
    '[Unit]',
    `Description=LCNWhatsApp instance ${instancia.instanceId} (${descricaoSegura(instancia.label)})`,
    'After=network-online.target',
    'Wants=network-online.target',
    // StartLimitIntervalSec/StartLimitBurst são diretivas de [Unit], não de
    // [Service] (systemd.unit(5)) — achado real de revisão de segurança:
    // estavam sob [Service] abaixo, onde o systemd as ignora silenciosamente
    // ("chave desconhecida"), fazendo o limite de 8 tentativas/600s nunca
    // ser aplicado de verdade contra reinícios em loop.
    'StartLimitIntervalSec=600',
    'StartLimitBurst=8',
    '',
    '[Container]',
    `Image=${imagem}`,
    `ContainerName=${instancia.containerName}`,
    'Exec=/app/bin/lock-and-run.sh /app/data/instance.lock node index.js',
    'Environment=LCN_SUPERVISED=systemd',
    `Environment=LCN_INSTANCE_ID=${instancia.instanceId}`,
    'Environment=LCN_ENGINE_SOCKET=/run/lcn-engine/engine.sock',
    // Sem concessão a linha não sai: instância sem teto recebe o ambiente de
    // antes desta camada, igual ao que já acontecia.
    // Aspas simples: o JSON carrega aspas duplas, e o systemd as interpretaria
    // como quoting. Entre aspas simples a aspa dupla é literal. Nenhum valor
    // aceito por `validarConcessao` contém aspa simples (números, booleano e
    // lista fechada), então não há como fechar a citação por dentro.
    ...(concessaoSerializada ? [`Environment=${CHAVE_DE_AMBIENTE}='${concessaoSerializada}'`] : []),
    `Volume=${instancia.dataDir}/sessao:/app/sessao`,
    `Volume=${instancia.dataDir}/midia:/app/midia`,
    `Volume=${instancia.dataDir}/data:/app/data`,
    `Volume=${instancia.dataDir}/config.json:/app/config.json`,
    `Volume=${PASTA_RUN_ENGINE}:/run/lcn-engine`
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
    `RestartPreventExitStatus=${CODIGOS_TERMINAIS.join(' ')}`,
    'TimeoutStopSec=30',
    '',
    '[Install]',
    'WantedBy=default.target'
  )

  return linhas.join('\n') + '\n'
}
