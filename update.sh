#!/usr/bin/env sh
# Atualiza o LCNWhatsApp: código (git) + Baileys, e reinicia no modo certo.
set -e
cd "$(dirname "$0")"

MODE=$(node -e "try{console.log(require('./runtime.json').mode||'bare')}catch(e){console.log('bare')}" 2>/dev/null || echo bare)
ENGINE=$(node -e "try{console.log(require('./runtime.json').engine||'')}catch(e){console.log('')}" 2>/dev/null || echo "")

if [ -d .git ]; then
  echo ">> git pull"
  git pull --ff-only || echo "(git pull pulado/conflito — resolva manualmente)"
fi

rm -f data/precisa-update.flag 2>/dev/null || true

if [ "$MODE" = "docker" ]; then
  ENGINE=${ENGINE:-docker}
  if command -v node >/dev/null 2>&1; then
    UPDATE=1
    . ./perfil-container.sh
    configurar_perfil_container
  fi
  echo ">> rebuild da imagem (reinstala Baileys do GitHub, isolada)"
  sh run.sh
  echo ">> atualizado e reiniciado (container)."
else
  echo ">> npm install (reinstala Baileys do GitHub)"
  npm install --no-audit --no-fund
  if command -v pm2 >/dev/null 2>&1; then
    pm2 restart LCNWhatsApp 2>/dev/null || pm2 start ecosystem.config.cjs
    echo ">> reiniciado via PM2."
  else
    echo ">> atualizado. Reinicie o bot (npm start) se estiver rodando."
  fi
fi
