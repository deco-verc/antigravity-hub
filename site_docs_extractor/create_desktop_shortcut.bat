@echo off
setlocal
cd /d "%~dp0"

set "PROJECT_DIR=%~dp0"
set "EXE_TARGET=%PROJECT_DIR%dist\SiteDocsExtractor\SiteDocsExtractor.exe"
set "BAT_TARGET=%PROJECT_DIR%run_app.bat"

if exist "%EXE_TARGET%" (
    set "SHORTCUT_TARGET=%EXE_TARGET%"
    set "TARGET_KIND=executavel"
) else (
    if exist "%BAT_TARGET%" (
        set "SHORTCUT_TARGET=%BAT_TARGET%"
        set "TARGET_KIND=run_app.bat"
    ) else (
        echo ERRO: Nao encontrei o executavel nem run_app.bat.
        echo Projeto: %PROJECT_DIR%
        pause
        exit /b 1
    )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$desktop = [Environment]::GetFolderPath('Desktop');" ^
    "$shortcutPath = Join-Path $desktop 'Site Docs Extractor.lnk';" ^
    "$shell = New-Object -ComObject WScript.Shell;" ^
    "$shortcut = $shell.CreateShortcut($shortcutPath);" ^
    "$shortcut.TargetPath = $env:SHORTCUT_TARGET;" ^
    "$shortcut.WorkingDirectory = $env:PROJECT_DIR.TrimEnd('\');" ^
    "$shortcut.Description = 'Site Docs Extractor';" ^
    "$shortcut.Save();" ^
    "Write-Host ('Atalho criado em: ' + $shortcutPath);" ^
    "Write-Host ('Destino: ' + $env:SHORTCUT_TARGET);"

if errorlevel 1 (
    echo.
    echo ERRO: Falha ao criar o atalho.
    pause
    exit /b 1
)

echo.
echo Atalho criado com sucesso na Area de Trabalho.
echo Nome: Site Docs Extractor.lnk
echo Destino escolhido: %TARGET_KIND%
echo Caminho: %SHORTCUT_TARGET%
pause
exit /b 0
