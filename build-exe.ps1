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

# DESDE A MIGRACAO BAILEYS->ZAPO: better-sqlite3 (store de sessao do zapo-js,
# via @zapo-js/store-sqlite) e' um addon nativo (.node) que, ao contrario do
# sharp de antes, NAO e' opcional -- sem ele nao ha sessao persistida. Um
# binario nativo nao pode ir pra dentro do blob JS do SEA, e vendorizar o
# .node certo pra plataforma ao lado do lcn.exe (com resolucao de modulo em
# runtime) ainda nao foi implementado -- tratado como fora de escopo na
# migracao inicial (ver plano em .claude/plans). Falha aqui de proposito, em
# vez de gerar um lcn.exe que quebra silenciosamente ao conectar.
Write-Host "Empacotamento .exe (SEA) ainda nao suporta o store SQLite do zapo-js"
Write-Host "(better-sqlite3 e addon nativo, nao pode entrar no bundle)."
Write-Host "Use o modo Docker ou 'npm start'/PM2 por enquanto."
exit 1

New-Item -ItemType Directory -Force -Path dist | Out-Null

Write-Host ">> empacotando o codigo (ESM -> CJS num arquivo so, via esbuild)..."
# --external:sharp: sharp continua sendo addon nativo opcional (peer do zapo-js
# tambem) -- cai pra jimp (JS puro) se nao disponivel em runtime.
# --external:better-sqlite3: ver bloco de saida antecipada acima -- listado
# aqui so pra quando essa lacuna for fechada (retirar o "exit 1" acima antes).
& node_modules\.bin\esbuild.cmd bin\lcn-sea.js `
  --bundle --platform=node --format=cjs --target=node22 `
  --external:sharp --external:better-sqlite3 `
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
