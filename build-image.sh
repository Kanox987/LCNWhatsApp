#!/usr/bin/env sh
# Build canônico das imagens usadas tanto pelo fluxo single-instance quanto
# pelas units Quadlet. O engine vem do chamador; a CLI multi-instância usa
# Podman e run.sh preserva o engine configurado no runtime.json.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

IMPRIMIR_TAG=false
if [ "${1:-}" = "--print-tag" ]; then
  IMPRIMIR_TAG=true
  shift
fi

DOCKERFILE=${1:-Dockerfile}
case "$DOCKERFILE" in
  Dockerfile) TAG=localhost/lcnwhatsapp:latest ;;
  Dockerfile.whisper) TAG=localhost/lcnwhatsapp:whisper ;;
  *)
    echo "Dockerfile não suportado: $DOCKERFILE (use Dockerfile ou Dockerfile.whisper)" >&2
    exit 2
    ;;
esac

if [ "$IMPRIMIR_TAG" = true ]; then
  printf '%s\n' "$TAG"
  exit 0
fi

ENGINE=${LCN_CONTAINER_ENGINE:-podman}
if ! command -v "$ENGINE" >/dev/null 2>&1; then
  echo "Engine de container não encontrado: $ENGINE" >&2
  exit 1
fi

echo ">> build ($DOCKERFILE) com $ENGINE -> $TAG"
exec "$ENGINE" build -f "$DOCKERFILE" -t "$TAG" .
