import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { AccountProfileManager } from '../src/accountProfileManager.js';
import { AutonomousManager } from '../src/autonomousManager.js';
import { ExecutionCoordinator } from '../src/executionCoordinator.js';

describe('Infallible Resume & Account Auto-Failover Suite', () => {
  test('1. AutonomousManager.resumeRun destrava tarefas blocked/error, limpa leases e redefine retry_count = 0', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const testDir = path.join(os.tmpdir(), `infallible-resume-${Date.now()}-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(testDir, { recursive: true });

    const all = AccountProfileManager.getAllProfiles();
    const acc1 = all[0];
    const projectId = randomUUID();
    const runId = randomUUID();
    const taskId1 = randomUUID();
    const taskId2 = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `).run(projectId, 'Infallible Resume Project', testDir, acc1.id, now, now);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, start_time, created_at, updated_at)
      VALUES (?, ?, 'Stuck Run', 'Testar destravamento infalível', 'blocked', 'SESSION_CREATION_UNCERTAIN: falha transiente', ?, ?, ?)
    `).run(runId, projectId, now, now, now);

    // Tarefa 1: Blocked com tentativas esgotadas
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, retry_count, max_retries, created_at, updated_at)
      VALUES (?, ?, 'Tarefa Bloqueada', 'blocked', 'BLOCKED', 3, 3, ?, ?)
    `).run(taskId1, runId, now, now);

    // Tarefa 2: Error
    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, retry_count, max_retries, created_at, updated_at)
      VALUES (?, ?, 'Tarefa com Erro', 'error', 'ERROR', 2, 3, ?, ?)
    `).run(taskId2, runId, now, now);

    // Adicionar aprovação pendente para a tarefa 1
    db.prepare(`
      INSERT INTO autonomous_approvals (id, run_id, task_id, risk_level, title, context, why_needed, supervisor_recommendation, status, created_at)
      VALUES (?, ?, ?, 'yellow', 'Aprovação Bloqueada', 'contexto', 'necessidade', 'recomendação', 'pending', ?)
    `).run(randomUUID(), runId, taskId1, now);

    // Adicionar reserva de execução órfã
    ExecutionCoordinator.acquire('global-agent-execution', { projectId, runId, phase: 'building' });

    // Garantir worker na tabela workers
    const workerId = 'worker-test-1';
    db.prepare(`
      INSERT INTO workers (id, name, account_profile_id, status, created_at, updated_at)
      VALUES (?, 'Test Worker', ?, 'WORKING', ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = 'WORKING'
    `).run(workerId, acc1.id, now, now);

    // Adicionar worker lease ativa diretamente
    const leaseId = randomUUID();
    db.prepare(`
      INSERT INTO worker_leases (id, worker_id, run_id, task_id, claimed_at, lease_until, last_heartbeat, status)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+5 minutes'), datetime('now'), 'active')
    `).run(leaseId, workerId, runId, taskId1);

    // Executar Retomada Manual
    const resumed = await AutonomousManager.resumeRun(runId);

    // Asserções
    assert.strictEqual(resumed.status, 'running');
    assert.strictEqual(resumed.last_error, null);

    // Verificar Tarefa 1 (agora needs_changes / REWORK_REQUIRED com retry_count = 0)
    const task1After: any = db.prepare('SELECT status, lifecycle_state, retry_count FROM autonomous_tasks WHERE id = ?').get(taskId1);
    assert.strictEqual(task1After.status, 'needs_changes');
    assert.strictEqual(task1After.lifecycle_state, 'REWORK_REQUIRED');
    assert.strictEqual(task1After.retry_count, 0);

    // Verificar Tarefa 2 (agora ready com retry_count = 0)
    const task2After: any = db.prepare('SELECT status, lifecycle_state, retry_count FROM autonomous_tasks WHERE id = ?').get(taskId2);
    assert.strictEqual(task2After.status, 'ready');
    assert.strictEqual(task2After.lifecycle_state, 'READY');
    assert.strictEqual(task2After.retry_count, 0);

    // Verificar aprovação auto-resolvida
    const approvalAfter: any = db.prepare('SELECT status FROM autonomous_approvals WHERE task_id = ?').get(taskId1);
    assert.strictEqual(approvalAfter.status, 'approved');

    // Verificar lease expirada
    const leaseAfter: any = db.prepare('SELECT status FROM worker_leases WHERE id = ?').get(leaseId);
    assert.ok(['released', 'expired'].includes(leaseAfter.status));
  });

  test('2. Resume com conta em cota esgotada dispara Auto-Failover para próxima conta pronta', async () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const testDir = path.join(os.tmpdir(), `resume-failover-${Date.now()}-${randomUUID().slice(0, 6)}`);
    fs.mkdirSync(testDir, { recursive: true });

    const all = AccountProfileManager.getAllProfiles();
    const acc1 = all[0];
    let acc2 = all[1];
    if (!acc2) {
      acc2 = AccountProfileManager.createProfile({
        displayName: 'Google Pro 2 Resume Test',
        googleAccountLabel: 'pro2.resume@test.local'
      });
    }

    // Marcar acc1 como QUOTA_EXHAUSTED e acc2 como READY
    db.prepare("UPDATE account_profiles SET quota_resets_at = datetime('now', '+1 hour'), auth_status = 'QUOTA_EXHAUSTED' WHERE id = ?").run(acc1.id);
    db.prepare("UPDATE account_profiles SET quota_resets_at = NULL, quota_message = NULL, auth_status = 'READY' WHERE id = ?").run(acc2.id);

    const projectId = randomUUID();
    const runId = randomUUID();
    const taskId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `).run(projectId, 'Failover on Resume Project', testDir, acc1.id, now, now);

    db.prepare(`
      INSERT INTO autonomous_runs (id, project_id, name, objective, status, last_error, start_time, created_at, updated_at)
      VALUES (?, ?, 'Quota Blocked Run', 'Testar failover ao retomar', 'waiting_resource', 'RESOURCE_EXHAUSTED: 429', ?, ?, ?)
    `).run(runId, projectId, now, now, now);

    db.prepare(`
      INSERT INTO autonomous_tasks (id, run_id, title, status, lifecycle_state, retry_count, max_retries, created_at, updated_at)
      VALUES (?, ?, 'Tarefa Pendente', 'ready', 'READY', 0, 3, ?, ?)
    `).run(taskId, runId, now, now);

    // Retomada deve detectar a cota da acc1 e fazer failover automático para acc2
    const resumed = await AutonomousManager.resumeRun(runId);

    assert.strictEqual(resumed.status, 'running');
    assert.strictEqual(resumed.last_error, null);

    // O projeto agora deve apontar para acc2
    const projAfter: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(projectId);
    assert.strictEqual(projAfter.active_account_profile_id, acc2.id);
  });

  test('3. handleAccountFailureAndRapidSwitchSync alterna perfil e atualiza workers sincronamente', () => {
    AccountProfileManager.setVerifyProbeOverrideForTest(() => true);
    const all = AccountProfileManager.getAllProfiles();
    const acc1 = all[0];
    const acc2 = all[1];

    db.prepare("UPDATE account_profiles SET quota_resets_at = NULL, quota_message = NULL, auth_status = 'READY' WHERE id IN (?, ?)").run(acc1.id, acc2.id);
    AccountProfileManager.setGlobalActiveProfile(acc1.id);

    const projectId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (id, name, path, active_account_profile_id, is_trusted, full_dev_autonomy, created_at, updated_at)
      VALUES (?, 'Sync Failover Proj', 'C:\\dummy', ?, 1, 1, ?, ?)
    `).run(projectId, acc1.id, now, now);

    const failoverResult = AccountProfileManager.handleAccountFailureAndRapidSwitchSync({
      projectId,
      error: 'RESOURCE_EXHAUSTED: 429 credits exhausted',
      autoStartRuntime: false
    });

    assert.strictEqual(failoverResult.switched, true);
    assert.strictEqual(failoverResult.kind, 'QUOTA');
    assert.strictEqual(failoverResult.activeProfile.id, acc2.id);

    const projAfter: any = db.prepare('SELECT active_account_profile_id FROM projects WHERE id = ?').get(projectId);
    assert.strictEqual(projAfter.active_account_profile_id, acc2.id);
  });
});
