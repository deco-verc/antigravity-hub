@echo off
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
)

python -m pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo Instalando PyInstaller...
    python -m pip install pyinstaller
    if errorlevel 1 goto error
)

if not exist outputs mkdir outputs

python -m PyInstaller ^
    --noconfirm ^
    --clean ^
    --windowed ^
    --name SiteDocsExtractor ^
    --add-data "config.json;." ^
    --add-data "presets.json;." ^
    app.py
if errorlevel 1 goto error

if not exist "dist\SiteDocsExtractor\outputs" mkdir "dist\SiteDocsExtractor\outputs"
copy /Y "config.json" "dist\SiteDocsExtractor\config.json" >nul
if errorlevel 1 goto error
copy /Y "presets.json" "dist\SiteDocsExtractor\presets.json" >nul
if errorlevel 1 goto error

echo.
echo Build concluido.
echo Executavel: dist\SiteDocsExtractor\SiteDocsExtractor.exe
echo Presets e config foram copiados para a pasta do executavel.
pause
exit /b 0

:error
echo.
echo Build falhou. Veja as mensagens acima.
pause
exit /b 1
