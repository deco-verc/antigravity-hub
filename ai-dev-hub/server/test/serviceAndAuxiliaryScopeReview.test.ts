import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

test('Reviewer Independente — Whitelist de Serviços e Tolerância de Dependência', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-services-scope-test-'));
  const projectId = 'proj-serv-' + crypto.randomUUID().slice(0, 8);
  const runId = 'run-serv-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  t.before(() => {
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Projeto Teste Serviços', ?, 'Testar whitelist de serviços e utilitários', ?, ?)
    `).run(projectId, tmpDir, now, now);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Teste Serviços', 'Testar escopo de serviços', 'running', ?, ?, ?)
    `).run(runId, projectId, now, now, now);
  });

  t.after(() => {
    try {
      db.prepare('DELETE FROM autonomous_tasks WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runId);
      db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  await t.test('1. Pastas auxiliares (services, utils, helpers, models, entities, lib, middlewares) nunca entram em outOfScopeFiles', () => {
    const taskId = 'task-aux-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Implementar funcionalidade de autenticação e sessão',
      'Criar módulos auxiliares legítimos',
      'Construir serviços e middlewares de apoio',
      'in_review',
      JSON.stringify(['Serviços e utilitários criados']),
      JSON.stringify(['src/routes/auth.ts'])
    );

    const auxiliaryFiles = [
      'src/routes/auth.ts',
      'src/services/authService.ts',
      'services/tokenService.js',
      'src/utils/cryptoHelper.ts',
      'utils/slugify.js',
      'src/helpers/dateFormatter.ts',
      'helpers/format.js',
      'src/models/userModel.ts',
      'models/account.js',
      'src/entities/userEntity.ts',
      'entities/profile.js',
      'src/lib/jwt.ts',
      'lib/httpClient.js',
      'src/middlewares/authGuard.ts',
      'middlewares/rateLimiter.js'
    ];

    const review = HierarchicalOrchestrationService.evaluateTaskReviewQuality({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-aux-1',
        contractId: 'contract-aux-1',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Serviços e utilitários criados'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Works',
        actual: 'OK',
        evaluatorNotes: 'Testes passaram com sucesso',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 45,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: auxiliaryFiles,
        implemented: ['Serviços e utilitários'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'APPROVED', 'Deve aprovar sem falsos positivos de escopo');
    assert.deepEqual(review.outOfScopeFiles, [], 'Nenhum arquivo auxiliar deve ser adicionado a outOfScopeFiles');
    assert.equal(review.problemsFound.length, 0, 'Nenhum erro de escopo deve ser reportado');
  });

  await t.test('2. Tolerância de Dependência: rota/controller/server.ts sob src/ expande escopo automaticamente para src/services/', () => {
    const taskId = 'task-dep-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Criar endpoint de faturamento em src/controllers/billingController.ts',
      'Implementar controller de billing',
      'Chamar serviço de faturamento',
      'in_review',
      JSON.stringify(['Billing operacional']),
      JSON.stringify(['src/controllers/billingController.ts'])
    );

    const review = HierarchicalOrchestrationService.evaluateTaskReviewQuality({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-dep-1',
        contractId: 'contract-dep-1',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Billing operacional'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Billing works',
        actual: 'OK',
        evaluatorNotes: 'Testes passaram',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 35,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: [
          'src/controllers/billingController.ts',
          'src/services/billingService.ts'
        ],
        implemented: ['Billing controller e service'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'APPROVED', 'Deve aprovar com dependência de serviço legítima');
    assert.deepEqual(review.outOfScopeFiles, [], 'src/services/billingService.ts deve ser considerado em escopo legítimo');
  });

  await t.test('3. Regra de Ouro: Arquivos proibidos (.env, hub.db, chaves) continuam sendo terminantemente REJEITADOS', () => {
    const taskId = 'task-sec-' + crypto.randomUUID().slice(0, 8);

    db.prepare(`
      INSERT INTO autonomous_tasks (
        id, run_id, project_id, title, objective, description,
        status, criteria_json, allowed_scope_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      taskId,
      runId,
      projectId,
      'Ajustar configuração de conexão',
      'Configurar credenciais',
      'Alterar arquivos de ambiente',
      'in_review',
      JSON.stringify(['Configuração pronta']),
      JSON.stringify(['src/services/configService.ts'])
    );

    const review = HierarchicalOrchestrationService.evaluateTaskReviewQuality({
      runId,
      taskId,
      projectPath: tmpDir,
      supervisorVerdict: 'APPROVED',
      evaluationResult: {
        id: 'eval-sec-1',
        contractId: 'contract-sec-1',
        taskId,
        runId,
        verdict: 'PASS',
        builderStatus: 'COMPLETED',
        evaluatorVerdict: 'PASS',
        taskIsDone: true,
        passedCriteria: ['Configuração pronta'],
        failedCriteria: [],
        evidence: { output: 'All tests passed' },
        expected: 'Config works',
        actual: 'OK',
        evaluatorNotes: 'Testes passaram',
        evaluatorName: 'Evaluator',
        executedCommands: ['npm test'],
        exitCode: 0,
        durationMs: 30,
        createdAt: new Date().toISOString()
      },
      workerReport: {
        filesChanged: [
          'src/services/configService.ts',
          '.env' // Proibido!
        ],
        implemented: ['Configuração'],
        testsRun: true,
        testResults: 'Pass',
        buildStatus: 'success'
      }
    });

    assert.equal(review.decision, 'REJECTED', 'Deve rejeitar inclusão de arquivo proibido (.env)');
    assert.ok(review.securityOrIsolationIssues.length > 0, 'Deve registrar o problema de segurança');
    assert.match(review.problemsFound.join('; '), /\.env/i);
  });
});
