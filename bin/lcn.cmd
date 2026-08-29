@echo off
REM Launcher do LCNWhatsApp (comando `lcn`) para Windows cmd/powershell.
setlocal
set "RAIZ=%~dp0.."
pushd "%RAIZ%"

set "MODE=bare"
set "ENGINE="
if exist runtime.json (
  for /f "usebackq delims=" %%i in (`node -e "try{console.log(require('./runtime.json').mode||'bare')}catch(e){console.log('bare')}"`) do set "MODE=%%i"
  for /f "usebackq delims=" %%i in (`node -e "try{console.log(require('./runtime.json').engine||'')}catch(e){console.log('')}"`) do set "ENGINE=%%i"
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
