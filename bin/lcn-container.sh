#!/usr/bin/env bash
# Sobe os TRÊS processos do LCNWhatsApp dentro de um container só.
#
# Por que num container só: eles não são três serviços independentes, são um
# sistema. O gateway fala com o motor por um socket Unix em
# $HOME/.local/share/lcnwhatsapp/engine/run/engine.sock, e o painel fala com os
# dois. Separar em containers exigiria compartilhar esse caminho entre eles —
# mais peças móveis para nenhum ganho, já que os três sobem e caem juntos.
#
# Fora do container a forma prevista é `lcn engine install` (unidade systemd de
# usuário). Isso exige sessão persistente (`loginctl enable-linger`), que nem
# toda máquina permite sem root — daí este caminho.
#
# ORDEM IMPORTA: o motor primeiro. Um gateway sem motor recebe mensagem e não
# decide nada; responde a tudo com "motor não está rodando" no log e fica mudo
# no WhatsApp.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PASTA_ENGINE="${HOME}/.local/share/lcnwhatsapp/engine"
SOCKET="${PASTA_ENGINE}/run/engine.sock"
mkdir -p "${PASTA_ENGINE}/run"

# Segurável por ambiente: quem estiver depurando não quer esperar um minuto
# a cada tentativa.
ESPERA_APOS_FALHA="${LCN_ESPERA_APOS_FALHA:-60}"

log () { echo "[lcn] $*"; }

log "motor…"
node src/engine/server/index.js &
PID_MOTOR=$!

# Esperar o SOCKET, não um sleep fixo: em máquina lenta o motor demora mais, e
# um gateway que sobe antes perde as primeiras mensagens sem avisar.
for _ in $(seq 1 60); do
  [ -S "$SOCKET" ] && break
  kill -0 "$PID_MOTOR" 2>/dev/null || { log "o motor morreu ao subir"; exit 1; }
  sleep 0.5
done
if [ ! -S "$SOCKET" ]; then
  log "o motor não abriu o socket em 30s — abortando em vez de subir mudo"
  exit 1
fi
log "motor no ar"

# O painel é opcional para o funcionamento, mas é a única janela para ver
# Execuções — sem ele, diagnosticar é ler log cru.
# Mantém um processo de pé sem derrubar o resto.
#
# O motor é o NÚCLEO: sem ele o gateway recebe mensagem e não decide nada. O
# gateway e o painel são substituíveis — a falha de um não pode levar o motor
# junto.
#
# Isso custou caro: o gateway do número não pareado não conseguiu buscar a
# versão do WhatsApp Web ("failed to fetch sw.js") e, como qualquer saída
# derrubava o container, o MOTOR caiu junto. O outro número, que estava
# conectado e funcionando, parou de responder — e o painel, que é onde se
# diagnostica isso, sumiu no mesmo movimento.
manter_vivo () {
  local nome="$1"; shift
  local espera=5
  while true; do
    "$@"
    log "${nome} saiu (código $?) — subindo de novo em ${espera}s"
    sleep "${espera}"
    if [ "${espera}" -lt 60 ]; then espera=$(( espera * 2 )); fi
  done
}

log "painel…"
manter_vivo "painel" node src/web/runServer.js &
PID_PAINEL=$!

log "gateway…"
manter_vivo "gateway" sh bin/lock-and-run.sh data/instance.lock node index.js &
PID_GATEWAY=$!

encerrar () {
  log "encerrando…"
  kill "$PID_GATEWAY" "$PID_PAINEL" "$PID_MOTOR" 2>/dev/null
  wait 2>/dev/null
}
trap encerrar TERM INT

# Espera o MOTOR, e só ele. Gateway e painel se reerguem sozinhos; se o motor
# cai, não há sistema, e aí sim o container inteiro reinicia.
wait "${PID_MOTOR}"
CODIGO=$?
log "o motor saiu (código ${CODIGO}) — sem ele não há sistema, reiniciando tudo"
encerrar

if [ "${CODIGO}" -ne 0 ]; then
  log "esperando ${ESPERA_APOS_FALHA}s antes de sair — evita marretar o servidor num laço de reinício"
  sleep "${ESPERA_APOS_FALHA}"
fi
exit "${CODIGO}"
