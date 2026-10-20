import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const targetId = 'd1b32495-fc9b-4473-baf3-ba86fe564882';
const home = os.homedir();
const roaming = path.join(process.env.APPDATA, 'Antigravity');
const geminiDir = path.join(home, '.gemini');

function searchDir(dir, maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') || depth === 0) searchDir(full, maxDepth, depth + 1);
      } else if (e.isFile() && (e.name.endsWith('.json') || e.name.endsWith('.txt') || e.name.endsWith('.log'))) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          if (content.includes(targetId)) {
            console.log('FOUND IN FILE:', full);
          }
        } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "find_project_id",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:find_project_id]", err);
      }
    }
      }
    }
  } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "find_project_id",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:find_project_id]", err);
      }
    }
}

searchDir(geminiDir);
searchDir(roaming);
console.log('Search completed.');
