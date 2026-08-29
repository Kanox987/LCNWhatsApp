# Diagnóstico de dependências/ambiente do LCNWhatsApp (Windows / PowerShell).
# Não instala nem altera dependências. Exit 0 = sem falhas críticas; exit 1 = falha.
$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

$script:Pass = 0
$script:Warn = 0
$script:Fail = 0

function Add-Ok([string]$Message) {
  $script:Pass++
  Write-Host "  [OK]    $Message" -ForegroundColor Green
}
function Add-Warn([string]$Message) {
  $script:Warn++
  Write-Host "  [AVISO] $Message" -ForegroundColor Yellow
}
function Add-Fail([string]$Message) {
  $script:Fail++
  Write-Host "  [ERRO]  $Message" -ForegroundColor Red
}
function Refresh-SessionPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($machinePath) { $parts += $machinePath }
  if ($userPath) { $parts += $userPath }
  $env:Path = $parts -join ";"
}
function Invoke-Quiet([scriptblock]$Command) {
  & $Command *> $null
  return ($LASTEXITCODE -eq 0)
}

# Importante depois de instalação via winget ou alteração do PATH do usuário.
Refresh-SessionPath

Write-Host "==================================================="
Write-Host "  LCNWhatsApp - verificacao de dependencias"
Write-Host "==================================================="

Write-Host "`nProjeto"
foreach ($file in @("package.json", "config.example.json", "index.js")) {
  if (Test-Path $file -PathType Leaf) { Add-Ok "$file encontrado" } else { Add-Fail "$file nao encontrado" }
}

$config = $null
if (Test-Path config.json -PathType Leaf) {
  try {
    $config = Get-Content config.json -Raw | ConvertFrom-Json
    Add-Ok "config.json encontrado e JSON valido"
  } catch {
    Add-Fail "config.json existe, mas nao e JSON valido"
  }
} else {
  Add-Warn "config.json nao existe ainda (rode o instalador para criar)."
}

$mode = ""
$engine = ""
if (Test-Path runtime.json -PathType Leaf) {
  try {
    $runtime = Get-Content runtime.json -Raw | ConvertFrom-Json
    $mode = [string]$runtime.mode
    $engine = [string]$runtime.engine
    if ($mode) { Add-Ok "runtime.json: modo=$mode" } else { Add-Warn "runtime.json existe, mas mode esta vazio" }
  } catch {
    Add-Fail "runtime.json existe, mas nao e JSON valido"
  }
} else {
  Add-Warn "runtime.json nao existe; vou verificar o que estiver disponivel no host."
}

Write-Host "`nComando lcn"
$lcn = Get-Command lcn -ErrorAction SilentlyContinue
if ($lcn) { Add-Ok "lcn no PATH: $($lcn.Source)" } else { Add-Warn "lcn nao esta no PATH desta sessao" }

if ($mode -eq "docker") {
  Write-Host "`nModo container"

  if (-not $engine) {
    foreach ($candidate in @("docker", "podman", "nerdctl")) {
      if (Get-Command $candidate -ErrorAction SilentlyContinue) { $engine = $candidate; break }
    }
  }

  if (-not $engine) {
    Add-Fail "nenhum engine de container configurado/encontrado (docker/podman/nerdctl)"
  } elseif (-not (Get-Command $engine -ErrorAction SilentlyContinue)) {
    Add-Fail "engine configurado '$engine' nao esta no PATH"
  } else {
    Add-Ok "engine encontrado: $engine"

    & $engine info *> $null
    if ($LASTEXITCODE -eq 0) {
      Add-Ok "$engine esta acessivel e respondendo"
    } else {
      Add-Fail "$engine existe, mas o daemon/servico nao respondeu (ou falta permissao)"
    }

    $containers = @(& $engine ps -a --format "{{.Names}}" 2>$null)
    if ($containers -contains "LCNWhatsApp") {
      Add-Ok "container LCNWhatsApp existe"
      $running = @(& $engine ps --format "{{.Names}}" 2>$null)
      if ($running -contains "LCNWhatsApp") {
        Add-Ok "container LCNWhatsApp esta rodando"
        $containerNode = & $engine exec LCNWhatsApp node --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $containerNode) {
          Add-Ok "Node dentro do container: $($containerNode | Select-Object -First 1)"
        } else {
          Add-Fail "Node nao respondeu dentro do container"
        }
      } else {
        Add-Warn "container LCNWhatsApp existe, mas esta parado"
      }
    } else {
      Add-Warn "container LCNWhatsApp ainda nao existe (rode run.ps1/install.ps1 no modo container)"
    }
  }
} else {
  Write-Host "`nModo nativo / host"

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $nodeVersion = (& node --version 2>$null | Select-Object -First 1)
    $majorText = (& node -p "process.versions.node.split('.')[0]" 2>$null | Select-Object -First 1)
    $major = 0
    if ([int]::TryParse([string]$majorText, [ref]$major)) {
      if ($major -ge 22) { Add-Ok "Node.js $nodeVersion (minimo 22)" } else { Add-Fail "Node.js $nodeVersion e antigo; necessario 22+ (24 LTS recomendado)" }
    } else {
      Add-Fail "Node respondeu uma versao invalida: $nodeVersion"
    }
  } else {
    Add-Fail "Node.js nao encontrado no PATH"
  }

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) {
    $npmVersion = (& npm --version 2>$null | Select-Object -First 1)
    Add-Ok "npm $npmVersion"
  } else {
    Add-Fail "npm nao encontrado no PATH"
  }

  if ($node -and (Test-Path package.json -PathType Leaf)) {
    & node -e "for (const p of ['@hapi/boom','@whiskeysockets/baileys','pino','qrcode-terminal']) require.resolve(p)" *> $null
    if ($LASTEXITCODE -eq 0) {
      Add-Ok "dependencias npm principais resolvem corretamente"
    } else {
      Add-Fail "dependencias npm incompletas; rode: npm install"
    }
  }
}

Write-Host "`nDiretorios e permissoes"
foreach ($dir in @("sessao", "midia", "data")) {
  if (-not (Test-Path $dir -PathType Container)) {
    Add-Warn "$dir\ nao existe ainda"
  } else {
    try {
      $probe = Join-Path $dir ".lcn-write-test-$PID.tmp"
      [IO.File]::WriteAllText($probe, "ok")
      Remove-Item $probe -Force
      Add-Ok "$dir\ existe e e gravavel"
    } catch {
      Add-Fail "$dir\ existe, mas nao e gravavel pelo usuario atual"
    }
  }
}

if (Test-Path config.json -PathType Leaf) {
  try {
    $item = Get-Item config.json
    $stream = [IO.File]::Open($item.FullName, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite)
    $stream.Close()
    Add-Ok "config.json e gravavel"
  } catch {
    Add-Fail "config.json nao e gravavel pelo usuario atual"
  }
}

Write-Host "`nTranscricao (quando configurada)"
$provider = "off"
if ($config -and $config.transcricao -and $config.transcricao.provedor) {
  $provider = [string]$config.transcricao.provedor
}

switch ($provider) {
  "off" {
    Add-Ok "transcricao desativada; sem dependencia extra obrigatoria"
  }
  "faster-whisper" {
    $pythonBin = if ($config.transcricao.pythonBin) { [string]$config.transcricao.pythonBin } else { "" }
    $pyCommand = $null
    if ($pythonBin -and (Test-Path $pythonBin -PathType Leaf)) {
      $pyCommand = $pythonBin
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
      $pyCommand = "python"
    } elseif (Get-Command py -ErrorAction SilentlyContinue) {
      $pyCommand = "py"
    }

    if ($pyCommand) {
      & $pyCommand -c "import faster_whisper" *> $null
      if ($LASTEXITCODE -eq 0) { Add-Ok "faster-whisper importou corretamente via $pyCommand" } else { Add-Fail "Python foi encontrado, mas faster_whisper nao importa" }
    } else {
      Add-Fail "provedor faster-whisper ativo, mas Python configurado/instalado nao foi encontrado"
    }
  }
  "codex" {
    if ($mode -eq "docker" -and $engine -and (Get-Command $engine -ErrorAction SilentlyContinue)) {
      $running = @(& $engine ps --format "{{.Names}}" 2>$null)
      if ($running -contains "LCNWhatsApp") {
        & $engine exec LCNWhatsApp codex --version *> $null
        if ($LASTEXITCODE -eq 0) { Add-Ok "Codex CLI responde dentro do container" } else { Add-Fail "provedor codex ativo, mas Codex CLI nao responde dentro do container" }
        & $engine exec LCNWhatsApp test -f /root/.codex/auth.json *> $null
        if ($LASTEXITCODE -eq 0) { Add-Ok "auth.json do Codex esta montado no container" } else { Add-Warn "auth.json do Codex nao foi encontrado no container" }
      } else {
        Add-Warn "nao foi possivel testar Codex porque o container nao esta rodando"
      }
    } else {
      $codex = Get-Command codex -ErrorAction SilentlyContinue
      if ($codex) {
        $codexVersion = (& codex --version 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -eq 0) { Add-Ok "Codex CLI: $codexVersion" } else { Add-Fail "comando codex existe, mas nao respondeu corretamente" }
      } else {
        Add-Fail "provedor codex ativo, mas comando codex nao esta no PATH"
      }
      $auth = Join-Path $HOME ".codex\auth.json"
      if (Test-Path $auth -PathType Leaf) { Add-Ok "auth.json do Codex encontrado" } else { Add-Warn "auth.json do Codex nao encontrado em ~/.codex" }
    }
  }
  "openai" {
    if ($config.transcricao.openaiApiKey) { Add-Ok "OpenAI API key configurada (valor oculto)" } else { Add-Fail "provedor openai ativo, mas openaiApiKey esta vazia" }
  }
  "comando" {
    if ($config.transcricao.comando) { Add-Ok "comando externo de transcricao configurado" } else { Add-Fail "provedor comando ativo, mas o comando esta vazio" }
  }
  default {
    Add-Warn "provedor de transcricao desconhecido: $provider"
  }
}

Write-Host "`nResumo"
Write-Host "  OK: $script:Pass | Avisos: $script:Warn | Erros: $script:Fail"
if ($script:Fail -gt 0) {
  Write-Host "  Ambiente com falha(s) critica(s). Corrija os itens [ERRO] acima." -ForegroundColor Red
  exit 1
}
Write-Host "  Ambiente sem falhas criticas." -ForegroundColor Green
exit 0
