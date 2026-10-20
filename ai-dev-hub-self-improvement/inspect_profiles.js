import fs from 'node:fs';
import path from 'node:path';

const profilesDir = 'C:\\Users\\Deco\\.ai-dev-hub\\profiles';
console.log('Profiles in dir:', fs.readdirSync(profilesDir));

for (const p of fs.readdirSync(profilesDir)) {
  const full = path.join(profilesDir, p);
  console.log('\n--- Profile:', p, '---');
  function walk(dir, depth = 0) {
    if (depth > 3) return;
    try {
      for (const f of fs.readdirSync(dir)) {
        const item = path.join(dir, f);
        const rel = path.relative(full, item);
        console.log('  '.repeat(depth) + rel);
        if (fs.statSync(item).isDirectory()) {
          walk(item, depth + 1);
        }
      }
    } catch {}
  }
  walk(full, 0);
}
