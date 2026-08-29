# Atualiza o LCNWhatsApp (Windows): codigo (git) + Baileys, reinicia no modo certo.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

$mode = "bare"; $engine = ""
if (Test-Path runtime.json) {
  try { $rt = Get-Content runtime.json | ConvertFrom-Json; $mode = $rt.mode; $engine = $rt.engine } catch {}
}

if (Test-Path .git) {
  Write-Host ">> git pull"
  git pull --ff-only
}
Remove-Item -ErrorAction SilentlyContinue data\precisa-update.flag

if ($mode -eq "docker") {
  Write-Host ">> rebuild da imagem (reinstala Baileys, isolada)"
  & powershell -ExecutionPolicy Bypass -File run.ps1 Dockerfile
} else {
  Write-Host ">> npm install (reinstala Baileys do GitHub)"
  npm install --no-audit --no-fund
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    pm2 restart LCNWhatsApp 2>$null; if ($LASTEXITCODE -ne 0) { pm2 start ecosystem.config.cjs }
    Write-Host ">> reiniciado via PM2."
  } else {
    Write-Host ">> atualizado. Reinicie o bot (npm start) se estiver rodando."
  }
}
