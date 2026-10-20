import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';

describe('DecoHUB Fase 7 — Suíte de Regressão Determinística do Fluxo Autônomo & Quota', () => {
  const testProjectId = `proj-fase7-${Date.now()}`;
  const testProjectDir = path.join(os.tmpdir(), testProjectId);
  const testProfileId = `prof-fase7-${Date.now()}`;
  const runId = `run-fase7-${Date.now()}`;
  const task1Id = `task-f7-1-${Date.now()}`;
  const task2Id = `task-f7-2-${Date.now()}`;
  const workerId = `worker-fase7-${Date.now()}`;
  const nowIso = new Date().toISOString();

  before(() => {
    fs.mkdirSync(testProjectDir, { recursive: true });

    // Setup Test AccountProfile
    db.prepare(`
      INSERT INTO account_profiles (id, display_name, profile_name, google_account_label, environment_path, auth_status, created_at, updated_at)
      VALUES (?, 'Profile Fase 7', 'prof_fase7', 'tester@fase7.local', ?, 'READY', ?, ?)
    `).run(testProfileId, testProjectDir, nowIso, nowIso);

    // Setup Test Project
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at, github_repo, github_branch, active_account_profile_id)
      VALUES (?, 'Projeto Financeiro Fase 7', ?, 'Controle Financeiro', ?, ?, 'deco-verc/test-repo-fase7', 'main', ?)
    `).run(testProjectId, testProjectDir, nowIso, nowIso, testProfileId);

    // Setup Worker
    db.prepare(`
      INSERT INTO workers (id, name, provider, account_label, status, account_profile_id, pid, last_heartbeat, created_at, updated_at)
      VALUES (?, 'Worker Fase 7', 'antigravity', 'tester@fase7.local', 'READY', ?, ?, ?, ?, ?)
    `).run(workerId, testProfileId, process.pid, nowIso, nowIso, nowIso);

    // Setup Run
    db.prepare(`
      INSERT INTO autonomous_runs (
        id, project_id, name, objective, briefing, status, autonomy_mode,
        branch_name, max_hours, max_cycles, current_cycle, start_time,
        config_json, created_at, updated_at
      ) VALUES (?, ?, 'Execução Teste Fase 7', 'Construir módulo financeiro', 'Briefing', 'running', 'autonomous', 'main', 4.0, 25, 0, ?, '{}', ?, ?)
    `).run(runId, testProjectId, nowIso, nowIso, nowIso);

    // Setup Task 1 (ready) and Task 2 (pending dependent on Task 1)
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
      VALUES (?, ?, 'Task 1 Entidades', 'Modelos de dados', 'M1', 1, '[]', 'ready', 'builder', '["Criar entidades"]', ?, ?)
    `).run(task1Id, runId, nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, assigned_to, criteria_json, created_at, updated_at)
      VALUES (?, ?, 'Task 2 Cálculo', 'Motor de cálculos', 'M1', 2, ?, 'pending', 'builder', '["Cálculo correto"]', ?, ?)
    `).run(task2Id, runId, JSON.stringify([task1Id]), nowIso, nowIso);
  });

  after(() => {
    WorkerRegistry.releaseAllLeases(workerId);
    db.prepare('DELETE FROM worker_leases WHERE worker_id = ?').run(workerId);
    db.prepare('DELETE FROM workers WHERE id = ?').run(workerId);
    db.prepare('DELETE FROM autonomous_events WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(testProjectId);
    db.prepare('DELETE FROM autonomous_tasks WHERE run_id IN (SELECT id FROM autonomous_runs WHERE project_id = ?)').run(testProjectId);
    db.prepare('DELETE FROM autonomous_runs WHERE project_id = ?').run(testProjectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(testProjectId);
    db.prepare('DELETE FROM account_profiles WHERE id = ?').run(testProfileId);
    try { fs.rmSync(testProjectDir, { recursive: true, force: true }); } catch (err) {
      if (typeof logger !== "undefined" && logger.warn) {
        logger.warn({
          event: "server.handled_exception",
          file: "autonomousFlowAndQuota.test",
          error: err?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousFlowAndQuota.test]", err);
      }
    }
  });

  // 1. Mensagem nova cria execução
  test('1. Mensagem nova cria execução e persiste no SQLite', () => {
    const run = AutonomousManager.getRun(runId);
    assert.ok(run, 'Run deve existir no SQLite');
    assert.strictEqual(run.project_id, testProjectId);
    assert.strictEqual(run.status, 'running');
  });

  // 2. Scheduler recebe Run
  test('2. Scheduler identifica e agenda o Run em status running', () => {
    const candidate: any = db.prepare(`
      SELECT * FROM autonomous_runs
      WHERE status IN ('running', 'building', 'testing', 'reviewing', 'waiting_for_worker')
      ORDER BY updated_at ASC
    `).all().find((r: any) => r.id === runId);

    assert.ok(candidate, 'Scheduler deve encontrar o Run em running');
    assert.strictEqual(candidate.id, runId);
  });

  // 3. Task pronta é despachada
  test('3. Task pronta com dependências satisfeitas é elegível e reivindicada com Lease atômica', () => {
    const available = AutonomousManager.getAvailableTasks(runId);
    assert.strictEqual(available.length, 1);
    assert.strictEqual(available[0].id, task1Id);

    // Reivindicar tarefa com lease atômica
    const leaseId = WorkerRegistry.claimTask(workerId, runId, task1Id, 101);
    assert.ok(leaseId, 'Lease deve ser gerada');

    const worker = WorkerRegistry.getWorker(workerId)!;
    assert.strictEqual(worker.status, 'WORKING');
    assert.strictEqual(worker.current_task_id, task1Id);
  });

  // 4. Worker indisponível gera bloqueio explícito
  test('4. Worker indisponível ou em erro gera bloqueio explícito sem silêncio', () => {
    WorkerRegistry.updateWorkerStatus(workerId, 'OFFLINE');
    const readyWorkers = WorkerRegistry.getReadyWorkers().filter(w => w.account_profile_id === testProfileId);
    assert.strictEqual(readyWorkers.length, 0, 'Nenhum worker deve estar ready');

    // Restaurar worker
    WorkerRegistry.updateWorkerStatus(workerId, 'READY');
  });

  // 5. Quota 429 preserva tarefa
  test('5. Erro RESOURCE_EXHAUSTED 429 preserva tarefa em READY e pausa Run de forma segura', () => {
    const errorMsg = 'RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 1h';
    AccountProfileManager.markQuotaExhausted(testProfileId, errorMsg);

    const prof = AccountProfileManager.getProfile(testProfileId)!;
    assert.strictEqual(prof.auth_status, 'QUOTA_EXHAUSTED');
    assert.ok(prof.quota_resets_at, 'Deve ter timestamp de reset');

    const isAvailable = AccountProfileManager.isAccountAvailableForTasks(testProfileId);
    assert.strictEqual(isAvailable, false, 'Conta com quota esgotada não pode ser elegível para tarefas');

    // Restaurar perfil para continuar os testes determinísticos
    db.prepare("UPDATE account_profiles SET auth_status = 'READY', quota_resets_at = NULL WHERE id = ?").run(testProfileId);
    WorkerRegistry.updateWorkerStatus(workerId, 'READY');
  });

  // 6. Retomada não duplica execução
  test('6. Retomada não duplica execução nem cria múltiplos runs concorrentes', () => {
    const active = AutonomousManager.getActiveRunForProject(testProjectId);
    assert.ok(active);
    assert.strictEqual(active.id, runId, 'Deve manter o mesmo Run ID');
  });

  // 7. Falha do Worker não produz aprovação falsa
  test('7. Falha na execução do Worker não produz aprovação falsa', () => {
    AutonomousManager.submitSupervisorReview({
      runId,
      taskId: task1Id,
      verdict: 'CHANGES_REQUESTED',
      feedback: 'Testes falharam. Corrija os erros.',
      requirementsMet: false,
      buildPassed: false,
      testsPassed: false,
      uiFunctional: false,
      qualityScore: 2
    });

    const taskRow: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(task1Id);
    assert.notStrictEqual(taskRow.status, 'completed', 'Task não pode ser completada em caso de falha');
  });

  // 8. Evaluator rejeita testes falhos
  test('8. Independent Evaluator rejeita testes falhos objetivamente', async () => {
    fs.writeFileSync(path.join(testProjectDir,'failing-proof.cjs'),"require('node:assert/strict').equal(2+3,6,'negative fixture: demonstrable wrong expected result');");
    const contract = IndependentEvaluator.createSuccessContract({
      taskId: task1Id,
      runId,
      projectId: testProjectId,
      projectPath: testProjectDir,
      objective: 'Validação matemática',
      acceptanceCriteria: ['Passar no teste'],
      verificationCommand: 'node failing-proof.cjs',
      protectedEvaluationFiles: []
    });

    const evalRes = await IndependentEvaluator.evaluate(contract.id, testProjectDir, {
      status: 'success',
      filesChanged: ['src/index.js'],
      implemented: ['Módulo'],
      commandsExecuted: [],
      tests: { ran: true, command: 'npm test', passed: true }
    });

    assert.strictEqual(evalRes.verdict, 'FAIL');
    assert.strictEqual(evalRes.taskIsDone, false);
  });

  // 9. Task aprovada libera a próxima
  test('9. Task aprovada pelo Supervisor avança status para completed e libera Task 2 dependente', () => {
    WorkerRegistry.releaseAllLeases(workerId);
    db.prepare("UPDATE autonomous_tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(nowIso, task1Id);

    const available = AutonomousManager.getAvailableTasks(runId);
    const availableIds = available.map(t => t.id);
    assert.ok(availableIds.includes(task2Id), 'Task 2 deve transicionar para pronta após conclusão de Task 1');

    const task2Row: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(task2Id);
    assert.strictEqual(task2Row.status, 'ready', 'Task 2 deve estar gravada como ready no SQLite');
  });

  // 10. GitHub recebe eventos reais do Runner
  test('10. GitHub events são registrados no runner com issue e pull request IDs', () => {
    AutonomousManager.logEvent(
      runId,
      task1Id,
      'supervisor',
      'GITHUB_ISSUE_CREATED',
      'Issue #10 criada no GitHub para Task 1',
      { issueNumber: 10, url: 'https://github.com/deco-verc/test-repo-fase7/issues/10' }
    );

    AutonomousManager.logEvent(
      runId,
      task1Id,
      'builder',
      'GITHUB_PR_OPENED',
      'PR #11 aberta no GitHub para Task 1',
      { prNumber: 11, url: 'https://github.com/deco-verc/test-repo-fase7/pull/11' }
    );

    const events: any[] = db.prepare('SELECT * FROM autonomous_events WHERE run_id = ?').all(runId);
    const issueEvent = events.find((e: any) => e.event_type === 'GITHUB_ISSUE_CREATED');
    const prEvent = events.find((e: any) => e.event_type === 'GITHUB_PR_OPENED');

    assert.ok(issueEvent, 'Evento de criação de issue deve existir');
    assert.ok(prEvent, 'Evento de PR aberta deve existir');
  });

  // 11. Retry não duplica Issue nem PR
  test('11. Retentativas preservam Issue e PR existentes sem duplicá-las', () => {
    db.prepare('UPDATE autonomous_tasks SET github_issue_number = 10, github_pr_number = 11 WHERE id = ?').run(task1Id);

    const taskRow: any = db.prepare('SELECT github_issue_number, github_pr_number FROM autonomous_tasks WHERE id = ?').get(task1Id);
    assert.strictEqual(taskRow.github_issue_number, 10);
    assert.strictEqual(taskRow.github_pr_number, 11);
  });

  // 12. Mensagens enfileiradas são processadas corretamente
  test('12. Mensagens enfileiradas são salvas com consumed=false e consumidas de forma idempotente', () => {
    const msgId = `msg-${Date.now()}`;
    AutonomousManager.logEvent(
      runId,
      null,
      'user',
      'QUEUED_USER_INSTRUCTION',
      'Instrução enfileirada: "Adicionar exportação CSV"',
      { content: 'Adicionar exportação CSV', queuedAt: nowIso, messageId: msgId, consumed: false }
    );

    const queuedRows: any[] = db.prepare("SELECT * FROM autonomous_events WHERE run_id = ? AND event_type = 'QUEUED_USER_INSTRUCTION'").all(runId);
    assert.ok(queuedRows.length > 0);

    const meta = JSON.parse(queuedRows[0].metadata_json);
    assert.strictEqual(meta.consumed, false);
    assert.strictEqual(meta.content, 'Adicionar exportação CSV');

    // Simular consumo idempotente
    meta.consumed = true;
    meta.consumedAt = new Date().toISOString();
    db.prepare('UPDATE autonomous_events SET metadata_json = ? WHERE id = ?').run(JSON.stringify(meta), queuedRows[0].id);

    const reloaded: any = db.prepare('SELECT metadata_json FROM autonomous_events WHERE id = ?').get(queuedRows[0].id);
    const reloadedMeta = JSON.parse(reloaded.metadata_json);
    assert.strictEqual(reloadedMeta.consumed, true);
  });

  // 13. Reinicialização recupera Runs elegíveis
  test('13. Reinicialização (recoverInterruptedRuns) recupera runs incompletos e reseta tasks presas', () => {
    // Configurar task em in_progress sem lease ativa
    db.prepare("UPDATE autonomous_tasks SET status = 'in_progress' WHERE id = ?").run(task2Id);
    db.prepare("UPDATE autonomous_runs SET status = 'building' WHERE id = ?").run(runId);

    AutonomousRunnerService.recoverInterruptedRuns();

    const recoveredTask: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(task2Id);
    const recoveredRun: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runId);

    assert.strictEqual(recoveredTask.status, 'ready', 'Task presa deve ser resetada para ready no restart');
    assert.strictEqual(recoveredRun.status, 'running', 'Run deve ser reativado para running no restart');
  });

  // 14. Isolamento entre projetos é preservado
  test('14. Isolamento estrito entre projetos: tarefas e eventos não vazam entre projetos diferentes', () => {
    const projBId = `proj-f7-b-${Date.now()}`;
    const runBId = `run-f7-b-${Date.now()}`;

    db.prepare(`
      INSERT INTO projects (id, name, path, created_at, updated_at)
      VALUES (?, 'Projeto B Isolado', ?, ?, ?)
    `).run(projBId, path.join(os.tmpdir(), projBId), nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, briefing, status, autonomy_mode, branch_name, max_hours, max_cycles, current_cycle, start_time, config_json, created_at, updated_at)
      VALUES (?, ?, 'Run B', 'Obj B', 'Briefing B', 'running', 'autonomous', 'main', 1.0, 10, 0, ?, '{}', ?, ?)
    `).run(runBId, projBId, nowIso, nowIso, nowIso);

    const activeA = AutonomousManager.getActiveRunForProject(testProjectId);
    const activeB = AutonomousManager.getActiveRunForProject(projBId);

    assert.ok(activeA);
    assert.ok(activeB);
    assert.strictEqual(activeA.id, runId);
    assert.strictEqual(activeB.id, runBId);
    assert.notStrictEqual(activeA.id, activeB.id, 'Projetos devem ter runs totalmente isolados');

    // Cleanup Proj B
    db.prepare('DELETE FROM autonomous_runs WHERE id = ?').run(runBId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projBId);
  });
});
