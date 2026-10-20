import fs from 'node:fs';
import path from 'node:path';

const asarPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar');
const str = fs.readFileSync(asarPath, 'utf-8');

let pos = 0;
while (true) {
  const idx = str.indexOf('ANTIGRAVITY_OPEN_URL', pos);
  if (idx === -1) break;
  console.log('--- FOUND AT', idx, '---');
  console.log(str.substring(Math.max(0, idx - 200), Math.min(str.length, idx + 600)));
  pos = idx + 21;
  if (pos > 5000000) break;
}
