import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const testDir = path.join(os.homedir(), '.ai-dev-hub', 'profiles', 'test_isolated_probe');
const testAppData = path.join(testDir, 'AppData', 'Roaming');
const testLocal = path.join(testDir, 'AppData', 'Local');
const userData = path.join(testAppData, 'Antigravity');
const exe = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'antigravity', 'Antigravity.exe');

const psCmd = `
$env:USERPROFILE = '${testDir}';
$env:APPDATA = '${testAppData}';
$env:LOCALAPPDATA = '${testLocal}';
$env:HOME = '${testDir}';
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue;
Remove-Item Env:ELECTRON_NO_ASAR -ErrorAction SilentlyContinue;
Remove-Item Env:ELECTRON_OZONE_PLATFORM_HINT -ErrorAction SilentlyContinue;
Get-ChildItem Env:ANTIGRAVITY_* | Remove-Item -ErrorAction SilentlyContinue;
Get-ChildItem Env:AGY_* | Remove-Item -ErrorAction SilentlyContinue;

$proc = Start-Process -FilePath '${exe}' -ArgumentList '--user-data-dir="${userData}"' -PassThru;
Write-Output "STARTED_PID:$($proc.Id)";
Start-Sleep -Seconds 2;
Write-Output "STILL_RUNNING:$(-not $proc.HasExited)";
`;

const res = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCmd.replace(/\r?\n/g, ' ')}"`, { encoding: 'utf-8' });
console.log(res);
