import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = 'C:/IA/Antigravity HUB/ai-dev-hub';
const unpackedBases = [
  path.join(process.env.LOCALAPPDATA || 'C:/Users/Deco/AppData/Local', 'Programs', 'ai-dev-hub-root', 'resources', 'app.asar.unpacked'),
  path.join(root, 'dist-desktop', 'win-unpacked', 'resources', 'app.asar.unpacked'),
  path.join(root, 'decohub_unpacked')
];

for (const base of unpackedBases) {
  if (fs.existsSync(base)) {
    console.log(`Syncing to ${base}...`);
    const serverDist = path.join(base, 'server', 'dist');
    const clientDist = path.join(base, 'client', 'dist');
    fs.mkdirSync(serverDist, { recursive: true });
    fs.mkdirSync(clientDist, { recursive: true });

    spawnSync('robocopy', [path.join(root, 'server', 'dist'), serverDist, '/MIR', '/NP', '/NDL', '/NFL'], { windowsHide: true });
    spawnSync('robocopy', [path.join(root, 'client', 'dist'), clientDist, '/MIR', '/NP', '/NDL', '/NFL'], { windowsHide: true });
    console.log(`Successfully synced to ${base}`);
  } else {
    console.log(`Skipping (not found): ${base}`);
  }
}
