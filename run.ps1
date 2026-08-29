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

$dockerArgs = @(
  "run", "-d", "--name", $nome, "--restart", "unless-stopped", "-it",
  "--memory", "512m", "--cpus", "1.0",
  "-v", "${PWD}\sessao:/app/sessao",
  "-v", "${PWD}\midia:/app/midia",
  "-v", "${PWD}\data:/app/data",
  "-v", "${PWD}\config.json:/app/config.json"
)

# Provedor "codex" da transcrição: só monta se o Codex CLI já estiver
# instalado e logado no host (evita criar pasta vazia no lugar de auth.json
# quando ninguém usa esse provedor). Funciona só se o Codex for da mesma
# plataforma do container Linux (ex: instalado dentro do WSL2, não o Codex
# nativo do Windows). $env:CODEX_NPM_DIR/$env:CODEX_HOME sobrepõem os
# caminhos padrão.
$codexNpmDir = if ($env:CODEX_NPM_DIR) { $env:CODEX_NPM_DIR } else { "/usr/local/lib/node_modules/@openai/codex" }
$codexHomeDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { "$HOME/.codex" }
if ((Test-Path $codexNpmDir) -and (Test-Path "$codexHomeDir/auth.json")) {
  Write-Host ">> Codex CLI achado no host — montando pro provedor 'codex' da transcrição"
  $dockerArgs += @(
    "-v", "${codexNpmDir}:/usr/local/lib/node_modules/@openai/codex:ro",
    "-v", "${codexHomeDir}/auth.json:/root/.codex/auth.json:ro"
  )
}

$dockerArgs += "lcnwhatsapp:latest"
& $engine @dockerArgs

Write-Host ">> pronto. Login (QR/codigo):  $engine logs -f $nome"
Write-Host ">> painel:  lcn"
