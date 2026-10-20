import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const testDir = path.join(os.homedir(), '.ai-dev-hub', 'profiles', 'test_isolated_probe');
const testAppData = path.join(testDir, 'AppData', 'Roaming');
const testLocal = path.join(testDir, 'AppData', 'Local');
const userData = path.join(testAppData, 'Antigravity');
const exe = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'antigravity', 'Antigravity.exe');

const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;
delete cleanEnv.ELECTRON_NO_ASAR;
delete cleanEnv.ELECTRON_OZONE_PLATFORM_HINT;
for (const k of Object.keys(cleanEnv)) {
  if (k.startsWith('ANTIGRAVITY_') || k.startsWith('AGY_')) {
    delete cleanEnv[k];
  }
}

cleanEnv.USERPROFILE = testDir;
cleanEnv.APPDATA = testAppData;
cleanEnv.LOCALAPPDATA = testLocal;
cleanEnv.HOME = testDir;

console.log('Spawning Antigravity WITHOUT --new-window...');
const child = spawn(exe, [
  `--user-data-dir=${userData}`,
  '--no-sandbox'
], {
  detached: true,
  stdio: 'ignore',
  env: cleanEnv
});

child.unref();
console.log('Spawned child PID:', child.pid);
setTimeout(() => {
  console.log('Done.');
  process.exit(0);
}, 2000);
