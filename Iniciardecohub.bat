@echo off
setlocal EnableDelayedExpansion
title DecoHUB - Central de Desenvolvimento Autonomo v1.1

if exist "%~dp0ai-dev-hub" (
  cd /d "%~dp0ai-dev-hub"
) else (
  cd /d "%~dp0"
)

echo ====================================================
echo   INICIANDO DECOHUB v1.1 (DIRECT RUNTIME)
echo   Ambiente limpo, portas liberadas e codigo sincronizado
echo ====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado no PATH.
  pause
  exit /b 1
)

echo [1/4] Limpando processos antigos e liberando porta 3001...
taskkill /F /IM "DecoHUB.exe" /T >nul 2>&1
taskkill /F /IM "AI DEV.exe" /T >nul 2>&1
taskkill /F /IM "electron.exe" /T >nul 2>&1

node -e "try{const{execSync}=require('child_process');const out=execSync('netstat -ano -p tcp',{encoding:'utf8'});out.split('\n').forEach(l=>{if(l.includes('LISTENING')&&l.includes(':3001')){const p=l.trim().split(/\s+/).pop();if(p&&+p>0)try{process.kill(+p,'SIGKILL');console.log('[INFO] Finalizando processo preso na porta 3001 (PID '+p+')...');}catch(e){}}});}catch(e){}" >nul 2>&1

if not exist "node_modules" (
  echo [INFO] Instalando dependencias principais...
  call npm install
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

set NEED_BUILD=0
if not exist "server\dist\index.js" set NEED_BUILD=1
if not exist "client\dist\index.html" set NEED_BUILD=1

if "%~1"=="--fast" goto skip_build_choice
if "%~1"=="-f" goto skip_build_choice
if "%~1"=="--no-build" goto skip_build_choice
if "%~1"=="--rebuild" goto do_build
if "%~1"=="-r" goto do_build

if "!NEED_BUILD!"=="1" goto do_build

echo [2/4] Verificando compilacao (TypeScript + Vite)...
echo       Compilacao existente pronta.
echo       [S] Recompilar codigo agora
echo       [N] Iniciar imediatamente (Padrao em 2s)
choice /c SN /t 2 /d N /m "Escolha" >nul
if errorlevel 2 goto skip_build_choice

:do_build
echo [2/4] Compilando servidor e interface (TypeScript + Vite)...
call npm run build
if errorlevel 1 (
  echo [ERRO] Falha na compilacao do projeto.
  pause
  exit /b 1
)
goto do_sync

:skip_build_choice
echo [2/4] Inicializacao rapida selecionada (Build preservado).

:do_sync
echo [3/4] Sincronizando bundles com caches e executaveis desktop...
set TARGET_APPDATA=C:\Users\Deco\AppData\Local\Programs\ai-dev-hub-root\resources\app.asar.unpacked
set TARGET_DIST=dist-desktop\win-unpacked\resources\app.asar.unpacked

if exist "%TARGET_APPDATA%" (
  robocopy "server\dist" "%TARGET_APPDATA%\server\dist" /MIR /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
  robocopy "client\dist" "%TARGET_APPDATA%\client\dist" /MIR /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
  robocopy "desktop" "%TARGET_APPDATA%\desktop" /MIR /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
)

if exist "%TARGET_DIST%" (
  robocopy "server\dist" "%TARGET_DIST%\server\dist" /MIR /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
  robocopy "client\dist" "%TARGET_DIST%\client\dist" /MIR /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
  robocopy "desktop" "%TARGET_DIST%\desktop" /MIR /R:1 /W:1 /NP /NFL /NDL >nul 2>&1
)

rem Limpa ERRORLEVEL gerado pelo robocopy antes de prosseguir
cmd /c "exit /b 0"

echo.
echo [4/4] Abrindo DecoHUB Desktop (Direct Runtime)...
echo ====================================================

if exist "node_modules\.bin\electron.cmd" (
  call "node_modules\.bin\electron.cmd" desktop\main.cjs
) else (
  call npm run desktop
)

if errorlevel 1 (
  echo.
  echo [AVISO] DecoHUB foi encerrado ou encontrou erro (Codigo: %ERRORLEVEL%).
  pause
)
