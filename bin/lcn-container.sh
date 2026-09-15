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
log "painel…"
node src/web/runServer.js &
PID_PAINEL=$!

# O gateway em primeiro plano seria o normal, mas então a morte do motor
# passaria despercebida. Com todos em segundo plano e `wait -n`, a saída de
# QUALQUER um derruba o container — e o `restart: unless-stopped` sobe os três
# de novo, juntos e na ordem certa.
log "gateway…"
sh bin/lock-and-run.sh data/instance.lock node index.js &
PID_GATEWAY=$!

encerrar () {
  log "encerrando…"
  kill "$PID_GATEWAY" "$PID_PAINEL" "$PID_MOTOR" 2>/dev/null
  wait
}
trap encerrar TERM INT

wait -n
CODIGO=$?
log "um dos processos saiu (código ${CODIGO}) — derrubando o resto para reiniciar inteiro"
encerrar
exit "${CODIGO}"
