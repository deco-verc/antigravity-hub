import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { execFileSync } from 'node:child_process';
import { db, initDatabase } from '../src/db.js';
import { apiRouter } from '../src/routes.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { DevAutonomyService } from '../src/devAutonomyService.js';

initDatabase();

function createIsolatedGitRepo(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'auditor@decohub.local'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'DecoHUB Independent Auditor'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'audit-target-app',
        version: '1.0.0',
        scripts: {
          test: 'node --test test/suite.test.cjs'
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'core.cjs'), 'module.exports = { booted: true };\n', 'utf-8');
  fs.writeFileSync(
    path.join(dir, 'test', 'suite.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const core = require('../src/core.cjs');",
      "test('core boots', () => { assert.equal(core.booted, true); });",
      ""
    ].join('\n'),
    'utf-8'
  );
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: initial audit repo'], { cwd: dir, stdio: 'pipe' });
}

test('Auditoria Seções 3, 4 e 5: Planejamento (dependências inexistentes, ciclos, estado inicial sob Grande Tarefa dependente), Comunicação (rejeição de execução antiga STALE_EXECUTION_RESULT) e Máquina de Estados (matriz completa e bloqueio de falsificação via API)', async (t) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-audit-s345-'));
  createIsolatedGitRepo(repoDir);
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const projectId = `proj-audit-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-audit-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, path, objective, description, status, is_trusted, full_dev_autonomy, created_at, updated_at)
     VALUES (?, 'Audit Project S345', ?, 'Validar planejamento e máquina de estados', 'Descrição original de auditoria', 'active', 1, 1, ?, ?)`
  ).run(projectId, repoDir, now, now);

  db.prepare(
    `INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
     VALUES (?, ?, 'Audit Run S345', 'Validar planejamento e máquina de estados', 'Descrição original de auditoria', 'running', ?, ?, ?)`
  ).run(runId, projectId, now, now, now);

  // 3.6 Negativo: Dependência inexistente em Grande Tarefa deve ser rejeitada (Finding A3)
  assert.throws(
    () =>
      HierarchicalOrchestrationService.persistHierarchicalPlan({
        projectId,
        runId,
        projectPath: repoDir,
        originalDescription: 'Teste dep inexistente GT',
        majorTasks: [
          {
            code: 'GT-1',
            title: 'Grande Tarefa 1',
            objective: 'Obj 1',
            dependencies: ['GT-999-INEXISTENTE'],
            microtasks: [
              { code: '1.1', title: 'Micro 1.1 válida', description: 'Descrição válida 1.1', criteria: ['Critério 1'] }
            ]
          }
        ]
      }),
    /NONEXISTENT_DEPENDENCY_DETECTED/,
    'Deve rejeitar Grande Tarefa que referencia dependência inexistente'
  );

  // 3.6 Negativo: Dependência inexistente em Microtarefa deve ser rejeitada (Finding A3)
  assert.throws(
    () =>
      HierarchicalOrchestrationService.persistHierarchicalPlan({
        projectId: `proj-audit-neg-${crypto.randomUUID().slice(0, 6)}`,
        runId: `run-audit-neg-${crypto.randomUUID().slice(0, 6)}`,
        projectPath: repoDir,
        originalDescription: 'Teste dep inexistente Micro',
        majorTasks: [
          {
            code: 'GT-1',
            title: 'Grande Tarefa Limpa',
            objective: 'Obj 1',
            dependencies: [],
            microtasks: [
              {
                code: '1.1',
                title: 'Micro com dep fantasma',
                description: 'Depende de tarefa que não existe',
                criteria: ['Critério 1'],
                dependencies: ['99.99-FANTASMA']
              }
            ]
          }
        ]
      }),
    /NONEXISTENT_DEPENDENCY_DETECTED/,
    'Deve rejeitar Microtarefa que referencia dependência inexistente'
  );

  // Clean any partial major tasks from the negative test on runId
  db.prepare('DELETE FROM autonomous_major_tasks WHERE run_id = ?').run(runId);

  // 3.1, 3.5 & Finding A1/A2/A4: Persistir plano hierárquico com GT-2 dependente de GT-1
  // Mesmo que Microtarefa 2.1 não liste dependência de microtarefa diretamente, ela pertence a GT-2 (que depende de GT-1),
  // portanto 2.1 deve nascer como PLANNED (e não READY)!
  const preInsertedTaskId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
     VALUES (?, ?, 'Implementar módulo A', 'Descrição módulo A', 'GT-1', 1, '[]', 'ready', 'builder', '["Módulo A exportado"]', ?, ?)`
  ).run(preInsertedTaskId, runId, now, now);

  const plan = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: repoDir,
    originalDescription: 'Sistema com GT-1 e GT-2 dependente',
    requirements: ['REQ-A: Módulo A', 'REQ-B: Módulo B dependente de GT-1'],
    successCriteria: ['Critério de sucesso global 1'],
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Base GT-1',
        objective: 'Construir módulo A',
        dependencies: [],
        microtasks: [
          {
            id: preInsertedTaskId,
            code: '1.1',
            title: 'Implementar módulo A',
            description: 'Criar src/modA.cjs e testar',
            allowedScope: ['src/modA.cjs', 'test/suite.test.cjs'],
            criteria: ['Módulo A exportado com sucesso'],
            verificationCommand: 'npm test',
            dependencies: []
          },
          {
            code: '1.2',
            title: 'Complementar módulo A',
            description: 'Adicionar helper em src/modA.cjs',
            allowedScope: ['src/modA.cjs', 'test/suite.test.cjs'],
            criteria: ['Helper de A validado'],
            verificationCommand: 'npm test',
            dependencies: ['1.1']
          }
        ]
      },
      {
        code: 'GT-2',
        title: 'Camada Superior GT-2',
        objective: 'Construir módulo B após GT-1',
        dependencies: ['GT-1'],
        microtasks: [
          {
            code: '2.1',
            title: 'Implementar módulo B',
            description: 'Criar src/modB.cjs usando módulo A',
            allowedScope: ['src/modB.cjs', 'test/suite.test.cjs'],
            criteria: ['Módulo B integrado com A'],
            verificationCommand: 'npm test',
            dependencies: [] // Sem dependência direta de microtarefa, mas subordinada a GT-2 que depende de GT-1!
          }
        ]
      }
    ]
  });

  // Verificar Finding A1: colunas persistidas em projects
  const projRow: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  assert.equal(projRow.active_run_id, runId);
  assert.equal(projRow.active_plan_run_id, runId, 'Finding A1: active_plan_run_id deve ser persistido na tabela projects');
  assert.deepEqual(JSON.parse(projRow.requirements_json), ['REQ-A: Módulo A', 'REQ-B: Módulo B dependente de GT-1']);

  // Verificar Finding A2: contract_id deve ter sido atualizado no ON CONFLICT(id) DO UPDATE
  const t1_1 = plan.microtasks.find((m: any) => m.code === '1.1');
  const t1_2 = plan.microtasks.find((m: any) => m.code === '1.2');
  const t2_1 = plan.microtasks.find((m: any) => m.code === '2.1');
  assert.ok(t1_1.contract_id, 'Finding A2: contract_id deve ser persistido mesmo em tarefa pré-inserida');

  // Verificar Finding A4: Microtarefa 2.1 subordinada a GT-2 (que depende de GT-1) deve nascer PLANNED, nunca READY
  assert.equal(t2_1.lifecycle_state, 'PLANNED', 'Finding A4: Microtarefa 2.1 em GT-2 dependente de GT-1 deve nascer PLANNED');
  assert.equal(t2_1.status, 'pending');

  // Seção 5 & Finding A6: Tentar forçar transição de 1.2 (com dependência 1.1 pendente) ou 2.1 (com GT-1 pendente) para IN_PROGRESS deve falhar
  assert.throws(
    () =>
      HierarchicalOrchestrationService.transitionTaskState({
        taskId: t1_2.id,
        toState: 'IN_PROGRESS',
        actor: 'supervisor',
        reason: 'Tentativa de iniciar 1.2 antes de 1.1'
      }),
    /INVALID_STATE_TRANSITION|UNMET_DEPENDENCIES_FORBIDDEN/,
    'Deve bloquear início de microtarefa com dependência pendente'
  );
  assert.throws(
    () =>
      HierarchicalOrchestrationService.transitionTaskState({
        taskId: t1_2.id,
        toState: 'READY',
        actor: 'supervisor',
        reason: 'Tentativa de liberar 1.2 antes de concluir 1.1'
      }),
    /UNMET_DEPENDENCIES_FORBIDDEN/,
    'Finding A6: Deve bloquear transição para READY quando dependência 1.1 não está COMPLETED'
  );
  assert.throws(
    () =>
      HierarchicalOrchestrationService.transitionTaskState({
        taskId: t2_1.id,
        toState: 'READY',
        actor: 'supervisor',
        reason: 'Tentativa de liberar 2.1 antes de concluir GT-1'
      }),
    /UNMET_MAJOR_DEPENDENCIES_FORBIDDEN/,
    'Finding A6: Deve bloquear transição de 2.1 para READY enquanto a Grande Tarefa GT-1 não está COMPLETED'
  );

  // Iniciar 1.1 e submeter relatório para colocá-la em REVIEW_PENDING
  AutonomousManager.claimTask(t1_1.id, 'worker-audit');
  const currentTask1_1: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(t1_1.id);

  // Seção 4 & Finding A5: Submeter relatório com executionId ou attempt antigo/inválido deve ser rejeitado com STALE_EXECUTION_RESULT
  assert.throws(
    () =>
      AutonomousManager.submitBuilderReport({
        runId,
        taskId: t1_1.id,
        executionId: 'exec-stale-old-999',
        status: 'success',
        filesChanged: ['src/modA.cjs'],
        implemented: ['Tentativa atrasada de execução antiga']
      }),
    /STALE_EXECUTION_RESULT/,
    'Finding A5: Deve rejeitar relatório do Worker com executionId de execução antiga'
  );
  assert.throws(
    () =>
      AutonomousManager.submitBuilderReport({
        runId,
        taskId: t1_1.id,
        attempt: 99,
        status: 'success',
        filesChanged: ['src/modA.cjs'],
        implemented: ['Tentativa com número incorreto']
      }),
    /STALE_EXECUTION_RESULT/,
    'Finding A5: Deve rejeitar relatório do Worker com attempt divergente da tentativa atual'
  );

  // Submeter relatório válido na tentativa atual
  fs.writeFileSync(path.join(repoDir, 'src', 'modA.cjs'), 'module.exports = { a: 1 };\n', 'utf-8');
  const validRep = AutonomousManager.submitBuilderReport({
    runId,
    taskId: t1_1.id,
    executionId: currentTask1_1.execution_id,
    attempt: 1,
    status: 'success',
    filesChanged: ['src/modA.cjs'],
    implemented: ['Criado src/modA.cjs']
  });
  assert.equal(validRep.lifecycleState, 'REVIEW_PENDING');

  // Seção 5 & Finding A6: Tentar falsificar APPROVED via endpoint HTTP POST /api/autonomous/tasks/:id/transition sem avaliação PASS do IndependentEvaluator
  const forgeRes = await fetch(`${baseUrl}/autonomous/tasks/${t1_1.id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toLifecycleState: 'APPROVED',
      actor: 'review',
      reason: 'Tentativa de burlar o IndependentEvaluator via API HTTP'
    })
  });
  assert.equal(forgeRes.status, 400, 'Finding A6: Endpoint HTTP /transition deve recusar APPROVED sem avaliação independente PASS');
  const forgeBody: any = await forgeRes.json();
  assert.match(forgeBody.error, /REVIEW_EVIDENCE_REQUIRED/);

  // Seção 4 & Finding A5: Tentar submeter revisão com reportId ou executionId antigo deve falhar
  assert.throws(
    () =>
      AutonomousManager.submitSupervisorReview({
        runId,
        taskId: t1_1.id,
        reportId: 'rep-old-nonexistent',
        verdict: 'CHANGES_REQUESTED',
        feedback: 'Revisão atrasada referente a report antigo'
      }),
    /STALE_EXECUTION_RESULT/,
    'Finding A5: Deve rejeitar revisão que referencia reportId de tentativa antiga'
  );
});

test('Auditoria Seção 6 e Seção 7: Os 7 Cenários Controlados Adversariais do Review Independente e Ciclo de Reprovação até max_retries -> BLOCKED', async (t) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-audit-s67-'));
  createIsolatedGitRepo(repoDir);
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  const projectId = `proj-audit-s6-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-audit-s6-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, path, objective, description, status, is_trusted, full_dev_autonomy, created_at, updated_at)
     VALUES (?, 'Audit Review Scenarios', ?, 'Auditoria adversária do Review', '7 cenários controlados', 'active', 1, 1, ?, ?)`
  ).run(projectId, repoDir, now, now);

  db.prepare(
    `INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
     VALUES (?, ?, 'Run Review Audit', 'Auditoria adversária do Review', '7 cenários controlados', 'running', ?, ?, ?)`
  ).run(runId, projectId, now, now, now);

  fs.writeFileSync(
    path.join(repoDir, 'test', 'suite.test.cjs'),
    [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const calc = require('../src/calculator.cjs');",
      "test('calculator add and multiply', () => {",
      "  assert.equal(calc.add(2, 3), 5);",
      "  assert.equal(calc.multiply(4, 5), 20);",
      "});",
      ""
    ].join('\n'),
    'utf-8'
  );

  const plan = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: repoDir,
    originalDescription: 'Validar os 7 cenários do Review e bloqueio por max_retries',
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Módulo de Cálculo Auditado',
        objective: 'Implementar src/calculator.cjs com add e multiply',
        microtasks: [
          {
            code: '1.1',
            title: 'Implementar calculadora verificável',
            description: 'Criar src/calculator.cjs com funções add(a,b) e multiply(a,b)',
            allowedScope: ['src/calculator.cjs'],
            criteria: [
              'Função add(2, 3) retorna 5',
              'Função multiply(4, 5) retorna 20'
            ],
            verificationCommand: 'npm test',
            maxRetries: 10,
            dependencies: []
          },
          {
            code: '1.2',
            title: 'Tarefa para testar limite de tentativas (max_retries = 2)',
            description: 'Criar src/retryLimit.cjs',
            allowedScope: ['src/retryLimit.cjs'],
            criteria: ['Arquivo src/retryLimit.cjs implementado corretamente'],
            verificationCommand: 'npm test',
            maxRetries: 2,
            dependencies: ['1.1']
          }
        ]
      }
    ]
  });

  const task = plan.microtasks[0];
  const retryTask = plan.microtasks[1];

  // =========================================================================
  // CENÁRIO 6.1: Worker declara que terminou, mas não implementa o recurso
  // =========================================================================
  AutonomousManager.claimTask(task.id, 'worker-s6');
  const decision6_1 = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
    runId,
    taskId: task.id,
    projectPath: repoDir,
    workerReport: {
      status: 'success',
      filesChanged: [], // Nenhum arquivo alterado e src/calculator.cjs não existe no disco!
      implemented: ['Declarei que terminei sem escrever código']
    }
  });
  assert.equal(decision6_1.decision, 'REJECTED', 'Cenário 6.1: Review deve REPROVAR quando Worker declara conclusão sem implementar o arquivo exigido');
  assert.ok(decision6_1.problemsFound.some(p => /ausentes em disco|Nenhuma avaliação independente/i.test(p)));

  // =========================================================================
  // CENÁRIO 6.2: Worker implementa somente parte dos critérios
  // =========================================================================
  fs.writeFileSync(
    path.join(repoDir, 'src', 'calculator.cjs'),
    'module.exports = { add: (a, b) => a + b }; // multiply ausente\n',
    'utf-8'
  );
  const decision6_2 = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
    runId,
    taskId: task.id,
    projectPath: repoDir,
    workerReport: {
      status: 'success',
      filesChanged: ['src/calculator.cjs'],
      implemented: ['Implementado apenas add(a,b)']
    },
    evaluationResult: {
      id: crypto.randomUUID(),
      contractId: task.contract_id,
      taskId: task.id,
      verdict: 'FAIL',
      taskIsDone: false,
      passedCriteria: ['Função add(2, 3) retorna 5'],
      failedCriteria: ['Função multiply(4, 5) retorna 20'],
      executedCommands: ['npm test'],
      exitCode: 1,
      actual: 'AssertionError: calculator.multiply is not a function',
      evaluatorNotes: 'Apenas 1 de 2 critérios atendidos.'
    } as any
  });
  assert.equal(decision6_2.decision, 'REJECTED', 'Cenário 6.2: Review deve REPROVAR implementação parcial dos critérios');
  const multCrit = decision6_2.evaluatedCriteria.find(c => c.criterion.includes('multiply'));
  assert.equal(multCrit?.status, 'FAILED', 'Cenário 6.2: Critério não implementado deve constar como FAILED');

  // =========================================================================
  // CENÁRIO 6.3: Worker altera arquivos não relacionados (fora do escopo permitido)
  // =========================================================================
  fs.writeFileSync(path.join(repoDir, 'src', 'unrelated_hack.cjs'), 'module.exports = {};\n', 'utf-8');
  const decision6_3 = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
    runId,
    taskId: task.id,
    projectPath: repoDir,
    workerReport: {
      status: 'success',
      filesChanged: ['src/calculator.cjs', 'src/unrelated_hack.cjs'],
      implemented: ['Alterado arquivo fora do escopo sem justificativa']
    },
    evaluationResult: {
      id: crypto.randomUUID(),
      contractId: task.contract_id,
      taskId: task.id,
      verdict: 'PASS',
      taskIsDone: true,
      passedCriteria: ['Função add(2, 3) retorna 5', 'Função multiply(4, 5) retorna 20'],
      failedCriteria: [],
      executedCommands: ['npm test'],
      exitCode: 0,
      actual: 'PASS'
    } as any
  });
  assert.equal(decision6_3.decision, 'REJECTED', 'Cenário 6.3 (Finding A7): Review deve REPROVAR por padrão quando Worker altera arquivo fora do escopo permitido');
  assert.ok(decision6_3.outOfScopeFiles.includes('src/unrelated_hack.cjs'));
  fs.rmSync(path.join(repoDir, 'src', 'unrelated_hack.cjs'), { force: true });

  // =========================================================================
  // CENÁRIO 6.4: Worker apresenta testes que não foram realmente executados
  // =========================================================================
  const decision6_4 = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
    runId,
    taskId: task.id,
    projectPath: repoDir,
    workerReport: {
      status: 'success',
      filesChanged: ['src/calculator.cjs'],
      implemented: ['Implementação completa'],
      testsRun: '150 unit tests executed and passed in 0.001ms',
      testResults: '150 passing'
    },
    evaluationResult: {
      id: crypto.randomUUID(),
      contractId: task.contract_id,
      taskId: task.id,
      verdict: 'PASS',
      taskIsDone: true,
      passedCriteria: ['Função add(2, 3) retorna 5', 'Função multiply(4, 5) retorna 20'],
      failedCriteria: [],
      executedCommands: [], // Nenhum comando foi realmente executado!
      exitCode: 0,
      actual: 'No command executed'
    } as any
  });
  assert.equal(decision6_4.decision, 'REJECTED', 'Cenário 6.4 (Finding A7): Review deve REPROVAR quando nenhum comando de verificação foi realmente executado');
  assert.ok(decision6_4.problemsFound.some(p => /nenhum comando de verificação foi realmente executado/i.test(p)));

  // =========================================================================
  // CENÁRIO 6.5: Worker produz uma implementação com falha funcional
  // =========================================================================
  fs.writeFileSync(
    path.join(repoDir, 'src', 'calculator.cjs'),
    'module.exports = { add: (a, b) => a - b, multiply: (a, b) => a * b };\n', // Bug funcional: subtrai em vez de somar
    'utf-8'
  );
  const realEvalFail = await IndependentEvaluator.evaluate(task.contract_id, repoDir, {
    status: 'success',
    filesChanged: ['src/calculator.cjs'],
    implemented: ['Implementação com bug funcional na soma']
  });
  assert.equal(realEvalFail.verdict, 'FAIL', 'Cenário 6.5: IndependentEvaluator executa npm test real e detecta falha funcional');
  const decision6_5 = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
    runId,
    taskId: task.id,
    projectPath: repoDir,
    workerReport: {
      status: 'success',
      filesChanged: ['src/calculator.cjs'],
      implemented: ['Implementação com bug funcional na soma']
    },
    evaluationResult: realEvalFail
  });
  assert.equal(decision6_5.decision, 'REJECTED', 'Cenário 6.5: Review deve REPROVAR implementação com falha funcional real nos testes');

  // =========================================================================
  // CENÁRIO 6.7: Worker entrega um relatório inconsistente com o código real em disco
  // =========================================================================
  const decision6_7 = HierarchicalOrchestrationService.evaluateIndependentReviewDecision({
    runId,
    taskId: task.id,
    projectPath: repoDir,
    workerReport: {
      status: 'success',
      filesChanged: ['src/calculator.cjs', 'src/arquivo_inexistente_declarado.cjs'],
      implemented: ['Relatório mente dizendo que criou src/arquivo_inexistente_declarado.cjs']
    },
    evaluationResult: realEvalFail
  });
  assert.equal(decision6_7.decision, 'REJECTED', 'Cenário 6.7 (Finding A7): Review deve REPROVAR quando o relatório declara arquivo inexistente no disco');
  assert.ok(decision6_7.problemsFound.some(p => /inconsistente com o código real/i.test(p)));

  // =========================================================================
  // CENÁRIO 6.6: Worker implementa corretamente todos os critérios
  // =========================================================================
  fs.writeFileSync(
    path.join(repoDir, 'src', 'calculator.cjs'),
    'module.exports = { add: (a, b) => Number(a) + Number(b), multiply: (a, b) => Number(a) * Number(b) };\n',
    'utf-8'
  );
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: task.id,
    status: 'success',
    filesChanged: ['src/calculator.cjs'],
    implemented: ['Implementado add e multiply corretamente em src/calculator.cjs'],
    testsRun: 'npm test',
    testResults: '1 passing'
  });
  const realEvalPass = await IndependentEvaluator.evaluate(task.contract_id, repoDir, {
    status: 'success',
    filesChanged: ['src/calculator.cjs'],
    implemented: ['Implementado add e multiply corretamente em src/calculator.cjs']
  });
  assert.equal(realEvalPass.verdict, 'PASS', 'Cenário 6.6: IndependentEvaluator confirma PASS na execução real');

  const reviewPass = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: task.id,
    verdict: 'APPROVED',
    feedback: 'Todos os critérios verificados com sucesso.',
    evaluation: realEvalPass
  });
  assert.equal(reviewPass.reviewDecision.decision, 'APPROVED', 'Cenário 6.6: Review aprova somente quando todos os critérios e testes reais passam');
  assert.equal(reviewPass.commitGate?.committed, true);

  // =========================================================================
  // SEÇÃO 7: Ciclo de Reprovação e Retrabalho até atingir max_retries -> BLOCKED
  // =========================================================================
  const availRetry = AutonomousManager.getAvailableTasks(runId);
  assert.equal(availRetry.length, 1);
  assert.equal(availRetry[0].id, retryTask.id);

  // Tentativa 1 de 2 -> Reprovada -> REWORK_REQUIRED (retry_count = 1)
  AutonomousManager.claimTask(retryTask.id, 'worker-s7');
  fs.writeFileSync(path.join(repoDir, 'src', 'retryLimit.cjs'), '// TODO: implement later\n', 'utf-8');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: retryTask.id,
    status: 'success',
    filesChanged: ['src/retryLimit.cjs'],
    implemented: ['Tentativa 1 falha']
  });
  AutonomousManager.submitSupervisorReview({
    runId,
    taskId: retryTask.id,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Falha na tentativa 1 de 2'
  });
  const afterAttempt1: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(retryTask.id);
  assert.equal(afterAttempt1.lifecycle_state, 'REWORK_REQUIRED');
  assert.equal(afterAttempt1.retry_count, 1);

  // Tentativa 2 de 2 -> Reprovada -> Atinge max_retries (2) -> Transiciona automaticamente para BLOCKED
  AutonomousManager.claimTask(retryTask.id, 'worker-s7');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: retryTask.id,
    status: 'success',
    filesChanged: ['src/retryLimit.cjs'],
    implemented: ['Tentativa 2 falha novamente']
  });
  AutonomousManager.submitSupervisorReview({
    runId,
    taskId: retryTask.id,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Falha na tentativa 2 de 2 (limite atingido)'
  });
  const afterAttempt2: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(retryTask.id);
  assert.equal(afterAttempt2.lifecycle_state, 'BLOCKED', 'Seção 7: Ao atingir max_retries sem aprovação, a microtarefa deve ir para BLOCKED');
  assert.equal(afterAttempt2.status, 'blocked');
  assert.equal(afterAttempt2.retry_count, 2);
  const historyAttempts = JSON.parse(afterAttempt2.attempt_history_json);
  assert.equal(historyAttempts.length, 2, 'Seção 7: Histórico de todas as tentativas deve permanecer preservado sem sobrescrita');
});

test('Auditoria Seção 8 e Seção 9: Isolamento Git de arquivos sujos não relacionados, exclusão de segredos e Recuperação de Crash pós-aprovação e pós-commit', async (t) => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-audit-s89-'));
  createIsolatedGitRepo(repoDir);
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  const projectId = `proj-audit-s89-${crypto.randomUUID().slice(0, 8)}`;
  const runId = `run-audit-s89-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, path, objective, description, status, is_trusted, full_dev_autonomy, created_at, updated_at)
     VALUES (?, 'Audit Git & Crash Recovery', ?, 'Validar Git e Crash Recovery', 'Auditoria Seções 8 e 9', 'active', 1, 1, ?, ?)`
  ).run(projectId, repoDir, now, now);

  db.prepare(
    `INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, start_time, created_at, updated_at)
     VALUES (?, ?, 'Run Git & Recovery', 'Validar Git e Crash Recovery', 'Auditoria Seções 8 e 9', 'running', ?, ?, ?)`
  ).run(runId, projectId, now, now, now);

  const plan = HierarchicalOrchestrationService.persistHierarchicalPlan({
    projectId,
    runId,
    projectPath: repoDir,
    originalDescription: 'Auditoria de Git seletivo e recuperação de falha entre aprovação e commit',
    majorTasks: [
      {
        code: 'GT-1',
        title: 'Entrega com Isolamento Git e Crash Recovery',
        objective: 'Testar commit seletivo e reconciliação de crash',
        microtasks: [
          {
            code: '1.1',
            title: 'Implementar serviço isolado',
            description: 'Criar src/isolatedService.cjs sem incluir arquivos sujos de outra tarefa',
            allowedScope: ['src/isolatedService.cjs', 'test/suite.test.cjs'],
            criteria: ['src/isolatedService.cjs exporta ok = true'],
            verificationCommand: 'npm test',
            dependencies: []
          },
          {
            code: '1.2',
            title: 'Microtarefa interrompida entre commit Git e SQLite',
            description: 'Simular crash logo após o git commit antes de atualizar SQLite',
            allowedScope: ['src/crashAfterCommit.cjs'],
            criteria: ['src/crashAfterCommit.cjs criado'],
            verificationCommand: 'npm test',
            dependencies: ['1.1']
          },
          {
            code: '1.3',
            title: 'Microtarefa interrompida entre APPROVED e commit Git',
            description: 'Simular crash logo após APPROVED antes de rodar git commit',
            allowedScope: ['src/crashBeforeCommit.cjs'],
            criteria: ['src/crashBeforeCommit.cjs criado'],
            verificationCommand: 'npm test',
            dependencies: ['1.2']
          }
        ]
      }
    ]
  });

  const [t1_1, t1_2, t1_3] = plan.microtasks;

  // =========================================================================
  // SEÇÃO 8 (Finding A8): Arquivo sujo NÃO relacionado e arquivo .env na working tree
  // NÃO podem ser incluídos no commit da microtarefa 1.1!
  // =========================================================================
  AutonomousManager.claimTask(t1_1.id, 'worker-git');
  fs.writeFileSync(path.join(repoDir, 'src', 'isolatedService.cjs'), 'module.exports = { ok: true };\n', 'utf-8');
  fs.writeFileSync(path.join(repoDir, 'src', 'unrelated_dirty_other_task.cjs'), 'module.exports = { dirty: true };\n', 'utf-8');
  fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET_KEY=super_secret_should_never_be_committed\n', 'utf-8');

  AutonomousManager.submitBuilderReport({
    runId,
    taskId: t1_1.id,
    status: 'success',
    filesChanged: ['src/isolatedService.cjs'],
    implemented: ['Criado src/isolatedService.cjs']
  });
  const eval1_1 = await IndependentEvaluator.evaluate(t1_1.contract_id, repoDir, {
    status: 'success',
    filesChanged: ['src/isolatedService.cjs'],
    implemented: ['Criado src/isolatedService.cjs']
  });
  assert.equal(eval1_1.verdict, 'PASS');

  const rev1_1 = AutonomousManager.submitSupervisorReview({
    runId,
    taskId: t1_1.id,
    verdict: 'APPROVED',
    feedback: 'Aprovado para teste de isolamento Git',
    evaluation: eval1_1
  });
  assert.equal(rev1_1.commitGate?.committed, true);
  const sha1_1 = rev1_1.commitGate?.commitSha;
  assert.ok(sha1_1);

  // Inspecionar os arquivos que entraram no commit sha1_1
  const committedFilesIn1_1 = execFileSync('git', ['show', '--name-only', '--pretty=format:', sha1_1], {
    cwd: repoDir,
    encoding: 'utf-8'
  })
    .trim()
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  assert.ok(committedFilesIn1_1.includes('src/isolatedService.cjs'), 'Seção 8: O arquivo da microtarefa deve estar no commit');
  assert.equal(
    committedFilesIn1_1.includes('src/unrelated_dirty_other_task.cjs'),
    false,
    'Seção 8 (Finding A8): Arquivo sujo de outra tarefa NÃO pode ser varrido para dentro do commit!'
  );
  assert.equal(
    committedFilesIn1_1.includes('.env'),
    false,
    'Seção 8: Arquivo .env sensível JAMAIS pode entrar no commit!'
  );

  // Verificar commit_status persistido no banco
  const t1_1Row: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(t1_1.id);
  assert.equal(t1_1Row.commit_status, 'local_committed', 'Finding A8: commit_status deve registrar local_committed');

  // Limpar o arquivo sujo não relacionado
  fs.rmSync(path.join(repoDir, 'src', 'unrelated_dirty_other_task.cjs'), { force: true });

  // =========================================================================
  // SEÇÃO 9 (Finding A9 - Parte 1): Simular falha/crash ENTRE o commit Git e a persistência no SQLite
  // =========================================================================
  AutonomousManager.claimTask(t1_2.id, 'worker-recovery');
  fs.writeFileSync(path.join(repoDir, 'src', 'crashAfterCommit.cjs'), 'module.exports = { recoveredAfterCommit: true };\n', 'utf-8');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: t1_2.id,
    status: 'success',
    filesChanged: ['src/crashAfterCommit.cjs'],
    implemented: ['Criado src/crashAfterCommit.cjs']
  });

  // Simular que o Review aprovou (COMMIT_PENDING) e o git commit foi criado no repositório, mas o processo caiu antes de gravar task_commit_sha e COMPLETED no SQLite!
  db.prepare(
    "UPDATE autonomous_tasks SET status = 'commit_pending', lifecycle_state = 'COMMIT_PENDING', review_decision = 'APPROVED', task_commit_sha = NULL WHERE id = ?"
  ).run(t1_2.id);
  execFileSync('git', ['add', 'src/crashAfterCommit.cjs'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync(
    'git',
    ['commit', '-m', `feat(task-1.2): [GT-1] ${t1_2.title} [task:${t1_2.id.slice(0, 8)}]`],
    { cwd: repoDir, stdio: 'pipe' }
  );
  const preCrashSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();
  const commitCountBeforeRecovery = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();

  // Executar recuperação de inicialização do Runner
  AutonomousRunnerService.recoverInterruptedRuns();

  const t1_2Recovered: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(t1_2.id);
  const commitCountAfterRecovery = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repoDir, encoding: 'utf-8' }).trim();

  assert.equal(t1_2Recovered.status, 'completed', 'Seção 9 (Finding A9): Tarefa interrompida após commit deve ser reconciliada para completed');
  assert.equal(t1_2Recovered.lifecycle_state, 'COMPLETED');
  assert.equal(t1_2Recovered.task_commit_sha, preCrashSha, 'Seção 9: Deve recuperar o SHA exato do commit já existente no Git');
  assert.equal(commitCountAfterRecovery, commitCountBeforeRecovery, 'Seção 9: Não deve criar commit duplicado na reconciliação pós-commit');

  // =========================================================================
  // SEÇÃO 9 (Finding A9 - Parte 2): Simular falha/crash ENTRE a aprovação do Review (APPROVED) e o commit Git
  // =========================================================================
  AutonomousManager.claimTask(t1_3.id, 'worker-recovery');
  fs.writeFileSync(path.join(repoDir, 'src', 'crashBeforeCommit.cjs'), 'module.exports = { recoveredBeforeCommit: true };\n', 'utf-8');
  AutonomousManager.submitBuilderReport({
    runId,
    taskId: t1_3.id,
    status: 'success',
    filesChanged: ['src/crashBeforeCommit.cjs'],
    implemented: ['Criado src/crashBeforeCommit.cjs']
  });

  // Simular que o Review aprovou (estado APPROVED no SQLite), mas o sistema caiu antes de executar o Commit Gate
  db.prepare(
    "UPDATE autonomous_tasks SET status = 'approved', lifecycle_state = 'APPROVED', review_decision = 'APPROVED', task_commit_sha = NULL WHERE id = ?"
  ).run(t1_3.id);

  AutonomousRunnerService.recoverInterruptedRuns();

  const t1_3Recovered: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(t1_3.id);
  assert.equal(t1_3Recovered.status, 'completed', 'Seção 9 (Finding A9): Tarefa interrompida em APPROVED deve criar o commit pendente e concluir na recuperação');
  assert.equal(t1_3Recovered.lifecycle_state, 'COMPLETED');
  assert.ok(t1_3Recovered.task_commit_sha, 'Seção 9: SHA do commit criado na recuperação deve estar registrado');
});
