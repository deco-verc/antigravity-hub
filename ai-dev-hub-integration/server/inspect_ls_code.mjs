import fs from 'node:fs';
import path from 'node:path';

const asarPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar');
const str = fs.readFileSync(asarPath, 'utf-8');
const idx = str.indexOf('const OPEN_URL_PATTERN');
if (idx !== -1) {
  console.log(str.substring(idx - 100, idx + 2500));
}
