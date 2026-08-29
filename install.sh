#!/usr/bin/env sh
# Instalador do LCNWhatsApp (Linux/macOS).
# 1) detecta engine de container (docker/podman/nerdctl)
# 2) pergunta: rodar em container ou "no seco" (nativo)
# 3) grava runtime.json, prepara o app e instala o comando `lcn` no PATH
set -e
cd "$(dirname "$0")"
RAIZ=$(pwd)

MIN_NODE_MAJOR=22
TARGET_NODE_MAJOR=24

# Nunca rodar via sudo de um usuário normal — cria runtime.json, config.json,
# sessao/, midia/, data/, node_modules e o venv do faster-whisper com dono
# root à toa. Só operações pontuais do sistema usam sudo/doas.
if [ "$(id -u)" = "0" ] && [ -n "$SUDO_USER" ]; then
  echo "Não rode este instalador com sudo — ele não precisa, e isso deixaria"
  echo "config.json, sessao/, midia/, data/ e node_modules com dono root."
  echo "Rode como usuário normal:  sh install.sh"
  exit 1
fi

info() { printf '%s\n' ">> $*"; }
warn() { printf '%s\n' ">> AVISO: $*" >&2; }

as_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  elif command -v doas >/dev/null 2>&1; then
    doas "$@"
  else
    warn "esta operação precisa de privilégio administrativo e não encontrei sudo/doas."
    return 126
  fi
}

user_profile() {
  case "${SHELL##*/}" in
    zsh) printf '%s\n' "$HOME/.zshrc" ;;
    bash) printf '%s\n' "$HOME/.bashrc" ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

node_major() {
  command -v node >/dev/null 2>&1 || return 1
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

node_runtime_ok() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  major=$(node_major) || return 1
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

detect_platform() {
  PLATFORM=$(uname -s 2>/dev/null || echo unknown)
  DISTRO_ID=unknown
  DISTRO_LIKE=""
  DISTRO_VERSION=""
  if [ "$PLATFORM" = "Linux" ] && [ -r /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID=${ID:-unknown}
    DISTRO_LIKE=${ID_LIKE:-}
    DISTRO_VERSION=${VERSION_ID:-}
  fi
}

download_file() {
  url=$1
  dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 2 --connect-timeout 15 "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$dest" "$url"
  else
    return 127
  fi
}

install_node_debian() {
  printf "Node.js adequado não foi encontrado. Para usar Node.js %s LTS, o instalador pode adicionar o repositório NodeSource ao sistema. Continuar? [S/n] " "$TARGET_NODE_MAJOR"
  read ns
  case "$ns" in n|N|nao|não|Nao|Não) return 1 ;; esac

  info "Preparando Node.js $TARGET_NODE_MAJOR LTS via NodeSource..."
  as_root apt-get update || return 1
  as_root apt-get install -y ca-certificates curl bash || return 1
  setup=$(mktemp "${TMPDIR:-/tmp}/lcn-nodesource.XXXXXX") || return 1
  if ! download_file "https://deb.nodesource.com/setup_${TARGET_NODE_MAJOR}.x" "$setup"; then
    rm -f "$setup"
    return 1
  fi
  if ! as_root bash "$setup"; then
    rm -f "$setup"
    return 1
  fi
  rm -f "$setup"
  as_root apt-get install -y nodejs
}

install_node_fedora() {
  info "Tentando Node.js $TARGET_NODE_MAJOR LTS pelos repositórios Fedora..."
  as_root dnf install -y nodejs24-bin nodejs24-npm-bin || as_root dnf install -y nodejs npm
}

install_node_rhel() {
  info "Tentando Node.js LTS pelos repositórios da família RHEL/CentOS..."
  as_root dnf install -y nodejs24 || as_root dnf module install -y nodejs:22 || as_root dnf install -y nodejs npm
}

install_node_arch() {
  info "Instalando Node.js 24 LTS e npm via pacman..."
  as_root pacman -S --needed --noconfirm nodejs-lts-krypton npm
}

install_node_opensuse() {
  info "Tentando Node.js 24 LTS via zypper..."
  as_root zypper --non-interactive install nodejs24 npm24
}

install_node_alpine() {
  info "Instalando Node.js e npm via apk..."
  as_root apk add --no-cache nodejs npm
}

install_node_amazon() {
  info "Instalando Node.js 24 LTS no Amazon Linux..."
  as_root dnf install -y nodejs24 nodejs24-npm || return 1
  if command -v alternatives >/dev/null 2>&1 && [ -x /usr/bin/node-24 ]; then
    as_root alternatives --set node /usr/bin/node-24 >/dev/null 2>&1 || true
  fi
}

install_node_macos() {
  command -v brew >/dev/null 2>&1 || return 1
  info "Instalando Node.js 24 LTS via Homebrew..."
  brew install node@24 || return 1
  prefix=$(brew --prefix node@24 2>/dev/null) || return 1
  PATH="$prefix/bin:$PATH"
  export PATH

  profile=$(user_profile)
  line="export PATH=\"$prefix/bin:\$PATH\""
  touch "$profile"
  grep -F "$prefix/bin" "$profile" >/dev/null 2>&1 || printf '\n%s\n' "$line" >> "$profile"
}

install_node_system() {
  detect_platform
  if [ "$PLATFORM" = "Darwin" ]; then
    install_node_macos
    return $?
  fi

  case "$DISTRO_ID" in
    debian|ubuntu|linuxmint|pop) install_node_debian ;;
    fedora) install_node_fedora ;;
    rhel|centos|rocky|almalinux|ol) install_node_rhel ;;
    arch|manjaro|endeavouros) install_node_arch ;;
    opensuse*|sles) install_node_opensuse ;;
    alpine) install_node_alpine ;;
    amzn) install_node_amazon ;;
    *)
      case " $DISTRO_LIKE " in
        *" debian "*) install_node_debian ;;
        *" rhel "*|*" fedora "*) install_node_rhel ;;
        *" arch "*) install_node_arch ;;
        *" suse "*) install_node_opensuse ;;
        *) return 1 ;;
      esac
      ;;
  esac
}

install_node_nvm() {
  [ "$(id -u)" != "0" ] || return 1
  command -v bash >/dev/null 2>&1 || return 1
  NVM_DIR=${NVM_DIR:-$HOME/.nvm}
  export NVM_DIR
  profile=$(user_profile)
  touch "$profile"
  installer=$(mktemp "${TMPDIR:-/tmp}/lcn-nvm.XXXXXX") || return 1
  if ! download_file "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh" "$installer"; then
    rm -f "$installer"
    return 1
  fi
  PROFILE="$profile" bash "$installer" || { rm -f "$installer"; return 1; }
  rm -f "$installer"
  [ -s "$NVM_DIR/nvm.sh" ] || return 1
  . "$NVM_DIR/nvm.sh"
  nvm install "$TARGET_NODE_MAJOR" || return 1
  nvm alias default "$TARGET_NODE_MAJOR" >/dev/null 2>&1 || true
  nvm use "$TARGET_NODE_MAJOR" >/dev/null || return 1
}

ensure_node_runtime() {
  if node_runtime_ok; then
    info "Node.js $(node --version) / npm $(npm --version) detectados."
    return 0
  fi

  info "Modo nativo requer Node.js $MIN_NODE_MAJOR+ e npm; recomendado: Node.js $TARGET_NODE_MAJOR LTS."
  if command -v node >/dev/null 2>&1; then info "Node atual: $(node --version 2>/dev/null || echo desconhecido)"; else info "Node atual: ausente"; fi
  if command -v npm >/dev/null 2>&1; then info "npm atual: $(npm --version 2>/dev/null || echo desconhecido)"; else info "npm atual: ausente"; fi

  install_node_system || true
  if ! node_runtime_ok; then
    warn "o runtime ainda não ficou compatível após a tentativa pelo sistema. Tentando nvm no usuário atual..."
    install_node_nvm || true
  fi

  if ! node_runtime_ok; then
    detect_platform
    printf '%s\n' \
      "" \
      "Não consegui preparar Node.js/npm automaticamente." \
      "Instale Node.js $TARGET_NODE_MAJOR LTS (ou $MIN_NODE_MAJOR+) e rode novamente:" \
      "  sh install.sh" \
      "" \
      "Diagnóstico: ${DISTRO_ID:-unknown} ${DISTRO_VERSION:-} / ${PLATFORM:-unknown}" \
      "Node: $(command -v node 2>/dev/null || echo ausente)" \
      "npm:  $(command -v npm 2>/dev/null || echo ausente)" >&2
    return 1
  fi

  info "Node.js $(node --version) / npm $(npm --version) prontos."
}

echo "==================================================="
echo "  LCNWhatsApp — instalador"
echo "==================================================="

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

[ -f config.json ] || cp config.example.json config.json
mkdir -p sessao midia data modelos

if [ "$MODE" = "docker" ]; then
  if command -v node >/dev/null 2>&1; then
    . "$RAIZ/perfil-container.sh"
    configurar_perfil_container
  else
    echo ">> Node não encontrado no host — usando perfil econômico padrão (512m/1 CPU,"
    echo "   sem transcrição local). Instale Node depois e rode 'node src/runtime.js save"
    echo "   ...' (ou o instalador de novo) pra escolher recursos/modelo."
    printf '{\n  "mode": "docker",\n  "engine": "%s"\n}\n' "$ENGINE" > runtime.json
  fi
  echo ">> runtime.json: modo=$MODE engine=${ENGINE:-nenhum}"
  echo ">> subindo em container..."
  sh run.sh
  echo ">> login: $ENGINE logs -f LCNWhatsApp"
else
  node -e "require('fs').writeFileSync('runtime.json', JSON.stringify({mode:'bare',engine:null},null,2)+'\n')" 2>/dev/null \
    || printf '{\n  "mode": "bare",\n  "engine": ""\n}\n' > runtime.json
  echo ">> runtime.json: modo=$MODE engine=${ENGINE:-nenhum}"
  ensure_node_runtime
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
          as_root apt-get update && as_root apt-get install -y python3 python3-venv python3-pip || true
        elif command -v dnf >/dev/null 2>&1; then
          as_root dnf install -y python3 python3-pip || true
        elif command -v pacman >/dev/null 2>&1; then
          as_root pacman -S --needed --noconfirm python python-pip || true
        elif command -v zypper >/dev/null 2>&1; then
          as_root zypper --non-interactive install python3 python3-pip || true
        elif command -v apk >/dev/null 2>&1; then
          as_root apk add --no-cache python3 py3-pip || true
        elif command -v brew >/dev/null 2>&1; then
          brew install python3 || true
        fi
      fi
      if ! command -v python3 >/dev/null 2>&1; then
        echo ">> Não consegui garantir o python3. Instale manualmente e prepare o venv depois."
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
      as_root ln -sf "$RAIZ/bin/lcn" /usr/local/bin/lcn
    fi
    echo ">> também instalado: /usr/local/bin/lcn" ;;
  *) : ;;
esac
echo "==================================================="
echo "  Pronto! Abra o painel com:  lcn"
echo "==================================================="
