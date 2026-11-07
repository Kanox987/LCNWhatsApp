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

NOME=LCNWhatsApp

# garante config e pastas locais pros binds
[ -f config.json ] || cp config.example.json config.json
mkdir -p sessao midia data modelos estado

# --profile <arquivo>: perfil de provisionamento (o que a instância já nasce
# tendo). Monta a PASTA do arquivo, somente leitura, e passa só o caminho por
# variável de ambiente. Montar o arquivo direto faria o Docker criar um
# diretório com esse nome se ele não existisse.
PERFIL=""
if [ "${1:-}" = "--profile" ]; then
  PERFIL="${2:-}"
  if [ -z "$PERFIL" ] || [ ! -f "$PERFIL" ]; then
    echo "--profile precisa de um arquivo que exista (recebi: '${PERFIL}')."
    exit 1
  fi
  shift 2
fi

# Lê runtime.json (Dockerfile, --memory/--cpus, mount de ./modelos) via o
# helper Node — shell não tem parser JSON confiável, e o projeto já assume
# Node no fluxo docker. 1ª linha = Dockerfile; resto = args extras pro run.
DOCKER_ARGS_TMP=$(mktemp "${TMPDIR:-/tmp}/lcn-docker-args.XXXXXX")
node src/runtime.js docker-args > "$DOCKER_ARGS_TMP" 2>/dev/null || true
DOCKERFILE_AUTO=$(head -n1 "$DOCKER_ARGS_TMP")
DOCKERFILE=${1:-$DOCKERFILE_AUTO}   # passar um Dockerfile explícito ainda funciona (override manual)
[ -n "$DOCKERFILE" ] || DOCKERFILE=Dockerfile

IMAGE_TAG=$(LCN_CONTAINER_ENGINE="$ENGINE" ./build-image.sh --print-tag "$DOCKERFILE")
LCN_CONTAINER_ENGINE="$ENGINE" ./build-image.sh "$DOCKERFILE"

# Transcrição local: pré-baixa/valida o modelo num container descartável
# ANTES de subir o bot de verdade — assim rebuild/update reaproveita
# ./modelos e o 1º áudio real não fica lento esperando o download.
if [ "$DOCKERFILE" = "Dockerfile.whisper" ]; then
  MODELO=$(node src/runtime.js modelo)
  echo ">> preparando modelo faster-whisper '$MODELO' em ./modelos (só baixa se ainda não tiver)..."
  "$ENGINE" run --rm -v "$(pwd)/modelos:/opt/lcn-modelos" "$IMAGE_TAG" \
    /opt/whisper/bin/python /app/src/transcription/preload.py "$MODELO" \
    || echo ">> aviso: não consegui preparar o modelo agora — a 1ª transcrição real tenta de novo (pode demorar)."
fi

# Antes de recriar o container: versões antigas gravavam o banco do motor
# (automações publicadas, listas, donos) DENTRO dele, em /root, onde nenhum
# volume alcançava — recriar apagava tudo. Se ./estado ainda está vazio e o
# container antigo existe, resgata o que houver antes do `rm -f`. Parado antes
# de copiar, para o SQLite não ser copiado no meio de uma escrita.
if [ -z "$(ls -A estado 2>/dev/null)" ] && "$ENGINE" inspect "$NOME" >/dev/null 2>&1; then
  echo ">> resgatando o estado do motor do container anterior para ./estado ..."
  "$ENGINE" stop -t 20 "$NOME" >/dev/null 2>&1 || true
  for ORIGEM in /home/node/.local/share/lcnwhatsapp /root/.local/share/lcnwhatsapp; do
    if "$ENGINE" cp "$NOME:$ORIGEM/." estado/ >/dev/null 2>&1 && [ -n "$(ls -A estado 2>/dev/null)" ]; then
      echo ">> estado resgatado de $ORIGEM"
      break
    fi
  done
fi

echo ">> (re)subindo container $NOME"
"$ENGINE" rm -f "$NOME" >/dev/null 2>&1 || true

set -- run -d \
  --name "$NOME" \
  --restart unless-stopped \
  -it

# args de recurso (--memory/--cpus, se definidos) e mount de ./modelos (se a
# transcrição local estiver instalada) — linhas 2+ do arquivo temporário.
# Brace group (não subshell) pra `set --` valer no shell principal.
{
  read -r _dockerfile_ja_usado
  while IFS= read -r linha; do
    set -- "$@" "$linha"
  done
} < "$DOCKER_ARGS_TMP"
rm -f "$DOCKER_ARGS_TMP"

set -- "$@" \
  -v "$(pwd)/sessao:/app/sessao" \
  -v "$(pwd)/midia:/app/midia" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config.json:/app/config.json" \
  -v "$(pwd)/estado:/home/node/.local/share/lcnwhatsapp"

# Teto do administrador (concessões). Só vai se estiver definido no ambiente de
# quem roda o run.sh: vazio = nenhuma concessão, a instância fica com os padrões.
if [ -n "${LCN_CONCESSOES:-}" ]; then
  set -- "$@" -e "LCN_CONCESSOES=$LCN_CONCESSOES"
fi

if [ -n "$PERFIL" ]; then
  PASTA_DO_PERFIL=$(cd "$(dirname "$PERFIL")" && pwd)
  set -- "$@" \
    -v "${PASTA_DO_PERFIL}:/run/lcn/provisioning:ro" \
    -e "LCN_PROVISION_PROFILE=/run/lcn/provisioning/$(basename "$PERFIL")"
fi

set -- "$@" "$IMAGE_TAG"
"$ENGINE" "$@"

echo ">> pronto. Login (QR/código):  $ENGINE logs -f $NOME"
echo ">> painel:  lcn"
