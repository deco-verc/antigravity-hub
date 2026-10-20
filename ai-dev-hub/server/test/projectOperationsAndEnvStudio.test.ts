// server/test/projectOperationsAndEnvStudio.test.ts
// Testes automatizados da FASE 11:
// - One-Click App Preview Launcher (Port allocation, Process lifecycle, Static SPA Fallback, Clean Teardown)
// - DOCSIMP .env Studio (Categorization, Mock vs Live classification, Saving & Persistence)
// - Homologation Evidence Reader & 4 Badges (Dev, UI, UX, AppSec)
// - Path Traversal Protection for Evidence Files

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ProjectOperationsService } from '../src/projectOperationsService.js';

describe('FASE 11: ProjectOperationsService, Preview Launcher & .env Studio', () => {
  let tempTestDir: string;

  before(() => {
    tempTestDir = path.join(os.tmpdir(), `decohub-ops-test-${Date.now()}`);
    fs.mkdirSync(tempTestDir, { recursive: true });
  });

  after(async () => {
    try {
      await ProjectOperationsService.stopAllPreviews();
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Port Allocation & Preview Process Lifecycle', () => {
    it('should allocate a dynamic TCP port starting from 4100 and avoid port 3001', async () => {
      const port = await ProjectOperationsService.findFreePort(4100);
      assert.ok(typeof port === 'number');
      assert.ok(port >= 4100 && port < 65535);
      assert.notEqual(port, 3001);
    });

    it('should start a Node.js project preview, verify HTTP readiness and stop cleanly', async () => {
      const projectId = `test-node-app-${Date.now()}`;
      const appDir = path.join(tempTestDir, 'node-preview-app');
      fs.mkdirSync(path.join(appDir, 'src'), { recursive: true });

      fs.writeFileSync(
        path.join(appDir, 'package.json'),
        JSON.stringify({
          name: 'preview-node-app',
          type: 'module',
          scripts: { start: 'node src/server.js' }
        })
      );

      fs.writeFileSync(
        path.join(appDir, 'src', 'server.js'),
        `import http from 'node:http';
const port = process.env.PORT || 4201;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>DecoHUB Preview OK</h1>');
});
server.listen(port, '127.0.0.1', () => {
  console.log('Server listening on port ' + port);
});
`
      );

      // Start preview
      const status = await ProjectOperationsService.startPreview(projectId, appDir, { timeoutMs: 12000 });
      assert.strictEqual(status.running, true);
      assert.ok(status.port && status.port >= 4100);
      assert.ok(status.url && (status.url.startsWith('http://127.0.0.1:') || status.url.startsWith('http://localhost:')));
      assert.ok(status.pid && status.pid > 0);

      // Check preview status retrieval
      const retrieved = ProjectOperationsService.getPreviewStatus(projectId);
      assert.strictEqual(retrieved.running, true);
      assert.strictEqual(retrieved.port, status.port);

      // Verify HTTP response directly from the running preview
      const res = await fetch(status.url);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('DecoHUB Preview OK'));

      // Stop preview
      const stopped = await ProjectOperationsService.stopPreview(projectId);
      assert.strictEqual(stopped, true);

      // Status should now be stopped
      const afterStop = ProjectOperationsService.getPreviewStatus(projectId);
      assert.strictEqual(afterStop.running, false);
      assert.strictEqual(afterStop.url, undefined);
    });

    it('should fallback to lightweight internal static server for SPA projects without backend scripts', async () => {
      const projectId = `test-static-spa-${Date.now()}`;
      const spaDir = path.join(tempTestDir, 'static-spa');
      fs.mkdirSync(spaDir, { recursive: true });

      fs.writeFileSync(
        path.join(spaDir, 'index.html'),
        `<!DOCTYPE html>
<html>
<head><title>Static SPA</title></head>
<body><div id="app">Static App Loaded</div></body>
</html>`
      );

      const status = await ProjectOperationsService.startPreview(projectId, spaDir, { timeoutMs: 8000 });
      assert.strictEqual(status.running, true);
      assert.ok(status.url);
      assert.strictEqual(status.entrypoint, 'Static SPA Preview (http-server)');

      // Verify static HTML delivery
      const res = await fetch(status.url);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('Static App Loaded'));

      // Stop static preview
      const stopped = await ProjectOperationsService.stopPreview(projectId);
      assert.strictEqual(stopped, true);
    });
  });

  describe('2. DOCSIMP .env Studio (Categorization & Mock vs Live Classification)', () => {
    it('should parse, categorize and classify mock vs live environment variables', async () => {
      const projectId = 'test-env-proj';
      const projDir = path.join(tempTestDir, 'env-project');
      fs.mkdirSync(projDir, { recursive: true });

      fs.writeFileSync(
        path.join(projDir, '.env.example'),
        `# Pagamentos
STRIPE_SECRET_KEY=sk_test_placeholder_key_12345
STRIPE_WEBHOOK_SECRET=whsec_mock_token

# IA
GEMINI_API_KEY=AIzaSy_mock_gemini_key

# Database
DATABASE_URL=postgres://user:password@localhost:5432/appdb

# Server
PORT=3000
`
      );

      fs.writeFileSync(
        path.join(projDir, '.env'),
        `STRIPE_SECRET_KEY=sk_test_placeholder_key_12345
DATABASE_URL=postgres://live_prod_user:strong_password@prod.db.com:5432/main
`
      );

      const envData = ProjectOperationsService.getEnvKeys(projectId, projDir);
      assert.strictEqual(envData.projectId, projectId);
      assert.strictEqual(envData.totalKeys, 5);

      const stripeKey = envData.keys.find(k => k.key === 'STRIPE_SECRET_KEY');
      assert.ok(stripeKey);
      assert.strictEqual(stripeKey.category, 'PAYMENTS');
      assert.strictEqual(stripeKey.rawStatus, 'MOCK_FALLBACK');
      assert.strictEqual(stripeKey.isSecret, true);

      const dbKey = envData.keys.find(k => k.key === 'DATABASE_URL');
      assert.ok(dbKey);
      assert.strictEqual(dbKey.category, 'DATABASE_AUTH');
      assert.strictEqual(dbKey.rawStatus, 'LIVE');

      const geminiKey = envData.keys.find(k => k.key === 'GEMINI_API_KEY');
      assert.ok(geminiKey);
      assert.strictEqual(geminiKey.category, 'AI_MODELS');
      assert.strictEqual(geminiKey.rawStatus, 'MOCK_FALLBACK');

      const portKey = envData.keys.find(k => k.key === 'PORT');
      assert.ok(portKey);
      assert.strictEqual(portKey.category, 'SERVER_CONFIG');
      assert.strictEqual(portKey.isSecret, false);
    });

    it('should save updated keys to .env and promote mock keys to LIVE when provided real keys', async () => {
      const projectId = 'test-env-save';
      const projDir = path.join(tempTestDir, 'env-save-project');
      fs.mkdirSync(projDir, { recursive: true });

      fs.writeFileSync(
        path.join(projDir, '.env'),
        'STRIPE_SECRET_KEY=sk_test_mock\n'
      );

      // Save real production credentials
      const saveRes = await ProjectOperationsService.saveEnvKeys(projectId, projDir, {
        STRIPE_SECRET_KEY: 'sk_live_51Pabcdef9876543210RealKeyProd',
        PORT: '4500'
      });

      assert.strictEqual(saveRes.success, true);

      // Read back
      const updatedData = ProjectOperationsService.getEnvKeys(projectId, projDir);
      const updatedStripe = updatedData.keys.find(k => k.key === 'STRIPE_SECRET_KEY');
      assert.ok(updatedStripe);
      assert.strictEqual(updatedStripe.rawStatus, 'LIVE');
      assert.strictEqual(updatedStripe.value, 'sk_live_51Pabcdef9876543210RealKeyProd');

      // Verify file on disk
      const savedContent = fs.readFileSync(path.join(projDir, '.env'), 'utf-8');
      assert.ok(savedContent.includes('STRIPE_SECRET_KEY=sk_live_51Pabcdef9876543210RealKeyProd'));
      assert.ok(savedContent.includes('PORT=4500'));
    });
  });

  describe('3. Homologation Evidence Reader & Badges', () => {
    it('should read reports, build 4 certification badges, and calculate overall score', () => {
      const projDir = path.join(tempTestDir, 'evidence-proj');
      const evidenceDir = path.join(projDir, '.ai-dev-hub', 'evidence');
      fs.mkdirSync(evidenceDir, { recursive: true });

      // Create reports
      fs.writeFileSync(
        path.join(evidenceDir, 'user-journey-report.json'),
        JSON.stringify({
          passed: true,
          score: 100,
          summary: 'Todas as jornadas executadas com sucesso',
          totalActions: 12
        })
      );

      fs.writeFileSync(
        path.join(evidenceDir, 'security-pentest-report.json'),
        JSON.stringify({
          passed: true,
          score: 100,
          summary: 'Nenhuma vulnerabilidade detectada (SQLi, XSS, Path Traversal limpos)'
        })
      );

      // Create dummy screenshot
      fs.writeFileSync(path.join(evidenceDir, 'journey-step-1.png'), Buffer.from('fake-png-bytes'));

      const evidence = ProjectOperationsService.getHomologationEvidence({
        id: 'ev-proj',
        name: 'Evidence App',
        path: projDir
      });

      assert.strictEqual(evidence.projectId, 'ev-proj');
      assert.strictEqual(evidence.projectName, 'Evidence App');
      assert.strictEqual(evidence.badges.length, 4);

      const devBadge = evidence.badges.find(b => b.id === 'dev_tests');
      assert.ok(devBadge);
      assert.strictEqual(devBadge.status, 'PASSED');

      const uiBadge = evidence.badges.find(b => b.id === 'ui_anti_slop');
      assert.ok(uiBadge);
      assert.strictEqual(uiBadge.status, 'PASSED');

      const uxBadge = evidence.badges.find(b => b.id === 'ux_journey');
      assert.ok(uxBadge);
      assert.strictEqual(uxBadge.status, 'PASSED');

      const pentestBadge = evidence.badges.find(b => b.id === 'appsec_pentest');
      assert.ok(pentestBadge);
      assert.strictEqual(pentestBadge.status, 'PASSED');

      assert.strictEqual(evidence.overallPassed, true);
      assert.strictEqual(evidence.overallScore, 100);

      // Verify screenshot listing
      assert.strictEqual(evidence.screenshots.length, 1);
      assert.strictEqual(evidence.screenshots[0].filename, 'journey-step-1.png');
    });

    it('should strictly reject path traversal attacks when serving evidence files', () => {
      const projDir = path.join(tempTestDir, 'evidence-proj');

      // Traversal attacks
      assert.throws(
        () => ProjectOperationsService.getEvidenceFilePath(projDir, '../../package.json'),
        /Acesso negado|Nome de arquivo inválido/
      );

      assert.throws(
        () => ProjectOperationsService.getEvidenceFilePath(projDir, '..\\..\\windows\\system32'),
        /Acesso negado|Nome de arquivo inválido/
      );

      assert.throws(
        () => ProjectOperationsService.getEvidenceFilePath(projDir, 'subfolder/bad.png'),
        /Acesso negado|Nome de arquivo inválido/
      );

      // Non-allowed extension
      assert.throws(
        () => ProjectOperationsService.getEvidenceFilePath(projDir, 'malware.exe'),
        /Extensão de arquivo não permitida/
      );

      // Legitimate evidence file
      const safe = ProjectOperationsService.getEvidenceFilePath(projDir, 'journey-step-1.png');
      assert.ok(safe.filePath.endsWith('journey-step-1.png'));
      assert.strictEqual(safe.mimeType, 'image/png');
    });
  });
});
