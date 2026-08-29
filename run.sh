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

set -- run -d \
  --name "$NOME" \
  --restart unless-stopped \
  -it \
  --memory 512m --cpus 1.0 \
  -v "$(pwd)/sessao:/app/sessao" \
  -v "$(pwd)/midia:/app/midia" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.json:/app/config.json"

# Provedor "codex" da transcrição: só monta se o Codex CLI já estiver
# instalado e logado no host (evita criar diretório vazio no lugar de
# auth.json quando ninguém usa esse provedor). CODEX_NPM_DIR/CODEX_HOME
# sobrepõem os caminhos padrão se o Codex estiver em outro lugar.
CODEX_NPM_DIR=${CODEX_NPM_DIR:-/usr/local/lib/node_modules/@openai/codex}
CODEX_HOME_DIR=${CODEX_HOME:-$HOME/.codex}
if [ -d "$CODEX_NPM_DIR" ] && [ -f "$CODEX_HOME_DIR/auth.json" ]; then
  echo ">> Codex CLI achado no host — montando pro provedor 'codex' da transcrição"
  set -- "$@" \
    -v "$CODEX_NPM_DIR:/usr/local/lib/node_modules/@openai/codex:ro" \
    -v "$CODEX_HOME_DIR/auth.json:/root/.codex/auth.json:ro"
else
  echo ">> Codex CLI não encontrado no host — provedor 'codex' da transcrição ficará indisponível no container."
  echo "   Pra usar: instale (npm install -g @openai/codex), faça 'codex login' no host e rode este script de novo."
  echo "   (ou ajuste CODEX_NPM_DIR/CODEX_HOME se o Codex estiver em outro caminho)"
fi

set -- "$@" lcnwhatsapp:latest
"$ENGINE" "$@"

echo ">> pronto. Login (QR/código):  $ENGINE logs -f $NOME"
echo ">> painel:  lcn"
