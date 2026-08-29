# Build + run do container do LCNWhatsApp no Windows (PowerShell), sem compose.
param([string]$Dockerfile = "Dockerfile")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Ordem: engine ja gravado em runtime.json -> detecta de verdade (nunca
# assume podman sem checar) -> se nenhum existir, tenta instalar Docker.
$engine = ""
if (Test-Path runtime.json) { try { $engine = (Get-Content runtime.json | ConvertFrom-Json).engine } catch {} }
if (-not $engine) {
  foreach ($e in @("docker","podman","nerdctl")) {
    if (Get-Command $e -ErrorAction SilentlyContinue) { $engine = $e; break }
  }
}
if (-not $engine) {
  Write-Host "Nenhum engine de container encontrado (docker/podman/nerdctl)."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host ">> tentando instalar o Docker Desktop via winget..."
    winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  }
  foreach ($e in @("docker","podman","nerdctl")) {
    if (Get-Command $e -ErrorAction SilentlyContinue) { $engine = $e; break }
  }
  if (-not $engine) {
    Write-Host ">> Nao consegui instalar/encontrar um engine de container."
    Write-Host ">> Instale manualmente: https://www.docker.com/products/docker-desktop/ e rode este script de novo."
    Write-Host ">> (Docker Desktop pode exigir reiniciar o Windows/WSL2 antes de funcionar.)"
    exit 1
  }
}

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
} else {
  Write-Host ">> Codex CLI nao encontrado no host -- provedor 'codex' da transcricao ficara indisponivel no container."
  Write-Host "   Pra usar: instale (npm install -g @openai/codex), faca 'codex login' no host e rode este script de novo."
  Write-Host "   (ou ajuste `$env:CODEX_NPM_DIR/`$env:CODEX_HOME se o Codex estiver em outro caminho)"
}

$dockerArgs += "lcnwhatsapp:latest"
& $engine @dockerArgs

Write-Host ">> pronto. Login (QR/codigo):  $engine logs -f $nome"
Write-Host ">> painel:  lcn"
