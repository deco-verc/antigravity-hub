$profileDir = "C:\Users\Deco\.ai-dev-hub\profiles\test_isolated_probe"
$appDataRoaming = Join-Path $profileDir "AppData\Roaming"
$appDataLocal = Join-Path $profileDir "AppData\Local"
$userData = Join-Path $appDataRoaming "Antigravity"
$exe = "C:\Users\Deco\AppData\Local\Programs\antigravity\Antigravity.exe"

$env:USERPROFILE = $profileDir
$env:APPDATA = $appDataRoaming
$env:LOCALAPPDATA = $appDataLocal
$env:HOME = $profileDir
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_NO_ASAR -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_OZONE_PLATFORM_HINT -ErrorAction SilentlyContinue
Get-ChildItem Env:ANTIGRAVITY_* | Remove-Item -ErrorAction SilentlyContinue
Get-ChildItem Env:AGY_* | Remove-Item -ErrorAction SilentlyContinue

$p = Start-Process -FilePath $exe -ArgumentList @("--user-data-dir=$userData") -WindowStyle Normal -PassThru
Write-Output "LAUNCHED_PID:$($p.Id)"
Start-Sleep -Seconds 3
Write-Output "STILL_ALIVE:$(-not $p.HasExited)"
