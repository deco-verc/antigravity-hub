@echo off
setlocal
cd /d "%~dp0"

echo Criando ambiente virtual local...
python -m venv .venv
if errorlevel 1 goto error

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
if errorlevel 1 goto error

pip install -r requirements.txt
if errorlevel 1 goto error

echo.
echo Instalando navegador Chromium do Playwright. Isso pode demorar alguns minutos...
python -m playwright install chromium
if errorlevel 1 goto error

echo.
echo Setup concluido.
echo Para abrir o app, rode run_app.bat.
pause
exit /b 0

:error
echo.
echo Setup falhou. Confira se o Python esta instalado e disponivel no PATH.
pause
exit /b 1
