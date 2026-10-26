import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { HierarchicalOrchestrationService } from '../src/hierarchicalOrchestrationService.js';

function createTestProject(id: string, projectDir: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, is_trusted, full_dev_autonomy, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)
  `).run(id, id, projectDir, 'Projeto com auto-recuperação e self-healing', now, now);
}

function createTestContract(contractId: string, taskId: string, projectId: string, runId: string, verificationCommand: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO success_contracts (
      id, task_id, run_id, project_id, objective, acceptance_criteria_json,
      verification_steps_json, protected_evaluation_files_json, protected_file_hashes_json,
      baseline_json, success_thresholds_json, failure_conditions_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    contractId,
    taskId,
    runId,
    projectId,
    'Verificar endpoint',
    JSON.stringify(['Endpoint implementado']),
    JSON.stringify([{ name: 'Test Step', command: verificationCommand }]),
    JSON.stringify([]),
    JSON.stringify({}),
    JSON.stringify({}),
    JSON.stringify([]),
    JSON.stringify([]),
    now,
    now
  );
}

function persistTestEvaluation(result: any) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO evaluation_results (
      id, contract_id, task_id, run_id, verdict, builder_status, evaluator_verdict,
      task_is_done, passed_criteria_json, failed_criteria_json, evidence_json,
      expected, actual, evaluator_notes, evaluator_name, executed_commands_json,
      exit_code, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.id,
    result.contractId,
    result.taskId,
    result.runId || null,
    result.verdict,
    result.builderStatus || 'COMPLETED',
    result.evaluatorVerdict || result.verdict,
    result.taskIsDone ? 1 : 0,
    JSON.stringify(result.passedCriteria || []),
    JSON.stringify(result.failedCriteria || []),
    JSON.stringify(result.evidence || {}),
    result.expected || '',
    result.actual || '',
    result.evaluatorNotes || '',
    result.evaluatorName || 'IndependentEvaluator',
    JSON.stringify(result.executedCommands || []),
    result.exitCode || 0,
    result.durationMs || 10,
    result.createdAt || now
  );
}

test('Fase 3: Auto-Recovery de AGENTAPI_UNAVAILABLE restaura status de waiting_resource para running', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-recovery-test-'));
  const projectId = `proj-rec-${crypto.randomUUID().slice(0, 8)}`;
  createTestProject(projectId, dir);

  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousSelfHealingAndRecovery.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousSelfHealingAndRecovery.test]", err);
      }
    }
  });

  const runId = `run-rec-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  // Create run stuck in waiting_resource due to AGENTAPI_UNAVAILABLE
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, consecutive_failures, last_error, next_action, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'waiting_resource', ?, 2, 'AGENTAPI_UNAVAILABLE: Antigravity language_server.exe não encontrado no sistema', 'Aguardando Antigravity', ?, ?)
  `).run(runId, projectId, 'Run com Recurso Ausente', 'Objetivo de teste', now, now, now);

  const beforeRun: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
  assert.equal(beforeRun.status, 'waiting_resource');
  assert.match(beforeRun.last_error, /AGENTAPI_UNAVAILABLE/);

  // Trigger attemptResourceRecovery
  const recovered = await AutonomousRunnerService.attemptResourceRecovery(runId);
  assert.equal(recovered, true, 'attemptResourceRecovery deve retornar true quando o ambiente/offline está apto');

  // Verify DB state after recovery
  const afterRun: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
  assert.equal(afterRun.status, 'running', 'Status do run deve retornar para running automaticamente');
  assert.equal(afterRun.consecutive_failures, 0, 'Contador de falhas transitórias deve ser resetado a zero');
  assert.equal(afterRun.last_error, null, 'last_error deve ser limpo');
  assert.match(afterRun.next_action, /Runtime e recursos restabelecidos automaticamente/);

  // Verify audit event
  const events: any[] = db.prepare(`
    SELECT * FROM autonomous_events
    WHERE run_id = ? AND event_type = 'RUNTIME_RECOVERED_AUTOMATICALLY'
  `).all(runId);
  assert.ok(events.length > 0, 'Evento RUNTIME_RECOVERED_AUTOMATICALLY deve ser registrado no histórico de auditoria');
  assert.match(events[0].message, /Google Antigravity e recursos restabelecidos com sucesso/);
});

test('Fase 3: Self-healing de verificação converte BLOCKED técnico em REWORK_REQUIRED sem pausar o run', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-selfhealing-test-'));
  const projectId = `proj-heal-${crypto.randomUUID().slice(0, 8)}`;
  createTestProject(projectId, dir);

  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousSelfHealingAndRecovery.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousSelfHealingAndRecovery.test]", err);
      }
    }
  });

  const runId = `run-heal-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, consecutive_failures, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'running', ?, 0, ?, ?)
  `).run(runId, projectId, 'Run Self-Healing', 'Objetivo', now, now, now);

  const taskId = `task-heal-${crypto.randomUUID().slice(0, 8)}`;
  const contractId = `contract-heal-${crypto.randomUUID().slice(0, 8)}`;

  // Create success contract with an invalid test command
  createTestContract(contractId, taskId, projectId, runId, 'node non-existent-test.js');

  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, status, lifecycle_state, retry_count, max_retries, contract_id, verification_command, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'M1', 'in_review', 'REVIEW_PENDING', 0, 3, ?, 'node non-existent-test.js', ?, ?)
  `).run(taskId, runId, 'Criar Endpoint com Verificação', 'Desc', contractId, now, now);

  const mockEvaluation: any = {
    id: `eval-${crypto.randomUUID()}`,
    contractId,
    taskId,
    runId,
    verdict: 'BLOCKED',
    builderStatus: 'COMPLETED',
    evaluatorVerdict: 'BLOCKED',
    taskIsDone: false,
    passedCriteria: [],
    failedCriteria: ['Ambiente de execução ou dependências inacessíveis (BLOCKED)'],
    actual: 'BLOCKED: Comando ou script non-existent-test.js inacessível ou ausente',
    expected: 'Test Step concluído com sucesso',
    evaluatorNotes: 'Reprovado pelo Evaluator (BLOCKED): non-existent-test.js não encontrado',
    evaluatorName: 'IndependentEvaluator',
    executedCommands: ['node non-existent-test.js'],
    exitCode: 1,
    durationMs: 45
  };

  persistTestEvaluation(mockEvaluation);

  // Submit Builder Report
  db.prepare(`
    INSERT INTO builder_reports (id, run_id, task_id, status, files_changed_json, implemented_json, evaluation_json, created_at)
    VALUES (?, ?, ?, 'success', '["src/endpoint.ts"]', '["Endpoint implementado"]', ?, ?)
  `).run(`rep-${crypto.randomUUID()}`, runId, taskId, JSON.stringify(mockEvaluation), now);

  // Submit Supervisor Review with allowReworkOnBlocked (Self-Healing mode)
  const reviewResult = AutonomousManager.submitSupervisorReview({
    runId,
    taskId,
    verdict: 'CHANGES_REQUESTED',
    feedback: `[Self-Healing Evaluator BLOCKED]: ${mockEvaluation.actual}. Corrija a implementação ou arquivos de teste.`,
    requirementsMet: false,
    buildPassed: false,
    testsPassed: false,
    uiFunctional: false,
    qualityScore: 4,
    allowReworkOnBlocked: true
  });

  assert.ok(reviewResult, 'submitSupervisorReview deve processar o veredito com sucesso');

  // Verify task transitioned to REWORK_REQUIRED
  const taskAfter: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(taskId);
  assert.equal(taskAfter.lifecycle_state, 'REWORK_REQUIRED', 'Tarefa deve transicionar para REWORK_REQUIRED para que o Worker possa corrigir');
  assert.equal(taskAfter.retry_count, 1, 'retry_count da tarefa deve ser incrementado');

  // Verify run remains in 'running' (NOT paused!)
  const runAfter: any = db.prepare('SELECT * FROM autonomous_runs WHERE id = ?').get(runId);
  assert.equal(runAfter.status, 'running', 'O run NÃO deve ser pausado para falha técnica reparável com tentativas restantes');

  // Verify attempt 2 fixes the issue and successfully passes
  const passedEvaluation: any = {
    ...mockEvaluation,
    id: `eval-pass-${crypto.randomUUID()}`,
    verdict: 'PASS',
    evaluatorVerdict: 'PASS',
    taskIsDone: true,
    passedCriteria: ['Endpoint implementado com sucesso'],
    failedCriteria: [],
    actual: 'Todos os testes passaram com sucesso',
    evaluatorNotes: 'Aprovado pelo Evaluator: script criado e executado com sucesso',
    executedCommands: ['node test/endpoint.test.js'],
    exitCode: 0
  };
  persistTestEvaluation(passedEvaluation);

  db.prepare(`
    INSERT INTO builder_reports (id, run_id, task_id, status, files_changed_json, implemented_json, evaluation_json, created_at)
    VALUES (?, ?, ?, 'success', '["src/endpoint.ts", "test/endpoint.test.js"]', '["Endpoint implementado e testado"]', ?, ?)
  `).run(`rep-pass-${crypto.randomUUID()}`, runId, taskId, JSON.stringify(passedEvaluation), new Date().toISOString());

  // Transition task through normal worker lifecycle for attempt 2 approval (REWORK_REQUIRED -> IN_PROGRESS -> REVIEW_PENDING)
  HierarchicalOrchestrationService.transitionTaskState(taskId, 'IN_PROGRESS', 'worker', 'Worker iniciando correções no turno 2');
  HierarchicalOrchestrationService.transitionTaskState(taskId, 'REVIEW_PENDING', 'worker', 'Nova entrega pronta para revisão');

  const approveResult = AutonomousManager.submitSupervisorReview({
    runId,
    taskId,
    verdict: 'APPROVED',
    feedback: 'Aprovado após correção completa no turno de retrabalho.',
    requirementsMet: true,
    buildPassed: true,
    testsPassed: true,
    uiFunctional: true,
    qualityScore: 10,
    evaluation: passedEvaluation
  });

  assert.ok(approveResult, 'Aprovação da tentativa 2 deve suceder');
  const taskFinal: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(taskId);
  assert.equal(taskFinal.lifecycle_state, 'COMPLETED', 'Tarefa deve ser concluída com sucesso após o ciclo de self-healing');
});

test('Fase 3: Preservação de Segurança — TAMPERING_DETECTED e exaustão de retries mantêm bloqueio seguro', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-guard-test-'));
  const projectId = `proj-guard-${crypto.randomUUID().slice(0, 8)}`;
  createTestProject(projectId, dir);

  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {
      if (typeof (globalThis as any).logger !== "undefined" && (globalThis as any).logger?.warn) {
        (globalThis as any).logger.warn({
          event: "server.handled_exception",
          file: "autonomousSelfHealingAndRecovery.test",
          error: (err as any)?.message || String(err)
        });
      } else {
        console.warn("[WARN][server:autonomousSelfHealingAndRecovery.test]", err);
      }
    }
  });

  const now = new Date().toISOString();

  // Test 1: TAMPERING_DETECTED preserves strict blocking (guard inviolable)
  const runTamperId = `run-tamper-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, consecutive_failures, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'running', ?, 0, ?, ?)
  `).run(runTamperId, projectId, 'Run com Tamper', 'Objetivo', now, now, now);

  const taskTamperId = `task-tamper-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, status, lifecycle_state, retry_count, max_retries, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'M1', 'in_review', 'REVIEW_PENDING', 0, 3, ?, ?)
  `).run(taskTamperId, runTamperId, 'Tarefa com Adulteração', 'Desc', now, now);

  const tamperEvaluation: any = {
    id: `eval-tamper-${crypto.randomUUID()}`,
    contractId: 'contract-tamper',
    taskId: taskTamperId,
    runId: runTamperId,
    verdict: 'TAMPERING_DETECTED',
    builderStatus: 'FAILED',
    evaluatorVerdict: 'TAMPERING_DETECTED',
    taskIsDone: false,
    passedCriteria: [],
    failedCriteria: ['Adulteração detectada em teste protegido'],
    evidence: { tamperingDetected: true, tamperedFiles: ['test/protected.test.ts'] },
    actual: 'TAMPERING_DETECTED: Teste protegido test/protected.test.ts foi adulterado pelo Worker',
    expected: 'Testes protegidos intactos',
    evaluatorNotes: 'Violação de segurança crítica detectada',
    evaluatorName: 'IndependentEvaluator',
    executedCommands: [],
    exitCode: 1,
    durationMs: 10
  };
  persistTestEvaluation(tamperEvaluation);

  // Directly verify submitSupervisorReview refuses to approve and sets BLOCKED
  AutonomousManager.submitSupervisorReview({
    runId: runTamperId,
    taskId: taskTamperId,
    verdict: 'BLOCKED',
    feedback: 'Bloqueio estrito por adulteração de testes protegidos.',
    requirementsMet: false,
    buildPassed: false,
    testsPassed: false,
    uiFunctional: false,
    evaluation: tamperEvaluation
  });

  const taskTamperAfter: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(taskTamperId);
  assert.equal(taskTamperAfter.lifecycle_state, 'BLOCKED', 'Adulteração de teste protegido DEVE manter tarefa como BLOCKED');

  // Test 2: Max retries exhaustion triggers BLOCKED via Watchdog
  const runExhaustId = `run-exhaust-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, consecutive_failures, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'running', ?, 0, ?, ?)
  `).run(runExhaustId, projectId, 'Run com Exaustao', 'Objetivo', now, now, now);

  const taskExhaustId = `task-exhaust-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, status, lifecycle_state, retry_count, max_retries, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'M1', 'in_review', 'REVIEW_PENDING', 2, 3, ?, ?)
  `).run(taskExhaustId, runExhaustId, 'Tarefa Exaustao', 'Desc', now, now);

  // Tentativa 3 (retry_count 2 + 1 = 3 >= max_retries 3) -> Ativa Supervisor Task Repair (Auto-Unblock)
  AutonomousManager.submitSupervisorReview({
    runId: runExhaustId,
    taskId: taskExhaustId,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Falha técnica persistente após esgotar tentativas.',
    requirementsMet: false,
    buildPassed: false,
    testsPassed: false,
    uiFunctional: false,
    qualityScore: 4,
    allowReworkOnBlocked: true
  });

  const taskExhaustAfterAutoUnblock: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(taskExhaustId);
  assert.equal(taskExhaustAfterAutoUnblock.lifecycle_state, 'REWORK_REQUIRED', 'Ao atingir maxRetries pela 1ª vez, ativa Auto-Unblock em REWORK_REQUIRED');
  assert.equal(taskExhaustAfterAutoUnblock.max_retries, 4, 'max_retries deve ser incrementado para 4 (+1 ciclo)');

  // Tentativa 4 (segunda falha após auto-unblock -> agora sim deve bloquear)
  AutonomousManager.submitSupervisorReview({
    runId: runExhaustId,
    taskId: taskExhaustId,
    verdict: 'CHANGES_REQUESTED',
    feedback: 'Falha técnica persistente mesmo após Supervisor Task Repair.',
    requirementsMet: false,
    buildPassed: false,
    testsPassed: false,
    uiFunctional: false,
    qualityScore: 4,
    allowReworkOnBlocked: true
  });

  const taskExhaustFinal: any = db.prepare('SELECT * FROM autonomous_tasks WHERE id = ?').get(taskExhaustId);
  assert.equal(taskExhaustFinal.lifecycle_state, 'BLOCKED', 'Após esgotar o ciclo de reparo do Supervisor, a tarefa é travada em BLOCKED');
  assert.equal(taskExhaustFinal.retry_count, 4, 'retry_count deve ser 4');
});

test('Watchdog Resiliência: Não preempte nem incremente retries prematuramente em tarefas com turnos nativos em voo', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-watchdog-resilience-'));
  const projectId = `proj-watchdog-${crypto.randomUUID().slice(0, 8)}`;
  createTestProject(projectId, dir);

  const runId = `run-watchdog-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, consecutive_failures, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'running', ?, 0, ?, ?)
  `).run(runId, projectId, 'Run Watchdog Resilience', 'Objetivo', now, now, now);

  const taskId = `task-watchdog-${crypto.randomUUID().slice(0, 8)}`;
  const nineMinutesAgo = new Date(Date.now() - 9 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, status, lifecycle_state, retry_count, max_retries, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'M1', 'in_progress', 'IN_PROGRESS', 0, 3, ?, ?)
  `).run(taskId, runId, 'Tarefa Longa com Turno Nativo', 'Desc', nineMinutesAgo, nineMinutesAgo);

  // Turno nativo recente em voo (despachado há 4 minutos)
  const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  const convId = `conv-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO agent_turn_observations (conversation_id, task_id, project_path, brain_dir, baseline_lines, baseline_files_json, phase, dispatched_at, updated_at)
    VALUES (?, ?, ?, ?, 0, '{}', 'IN_FLIGHT', ?, ?)
  `).run(convId, taskId, dir, dir, fourMinutesAgo, fourMinutesAgo);

  const prevIsRunning = (AutonomousRunnerService as any).isRunning;
  (AutonomousRunnerService as any).isRunning = true;

  try {
    // Executa watchdog tick
    await (AutonomousRunnerService as any).watchdogTick();

    // Tarefa com turno nativo em voo NÃO deve ter sido resetada ou tido retry incrementado
    const taskDuringFlight: any = db.prepare('SELECT status, retry_count FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.equal(taskDuringFlight.status, 'in_progress', 'Tarefa com turno em voo deve permanecer in_progress');
    assert.equal(taskDuringFlight.retry_count, 0, 'retry_count não deve ser incrementado prematuramente');

    // Agora simula abandono genuíno (> 12 minutos)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    db.prepare("UPDATE agent_turn_observations SET dispatched_at = ? WHERE task_id = ?").run(fifteenMinutesAgo, taskId);

    await (AutonomousRunnerService as any).watchdogTick();

    const taskAfterAbandon: any = db.prepare('SELECT status, retry_count FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.ok(
      taskAfterAbandon.status === 'in_review' || taskAfterAbandon.status === 'ready',
      'Após abandono/conclusão de turno (>12min), tarefa deve ser auto-reconciliada para in_review ou resetada para ready'
    );

    const obsAfter: any = db.prepare('SELECT phase FROM agent_turn_observations WHERE task_id = ?').get(taskId);
    assert.equal(obsAfter.phase, 'CONSUMED', 'Observação abandonada deve ser marcada como CONSUMED');
  } finally {
    (AutonomousRunnerService as any).isRunning = prevIsRunning;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('Watchdog Resiliência: Não preempte nem incremente retries quando tarefa estiver ativa no runner durante fase de avaliação ou revisão', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-watchdog-eval-'));
  const projectId = `proj-watchdog-eval-${crypto.randomUUID().slice(0, 8)}`;
  createTestProject(projectId, dir);

  const runId = `run-watchdog-eval-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, consecutive_failures, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'running', ?, 0, ?, ?)
  `).run(runId, projectId, 'Run Watchdog Active Phase', 'Objetivo', now, now, now);

  const taskId = `task-watchdog-eval-${crypto.randomUUID().slice(0, 8)}`;
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, status, lifecycle_state, retry_count, max_retries, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'M1', 'in_progress', 'IN_PROGRESS', 0, 3, ?, ?)
  `).run(taskId, runId, 'Tarefa Ativa em Avaliacao', 'Desc', tenMinutesAgo, tenMinutesAgo);

  const prevIsRunning = (AutonomousRunnerService as any).isRunning;
  const prevTaskId = (AutonomousRunnerService as any).currentTaskId;
  const prevPhase = (AutonomousRunnerService as any).currentPhase;

  (AutonomousRunnerService as any).isRunning = true;
  (AutonomousRunnerService as any).currentTaskId = taskId;
  (AutonomousRunnerService as any).currentPhase = 'EVALUATOR_VERIFYING';

  try {
    // Executa watchdog tick enquanto a tarefa está ativamente sendo avaliada
    await (AutonomousRunnerService as any).watchdogTick();

    const taskDuringEval: any = db.prepare('SELECT status, retry_count FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.equal(taskDuringEval.status, 'in_progress', 'Tarefa em fase de avaliação ativa não deve ser interrompida');
    assert.equal(taskDuringEval.retry_count, 0, 'retry_count não deve ser incrementado para tarefas ativas no runner');

    // Agora simula tarefa finalizada e IDLE sem lease (órfã de verdade)
    (AutonomousRunnerService as any).currentTaskId = null;
    (AutonomousRunnerService as any).currentPhase = 'IDLE';

    await (AutonomousRunnerService as any).watchdogTick();

    const taskAfterOrphan: any = db.prepare('SELECT status, retry_count FROM autonomous_tasks WHERE id = ?').get(taskId);
    assert.ok(
      taskAfterOrphan.status === 'in_review' || taskAfterOrphan.status === 'ready',
      'Tarefa órfã sem runner ativo deve ser reconciliada para in_review ou resetada para ready'
    );
  } finally {
    (AutonomousRunnerService as any).isRunning = prevIsRunning;
    (AutonomousRunnerService as any).currentTaskId = prevTaskId;
    (AutonomousRunnerService as any).currentPhase = prevPhase;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

