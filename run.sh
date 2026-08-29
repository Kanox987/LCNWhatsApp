#!/usr/bin/env sh
# Build + run do container do LCNWhatsApp SEM depender de "docker compose"
# (útil no Podman). Usa o engine gravado em runtime.json, ou docker/podman.
set -e
cd "$(dirname "$0")"

ENGINE=$(node -e "try{console.log(require('./runtime.json').engine||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
[ -z "$ENGINE" ] && { command -v docker >/dev/null 2>&1 && ENGINE=docker || ENGINE=podman; }

DOCKERFILE=${1:-Dockerfile}   # passe Dockerfile.whisper p/ transcrição local
NOME=LCNWhatsApp

# garante config e pastas locais pros binds
[ -f config.json ] || cp config.example.json config.json
mkdir -p sessao midia data

echo ">> build ($DOCKERFILE) com $ENGINE"
"$ENGINE" build -f "$DOCKERFILE" -t lcnwhatsapp:latest .

echo ">> (re)subindo container $NOME"
"$ENGINE" rm -f "$NOME" >/dev/null 2>&1 || true
"$ENGINE" run -d \
  --name "$NOME" \
  --restart unless-stopped \
  -it \
  --memory 512m --cpus 1.0 \
  -v "$(pwd)/sessao:/app/sessao" \
  -v "$(pwd)/midia:/app/midia" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.json:/app/config.json" \
  lcnwhatsapp:latest

echo ">> pronto. Login (QR/código):  $ENGINE logs -f $NOME"
echo ">> painel:  lcn"
