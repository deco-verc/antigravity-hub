@echo off
setlocal EnableDelayedExpansion
title DecoHUB - Central de Desenvolvimento Autonomo v1.1

:: ============================================================================
:: DecoHUB Desktop Launcher
:: Localiza o repositorio, valida ambiente, sincroniza bundles e inicia o runtime
:: ============================================================================

:: 1. Localizacao robusta do repositorio raiz
set "DECOHUB_DIR=C:\IA\Antigravity HUB\ai-dev-hub"

if exist "%DECOHUB_DIR%\package.json" (
  cd /d "%DECOHUB_DIR%"
) else if exist "%~dp0package.json" (
  cd /d "%~dp0"
) else if exist "%~dp0ai-dev-hub\package.json" (
  cd /d "%~dp0ai-dev-hub"
) else if exist "%~dp0..\ai-dev-hub\package.json" (
  cd /d "%~dp0..\ai-dev-hub"
) else if exist "C:\IA\Antigravity HUB\ai-dev-hub\package.json" (
  set "DECOHUB_DIR=C:\IA\Antigravity HUB\ai-dev-hub"
  cd /d "C:\IA\Antigravity HUB\ai-dev-hub"
) else (
  echo [ERRO] Repositorio do DecoHUB nao foi encontrado.
  echo Caminho esperado: %DECOHUB_DIR%
  pause
  exit /b 1
)

:: Garante que o atalho com icone oficial existe na Area de Trabalho
if not exist "%USERPROFILE%\Desktop\DecoHUB.lnk" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%USERPROFILE%\Desktop\DecoHUB.lnk'); $s.TargetPath = '%USERPROFILE%\Desktop\Iniciar DecoHUB.bat'; $s.WorkingDirectory = '%DECOHUB_DIR%'; $s.IconLocation = '%DECOHUB_DIR%\desktop\assets\icon.ico,0'; $s.Description = 'DecoHUB - Central de Desenvolvimento Autonomo'; $s.Save()" >nul 2>&1
)

echo ====================================================
echo   INICIANDO DECOHUB v1.1 (DIRECT RUNTIME)
echo   Repositorio: %CD%
echo ====================================================
echo.

:: 2. Verificacao do Node.js no PATH
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado no PATH do sistema.
  echo Instale o Node.js v20+ ou configure as variaveis de ambiente.
  pause
  exit /b 1
)

:: 3. Limpeza de processos orfaos e liberacao da porta 3001
echo [1/4] Limpando processos antigos e liberando porta 3001...
taskkill /F /IM "DecoHUB.exe" /T >nul 2>&1
taskkill /F /IM "AI DEV.exe" /T >nul 2>&1
taskkill /F /IM "electron.exe" /T >nul 2>&1

node -e "try{const{execSync,execFileSync}=require('child_process');const out=execSync('netstat -ano -p tcp',{encoding:'utf8'});out.split(/\r?\n/).forEach(l=>{if(l.includes('LISTENING')&&(l.includes(':3001 ')||l.includes(':3001\t')||l.includes('127.0.0.1:3001')||l.includes('0.0.0.0:3001'))){const p=l.trim().split(/\s+/).pop();if(p&&+p>0&&+p!==process.pid)try{execFileSync('taskkill',['/F','/PID',String(p),'/T'],{stdio:'ignore',timeout:3000});console.log('[INFO] Finalizando processo preso na porta 3001 (PID '+p+')...');}catch(e){}}});}catch(e){}" >nul 2>&1

:: 4. Verificacao de dependencias
if not exist "node_modules" (
  echo [INFO] Instalando dependencias principais...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias com npm.
    pause
    exit /b 1
  )
)

:: 5. Verificacao e compilacao (TypeScript + Vite)
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
call npm.cmd run build
if errorlevel 1 (
  echo [ERRO] Falha na compilacao do projeto.
  pause
  exit /b 1
)
goto do_sync

:skip_build_choice
echo [2/4] Inicializacao rapida selecionada (Build preservado).

:do_sync
:: 6. Sincronizacao de bundles com caches e executaveis desktop
echo [3/4] Sincronizando bundles com caches e executaveis desktop...
set TARGET_APPDATA=%LOCALAPPDATA%\Programs\ai-dev-hub-root\resources\app.asar.unpacked
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

:: 7. Execucao do DecoHUB Desktop Direct Runtime
echo.
echo [4/4] Abrindo DecoHUB Desktop (Direct Runtime)...
echo ====================================================

if exist "node_modules\.bin\electron.cmd" (
  call "node_modules\.bin\electron.cmd" desktop\main.cjs
) else (
  call npm.cmd run desktop
)

if errorlevel 1 (
  echo.
  echo [AVISO] DecoHUB foi encerrado ou encontrou erro (Codigo: %ERRORLEVEL%).
  pause
)
