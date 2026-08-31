# Empacota o LCNWhatsApp num lcn.exe standalone (Node.js Single Executable
# Applications) — chamado por install.ps1 (1a instalacao) e update.ps1
# (rebuild apos atualizar). Depois disso, o usuario nao precisa mais de
# Node/npm instalados pra USAR o bot no dia a dia -- so pra rodar este build.
#
# Fluxo classico (--experimental-sea-config + postject), nao a flag de passo
# unico --build-sea (essa so existe a partir do Node 25.5, release "Current",
# nao LTS) -- assim fica compativel com o Node 24 LTS que install.ps1 ja usa.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$raiz = $PSScriptRoot

$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt 22) {
  Write-Host "Empacotar o lcn.exe exige Node.js 22+ (SEA estavel desde o Node 22)."
  Write-Host "Rode install.ps1 de novo -- ele instala a LTS via winget."
  exit 1
}

New-Item -ItemType Directory -Force -Path dist | Out-Null

Write-Host ">> empacotando o codigo (ESM -> CJS num arquivo so, via esbuild)..."
# --external:sharp: sharp e' o unico addon nativo (.node) em toda a arvore de
# dependencias (vem so como peer opcional da Baileys) -- um binario nativo
# nao pode ir pra dentro de um blob JS de forma alguma. A propria Baileys ja
# cai pra jimp (JS puro, instalado como dependency normal deste projeto) se
# sharp nao estiver disponivel em runtime -- nao precisa de mais nada aqui.
& node_modules\.bin\esbuild.cmd bin\lcn-sea.js `
  --bundle --platform=node --format=cjs --target=node22 `
  --external:sharp `
  --outfile=dist\lcn.bundle.cjs --legal-comments=none
if ($LASTEXITCODE -ne 0) { Write-Host "Falha no esbuild."; exit 1 }

$seaConfig = @{
  main                           = "dist/lcn.bundle.cjs"
  output                         = "dist/lcn.blob"
  disableExperimentalSEAWarning  = $true
  useSnapshot                    = $false
  useCodeCache                   = $true
} | ConvertTo-Json
Set-Content -Path dist\sea-config.json -Value $seaConfig -Encoding Ascii

Write-Host ">> gerando o blob SEA..."
node --experimental-sea-config dist\sea-config.json
if (-not (Test-Path dist\lcn.blob)) { Write-Host "Falha gerando o blob SEA."; exit 1 }

Write-Host ">> copiando o node.exe atual como base do lcn.exe..."
Copy-Item (Get-Command node).Source (Join-Path $raiz "lcn.exe") -Force

Write-Host ">> injetando o blob no lcn.exe (postject)..."
# A assinatura Authenticode original do node.exe fica invalida de qualquer
# jeito depois da injecao. O procedimento oficial remove a assinatura antes
# via signtool (Windows SDK) -- mas isso nao vem instalado por padrao numa
# maquina de usuario comum, entao pulamos esse passo: o postject so emite um
# aviso sobre a assinatura, nao falha. O SmartScreen pode avisar "editor
# desconhecido" na 1a execucao do lcn.exe -- fricção conhecida/aceita.
node node_modules\postject\dist\cli.js lcn.exe NODE_SEA_BLOB dist\lcn.blob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 `
  --overwrite
if ($LASTEXITCODE -ne 0) { Write-Host "Falha injetando o blob no exe."; exit 1 }

Write-Host ">> lcn.exe gerado em: $raiz\lcn.exe"
