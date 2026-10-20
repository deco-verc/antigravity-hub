import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';
import { AutonomousRunnerService } from '../src/autonomousRunnerService.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { ObservabilityService } from '../src/observability/observabilityService.js';

test('ExecutionCoordinator: automatically clears dead PID reservation and acquires', (t) => {
  const scope = `test-scope-dead-${Date.now()}`;
  // Find a definitely dead PID (e.g. 999999 or check with process.kill)
  let deadPid = 999999;
  try {
    process.kill(deadPid, 0);
    deadPid = 999998;
  } catch {}

  // Insert a dead reservation simulating a crashed process
  db.prepare(`
    INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(scope, 'dead-token-123', deadPid, JSON.stringify({ runId: 'dead-run' }), new Date().toISOString());

  t.after(() => {
    db.prepare('DELETE FROM execution_reservations WHERE scope=?').run(scope);
  });

  // Verify the dead reservation exists
  const existing: any = db.prepare('SELECT * FROM execution_reservations WHERE scope=?').get(scope);
  assert.equal(existing?.owner_pid, deadPid);

  // Now acquire from the current process: should detect dead PID, purge it, and succeed
  const token = ExecutionCoordinator.acquire(scope, { runId: 'new-run', reason: 'test-recovery' });
  assert.ok(token);

  // Verify that the reservation now belongs to the current process
  const active: any = db.prepare('SELECT * FROM execution_reservations WHERE scope=?').get(scope);
  assert.equal(active?.token, token);
  assert.equal(active?.owner_pid, process.pid);

  // Release it cleanly
  ExecutionCoordinator.release(scope, token);
  assert.equal(db.prepare('SELECT * FROM execution_reservations WHERE scope=?').get(scope), undefined);
});

test('ExecutionCoordinator: throws EXECUTION_BUSY when lock is held by an alive process', (t) => {
  const scope = `test-scope-alive-${Date.now()}`;
  const token = ExecutionCoordinator.acquire(scope, { runId: 'owner-run' });

  t.after(() => {
    ExecutionCoordinator.release(scope, token);
  });

  // Second acquire must throw EXECUTION_BUSY because process.pid is alive
  assert.throws(
    () => ExecutionCoordinator.acquire(scope, { runId: 'challenger-run' }),
    /EXECUTION_BUSY/
  );
});

test('ExecutionCoordinator.reconcileDeadReservations: sweeps dead reservations across scopes', (t) => {
  const scope1 = `test-sweep-1-${Date.now()}`;
  const scope2 = `test-sweep-2-${Date.now()}`;
  const deadPid = 999997;

  db.prepare(`
    INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at)
    VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
  `).run(
    scope1, 'token-1', deadPid, '{}', new Date().toISOString(),
    scope2, 'token-2', deadPid, '{}', new Date().toISOString()
  );

  t.after(() => {
    db.prepare('DELETE FROM execution_reservations WHERE scope IN (?, ?)').run(scope1, scope2);
  });

  const cleared = ExecutionCoordinator.reconcileDeadReservations();
  assert.ok(cleared >= 2, `Expected at least 2 cleared dead reservations, got ${cleared}`);

  assert.equal(db.prepare('SELECT 1 FROM execution_reservations WHERE scope=?').get(scope1), undefined);
  assert.equal(db.prepare('SELECT 1 FROM execution_reservations WHERE scope=?').get(scope2), undefined);
});

test('AutonomousRunnerService.recoverInterruptedRuns: resets in_review tasks lacking builder reports', (t) => {
  const runId = `test-orphan-rev-${Date.now()}`;
  const taskId = `test-task-no-rep-${Date.now()}`;
  const now = new Date().toISOString();
  const projDir = process.cwd();
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, path, objective, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('test-proj-rec', 'Test Proj Recovery', projDir, 'Test', now, now);

  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(runId, 'test-proj-rec', 'Run Test Recovery', 'Obj', 'running', now, now, now);

  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, runId, 'Task In Review Sem Report', 'in_review', now, now);

  t.after(() => {
    db.prepare('DELETE FROM autonomous_tasks WHERE id=?').run(taskId);
    db.prepare('DELETE FROM autonomous_runs WHERE id=?').run(runId);
    db.prepare('DELETE FROM projects WHERE id=?').run('test-proj-rec');
  });

  // Run recovery
  AutonomousRunnerService.recoverInterruptedRuns();

  // Task should have been reset to 'ready' because it had no builder report
  const recoveredTask: any = db.prepare('SELECT status FROM autonomous_tasks WHERE id=?').get(taskId);
  assert.equal(recoveredTask?.status, 'ready');
});

test('AutonomousManager.resumeRun: clears EXECUTION_RECOVERY_REQUIRED last_error and resumes run', async (t) => {
  const runId = `test-resume-rec-${Date.now()}`;
  const taskId = `test-task-rec-${Date.now()}`;
  const now = new Date().toISOString();
  const projDir = process.cwd();

  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, path, objective, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('test-proj-res', 'Test Proj Resume', projDir, 'Test', now, now);

  db.prepare(`
    INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, start_time, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(runId, 'test-proj-res', 'Run Test Resume', 'Obj', 'error', 'EXECUTION_RECOVERY_REQUIRED: operação reservada em global-agent-execution; reconciliar antes de repetir...', now, now, now);

  db.prepare(`
    INSERT INTO autonomous_tasks (id, run_id, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, runId, 'Task Pronta', 'ready', now, now);

  t.after(() => {
    db.prepare('DELETE FROM autonomous_tasks WHERE id=?').run(taskId);
    db.prepare('DELETE FROM autonomous_runs WHERE id=?').run(runId);
    db.prepare('DELETE FROM projects WHERE id=?').run('test-proj-res');
  });

  const resumed = await AutonomousManager.resumeRun(runId);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.last_error, null);
});

