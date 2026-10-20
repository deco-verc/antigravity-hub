import fs from 'node:fs';
import path from 'node:path';

const brainDir = path.join(process.env.USERPROFILE || '', '.gemini', 'antigravity', 'brain');
const entries = fs.readdirSync(brainDir, { withFileTypes: true }).filter(d => d.isDirectory());
console.log('Total de diretórios no brain:', entries.length);

let stormCount = 0;
const categories = {
  'Worker — Continuity App': 0,
  'Supervisor — Mode Switch': 0,
  'DecoHUB — Supervisor / Builder Nativo': 0,
  'Worker Probe Ping': 0,
  'Outros testes temporários': 0
};
let minTime = Infinity;
let maxTime = -Infinity;

for (const e of entries) {
  const dirPath = path.join(brainDir, e.name);
  const tPath = path.join(dirPath, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(tPath)) continue;
  try {
    const stat = fs.statSync(tPath);
    const mtime = stat.mtimeMs;
    const fd = fs.openSync(tPath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const firstChunk = buf.toString('utf-8', 0, bytesRead);
    const firstLine = firstChunk.split('\n')[0];
    if (!firstLine) continue;
    const json = JSON.parse(firstLine);
    const text = String(json.content || '');

    const isStorm = text.includes('Iniciando worker') ||
      text.includes('Prompt inicial de planejamento') ||
      text.includes('Você é o Builder Antigravity') ||
      text.includes('Sessão persistente do Worker') ||
      text.includes('Ping de prontidão') ||
      text.includes('Validador Documentos') ||
      text.includes('Abacate X') ||
      text.includes('Calculadora Modular');

    if (isStorm) {
      stormCount++;
      if (mtime < minTime) minTime = mtime;
      if (mtime > maxTime) maxTime = mtime;

      if (text.includes('Continuity') || text.includes('Iniciando worker')) {
        categories['Worker — Continuity App']++;
      } else if (text.includes('Mode Switch') || text.includes('Prompt inicial de planejamento')) {
        categories['Supervisor — Mode Switch']++;
      } else if (text.includes('Você é o Builder Antigravity') || text.includes('Supervisor')) {
        categories['DecoHUB — Supervisor / Builder Nativo']++;
      } else if (text.includes('Ping de prontidão')) {
        categories['Worker Probe Ping']++;
      } else {
        categories['Outros testes temporários']++;
      }
    }
  } catch {}
}

console.log('Total aproximado de conversas da tempestade:', stormCount);
console.log('Classificação detalhada:', JSON.stringify(categories, null, 2));
console.log('Janela temporal da tempestade:', new Date(minTime).toISOString(), 'até', new Date(maxTime).toISOString());
