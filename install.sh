#!/usr/bin/env sh
# Instalador do LCNWhatsApp (Linux/macOS).
# 1) detecta engine de container (docker/podman/nerdctl)
# 2) pergunta: rodar em container ou "no seco" (nativo)
# 3) grava runtime.json, prepara o app e instala o comando `lcn` no PATH
set -e
cd "$(dirname "$0")"
RAIZ=$(pwd)

# Nunca rodar via sudo de um usuário normal — cria runtime.json, config.json,
# sessao/, midia/, data/, node_modules e o venv do faster-whisper com dono
# root à toa (nenhum desses precisa de privilégio). Só a instalação opcional
# em /usr/local/bin pede sudo, à parte, mais abaixo. Root "de verdade" (sem
# sudo, ex.: sistema só-root) passa normal.
if [ "$(id -u)" = "0" ] && [ -n "$SUDO_USER" ]; then
  echo "Não rode este instalador com sudo — ele não precisa, e isso deixaria"
  echo "config.json, sessao/, midia/, data/ e node_modules com dono root."
  echo "Rode como usuário normal:  sh install.sh"
  exit 1
fi

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
      if ! command -v python3 >/dev/null 2>&1; then
        echo ">> python3 não encontrado — tentando instalar..."
        if command -v apt-get >/dev/null 2>&1; then
          sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip || true
        elif command -v dnf >/dev/null 2>&1; then
          sudo dnf install -y python3 python3-pip || true
        elif command -v pacman >/dev/null 2>&1; then
          sudo pacman -Sy --noconfirm python python-pip || true
        elif command -v brew >/dev/null 2>&1; then
          brew install python3 || true
        fi
      fi
      if ! command -v python3 >/dev/null 2>&1; then
        echo ">> Não consegui garantir o python3. Instale manualmente (ex.: sudo apt install python3 python3-venv python3-pip) e prepare o venv depois."
      elif python3 -m venv .venv && ./.venv/bin/pip install --upgrade pip faster-whisper; then
        PYBIN="$(pwd)/.venv/bin/python"
        node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('config.json','utf8'));c.transcricao=c.transcricao||{};c.transcricao.pythonBin='$PYBIN';fs.writeFileSync('config.json',JSON.stringify(c,null,2)+'\n')" 2>/dev/null \
          || echo ">> não consegui gravar 'transcricao.pythonBin' no config.json — configure manualmente."
        echo ">> configure o provedor 'faster-whisper' no painel (lcn > Configurações > Transcrição)."
      else
        echo ">> falha preparando o venv/faster-whisper — configure manualmente depois."
      fi ;;
    *) echo ">> pulei o venv (pode preparar depois)." ;;
  esac
  echo ">> rode o bot com:  npm start   (ou 'npm run code' pra login por código)"
fi

# --- instala o comando `lcn` no PATH (sempre na pasta do usuário, sem sudo) ---
chmod +x bin/lcn 2>/dev/null || true
mkdir -p "$HOME/.local/bin"
ln -sf "$RAIZ/bin/lcn" "$HOME/.local/bin/lcn"
echo ">> comando instalado: $HOME/.local/bin/lcn  (rode: lcn)"
if ! printf '%s' "$PATH" | grep -q "$HOME/.local/bin"; then
  echo ">> Adicione ao PATH (e no seu ~/.bashrc ou ~/.zshrc):  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

printf "Também instalar em /usr/local/bin (todos os usuários deste sistema)? Pode pedir sua senha. [s/N] "
read sysw
case "$sysw" in
  s|S)
    if [ "$(id -u)" = "0" ]; then
      ln -sf "$RAIZ/bin/lcn" /usr/local/bin/lcn
    else
      sudo ln -sf "$RAIZ/bin/lcn" /usr/local/bin/lcn
    fi
    echo ">> também instalado: /usr/local/bin/lcn" ;;
  *) : ;;
esac
echo "==================================================="
echo "  Pronto! Abra o painel com:  lcn"
echo "==================================================="
