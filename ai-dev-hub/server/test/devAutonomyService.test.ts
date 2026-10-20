import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';
import { PolicyEngine } from '../src/policyEngine.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';

describe('DevAutonomyService — Development Autonomy & Trust Suite', () => {
  const tmpDir = path.join(os.tmpdir(), `test-dev-autonomy-${Date.now()}`);

  before(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "devAutonomyService.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:devAutonomyService.test]", err);
      }
    }
  });

  test('1. detectEnvironment identifies npm, package.json scripts and stack', () => {
    const projPath = path.join(tmpDir, 'node-express-app');
    fs.mkdirSync(projPath, { recursive: true });
    fs.writeFileSync(
      path.join(projPath, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        scripts: {
          test: 'node --test',
          build: 'echo build',
          dev: 'node index.js'
        },
        dependencies: {
          express: '^4.21.0'
        }
      }, null, 2)
    );
    fs.writeFileSync(path.join(projPath, 'package-lock.json'), '{}');

    const env = DevAutonomyService.detectEnvironment(projPath);
    assert.strictEqual(env.packageManager, 'npm');
    assert.strictEqual(env.stack, 'express');
    assert.strictEqual(env.testScript, 'node --test');
    assert.strictEqual(env.buildScript, 'echo build');
    assert.strictEqual(env.hasTests, true);
    assert.strictEqual(env.lockfile, 'package-lock.json');
  });

  test('2. detectEnvironment identifies pnpm and react stack', () => {
    const projPath = path.join(tmpDir, 'react-pnpm-app');
    fs.mkdirSync(projPath, { recursive: true });
    fs.writeFileSync(
      path.join(projPath, 'package.json'),
      JSON.stringify({
        name: 'react-app',
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0'
        }
      }, null, 2)
    );
    fs.writeFileSync(path.join(projPath, 'pnpm-lock.yaml'), '');

    const env = DevAutonomyService.detectEnvironment(projPath);
    assert.strictEqual(env.packageManager, 'pnpm');
    assert.strictEqual(env.stack, 'react');
    assert.strictEqual(env.lockfile, 'pnpm-lock.yaml');
  });

  test('3. detectEnvironment identifies python stack from requirements.txt', () => {
    const projPath = path.join(tmpDir, 'python-app');
    fs.mkdirSync(projPath, { recursive: true });
    fs.writeFileSync(path.join(projPath, 'requirements.txt'), 'pytest>=7.0.0\nflask>=2.0.0\n');
    fs.mkdirSync(path.join(projPath, 'tests'), { recursive: true });

    const env = DevAutonomyService.detectEnvironment(projPath);
    assert.strictEqual(env.packageManager, 'pip');
    assert.strictEqual(env.stack, 'python');
    assert.strictEqual(env.hasTests, true);
    assert.strictEqual(env.lockfile, 'requirements.txt');
  });

  test('4. isProjectTrusted and hasFullDevAutonomy read and persist in SQLite', () => {
    const testId = `proj-trust-test-${Date.now()}`;
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, stack, status, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, 'Trust Test Project', ?, 'Test objective', 'node', 'active', 1, 1, ?, ?)
    `).run(testId, path.join(tmpDir, 'trust-proj'), nowIso, nowIso);

    assert.strictEqual(DevAutonomyService.isProjectTrusted(testId), true);
    assert.strictEqual(DevAutonomyService.hasFullDevAutonomy(testId), true);

    // Disable autonomy
    DevAutonomyService.setProjectAutonomy(testId, false, false);
    assert.strictEqual(DevAutonomyService.isProjectTrusted(testId), false);
    assert.strictEqual(DevAutonomyService.hasFullDevAutonomy(testId), false);

    // Re-enable
    DevAutonomyService.setProjectAutonomy(testId, true, true);
    assert.strictEqual(DevAutonomyService.isProjectTrusted(testId), true);
    assert.strictEqual(DevAutonomyService.hasFullDevAutonomy(testId), true);
  });

  test('5. Global default autonomy can be queried and updated in system_settings', () => {
    const current = DevAutonomyService.getGlobalDefaultAutonomy();
    assert.strictEqual(typeof current, 'boolean');

    DevAutonomyService.setGlobalDefaultAutonomy(true);
    assert.strictEqual(DevAutonomyService.getGlobalDefaultAutonomy(), true);

    DevAutonomyService.setGlobalDefaultAutonomy(false);
    assert.strictEqual(DevAutonomyService.getGlobalDefaultAutonomy(), false);

    // Restore to true
    DevAutonomyService.setGlobalDefaultAutonomy(true);
    assert.strictEqual(DevAutonomyService.getGlobalDefaultAutonomy(), true);
  });

  test('6. buildAutonomyGuidelinesBlock generates required operational directives', () => {
    const projPath = path.join(tmpDir, 'node-express-app');
    const block = DevAutonomyService.buildAutonomyGuidelinesBlock(projPath, 'App Teste');

    assert.ok(block.includes('AUTONOMIA TOTAL DE DESENVOLVIMENTO'), 'Must contain header');
    assert.ok(block.includes('INSTALAÇÃO INTELIGENTE DE DEPENDÊNCIAS'), 'Must contain smart dependencies');
    assert.ok(block.includes('TESTES TOTALMENTE AUTOMÁTICOS'), 'Must contain automated tests section');
    assert.ok(block.includes('CICLO DE AUTOCORREÇÃO'), 'Must contain self-healing section');
    assert.ok(block.includes('npm install'), 'Must mention npm commands');
    assert.ok(block.includes('PROIBIDO: Pacotes globais'), 'Must forbid global packages');
  });

  test('7. PolicyEngine treats local package install as GREEN under fullDevAutonomy', () => {
    const regularCmd = 'npm install date-fns';
    const evalWithout = PolicyEngine.evaluateCommand(regularCmd);
    // By default without option date-fns matches yellow
    assert.strictEqual(evalWithout.riskLevel, 'yellow');

    const evalWith = PolicyEngine.evaluateCommand(regularCmd, { fullDevAutonomy: true });
    assert.strictEqual(evalWith.riskLevel, 'green');
    assert.strictEqual(evalWith.requiresHumanApproval, false);
    assert.strictEqual(evalWith.isHardBlocked, false);
  });

  test('8. PolicyEngine strictly preserves RED blocks even under fullDevAutonomy', () => {
    const dangerousCmds = [
      'rm -rf /var/data',
      'git push --force origin main',
      'drop database production',
      'stripe checkout charge 500',
      'cat credentials.json'
    ];

    for (const cmd of dangerousCmds) {
      const evalRes = PolicyEngine.evaluateCommand(cmd, { fullDevAutonomy: true });
      assert.strictEqual(evalRes.riskLevel, 'red', `Expected ${cmd} to stay RED`);
      assert.strictEqual(evalRes.requiresHumanApproval, true);
      assert.strictEqual(evalRes.isHardBlocked, true);
    }
  });

  test('9. EngineeringContextService injects Principle 5 into task package', () => {
    const projPath = path.join(tmpDir, 'node-express-app');
    const pkg = EngineeringContextService.prepareTaskContext({
      projectPath: projPath,
      projectName: 'Test App',
      projectObjective: 'Build web app',
      task: {
        id: 'task-test-autonomy',
        title: 'Criar Interface e Instalar Lib',
        description: 'Instalar lib e rodar testes',
        criteria: ['Lib instalada', 'Testes passando'],
        verificationCommand: 'npm test',
        doneWhen: 'npm test com código 0'
      }
    });

    assert.ok(pkg.formattedPromptBlock.includes('OPERATIONAL AUTONOMY'), 'Must include Principle 5 in prompt block');
    assert.ok(pkg.formattedPromptBlock.includes('INSTALAÇÃO INTELIGENTE DE DEPENDÊNCIAS'), 'Must include smart dependencies');
    assert.ok(pkg.formattedPromptBlock.includes('CICLO DE AUTOCORREÇÃO'), 'Must include self-healing');
    assert.strictEqual(pkg.preflightStatus, 'READY');
  });
});
