// scripts/backup_production_data.mjs
// Creates an atomic, read-only backup of the production DecoHUB database and settings.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const homeDir = os.homedir();
const prodDir = path.join(homeDir, '.ai-dev-hub');
const prodDbPath = path.join(prodDir, 'hub.db');

console.log('========================================================================');
console.log('💾 DECOHUB — BACKUP DE SEGURANÇA DOS DADOS DE PRODUÇÃO');
console.log('========================================================================\n');

if (!fs.existsSync(prodDbPath)) {
  console.error(`❌ Banco de produção não encontrado em: ${prodDbPath}`);
  process.exit(1);
}

// 1. Read-only verification of production database
const db = new DatabaseSync(prodDbPath, { readOnly: true });
const projectsCount = db.prepare('SELECT count(*) as count FROM projects').get().count;
const runsCount = db.prepare('SELECT count(*) as count FROM autonomous_runs').get().count;
const sessionsCount = db.prepare('SELECT count(*) as count FROM sessions').get().count;
const messagesCount = db.prepare('SELECT count(*) as count FROM messages').get().count;
const agentSessionsCount = db.prepare('SELECT count(*) as count FROM agent_sessions').get().count;

console.log(`📊 Inventário Atual de Produção:`);
console.log(`   - Projetos: ${projectsCount}`);
console.log(`   - Autonomous Runs Históricos: ${runsCount}`);
console.log(`   - Sessões de Chat: ${sessionsCount}`);
console.log(`   - Mensagens de Chat: ${messagesCount}`);
console.log(`   - Sessões de Agente Persistentes: ${agentSessionsCount}`);

// 2. Prepare backup destination
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(prodDir, 'repair-backups', `pre-107-${timestamp}`);
fs.mkdirSync(backupDir, { recursive: true });

// 3. Copy files with checksum
const filesToBackup = ['hub.db', 'hub.db-wal', 'hub.db-shm', 'config.json'];
const manifest = {
  timestamp: new Date().toISOString(),
  counts: { projectsCount, runsCount, sessionsCount, messagesCount, agentSessionsCount },
  files: {}
};

for (const fileName of filesToBackup) {
  const src = path.join(prodDir, fileName);
  if (fs.existsSync(src)) {
    const dest = path.join(backupDir, fileName);
    fs.copyFileSync(src, dest);
    const content = fs.readFileSync(dest);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    manifest.files[fileName] = { sizeBytes: content.length, sha256 };
    console.log(`   ✓ Copiado: ${fileName} (${content.length} bytes, SHA256: ${sha256.slice(0, 12)}...)`);
  }
}

// 4. Save manifest
fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n✅ Backup concluído com sucesso em:`);
console.log(`   ${backupDir}\n`);
