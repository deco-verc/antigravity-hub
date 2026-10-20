/**
 * Test Environment Setup & Database Isolation
 * 
 * Ensures tests NEVER touch or pollute the production ~/.ai-dev-hub/hub.db.
 * Allocates a pristine temporary directory for AI_DEV_HUB_DATA_DIR during test execution.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (!process.env.AI_DEV_HUB_DATA_DIR) {
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-isolated-test-hub-'));
  process.env.AI_DEV_HUB_DATA_DIR = isolatedDir;
  
  // Register cleanup on process exit
  process.on('exit', () => {
    try {
      if (fs.existsSync(isolatedDir)) {
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      }
    } catch {}
  });
}
