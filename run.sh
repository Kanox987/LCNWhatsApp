#!/usr/bin/env sh
# Build + run do container do LCNWhatsApp SEM depender de "docker compose"
# (útil no Podman). Usa o engine gravado em runtime.json, ou docker/podman.
set -e
cd "$(dirname "$0")"

# Ordem: engine já gravado em runtime.json -> detecta de verdade (nunca
# assume podman sem checar) -> se nenhum existir, tenta instalar Docker.
ENGINE=$(node -e "try{console.log(require('./runtime.json').engine||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
if [ -z "$ENGINE" ]; then
  for e in docker podman nerdctl; do
    if command -v "$e" >/dev/null 2>&1; then ENGINE="$e"; break; fi
  done
fi
if [ -z "$ENGINE" ]; then
  echo "Nenhum engine de container encontrado (docker/podman/nerdctl)."
  echo ">> tentando instalar o Docker..."
  curl -fsSL https://get.docker.com | sh || true
  for e in docker podman nerdctl; do
    if command -v "$e" >/dev/null 2>&1; then ENGINE="$e"; break; fi
  done
  if [ -z "$ENGINE" ]; then
    echo ">> Não consegui instalar/encontrar um engine de container. Instale manualmente e rode de novo:"
    echo "   Linux:  curl -fsSL https://get.docker.com | sh"
    echo "   macOS:  baixe o Docker Desktop em https://www.docker.com/products/docker-desktop/"
    exit 1
  fi
fi

DOCKERFILE=${1:-Dockerfile}   # passe Dockerfile.whisper p/ transcrição local
NOME=LCNWhatsApp

# garante config e pastas locais pros binds
[ -f config.json ] || cp config.example.json config.json
mkdir -p sessao midia data

echo ">> build ($DOCKERFILE) com $ENGINE"
"$ENGINE" build -f "$DOCKERFILE" -t lcnwhatsapp:latest .

echo ">> (re)subindo container $NOME"
"$ENGINE" rm -f "$NOME" >/dev/null 2>&1 || true

set -- run -d \
  --name "$NOME" \
  --restart unless-stopped \
  -it \
  --memory 512m --cpus 1.0 \
  -v "$(pwd)/sessao:/app/sessao" \
  -v "$(pwd)/midia:/app/midia" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.json:/app/config.json"

set -- "$@" lcnwhatsapp:latest
"$ENGINE" "$@"

echo ">> pronto. Login (QR/código):  $ENGINE logs -f $NOME"
echo ">> painel:  lcn"
