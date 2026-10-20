import './testSetup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { IndependentEvaluator } from '../src/independentEvaluator.js';
import { ChatSubmission } from '../src/chatSubmission.js';
import { apiRouter } from '../src/routes.js';

test('Task Lifecycle, Queue Progression & Milestone Alignment Suite', async (t) => {
  const projectId = 'proj-lifecycle-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  // Create isolated project
  db.prepare(`
    INSERT INTO projects (id, name, path, objective, created_at, updated_at)
    VALUES (?, 'Projeto Teste Ciclo de Vida', ?, 'Testar ciclo de vida e fila', ?, ?)
  `).run(projectId, 'C:/IA/test-projects/lifecycle-' + crypto.randomUUID(), now, now);

  const runId = 'run-lifecycle-' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, current_milestone, current_task, start_time, created_at, updated_at)
    VALUES (?, ?, 'Run Teste Ciclo de Vida', 'Objetivo do ciclo', 'running', 'M1', 'Tarefa 1', ?, ?, ?)
  `).run(runId, projectId, now, now, now);

  const task1Id = crypto.randomUUID();
  const task2Id = crypto.randomUUID();
  const task3Id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, created_at, updated_at)
    VALUES (?, ?, 'Configurar Backend', 'Criar servidor e rotas', 'M1', 1, '[]', 'ready', ?, ?)
  `).run(task1Id, runId, now, now);

  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, created_at, updated_at)
    VALUES (?, ?, 'Configurar Frontend', 'Criar layout base', 'M2', 2, ?, 'pending', ?, ?)
  `).run(task2Id, runId, JSON.stringify([task1Id]), now, now);

  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, created_at, updated_at)
    VALUES (?, ?, 'Motor do Timer e Rotinas', 'Implementar timer pomodoro', 'M3', 3, ?, 'pending', ?, ?)
  `).run(task3Id, runId, JSON.stringify([task2Id]), now, now);

  await t.test('1. Initial DAG state: only Task 1 is ready, Task 2 and 3 are pending', () => {
    const available = AutonomousManager.getAvailableTasks(runId);
    assert.equal(available.length, 1);
    assert.equal(available[0].id, task1Id);
    assert.equal(available[0].milestone, 'M1');

    const run: any = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(runId);
    assert.equal(run.current_milestone, 'M1');
    assert.equal(run.current_task, 'Configurar Backend');
  });

  await t.test('2. Completing Task 1 automatically promotes Task 2 to ready and advances milestone to M2', () => {
    // Complete task 1
    db.prepare("UPDATE autonomous_tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task1Id);
    
    // getAvailableTasks resolves DAG
    const available = AutonomousManager.getAvailableTasks(runId);
    assert.equal(available.length, 1);
    assert.equal(available[0].id, task2Id);
    assert.equal(available[0].status, 'ready');

    // syncRunProgress updates milestone to M2
    AutonomousManager.syncRunProgress(runId);
    const run: any = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(runId);
    assert.equal(run.current_milestone, 'M2');
    assert.equal(run.current_task, 'Configurar Frontend');
  });

  await t.test('3. Completing Task 2 automatically promotes Task 3 to ready and advances milestone to M3', () => {
    // Complete task 2
    db.prepare("UPDATE autonomous_tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task2Id);

    const available = AutonomousManager.getAvailableTasks(runId);
    assert.equal(available.length, 1);
    assert.equal(available[0].id, task3Id);
    assert.equal(available[0].status, 'ready');

    AutonomousManager.syncRunProgress(runId);
    const run: any = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(runId);
    assert.equal(run.current_milestone, 'M3');
    assert.equal(run.current_task, 'Motor do Timer e Rotinas');
  });

  await t.test('4. resolveHumanApproval unblocks run and sets task to in_review if passing report exists', () => {
    // Simulate Task 3 blocked with 3 retries and an open approval
    db.prepare("UPDATE autonomous_tasks SET status = 'blocked', retry_count = 3, updated_at = ? WHERE id = ?").run(new Date().toISOString(), task3Id);
    db.prepare("UPDATE autonomous_runs SET status = 'waiting_approval', updated_at = ? WHERE id = ?").run(new Date().toISOString(), runId);

    const approvalId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO autonomous_approvals (id, run_id, task_id, risk_level, title, context, why_needed, supervisor_recommendation, status, created_at)
      VALUES (?, ?, ?, 'orange', 'Intervenção: Task 3', 'Contexto', 'Motivo', 'Recomendação', 'pending', ?)
    `).run(approvalId, runId, task3Id, new Date().toISOString());

    // Insert passing builder report and evaluation
    const reportId = crypto.randomUUID();
    const evaluation = { verdict: 'PASS', taskIsDone: true, executedCommands: ['npm test'] };
    db.prepare(`
      INSERT INTO builder_reports (id, run_id, task_id, status, build_status, tests_run, test_results, evaluation_json, created_at)
      VALUES (?, ?, ?, 'success', 'passed', 'npm test', 'PASS', ?, ?)
    `).run(reportId, runId, task3Id, JSON.stringify(evaluation), new Date().toISOString());

    // Resolve approval
    AutonomousManager.resolveHumanApproval(approvalId, 'approved');

    // Verification: task should be in_review (not ready, so it is not re-executed from scratch)
    const task: any = db.prepare('SELECT status, retry_count FROM autonomous_tasks WHERE id = ?').get(task3Id);
    assert.equal(task.status, 'in_review');
    assert.equal(task.retry_count, 0);

    // Run status should be unblocked back to 'running'
    const run: any = db.prepare('SELECT status FROM autonomous_runs WHERE id = ?').get(runId);
    assert.equal(run.status, 'running');
  });

  await t.test('5. Completing all tasks marks final state with current_task summary', () => {
    db.prepare("UPDATE autonomous_tasks SET status = 'completed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task3Id);
    AutonomousManager.syncRunProgress(runId);

    const run: any = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(runId);
    assert.equal(run.current_milestone, 'M3');
    assert.equal(run.current_task, 'Todas as tarefas concluídas');
  });

  await t.test('6. Queued user instruction while run is active/paused returns queued without blocking', () => {
    // Reset run to building
    db.prepare("UPDATE autonomous_runs SET status = 'building', updated_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
    
    // Simulate incoming instruction queuing logic
    const activeRun = AutonomousManager.getActiveRunForProject(projectId);
    assert.ok(activeRun);
    assert.equal(activeRun.status, 'building');

    const content = 'Adicionar botão de exportar relatórios em CSV';
    const nowIso = new Date().toISOString();
    AutonomousManager.logEvent(
      activeRun.id,
      activeRun.current_task || null,
      'user',
      'QUEUED_USER_INSTRUCTION',
      `Instrução enfileirada: "${content}"`,
      { content, queuedAt: nowIso, consumed: false, durableContinuation: true }
    );

    const queuedEvent: any = db.prepare("SELECT * FROM autonomous_events WHERE run_id = ? AND event_type = 'QUEUED_USER_INSTRUCTION' ORDER BY created_at DESC LIMIT 1").get(runId);
    assert.ok(queuedEvent);
    assert.match(queuedEvent.message, /exportar relatórios em CSV/);

    const continuation = AutonomousManager.getQueuedContinuation(runId);
    assert.ok(continuation.text.includes('exportar relatórios em CSV'));
  });

  await t.test('7. Unblock command automatically resolves pending approval and resumes run', () => {
    // Put run into waiting_approval
    db.prepare("UPDATE autonomous_runs SET status = 'waiting_approval', updated_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
    const approvalId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO autonomous_approvals (id, run_id, risk_level, title, context, why_needed, supervisor_recommendation, status, created_at)
      VALUES (?, ?, 'yellow', 'Aprovar continuação', 'Contexto', 'Motivo', 'Recomendação', 'pending', ?)
    `).run(approvalId, runId, new Date().toISOString());

    const pending = db.prepare("SELECT id FROM autonomous_approvals WHERE run_id = ? AND status = 'pending' LIMIT 1").get(runId) as any;
    assert.ok(pending);

    AutonomousManager.resolveHumanApproval(pending.id, 'approved');

    const updatedApproval: any = db.prepare("SELECT status FROM autonomous_approvals WHERE id = ?").get(approvalId);
    assert.equal(updatedApproval.status, 'approved');

    const updatedRun: any = db.prepare("SELECT status FROM autonomous_runs WHERE id = ?").get(runId);
    assert.equal(updatedRun.status, 'running');
  });

  await t.test('8. Milestone sequence alignment: Tasks M1 through M6 maintain 1-to-1 milestone consistency with DAG state', () => {
    const seqRunId = 'run-seq-' + crypto.randomUUID().slice(0, 8);
    const seqProjId = 'proj-seq-' + crypto.randomUUID().slice(0, 8);
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Projeto Sequencial Milestones', ?, 'Testar sequencia de marcos', ?, ?)
    `).run(seqProjId, 'C:/IA/test-projects/seq-' + crypto.randomUUID(), nowIso, nowIso);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, current_milestone, current_task, start_time, created_at, updated_at)
      VALUES (?, ?, 'Run Sequencial', 'Objetivo do ciclo', 'running', 'M1', 'Tarefa 1', ?, ?, ?)
    `).run(seqRunId, seqProjId, nowIso, nowIso, nowIso);

    const taskIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const titles = ['Backend DB', 'Frontend Layout', 'Planejador', 'Motor do Timer', 'Dashboard e Modelos', 'Testes Finais'];
    const milestones = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

    for (let i = 0; i < 6; i++) {
      const deps = i === 0 ? [] : [taskIds[i - 1]];
      db.prepare(`
        INSERT INTO autonomous_tasks (id, run_id, title, description, milestone, order_index, dependencies_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(taskIds[i], seqRunId, titles[i], 'Desc ' + (i + 1), milestones[i], i + 1, JSON.stringify(deps), i === 0 ? 'ready' : 'pending', nowIso, nowIso);
    }

    // Step 1: Initial state -> M1
    AutonomousManager.syncRunProgress(seqRunId);
    let r: any = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(seqRunId);
    assert.equal(r.current_milestone, 'M1');
    assert.equal(r.current_task, titles[0]);

    // Complete M1 -> M2
    db.prepare("UPDATE autonomous_tasks SET status = 'completed' WHERE id = ?").run(taskIds[0]);
    AutonomousManager.syncRunProgress(seqRunId);
    r = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(seqRunId);
    assert.equal(r.current_milestone, 'M2');
    assert.equal(r.current_task, titles[1]);

    // Complete M2 -> M3
    db.prepare("UPDATE autonomous_tasks SET status = 'completed' WHERE id = ?").run(taskIds[1]);
    AutonomousManager.syncRunProgress(seqRunId);
    r = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(seqRunId);
    assert.equal(r.current_milestone, 'M3');
    assert.equal(r.current_task, titles[2]);

    // Complete M3 -> M4
    db.prepare("UPDATE autonomous_tasks SET status = 'completed' WHERE id = ?").run(taskIds[2]);
    AutonomousManager.syncRunProgress(seqRunId);
    r = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(seqRunId);
    assert.equal(r.current_milestone, 'M4');
    assert.equal(r.current_task, titles[3]);

    // Complete M4 -> M5
    db.prepare("UPDATE autonomous_tasks SET status = 'completed' WHERE id = ?").run(taskIds[3]);
    AutonomousManager.syncRunProgress(seqRunId);
    r = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(seqRunId);
    assert.equal(r.current_milestone, 'M5');
    assert.equal(r.current_task, titles[4]);

    // Complete M5 -> M6
    db.prepare("UPDATE autonomous_tasks SET status = 'completed' WHERE id = ?").run(taskIds[4]);
    AutonomousManager.syncRunProgress(seqRunId);
    r = db.prepare('SELECT current_milestone, current_task FROM autonomous_runs WHERE id = ?').get(seqRunId);
    assert.equal(r.current_milestone, 'M6');
    assert.equal(r.current_task, titles[5]);
  });

  await t.test('9. HTTP Chat Idempotency: Confirmed DB persistence reconciles existing message without duplicates', async () => {
    const chatProjId = 'proj-chat-' + crypto.randomUUID().slice(0, 8);
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Chat Confirmed Project', ?, 'Testar chat confirmado', ?, ?)
    `).run(chatProjId, 'C:/IA/test-projects/chat-' + crypto.randomUUID(), nowIso, nowIso);

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(res => server.once('listening', res));
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}/api`;

    try {
      const requestId = 'req-confirmed-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const content = 'Status de verificação do projeto e métricas';

      // First submission
      const res1 = await fetch(`${base}/projects/${chatProjId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, requestId })
      });
      assert.equal(res1.status, 200);
      const data1: any = await res1.json();
      assert.ok(data1.userMessage);
      assert.equal(data1.userMessage.content, content);

      // Verify DB has exactly 1 message
      const count1 = (db.prepare("SELECT COUNT(*) as n FROM messages WHERE project_id = ? AND role = 'user'").get(chatProjId) as any).n;
      assert.equal(count1, 1);

      // Second submission with identical requestId & content (simulate network retry or resend)
      const res2 = await fetch(`${base}/projects/${chatProjId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, requestId })
      });
      assert.equal(res2.status, 200);
      const data2: any = await res2.json();
      assert.equal(data2.userMessage.id, data1.userMessage.id);

      // Verify ZERO duplicate messages created
      const count2 = (db.prepare("SELECT COUNT(*) as n FROM messages WHERE project_id = ? AND role = 'user'").get(chatProjId) as any).n;
      assert.equal(count2, 1);
    } finally {
      await new Promise<void>(res => server.close(() => res()));
    }
  });

  await t.test('10. HTTP Chat Idempotency: Unconfirmed persistence returns recoverable error and preserves user text', async () => {
    const unconfProjId = 'proj-unconf-' + crypto.randomUUID().slice(0, 8);
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, path, objective, created_at, updated_at)
      VALUES (?, 'Chat Unconfirmed Project', ?, 'Testar chat não confirmado', ?, ?)
    `).run(unconfProjId, 'C:/IA/test-projects/unconf-' + crypto.randomUUID(), nowIso, nowIso);

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(res => server.once('listening', res));
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}/api`;

    try {
      const requestId = 'req-unconf-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const content = 'Esta instrução foi abortada antes de persistir no banco';
      const fakeMsgId = crypto.randomUUID();
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');

      // Simulate dangling chat_submissions entry where messages row was NEVER persisted
      db.prepare(`
        INSERT INTO chat_submissions (project_id, request_id, content_hash, user_message_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'dispatching', ?, ?)
      `).run(unconfProjId, requestId, contentHash, fakeMsgId, nowIso, nowIso);

      // Verify message does NOT exist in messages table
      const msgCheck = db.prepare('SELECT * FROM messages WHERE id = ?').get(fakeMsgId);
      assert.equal(msgCheck, undefined);

      // Submitting this request must detect lack of DB persistence and return recoverable error with persisted: false
      const res = await fetch(`${base}/projects/${unconfProjId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, requestId })
      });
      assert.equal(res.status, 409);
      const data: any = await res.json();
      assert.equal(data.code, 'CHAT_REQUEST_UNCONFIRMED');
      assert.equal(data.persisted, false);
      assert.match(data.error, /preservado para reenvio seguro/);

      // Dangling entry must have been removed so client can resend safely
      const dangling = db.prepare('SELECT * FROM chat_submissions WHERE project_id = ? AND request_id = ?').get(unconfProjId, requestId);
      assert.equal(dangling, undefined);

      // Now client can resend with same requestId and it succeeds cleanly
      const retryRes = await fetch(`${base}/projects/${unconfProjId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, requestId })
      });
      assert.equal(retryRes.status, 200);
      const retryData: any = await retryRes.json();
      assert.ok(retryData.userMessage);
      assert.equal(retryData.userMessage.content, content);
    } finally {
      await new Promise<void>(res => server.close(() => res()));
    }
  });
});
