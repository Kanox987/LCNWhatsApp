#!/usr/bin/env sh
# Instalador do LCNWhatsApp (Linux/macOS).
# 1) detecta engine de container (docker/podman/nerdctl)
# 2) pergunta: rodar em container ou "no seco" (nativo)
# 3) grava runtime.json, prepara o app e instala o comando `lcn` no PATH
set -e
cd "$(dirname "$0")"
RAIZ=$(pwd)

echo "==================================================="
echo "  LCNWhatsApp — instalador"
echo "==================================================="

# --- detecta engine de container ---
ENGINE=""
for e in docker podman nerdctl; do
  if command -v "$e" >/dev/null 2>&1; then ENGINE="$e"; break; fi
done

MODE="bare"
if [ -n "$ENGINE" ]; then
  echo "Encontrei um engine de container: $ENGINE"
  printf "Rodar o LCNWhatsApp em container (recomendado) ou no seco (nativo)? [C/s] "
  read resp
  case "$resp" in
    s|S|seco|Seco) MODE="bare" ;;
    *) MODE="docker" ;;
  esac
else
  echo "Nenhum engine de container encontrado (docker/podman/nerdctl)."
  printf "Quer instalar o Docker pra rodar isolado? Aqui só oriento; digite 's' se já vai instalar, ou Enter pra ir no seco. [s/N] "
  read resp
  case "$resp" in
    s|S)
      echo ">> Instale o Docker e rode este instalador de novo:"
      echo "   Linux:  curl -fsSL https://get.docker.com | sh"
      echo "   macOS:  baixe o Docker Desktop em https://www.docker.com/products/docker-desktop/"
      exit 0 ;;
    *) MODE="bare" ;;
  esac
fi

# --- grava runtime.json ---
node -e "require('fs').writeFileSync('runtime.json', JSON.stringify({mode:'$MODE',engine:'$ENGINE'||null},null,2)+'\n')" 2>/dev/null \
  || printf '{\n  "mode": "%s",\n  "engine": "%s"\n}\n' "$MODE" "$ENGINE" > runtime.json
echo ">> runtime.json: modo=$MODE engine=${ENGINE:-nenhum}"

# --- config inicial ---
[ -f config.json ] || cp config.example.json config.json
mkdir -p sessao midia data

if [ "$MODE" = "docker" ]; then
  echo ">> subindo em container..."
  sh run.sh Dockerfile
  echo ">> login: $ENGINE logs -f LCNWhatsApp"
else
  echo ">> instalando dependências (npm install)..."
  npm install --no-audit --no-fund
  echo ">> (opcional) transcrição local faster-whisper:"
  printf "   Preparar venv Python com faster-whisper agora? [s/N] "
  read w
  case "$w" in
    s|S)
      python3 -m venv .venv && ./.venv/bin/pip install --upgrade pip faster-whisper \
        && echo "LCN_PYTHON=$(pwd)/.venv/bin/python" \
        && echo ">> configure o provedor 'faster-whisper' no painel (lcn > Configurações > Transcrição)." ;;
    *) echo ">> pulei o venv (pode preparar depois)." ;;
  esac
  echo ">> rode o bot com:  npm start   (ou 'npm run code' pra login por código)"
fi

# --- instala o comando `lcn` no PATH ---
chmod +x bin/lcn 2>/dev/null || true
TARGET=""
for d in "$HOME/.local/bin" /usr/local/bin; do
  if [ -d "$d" ] && printf '%s' "$PATH" | grep -q "$d"; then TARGET="$d"; break; fi
done
if [ -z "$TARGET" ]; then
  mkdir -p "$HOME/.local/bin"; TARGET="$HOME/.local/bin"
  echo ">> Adicione ao PATH:  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
ln -sf "$RAIZ/bin/lcn" "$TARGET/lcn"
echo ">> comando instalado: $TARGET/lcn  (rode: lcn)"
echo "==================================================="
echo "  Pronto! Abra o painel com:  lcn"
echo "==================================================="
