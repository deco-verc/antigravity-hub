import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { CouncilManager } from '../src/councilManager.js';

test('Inteligência Construtiva do Reviewer (Directive Auto-Unblock)', async (t) => {
  const tmpDir = path.join(os.tmpdir(), 'decohub-test-reviewer-' + crypto.randomUUID().slice(0, 8));
  fs.mkdirSync(tmpDir, { recursive: true });

  const runId = 'run-' + crypto.randomUUID().slice(0, 8);
  const projectId = 'proj-' + crypto.randomUUID().slice(0, 8);

  db.prepare(`
    INSERT INTO projects (id, name, path, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))
  `).run(projectId, 'Projeto Reviewer Test', tmpDir);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
    VALUES (?, ?, 'Run Teste Reviewer', 'Testar diretrizes de reviewer', 'running', ?, ?, ?)
  `).run(runId, projectId, now, now, now);

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Ajustes Cosméticos Não-Bloqueantes: Espaçamento, indentação e comentários aprovam com nota 9/10', () => {
    const taskId = 'task-cosmetic-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Ajustar formatação do serviço de usuário',
      'Refatorar layout de código',
      'Melhorar formatação e comentários',
      'in_review',
      JSON.stringify(['Código funcional']),
      JSON.stringify(['src/userService.ts'])
    );

    const review = HierarchicalOrchestrationService.evaluateTaskReviewQuality({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'CHANGES_REQUESTED',
      supervisorFeedback: 'Ajustar espaçamento e indentação nos métodos e adicionar comentários JSDoc',
      evaluationResult: {
        id: 'eval-cosm-1',
        contractId: 'contract-cosm-1',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Código funcional'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Funcional',
        actual: 'Testes passaram com exit code 0',
        evaluatorNotes: 'Testes passaram sem erros',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 20,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: ['src/userService.ts'],
        implemented: ['Serviço de usuário'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'APPROVED', 'Ajustes cosméticos não devem bloquear a esteira');
    assert.equal(review.score, 9, 'Deve atribuir nota 9/10 para aprovação com ressalvas cosméticas');
    assert.ok(review.suggestions && review.suggestions.length > 0, 'Deve registrar observações em suggestions');
    assert.equal(review.problemsFound.length, 0, 'problemsFound deve estar limpo para não interromper a execução');
    assert.match(review.justification, /Aprovado com ressalvas cosméticas \(nota 9\/10\)/i);
  });

  await t.test('2. Erro Bloqueante: Falha de segurança evidente (SQL Injection sem queries parametrizadas)', () => {
    const taskId = 'task-sqli-' + crypto.randomUUID().slice(0, 8);
    const vulnerableFile = path.join(tmpDir, 'src', 'accountService.ts');
    fs.mkdirSync(path.dirname(vulnerableFile), { recursive: true });
    fs.writeFileSync(
      vulnerableFile,
      `export class AccountService {\n  getAccount(id: string) {\n    return db.prepare(\`SELECT * FROM accounts WHERE id = '\${id}'\`).get();\n  }\n}`
    );

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Buscar conta por id',
      'Implementar busca de conta',
      'Consulta SQL',
      'in_review',
      JSON.stringify(['Conta retornada']),
      JSON.stringify(['src/accountService.ts'])
    );

    const review = HierarchicalOrchestrationService.evaluateTaskReviewQuality({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-sqli-1',
        contractId: 'contract-sqli-1',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Conta retornada'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Conta',
        actual: 'OK',
        evaluatorNotes: 'Testes passaram',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 25,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: ['src/accountService.ts'],
        implemented: ['Busca de conta'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'REJECTED', 'SQL Injection deve causar REJECTED mandatório');
    assert.ok(review.securityOrIsolationIssues.length > 0, 'Deve registrar o problema de segurança');
    assert.match(review.justification, /\[ARQUIVO E LINHA\]: src\/accountService\.ts:3/);
    assert.match(review.justification, /\[ERRO REAL\]:.*SQL Injection/i);
    assert.match(review.justification, /\[DIRETRIZ CIRÚRGICA\]:.*placeholder \?/i);
  });

  await t.test('3. Erro Bloqueante: Tentativa de alterar arquivo protegido (.env)', () => {
    const taskId = 'task-env-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Alterar segredos de ambiente',
      'Atualizar tokens',
      'Modificar .env',
      'in_review',
      JSON.stringify(['Tokens salvos']),
      JSON.stringify(['src/config.ts'])
    );

    const review = HierarchicalOrchestrationService.evaluateTaskReviewQuality({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-env-1',
        contractId: 'contract-env-1',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Tokens salvos'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'OK',
        actual: 'OK',
        evaluatorNotes: 'OK',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 20,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: ['src/config.ts', '.env'],
        implemented: ['Configuração'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'REJECTED', 'Alteração em .env deve causar REJECTED');
    assert.match(review.justification, /\[ARQUIVO E LINHA\]: \.env:1/);
    assert.match(review.justification, /\[ERRO REAL\]:.*arquivo protegido ou sensível/i);
    assert.match(review.justification, /\[DIRETRIZ CIRÚRGICA\]:.*Reverter imediatamente/i);
  });

  await t.test('4. Síntese do Chairman no Conselho: Formata tríade de ação em CHANGES_REQUESTED e aprova ressalvas com 9/10', async () => {
    const deliberationChanges = await CouncilManager.deliberate({
      taskId: 'task-chair-1',
      projectId,
      task: { title: 'Validação de Pedido', description: 'Processar pedido' },
      evaluation: {
        id: 'eval-fail-1',
        contractId: 'c-1',
        taskId: 'task-chair-1',
        verdict: 'FAIL',
        builderStatus: 'FAILED',
        evaluatorVerdict: 'FAIL',
        taskIsDone: false,
        passedCriteria: [],
        failedCriteria: ['Pedido aprovado'],
        evidence: {
          output: 'src/orderService.ts:45:10 - error TS2322: Type "null" is not assignable to type "string"'
        },
        expected: 'Sucesso',
        actual: 'src/orderService.ts:45 - error TS2322: Type "null" is not assignable to type "string"',
        evaluatorNotes: 'Falha de compilação',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 1,
        durationMs: 50,
        createdAt: new Date().toISOString()
      },
      diff: 'diff --git a/src/orderService.ts b/src/orderService.ts\n--- a/src/orderService.ts\n+++ b/src/orderService.ts',
      options: { forceHeuristic: true }
    });

    assert.equal(deliberationChanges.chairmanVerdict, 'CHANGES_REQUESTED');
    assert.match(deliberationChanges.chairmanSynthesis, /\[ARQUIVO E LINHA\]: src\/orderService\.ts:45/);
    assert.match(deliberationChanges.chairmanSynthesis, /\[ERRO REAL\]:/);
    assert.match(deliberationChanges.chairmanSynthesis, /\[DIRETRIZ CIRÚRGICA\]:/);
  });
});
