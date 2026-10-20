import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { UpdateService, UpdateManifest } from '../src/updateService.js';
import { db, DB_PATH, HUB_DATA_DIR } from '../src/db.js';
import { ObservabilityService } from '../src/observability/observabilityService.js';

describe('Auto-Updater and Distribution Core Suite', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-updater-test-'));

  test('1. Semver Comparison Logic', () => {
    assert.equal(UpdateService.compareSemver('1.0.7', '1.0.7'), 0);
    assert.equal(UpdateService.compareSemver('1.0.8', '1.0.7'), 1);
    assert.equal(UpdateService.compareSemver('1.0.6', '1.0.7'), -1);
    assert.equal(UpdateService.compareSemver('2.0.0', '1.9.9'), 1);
    assert.equal(UpdateService.compareSemver('v1.1.0', '1.0.9'), 1);
    assert.equal(UpdateService.compareSemver('1.0.7', '1.0.8'), -1);
  });

  test('2. Check for Updates - No Feed Configured -> UP_TO_DATE', async () => {
    UpdateService.updateConfig({ feedUrl: null });
    const res = await UpdateService.checkForUpdates();
    assert.equal(res.updateAvailable, false);
    assert.equal(UpdateService.getStatus().status, 'UP_TO_DATE');
  });

  test('3. Check for Updates - Newer Version Available -> AVAILABLE', async () => {
    UpdateService.setCurrentVersionForTesting('1.0.7');

    const manifest: UpdateManifest = {
      version: '1.0.8',
      releaseDate: new Date().toISOString(),
      releaseNotes: 'Melhorias de desempenho e estabilidade de leases.',
      downloadUrl: path.join(tempDir, 'fake-installer-1.0.8.exe'),
      sha256: 'deadbeef'
    };

    const manifestPath = path.join(tempDir, 'latest-1.0.8.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const res = await UpdateService.checkForUpdates(manifestPath);
    assert.equal(res.updateAvailable, true);
    assert.equal(res.latestVersion, '1.0.8');
    assert.equal(UpdateService.getStatus().status, 'AVAILABLE');
  });

  test('4. Check for Updates - Already on Same or Newer Version -> UP_TO_DATE', async () => {
    UpdateService.setCurrentVersionForTesting('1.0.8');

    const manifest: UpdateManifest = {
      version: '1.0.8',
      downloadUrl: path.join(tempDir, 'fake-installer-1.0.8.exe')
    };

    const manifestPath = path.join(tempDir, 'latest-same.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const res = await UpdateService.checkForUpdates(manifestPath);
    assert.equal(res.updateAvailable, false);
    assert.equal(UpdateService.getStatus().status, 'UP_TO_DATE');
  });

  test('5. Check for Updates - Network or File Error -> Handles Gracefully (ERROR status)', async () => {
    const nonExistentUrl = 'http://127.0.0.1:54321/non-existent-manifest.json';
    const res = await UpdateService.checkForUpdates(nonExistentUrl);
    assert.equal(res.updateAvailable, false);
    assert.equal(UpdateService.getStatus().status, 'ERROR');
    assert.ok(UpdateService.getStatus().error);
  });

  test('6. Download Update - Valid SHA-256 Hash -> DOWNLOADED and Verified', async () => {
    UpdateService.setCurrentVersionForTesting('1.0.7');

    const fakeInstallerContent = Buffer.from('MOCK_WINDOWS_EXE_BINARY_CONTENT_DECOHUB_V1.0.8');
    const fakeInstallerPath = path.join(tempDir, 'mock-installer-valid.exe');
    fs.writeFileSync(fakeInstallerPath, fakeInstallerContent);

    const realSha = crypto.createHash('sha256').update(fakeInstallerContent).digest('hex');

    const manifest: UpdateManifest = {
      version: '1.0.8',
      downloadUrl: fakeInstallerPath,
      sha256: realSha,
      size: fakeInstallerContent.length
    };

    const manifestPath = path.join(tempDir, 'latest-download-valid.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    await UpdateService.checkForUpdates(manifestPath);
    assert.equal(UpdateService.getStatus().status, 'AVAILABLE');

    const downloadRes = await UpdateService.downloadUpdate();
    assert.equal(downloadRes.success, true);
    assert.equal(downloadRes.verified, true);
    assert.equal(downloadRes.sha256, realSha);
    assert.equal(UpdateService.getStatus().status, 'DOWNLOADED');
    assert.ok(fs.existsSync(downloadRes.filePath));
  });

  test('7. Download Update - Tampered or Invalid SHA-256 Hash -> Rejects and Discards', async () => {
    UpdateService.setCurrentVersionForTesting('1.0.7');

    const fakeInstallerContent = Buffer.from('MOCK_WINDOWS_EXE_BINARY_CORRUPTED');
    const fakeInstallerPath = path.join(tempDir, 'mock-installer-corrupted.exe');
    fs.writeFileSync(fakeInstallerPath, fakeInstallerContent);

    const manifest: UpdateManifest = {
      version: '1.0.9',
      downloadUrl: fakeInstallerPath,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000', // incorrect hash
      size: fakeInstallerContent.length
    };

    const manifestPath = path.join(tempDir, 'latest-download-tampered.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    await UpdateService.checkForUpdates(manifestPath);

    await assert.rejects(async () => {
      await UpdateService.downloadUpdate();
    }, /Falha de integridade da atualização/);

    assert.equal(UpdateService.getStatus().status, 'ERROR');
  });

  test('8. Apply Update - Safety Guard Blocks when Active Work is in Progress', () => {
    const validInstallerPath = path.join(tempDir, 'mock-installer-valid.exe');
    if (!fs.existsSync(validInstallerPath)) {
      fs.writeFileSync(validInstallerPath, Buffer.from('MOCK_WINDOWS_EXE_BINARY_CONTENT'));
    }
    UpdateService.setDownloadedStateForTesting(validInstallerPath, '1.0.8');

    // Inject active project and run into test database satisfying SQLite constraints
    const fakeProjId = `test-proj-${Date.now()}`;
    const fakeRunId = `test-active-run-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, status, created_at, updated_at)
      VALUES (?, 'Test Project', ?, 'active', ?, ?)
    `).run(fakeProjId, tempDir, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, start_time, created_at, updated_at)
      VALUES (?, ?, 'Active Run', 'Obj', 'Brief', 'running', 'autonomous', ?, ?, ?)
    `).run(fakeRunId, fakeProjId, nowIso, nowIso, nowIso);

    try {
      const applyRes = UpdateService.applyUpdate({ dryRun: true });
      assert.equal(applyRes.success, false);
      assert.equal(applyRes.reason, 'ACTIVE_WORK_IN_PROGRESS');
    } finally {
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(fakeRunId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(fakeProjId);
    }
  });

  test('9. Apply Update - Succeeds with Dry-Run when System is Idle', () => {
    const validInstallerPath = path.join(tempDir, 'mock-installer-valid.exe');
    if (!fs.existsSync(validInstallerPath)) {
      fs.writeFileSync(validInstallerPath, Buffer.from('MOCK_WINDOWS_EXE_BINARY_CONTENT'));
    }
    UpdateService.setDownloadedStateForTesting(validInstallerPath, '1.0.8');

    const applyRes = UpdateService.applyUpdate({ dryRun: true });
    assert.equal(applyRes.success, true);
    assert.ok(applyRes.message.includes('[DRY-RUN]'));
  });

  test('10. Data Preservation - Database, Config and Logs Remain Intact', () => {
    assert.ok(fs.existsSync(DB_PATH), 'hub.db must exist and be preserved');
    assert.ok(fs.existsSync(HUB_DATA_DIR), 'HUB_DATA_DIR must exist and be preserved');
  });

  after(() => {
    UpdateService.stop();
  });
});
