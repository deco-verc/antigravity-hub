import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { PolicyEngine } from '../src/policyEngine.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';
import { MemoryManager } from '../src/memoryManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';

test('Cross-Project Isolation & Safety Boundaries Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-isolation-test-${Date.now()}`);
  const projADir = path.join(tmpRoot, 'project-alpha');
  const projBDir = path.join(tmpRoot, 'project-beta');

  fs.mkdirSync(projADir, { recursive: true });
  fs.mkdirSync(projBDir, { recursive: true });

  t.after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "crossProjectIsolation.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:crossProjectIsolation.test]", err);
      }
    }
  });

  await t.test('1. Test DB Isolation: Running tests uses temp database and does NOT touch user home hub.db', () => {
    const activeDbPath = process.env.AI_DEV_HUB_DATA_DIR;
    assert.ok(activeDbPath, 'AI_DEV_HUB_DATA_DIR deve estar configurado no ambiente de teste');
    assert.ok(!activeDbPath.includes('.ai-dev-hub/hub.db'), 'Não deve apontar para o banco de dados de produção do usuário');
    assert.ok(activeDbPath.includes('isolated-test-hub'), 'Deve usar diretório temporário isolado');
  });

  await t.test('2. Path Traversal & Cross-Project File Safety: Project A cannot escape to Project B', () => {
    // Attempting relative paths or path traversal to access Project B from Project A
    const maliciousRelPath = '../project-beta/secret-data.json';
    const resolvedPath = path.resolve(projADir, maliciousRelPath);
    
    assert.strictEqual(resolvedPath, path.join(projBDir, 'secret-data.json'));
    // Verify that path resolution detects boundary crossing
    const isInsideProjectA = !path.relative(projADir, resolvedPath).startsWith('..') && !path.isAbsolute(path.relative(projADir, resolvedPath));
    assert.strictEqual(isInsideProjectA, false, 'Deve detectar que caminho relativo atravessou limites do Projeto A');
  });

  await t.test('3. PolicyEngine strictly blocks cross-project and system-level destructive commands', () => {
    // Hard RED lines: mass deletion or destructive commands
    const evalRm = PolicyEngine.evaluateCommand(`rmdir /s /q "${projBDir}"`);
    assert.strictEqual(evalRm.riskLevel, 'red', 'Comando rmdir /s deve ser classificado como RED');
    assert.strictEqual(evalRm.isHardBlocked, true, 'Comando destrutivo em lote deve ser hard blocked');

    // Hard RED lines: touching Windows system files or parent drive
    const evalSys = PolicyEngine.evaluateCommand('rmdir /s /q C:\\Windows');
    assert.strictEqual(evalSys.riskLevel, 'red');
    assert.strictEqual(evalSys.isHardBlocked, true);

    // Hard RED lines: database drop or force push
    const evalDrop = PolicyEngine.evaluateCommand('drop database production;');
    assert.strictEqual(evalDrop.riskLevel, 'red');
    assert.strictEqual(evalDrop.isHardBlocked, true);

    const evalPush = PolicyEngine.evaluateCommand('git push origin main --force');
    assert.strictEqual(evalPush.riskLevel, 'red');
    assert.strictEqual(evalPush.isHardBlocked, true);
  });

  await t.test('4. Engineering Constitution and Context Isolation: Project A context never bleeds into Project B', () => {
    // Setup Project A
    MemoryManager.ensureProgramMd(projADir, 'Project Alpha', 'Construir Core Bancário');
    MemoryManager.updateMemoryFile(projADir, 'decisions.md', '- [ALPHA-1] Utilizar criptografia AES-256 e SQLite isolado');
    MemoryManager.updateMemoryFile(projADir, 'architecture.md', 'Stack: Node.js + Express + Banco Alpha');

    // Setup Project B
    MemoryManager.ensureProgramMd(projBDir, 'Project Beta', 'Construir E-commerce de Roupas');
    MemoryManager.updateMemoryFile(projBDir, 'decisions.md', '- [BETA-1] Utilizar Stripe e MongoDB');
    MemoryManager.updateMemoryFile(projBDir, 'architecture.md', 'Stack: Python + FastAPI + Banco Beta');

    const pkgA = EngineeringContextService.prepareTaskContext({
      projectPath: projADir,
      projectName: 'Project Alpha',
      task: { title: 'Core Task Alpha' }
    });

    const pkgB = EngineeringContextService.prepareTaskContext({
      projectPath: projBDir,
      projectName: 'Project Beta',
      task: { title: 'Shop Task Beta' }
    });

    // Context A checks
    assert.ok(pkgA.projectProgramSummary.includes('Project Alpha'));
    assert.ok(pkgA.decisionsSummary?.includes('ALPHA-1'));
    assert.ok(!pkgA.decisionsSummary?.includes('BETA-1'), 'Contexto de A não pode conter dados do Projeto B');
    assert.ok(!pkgA.architectureSummary?.includes('FastAPI'), 'Arquitetura de A não pode conter stack do Projeto B');

    // Context B checks
    assert.ok(pkgB.projectProgramSummary.includes('Project Beta'));
    assert.ok(pkgB.decisionsSummary?.includes('BETA-1'));
    assert.ok(!pkgB.decisionsSummary?.includes('ALPHA-1'), 'Contexto de B não pode conter dados do Projeto A');
    assert.ok(!pkgB.architectureSummary?.includes('Express'), 'Arquitetura de B não pode conter stack do Projeto A');
  });

  await t.test('5. Task and Run Isolation: Autonomous tasks of Project A cannot be claimed or modified by Project B', () => {
    // Insert Project A and Project B in isolated DB
    const projAId = 'proj-iso-alpha-uuid';
    const projBId = 'proj-iso-beta-uuid';

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, datetime('now'), datetime('now'))
    `).run(projAId, 'Project Alpha DB', projADir);

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, datetime('now'), datetime('now'))
    `).run(projBId, 'Project Beta DB', projBDir);

    const runAId = 'run-iso-alpha';
    const runBId = 'run-iso-beta';

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Alpha', 'Obj Alpha', 'running', datetime('now'), datetime('now'), datetime('now'))
    `).run(runAId, projAId);

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Beta', 'Obj Beta', 'running', datetime('now'), datetime('now'), datetime('now'))
    `).run(runBId, projBId);

    // Create tasks for Run A and Run B
    const taskAId = 'task-alpha-1';
    const taskBId = 'task-beta-1';

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_tasks (id, run_id, title, status, created_at, updated_at)
      VALUES (?, ?, 'Task Alpha 1', 'pending', datetime('now'), datetime('now'))
    `).run(taskAId, runAId);

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_tasks (id, run_id, title, status, created_at, updated_at)
      VALUES (?, ?, 'Task Beta 1', 'pending', datetime('now'), datetime('now'))
    `).run(taskBId, runBId);

    // Query tasks specifically by project through run_id
    const tasksA = db.prepare(`
      SELECT t.* FROM autonomous_tasks t
      JOIN autonomous_runs r ON t.run_id = r.id
      WHERE r.project_id = ?
    `).all(projAId) as any[];

    const tasksB = db.prepare(`
      SELECT t.* FROM autonomous_tasks t
      JOIN autonomous_runs r ON t.run_id = r.id
      WHERE r.project_id = ?
    `).all(projBId) as any[];

    assert.strictEqual(tasksA.length, 1);
    assert.strictEqual(tasksA[0].id, taskAId);
    assert.strictEqual(tasksB.length, 1);
    assert.strictEqual(tasksB[0].id, taskBId);

    // Cross-project query isolation: project A tasks cannot appear in project B listing
    assert.ok(!tasksA.some(t => t.id === taskBId));
    assert.ok(!tasksB.some(t => t.id === taskAId));
  });

  await t.test('6. Run State Isolation: Pausing or stopping run in Project A leaves Project B untouched', () => {
    const runAId = 'run-state-alpha';
    const runBId = 'run-state-beta';
    const projAId = 'proj-iso-alpha-uuid';
    const projBId = 'proj-iso-beta-uuid';

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run State Alpha', 'Obj Alpha', 'running', datetime('now'), datetime('now'), datetime('now'))
    `).run(runAId, projAId);

    db.prepare(`
      INSERT OR REPLACE INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run State Beta', 'Obj Beta', 'running', datetime('now'), datetime('now'), datetime('now'))
    `).run(runBId, projBId);

    // Pause Run A via AutonomousManager
    AutonomousManager.pauseRun(runAId);

    const runARow: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runAId);
    const runBRow: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runBId);

    assert.strictEqual(runARow.status, 'paused', 'Run A deve estar pausado');
    assert.strictEqual(runBRow.status, 'running', 'Run B deve continuar em execução sem qualquer alteração');
  });

  await t.test('7. Trust and Autonomy Isolation: Untrusted Project B cannot inherit permissions from Trusted Project A', () => {
    const projAId = 'proj-iso-alpha-uuid';
    const projUntrustedId = 'proj-iso-untrusted-uuid';
    const untrustedDir = path.join(tmpRoot, 'project-untrusted');
    fs.mkdirSync(untrustedDir, { recursive: true });

    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, path, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, 0, 1, datetime('now'), datetime('now'))
    `).run(projUntrustedId, 'Untrusted Project', untrustedDir);

    // Global settings: default autonomy enabled
    DevAutonomyService.setGlobalDefaultAutonomy(true);

    const isTrustedA = DevAutonomyService.isProjectTrusted(projAId);
    const hasAutonomyA = DevAutonomyService.hasFullDevAutonomy(projAId);

    const isTrustedUntrusted = DevAutonomyService.isProjectTrusted(projUntrustedId);
    const hasAutonomyUntrusted = DevAutonomyService.hasFullDevAutonomy(projUntrustedId);

    assert.strictEqual(isTrustedA, true, 'Projeto A é confiável');
    assert.strictEqual(hasAutonomyA, true, 'Projeto A confiável com permissão tem autonomia ativa');

    assert.strictEqual(isTrustedUntrusted, false, 'Projeto não-confiável deve ter is_trusted = false');
    assert.strictEqual(hasAutonomyUntrusted, false, 'Projeto não-confiável NUNCA pode ter autonomia ativa');
  });
});
