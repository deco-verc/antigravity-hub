import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { MemoryManager } from '../src/memoryManager.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { AutonomousManager } from '../src/autonomousManager.js';

test('Karpathy + Autonomous Runner Integrated Pipeline Suite', async (t) => {
  const tmpRoot = path.join(os.tmpdir(), `decohub-integrated-pipeline-${Date.now()}`);
  fs.mkdirSync(tmpRoot, { recursive: true });

  const projId = `proj-integ-${Date.now()}`;
  const now = new Date().toISOString();

  // 1. Setup disposable project with git and package.json
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, stack, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Node/TypeScript', 'active', ?, ?)
  `).run(projId, 'Projeto Integrado Karpathy', tmpRoot, 'Aplicativo demonstrador do fluxo autônomo com Karpathy', now, now);

  // Initialize Memory and Constitution
  MemoryManager.ensureProgramMd(tmpRoot, 'Projeto Integrado Karpathy', 'Aplicativo demonstrador do fluxo autônomo com Karpathy');
  MemoryManager.updateMemoryFile(tmpRoot, 'decisions.md', '- [Decisão 1] Proibido uso de dependências externas não auditadas\n- [Decisão 2] Crie código cirúrgico e modular');

  t.after(() => {
    try {
      db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(projId);
      db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(projId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projId);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Preflight e Contexto Karpathy enriquecem a Task do Autonomous Runner', async () => {
    // Create Autonomous Run
    const run = await AutonomousManager.createRun({
      projectId: projId,
      name: 'Run Integrado Karpathy',
      objective: 'Construir módulo com Karpathy',
      briefing: 'Criar utilitário de cálculo e testes unitários'
    });
    assert.ok(run);

    const task = run.tasks[0];
    assert.ok(task);

    // Prepare Karpathy context
    const pkg = EngineeringContextService.prepareTaskContext({
      projectPath: tmpRoot,
      projectName: 'Projeto Integrado Karpathy',
      projectObjective: 'Aplicativo demonstrador do fluxo autônomo com Karpathy',
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        criteria: ['Função calculate soma números corretamente'],
        verificationCommand: 'node -e "process.exit(0)"',
        expectedScopeFiles: ['src/calc.js', 'test/calc.test.js']
      }
    });

    assert.equal(pkg.preflightStatus, 'READY');
    assert.ok(pkg.contextHash.length > 0);
    assert.ok(pkg.formattedPromptBlock.includes('THINK BEFORE CODING'));
    assert.ok(pkg.formattedPromptBlock.includes('SIMPLICITY FIRST'));
    assert.ok(pkg.formattedPromptBlock.includes('SURGICAL CHANGES'));
    assert.ok(pkg.formattedPromptBlock.includes('GOAL-DRIVEN'));
    assert.ok(pkg.formattedPromptBlock.includes('Proibido uso de dependências externas não auditadas'));

    // Update task record with engineering traceability metadata
    db.prepare(`
      UPDATE autonomous_tasks
      SET engineering_context_version = ?, engineering_context_hash = ?, preflight_status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      pkg.contextVersion,
      pkg.contextHash,
      pkg.preflightStatus,
      new Date().toISOString(),
      task.id
    );

    const updatedTask: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(task.id);
    assert.equal(updatedTask.preflight_status, 'READY');
    assert.equal(updatedTask.engineering_context_hash, pkg.contextHash);
  });

  await t.test('2. IndependentEvaluator valida verificação objetiva e escopo cirúrgico', async () => {
    const contract = IndependentEvaluator.createSuccessContract({
      taskId: `task-pipe-${Date.now()}`,
      projectId: projId,
      projectPath: tmpRoot,
      objective: 'Criar utilitário de cálculo',
      acceptanceCriteria: ['Função calculate soma números corretamente'],
      verificationCommand: 'node -e "process.exit(0)"',
      protectedEvaluationFiles: []
    });

    // 1. Surgical change (only expected scope)
    const surgicalReport = {
      status: 'success' as const,
      filesChanged: ['src/calc.js', 'test/calc.test.js'],
      implemented: ['Implementada função calculate']
    };

    const evalSurgical = await IndependentEvaluator.evaluate(contract.id, tmpRoot, surgicalReport, {
      expectedScopeFiles: ['src/calc.js', 'test/calc.test.js']
    });

    assert.equal(evalSurgical.verdict, 'PASS');
    assert.equal(evalSurgical.taskIsDone, true);
    assert.equal(evalSurgical.evidence.scopeValidation?.isSurgical, true);
    assert.equal(evalSurgical.evidence.scopeValidation?.unrelatedFiles.length, 0);

    // 2. Non-surgical change (file outside scope)
    const nonSurgicalReport = {
      status: 'success' as const,
      filesChanged: ['src/calc.js', 'test/calc.test.js', 'unrelated/config.json'],
      implemented: ['Adicionado arquivo desnecessário']
    };

    const evalNonSurgical = await IndependentEvaluator.evaluate(contract.id, tmpRoot, nonSurgicalReport, {
      expectedScopeFiles: ['src/calc.js', 'test/calc.test.js']
    });

    assert.equal(evalNonSurgical.evidence.scopeValidation?.isSurgical, false);
    assert.equal(evalNonSurgical.evidence.scopeValidation?.unrelatedFiles.length, 1);
  });
});
