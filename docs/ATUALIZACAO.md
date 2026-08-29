# Atualização (app + Baileys)

Rode `lcn` > Atualizar, ou direto:
```bash
sh update.sh            # Linux/macOS
powershell -File update.ps1   # Windows
```

O que faz, conforme o modo (lido de `runtime.json`):
- **Container:** `git pull` → **rebuild da imagem** (o build reinstala a Baileys do
  GitHub, isolada) → sobe de novo (`run.sh`).
- **Seco:** `git pull` → `npm install` (reinstala a Baileys) → `pm2 restart` (se
  houver PM2).

## Auto-update da Baileys em quedas
Se `atualizacao.autoUpdateBaileys` estiver ligado e houver muitas quedas seguidas
(mudança de protocolo do WhatsApp costuma exigir uma Baileys mais nova), o bot
grava `data/precisa-update.flag` e o painel avisa. A atualização em si é manual
(um `update.sh`/rebuild), pra você controlar o momento.

## Semi-automático
Você pode agendar `update.sh` (cron/agendador) ou comparar HEAD local com o
remoto (`git fetch && git status`) pra ser avisado quando houver novidade.
