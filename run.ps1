# Build + run do container do LCNWhatsApp no Windows (PowerShell), sem compose.
param([string]$Dockerfile = "Dockerfile")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$engine = ""
if (Test-Path runtime.json) { try { $engine = (Get-Content runtime.json | ConvertFrom-Json).engine } catch {} }
if (-not $engine) { if (Get-Command docker -ErrorAction SilentlyContinue) { $engine = "docker" } else { $engine = "podman" } }

$nome = "LCNWhatsApp"
if (-not (Test-Path config.json)) { Copy-Item config.example.json config.json }
New-Item -ItemType Directory -Force -Path sessao,midia,data | Out-Null

Write-Host ">> build ($Dockerfile) com $engine"
& $engine build -f $Dockerfile -t lcnwhatsapp:latest .

Write-Host ">> (re)subindo container $nome"
& $engine rm -f $nome 2>$null
& $engine run -d --name $nome --restart unless-stopped -it --memory 512m --cpus 1.0 `
  -v "${PWD}\sessao:/app/sessao" `
  -v "${PWD}\midia:/app/midia" `
  -v "${PWD}\data:/app/data" `
  -v "${PWD}\config.json:/app/config.json" `
  lcnwhatsapp:latest

Write-Host ">> pronto. Login (QR/codigo):  $engine logs -f $nome"
Write-Host ">> painel:  lcn"
