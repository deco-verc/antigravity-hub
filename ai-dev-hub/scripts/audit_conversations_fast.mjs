import fs from 'node:fs';
import path from 'node:path';

const brainDir = 'C:\\Users\\Deco\\.gemini\\antigravity\\brain';
const dirs = fs.readdirSync(brainDir);
const start = Date.now();
const results = [];

for (const d of dirs) {
  const tPath = path.join(brainDir, d, '.system_generated', 'logs', 'transcript.jsonl');
  if (fs.existsSync(tPath)) {
    try {
      const stat = fs.statSync(tPath);
      // read first 2KB
      const fd = fs.openSync(tPath, 'r');
      const buf = Buffer.alloc(2048);
      const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      const str = buf.toString('utf8', 0, bytesRead);
      const firstLine = str.split('\n')[0];
      if (firstLine) {
        const json = JSON.parse(firstLine);
        const text = (json.content || '').slice(0, 120).replace(/\r?\n/g, ' ');
        results.push({
          conversationId: d,
          mtime: stat.mtime.toISOString(),
          firstText: text
        });
      }
    } catch {}
  }
}

const breakdown = {};
for (const r of results) {
  let cat = 'Other';
  const txt = r.firstText.toLowerCase();
  if (txt.includes('mode switch')) cat = 'Supervisor — Mode Switch';
  else if (txt.includes('continuity')) cat = 'Worker — Continuity App';
  else if (txt.includes('decohub — supervisor')) cat = 'DecoHUB — Supervisor';
  else if (txt.includes('abacate')) cat = 'Abacate X Test';
  else if (txt.includes('banana')) cat = 'Banana Y Test';
  else if (txt.includes('validador-documentos') || txt.includes('validador de documentos')) cat = 'Validador Documentos Test';
  else if (txt.includes('ping de prontidão')) cat = 'Worker Probe Ping';
  else if (txt.includes('supervisor persistente')) cat = 'Supervisor Persistente';
  else if (txt.includes('você é o builder')) cat = 'Builder Antigravity Default';
  else if (txt.includes('iniciando worker')) cat = 'Iniciando Worker';
  breakdown[cat] = (breakdown[cat] || 0) + 1;
}

console.log(`Audited ${results.length} total conversations in ${Date.now() - start}ms.`);
console.log('Breakdown by origin/content:');
console.table(breakdown);
