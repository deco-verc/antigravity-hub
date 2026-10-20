import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { WorkerRegistry } from '../src/workerRegistry.js';
import { installPipelineFixture } from './pipelineFixture.js';

function createTestWorkspace(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-lease-reconcile-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, project };
}

test('1. expireStaleLeases auto-reconciles expired leases silently without setting run to paused', async t => {
  const { project } = createTestWorkspace(t);
  const projectId = `proj-lease-heal-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id, name, path, objective, is_trusted, full_dev_autonomy, created_at, updated_at) VALUES(?,?,?,?,1,1,?,?)')
    .run(projectId, projectId, project, 'Teste Auto-Heal Lease', now, now);

  installPipelineFixture(projectId, project, 1, false);

  t.after(() => {
    AutonomousRunnerService.stop();
    const reservation: any = db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
  });

  const run = await AutonomousManager.createRun({
    projectId,
    name: 'Lease Auto-Heal Run',
    objective: 'Testar reconciliação silenciosa de lease',
    briefing: 'Testar reconciliação silenciosa de lease'
  });

  const task = run.tasks[0];
  assert.ok(task, 'Task deve existir');

  // Simular que a tarefa está em in_progress e que uma worker_lease expirou há 10 segundos
  const worker = WorkerRegistry.createWorker({ name: 'Worker Test Lease', environment: 'local' });
  const pastTime = new Date(Date.now() - 10000).toISOString();
  const leaseId = `lease-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO worker_leases (id, worker_id, run_id, task_id, issue_number, claimed_at, lease_until, last_heartbeat, status)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'active')
  `).run(leaseId, worker.id, run.id, task.id, pastTime, pastTime, pastTime);

  db.prepare("UPDATE autonomous_tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(pastTime, task.id);
  db.prepare("UPDATE autonomous_runs SET status = 'running', last_error = NULL WHERE id = ?").run(run.id);

  // Executar expireStaleLeases
  const result = WorkerRegistry.expireStaleLeases();
  assert.ok(result.expired >= 1, 'Deveria ter expirado pelo menos 1 lease');

  // Verificar que o run JAMAIS foi colocado em 'paused' e que a tarefa foi redefinida para 'ready'
  const updatedRun: any = db.prepare('SELECT status, last_error FROM autonomous_runs WHERE id = ?').get(run.id);
  assert.equal(updatedRun.status, 'running', 'Run deve permanecer em status running e NÃO ser pausado');
  assert.notEqual(updatedRun.last_error, 'LEASE_RECONCILIATION_REQUIRED', 'last_error NÃO pode ser LEASE_RECONCILIATION_REQUIRED');

  const updatedTask: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(task.id);
  assert.equal(updatedTask.status, 'ready', 'Tarefa deve ser restaurada para ready após expiração do lease');
});

test('2. resumeRun executes Force Clean: clears orphan reservations, expired leases, observations, resets task and resumes to running', async t => {
  const { project } = createTestWorkspace(t);
  const projectId = `proj-force-resume-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id, name, path, objective, is_trusted, full_dev_autonomy, created_at, updated_at) VALUES(?,?,?,?,1,1,?,?)')
    .run(projectId, projectId, project, 'Teste Force Resume', now, now);

  installPipelineFixture(projectId, project, 1, false);

  t.after(() => {
    AutonomousRunnerService.stop();
    const reservation: any = db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
  });

  const run = await AutonomousManager.createRun({
    projectId,
    name: 'Force Resume Run',
    objective: 'Testar retomada com limpeza forçada de travas',
    briefing: 'Testar retomada com limpeza forçada de travas'
  });

  const task = run.tasks[0];
  assert.ok(task, 'Task deve existir');

  // Colocar o run propositalmente no estado do incidente:
  // status='paused', last_error='LEASE_RECONCILIATION_REQUIRED', task em in_progress, trava em execution_reservations
  const deadToken = crypto.randomUUID();
  db.prepare(`
    INSERT OR REPLACE INTO execution_reservations (scope, token, owner_pid, context_json, created_at)
    VALUES ('global-agent-execution', ?, ?, ?, ?)
  `).run(deadToken, 9999999, JSON.stringify({ runId: run.id, projectId }), now);

  const worker = WorkerRegistry.createWorker({ name: 'Worker Trava', environment: 'local' });
  const activeLeaseId = `lease-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO worker_leases (id, worker_id, run_id, task_id, issue_number, claimed_at, lease_until, last_heartbeat, status)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'active')
  `).run(activeLeaseId, worker.id, run.id, task.id, now, now, now);

  db.prepare(`
    INSERT INTO agent_turn_observations (conversation_id, task_id, project_path, brain_dir, baseline_lines, baseline_files_json, phase, dispatched_at)
    VALUES (?, ?, ?, ?, 10, '{}', 'IN_FLIGHT', ?)
  `).run(`conv-${crypto.randomUUID().slice(0, 8)}`, task.id, project, os.tmpdir(), now);

  db.prepare("UPDATE autonomous_tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(now, task.id);
  db.prepare("UPDATE autonomous_runs SET status = 'paused', last_error = 'LEASE_RECONCILIATION_REQUIRED', next_action = 'Reconciliando estado do turno externo antes de reenviar' WHERE id = ?").run(run.id);

  // Executar resumeRun
  const resumedRun = await AutonomousManager.resumeRun(run.id);

  // Verificações essenciais:
  // 1. Status deve ser 'running'
  assert.equal(resumedRun.status, 'running', 'Run deve ter status retomado para running');
  assert.equal(resumedRun.last_error, null, 'last_error deve ser limpo para NULL');

  // 2. Trava de execution_reservations deve ter sido liberada
  const activeRes: any = db.prepare("SELECT * FROM execution_reservations WHERE scope = 'global-agent-execution'").get();
  assert.equal(activeRes, undefined, 'Reserva de execução órfã deve ter sido liberada');

  // 3. Lease ativo deve ter sido liberado/expirado (não mais active)
  const leaseStatus: any = db.prepare('SELECT status FROM worker_leases WHERE id = ?').get(activeLeaseId);
  assert.ok(['released', 'expired'].includes(leaseStatus.status), 'Lease órfão deve ter sido liberado ou expirado');
  assert.notEqual(leaseStatus.status, 'active', 'Lease não pode mais estar active');

  // 4. Observação IN_FLIGHT deve ter sido marcada como CONSUMED
  const turnObs: any = db.prepare('SELECT phase FROM agent_turn_observations WHERE task_id = ?').get(task.id);
  assert.equal(turnObs.phase, 'CONSUMED', 'Turn observation presa deve ter sido marcada como CONSUMED');

  // 5. A tarefa in_progress deve ter sido redefinida para 'ready'
  const updatedTask: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id = ?').get(task.id);
  assert.equal(updatedTask.status, 'ready', 'Tarefa presa deve ter sido resetada para ready para permitir re-execução');
});

test('3. schedulerTick auto-reconciles TURN_RECONCILIATION_REQUIRED / AGENT_TURN_UNCERTAIN silently without user click', async t => {
  const { project } = createTestWorkspace(t);
  const projectId = `proj-turn-reconcile-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO projects(id, name, path, objective, is_trusted, full_dev_autonomy, created_at, updated_at) VALUES(?,?,?,?,1,1,?,?)')
    .run(projectId, projectId, project, 'Teste Auto-Heal Turn Reconcile', now, now);

  installPipelineFixture(projectId, project, 1, false);

  t.after(() => {
    AutonomousRunnerService.stop();
    const reservation: any = db.prepare("SELECT token FROM execution_reservations WHERE scope='global-agent-execution'").get();
    if (reservation) ExecutionCoordinator.release('global-agent-execution', reservation.token);
  });

  const run = await AutonomousManager.createRun({
    projectId,
    name: 'Turn Reconcile Run',
    objective: 'Testar reconciliação silenciosa de turno e timeout',
    briefing: 'Testar reconciliação silenciosa de turno e timeout'
  });

  const task = run.tasks[0];
  assert.ok(task, 'Task deve existir');

  // Simular estado após timeout que colocou o run em paused com TURN_RECONCILIATION_REQUIRED
  const worker = WorkerRegistry.createWorker({ name: 'Worker Turn Timeout', environment: 'local' });
  const leaseId = `lease-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO worker_leases (id, worker_id, run_id, task_id, issue_number, claimed_at, lease_until, last_heartbeat, status)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'active')
  `).run(leaseId, worker.id, run.id, task.id, now, now, now);

  db.prepare(`
    INSERT INTO agent_turn_observations (conversation_id, task_id, project_path, brain_dir, baseline_lines, baseline_files_json, phase, dispatched_at)
    VALUES (?, ?, ?, ?, 10, '{}', 'IN_FLIGHT', ?)
  `).run(`conv-${crypto.randomUUID().slice(0, 8)}`, task.id, project, os.tmpdir(), now);

  db.prepare("UPDATE autonomous_tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(now, task.id);
  db.prepare("UPDATE autonomous_runs SET status = 'paused', last_error = 'TURN_RECONCILIATION_REQUIRED: AGENT_TURN_UNCERTAIN: timeout não confirma término de implementação.', next_action = 'Reconciliando estado do turno externo automaticamente antes de prosseguir' WHERE id = ?").run(run.id);

  // Executar schedulerTick diretamente
  (AutonomousRunnerService as any).isRunning = true;
  await (AutonomousRunnerService as any).schedulerTick();

  // Verificações:
  // 1. Run não pode mais estar pausado por TURN_RECONCILIATION_REQUIRED
  const updatedRun: any = db.prepare('SELECT status, last_error FROM autonomous_runs WHERE id = ?').get(run.id);
  assert.notEqual(updatedRun.status, 'paused', 'Run deve ser despausado e auto-retomado');
  assert.ok(!String(updatedRun.last_error || '').includes('TURN_RECONCILIATION_REQUIRED'), 'last_error não pode conter TURN_RECONCILIATION_REQUIRED');
  assert.ok(!String(updatedRun.last_error || '').includes('AGENT_TURN_UNCERTAIN'), 'last_error não pode conter AGENT_TURN_UNCERTAIN');

  // 2. Observação anterior deve ter sido consumida
  const turnObs: any = db.prepare('SELECT phase FROM agent_turn_observations WHERE task_id = ?').get(task.id);
  assert.equal(turnObs.phase, 'CONSUMED', 'Observação anterior deve ser marcada como CONSUMED');

  // 3. Lease anterior deve ter expirado
  const leaseStatus: any = db.prepare('SELECT status FROM worker_leases WHERE id = ?').get(leaseId);
  assert.equal(leaseStatus.status, 'expired', 'Lease ativa deve ser expirada');
});

