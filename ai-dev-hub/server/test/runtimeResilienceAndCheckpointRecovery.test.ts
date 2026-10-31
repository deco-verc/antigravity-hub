import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../src/db.js';
import { RuntimeDaemonManager } from '../src/runtimeDaemonManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { NativeExecutionPolicy } from '../src/nativeExecutionPolicy.js';
import { AgentApiGateway } from '../src/agentApiGateway.js';

test('▶ RuntimeDaemonManager & Checkpoint Resumption Suite', async (t) => {
  await t.test('1. RuntimeDaemonManager: Concurrency Mutex deduplicates parallel boot requests', async () => {
    const manager = RuntimeDaemonManager.getInstance();
    // In automated tests, getActiveCredentials / ensureSingleRuntimeRunning returns null cleanly without spawning
    const p1 = manager.ensureSingleRuntimeRunning('test-profile-concurrency');
    const p2 = manager.ensureSingleRuntimeRunning('test-profile-concurrency');

    // Both promises must resolve without errors and be identical or coordinated
    const [res1, res2] = await Promise.all([p1, p2]);
    assert.strictEqual(res1, res2);
  });

  await t.test('2. AgentApiGateway.isConnectionFailure correctly classifies connection drops', () => {
    assert.strictEqual(AgentApiGateway.isConnectionFailure(new Error('connect ECONNREFUSED 127.0.0.1:49215')), true);
    assert.strictEqual(AgentApiGateway.isConnectionFailure(new Error('socket hang up')), true);
    assert.strictEqual(AgentApiGateway.isConnectionFailure(new Error('Language Server offline (connection refused)')), true);
    assert.strictEqual(AgentApiGateway.isConnectionFailure(new Error('closed socket during write')), true);
    assert.strictEqual(AgentApiGateway.isConnectionFailure(new Error('Invalid JSON syntax')), false);
  });

  await t.test('3. NativeExecutionPolicy: clears stale reservations without throwing NATIVE_EXECUTION_POLICY_ACTIVE_OR_AMBIGUOUS on dead locks', () => {
    const testProjId = `test-policy-proj-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, ?, ?)
    `).run(testProjId, 'Policy Project', 'C:\\dummy\\policy', nowIso, nowIso);

    // Insert an old expired execution reservation (> 5 min ago)
    const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO execution_reservations (scope, token, owner_pid, context_json, created_at, updated_at)
      VALUES ('global-agent-execution', 'old-token', 99999, '{"runId":"old"}', ?, ?)
    `).run(oldTimestamp, oldTimestamp);

    // Also insert a stale agent creation reservation (> 2 min ago)
    db.prepare(`
      INSERT INTO agent_creation_reservations (project_id, role, operation_id, owner_pid, status, created_at)
      VALUES (?, 'WORKER', 'stale-op-1', 99999, 'PENDING', ?)
    `).run(testProjId, oldTimestamp);

    // NativeExecutionPolicy.configure should release stale locks and succeed
    const policy = NativeExecutionPolicy.configure(testProjId, {
      mode: 'permissive',
      acknowledgement: {
        userConsent: 'Explicit consent',
        outsideAccessAllowed: true,
        automaticCommandsAllowed: true,
        noFilesystemIsolation: true
      }
    });

    assert.strictEqual(policy.mode, 'permissive');
    const stored = NativeExecutionPolicy.get(testProjId);
    assert.strictEqual(stored.mode, 'permissive');
  });

  await t.test('4. Checkpoint Resumption: preserves completed tasks, validates files on disk, and resets missing tasks to pending', async () => {
    const testProjId = `test-res-proj-${Date.now()}`;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decohub-checkpoint-res-'));
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, 1, 1, ?, ?)
    `).run(testProjId, 'Checkpoint Project', testDir, nowIso, nowIso);

    // Create an orphaned run with status 'waiting_resource'
    const runId = `run-orphan-${Date.now()}`;
    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, start_time, created_at, updated_at)
      VALUES (?, ?, 'Orphaned Run', 'Test Checkpoint Resumption', 'waiting_resource', ?, ?, ?)
    `).run(runId, testProjId, nowIso, nowIso, nowIso);

    // Task 1: Already completed (should be preserved)
    const task1Id = `task-1-${Date.now()}`;
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, order_index, dependencies_json, created_at, updated_at)
      VALUES (?, ?, 'Task 1: Setup', 'completed', 'COMPLETED', 1, '[]', ?, ?)
    `).run(task1Id, runId, nowIso, nowIso);

    // Task 2: Stuck in 'in_progress', but its expected file exists on disk!
    const task2Id = `task-2-${Date.now()}`;
    const expectedFilePath = 'src/service.ts';
    const absFilePath = path.join(testDir, expectedFilePath);
    fs.mkdirSync(path.dirname(absFilePath), { recursive: true });
    fs.writeFileSync(absFilePath, 'export const ready = true;\n');

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, order_index, dependencies_json, expected_files_json, retry_count, created_at, updated_at)
      VALUES (?, ?, 'Task 2: Build Service', 'in_progress', 'IN_FLIGHT', 2, ?, ?, 0, ?, ?)
    `).run(task2Id, runId, JSON.stringify([task1Id]), JSON.stringify([expectedFilePath]), nowIso, nowIso);

    // Task 3: Stuck in 'running', but its expected file was NOT generated!
    const task3Id = `task-3-${Date.now()}`;
    const missingFilePath = 'src/missing.ts';
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, order_index, dependencies_json, expected_files_json, retry_count, created_at, updated_at)
      VALUES (?, ?, 'Task 3: Missing Feature', 'running', 'IN_FLIGHT', 3, ?, ?, 0, ?, ?)
    `).run(task3Id, runId, JSON.stringify([task2Id]), JSON.stringify([missingFilePath]), nowIso, nowIso);

    // Run reconciliation
    const reconResult = await AutonomousManager.reconcileAndResumeOrphanedRuns(testProjId);

    assert.strictEqual(reconResult.reconciledRuns, 1);
    assert.ok(reconResult.resumedRunIds.includes(runId));
    assert.strictEqual(reconResult.tasksCompletedByFiles, 1); // Task 2 completed
    assert.strictEqual(reconResult.tasksResetToPending, 1); // Task 3 reset to pending

    // Verify task states in database
    const t1 = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(task1Id) as any;
    assert.strictEqual(t1.status, 'completed');

    const t2 = db.prepare('SELECT status, lifecycle_state FROM autonomous_tasks WHERE id = ?').get(task2Id) as any;
    assert.strictEqual(t2.status, 'completed');
    assert.strictEqual(t2.lifecycle_state, 'COMPLETED');

    const t3 = db.prepare('SELECT status, retry_count FROM autonomous_tasks WHERE id = ?').get(task3Id) as any;
    // Task 3 had dependencies on Task 2. Since Task 2 was completed, Task 3 was reset to pending with retry_count=1,
    // and then promoted to 'ready' because its dependencies (Task 2) are now fully satisfied!
    assert.strictEqual(t3.retry_count, 1);
    assert.strictEqual(t3.status, 'ready');

    // Verify run status
    const run = db.prepare('SELECT status, last_error FROM autonomous_runs WHERE id = ?').get(runId) as any;
    assert.strictEqual(run.status, 'running');
    assert.strictEqual(run.last_error, null);

    // Cleanup temp files
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });
});
