import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { PromptManager } from '../src/promptManager.js';

test('Eixo 6: Modular Rules & Antigravity 2.0 Hooks Provisioning', async (t) => {
  const tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-test-eixo6-'));

  t.after(() => {
    try {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on Windows
    }
  });

  await t.test('1. Backend SaaS Modular Rule (< 4 KB, trigger: glob)', () => {
    const content = PromptManager.getBackendSaasRuleContent();
    const byteLength = Buffer.byteLength(content, 'utf-8');

    assert.ok(byteLength < 4096, `backend-saas.md size (${byteLength} B) must be < 4 KB`);
    assert.ok(content.startsWith('---\n'), 'Must start with YAML frontmatter delimiter');
    assert.ok(content.includes('trigger: glob'), 'Must have trigger: glob frontmatter');
    assert.ok(
      content.includes('globs: "server/**, src/db/**, src/routes/**, src/services/**, *.sql"'),
      'Must target backend globs'
    );
    assert.ok(content.includes('PRAGMA journal_mode = WAL;'), 'Must include SQLite WAL pragma');
    assert.ok(content.includes('PRAGMA foreign_keys = ON;'), 'Must include foreign keys pragma');
    assert.ok(content.includes('PRAGMA busy_timeout = 5000;'), 'Must include busy_timeout pragma');
    assert.ok(content.includes('seedIfEmpty'), 'Must include seedIfEmpty invariant');
    assert.ok(content.includes('Supabase Auth'), 'Must include Supabase dual-mode');
    assert.ok(content.includes('Cloudflare Turnstile'), 'Must include Cloudflare Turnstile');
    assert.ok(content.includes('PushinPay PIX'), 'Must include PushinPay PIX');
    assert.ok(content.includes('Upstash Redis'), 'Must include Upstash Redis');
    assert.ok(content.includes('PORT_GUARD'), 'Must include PORT_GUARD');
    assert.ok(content.includes('4000-4999'), 'Must bind within 4000-4999');
    assert.ok(content.includes('GET /api/health'), 'Must isolate healthcheck to GET /api/health');
    assert.ok(content.toLowerCase().includes('parameterized queries'), 'Must enforce parameterized SQL queries');
  });

  await t.test('2. Frontend Anti-Slop Modular Rule (< 4 KB, trigger: glob)', () => {
    const content = PromptManager.getFrontendAntislopRuleContent();
    const byteLength = Buffer.byteLength(content, 'utf-8');

    assert.ok(byteLength < 4096, `frontend-antislop.md size (${byteLength} B) must be < 4 KB`);
    assert.ok(content.startsWith('---\n'), 'Must start with YAML frontmatter delimiter');
    assert.ok(content.includes('trigger: glob'), 'Must have trigger: glob frontmatter');
    assert.ok(
      content.includes('globs: "client/**, public/**, src/components/**, src/pages/**, *.tsx, *.css, *.html"'),
      'Must target frontend globs'
    );
    assert.ok(content.includes('Zero Emojis Mandate'), 'Must enforce Zero Emojis');
    assert.ok(content.includes('Zero Native Dialogs'), 'Must prohibit window.alert/confirm/prompt');
    assert.ok(content.includes(':root'), 'Must enforce semantic :root tokens');
    assert.ok(content.includes('tabular-nums'), 'Must enforce tabular-nums typography');
    assert.ok(content.includes('role="tab"'), 'Must enforce role="tab" navigation');
    assert.ok(content.includes('data-tab='), 'Must enforce data-tab attribute');
    assert.ok(content.includes('Attio Archetype'), 'Must include Attio archetype (h-9)');
    assert.ok(content.includes('n8n Archetype'), 'Must include n8n status badges');
    assert.ok(content.includes('Tally Archetype'), 'Must include Tally PIX checkout');
    assert.ok(content.includes('1440x900') && content.includes('390x844'), 'Must enforce dual viewport responsiveness');
    assert.ok(content.includes('localStorage'), 'Must enforce state persistence across reloads');
  });

  await t.test('3. Antigravity 2.0 Hooks Configuration (.agents/hooks.json)', () => {
    const hooksRaw = PromptManager.getHooksJsonContent();
    const hooksJson = JSON.parse(hooksRaw);

    assert.ok(hooksJson['decohub-pre-invocation-reminder'], 'Must define pre-invocation reminder hook');
    assert.ok(hooksJson['decohub-pre-tool-guard'], 'Must define pre-tool guard hook');
    assert.ok(hooksJson['decohub-stop-typecheck-gate'], 'Must define stop typecheck gate hook');

    assert.equal(
      hooksJson['decohub-pre-invocation-reminder'].PreInvocation[0].command,
      'node ./hooks/pre-invocation-reminder.cjs'
    );
    assert.equal(
      hooksJson['decohub-pre-tool-guard'].PreToolUse[0].hooks[0].command,
      'node ./hooks/pre-tool-ownership-guard.cjs'
    );
    assert.equal(
      hooksJson['decohub-stop-typecheck-gate'].Stop[0].command,
      'node ./hooks/stop-typecheck-gate.cjs'
    );
  });

  await t.test('4. Hook Scripts Execution & Logic', () => {
    const hooksDir = path.join(tempProjectDir, '.agents', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });

    const reminderPath = path.join(hooksDir, 'pre-invocation-reminder.cjs');
    const guardPath = path.join(hooksDir, 'pre-tool-ownership-guard.cjs');
    const stopPath = path.join(hooksDir, 'stop-typecheck-gate.cjs');

    fs.writeFileSync(reminderPath, PromptManager.getPreInvocationReminderScript(), 'utf-8');
    fs.writeFileSync(guardPath, PromptManager.getPreToolOwnershipGuardScript(), 'utf-8');
    fs.writeFileSync(stopPath, PromptManager.getStopTypecheckGateScript(), 'utf-8');

    // Test PreInvocation Reminder
    const reminderOut = execSync(`node "${reminderPath}"`, {
      input: JSON.stringify({ invocationNum: 1 }),
      encoding: 'utf-8'
    });
    const parsedReminder = JSON.parse(reminderOut);
    assert.ok(Array.isArray(parsedReminder.injectSteps), 'injectSteps must be an array');
    assert.ok(parsedReminder.injectSteps[0].ephemeralMessage.includes('DecoHUB Invariant Reminder'));

    // Test PreToolUse Guard on .env.production (DENY)
    const denyOut = execSync(`node "${guardPath}"`, {
      input: JSON.stringify({
        toolCall: {
          name: 'write_file',
          args: { Path: 'C:/project/.env.production', Content: 'SECRET=123' }
        }
      }),
      encoding: 'utf-8'
    });
    const parsedDeny = JSON.parse(denyOut);
    assert.equal(parsedDeny.decision, 'deny');
    assert.ok(parsedDeny.reason.includes('Direct modifications to .env.production are strictly blocked'));

    // Test PreToolUse Guard on normal code file (ALLOW)
    const allowOut = execSync(`node "${guardPath}"`, {
      input: JSON.stringify({
        toolCall: {
          name: 'write_file',
          args: { Path: 'C:/project/src/index.ts', Content: 'console.log("ok")' }
        }
      }),
      encoding: 'utf-8'
    });
    const parsedAllow = JSON.parse(allowOut);
    assert.equal(parsedAllow.decision, 'allow');

    // Test Stop Typecheck Gate when no tsconfig.json exists (ALLOW)
    const stopOutNoTsconfig = execSync(`node "${stopPath}"`, {
      cwd: path.join(tempProjectDir, '.agents'),
      input: JSON.stringify({ executionNum: 1 }),
      encoding: 'utf-8'
    });
    const parsedStop1 = JSON.parse(stopOutNoTsconfig);
    assert.equal(parsedStop1.decision, 'allow');

    // Test Stop Typecheck Gate when tsconfig.json exists and fails compilation (CONTINUE up to 3 retries)
    const brokenProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-broken-project-'));
    try {
      const brokenAgentsDir = path.join(brokenProjectDir, '.agents');
      const brokenHooksDir = path.join(brokenAgentsDir, 'hooks');
      fs.mkdirSync(brokenHooksDir, { recursive: true });
      const brokenStopScript = path.join(brokenHooksDir, 'stop-typecheck-gate.cjs');
      fs.writeFileSync(brokenStopScript, PromptManager.getStopTypecheckGateScript(), 'utf-8');

      // Create dummy tsconfig and broken TypeScript file
      fs.writeFileSync(
        path.join(brokenProjectDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { noEmit: true } })
      );
      fs.writeFileSync(path.join(brokenProjectDir, 'broken.ts'), 'const x: number = "broken string";');

      const retryFile = path.join(brokenProjectDir, '.ai-dev-hub', '.stop_hook_retries');

      // Retry 1: continue
      const retry1 = execSync(`node "${brokenStopScript}"`, {
        cwd: brokenAgentsDir,
        input: JSON.stringify({ executionNum: 1 }),
        encoding: 'utf-8'
      });
      const parsedR1 = JSON.parse(retry1);
      assert.equal(parsedR1.decision, 'continue');
      assert.ok(parsedR1.reason.includes('(1/3)'));
      assert.equal(fs.readFileSync(retryFile, 'utf-8').trim(), '1');

      // Retry 2: continue
      const retry2 = execSync(`node "${brokenStopScript}"`, {
        cwd: brokenAgentsDir,
        input: JSON.stringify({ executionNum: 2 }),
        encoding: 'utf-8'
      });
      const parsedR2 = JSON.parse(retry2);
      assert.equal(parsedR2.decision, 'continue');
      assert.ok(parsedR2.reason.includes('(2/3)'));
      assert.equal(fs.readFileSync(retryFile, 'utf-8').trim(), '2');

      // Retry 3: continue
      const retry3 = execSync(`node "${brokenStopScript}"`, {
        cwd: brokenAgentsDir,
        input: JSON.stringify({ executionNum: 3 }),
        encoding: 'utf-8'
      });
      const parsedR3 = JSON.parse(retry3);
      assert.equal(parsedR3.decision, 'continue');
      assert.ok(parsedR3.reason.includes('(3/3)'));
      assert.equal(fs.readFileSync(retryFile, 'utf-8').trim(), '3');

      // Retry 4 (Exceeded limit of 3): allow and cleanup retry file to prevent infinite loops
      const retry4 = execSync(`node "${brokenStopScript}"`, {
        cwd: brokenAgentsDir,
        input: JSON.stringify({ executionNum: 4 }),
        encoding: 'utf-8'
      });
      const parsedR4 = JSON.parse(retry4);
      assert.equal(parsedR4.decision, 'allow');
      assert.equal(fs.existsSync(retryFile), false, 'Retry file must be cleaned up after exceeding 3 retries');
    } finally {
      try {
        fs.rmSync(brokenProjectDir, { recursive: true, force: true });
      } catch {
        // Ignore on Windows
      }
    }
  });

  await t.test('5. Lifecycle: ensureProjectRulesFile provisions all files for Fable and cleans up for Legacy/Native', () => {
    const fableInstructions = PromptManager.buildWorkerInstructions({
      promptId: 'fable-worker-v2-flash-max',
      runtime: { projectPath: tempProjectDir },
      project: { projectName: 'Eixo 6 Project', objective: 'Test Modular Provisioning' }
    });

    // 1. Provision Fable
    const workerRulePath = PromptManager.ensureProjectRulesFile(tempProjectDir, fableInstructions.fullRuleContent);
    assert.ok(workerRulePath && fs.existsSync(workerRulePath), 'Worker rule file must exist');

    const backendRulePath = path.join(tempProjectDir, '.agents', 'rules', 'backend-saas.md');
    const frontendRulePath = path.join(tempProjectDir, '.agents', 'rules', 'frontend-antislop.md');
    const hooksJsonPath = path.join(tempProjectDir, '.agents', 'hooks.json');
    const reminderScriptPath = path.join(tempProjectDir, '.agents', 'hooks', 'pre-invocation-reminder.cjs');
    const guardScriptPath = path.join(tempProjectDir, '.agents', 'hooks', 'pre-tool-ownership-guard.cjs');
    const stopScriptPath = path.join(tempProjectDir, '.agents', 'hooks', 'stop-typecheck-gate.cjs');

    assert.ok(fs.existsSync(backendRulePath), 'backend-saas.md must be provisioned');
    assert.ok(fs.existsSync(frontendRulePath), 'frontend-antislop.md must be provisioned');
    assert.ok(fs.existsSync(hooksJsonPath), 'hooks.json must be provisioned');
    assert.ok(fs.existsSync(reminderScriptPath), 'pre-invocation-reminder.cjs must be provisioned');
    assert.ok(fs.existsSync(guardScriptPath), 'pre-tool-ownership-guard.cjs must be provisioned');
    assert.ok(fs.existsSync(stopScriptPath), 'stop-typecheck-gate.cjs must be provisioned');

    // Isolation check must pass for Fable
    const fableIsolation = PromptManager.validateWorkspacePromptIsolation(tempProjectDir, 'fable-worker-v2-flash-max');
    assert.equal(fableIsolation.valid, true, 'Fable isolation check must pass');

    // 2. Clean up when instructions is null
    const cleaned = PromptManager.ensureProjectRulesFile(tempProjectDir, null);
    assert.equal(cleaned, null);

    assert.equal(fs.existsSync(workerRulePath), false, 'decohub-worker.md must be removed');
    assert.equal(fs.existsSync(backendRulePath), false, 'backend-saas.md must be removed');
    assert.equal(fs.existsSync(frontendRulePath), false, 'frontend-antislop.md must be removed');
    assert.equal(fs.existsSync(hooksJsonPath), false, 'hooks.json must be removed');
    assert.equal(fs.existsSync(reminderScriptPath), false, 'pre-invocation-reminder.cjs must be removed');
    assert.equal(fs.existsSync(guardScriptPath), false, 'pre-tool-ownership-guard.cjs must be removed');
    assert.equal(fs.existsSync(stopScriptPath), false, 'stop-typecheck-gate.cjs must be removed');

    // Isolation check must pass for Native and Legacy
    const nativeIsolation = PromptManager.validateWorkspacePromptIsolation(tempProjectDir, 'native');
    assert.equal(nativeIsolation.valid, true, 'Native isolation check must pass after cleanup');

    const legacyIsolation = PromptManager.validateWorkspacePromptIsolation(tempProjectDir, 'legacy');
    assert.equal(legacyIsolation.valid, true, 'Legacy isolation check must pass after cleanup');
  });
});
