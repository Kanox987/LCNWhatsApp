@echo off
REM Launcher do LCNWhatsApp (comando `lcn`) para Windows cmd/powershell.
setlocal
set "RAIZ=%~dp0.."
pushd "%RAIZ%"

set "MODE=bare"
set "ENGINE="
REM Le mode/engine do runtime.json via PowerShell (sem depender de Node no
REM host) -- PowerShell ja e' dependencia assumida em install.ps1/run.ps1.
if exist runtime.json (
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try { (Get-Content runtime.json | ConvertFrom-Json).mode } catch { 'bare' }"`) do set "MODE=%%i"
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "try { (Get-Content runtime.json | ConvertFrom-Json).engine } catch { '' }"`) do set "ENGINE=%%i"
)

if "%MODE%"=="docker" (
  if "%ENGINE%"=="" set "ENGINE=docker"
  %ENGINE% start LCNWhatsApp >nul 2>&1
  %ENGINE% exec -it -e LCN_MODE=docker -e LCN_ENGINE=%ENGINE% LCNWhatsApp node src/dashboard.js
) else (
  node src/dashboard.js
)

popd
endlocal
