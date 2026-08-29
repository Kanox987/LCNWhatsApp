# Instalador do LCNWhatsApp (Windows / PowerShell).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$raiz = $PSScriptRoot

Write-Host "==================================================="
Write-Host "  LCNWhatsApp - instalador"
Write-Host "==================================================="

# --- detecta engine de container ---
$engine = ""
foreach ($e in @("docker","podman","nerdctl")) {
  if (Get-Command $e -ErrorAction SilentlyContinue) { $engine = $e; break }
}

$mode = "bare"
if ($engine) {
  Write-Host "Encontrei um engine de container: $engine"
  $resp = Read-Host "Rodar em container (recomendado) ou no seco (nativo)? [C/s]"
  if ($resp -match '^[sS]') { $mode = "bare" } else { $mode = "docker" }
} else {
  Write-Host "Nenhum engine de container encontrado."
  $resp = Read-Host "Quer instalar o Docker Desktop pra rodar isolado? [s/N]"
  if ($resp -match '^[sS]') {
    Write-Host ">> Baixe o Docker Desktop: https://www.docker.com/products/docker-desktop/"
    Write-Host ">> Depois rode este instalador de novo."
    exit 0
  } else { $mode = "bare" }
}

# --- grava runtime.json ---
@{ mode = $mode; engine = $engine } | ConvertTo-Json | Set-Content runtime.json
Write-Host ">> runtime.json: modo=$mode engine=$engine"

if (-not (Test-Path config.json)) { Copy-Item config.example.json config.json }
New-Item -ItemType Directory -Force -Path sessao,midia,data | Out-Null

if ($mode -eq "docker") {
  Write-Host ">> subindo em container..."
  & powershell -ExecutionPolicy Bypass -File run.ps1 Dockerfile
} else {
  Write-Host ">> instalando dependencias (npm install)..."
  npm install --no-audit --no-fund
  $w = Read-Host "Preparar venv Python com faster-whisper agora? [s/N]"
  if ($w -match '^[sS]') {
    python -m venv .venv
    & .\.venv\Scripts\pip install --upgrade pip faster-whisper
    Write-Host ">> configure 'faster-whisper' no painel (lcn > Configuracoes > Transcricao)."
  }
  Write-Host ">> rode o bot com:  npm start   (ou 'npm run code')"
}

# --- instala o comando `lcn` (cria lcn.cmd numa pasta do PATH) ---
$binDir = Join-Path $env:LOCALAPPDATA "LCNWhatsApp\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$wrapper = "@echo off`r`ncall `"$raiz\bin\lcn.cmd`" %*"
Set-Content -Path (Join-Path $binDir "lcn.cmd") -Value $wrapper -Encoding Ascii
$userPath = [Environment]::GetEnvironmentVariable("Path","User")
if ($userPath -notlike "*$binDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
  Write-Host ">> adicionei $binDir ao PATH (reabra o terminal)."
}
Write-Host ">> comando instalado: lcn"
Write-Host "==================================================="
Write-Host "  Pronto! Abra o painel com:  lcn"
Write-Host "==================================================="
