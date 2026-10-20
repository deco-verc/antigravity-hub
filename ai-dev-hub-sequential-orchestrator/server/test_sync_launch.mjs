import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const testDir = path.join(os.homedir(), '.ai-dev-hub', 'profiles', 'test_isolated_probe');
const testAppData = path.join(testDir, 'AppData', 'Roaming');
const testLocal = path.join(testDir, 'AppData', 'Local');
const userData = path.join(testAppData, 'Antigravity');

fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(testLocal, { recursive: true });

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

console.log('Starting Antigravity with stdio pipe to capture output...');
const child = spawn(exe, [
  `--user-data-dir=${userData}`,
  '--verbose'
], {
  env: cleanEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});

child.stdout.on('data', (d) => console.log('[STDOUT]', d.toString()));
child.stderr.on('data', (d) => console.log('[STDERR]', d.toString()));
child.on('exit', (code, sig) => console.log(`[EXIT] code: ${code}, signal: ${sig}`));

setTimeout(() => {
  console.log('Timeout reached. Killing child if alive.');
  child.kill();
  process.exit(0);
}, 6000);
