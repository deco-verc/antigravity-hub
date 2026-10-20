import fs from 'node:fs';
import path from 'node:path';

const asarPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'app.asar');
const buf = fs.readFileSync(asarPath);
const str = buf.toString('utf-8');

const idx = str.indexOf('accounts.google.com');
if (idx !== -1) {
  const snippet = str.substring(Math.max(0, idx - 500), Math.min(str.length, idx + 1000));
  console.log('Snippet around accounts.google.com:');
  console.log(snippet);
} else {
  console.log('Not found in utf-8');
}
