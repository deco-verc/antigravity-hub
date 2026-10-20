import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const exe = 'C:\\Users\\Deco\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';

console.log('Antigravity exe exists:', fs.existsSync(exe));

try {
  const out = execSync(`"${exe}" --help`, { encoding: 'utf-8', timeout: 5000 });
  console.log('Help output length:', out.length);
  console.log(out.slice(0, 1000));
} catch (e) {
  console.log('Exec error:', e.message);
  if (e.stdout) console.log('Stdout:', e.stdout);
  if (e.stderr) console.log('Stderr:', e.stderr);
}
