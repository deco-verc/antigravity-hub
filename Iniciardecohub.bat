@echo off
setlocal EnableDelayedExpansion
title DecoHUB - Central de Desenvolvimento Autonomo

if exist "%~dp0ai-dev-hub" (
  cd /d "%~dp0ai-dev-hub"
) else (
  cd /d "%~dp0"
)

echo ====================================================
echo   INICIANDO DECOHUB (MODO DESKTOP DIRETO)
echo   Sem necessidade de empacotar .exe
echo ====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado no PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

set REBUILD=0
if not exist "server\dist\index.js" set REBUILD=1
if not exist "client\dist\index.html" set REBUILD=1

if "%~1"=="--no-build" goto launch
if "%~1"=="--fast" goto launch
if "%~1"=="/fast" goto launch

if "!REBUILD!"=="1" (
  echo [1/2] Compilando servidor e interface pela primeira vez...
  call npm run build
  if errorlevel 1 (
    echo [ERRO] Falha na compilacao.
    pause
    exit /b 1
  )
  goto launch
)

echo [1/2] Deseja atualizar a compilacao do codigo?
echo       [S] Recompilar alteracoes (Vite + TypeScript) [Padrao em 3s]
echo       [N] Iniciar imediatamente sem recompilar
echo.
choice /c SN /t 3 /d S /m "Escolha" >nul
if errorlevel 2 goto skipbuild
echo [1/2] Compilando alteracoes recentes...
call npm run build
if errorlevel 1 (
  echo [ERRO] Falha na compilacao.
  pause
  exit /b 1
)
goto launch

:skipbuild
echo [1/2] Recompilacao ignorada. Iniciando com arquivos existentes...

:launch
echo.
echo [2/2] Abrindo DecoHUB Desktop (Electron)...
echo ====================================================
call npx electron desktop\main.cjs

if errorlevel 1 (
  echo.
  echo [AVISO] DecoHUB foi encerrado ou encontrou erro (Codigo: %ERRORLEVEL%).
  pause
)
