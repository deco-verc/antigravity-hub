import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { getHubDataDir } from '../src/db.js';

describe('Desktop & Runtime HealthCheck Suite', () => {
  test('should verify SQLite hub storage directory and write permissions', () => {
    const hubDir = getHubDataDir();
    assert.ok(fs.existsSync(hubDir), `Hub directory ${hubDir} must exist`);

    const probeFile = path.join(hubDir, '.probe_test');
    fs.writeFileSync(probeFile, 'health-check-ok', 'utf-8');
    const content = fs.readFileSync(probeFile, 'utf-8');
    assert.strictEqual(content, 'health-check-ok');
    fs.unlinkSync(probeFile);
  });

  test('should verify database hub.db exists and is accessible', () => {
    const hubDir = getHubDataDir();
    const dbPath = path.join(hubDir, 'hub.db');
    assert.ok(fs.existsSync(dbPath), `hub.db file must exist at ${dbPath}`);
    const stats = fs.statSync(dbPath);
    assert.ok(stats.size > 0, 'hub.db size must be greater than zero');
  });

  test('should verify core project files exist', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const requiredFiles = [
      'package.json',
      'start.js',
      'desktop/main.cjs',
      '.gitignore',
      '.ai-dev-hub/project.md',
      '.ai-dev-hub/architecture.md',
      '.ai-dev-hub/tasks.md'
    ];

    for (const f of requiredFiles) {
      const fullPath = path.join(projectRoot, f);
      assert.ok(fs.existsSync(fullPath), `Required project file ${f} must exist`);
    }
  });
});
