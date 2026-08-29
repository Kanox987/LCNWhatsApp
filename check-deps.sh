#!/usr/bin/env sh
# Diagnóstico de dependências/ambiente do LCNWhatsApp (Linux/macOS).
# Não instala nem altera dependências. Exit 0 = sem falhas críticas; exit 1 = falha.
set -u

cd "$(dirname "$0")" || exit 1

PASS=0
WARN=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  [OK]    %s\n' "$*"; }
warn() { WARN=$((WARN + 1)); printf '  [AVISO] %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  [ERRO]  %s\n' "$*"; }

field_json() {
  file=$1
  key=$2
  [ -r "$file" ] || return 1
  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$file" 2>/dev/null | head -n1
}

node_major() {
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

check_path_command() {
  name=$1
  if command -v "$name" >/dev/null 2>&1; then
    ok "$name no PATH: $(command -v "$name")"
  else
    warn "$name não está no PATH desta sessão."
  fi
}

printf '%s\n' \
  '===================================================' \
  '  LCNWhatsApp — verificação de dependências' \
  '==================================================='

printf '\nProjeto\n'
for f in package.json config.example.json index.js; do
  if [ -f "$f" ]; then ok "$f encontrado"; else fail "$f não encontrado"; fi
done

if [ -f config.json ]; then
  ok 'config.json encontrado'
else
  warn 'config.json não existe ainda (rode o instalador para criar).'
fi

MODE=""
ENGINE=""
if [ -f runtime.json ]; then
  MODE=$(field_json runtime.json mode || true)
  ENGINE=$(field_json runtime.json engine || true)
  [ -n "$MODE" ] && ok "runtime.json: modo=$MODE" || warn 'runtime.json existe, mas não consegui ler o modo.'
else
  warn 'runtime.json não existe; vou verificar o que estiver disponível no host.'
fi

printf '\nComando lcn\n'
check_path_command lcn

if [ -n "$MODE" ] && [ "$MODE" = "docker" ]; then
  printf '\nModo container\n'
  if [ -z "$ENGINE" ]; then
    for e in docker podman nerdctl; do
      if command -v "$e" >/dev/null 2>&1; then ENGINE=$e; break; fi
    done
  fi

  if [ -z "$ENGINE" ]; then
    fail 'nenhum engine de container configurado/encontrado (docker/podman/nerdctl).'
  elif ! command -v "$ENGINE" >/dev/null 2>&1; then
    fail "engine configurado '$ENGINE' não está no PATH."
  else
    ok "engine encontrado: $ENGINE ($(command -v "$ENGINE"))"
    if "$ENGINE" info >/dev/null 2>&1; then
      ok "$ENGINE está acessível e respondendo"
    else
      fail "$ENGINE existe, mas o daemon/serviço não respondeu (ou falta permissão)."
    fi

    if "$ENGINE" ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'LCNWhatsApp'; then
      ok 'container LCNWhatsApp existe'
      if "$ENGINE" ps --format '{{.Names}}' 2>/dev/null | grep -qx 'LCNWhatsApp'; then
        ok 'container LCNWhatsApp está rodando'
        if "$ENGINE" exec LCNWhatsApp node --version >/dev/null 2>&1; then
          CV=$($ENGINE exec LCNWhatsApp node --version 2>/dev/null | tr -d '\r' | head -n1)
          ok "Node dentro do container: $CV"
        else
          fail 'Node não respondeu dentro do container.'
        fi
      else
        warn 'container LCNWhatsApp existe, mas está parado.'
      fi
    else
      warn 'container LCNWhatsApp ainda não existe (rode run.sh/install.sh no modo container).'
    fi
  fi
else
  printf '\nModo nativo / host\n'
  if command -v node >/dev/null 2>&1; then
    NV=$(node --version 2>/dev/null || echo '?')
    NM=$(node_major || echo '')
    case "$NM" in
      ''|*[!0-9]*) fail "Node respondeu versão inválida: $NV" ;;
      *)
        if [ "$NM" -ge 22 ]; then ok "Node.js $NV (mínimo 22)"; else fail "Node.js $NV é antigo; necessário 22+ (24 LTS recomendado)."; fi
        ;;
    esac
  else
    fail 'Node.js não encontrado no PATH.'
  fi

  if command -v npm >/dev/null 2>&1; then
    NPMV=$(npm --version 2>/dev/null || echo '?')
    ok "npm $NPMV"
  else
    fail 'npm não encontrado no PATH.'
  fi

  if command -v node >/dev/null 2>&1 && [ -f package.json ]; then
    if node -e "for (const p of ['@hapi/boom','@whiskeysockets/baileys','pino','qrcode-terminal']) require.resolve(p)" >/dev/null 2>&1; then
      ok 'dependências npm principais resolvem corretamente'
    else
      fail 'dependências npm incompletas; rode: npm install'
    fi
  fi
fi

printf '\nDiretórios e permissões\n'
for d in sessao midia data; do
  if [ ! -d "$d" ]; then
    warn "$d/ não existe ainda."
  elif [ -w "$d" ]; then
    ok "$d/ existe e é gravável"
  else
    fail "$d/ existe, mas não é gravável pelo usuário atual"
  fi
done
if [ -f config.json ]; then
  if [ -w config.json ]; then ok 'config.json é gravável'; else fail 'config.json não é gravável pelo usuário atual'; fi
fi

printf '\nTranscrição (quando configurada)\n'
PROVIDER="off"
PYBIN=""
if [ -f config.json ]; then
  PROVIDER=$(field_json config.json provedor || true)
  [ -n "$PROVIDER" ] || PROVIDER=off
  PYBIN=$(field_json config.json pythonBin || true)
fi
case "$PROVIDER" in
  off|'') ok 'transcrição desativada; sem dependência extra obrigatória' ;;
  faster-whisper)
    if [ -n "$PYBIN" ] && [ -x "$PYBIN" ]; then
      if "$PYBIN" -c 'import faster_whisper' >/dev/null 2>&1; then ok "faster-whisper disponível em $PYBIN"; else fail "Python configurado em $PYBIN, mas faster_whisper não importa."; fi
    elif command -v python3 >/dev/null 2>&1 && python3 -c 'import faster_whisper' >/dev/null 2>&1; then
      ok "faster-whisper disponível via $(command -v python3)"
    else
      fail 'provedor faster-whisper ativo, mas Python/faster_whisper não está funcional.'
    fi
    ;;
  openai)
    KEY=$(field_json config.json openaiApiKey || true)
    [ -n "$KEY" ] && ok 'OpenAI API key configurada (valor oculto)' || fail 'provedor openai ativo, mas openaiApiKey está vazia.'
    ;;
  comando)
    CMD=$(field_json config.json comando || true)
    [ -n "$CMD" ] && ok 'comando externo de transcrição configurado' || fail 'provedor comando ativo, mas o comando está vazio.'
    ;;
  *) warn "provedor de transcrição desconhecido: $PROVIDER" ;;
esac

printf '\nResumo\n'
printf '  OK: %s | Avisos: %s | Erros: %s\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '%s\n' '  Ambiente com falha(s) crítica(s). Corrija os itens [ERRO] acima.'
  exit 1
fi
printf '%s\n' '  Ambiente sem falhas críticas.'
exit 0
