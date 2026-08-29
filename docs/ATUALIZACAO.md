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

## Modo container: `lcn` > Atualizar só funciona no HOST
Em modo docker, `lcn` roda **dentro do container** (`bin/lcn` faz
`docker exec`). De lá não dá pra reconstruir a própria imagem — o container
não tem acesso ao Docker/Podman do host. Se você abrir `lcn` > Atualizar
estando dentro do container, o painel detecta isso e avisa em vez de tentar
(e falhar) o rebuild.

Pra atualizar em modo container, rode `sh update.sh` (ou
`powershell -File update.ps1` no Windows) **direto no host**, na pasta do
projeto — não via `lcn`/`docker exec`.

## Auto-update da Baileys em quedas
Se `atualizacao.autoUpdateBaileys` estiver ligado e houver muitas quedas seguidas
(mudança de protocolo do WhatsApp costuma exigir uma Baileys mais nova), o bot
grava `data/precisa-update.flag` e o painel avisa. A atualização em si é manual
(um `update.sh`/rebuild), pra você controlar o momento.

## Semi-automático
Você pode agendar `update.sh` (cron/agendador) ou comparar HEAD local com o
remoto (`git fetch && git status`) pra ser avisado quando houver novidade.
