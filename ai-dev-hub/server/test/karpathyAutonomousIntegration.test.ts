import test from 'node:test';
import { writeVerificationFixture } from './verificationFixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { MemoryManager } from '../src/memoryManager.js';
import { EngineeringContextService } from '../src/engineeringContextService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';

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
    } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "karpathyAutonomousIntegration.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:karpathyAutonomousIntegration.test]", err);
      }
    }
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
      verificationCommand: writeVerificationFixture(tmpRoot),
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

  await t.test('3. IndependentEvaluator valida aceitação factual de Visual UI e Persistência', async () => {
    const visualDir = path.join(tmpRoot, 'visual-test');
    fs.mkdirSync(visualDir, { recursive: true });

    // Initial check: empty directory has no visual assets and no persistence
    const checkEmptyVisual = IndependentEvaluator.validateVisualAcceptance(visualDir);
    assert.equal(checkEmptyVisual.hasVisualUi, false);
    assert.equal(checkEmptyVisual.matchedFiles.length, 0);

    const checkEmptyPersist = IndependentEvaluator.validatePersistenceAcceptance(visualDir);
    assert.equal(checkEmptyPersist.hasPersistence, false);

    // Contract mandates visual dashboard
    const visualContract = IndependentEvaluator.createSuccessContract({
      taskId: `task-visual-${Date.now()}`,
      projectId: projId,
      projectPath: visualDir,
      objective: 'Interface Visual: Dashboard de Finanças',
      acceptanceCriteria: ['Renderizar dashboard visual com métricas', 'Salvar dados de forma persistente'],
      verificationCommand: 'node -e "process.exit(0)"'
    });

    // Builder claims success with only test file (no HTML, no persistence)
    const reportWithoutUi = {
      status: 'success' as const,
      filesChanged: ['test/mock.js'],
      implemented: ['Testes concluídos em memória']
    };

    const evalFail = await IndependentEvaluator.evaluate(visualContract.id, visualDir, reportWithoutUi);
    // MUST FAIL because visual UI and persistence artifacts do not exist on disk!
    assert.equal(evalFail.verdict, 'FAIL');
    assert.equal(evalFail.taskIsDone, false);
    assert.ok(evalFail.failedCriteria.some(c => c.includes('Interface visual')));
    assert.ok(evalFail.failedCriteria.some(c => c.includes('Persistência de dados')));

    // Now add real HTML dashboard and persistence code
    fs.writeFileSync(path.join(visualDir, 'index.html'), '<!DOCTYPE html><html><body><div id="dashboard"><h1>Dashboard de Finanças</h1></div></body></html>');
    fs.writeFileSync(path.join(visualDir, 'storage.js'), 'const fs = require("fs"); function save(d) { fs.writeFileSync("data.json", JSON.stringify(d)); }');

    const checkWithUi = IndependentEvaluator.validateVisualAcceptance(visualDir);
    assert.equal(checkWithUi.hasVisualUi, true);
    assert.ok(checkWithUi.matchedFiles.includes('index.html'));

    const checkWithPersist = IndependentEvaluator.validatePersistenceAcceptance(visualDir);
    assert.equal(checkWithPersist.hasPersistence, true);
    assert.ok(checkWithPersist.matchedFiles.includes('storage.js'));

    // Re-evaluate with visual and persistence assets in place
    const reportWithUi = {
      status: 'success' as const,
      filesChanged: ['index.html', 'storage.js'],
      implemented: ['Dashboard visual e persistência implementados']
    };

    const evalPass = await IndependentEvaluator.evaluate(visualContract.id, visualDir, reportWithUi);
    assert.equal(evalPass.verdict, 'FAIL', 'HTML e palavras sobre storage não provam comportamento funcional');
    assert.equal(evalPass.taskIsDone, false);
  });

  await t.test('4. AutonomousRunnerService valida completude do projeto (Tarefa concluída != Projeto concluído)', async () => {
    const compDir = path.join(tmpRoot, 'completeness-test');
    fs.mkdirSync(compDir, { recursive: true });

    const mockRun = {
      id: 'run-comp-test',
      briefing: 'Criar aplicativo financeiro com interface visual, dashboard e persistência',
      objective: 'App financeiro completo com UI e banco de dados'
    };
    const mockProj = {
      path: compDir,
      objective: 'Sistema financeiro'
    };

    // Directory without HTML/persistence must fail project completeness
    const checkIncomplete = AutonomousRunnerService.checkProjectCompleteness(mockRun, mockProj);
    assert.equal(checkIncomplete.isComplete, false);
    assert.ok(checkIncomplete.missingAspects.length >= 2);
    assert.ok(checkIncomplete.missingAspects.some(m => m.includes('Interface Visual')));
    assert.ok(checkIncomplete.missingAspects.some(m => m.includes('Persistência')));

    // Add required artifacts to directory
    fs.writeFileSync(path.join(compDir, 'index.html'), '<!DOCTYPE html><html><body><div class="dashboard">Receitas e Despesas</div></body></html>');
    fs.writeFileSync(path.join(compDir, 'db.js'), 'const fs = require("fs"); fs.writeFileSync("data.json", "{}");');

    // Now completeness check must pass!
    const checkComplete = AutonomousRunnerService.checkProjectCompleteness(mockRun, mockProj);
    assert.equal(checkComplete.isComplete, true);
    assert.equal(checkComplete.missingAspects.length, 0);
  });

  await t.test('5. WorkerExecutionContract enriquece contrato com taskScaffold e testSkeleton inicial', async () => {
    const { HierarchicalOrchestrationService } = await import('../src/hierarchicalOrchestrationService.js');

    // 1. Backend / Rota task
    const routeContract = HierarchicalOrchestrationService.generateTaskScaffoldAndTestSkeleton({
      title: 'Implementar rotas de transações financeiras',
      description: 'Criar endpoints REST para transações',
      allowedScope: ['src/routes/transactions.ts', 'test/transactions.test.ts'],
      criteria: ['GET /api/transactions retorna 200 e lista', 'POST /api/transactions valida payload']
    });
    assert.equal(routeContract.taskScaffold.deliveryType, 'backend_route');
    assert.ok(routeContract.taskScaffold.targetSignatures.includes('GET  /api/transactions'));
    assert.ok(routeContract.taskScaffold.targetSignatures.includes('POST /api/transactions'));
    assert.ok(routeContract.taskScaffold.targetSignatures.includes('400 Bad Request'));
    assert.ok(routeContract.testSkeleton.includes("import test from 'node:test'"));
    assert.ok(routeContract.testSkeleton.includes('GET /api/transactions'));

    // 2. Database / Persistência task
    const dbContract = HierarchicalOrchestrationService.generateTaskScaffoldAndTestSkeleton({
      title: 'Criar tabela e repositório de contas',
      description: 'Persistir contas no banco SQLite',
      allowedScope: ['src/db/accounts.ts', 'test/accounts.test.ts'],
      criteria: ['Tabela accounts criada com chaves e timestamps', 'seedIfEmpty popula contas padrão']
    });
    assert.equal(dbContract.taskScaffold.deliveryType, 'database_persistence');
    assert.ok(dbContract.taskScaffold.targetSignatures.includes('PRAGMA journal_mode = WAL'));
    assert.ok(dbContract.taskScaffold.targetSignatures.includes('CREATE TABLE IF NOT EXISTS'));
    assert.ok(dbContract.taskScaffold.targetSignatures.includes('seedIfEmpty()'));
    assert.ok(dbContract.testSkeleton.includes("import assert from 'node:assert/strict'"));

    // 3. Frontend / UI task
    const uiContract = HierarchicalOrchestrationService.generateTaskScaffoldAndTestSkeleton({
      title: 'Desenvolver Dashboard de Métricas e Gráficos',
      description: 'Interface web com navegação e cards',
      allowedScope: ['public/index.html', 'public/app.js', 'test/ui.test.ts'],
      criteria: ['Aba de métricas com navegação funcional', 'Sanitização contra XSS']
    });
    assert.equal(uiContract.taskScaffold.deliveryType, 'frontend_ui');
    assert.ok(uiContract.taskScaffold.targetSignatures.includes('role="tab"'));
    assert.ok(uiContract.taskScaffold.targetSignatures.includes('data-tab='));
    assert.ok(uiContract.taskScaffold.targetSignatures.includes('escapeHtml'));
    assert.ok(uiContract.testSkeleton.includes('Dashboard de Métricas e Gráficos'));

    // 4. Integração real via buildWorkerExecutionContract na tarefa do banco
    const taskRecord: any = db.prepare('SELECT id FROM autonomous_tasks WHERE project_id = ? LIMIT 1').get(projId);
    assert.ok(taskRecord);
    const workerContract = HierarchicalOrchestrationService.buildWorkerExecutionContract(taskRecord.id);
    assert.ok(workerContract.taskScaffold);
    assert.ok(workerContract.testSkeleton);
    assert.ok(workerContract.taskScaffold.targetSignatures.length > 0);
    assert.ok(workerContract.testSkeleton.includes('import test from'));
  });

  await t.test('6. Bloqueio de Conclusão sem Evidência Factual & Diretrizes Cirúrgicas TDD', async () => {
    const { PromptArchitectureService } = await import('../src/promptArchitectureService.js');
    const { getGlobalAgentGuidelines } = await import('../src/agentGuidelines.ts');

    // 6.1 Validação das diretrizes no prompt do Worker e agentGuidelines
    const guidelines = getGlobalAgentGuidelines();
    assert.ok(guidelines.includes('PASSO 1 (RED)'));
    assert.ok(guidelines.includes('PASSO 2 (GREEN)'));
    assert.ok(guidelines.includes('PASSO 3'));
    assert.ok(guidelines.includes('SURGICAL BOUNDARY'));
    assert.ok(guidelines.includes('src/types/'));
    assert.ok(guidelines.includes('src/db/'));
    assert.ok(guidelines.includes('node:crypto.randomUUID()'));
    assert.ok(guidelines.includes('ANTI-BLOWUP'));
    assert.ok(guidelines.includes('PORT LEAK GUARD'));

    const workerPrompt = PromptArchitectureService.buildWorkerPrompt({
      mode: 'IMPLEMENT',
      projectId: projId,
      projectName: 'Projeto Integrado Karpathy',
      projectPath: tmpRoot,
      projectObjective: 'Aplicativo demonstrador do fluxo autônomo com Karpathy',
      taskId: 'task-tdd-1',
      taskTitle: 'Implementar cálculo cirúrgico',
      acceptanceCriteria: ['Soma de valores com tipagem limpa'],
      verificationCommand: 'npm test',
      expectedScopeFiles: ['src/calc.ts']
    });

    assert.ok(workerPrompt.prompt.includes('PASSO 1 (RED)'));
    assert.ok(workerPrompt.prompt.includes('PASSO 2 (GREEN)'));
    assert.ok(workerPrompt.prompt.includes('PASSO 3'));
    assert.ok(workerPrompt.prompt.includes('SURGICAL BOUNDARY'));
    assert.ok(workerPrompt.prompt.includes('ZERO GUESSWORK'));
    assert.ok(workerPrompt.prompt.includes('ANTI-BLOWUP'));
    assert.ok(workerPrompt.prompt.includes('PORT LEAK GUARD'));
    assert.ok(workerPrompt.prompt.includes('node:crypto.randomUUID()'));

    // 6.2 Validação Factual: Rejeição sumária quando status='success' sem comando no terminal
    const unverifiedReport = {
      status: 'success' as const,
      commandsExecuted: [],
      testsRun: '',
      tests: { ran: false },
      filesChanged: ['src/calc.ts']
    };
    const resUnverified = AutonomousRunnerService.validateWorkerFactualEvidence(unverifiedReport);
    assert.equal(resUnverified.valid, false);
    assert.ok(resUnverified.reason?.includes('evidência de execução real de verificação em terminal com exit code 0'));

    // 6.3 Validação Factual: Rejeição sumária quando comando falha (exit code != 0)
    const failedCmdReport = {
      status: 'success' as const,
      commandsExecuted: ['npm test'],
      testsRun: 'npm test',
      tests: { ran: true, passed: false, exitCode: 1 },
      evaluation: { taskIsDone: true, exitCode: 1, executedCommands: ['npm test'] }
    };
    const resFailedCmd = AutonomousRunnerService.validateWorkerFactualEvidence(failedCmdReport);
    assert.equal(resFailedCmd.valid, false);

    // 6.4 Validação Factual: Rejeição sumária quando Auto-Validação Pré-Handover detecta erro de compilação
    const compilationErrReport = {
      status: 'success' as const,
      commandsExecuted: ['npm test'],
      testsRun: 'npm test',
      tests: { ran: true, passed: true, exitCode: 0 },
      evaluation: { taskIsDone: true, exitCode: 0, executedCommands: ['npm test'] },
      knownProblems: ['[COMPILATION_ERROR_PRE_HANDOVER] src/calc.ts:10 - Type error: missing return type']
    };
    const resCompErr = AutonomousRunnerService.validateWorkerFactualEvidence(compilationErrReport);
    assert.equal(resCompErr.valid, false);
    assert.ok(resCompErr.reason?.includes('Auto-Validação Pré-Handover falhou'));

    // 6.5 Validação Factual: Sucesso aceito quando há comando com exit code 0 e sem erros de compilação
    const verifiedReport = {
      status: 'success' as const,
      commandsExecuted: ['npm test'],
      testsRun: 'npm test',
      tests: { ran: true, passed: true, exitCode: 0 },
      evaluation: { taskIsDone: true, exitCode: 0, executedCommands: ['npm test'] }
    };
    const resVerified = AutonomousRunnerService.validateWorkerFactualEvidence(verifiedReport);
    assert.equal(resVerified.valid, true);
  });
});
